import crypto from "node:crypto";
import fs from "node:fs";
import express from "express";
import pg from "pg";

const { Pool } = pg;
const app = express();
const port = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === "production";
const mercuryPriceSheetCsvUrl =
  process.env.MERCURY_PRICE_SHEET_CSV_URL ||
  "https://docs.google.com/spreadsheets/d/1mZAIHlWJcicbfResT2X9kyf7iUcXo_1q35jwjSyMk2o/export?format=csv&gid=2027163115";
const firstClassPriceSheetCsvUrl =
  process.env.FIRST_CLASS_PRICE_SHEET_CSV_URL ||
  "https://docs.google.com/spreadsheets/d/1Y6J9TVs5n8CtmLr5CckOpjkJgQTCkRLS/export?format=csv&gid=732569512";
const atlasUsedSheetId = process.env.ATLAS_USED_SHEET_ID || "1pu4Adxq4MGB6Qour0k__4gBdgnggWRoSVYnJUKgxzEw";
const atlasNewSheetId = process.env.ATLAS_NEW_SHEET_ID || "1f3b0rW1d5xTonDtkoPmLIAOjKc-CUF6clMBalPWyS80";
const followupDaysAfterFirstPurchase = 28;
let mercuryPriceCache = { fetchedAt: 0, rows: [] };
let firstClassPriceCache = { fetchedAt: 0, rows: [] };
let stripflipsPriceCache = { fetchedAt: 0, rows: [] };
let atlasPriceCache = { fetchedAt: 0, rows: [] };
let ktPriceCache = { rows: [] };

const requiredEnv = ["DATABASE_URL", "SESSION_SECRET", "ADMIN_USERNAME"];
for (const key of requiredEnv) {
  if (!process.env[key]) console.warn(`Missing ${key}`);
}

if (!process.env.ADMIN_PASSWORD_HASH && !process.env.ADMIN_PASSWORD) {
  console.warn("Missing ADMIN_PASSWORD_HASH. ADMIN_PASSWORD fallback is also not set.");
}

if (!process.env.PHONE_ADMIN_USERNAME) {
  console.warn("Missing PHONE_ADMIN_USERNAME. Phone portal login is disabled until this is set.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
});

app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static("public", { extensions: ["html"] }));

await migrate();
await seedGoogleDrivePhoneInvoices();
await backfillPhoneProjectedPrices();
startAtlasDailyRefreshJob();

app.post("/api/login", async (req, res) => {
  const { username, password, remember } = req.body || {};
  const ok =
    username === process.env.ADMIN_USERNAME &&
    (await verifyPassword(String(password || "")));

  if (!ok) return res.status(401).json({ error: "Invalid login." });

  const maxAgeSeconds = remember ? 60 * 60 * 24 * 30 : 60 * 60 * 8;
  setSessionCookie(res, username, maxAgeSeconds);
  res.json({ ok: true, username });
});

app.post("/api/logout", (req, res) => {
  res.setHeader("Set-Cookie", makeCookie("dsb_session", "", 0));
  res.json({ ok: true });
});

app.get("/api/me", requireAuth, (req, res) => {
  res.json({ ok: true, username: req.user.username });
});

app.post("/api/phone-login", async (req, res) => {
  const { username, password, remember } = req.body || {};
  const ok =
    username === process.env.PHONE_ADMIN_USERNAME &&
    (await verifyNamedPassword(String(password || ""), "PHONE_ADMIN"));

  if (!ok) return res.status(401).json({ error: "Invalid phone portal login." });

  const maxAgeSeconds = remember ? 60 * 60 * 24 * 30 : 60 * 60 * 8;
  setNamedSessionCookie(res, "phone_session", username, maxAgeSeconds);
  res.json({ ok: true, username, portal: "phone" });
});

app.post("/api/phone-logout", (req, res) => {
  res.setHeader("Set-Cookie", makeCookie("phone_session", "", 0));
  res.json({ ok: true });
});

app.get("/api/phone-me", requirePhoneAuth, (req, res) => {
  res.json({ ok: true, username: req.user.username, portal: "phone" });
});

app.get("/api/phone-price-sheet", requirePhoneAuth, async (req, res) => {
  try {
    const [atlasRows, ktRows] = await Promise.all([getAtlasPrices(), getKtPrices()]);
    res.json({ updated_at: Math.max(atlasPriceCache.fetchedAt, 0), rows: [...atlasRows, ...ktRows] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not load phone price sheets." });
  }
});

app.get("/api/phone-invoices", requirePhoneAuth, async (req, res) => {
  const buyer = normalizeBuyer(req.query.buyer || "");
  const status = String(req.query.status || "Pending").trim();
  const params = [];
  const where = [];
  if (buyer) {
    params.push(buyer);
    where.push(`buyer = $${params.length}`);
  }
  if (status && status !== "All") {
    if (status === "Past") {
      where.push("status <> 'Pending'");
    } else {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
  }
  const result = await pool.query(
    `select * from phone_invoices
     ${where.length ? `where ${where.join(" and ")}` : ""}
     order by created_at desc
     limit 200`,
    params
  );
  const invoices = await attachPhonePurchases(result.rows);
  res.json({ invoices });
});

app.get("/api/phone-manual-returns", requirePhoneAuth, async (req, res) => {
  const result = await pool.query(
    `select * from phone_manual_returns
     order by returned_at desc, created_at desc
     limit 500`
  );
  res.json({ returns: result.rows });
});

app.post("/api/phone-manual-returns", requirePhoneAuth, async (req, res) => {
  const input = req.body || {};
  const model = String(input.model || "").trim();
  const quantity = Math.max(1, Number(input.quantity || 1));
  const costEach = Number(input.cost_each || 0);
  if (!model) return res.status(400).json({ error: "Enter the returned phone model." });
  if (!Number.isFinite(quantity) || quantity < 1) return res.status(400).json({ error: "Quantity must be at least 1." });
  if (!Number.isFinite(costEach) || costEach < 0) return res.status(400).json({ error: "Enter a valid cost." });
  const result = await pool.query(
    `insert into phone_manual_returns
       (buyer, old_invoice_label, returned_at, model, carrier, condition, quantity, cost_each, reason, notes)
     values ('KT', $1, coalesce($2::date, current_date), $3, $4, $5, $6, $7, $8, $9)
     returning *`,
    [
      String(input.old_invoice_label || "").trim(),
      input.returned_at || null,
      model,
      String(input.carrier || "").trim(),
      String(input.condition || "").trim() || "Returned",
      quantity,
      costEach,
      String(input.reason || "").trim(),
      String(input.notes || "").trim(),
    ]
  );
  res.json({ ok: true, return: result.rows[0] });
});

app.patch("/api/phone-manual-returns/:id/sale", requirePhoneAuth, async (req, res) => {
  const id = Number(req.params.id);
  const status = String(req.body?.status || "Holding").trim() || "Holding";
  const salePrice = req.body?.sale_price === "" || req.body?.sale_price === undefined || req.body?.sale_price === null
    ? null
    : Number(req.body.sale_price);
  const saleDate = req.body?.sold_at || null;
  const saleNotes = String(req.body?.sale_notes || "").trim();
  if (!id) return res.status(400).json({ error: "Return ID is required." });
  if (salePrice !== null && (!Number.isFinite(salePrice) || salePrice < 0)) return res.status(400).json({ error: "Enter a valid sold amount." });
  const result = await pool.query(
    `update phone_manual_returns
     set status = $2,
       sale_price = $3::numeric,
       sold_at = case when $3::numeric is not null then coalesce($4::date, current_date) else null end,
       sale_notes = $5
     where id = $1
     returning *`,
    [id, status, salePrice, saleDate, saleNotes]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "Manual return not found." });
  res.json({ ok: true, return: result.rows[0] });
});

app.post("/api/phone-invoices", requirePhoneAuth, async (req, res) => {
  const buyer = normalizeBuyer(req.body?.buyer || "");
  const label = String(req.body?.label || "").trim();
  const notes = String(req.body?.notes || "").trim();
  if (!buyer) return res.status(400).json({ error: "Choose KT or Atlas." });
  const result = await pool.query(
    `insert into phone_invoices (buyer, label, notes, status)
     values ($1, $2, $3, 'Pending')
     returning *`,
    [buyer, label || defaultPhoneInvoiceLabel(buyer), notes]
  );
  res.json({ ok: true, invoice: result.rows[0] });
});

app.patch("/api/phone-invoices/:id/status", requirePhoneAuth, async (req, res) => {
  const id = Number(req.params.id);
  const status = String(req.body?.status || "").trim();
  const allowed = new Set(["Pending", "Sold", "Shipped", "Closed"]);
  if (!id) return res.status(400).json({ error: "Invoice ID is required." });
  if (!allowed.has(status)) return res.status(400).json({ error: "Choose Pending, Sold, Shipped, or Closed." });
  if (status === "Sold") {
    const existing = await pool.query("select sale_price from phone_invoices where id = $1", [id]);
    if (!existing.rows[0]) return res.status(404).json({ error: "Invoice not found." });
    if (existing.rows[0].sale_price === null || existing.rows[0].sale_price === undefined) {
      return res.status(400).json({ error: "Enter the amount sold before marking this invoice Sold." });
    }
  }
  const result = await pool.query(
    `update phone_invoices
     set status = $1,
       status_updated_at = now(),
       shipped_at = case when $1 = 'Shipped' and shipped_at is null then now() else shipped_at end,
       sold_at = case when $1 = 'Sold' and sold_at is null then now() else sold_at end,
       closed_at = case when $1 = 'Closed' and closed_at is null then now() else closed_at end
     where id = $2
     returning *`,
    [status, id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "Invoice not found." });
  res.json({ ok: true, invoice: result.rows[0] });
});

app.patch("/api/phone-invoices/:id/sale", requirePhoneAuth, async (req, res) => {
  const id = Number(req.params.id);
  const rawSalePrice = req.body?.sale_price;
  const salePrice = rawSalePrice === undefined || rawSalePrice === "" ? null : Number(String(rawSalePrice).replace(/[$,\s]/g, ""));
  const saleNotes = String(req.body?.sale_notes || "").trim();
  if (!id) return res.status(400).json({ error: "Invoice ID is required." });
  if (salePrice !== null && (Number.isNaN(salePrice) || salePrice < 0)) {
    return res.status(400).json({ error: "Sale amount must be a valid number." });
  }
  try {
    const result = await pool.query(
      `update phone_invoices
       set sale_price = $1::numeric,
         sale_notes = $2,
         sold_at = case when $1::numeric is not null and sold_at is null then now() else sold_at end,
         status_updated_at = now()
       where id = $3
       returning *`,
      [salePrice, saleNotes, id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Invoice not found." });
    res.json({ ok: true, invoice: result.rows[0] });
  } catch (error) {
    console.error("Could not save phone invoice sale amount.", error);
    res.status(500).json({ error: `Could not save phone invoice sale amount: ${error.message}` });
  }
});

app.post("/api/phone-purchases", requirePhoneAuth, async (req, res) => {
  const input = req.body || {};
  const buyer = normalizeBuyer(input.buyer || "");
  const invoiceId = Number(input.invoice_id || 0) || null;
  const quantity = Number(input.quantity || 0);
  const costEach = Number(input.cost_each || 0);
  let projectedSellEach = Number(input.projected_sell_each || 0);
  if (!buyer) return res.status(400).json({ error: "Choose KT or Atlas." });
  if (!quantity || quantity < 1) return res.status(400).json({ error: "Quantity must be at least 1." });
  if (!String(input.model || "").trim()) return res.status(400).json({ error: "Choose a model." });

  const client = await pool.connect();
  try {
    await client.query("begin");
    const invoice = invoiceId
      ? await findPhoneInvoice(client, invoiceId, buyer)
      : await getOrCreatePendingPhoneInvoice(client, buyer);
    if (!invoice) {
      await client.query("rollback");
      return res.status(404).json({ error: "Pending invoice not found for that buyer." });
    }
    const priceRows = buyer === "KT" ? await getKtPrices() : await getAtlasPrices();
    const matchedProjected = findPhonePrice(
      {
        device_type: normalizeDeviceType(input.device_type || ""),
        condition_type: normalizeConditionType(input.condition_type || ""),
        packaging: String(input.packaging || "").trim(),
        grade: String(input.grade || "").trim(),
        model: String(input.model || "").trim(),
        carrier: String(input.carrier || "").trim(),
        notes: String(input.notes || "").trim(),
      },
      priceRows,
      buyer
    );
    if (matchedProjected) projectedSellEach = matchedProjected;
    const invoiceItemStart = await nextPhoneInvoiceItemStart(client, invoice.id);
    const purchase = await client.query(
      `insert into phone_purchases
       (invoice_id, buyer, purchase_date, device_type, condition_type, packaging, grade, model, carrier, quantity, cost_each, projected_sell_each, imei, photo_file_name, photo_data_url, notes, invoice_item_start)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       returning *`,
      [
        invoice.id,
        buyer,
        input.purchase_date || new Date().toISOString().slice(0, 10),
        normalizeDeviceType(input.device_type || ""),
        normalizeConditionType(input.condition_type || ""),
        String(input.packaging || "").trim(),
        String(input.grade || "").trim(),
        String(input.model || "").trim(),
        String(input.carrier || "").trim(),
        quantity,
        costEach,
        projectedSellEach,
        String(input.imei || "").trim(),
        String(input.photo?.file_name || "").slice(0, 160),
        isAllowedPhotoDataUrl(input.photo?.data_url) ? String(input.photo.data_url) : "",
        String(input.notes || "").trim(),
        invoiceItemStart,
      ]
    );
    await client.query("commit");
    res.json({ ok: true, invoice, purchase: purchase.rows[0] });
  } catch (error) {
    await client.query("rollback");
    console.error(error);
    res.status(500).json({ error: "Could not save phone purchase." });
  } finally {
    client.release();
  }
});

app.post("/api/phone-purchases/move-latest", requirePhoneAuth, async (req, res) => {
  const buyer = normalizeBuyer(req.body?.buyer || "KT");
  const count = Math.max(1, Math.min(25, Number(req.body?.count || 5)));
  if (!buyer) return res.status(400).json({ error: "Choose KT or Atlas." });

  const client = await pool.connect();
  try {
    await client.query("begin");
    const targetInvoice = await getOrCreatePendingPhoneInvoice(client, buyer);
    const latest = await client.query(
      `select pp.*
       from phone_purchases pp
       join phone_invoices pi on pi.id = pp.invoice_id
       where pp.invoice_removed_at is null
         and pp.returned_at is null
         and pi.status = 'Pending'
         and pp.buyer <> $1
       order by pp.created_at desc, pp.id desc
       limit $2`,
      [buyer, count]
    );
    const priceRows = buyer === "KT" ? await getKtPrices() : await getAtlasPrices();
    const moved = [];
    for (const row of latest.rows) {
      const purchaseForBuyer = { ...row, buyer };
      const projectedSellEach = findPhonePrice(purchaseForBuyer, priceRows, buyer) || Number(row.projected_sell_each || 0);
      const invoiceItemStart = await nextPhoneInvoiceItemStart(client, targetInvoice.id);
      const updated = await client.query(
        `update phone_purchases
         set invoice_id = $1,
           buyer = $2,
           projected_sell_each = $3,
           invoice_added_at = now(),
           invoice_item_start = $4
         where id = $5
         returning *`,
        [targetInvoice.id, buyer, projectedSellEach, invoiceItemStart, row.id]
      );
      moved.push(updated.rows[0]);
    }
    await client.query("commit");
    res.json({ ok: true, invoice: targetInvoice, moved });
  } catch (error) {
    await client.query("rollback");
    console.error(error);
    res.status(500).json({ error: "Could not move latest phone purchases." });
  } finally {
    client.release();
  }
});

app.patch("/api/phone-purchases/:id", requirePhoneAuth, async (req, res) => {
  const id = Number(req.params.id);
  const input = req.body || {};
  const buyer = normalizeBuyer(input.buyer || "");
  const invoiceId = Number(input.invoice_id || 0) || null;
  const quantity = Number(input.quantity || 0);
  const costEach = Number(input.cost_each || 0);
  let projectedSellEach = Number(input.projected_sell_each || 0);
  if (!id) return res.status(400).json({ error: "Purchase ID is required." });
  if (!buyer) return res.status(400).json({ error: "Choose KT or Atlas." });
  if (!invoiceId) return res.status(400).json({ error: "Choose an invoice." });
  if (!quantity || quantity < 1) return res.status(400).json({ error: "Quantity must be at least 1." });
  if (!String(input.model || "").trim()) return res.status(400).json({ error: "Choose a model." });

  const client = await pool.connect();
  try {
    await client.query("begin");
    const invoice = await findAnyPhoneInvoice(client, invoiceId, buyer);
    if (!invoice) {
      await client.query("rollback");
      return res.status(404).json({ error: "Invoice not found for that buyer." });
    }
    const existing = await client.query("select * from phone_purchases where id = $1", [id]);
    if (!existing.rows[0]) {
      await client.query("rollback");
      return res.status(404).json({ error: "Phone purchase not found." });
    }
    const priceRows = buyer === "KT" ? await getKtPrices() : await getAtlasPrices();
    const matchedProjected = findPhonePrice(
      {
        device_type: normalizeDeviceType(input.device_type || ""),
        condition_type: normalizeConditionType(input.condition_type || ""),
        packaging: String(input.packaging || "").trim(),
        grade: String(input.grade || "").trim(),
        model: String(input.model || "").trim(),
        carrier: String(input.carrier || "").trim(),
        notes: String(input.notes || "").trim(),
      },
      priceRows,
      buyer
    );
    if (matchedProjected) projectedSellEach = matchedProjected;

    const hasNewPhoto = input.photo && typeof input.photo === "object";
    const photoFileName = hasNewPhoto ? String(input.photo?.file_name || "").slice(0, 160) : existing.rows[0].photo_file_name;
    const photoDataUrl = hasNewPhoto && isAllowedPhotoDataUrl(input.photo?.data_url)
      ? String(input.photo.data_url)
      : existing.rows[0].photo_data_url;
    const invoiceItemStart = Number(existing.rows[0].invoice_id) === Number(invoice.id)
      ? Number(existing.rows[0].invoice_item_start || 0) || await nextPhoneInvoiceItemStart(client, invoice.id)
      : await nextPhoneInvoiceItemStart(client, invoice.id);
    const result = await client.query(
      `update phone_purchases
       set invoice_id = $1,
         buyer = $2,
         purchase_date = $3,
         device_type = $4,
         condition_type = $5,
         packaging = $6,
         grade = $7,
         model = $8,
         carrier = $9,
         quantity = $10,
         cost_each = $11,
         projected_sell_each = $12,
         imei = $13,
         photo_file_name = $14,
         photo_data_url = $15,
         notes = $16,
         invoice_added_at = case when invoice_id <> $1 then now() else invoice_added_at end,
         invoice_item_start = $17
       where id = $18
       returning *`,
      [
        invoice.id,
        buyer,
        input.purchase_date || new Date().toISOString().slice(0, 10),
        normalizeDeviceType(input.device_type || ""),
        normalizeConditionType(input.condition_type || ""),
        String(input.packaging || "").trim(),
        String(input.grade || "").trim(),
        String(input.model || "").trim(),
        String(input.carrier || "").trim(),
        quantity,
        costEach,
        projectedSellEach,
        String(input.imei || "").trim(),
        photoFileName,
        photoDataUrl,
        String(input.notes || "").trim(),
        invoiceItemStart,
        id,
      ]
    );
    await client.query("commit");
    res.json({ ok: true, invoice, purchase: result.rows[0] });
  } catch (error) {
    await client.query("rollback");
    console.error(error);
    res.status(500).json({ error: "Could not update phone purchase." });
  } finally {
    client.release();
  }
});

app.patch("/api/phone-purchases/:id/move-invoice", requirePhoneAuth, async (req, res) => {
  const id = Number(req.params.id);
  const invoiceId = Number(req.body?.invoice_id || 0);
  if (!id) return res.status(400).json({ error: "Purchase ID is required." });
  if (!invoiceId) return res.status(400).json({ error: "Choose the invoice to move this phone to." });

  const client = await pool.connect();
  try {
    await client.query("begin");
    const purchaseResult = await client.query("select * from phone_purchases where id = $1 and invoice_removed_at is null", [id]);
    const purchase = purchaseResult.rows[0];
    if (!purchase) {
      await client.query("rollback");
      return res.status(404).json({ error: "Active phone purchase not found." });
    }
    const invoiceResult = await client.query("select * from phone_invoices where id = $1 and status = 'Pending'", [invoiceId]);
    const invoice = invoiceResult.rows[0];
    if (!invoice) {
      await client.query("rollback");
      return res.status(404).json({ error: "Pending invoice not found." });
    }
    const priceRows = invoice.buyer === "KT" ? await getKtPrices() : await getAtlasPrices();
    const projectedSellEach = findPhonePrice({ ...purchase, buyer: invoice.buyer }, priceRows, invoice.buyer) || Number(purchase.projected_sell_each || 0);
    const invoiceItemStart = await nextPhoneInvoiceItemStart(client, invoice.id);
    const moved = await client.query(
      `update phone_purchases
       set invoice_id = $1,
         buyer = $2,
         projected_sell_each = $3,
         invoice_added_at = now(),
         invoice_item_start = $4
       where id = $5
       returning *`,
      [invoice.id, invoice.buyer, projectedSellEach, invoiceItemStart, id]
    );
    await client.query("commit");
    res.json({ ok: true, invoice, purchase: moved.rows[0] });
  } catch (error) {
    await client.query("rollback");
    console.error(error);
    res.status(500).json({ error: "Could not move phone to that invoice." });
  } finally {
    client.release();
  }
});

app.patch("/api/phone-purchases/:id/invoice-removal", requirePhoneAuth, async (req, res) => {
  const id = Number(req.params.id);
  const remove = req.body?.remove !== false;
  const reason = String(req.body?.reason || "Sold locally").trim();
  const localSalePrice = req.body?.local_sale_price === "" || req.body?.local_sale_price === undefined || req.body?.local_sale_price === null
    ? null
    : Number(req.body.local_sale_price);
  const localSaleNotes = String(req.body?.local_sale_notes || "").trim();
  if (!id) return res.status(400).json({ error: "Purchase ID is required." });
  if (localSalePrice !== null && (!Number.isFinite(localSalePrice) || localSalePrice < 0)) {
    return res.status(400).json({ error: "Enter a valid local sale amount." });
  }
  const result = await pool.query(
    `update phone_purchases pp
     set invoice_removed_at = case when $2 then now() else null end,
       invoice_removed_reason = case when $2 then coalesce(nullif($3,''), 'Sold locally') else '' end,
       local_sale_price = case when $2 then $4::numeric else null end,
       local_sold_at = case when $2 and lower(coalesce(nullif($3,''), 'Sold locally')) like '%sold locally%' then now() else null end,
       local_sale_notes = case when $2 then $5 else '' end
     from phone_invoices pi
     where pp.invoice_id = pi.id
       and pp.id = $1
       and pi.status = 'Pending'
     returning pp.*`,
    [id, remove, reason, localSalePrice, localSaleNotes]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "Pending invoice item not found." });
  res.json({ ok: true, purchase: result.rows[0] });
});

app.patch("/api/phone-purchases/:id/gift-card", requirePhoneAuth, async (req, res) => {
  const id = Number(req.params.id);
  const giftCardValue = req.body?.gift_card_value === "" || req.body?.gift_card_value === undefined || req.body?.gift_card_value === null
    ? null
    : Number(req.body.gift_card_value);
  const giftCardNotes = String(req.body?.gift_card_notes || "Apple trade-in gift card").trim();
  const giftCardLocation = String(req.body?.gift_card_location || "").trim();
  if (!id) return res.status(400).json({ error: "Purchase ID is required." });
  if (giftCardValue === null || !Number.isFinite(giftCardValue) || giftCardValue < 0) {
    return res.status(400).json({ error: "Enter the Apple gift card value." });
  }
  const result = await pool.query(
    `update phone_purchases pp
     set invoice_removed_at = now(),
       invoice_removed_reason = 'Apple gift card trade-in',
       gift_card_value = $2::numeric,
       gift_card_at = now(),
       gift_card_notes = $3,
       gift_card_location = $4,
       local_sale_price = null,
       local_sold_at = null,
       local_sale_notes = ''
     from phone_invoices pi
     where pp.invoice_id = pi.id
       and pp.id = $1
       and pi.status = 'Pending'
       and pp.invoice_removed_at is null
    returning pp.*`,
    [id, giftCardValue, giftCardNotes, giftCardLocation]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "Pending invoice item not found." });
  res.json({ ok: true, purchase: result.rows[0] });
});

app.post("/api/phone-gift-cards", requirePhoneAuth, async (req, res) => {
  const input = req.body || {};
  const model = String(input.model || "").trim();
  const quantity = Number(input.quantity || 1);
  const costEach = Number(input.cost_each || 0);
  const giftCardValue = Number(input.gift_card_value || 0);
  const giftCardAt = input.gift_card_at || localDateInTimeZone();
  const giftCardLocation = String(input.gift_card_location || "").trim();
  if (!model) return res.status(400).json({ error: "Enter the phone model." });
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) return res.status(400).json({ error: "Quantity must be between 1 and 100." });
  if (!Number.isFinite(costEach) || costEach < 0) return res.status(400).json({ error: "Enter the phone cost." });
  if (!Number.isFinite(giftCardValue) || giftCardValue < 0) return res.status(400).json({ error: "Enter the gift card value." });
  const client = await pool.connect();
  try {
    await client.query("begin");
    const invoice = await getOrCreateWeeklyGiftCardInvoice(client, giftCardAt);
    const purchases = [];
    for (let index = 0; index < quantity; index += 1) {
      const invoiceItemStart = await nextPhoneInvoiceItemStart(client, invoice.id);
      const purchase = await client.query(
        `insert into phone_purchases
         (invoice_id, buyer, purchase_date, device_type, condition_type, model, carrier, quantity, cost_each, invoice_removed_at, invoice_removed_reason, gift_card_value, gift_card_at, gift_card_notes, gift_card_location, notes, invoice_item_start)
         values ($1,'Apple GC',$2,'Phone','Used',$3,'Apple Trade-In',1,$4,now(),'Apple gift card trade-in',$5,($2::date + time '12:00'),'Manual gift card entry',$6,'Direct gift card entry',$7)
         returning *`,
        [invoice.id, giftCardAt, model, costEach, giftCardValue, giftCardLocation, invoiceItemStart]
      );
      purchases.push(purchase.rows[0]);
    }
    await client.query("commit");
    res.json({ ok: true, count: purchases.length, purchases });
  } catch (error) {
    await client.query("rollback");
    console.error("Could not add manual phone gift card.", error);
    res.status(500).json({ error: "Could not add gift card." });
  } finally {
    client.release();
  }
});

app.post("/api/phone-gift-cards/closeout", requirePhoneAuth, async (req, res) => {
  const input = req.body || {};
  const requestedLabel = String(input.label || "").trim();
  const requestedNotes = String(input.notes || "").trim();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const openCards = await client.query(
      `select *
         from phone_purchases
        where gift_card_at is not null
          and returned_at is null
          and gift_card_closeout_invoice_id is null
        order by gift_card_at asc, created_at asc, id asc`
    );
    if (!openCards.rows.length) {
      await client.query("rollback");
      return res.status(400).json({ error: "There are no open gift cards to close out." });
    }
    const totalCost = openCards.rows.reduce((sum, row) => sum + Number(row.quantity || 0) * Number(row.cost_each || 0), 0);
    const totalValue = openCards.rows.reduce((sum, row) => sum + Number(row.gift_card_value || 0), 0);
    const today = localDateInTimeZone();
    const label = requestedLabel || `Gift Card Closeout ${today}`;
    const notes = [
      requestedNotes || "Manual gift card closeout batch",
      `${openCards.rows.length} gift card${openCards.rows.length === 1 ? "" : "s"}`,
      `Cost ${moneyText(totalCost)}`,
      `Value ${moneyText(totalValue)}`,
      `Profit ${moneyText(totalValue - totalCost)}`,
    ].join(" | ");
    const invoiceResult = await client.query(
      `insert into phone_invoices (buyer, label, notes, status, sale_price, status_updated_at, closed_at)
       values ('Apple GC', $1, $2, 'Closed', $3::numeric, now(), now())
       returning *`,
      [label, notes, totalValue]
    );
    const invoice = invoiceResult.rows[0];
    const updated = await client.query(
      `update phone_purchases
          set gift_card_closeout_invoice_id = $1
        where id = any($2::int[])
        returning *`,
      [invoice.id, openCards.rows.map((row) => row.id)]
    );
    await client.query("commit");
    res.json({
      ok: true,
      invoice,
      count: updated.rows.length,
      total_cost: totalCost,
      total_value: totalValue,
      profit: totalValue - totalCost,
    });
  } catch (error) {
    await client.query("rollback");
    console.error("Could not close out gift cards.", error);
    res.status(500).json({ error: "Could not close out gift cards." });
  } finally {
    client.release();
  }
});

app.patch("/api/phone-purchases/:id/gift-card-details", requirePhoneAuth, async (req, res) => {
  const id = Number(req.params.id);
  const giftCardPhoto = req.body?.gift_card_photo || null;
  const receiptPhoto = req.body?.receipt_photo || null;
  if (!id) return res.status(400).json({ error: "Purchase ID is required." });
  const result = await pool.query(
    `update phone_purchases
     set gift_card_photo_file_name = coalesce(nullif($2,''), gift_card_photo_file_name),
       gift_card_photo_data_url = coalesce(nullif($3,''), gift_card_photo_data_url),
       gift_card_receipt_file_name = coalesce(nullif($4,''), gift_card_receipt_file_name),
       gift_card_receipt_data_url = coalesce(nullif($5,''), gift_card_receipt_data_url)
     where id = $1
       and gift_card_at is not null
     returning *`,
    [
      id,
      String(giftCardPhoto?.file_name || ""),
      String(giftCardPhoto?.data_url || ""),
      String(receiptPhoto?.file_name || ""),
      String(receiptPhoto?.data_url || ""),
    ]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "Gift card record not found." });
  res.json({ ok: true, purchase: result.rows[0] });
});

app.patch("/api/phone-purchases/:id/gift-card-receipt-pdf", requirePhoneAuth, express.raw({ type: "application/pdf", limit: "25mb" }), async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Purchase ID is required." });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "Choose a PDF receipt." });
  const fileName = decodeURIComponent(String(req.headers["x-file-name"] || "receipt.pdf")).slice(0, 240);
  const dataUrl = `data:application/pdf;base64,${req.body.toString("base64")}`;
  const result = await pool.query(
    `update phone_purchases
     set gift_card_receipt_file_name = $2,
       gift_card_receipt_data_url = $3
     where id = $1
       and gift_card_at is not null
     returning *`,
    [id, fileName || "receipt.pdf", dataUrl]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "Gift card record not found." });
  res.json({ ok: true, purchase: result.rows[0] });
});

app.patch("/api/phone-purchases/:id/return", requirePhoneAuth, async (req, res) => {
  const id = Number(req.params.id);
  const reason = String(req.body?.reason || "").trim();
  if (!id) return res.status(400).json({ error: "Purchase ID is required." });
  if (!reason) return res.status(400).json({ error: "Enter the return reason." });
  const result = await pool.query(
    `update phone_purchases pp
     set invoice_removed_at = now(),
       invoice_removed_reason = 'Returned to ' || pi.buyer,
       returned_at = now(),
       return_status = 'Returned',
       return_reason = $2
     from phone_invoices pi
     where pp.invoice_id = pi.id
       and pp.id = $1
       and pi.sale_price is null
     returning pp.*`,
    [id, reason]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "Invoice item not found, or final sale amount is already entered." });
  res.json({ ok: true, purchase: result.rows[0] });
});

app.patch("/api/phone-purchases/:id/return-status", requirePhoneAuth, async (req, res) => {
  const id = Number(req.params.id);
  const returnStatus = String(req.body?.status || "").trim();
  const allowedStatuses = ["KT", "Atlas", "Returned", "Sold"];
  if (!id) return res.status(400).json({ error: "Purchase ID is required." });
  if (!allowedStatuses.includes(returnStatus)) return res.status(400).json({ error: "Choose KT, Atlas, Returned, or Sold." });
  const result = await pool.query(
    `update phone_purchases
     set return_status = $2
     where id = $1
       and returned_at is not null
     returning *`,
    [id, returnStatus]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "Return item not found." });
  res.json({ ok: true, purchase: result.rows[0] });
});

app.get("/api/phone-invoices/:id/html", requirePhoneAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).send("Invoice ID is required.");
  const result = await pool.query("select * from phone_invoices where id = $1", [id]);
  const invoices = await attachPhonePurchases(result.rows);
  const invoice = invoices[0];
  if (!invoice) return res.status(404).send("Invoice not found.");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(createPhoneInvoiceHtml(invoice, parsePhoneInvoicePriceOverrides(req.query.prices)));
});

app.get("/api/phone-gift-card-closeouts/:id/html", requirePhoneAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).send("Gift card closeout invoice ID is required.");
  const invoiceResult = await pool.query("select * from phone_invoices where id = $1 and buyer = 'Apple GC'", [id]);
  const invoice = invoiceResult.rows[0];
  if (!invoice) return res.status(404).send("Gift card closeout invoice not found.");
  const purchases = await pool.query(
    `select ranked.*,
        source_invoice.buyer as source_buyer,
        source_invoice.label as source_label
       from (
        select pp.*,
          row_number() over (order by pp.gift_card_at asc nulls last, pp.created_at asc, pp.id asc) as gift_card_number
         from phone_purchases pp
         where pp.gift_card_at is not null
       ) ranked
       left join phone_invoices source_invoice on source_invoice.id = ranked.invoice_id
      where ranked.gift_card_closeout_invoice_id = $1
      order by ranked.gift_card_at asc nulls last, ranked.created_at asc, ranked.id asc`,
    [id]
  );
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(createGiftCardCloseoutInvoiceHtml(invoice, purchases.rows));
});

app.get("/api/customers/lookup", requireAuth, async (req, res) => {
  const phone = normalizePhone(req.query.phone || "");
  if (!phone) return res.status(400).json({ error: "Phone number is required." });

  const customer = await findCustomerByPhone(phone);
  if (!customer) return res.json({ customer: null, invoices: [] });

  const invoices = await getCustomerHistory(customer.id);
  res.json({ customer, invoices });
});

app.get("/api/followups", requireAuth, async (req, res) => {
  const result = await pool.query(
    `select c.*, count(i.id)::int as invoice_count, coalesce(sum(i.total_paid),0)::numeric as total_paid,
      min(i.purchase_date) as first_purchase_date,
      max(i.purchase_date) as last_purchase_date
     from customers c
     left join invoices i on i.customer_id = c.id
     where c.next_follow_up_at is not null and c.next_follow_up_at <= current_date
     group by c.id
     order by c.next_follow_up_at asc, c.updated_at desc
     limit 100`
  );
  res.json({ customers: result.rows });
});

app.get("/api/customers", requireAuth, async (req, res) => {
  const search = String(req.query.search || "").trim();
  const params = [];
  let where = "";
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    where = `where lower(c.name) like $1 or c.phone like $1 or lower(c.email) like $1 or lower(c.address) like $1 or lower(c.location) like $1 or lower(c.source) like $1 or lower(c.notes) like $1 or c.customer_number::text like $1`;
  }
  const result = await pool.query(
    `select c.*, count(i.id)::int as invoice_count, coalesce(sum(i.total_paid),0)::numeric as total_paid,
      min(i.purchase_date) as first_purchase_date,
      max(i.purchase_date) as last_purchase_date
     from customers c
     left join invoices i on i.customer_id = c.id
     ${where}
     group by c.id
     order by c.updated_at desc
     limit 100`,
    params
  );
  res.json({ customers: result.rows });
});

app.get("/api/buyers", requireAuth, async (req, res) => {
  const search = String(req.query.search || "").trim().toLowerCase();
  const params = [];
  let where = "";
  if (search) {
    params.push(`%${search}%`);
    where = `where lower(company_name) like $1 or lower(contact_name) like $1 or lower(email) like $1 or lower(phone) like $1 or lower(notes) like $1 or buyer_number::text like $1`;
  }
  const result = await pool.query(
    `select * from buyer_contacts
     ${where}
     order by buyer_number asc`,
    params
  );
  const batches = await pool.query(
    `select id, label, status, sold_to, sale_price, tracking_number, sold_at, shipped_at, created_at, status_updated_at
     from invoice_batches
     where sold_to <> ''
       and status in ('Sold','Shipped')
     order by status_updated_at desc, created_at desc
     limit 500`
  );
  const buyers = result.rows.map((buyer) => ({
    ...buyer,
    invoices: batches.rows.filter((batch) => sameBuyerName(batch.sold_to, buyer.company_name)),
  }));
  res.json({ buyers });
});

app.post("/api/buyers", requireAuth, async (req, res) => {
  const input = req.body || {};
  const id = Number(input.id || 0) || null;
  const companyName = String(input.company_name || "").trim();
  const contactName = String(input.contact_name || "").trim();
  const email = String(input.email || "").trim();
  const phone = String(input.phone || "").trim();
  const shippingAddress = String(input.shipping_address || "").trim();
  const priceListUrl = String(input.price_list_url || "").trim();
  const priceListFileName = String(input.price_list_file_name || "").trim().slice(0, 180);
  const priceListDataUrl = isAllowedDocumentDataUrl(input.price_list_data_url) ? String(input.price_list_data_url) : "";
  const notes = String(input.notes || "").trim();
  if (!companyName) return res.status(400).json({ error: "Company name is required." });

  if (id) {
    const result = await pool.query(
      `update buyer_contacts
       set company_name = $1,
         contact_name = $2,
         email = $3,
         phone = $4,
         shipping_address = $5,
         price_list_url = $6,
         price_list_file_name = coalesce(nullif($7,''), price_list_file_name),
         price_list_data_url = coalesce(nullif($8,''), price_list_data_url),
         notes = $9,
         updated_at = now()
       where id = $10
       returning *`,
      [companyName, contactName, email, phone, shippingAddress, priceListUrl, priceListFileName, priceListDataUrl, notes, id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Buyer not found." });
    return res.json({ ok: true, buyer: result.rows[0] });
  }

  const result = await pool.query(
    `insert into buyer_contacts
     (buyer_number, company_name, contact_name, email, phone, shipping_address, price_list_url, price_list_file_name, price_list_data_url, notes)
     values ((select coalesce(max(buyer_number),0) + 1 from buyer_contacts), $1,$2,$3,$4,$5,$6,$7,$8,$9)
     returning *`,
    [companyName, contactName, email, phone, shippingAddress, priceListUrl, priceListFileName, priceListDataUrl, notes]
  );
  res.json({ ok: true, buyer: result.rows[0] });
});

app.post("/api/customers", requireAuth, async (req, res) => {
  const input = req.body || {};
  const phone = normalizePhone(input.phone || "");
  if (!phone) return res.status(400).json({ error: "Customer phone is required." });
  const client = await pool.connect();
  try {
    const customer = await upsertCustomer(client, {
      name: input.name || "",
      phone,
      email: input.email || "",
      address: input.address || "",
      location: input.location || "",
      source: input.source || "",
      notes: input.notes || "",
      replace_notes: input.replace_notes !== false,
      crm_status: input.crm_status || "Customer",
      next_follow_up_at: input.next_follow_up_at || null,
    });
    res.json({ ok: true, customer });
  } finally {
    client.release();
  }
});

app.patch("/api/customers/:id/followup", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const next = String(req.body?.next_follow_up_at || "").trim();
  if (!id) return res.status(400).json({ error: "Customer ID is required." });
  const result = await pool.query(
    `update customers
     set last_follow_up_at = current_date,
       next_follow_up_at = coalesce(nullif($2,'')::date, current_date + $3::int),
       updated_at = now()
     where id = $1
     returning *`,
    [id, next, followupDaysAfterFirstPurchase]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "Customer not found." });
  res.json({ ok: true, customer: result.rows[0] });
});

app.post("/api/batches", requireAuth, async (req, res) => {
  const label = String(req.body?.label || "").trim();
  const notes = String(req.body?.notes || "").trim();
  const result = await pool.query(
    `insert into invoice_batches (label, notes, status)
     values ($1, $2, 'Active')
     returning *`,
    [label || `Invoice ${new Date().toLocaleDateString("en-US")}`, notes]
  );
  res.json({ ok: true, batch: result.rows[0] });
});

app.get("/api/batches", requireAuth, async (req, res) => {
  const status = String(req.query.status || "Active").trim();
  const params = [];
  let where = "";
  if (status && status !== "All") {
    params.push(status);
    where = "where b.status = $1";
  }
  const result = await pool.query(
    `select b.*,
      count(i.id)::int as purchase_count,
      coalesce(sum(active_items.total_paid),0)::numeric as total_paid
     from invoice_batches b
     left join invoices i on i.batch_id = b.id
     left join lateral (
       select sum(pi.quantity * pi.unit_cost)::numeric as total_paid
       from purchase_items pi
       where pi.invoice_id = i.id and pi.invoice_removed_at is null
     ) active_items on true
     ${where}
     group by b.id
     order by b.created_at desc
     limit 100`,
    params
  );
  const batches = await attachPurchases(result.rows);
  res.json({ batches });
});

app.get("/api/buyer-prices/mercury", requireAuth, async (req, res) => {
  try {
    const rows = await getMercuryPrices();
    res.json({ buyer: "Mercury", updated_at: mercuryPriceCache.fetchedAt, rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not load Mercury price sheet." });
  }
});

app.get("/api/buyer-prices/first-class", requireAuth, async (req, res) => {
  try {
    const rows = await getFirstClassPrices();
    res.json({ buyer: "First Class Medical Supply", updated_at: firstClassPriceCache.fetchedAt, rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not load First Class price sheet." });
  }
});

app.get("/api/buyer-prices/stripflips", requireAuth, async (req, res) => {
  try {
    const { buyer, rows, source_url: sourceUrl, message } = await getStripflipsPrices();
    res.json({ buyer, updated_at: stripflipsPriceCache.fetchedAt, rows, source_url: sourceUrl || "", message: message || "" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not load Stripflips price sheet." });
  }
});

app.patch("/api/batches/:id/status", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const nextStatus = String(req.body?.status || "").trim();
  const soldTo = String(req.body?.sold_to || "").trim();
  const saleNotes = String(req.body?.sale_notes || "").trim();
  const trackingNumber = String(req.body?.tracking_number || "").trim();
  const salePrice = req.body?.sale_price === undefined || req.body?.sale_price === "" ? null : Number(req.body.sale_price);
  const itemPrices = parseBuyerPdfItemPrices(req.body?.item_prices);
  const allowed = new Set(["Active", "Sold", "Shipped"]);
  if (!id) return res.status(400).json({ error: "Invoice ID is required." });
  if (!allowed.has(nextStatus)) return res.status(400).json({ error: "Choose Active, Sold, or Shipped." });
  if ((nextStatus === "Sold" || nextStatus === "Shipped") && (!soldTo || !salePrice || salePrice <= 0)) {
    return res.status(400).json({ error: "Enter who bought it and what it sold for first." });
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    if ((nextStatus === "Sold" || nextStatus === "Shipped") && Object.keys(itemPrices).length) {
      for (const [itemId, itemPrice] of Object.entries(itemPrices)) {
        await client.query(
          `update purchase_items pi
           set expected_sell_each = $1
           from invoices i
           where pi.invoice_id = i.id
             and i.batch_id = $2
             and pi.id = $3
             and pi.invoice_removed_at is null`,
          [itemPrice, id, Number(itemId)]
        );
      }
    }
    const result = await client.query(
      `update invoice_batches
       set status = $1,
         sold_to = coalesce(nullif($3,''), sold_to),
         sale_price = coalesce($4, sale_price),
         sale_notes = coalesce(nullif($5,''), sale_notes),
         tracking_number = coalesce(nullif($6,''), tracking_number),
         sold_at = case when $1 in ('Sold','Shipped') and sold_at is null then now() else sold_at end,
         status_updated_at = now(),
         shipped_at = case when $1 = 'Shipped' then now() else shipped_at end
       where id = $2
       returning *`,
      [nextStatus, id, soldTo, salePrice, saleNotes, trackingNumber]
    );
    if (!result.rows[0]) {
      await client.query("rollback");
      return res.status(404).json({ error: "Invoice not found." });
    }
    await client.query("commit");
    res.json({ ok: true, batch: result.rows[0] });
  } catch (error) {
    await client.query("rollback");
    console.error(error);
    res.status(500).json({ error: "Could not update invoice." });
  } finally {
    client.release();
  }
});

app.patch("/api/purchase-items/:id/invoice-removal", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const remove = req.body?.remove !== false;
  const reason = String(req.body?.reason || "").trim();
  if (!id) return res.status(400).json({ error: "Item ID is required." });

  const result = await pool.query(
    `update purchase_items
     set invoice_removed_at = case when $2 then now() else null end,
       invoice_removed_reason = case when $2 then coalesce(nullif($3,''), 'Removed from invoice') else '' end
     where id = $1
     returning *`,
    [id, remove, reason]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "Item not found." });
  res.json({ ok: true, item: result.rows[0] });
});

app.get("/api/batches/:id/buyer-pdf", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).send("Invoice ID is required.");
  const batchResult = await pool.query("select * from invoice_batches where id = $1", [id]);
  const batch = batchResult.rows[0];
  if (!batch) return res.status(404).send("Invoice not found.");

  const batches = await attachPurchases([batch]);
  const fullBatch = batches[0];
  const buyerPrices = await getSupplyPricesForBuyer(fullBatch.sold_to || "");
  const showPrices = String(req.query.prices || "1") !== "0";
  const overrideUnitPrice = req.query.unit_price === undefined || req.query.unit_price === "" ? null : Number(req.query.unit_price);
  const itemPrices = parseBuyerPdfItemPrices(req.query.item_prices);
  const pdf = createBuyerInvoicePdf(fullBatch, buyerPrices, {
    showPrices,
    overrideUnitPrice: overrideUnitPrice !== null && !Number.isNaN(overrideUnitPrice) && overrideUnitPrice >= 0 ? overrideUnitPrice : null,
    itemPrices,
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="buyer-invoice-${id}${showPrices ? "" : "-no-prices"}.pdf"`);
  res.send(pdf);
});

app.get("/api/hold-items/buyer-pdf", requireAuth, async (req, res) => {
  const itemIds = String(req.query.item_ids || "")
    .split(",")
    .map((id) => Number(id))
    .filter(Boolean);
  const buyer = String(req.query.buyer || "Buyer").trim();
  const itemPrices = parseBuyerPdfItemPrices(req.query.item_prices);
  if (!itemIds.length) return res.status(400).send("Choose at least one item.");

  const items = await pool.query(
    `select pi.*, i.purchase_date, c.name as customer_name, c.phone as customer_phone
     from purchase_items pi
     join invoices i on i.id = pi.invoice_id
     join customers c on c.id = i.customer_id
     where pi.id = any($1::int[])
       and pi.invoice_removed_reason = $2
     order by pi.id asc`,
    [itemIds, "No buyer right now"]
  );
  if (!items.rows.length) return res.status(404).send("No held items found.");

  const total = items.rows.reduce((sum, item) => {
    const price = Number(itemPrices[item.id] ?? item.expected_sell_each ?? 0);
    return sum + Number(item.quantity || 0) * price;
  }, 0);
  const batch = {
    id: "hold",
    label: "No Buyer Items Offer",
    status: "Offer",
    sold_to: buyer,
    sale_price: total,
    created_at: new Date().toISOString(),
    purchases: [{
      customer_name: "Held inventory",
      customer_phone: "",
      purchase_date: new Date().toISOString().slice(0, 10),
      photos: [],
      items: items.rows.map((item) => ({ ...item, invoice_removed_at: null })),
    }],
  };
  const buyerPrices = await getSupplyPricesForBuyer(buyer);
  const pdf = createBuyerInvoicePdf(batch, buyerPrices, {
    showPrices: String(req.query.prices || "1") !== "0",
    itemPrices,
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="no-buyer-items-offer.pdf"`);
  res.send(pdf);
});

app.post("/api/purchases", requireAuth, async (req, res) => {
  const body = req.body || {};
  const customerInput = body.customer || {};
  const invoiceInput = body.invoice || {};
  const items = Array.isArray(body.items) ? body.items : [];
  const batchId = Number(body.batch_id || 0) || null;

  if (!items.length) return res.status(400).json({ error: "Add at least one item." });

  const phone = normalizePhone(customerInput.phone || "");
  if (!phone) return res.status(400).json({ error: "Customer phone is required." });

  const client = await pool.connect();
  try {
    await client.query("begin");

    const customer = await upsertCustomer(client, {
      name: customerInput.name || "",
      phone,
      email: customerInput.email || "",
      address: customerInput.address || "",
      location: customerInput.location || "",
      source: customerInput.source || "",
      notes: customerInput.notes || "",
      replace_notes: false,
      crm_status: customerInput.crm_status || "Customer",
      next_follow_up_at: customerInput.next_follow_up_at || null,
    });
    const totalPaid = items.reduce(
      (sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_cost || 0),
      0
    );
    const activeBatch = batchId
      ? await findBatch(client, batchId)
      : await getOrCreateActiveBatch(client);
    if (!activeBatch) throw new Error("Invoice batch not found.");

    const invoiceResult = await client.query(
      `insert into invoices (customer_id, batch_id, purchase_date, payout_method, total_paid, notes, status)
       values ($1, $2, $3, $4, $5, $6, 'Active')
       returning *`,
      [
        customer.id,
        activeBatch.id,
        invoiceInput.purchase_date || new Date().toISOString().slice(0, 10),
        invoiceInput.payout_method || "Cash",
        totalPaid,
        invoiceInput.notes || "",
      ]
    );
    const invoice = invoiceResult.rows[0];

    for (const item of items) {
      await client.query(
        `insert into purchase_items
         (invoice_id, category, brand, model, quantity, expiration, condition, unit_cost, expected_sell_each, notes)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          invoice.id,
          item.category || "",
          item.brand || "",
          item.model || "",
          Number(item.quantity || 0),
          item.expiration || null,
          item.condition || "Sealed",
          Number(item.unit_cost || 0),
          Number(item.expected_sell_each || 0),
          item.notes || "",
        ]
      );
    }

    const photos = Array.isArray(body.photos) ? body.photos : [];
    for (const photo of photos.slice(0, 8)) {
      const dataUrl = String(photo.data_url || "");
      if (!/^data:image\/(png|jpeg|jpg|webp);base64,/.test(dataUrl)) continue;
      await client.query(
        `insert into purchase_photos (customer_id, invoice_id, batch_id, file_name, data_url, notes)
         values ($1,$2,$3,$4,$5,$6)`,
        [
          customer.id,
          invoice.id,
          activeBatch.id,
          String(photo.file_name || "product-photo").slice(0, 160),
          dataUrl,
          String(photo.notes || "").slice(0, 500),
        ]
      );
    }

    await client.query(
      `update customers
       set crm_status = 'Customer',
         next_follow_up_at = $2::date,
         updated_at = now()
       where id = $1`,
      [
        customer.id,
        addDays(invoiceInput.purchase_date || new Date().toISOString().slice(0, 10), followupDaysAfterFirstPurchase),
      ]
    );

    await client.query("commit");
    res.json({ ok: true, customer, invoice, batch: activeBatch, items_saved: items.length });
  } catch (error) {
    await client.query("rollback");
    console.error(error);
    res.status(500).json({ error: "Could not save purchase." });
  } finally {
    client.release();
  }
});

app.patch("/api/purchases/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};
  const invoiceInput = body.invoice || {};
  const items = Array.isArray(body.items) ? body.items : [];

  if (!id) return res.status(400).json({ error: "Purchase ID is required." });
  if (!items.length) return res.status(400).json({ error: "Add at least one item." });

  const totalPaid = items.reduce(
    (sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_cost || 0),
    0
  );
  const client = await pool.connect();
  try {
    await client.query("begin");

    const invoiceResult = await client.query(
      `update invoices
       set purchase_date = $2,
         payout_method = $3,
         total_paid = $4,
         notes = $5
       where id = $1
       returning *`,
      [
        id,
        invoiceInput.purchase_date || new Date().toISOString().slice(0, 10),
        invoiceInput.payout_method || "Cash",
        totalPaid,
        invoiceInput.notes || "",
      ]
    );
    const invoice = invoiceResult.rows[0];
    if (!invoice) {
      await client.query("rollback");
      return res.status(404).json({ error: "Purchase not found." });
    }

    await client.query("delete from purchase_items where invoice_id = $1", [id]);
    for (const item of items) {
      await client.query(
        `insert into purchase_items
         (invoice_id, category, brand, model, quantity, expiration, condition, unit_cost, expected_sell_each, notes)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          invoice.id,
          item.category || "",
          item.brand || "",
          item.model || "",
          Number(item.quantity || 0),
          item.expiration || null,
          item.condition || "Sealed",
          Number(item.unit_cost || 0),
          Number(item.expected_sell_each || 0),
          item.notes || "",
        ]
      );
    }

    await client.query(
      `update customers
       set updated_at = now()
       where id = $1`,
      [invoice.customer_id]
    );

    await client.query("commit");
    const updated = await getPurchaseById(id);
    res.json({ ok: true, invoice: updated });
  } catch (error) {
    await client.query("rollback");
    console.error(error);
    res.status(500).json({ error: "Could not update purchase." });
  } finally {
    client.release();
  }
});

app.post("/api/purchases/:id/photos", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const photos = Array.isArray(req.body?.photos) ? req.body.photos : [];
  if (!id) return res.status(400).json({ error: "Purchase ID is required." });
  if (!photos.length) return res.status(400).json({ error: "Choose at least one photo." });

  const invoiceResult = await pool.query("select * from invoices where id = $1", [id]);
  const invoice = invoiceResult.rows[0];
  if (!invoice) return res.status(404).json({ error: "Purchase not found." });

  let saved = 0;
  for (const photo of photos.slice(0, 8)) {
    const dataUrl = String(photo.data_url || "");
    if (!/^data:image\/(png|jpeg|jpg|webp);base64,/.test(dataUrl)) continue;
    await pool.query(
      `insert into purchase_photos (customer_id, invoice_id, batch_id, file_name, data_url, notes)
       values ($1,$2,$3,$4,$5,$6)`,
      [
        invoice.customer_id,
        invoice.id,
        invoice.batch_id,
        String(photo.file_name || "product-photo").slice(0, 160),
        dataUrl,
        String(photo.notes || "").slice(0, 500),
      ]
    );
    saved += 1;
  }

  const updated = await getPurchaseById(id);
  res.json({ ok: true, photos_saved: saved, invoice: updated });
});

app.get("/api/invoices", requireAuth, async (req, res) => {
  const status = String(req.query.status || "").trim();
  const params = [];
  let where = "";
  if (status && status !== "All") {
    params.push(status);
    where = "where i.status = $1";
  }
  const result = await pool.query(
    `select i.*, c.name as customer_name, c.phone as customer_phone, b.status as batch_status, b.label as batch_label
     from invoices i
     join customers c on c.id = i.customer_id
     left join invoice_batches b on b.id = i.batch_id
     ${where}
     order by i.purchase_date desc, i.created_at desc
     limit 100`,
    params
  );
  const invoices = await attachItems(result.rows);
  res.json({ invoices });
});

app.patch("/api/invoices/:id/status", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const nextStatus = String(req.body?.status || "").trim();
  const allowed = new Set(["Active", "Sold", "Shipped"]);
  if (!id) return res.status(400).json({ error: "Invoice ID is required." });
  if (!allowed.has(nextStatus)) return res.status(400).json({ error: "Choose Active, Sold, or Shipped." });

  const result = await pool.query(
    `update invoices
     set status = $1, status_updated_at = now()
     where id = $2
     returning *`,
    [nextStatus, id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "Invoice not found." });
  res.json({ ok: true, invoice: result.rows[0] });
});

app.listen(port, () => {
  console.log(`Diabetic Supply Buyers app running on ${port}`);
});

async function migrate() {
  await pool.query(`
    create table if not exists invoice_batches (
      id serial primary key,
      label text not null default '',
      notes text not null default '',
      status text not null default 'Active',
      sold_to text not null default '',
      sale_price numeric(12,2),
      sale_notes text not null default '',
      tracking_number text not null default '',
      sold_at timestamptz,
      status_updated_at timestamptz not null default now(),
      shipped_at timestamptz,
      created_at timestamptz not null default now()
    );

    create table if not exists customers (
      id serial primary key,
      customer_number integer unique not null,
      name text not null default '',
      phone text not null unique,
      email text not null default '',
      address text not null default '',
      location text not null default '',
      source text not null default '',
      notes text not null default '',
      crm_status text not null default 'Customer',
      next_follow_up_at date,
      last_follow_up_at date,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists buyer_contacts (
      id serial primary key,
      buyer_number integer unique not null,
      company_name text not null default '',
      contact_name text not null default '',
      email text not null default '',
      phone text not null default '',
      shipping_address text not null default '',
      price_list_url text not null default '',
      price_list_file_name text not null default '',
      price_list_data_url text not null default '',
      notes text not null default '',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists invoices (
      id serial primary key,
      customer_id integer not null references customers(id) on delete cascade,
      batch_id integer references invoice_batches(id) on delete set null,
      purchase_date date not null default current_date,
      payout_method text not null default 'Cash',
      total_paid numeric(12,2) not null default 0,
      notes text not null default '',
      status text not null default 'Active',
      status_updated_at timestamptz not null default now(),
      created_at timestamptz not null default now()
    );

    create table if not exists purchase_items (
      id serial primary key,
      invoice_id integer not null references invoices(id) on delete cascade,
      category text not null default '',
      brand text not null default '',
      model text not null default '',
      quantity integer not null default 1,
      expiration text,
      condition text not null default 'Sealed',
      unit_cost numeric(12,2) not null default 0,
      expected_sell_each numeric(12,2) not null default 0,
      notes text not null default '',
      invoice_removed_at timestamptz,
      invoice_removed_reason text not null default '',
      created_at timestamptz not null default now()
    );

    create table if not exists purchase_photos (
      id serial primary key,
      customer_id integer not null references customers(id) on delete cascade,
      invoice_id integer not null references invoices(id) on delete cascade,
      batch_id integer references invoice_batches(id) on delete set null,
      file_name text not null default '',
      data_url text not null,
      notes text not null default '',
      created_at timestamptz not null default now()
    );

    create table if not exists phone_invoices (
      id serial primary key,
      buyer text not null,
      label text not null default '',
      notes text not null default '',
      status text not null default 'Pending',
      sale_price numeric(12,2),
      sale_notes text not null default '',
      status_updated_at timestamptz not null default now(),
      shipped_at timestamptz,
      sold_at timestamptz,
      closed_at timestamptz,
      created_at timestamptz not null default now()
    );

    create table if not exists phone_purchases (
      id serial primary key,
      invoice_id integer not null references phone_invoices(id) on delete cascade,
      buyer text not null,
      purchase_date date not null default current_date,
      device_type text not null default 'Phone',
      condition_type text not null default 'Used',
      packaging text not null default '',
      grade text not null default '',
      model text not null default '',
      carrier text not null default '',
      quantity integer not null default 1,
      cost_each numeric(12,2) not null default 0,
      projected_sell_each numeric(12,2) not null default 0,
      imei text not null default '',
      photo_file_name text not null default '',
      photo_data_url text not null default '',
      notes text not null default '',
      invoice_removed_at timestamptz,
      invoice_removed_reason text not null default '',
      local_sale_price numeric,
      local_sold_at timestamptz,
      local_sale_notes text not null default '',
      gift_card_value numeric,
      gift_card_at timestamptz,
      gift_card_notes text not null default '',
      gift_card_location text not null default '',
      gift_card_number text not null default '',
      gift_card_closeout_invoice_id integer references phone_invoices(id) on delete set null,
      gift_card_photo_file_name text not null default '',
      gift_card_photo_data_url text not null default '',
      gift_card_receipt_file_name text not null default '',
      gift_card_receipt_data_url text not null default '',
      returned_at timestamptz,
      return_reason text not null default '',
      return_status text not null default 'Returned',
      invoice_item_start integer,
      invoice_added_at timestamptz not null default now(),
      created_at timestamptz not null default now()
    );

    create table if not exists phone_manual_returns (
      id serial primary key,
      buyer text not null default 'KT',
      old_invoice_label text not null default '',
      returned_at date not null default current_date,
      model text not null default '',
      carrier text not null default '',
      condition text not null default '',
      quantity integer not null default 1,
      cost_each numeric(12,2) not null default 0,
      reason text not null default '',
      notes text not null default '',
      status text not null default 'Holding',
      sale_price numeric(12,2),
      sold_at date,
      sale_notes text not null default '',
      created_at timestamptz not null default now()
    );
  `);

  await pool.query(`
    alter table customers add column if not exists address text not null default '';
    alter table customers add column if not exists customer_number integer;
    alter table customers add column if not exists location text not null default '';
    alter table customers add column if not exists source text not null default '';
    alter table customers add column if not exists crm_status text not null default 'Customer';
    alter table customers add column if not exists next_follow_up_at date;
    alter table customers add column if not exists last_follow_up_at date;
    alter table buyer_contacts add column if not exists buyer_number integer;
    alter table buyer_contacts add column if not exists company_name text not null default '';
    alter table buyer_contacts add column if not exists contact_name text not null default '';
    alter table buyer_contacts add column if not exists email text not null default '';
    alter table buyer_contacts add column if not exists phone text not null default '';
    alter table buyer_contacts add column if not exists shipping_address text not null default '';
    alter table buyer_contacts add column if not exists price_list_url text not null default '';
    alter table buyer_contacts add column if not exists price_list_file_name text not null default '';
    alter table buyer_contacts add column if not exists price_list_data_url text not null default '';
    alter table buyer_contacts add column if not exists notes text not null default '';
    alter table invoice_batches add column if not exists sold_to text not null default '';
    alter table invoice_batches add column if not exists sale_price numeric(12,2);
    alter table invoice_batches add column if not exists sale_notes text not null default '';
    alter table invoice_batches add column if not exists tracking_number text not null default '';
    alter table invoice_batches add column if not exists sold_at timestamptz;
    alter table invoice_batches add column if not exists shipped_at timestamptz;
    alter table invoices add column if not exists batch_id integer references invoice_batches(id) on delete set null;
    alter table invoices add column if not exists status text not null default 'Active';
    alter table invoices add column if not exists status_updated_at timestamptz not null default now();
    alter table purchase_items add column if not exists invoice_removed_at timestamptz;
    alter table purchase_items add column if not exists invoice_removed_reason text not null default '';
    alter table phone_purchases add column if not exists invoice_removed_at timestamptz;
    alter table phone_purchases add column if not exists invoice_removed_reason text not null default '';
    alter table phone_purchases add column if not exists imei text not null default '';
    alter table phone_purchases add column if not exists photo_file_name text not null default '';
    alter table phone_purchases add column if not exists photo_data_url text not null default '';
    alter table phone_purchases add column if not exists returned_at timestamptz;
    alter table phone_purchases add column if not exists return_reason text not null default '';
    alter table phone_purchases add column if not exists return_status text not null default 'Returned';
    alter table phone_purchases add column if not exists local_sale_price numeric;
    alter table phone_purchases add column if not exists local_sold_at timestamptz;
    alter table phone_purchases add column if not exists local_sale_notes text not null default '';
    alter table phone_purchases add column if not exists gift_card_value numeric;
    alter table phone_purchases add column if not exists gift_card_at timestamptz;
    alter table phone_purchases add column if not exists gift_card_notes text not null default '';
    alter table phone_purchases add column if not exists gift_card_location text not null default '';
    alter table phone_purchases add column if not exists gift_card_number text not null default '';
    alter table phone_purchases add column if not exists gift_card_closeout_invoice_id integer references phone_invoices(id) on delete set null;
    alter table phone_purchases add column if not exists gift_card_photo_file_name text not null default '';
    alter table phone_purchases add column if not exists gift_card_photo_data_url text not null default '';
    alter table phone_purchases add column if not exists gift_card_receipt_file_name text not null default '';
    alter table phone_purchases add column if not exists gift_card_receipt_data_url text not null default '';
    alter table phone_purchases add column if not exists invoice_item_start integer;
    alter table phone_purchases add column if not exists invoice_added_at timestamptz;
    update phone_purchases set invoice_added_at = created_at where invoice_added_at is null;
    with ordered_phone_items as (
      select id,
        1 + coalesce(sum(greatest(quantity, 1)) over (
          partition by invoice_id
          order by purchase_date asc, invoice_added_at asc, created_at asc, id asc
          rows between unbounded preceding and 1 preceding
        ), 0)::integer as item_start
      from phone_purchases
      where invoice_item_start is null or invoice_item_start < 1
    )
    update phone_purchases pp
       set invoice_item_start = ordered_phone_items.item_start
      from ordered_phone_items
     where pp.id = ordered_phone_items.id;
    alter table phone_purchases alter column invoice_added_at set default now();
    alter table phone_purchases alter column invoice_added_at set not null;
    alter table phone_manual_returns add column if not exists status text not null default 'Holding';
    alter table phone_manual_returns add column if not exists sale_price numeric(12,2);
    alter table phone_manual_returns add column if not exists sold_at date;
    alter table phone_manual_returns add column if not exists sale_notes text not null default '';
    alter table phone_invoices add column if not exists sale_price numeric(12,2);
    alter table phone_invoices add column if not exists sale_notes text not null default '';
    alter table phone_invoices add column if not exists status_updated_at timestamptz not null default now();
    alter table phone_invoices add column if not exists shipped_at timestamptz;
    alter table phone_invoices add column if not exists sold_at timestamptz;
    alter table phone_invoices add column if not exists closed_at timestamptz;
    update invoices set status = 'Active' where status is null or status = '';
  `);

  await pool.query(`
    insert into invoice_batches (label, status)
    select 'Open Invoice', 'Active'
    where not exists (select 1 from invoice_batches);

    update invoices
    set batch_id = (select id from invoice_batches order by id asc limit 1)
    where batch_id is null;

    update customers c
    set next_follow_up_at = latest.last_purchase_date + ${followupDaysAfterFirstPurchase},
      updated_at = now()
    from (
      select customer_id, max(purchase_date)::date as last_purchase_date
      from invoices
      group by customer_id
    ) latest
    where c.id = latest.customer_id
      and c.next_follow_up_at is null;

    with numbered as (
      select id,
        row_number() over (order by created_at asc, id asc)::int + coalesce((select max(customer_number) from customers), 0) as next_number
      from customers
      where customer_number is null
    )
    update customers c
    set customer_number = numbered.next_number
    from numbered
    where c.id = numbered.id;

    create unique index if not exists customers_customer_number_idx on customers(customer_number);
    alter table customers alter column customer_number set not null;
    update buyer_contacts b
    set buyer_number = numbered.next_number
    from (
      select id,
        row_number() over (order by created_at asc, id asc)::int + coalesce((select max(buyer_number) from buyer_contacts), 0) as next_number
      from buyer_contacts
      where buyer_number is null
    ) numbered
    where b.id = numbered.id;
    create unique index if not exists buyer_contacts_buyer_number_idx on buyer_contacts(buyer_number);
    alter table buyer_contacts alter column buyer_number set not null;
  `);
}

async function upsertCustomer(client, customer) {
  const result = await client.query(
    `insert into customers (customer_number, name, phone, email, address, location, source, notes, crm_status, next_follow_up_at)
     values ((select coalesce(max(customer_number),0) + 1 from customers), $1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (phone) do update set
       name = coalesce(nullif(excluded.name,''), customers.name),
       email = coalesce(nullif(excluded.email,''), customers.email),
       address = coalesce(nullif(excluded.address,''), customers.address),
       location = coalesce(nullif(excluded.location,''), customers.location),
       source = coalesce(nullif(excluded.source,''), customers.source),
       crm_status = coalesce(nullif(excluded.crm_status,''), customers.crm_status),
       next_follow_up_at = coalesce(excluded.next_follow_up_at, customers.next_follow_up_at),
       notes = case
         when $10 then excluded.notes
         when excluded.notes = '' then customers.notes
         when customers.notes = '' then excluded.notes
         else customers.notes || E'\\n' || excluded.notes
       end,
       updated_at = now()
     returning *`,
    [
      customer.name,
      customer.phone,
      customer.email,
      customer.address,
      customer.location,
      customer.source,
      customer.notes,
      customer.crm_status,
      customer.next_follow_up_at,
      customer.replace_notes === true,
    ]
  );
  return result.rows[0];
}

async function findCustomerByPhone(phone) {
  const result = await pool.query("select * from customers where phone = $1", [phone]);
  return result.rows[0] || null;
}

async function findBatch(client, batchId) {
  const result = await client.query("select * from invoice_batches where id = $1", [batchId]);
  return result.rows[0] || null;
}

async function findPhoneInvoice(client, invoiceId, buyer) {
  const result = await client.query(
    "select * from phone_invoices where id = $1 and buyer = $2 and status = 'Pending'",
    [invoiceId, buyer]
  );
  return result.rows[0] || null;
}

async function findAnyPhoneInvoice(client, invoiceId, buyer) {
  const result = await client.query(
    "select * from phone_invoices where id = $1 and buyer = $2",
    [invoiceId, buyer]
  );
  return result.rows[0] || null;
}

async function getOrCreatePendingPhoneInvoice(client, buyer) {
  const existing = await client.query(
    "select * from phone_invoices where buyer = $1 and status = 'Pending' order by created_at desc limit 1",
    [buyer]
  );
  if (existing.rows[0]) return existing.rows[0];
  const created = await client.query(
    `insert into phone_invoices (buyer, label, status)
     values ($1, $2, 'Pending')
     returning *`,
    [buyer, defaultPhoneInvoiceLabel(buyer)]
  );
  return created.rows[0];
}

async function getOrCreateWeeklyGiftCardInvoice(client, giftCardAt) {
  const weekEnding = giftCardWeekEndingDate(giftCardAt);
  const label = `Gift Cards Week Ending ${weekEnding}`;
  const existing = await client.query(
    "select * from phone_invoices where buyer = 'Apple GC' and label = $1 order by id asc limit 1",
    [label]
  );
  if (existing.rows[0]) return existing.rows[0];
  const created = await client.query(
    `insert into phone_invoices (buyer, label, notes, status, status_updated_at, closed_at)
     values ('Apple GC', $1, $2, 'Closed', now(), $3::date)
     returning *`,
    [label, `Weekly Apple gift card closeout ending ${weekEnding}`, weekEnding]
  );
  return created.rows[0];
}

function giftCardWeekEndingDate(value) {
  const text = String(value || "");
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const date = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + ((7 - date.getDay()) % 7));
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localDateInTimeZone(timeZone = "America/New_York") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function getOrCreateActiveBatch(client) {
  const existing = await client.query(
    "select * from invoice_batches where status = 'Active' order by created_at desc limit 1"
  );
  if (existing.rows[0]) return existing.rows[0];
  const created = await client.query(
    `insert into invoice_batches (label, status) values ($1, 'Active') returning *`,
    [`Invoice ${new Date().toLocaleDateString("en-US")}`]
  );
  return created.rows[0];
}

async function getCustomerHistory(customerId) {
  const invoices = await pool.query(
    `select i.*, b.status as batch_status, b.label as batch_label, b.id as batch_id
     from invoices i
     left join invoice_batches b on b.id = i.batch_id
     where i.customer_id = $1
     order by i.purchase_date desc, i.created_at desc`,
    [customerId]
  );
  const invoiceIds = invoices.rows.map((invoice) => invoice.id);
  if (!invoiceIds.length) return [];
  const items = await pool.query(
    `select * from purchase_items where invoice_id = any($1::int[]) order by id asc`,
    [invoiceIds]
  );
  const photos = await pool.query(
    `select id, invoice_id, file_name, data_url, notes, created_at from purchase_photos where invoice_id = any($1::int[]) order by created_at desc`,
    [invoiceIds]
  );
  return invoices.rows.map((invoice) => ({
    ...invoice,
    items: items.rows.filter((item) => item.invoice_id === invoice.id),
    photos: photos.rows.filter((photo) => photo.invoice_id === invoice.id),
  }));
}

async function getPurchaseById(id) {
  const result = await pool.query(
    `select i.*, b.status as batch_status, b.label as batch_label, b.id as batch_id
     from invoices i
     left join invoice_batches b on b.id = i.batch_id
     where i.id = $1`,
    [id]
  );
  const invoices = await attachItems(result.rows);
  return invoices[0] || null;
}

async function attachPurchases(batches) {
  const batchIds = batches.map((batch) => batch.id);
  if (!batchIds.length) return [];
  const purchases = await pool.query(
    `select i.*, c.name as customer_name, c.phone as customer_phone
     from invoices i
     join customers c on c.id = i.customer_id
     where i.batch_id = any($1::int[])
     order by i.purchase_date desc, i.created_at desc`,
    [batchIds]
  );
  const purchasesWithItems = await attachItems(purchases.rows);
  return batches.map((batch) => ({
    ...batch,
    purchases: purchasesWithItems.filter((purchase) => purchase.batch_id === batch.id),
  }));
}

async function attachItems(invoices) {
  const invoiceIds = invoices.map((invoice) => invoice.id);
  if (!invoiceIds.length) return [];
  const items = await pool.query(
    `select * from purchase_items where invoice_id = any($1::int[]) order by id asc`,
    [invoiceIds]
  );
  const photos = await pool.query(
    `select id, invoice_id, file_name, data_url, notes, created_at from purchase_photos where invoice_id = any($1::int[]) order by created_at desc`,
    [invoiceIds]
  );
  return invoices.map((invoice) => ({
    ...invoice,
    items: items.rows.filter((item) => item.invoice_id === invoice.id),
    photos: photos.rows.filter((photo) => photo.invoice_id === invoice.id),
  }));
}

async function attachPhonePurchases(invoices) {
  const invoiceIds = invoices.map((invoice) => invoice.id);
  if (!invoiceIds.length) return [];
  const purchases = await pool.query(
    `select * from phone_purchases
     where invoice_id = any($1::int[])
       and invoice_removed_at is null
     order by purchase_date desc, created_at desc`,
    [invoiceIds]
  );
  const returns = await pool.query(
    `select * from phone_purchases
     where invoice_id = any($1::int[])
       and returned_at is not null
     order by returned_at desc, created_at desc`,
    [invoiceIds]
  );
  const localSold = await pool.query(
    `select * from phone_purchases
     where invoice_id = any($1::int[])
       and invoice_removed_at is not null
       and returned_at is null
       and (local_sold_at is not null or invoice_removed_reason ilike 'Sold locally%')
     order by coalesce(local_sold_at, invoice_removed_at) desc, created_at desc`,
    [invoiceIds]
  );
  const giftCards = await pool.query(
    `select * from phone_purchases
     where invoice_id = any($1::int[])
       and invoice_removed_at is not null
       and returned_at is null
       and gift_card_at is not null
     order by gift_card_at desc, created_at desc`,
    [invoiceIds]
  );
  return invoices.map((invoice) => ({
    ...invoice,
    purchases: sortPhonePurchases(purchases.rows.filter((purchase) => purchase.invoice_id === invoice.id)),
    returns: sortPhonePurchases(returns.rows.filter((purchase) => purchase.invoice_id === invoice.id)),
    local_sold: localSold.rows.filter((purchase) => purchase.invoice_id === invoice.id),
    gift_cards: giftCards.rows.filter((purchase) => purchase.invoice_id === invoice.id),
  }));
}

function sortPhonePurchases(purchases) {
  return [...purchases].sort((a, b) => {
    const dateCompare = new Date(a.purchase_date || a.invoice_added_at || a.created_at || 0)
      - new Date(b.purchase_date || b.invoice_added_at || b.created_at || 0);
    if (dateCompare !== 0) return dateCompare;
    const addedCompare = new Date(a.invoice_added_at || a.created_at || 0)
      - new Date(b.invoice_added_at || b.created_at || 0);
    if (addedCompare !== 0) return addedCompare;
    return Number(a.id || 0) - Number(b.id || 0);
  });
}

async function nextPhoneInvoiceItemStart(client, invoiceId) {
  const result = await client.query(
    `select coalesce(max(coalesce(invoice_item_start, 1) + greatest(quantity, 1)), 1)::integer as next_item
       from phone_purchases
      where invoice_id = $1`,
    [invoiceId]
  );
  return Number(result.rows[0]?.next_item || 1);
}

function phoneModelSortValue(model) {
  const text = String(model || "");
  const iphoneNumber = Number(text.match(/iPhone\s+(\d+)/i)?.[1] || text.match(/^(\d+)\b/)?.[1] || 0);
  if (iphoneNumber) {
    const pro = /pro/i.test(text) ? 10 : 0;
    const max = /max/i.test(text) ? 5 : 0;
    const air = /air/i.test(text) ? 3 : 0;
    const plus = /plus/i.test(text) ? 2 : 0;
    const e = /\b\d+e\b/i.test(text) ? -1 : 0;
    const storage = Number(text.match(/(\d+)\s*TB/i)?.[1] || 0) * 1000
      || Number(text.match(/(\d+)\s*GB/i)?.[1] || 0);
    return iphoneNumber * 100000 + (pro + max + air + plus + e) * 1000 + storage;
  }
  const galaxyNumber = Number(text.match(/\bS(\d+)/i)?.[1] || 0);
  if (galaxyNumber) {
    const ultra = /ultra/i.test(text) ? 10 : 0;
    const plus = /plus|\+/i.test(text) ? 5 : 0;
    const storage = Number(text.match(/(\d+)\s*TB/i)?.[1] || 0) * 1000
      || Number(text.match(/(\d+)\s*GB/i)?.[1] || 0);
    return galaxyNumber * 100000 + (ultra + plus) * 1000 + storage;
  }
  return 0;
}

function phoneConditionRank(purchase) {
  if (purchase.condition_type === "New") return 0;
  if (purchase.condition_type === "Used") return 1;
  return 2;
}

async function seedGoogleDrivePhoneInvoices() {
  const seeds = getPhoneInvoiceSeeds();
  if (!seeds.length) return;
  let atlasRows = [];
  let ktRows = [];
  try {
    atlasRows = await getAtlasPrices();
    ktRows = await getKtPrices();
  } catch (error) {
    console.warn("Could not load phone prices for seeded phone invoices.", error.message);
  }
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const seed of seeds) {
      const existing = await client.query(
        "select id from phone_invoices where buyer = $1 and label = $2 limit 1",
        [seed.buyer, seed.label]
      );
      if (existing.rows[0]) continue;
      const invoiceResult = await client.query(
        `insert into phone_invoices (buyer, label, notes, status, created_at)
         values ($1, $2, $3, 'Pending', now())
         returning *`,
        [seed.buyer, seed.label, "Imported from Google Drive PhoneInvoice sheet"]
      );
      const invoice = invoiceResult.rows[0];
      for (const row of seed.rows) {
        const normalized = normalizeSeedPhonePurchase(row, seed.buyer);
        const projected = findPhonePrice(normalized, seed.buyer === "KT" ? ktRows : atlasRows, seed.buyer);
        await client.query(
          `insert into phone_purchases
           (invoice_id, buyer, purchase_date, device_type, condition_type, packaging, grade, model, carrier, quantity, cost_each, projected_sell_each, notes)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            invoice.id,
            seed.buyer,
            normalized.purchase_date,
            normalized.device_type,
            normalized.condition_type,
            normalized.packaging,
            normalized.grade,
            normalized.model,
            normalized.carrier,
            normalized.quantity,
            normalized.cost_each,
            projected,
            normalized.notes,
          ]
        );
      }
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    console.error("Could not seed Google Drive phone invoices.", error);
  } finally {
    client.release();
  }
}

function normalizeSeedPhonePurchase(row, buyer = "") {
  const rawModel = String(row.model || "").trim();
  const model = normalizeSeedModel(rawModel, row.storage);
  const conditionText = String(row.condition || row.notes || "").trim();
  const isNew = /new/i.test(conditionText);
  const grade = isNew ? "" : extractSeedGrade(row.notes, conditionText, buyer, row.item);
  return {
    purchase_date: row.date || new Date().toISOString().slice(0, 10),
    device_type: /ipad/i.test(model) ? "Tablet" : "Phone",
    condition_type: isNew ? "New" : "Used",
    packaging: isNew ? "Sealed" : "",
    grade,
    model,
    carrier: normalizeSeedCarrier(row.carrier),
    quantity: Number(row.qty || 1),
    cost_each: parseSeedMoney(row.unit_cost),
    notes: [row.seller ? `Seller: ${row.seller}` : "", row.notes || "", row.item ? `Item #${row.item}` : ""].filter(Boolean).join(" | "),
  };
}

function normalizeSeedModel(model, storage) {
  const cleanModel = String(model || "").replace(/\s+\d+\s*(GB|TB)\b/i, "").trim();
  const cleanStorage = String(storage || "").trim();
  const appleModel = /^(iphone|ipad)/i.test(cleanModel) ? cleanModel : /^\d/.test(cleanModel) ? `iPhone ${cleanModel}` : cleanModel;
  return [appleModel, cleanStorage && !/n\/a|unknown/i.test(cleanStorage) ? cleanStorage : ""].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function normalizeSeedCarrier(carrier) {
  const text = String(carrier || "").trim();
  if (/at&t/i.test(text)) return "AT&T (Clean)";
  if (/unlocked/i.test(text)) return "Unlocked";
  if (/locked/i.test(text)) return "Carrier Locked";
  return text;
}

function extractSeedGrade(notes, condition, buyer = "", item = "") {
  const text = `${notes || ""} ${condition || ""}`;
  if (buyer === "Atlas") return isAtlasPartsSeedItem(item, notes) ? "Parts" : "Grade A";
  const grade = text.match(/Grade\s*([ABCD])/i);
  if (grade) return `Grade ${grade[1].toUpperCase()}`;
  if (/parts/i.test(text)) return "Parts";
  return "Grade B";
}

function parseSeedMoney(value) {
  return Number(String(value || "").replace(/[$,\s]/g, "")) || 0;
}

function isAllowedPhotoDataUrl(value) {
  return /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(String(value || ""));
}

function isAllowedDocumentDataUrl(value) {
  return /^data:(application\/pdf|text\/csv|application\/vnd\.ms-excel|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|image\/(?:png|jpeg|jpg|webp));base64,/i.test(String(value || ""));
}

function findPhonePrice(purchase, priceRows, buyer) {
  const parsed = parseDeviceModel(purchase.model);
  const wantedCondition = normalizeAtlasLookupCondition(
    purchase.condition_type === "New" ? purchase.packaging : phoneLookupGrade(purchase, buyer),
    purchase.condition_type
  );
  const modelText = normalizePhonePriceMatchText(parsed.baseModel || purchase.model);
  const storage = String(parsed.storage || "").toLowerCase();
  const carrier = /ipad/i.test(purchase.model || "") && /wifi/i.test(purchase.model || "")
    ? "WiFi"
    : normalizeSeedCarrier(purchase.carrier);
  const candidates = priceRows.filter((row) => {
    if (buyer && row.buyer && row.buyer !== buyer) return false;
    if (row.device_type !== purchase.device_type) return false;
    if (row.condition_type !== purchase.condition_type) return false;
    if (wantedCondition === "Grade A" && /hso|swap/i.test(row.condition || "")) return false;
    if (wantedCondition && row.condition !== wantedCondition) return false;
    if (storage && String(row.storage || "").toLowerCase() !== storage) return false;
    const rowModel = normalizePhonePriceMatchText(row.base_model || row.model);
    if (modelText && rowModel !== modelText) return false;
    if (carrier === "WiFi") return row.carrier === "WiFi" || row.carrier === "Any";
    if (carrier === "Unlocked") return row.carrier === "Unlocked";
    if (carrier === "Carrier Locked") return row.carrier === "Carrier Locked";
    if (carrier === "AT&T (Clean)") return row.carrier === "AT&T (Clean)";
    return true;
  });
  const looserCandidates = candidates.length ? candidates : priceRows.filter((row) => {
    if (buyer && row.buyer && row.buyer !== buyer) return false;
    if (row.condition_type !== purchase.condition_type) return false;
    if (wantedCondition === "Grade A" && /hso|swap/i.test(row.condition || "")) return false;
    if (wantedCondition && row.condition !== wantedCondition) return false;
    if (storage && String(row.storage || "").toLowerCase() !== storage) return false;
    if (carrier && row.carrier && row.carrier !== "Any" && row.carrier !== carrier) return false;
    return normalizePhonePriceMatchText(row.base_model || row.model) === modelText;
  });
  return adjustedPhonePrice(purchase, looserCandidates[0], buyer);
}

function adjustedPhonePrice(purchase, row, buyer) {
  const basePrice = Number(row?.price || 0);
  if (!basePrice) return 0;
  const notes = String(purchase.notes || "");
  if (buyer === "KT" && /cracked?\s+back|back\s+crack|back\s+glass/i.test(notes)) {
    const deduction = ktCrackedBackDeduction(row.base_model || purchase.model);
    return Math.max(0, basePrice - deduction);
  }
  if (buyer === "Atlas") {
    const deduction = atlasPhoneDeductions(purchase, row);
    return Math.max(0, basePrice - deduction);
  }
  return basePrice;
}

function atlasPhoneDeductions(purchase, row) {
  const notes = String(purchase.notes || "");
  const model = row.base_model || purchase.model;
  let amount = 0;
  if (/atlas cracked back|cracked?\s+back|back\s+crack|back\s+glass/i.test(notes)) amount += atlasCrackedBackDeduction(model);
  if (/atlas cracked lens/i.test(notes)) amount += atlasCrackedLensDeduction(model);
  return amount;
}

function atlasCrackedBackDeduction(model) {
  const text = String(model || "").toLowerCase();
  if (/15 pro max/.test(text)) return 90;
  if (/14 pro max/.test(text)) return 80;
  if (/14 pro/.test(text)) return 50;
  if (/14 plus/.test(text)) return 50;
  if (/\b14\b/.test(text)) return 70;
  if (/16 pro max/.test(text)) return 120;
  if (/16 plus/.test(text)) return 70;
  if (/\b16e\b/.test(text)) return 100;
  if (/\b16\b/.test(text)) return 60;
  if (/17 pro max/.test(text)) return 160;
  if (/17 pro/.test(text)) return 140;
  if (/17 air/.test(text)) return 100;
  if (/\b17\b/.test(text)) return 100;
  if (/15 pro/.test(text)) return 60;
  if (/15 plus/.test(text)) return 60;
  if (/\b15\b/.test(text)) return 90;
  if (/13 pro max/.test(text)) return 60;
  return 0;
}

function atlasCrackedLensDeduction(model) {
  const text = String(model || "").toLowerCase();
  if (/15 pro max/.test(text)) return 70;
  if (/14 pro max/.test(text)) return 50;
  return 0;
}

function ktCrackedBackDeduction(model) {
  const text = String(model || "").toLowerCase();
  if (/17 pro max/.test(text)) return 180;
  if (/17 pro/.test(text)) return 140;
  if (/\b17e\b/.test(text) || /\b17\b/.test(text)) return 200;
  if (/16 pro max/.test(text)) return 120;
  if (/16 pro/.test(text)) return 120;
  if (/16 plus/.test(text)) return 60;
  if (/\b16\b/.test(text)) return 60;
  if (/15 pro max/.test(text)) return 80;
  if (/15 pro/.test(text)) return 70;
  if (/15 plus/.test(text)) return 70;
  if (/\b15\b/.test(text)) return 40;
  if (/14 pro max/.test(text)) return 50;
  if (/14 pro/.test(text)) return 50;
  if (/14 plus/.test(text)) return 50;
  if (/\b14\b/.test(text)) return 60;
  if (/13 pro max/.test(text)) return 50;
  if (/13 pro/.test(text)) return 50;
  if (/\b13\b/.test(text)) return 50;
  return 0;
}

async function backfillPhoneProjectedPrices() {
  let atlasRows = [];
  let ktRows = [];
  try {
    atlasRows = await getAtlasPrices();
    ktRows = await getKtPrices();
  } catch (error) {
    console.warn("Could not load phone prices for projected price backfill.", error.message);
    return;
  }
  const result = await pool.query(
    `select * from phone_purchases
     where projected_sell_each = 0
       or notes like '%Item #%'
       or buyer in ('KT', 'Atlas')
     order by id asc
     limit 5000`
  );
  for (const purchase of result.rows) {
    const correctedPurchase = correctAtlasImportedPurchase(purchase);
    const overridePrice = atlasImportedProjectedOverride(correctedPurchase);
    const projected = overridePrice || findPhonePrice(correctedPurchase, correctedPurchase.buyer === "KT" ? ktRows : atlasRows, correctedPurchase.buyer);
    if (!projected) continue;
    await pool.query(
      "update phone_purchases set projected_sell_each = $1, grade = $2, carrier = $3 where id = $4",
      [projected, correctedPurchase.grade, correctedPurchase.carrier, purchase.id]
    );
  }
}

function startAtlasDailyRefreshJob() {
  let lastRunDate = "";
  setInterval(async () => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).formatToParts(new Date()).map((part) => [part.type, part.value])
    );
    const today = `${parts.year}-${parts.month}-${parts.day}`;
    if (parts.hour !== "13" || Number(parts.minute) > 5 || lastRunDate === today) return;
    lastRunDate = today;
    try {
      atlasPriceCache = { fetchedAt: 0, rows: [] };
      await getAtlasPrices();
      await backfillPhoneProjectedPrices();
      console.log("Daily Atlas phone prices refreshed and invoices recalculated.");
    } catch (error) {
      console.error("Daily Atlas phone price refresh failed.", error);
    }
  }, 60 * 1000);
}

function phoneLookupGrade(purchase, buyer) {
  return purchase.grade;
}

function correctAtlasImportedPurchase(purchase) {
  if (purchase.buyer !== "Atlas" || purchase.condition_type !== "Used" || !/Item #/i.test(purchase.notes || "")) {
    return purchase;
  }
  const itemNumber = atlasSeedItemNumber("", purchase.notes);
  return {
    ...purchase,
    grade: atlasSeedGradeForItem(itemNumber, purchase.notes),
    carrier: atlasSeedCarrierForItem(itemNumber) || purchase.carrier,
  };
}

function atlasImportedProjectedOverride(purchase) {
  if (purchase.buyer !== "Atlas" || purchase.condition_type !== "Used") return 0;
  const itemNumber = atlasSeedItemNumber("", purchase.notes);
  const prices = new Map([
    ["68", 165],
    ["69", 150],
    ["70", 220],
    ["72", 150],
    ["98", 360],
  ]);
  return prices.get(itemNumber) || 0;
}

function atlasSeedGradeForItem(item, notes = "") {
  const itemNumber = atlasSeedItemNumber(item, notes);
  if (itemNumber === "98") return "Grade B - Cracked Back";
  return isAtlasPartsSeedItem(itemNumber, notes) ? "Parts" : "Grade A";
}

function isAtlasPartsSeedItem(item, notes = "") {
  const partsItems = new Set(["68", "69", "70", "72"]);
  const itemNumber = atlasSeedItemNumber(item, notes);
  if (itemNumber) return partsItems.has(itemNumber);
  return /\bParts\b/i.test(String(notes || ""));
}

function atlasSeedItemNumber(item, notes = "") {
  return String(item || "").trim() || String(notes || "").match(/Item\s*#\s*(\d+)/i)?.[1] || "";
}

function atlasSeedCarrierForItem(item) {
  const carriers = new Map([
    ["68", "Parts"],
    ["69", "Parts"],
    ["70", "Parts"],
    ["71", "Carrier Locked"],
    ["72", "Parts"],
    ["73", "Carrier Locked"],
    ["74", "Carrier Locked"],
    ["75", "Unlocked"],
    ["96", "Carrier Locked"],
    ["97", "Carrier Locked"],
    ["98", "Unlocked"],
  ]);
  return carriers.get(String(item || "").trim()) || "";
}

function getPhoneInvoiceSeeds() {
  return [
    {
      buyer: "KT",
      label: "KT 2026-06-18",
      rows: [
        { date: "2026-06-18", item: "76", qty: 1, model: "17", storage: "256GB", condition: "New", carrier: "Locked", unit_cost: "$435.00", seller: "Mike", notes: "Color Lavender" },
        { date: "2026-06-18", item: "77", qty: 1, model: "17", storage: "256GB", condition: "New", carrier: "Locked", unit_cost: "$435.00", seller: "Mike", notes: "Color Black" },
        { date: "2026-06-16", item: "78", qty: 1, model: "16 Pro", storage: "256GB", condition: "Used", carrier: "Locked", unit_cost: "$320.00", seller: "Unknown", notes: "Grade B" },
        { date: "2026-06-13", item: "79", qty: 1, model: "17 Pro Max", storage: "512GB", condition: "Used", carrier: "Locked", unit_cost: "$683.00", seller: "Facebook", notes: "Grade A" },
        { date: "2026-06-18", item: "80", qty: 1, model: "17", storage: "256GB", condition: "Used", carrier: "Locked", unit_cost: "$350.00", seller: "Unknown", notes: "Grade B" },
        { date: "2026-06-18", item: "81", qty: 1, model: "17", storage: "256GB", condition: "Used", carrier: "Locked", unit_cost: "$350.00", seller: "Unknown", notes: "Grade B" },
        { date: "2026-06-18", item: "82", qty: 1, model: "16", storage: "128GB", condition: "Used", carrier: "Locked", unit_cost: "$220.00", seller: "Facebook", notes: "Grade B" },
        { date: "2026-06-18", item: "83", qty: 1, model: "14 Pro Max", storage: "256GB", condition: "Used", carrier: "Locked", unit_cost: "$200.00", seller: "Facebook", notes: "Grade B" },
        { date: "2026-06-18", item: "84", qty: 1, model: "14 Pro", storage: "256GB", condition: "Used", carrier: "Unlocked", unit_cost: "$220.00", seller: "Unknown", notes: "Grade B" },
        { date: "2026-06-20", item: "85", qty: 1, model: "17 Pro Max", storage: "256GB", condition: "New", carrier: "Locked", unit_cost: "$700.00", seller: "Unknown", notes: "" },
        { date: "2026-06-20", item: "86", qty: 1, model: "17 Pro Max", storage: "256GB", condition: "Used", carrier: "Locked", unit_cost: "$670.00", seller: "Unknown", notes: "Grade B" },
        { date: "2026-06-23", item: "87", qty: 1, model: "S26 Ultra", storage: "256GB", condition: "Used", carrier: "Locked", unit_cost: "$450.00", seller: "Unknown", notes: "Grade B" },
        { date: "2026-06-23", item: "88", qty: 1, model: "17 Pro Max", storage: "256GB", condition: "New", carrier: "Locked", unit_cost: "$770.00", seller: "King", notes: "Color Silver" },
        { date: "2026-06-23", item: "89", qty: 1, model: "17 Pro Max 256gb", storage: "256GB", condition: "New", carrier: "Locked", unit_cost: "$770.00", seller: "King", notes: "Color Orange" },
        { date: "2026-06-24", item: "90", qty: 1, model: "S26 Ultra", storage: "256GB", condition: "", carrier: "Locked", unit_cost: "$500.00", seller: "Mike", notes: "Grade A" },
        { date: "2026-06-24", item: "91", qty: 1, model: "15", storage: "128GB", condition: "", carrier: "Unlocked", unit_cost: "$220.00", seller: "Chris", notes: "Grade B" },
        { date: "2026-06-24", item: "92", qty: 1, model: "17 Air", storage: "256GB", condition: "", carrier: "Unlocked", unit_cost: "$425.00", seller: "Unknown", notes: "Grade B" },
        { date: "2026-06-25", item: "93", qty: 1, model: "iPad Pro 13 Inch Wifi", storage: "256GB", condition: "New", carrier: "Facebook", unit_cost: "$800.00", seller: "Unknown", notes: "" },
        { date: "2026-06-25", item: "94", qty: 1, model: "S25 Ultra", storage: "256GB", condition: "Used", carrier: "Facebook", unit_cost: "$275.00", seller: "Unknown", notes: "Grade B" },
        { date: "2026-06-26", item: "95", qty: 1, model: "17 Pro Max", storage: "256GB", condition: "", carrier: "Locked", unit_cost: "$680.00", seller: "Chris", notes: "Grade A" },
        { date: "2026-06-26", item: "99", qty: 1, model: "Google Pixel 10 Pro", storage: "Unknown", condition: "New", carrier: "Locked", unit_cost: "$180.00", seller: "Mike", notes: "" },
        { date: "2026-06-26", item: "100", qty: 1, model: "17 Pro Max", storage: "256GB", condition: "New", carrier: "Locked", unit_cost: "$730.00", seller: "Unknown", notes: "Color Orange" },
        { date: "2026-06-27", item: "101", qty: 1, model: "17 256gb", storage: "256GB", condition: "New", carrier: "Unlocked", unit_cost: "$610.00", seller: "Mike", notes: "" },
        { date: "2026-06-27", item: "102", qty: 1, model: "17 256gb", storage: "256GB", condition: "New", carrier: "Unlocked", unit_cost: "$610.00", seller: "Mike", notes: "" },
        { date: "2026-06-27", item: "103", qty: 1, model: "S26", storage: "256GB", condition: "New", carrier: "Locked", unit_cost: "$250.00", seller: "Mike", notes: "" },
        { date: "2026-06-27", item: "104", qty: 1, model: "17 Pro Max", storage: "256GB", condition: "", carrier: "Unlocked", unit_cost: "$780.00", seller: "Unknown", notes: "Grade B" },
        { date: "2026-06-27", item: "105", qty: 1, model: "16 Pro Max", storage: "256GB", condition: "", carrier: "Unlocked", unit_cost: "$560.00", seller: "Unknown", notes: "Grade B" },
      ],
    },
    {
      buyer: "Atlas",
      label: "Atlas 2026-06-13",
      rows: [
        { date: "2026-06-13", item: "68", qty: 1, model: "14 Pro Max", storage: "N/A", condition: "Parts", carrier: "Parts", unit_cost: "$130.00", seller: "Chris", notes: "Grade AB | Parts" },
        { date: "2026-06-13", item: "69", qty: 1, model: "16", storage: "N/A", condition: "Parts", carrier: "Parts", unit_cost: "$100.00", seller: "Chris", notes: "Grade AB | Parts" },
        { date: "2026-06-13", item: "70", qty: 1, model: "16 Pro", storage: "N/A", condition: "Parts", carrier: "Parts", unit_cost: "$100.00", seller: "Facebook", notes: "Grade AB | Parts" },
        { date: "2026-06-23", item: "71", qty: 1, model: "16 Pro Max", storage: "N/A", condition: "Parts", carrier: "Locked", unit_cost: "$350.00", seller: "Facebook", notes: "Grade A" },
        { date: "2026-06-23", item: "72", qty: 1, model: "16", storage: "N/A", condition: "Parts", carrier: "Parts", unit_cost: "$110.00", seller: "Mike", notes: "Grade AB | Parts" },
        { date: "2026-06-25", item: "73", qty: 1, model: "16 Pro", storage: "N/A", condition: "Parts", carrier: "Locked", unit_cost: "$275.00", seller: "Facebook", notes: "Grade A" },
        { date: "2026-06-25", item: "74", qty: 1, model: "16 Pro", storage: "N/A", condition: "Parts", carrier: "Locked", unit_cost: "$275.00", seller: "Facebook", notes: "Grade A" },
        { date: "2026-06-25", item: "75", qty: 1, model: "14 Pro Max", storage: "N/A", condition: "Parts", carrier: "Unlocked", unit_cost: "$250.00", seller: "Facebook", notes: "Grade A" },
        { date: "2026-06-26", item: "96", qty: 1, model: "16e", storage: "N/A", condition: "Parts", carrier: "Locked", unit_cost: "$100.00", seller: "Instagram", notes: "Grade A" },
        { date: "2026-06-26", item: "97", qty: 1, model: "14", storage: "N/A", condition: "Parts", carrier: "Locked", unit_cost: "$75.00", seller: "Instagram", notes: "Grade A" },
        { date: "2026-06-26", item: "98", qty: 1, model: "15 Pro Max", storage: "N/A", condition: "Parts", carrier: "Unlocked", unit_cost: "$250.00", seller: "Facebook", notes: "Grade B - Cracked Back" },
      ],
    },
  ];
}

async function getMercuryPrices() {
  const cacheMs = 1000 * 60 * 10;
  if (mercuryPriceCache.rows.length && Date.now() - mercuryPriceCache.fetchedAt < cacheMs) {
    return mercuryPriceCache.rows;
  }
  const response = await fetch(mercuryPriceSheetCsvUrl);
  if (!response.ok) throw new Error(`Mercury price sheet returned ${response.status}`);
  const csv = await response.text();
  const rows = parseMercuryPriceCsv(csv);
  mercuryPriceCache = { fetchedAt: Date.now(), rows };
  return rows;
}

async function getFirstClassPrices() {
  const cacheMs = 1000 * 60 * 10;
  if (firstClassPriceCache.rows.length && Date.now() - firstClassPriceCache.fetchedAt < cacheMs) {
    return firstClassPriceCache.rows;
  }
  const response = await fetch(firstClassPriceSheetCsvUrl);
  if (!response.ok) throw new Error(`First Class price sheet returned ${response.status}`);
  const csv = await response.text();
  const rows = parseFirstClassPriceCsv(csv);
  firstClassPriceCache = { fetchedAt: Date.now(), rows };
  return rows;
}

async function getStripflipsPrices() {
  const cacheMs = 1000 * 60 * 10;
  if (stripflipsPriceCache.rows.length && Date.now() - stripflipsPriceCache.fetchedAt < cacheMs) {
    return stripflipsPriceCache;
  }
  const buyer = await getBuyerNumberOne();
  const buyerName = buyer?.company_name || "Stripflips";
  const csvUrl = toGoogleCsvUrl(process.env.STRIPFLIPS_PRICE_SHEET_CSV_URL || buyer?.price_list_url || "");
  const staticRows = getStaticStripflipsPrices(buyerName);
  if (!csvUrl) {
    stripflipsPriceCache = {
      fetchedAt: Date.now(),
      buyer: buyerName,
      source_url: "public/stripflips-prices.json",
      rows: staticRows,
      message: "Loaded Stripflips PDF price list saved in the system.",
    };
    return stripflipsPriceCache;
  }
  const response = await fetch(csvUrl);
  if (!response.ok) throw new Error(`Stripflips price sheet returned ${response.status}`);
  const csv = await response.text();
  const rows = parseStripflipsPriceCsv(csv, buyerName);
  stripflipsPriceCache = {
    fetchedAt: Date.now(),
    buyer: buyerName,
    source_url: csvUrl,
    rows: rows.length ? rows : staticRows,
    message: rows.length ? "" : "No products were found in Buyer #1 price list, so the saved PDF list was used.",
  };
  return stripflipsPriceCache;
}

function getStaticStripflipsPrices(buyerName = "Stripflips") {
  try {
    const path = new URL("./public/stripflips-prices.json", import.meta.url);
    const data = JSON.parse(fs.readFileSync(path, "utf8"));
    const labels = ["10 MO", "7 MO", "6 MO", "5 MO", "4 MO", "2 MO"];
    return (data.rows || []).map((row) => ({
      id: makePriceKey(`stripflips-${row.product}`),
      buyer: buyerName,
      product: row.product,
      category: row.category || inferCategory(row.product),
      prices: (row.prices || []).map((price, index) => ({
        label: (row.labels || labels)[index] || `Tier ${index + 1}`,
        damaged: /damaged/i.test((row.labels || labels)[index] || ""),
        raw: price === null || price === undefined ? "N/A" : `$${price}`,
        price: price === null || price === undefined ? null : Number(price),
      })).filter((entry) => entry.raw),
    }));
  } catch (error) {
    console.warn("Could not load static Stripflips prices.", error.message);
    return [];
  }
}

async function getBuyerNumberOne() {
  const result = await pool.query("select * from buyer_contacts where buyer_number = 1 limit 1");
  return result.rows[0] || null;
}

async function getSupplyPricesForBuyer(buyerName = "") {
  if (/strip\s*flips|stripflips/i.test(buyerName || "")) return (await getStripflipsPrices()).rows;
  if (/first\s*class/i.test(buyerName || "")) return getFirstClassPrices();
  return getMercuryPrices();
}

function parseMercuryPriceCsv(csv, buyerName = "Mercury", idPrefix = "") {
  const table = parseCsv(csv);
  let currentTiers = [];
  const products = [];
  for (const row of table) {
    const productName = cleanMercuryProductName(row[1]);
    const priceCells = row.slice(2, 10);
    const hasPrices = priceCells.some((cell) => parseMoney(cell) !== null || /^(ASK|STOP|N\/A|No EXP)$/i.test(String(cell || "").trim()));
    const headerCells = priceCells.map((cell) => String(cell || "").trim()).filter(Boolean);

    if (!hasPrices && headerCells.some((cell) => /MON|DAMAGED/i.test(cell))) {
      currentTiers = priceCells.map((cell, index) => ({
        column: index + 2,
        label: String(cell || "").trim() || `Tier ${index + 1}`,
        damaged: /DAMAGED/i.test(String(cell || "")),
      }));
      continue;
    }

    if (!productName || !hasPrices || isMercuryInfoRow(productName)) continue;
    const prices = priceCells.map((cell, index) => {
      const tier = currentTiers[index] || { column: index + 2, label: `Tier ${index + 1}`, damaged: false };
      const raw = String(cell || "").trim();
      return {
        label: tier.label,
        damaged: tier.damaged,
        raw,
        price: parseMoney(raw),
      };
    }).filter((entry) => entry.raw);

    if (!prices.length) continue;
    products.push({
      id: makePriceKey(`${idPrefix ? `${idPrefix}-` : ""}${productName}`),
      buyer: buyerName,
      product: productName,
      category: inferCategory(productName),
      prices,
    });
  }
  return products;
}

function parseStripflipsPriceCsv(csv, buyerName = "Stripflips") {
  const firstColumnRows = parseFirstClassPriceCsv(csv, buyerName, "stripflips");
  if (firstColumnRows.length) return firstColumnRows;
  return parseMercuryPriceCsv(csv, buyerName, "stripflips");
}

function parseFirstClassPriceCsv(csv, buyerName = "First Class Medical Supply", idPrefix = "first-class") {
  const table = parseCsv(csv);
  let currentTiers = [];
  const products = [];
  for (const row of table) {
    const productName = cleanMercuryProductName(row[0]);
    const priceCells = row.slice(1, 6);
    const hasPrices = priceCells.some((cell) => parseMoney(cell) !== null || /^(ASK|STOP|N\/A|No EXP|-|Buying)/i.test(String(cell || "").trim()));
    const headerCells = priceCells.map((cell) => String(cell || "").trim()).filter(Boolean);

    if (headerCells.some((cell) => /\d+\s*mo|\d+\/\d+|DINGS?|DAMAGED|Less Than/i.test(cell)) && !priceCells.some((cell) => parseMoney(cell) !== null)) {
      currentTiers = priceCells.map((cell, index) => ({
        column: index + 1,
        label: String(cell || "").trim() || `Tier ${index + 1}`,
        damaged: /DINGS?|DAMAGED/i.test(String(cell || "")),
      }));
      continue;
    }

    if (!productName || !hasPrices || isMercuryInfoRow(productName)) continue;
    const prices = priceCells.map((cell, index) => {
      const tier = currentTiers[index] || { column: index + 1, label: `Tier ${index + 1}`, damaged: false };
      const raw = String(cell || "").trim();
      return {
        label: tier.label,
        damaged: tier.damaged,
        raw,
        price: parseMoney(raw),
      };
    }).filter((entry) => entry.raw);

    if (!prices.length) continue;
    products.push({
      id: makePriceKey(`${idPrefix}-${productName}`),
      buyer: buyerName,
      product: productName,
      category: inferCategory(productName),
      prices,
    });
  }
  return products;
}

function parseCsv(csv) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else if (char !== "\r") {
      value += char;
    }
  }
  row.push(value);
  rows.push(row);
  return rows;
}

async function getAtlasPrices() {
  const cacheMs = 1000 * 60 * 10;
  if (atlasPriceCache.rows.length && Date.now() - atlasPriceCache.fetchedAt < cacheMs) {
    return atlasPriceCache.rows;
  }
  const sources = [
    { sheetId: atlasUsedSheetId, sheet: "iPhone Used", deviceType: "Phone", conditionType: "Used" },
    { sheetId: atlasUsedSheetId, sheet: "Samsung", deviceType: "Phone", conditionType: "Used", parser: "samsung" },
    { sheetId: atlasUsedSheetId, sheet: "Parts / iC", deviceType: "Phone", conditionType: "Used", parser: "parts" },
    { sheetId: atlasUsedSheetId, sheet: "iPad Used", deviceType: "Tablet", conditionType: "Used" },
    { sheetId: atlasNewSheetId, gid: "1148430169", sheet: "New in Box", deviceType: "Phone", conditionType: "New", parser: "newBox" },
  ];
  const groups = await Promise.all(sources.map(async (source) => {
    const url = source.gid
      ? `https://docs.google.com/spreadsheets/d/${source.sheetId}/export?format=csv&gid=${source.gid}`
      : `https://docs.google.com/spreadsheets/d/${source.sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(source.sheet)}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${source.sheet} returned ${response.status}`);
    const csv = await response.text();
    if (source.parser === "newBox") return parseAtlasNewBoxCsv(csv, source);
    if (source.parser === "parts") return parseAtlasPartsCsv(csv, source);
    if (source.parser === "samsung") return parseAtlasSamsungCsv(csv, source);
    return parseAtlasPriceCsv(csv, source);
  }));
  atlasPriceCache = { fetchedAt: Date.now(), rows: groups.flat() };
  return atlasPriceCache.rows;
}

async function getKtPrices() {
  if (ktPriceCache.rows.length) return ktPriceCache.rows;
  const path = new URL("./public/kt-prices.json", import.meta.url);
  const data = JSON.parse(fs.readFileSync(path, "utf8"));
  ktPriceCache = { rows: Array.isArray(data.rows) ? data.rows : [] };
  return ktPriceCache.rows;
}

function parseAtlasPriceCsv(csv, source) {
  const table = parseCsv(csv);
  const rows = [];
  let headers = [];
  for (const row of table) {
    const firstModel = String(row[1] || "").trim();
    const mirroredModel = String(row[8] || "").trim();
    const model = firstModel || mirroredModel;
    if (/^Model$/i.test(model)) {
      headers = row.slice(2, 8).map((cell, index) => String(cell || "").trim() || defaultAtlasHeader(source, index));
      continue;
    }
    const prices = row.slice(2, 8).map((cell, index) => ({
      label: headers[index] || defaultAtlasHeader(source, index),
      price: parseMoney(cell),
      raw: String(cell || "").trim(),
    })).filter((entry) => entry.price !== null);
    if (!isAtlasModelRow(model) || !prices.length) continue;
    const parsed = parseDeviceModel(model);
    for (const price of prices) {
      rows.push({
        id: makePriceKey(`${source.sheet}-${model}-${price.label}`),
        buyer: "Atlas",
        source_sheet: source.sheet,
        device_type: parsed.deviceType || source.deviceType,
        condition_type: source.conditionType,
        condition: normalizeAtlasCondition(source.conditionType, price.label),
        model,
        base_model: parsed.baseModel,
        storage: parsed.storage,
        carrier: parsed.carrier,
        price: price.price,
      });
    }
  }
  return rows;
}

function toGoogleCsvUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  if (/\/export\?/.test(value) || /format=csv/i.test(value) || /\.csv($|\?)/i.test(value)) return value;
  const sheetMatch = value.match(/\/spreadsheets\/d\/([^/]+)/i);
  if (!sheetMatch) return value;
  const gid = value.match(/[?&#]gid=(\d+)/i)?.[1] || "0";
  return `https://docs.google.com/spreadsheets/d/${sheetMatch[1]}/export?format=csv&gid=${gid}`;
}

function parseAtlasSamsungCsv(csv, source) {
  const table = parseCsv(csv);
  const rows = [];
  let currentModel = "";
  const priceColumns = [
    { index: 3, conditionType: "New", condition: "NEW" },
    { index: 4, conditionType: "Used", condition: "Grade A" },
    { index: 5, conditionType: "Used", condition: "Grade B" },
    { index: 6, conditionType: "Used", condition: "Grade C" },
    { index: 7, conditionType: "Used", condition: "Grade D" },
    { index: 8, conditionType: "Used", condition: "DOA" },
  ];

  for (const row of table) {
    const possibleModel = normalizeAtlasSamsungModel(row[1]);
    const carrier = normalizeAtlasCarrier(row[2]);

    if (possibleModel) currentModel = possibleModel;
    if (!currentModel || !/unlocked|carrier locked/i.test(carrier)) continue;

    for (const column of priceColumns) {
      const price = parseMoney(row[column.index]);
      if (price === null) continue;
      rows.push(makeAtlasSamsungPriceRow(source, currentModel, carrier, column.conditionType, column.condition, price));
      if (column.conditionType === "New" && price >= 30) {
        rows.push(makeAtlasSamsungPriceRow(source, currentModel, carrier, "New", "Open", price - 30));
      }
    }
  }
  return rows;
}

function makeAtlasSamsungPriceRow(source, model, carrier, conditionType, condition, price) {
  return {
    id: makePriceKey(`${source.sheet}-${model}-${carrier}-${condition}`),
    buyer: "Atlas",
    source_sheet: source.sheet,
    device_type: source.deviceType,
    condition_type: conditionType,
    condition,
    model,
    base_model: model,
    storage: "",
    carrier,
    price,
  };
}

function parseAtlasPartsCsv(csv, source) {
  const table = parseCsv(csv);
  const rows = [];
  let headers = [];
  for (const row of table) {
    const model = String(row[1] || "").trim();
    if (/^CLEAN MODE ONLY$/i.test(model)) {
      headers = row.slice(2, 6).map((cell, index) => String(cell || "").trim() || ["Grade A/B", "Grade C", "Grade D", "DOA"][index]);
      continue;
    }
    const prices = row.slice(2, 6).map((cell, index) => ({
      label: headers[index] || ["Grade A/B", "Grade C", "Grade D", "DOA"][index],
      price: parseMoney(cell),
    })).filter((entry) => entry.price !== null);
    if (!/^i(phone|\d|PADS?\b)/i.test(model) || !prices.length) continue;
    const cleanModel = normalizeAtlasPartsModel(model);
    const parsed = parseDeviceModel(cleanModel);
    for (const price of prices) {
      rows.push({
        id: makePriceKey(`${source.sheet}-${cleanModel}-${price.label}`),
        buyer: "Atlas",
        source_sheet: source.sheet,
        device_type: parsed.deviceType || source.deviceType,
        condition_type: source.conditionType,
        condition: normalizeAtlasPartsCondition(price.label),
        model: cleanModel,
        base_model: parsed.baseModel || cleanModel,
        storage: parsed.storage,
        carrier: "Parts",
        price: price.price,
      });
    }
  }
  return rows;
}

function parseAtlasNewBoxCsv(csv, source) {
  const table = parseCsv(csv);
  const rows = [];
  let currentBaseModel = "";
  for (const row of table) {
    const first = String(row[1] || "").trim();
    const storage = String(row[2] || "").trim();
    const sealedPrice = parseMoney(row[3]);
    const openPrice = parseMoney(row[4]);

    if (/^iPhone\b/i.test(first) && !storage && sealedPrice === null && openPrice === null) {
      currentBaseModel = first.replace(/\s+/g, " ").trim();
      continue;
    }

    if (!currentBaseModel || !/\d+\s*(GB|TB)\b/i.test(storage)) continue;
    if (!/unlocked|carrier locked|at&t|t-mobile|verizon|cricket|metro|spectrum|xfinity|boost/i.test(first)) continue;

    const carrier = normalizeAtlasCarrier(first);
    for (const price of [
      { condition: "NEW", value: sealedPrice },
      { condition: "Open", value: openPrice },
    ]) {
      if (price.value === null) continue;
      const model = `${currentBaseModel} ${storage} ${carrier}`.replace(/\s+/g, " ").trim();
      rows.push({
        id: makePriceKey(`${source.sheet}-${model}-${price.condition}`),
        buyer: "Atlas",
        source_sheet: source.sheet,
        device_type: source.deviceType,
        condition_type: source.conditionType,
        condition: price.condition,
        model,
        base_model: currentBaseModel,
        storage,
        carrier,
        price: price.value,
      });
    }
  }
  return rows;
}

function normalizeAtlasCarrier(value) {
  const text = String(value || "").trim();
  if (/unlocked/i.test(text)) return "Unlocked";
  if (/carrier locked/i.test(text)) return "Carrier Locked";
  return text;
}

function normalizeAtlasSamsungModel(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const galaxyMatch = text.match(/\bGalaxy\s+(?:Z\s+)?(?:Fold|Flip)\s+\d+\b|\bGalaxy\s+S\d{2}\s*(?:Ultra|Plus|FE|EDGE)?\b/i);
  if (galaxyMatch) return galaxyMatch[0].replace(/\bedge\b/i, "EDGE").replace(/\s+/g, " ").trim();
  const noteMatch = text.match(/\bNote\s+\d{2}\s*(?:Ultra)?\b/i);
  if (noteMatch) return noteMatch[0].replace(/\s+/g, " ").trim();
  if (/^S\d{2}\+$/i.test(text)) return `Galaxy ${text.toUpperCase().replace("+", " Plus")}`;
  if (/^S\d{2}\s*(Ultra|Plus|FE|EDGE)?$/i.test(text)) return `Galaxy ${text}`.replace(/\bedge\b/i, "EDGE").replace(/\s+/g, " ").trim();
  if (/^Z\s*(Fold|Flip)\s+\d+$/i.test(text)) return `Galaxy ${text}`.replace(/\s+/g, " ").trim();
  return "";
}

function defaultAtlasHeader(source, index) {
  if (source.conditionType === "New") return ["NEW", "Open", "HSO", "Grade A", "Grade B", "DOA"][index] || `Price ${index + 1}`;
  return ["SWAP / HSO", "Grade A", "Grade B", "Grade C", "Grade D", "DOA"][index] || `Price ${index + 1}`;
}

function normalizeAtlasCondition(conditionType, label) {
  const text = String(label || "").trim();
  if (conditionType === "New") {
    if (/open|hso|swap/i.test(text)) return "Open";
    if (/sealed|new|nib/i.test(text)) return "NEW";
    return text || "NEW";
  }
  if (/swap|hso/i.test(text)) return "HSO";
  const grade = text.match(/Grade\s*([ABCD])/i);
  if (grade) return `Grade ${grade[1].toUpperCase()}`;
  return text || "Grade A";
}

function normalizeAtlasLookupCondition(condition, conditionType) {
  const text = String(condition || "").trim();
  if (conditionType === "New" && /sealed|new|nib/i.test(text)) return "NEW";
  return text;
}

function normalizePhonePriceMatchText(value) {
  return normalizeMatchText(String(value || "").replace(/\+/g, " plus "))
    .replace(/^google\s+/, "")
    .replace(/^galaxy\s+/, "")
    .replace(/^samsung\s+/, "")
    .replace(/^apple\s+/, "")
    .replace(/\binch\b/g, "")
    .replace(/\bwifi\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isAtlasModelRow(model) {
  return /^(iPhone|iPad)\b/i.test(String(model || "")) && /\d+\s*(GB|TB)\b/i.test(model);
}

function parseDeviceModel(model) {
  const text = String(model || "").trim();
  const deviceType = /^iPad/i.test(text) ? "Tablet" : /^iPhone/i.test(text) ? "Phone" : "";
  const carrierMatch = text.match(/AT&T\s*\(Clean\)|Carrier Locked|Unlocked|T-Mobile|Verizon|Cricket|Metro|Spectrum|Xfinity|US Cellular|Boost/i);
  const carrier = carrierMatch ? normalizeAtlasCarrier(carrierMatch[0]) : "";
  const storageMatch = text.match(/\b\d+\s*(?:GB|TB)\b/i);
  const storage = storageMatch ? storageMatch[0].replace(/\s+/g, "") : "";
  const baseModel = text
    .replace(/\b\d+\s*(?:GB|TB)\b/i, "")
    .replace(/AT&T\s*\(Clean\)|Carrier Locked|Unlocked|T-Mobile|Verizon|Cricket|Metro|Spectrum|Xfinity|US Cellular|Boost/ig, "")
    .replace(/\s+/g, " ")
    .trim();
  return { deviceType, baseModel, storage, carrier };
}

function parseMoney(value) {
  const text = String(value || "").replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  return Number(text);
}

function isMercuryInfoRow(value) {
  return /^(UPDATED|ARE YOU|Please|CLICK|CONTACT|Sales@|PAYMENT|Wire|ACH|Zelle|Join|ORDERS|EXPIRATIONS|THINGS|BOXES|IF YOUR|PLEASE|RED|GREEN|ORANGE|NOTICE|CHECK IF)/i.test(value);
}

function inferCategory(productName) {
  const text = productName.toLowerCase();
  if (text.includes("omnipod")) return "Diabetic Pods";
  if (text.includes("dexcom") || text.includes("libre") || text.includes("sensor") || text.includes("transmitter")) return "CGM Supplies";
  if (text.includes("strip")) return "Test Strips";
  if (text.includes("reader") || text.includes("receiver") || text.includes("meter")) return "Glucose Meter";
  return "Other";
}

function makePriceKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120);
}

function cleanMercuryProductName(value) {
  return String(value || "").replace(/\s*\[\s*ding\s*-\s*\$?\d+(?:\.\d+)?\s*]/gi, "").trim();
}

function requireAuth(req, res, next) {
  const session = parseSession(req);
  if (!session) return res.status(401).json({ error: "Login required." });
  req.user = session;
  next();
}

function requirePhoneAuth(req, res, next) {
  const session = parseNamedSession(req, "phone_session");
  if (!session) return res.status(401).json({ error: "Phone portal login required." });
  req.user = session;
  next();
}

function parseSession(req) {
  return parseNamedSession(req, "dsb_session");
}

function parseNamedSession(req, cookieName) {
  const cookies = Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim().split("="))
      .filter((pair) => pair.length === 2)
  );
  const token = cookies[cookieName];
  if (!token) return null;

  const [payloadB64, sig] = token.split(".");
  if (!payloadB64 || !sig) return null;
  const expected = sign(payloadB64);
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return { username: payload.username };
  } catch {
    return null;
  }
}

function setSessionCookie(res, username, maxAgeSeconds) {
  setNamedSessionCookie(res, "dsb_session", username, maxAgeSeconds);
}

function setNamedSessionCookie(res, cookieName, username, maxAgeSeconds) {
  const payload = Buffer.from(
    JSON.stringify({ username, exp: Date.now() + maxAgeSeconds * 1000 })
  ).toString("base64url");
  res.setHeader(
    "Set-Cookie",
    makeCookie(cookieName, `${payload}.${sign(payload)}`, maxAgeSeconds)
  );
}

function makeCookie(name, value, maxAgeSeconds) {
  const secure = isProduction ? "; Secure" : "";
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure}`;
}

function sign(value) {
  return crypto
    .createHmac("sha256", process.env.SESSION_SECRET || "dev-secret")
    .update(value)
    .digest("base64url");
}

async function verifyPassword(password) {
  if (process.env.ADMIN_PASSWORD_HASH) {
    return verifyScrypt(password, process.env.ADMIN_PASSWORD_HASH);
  }
  return password === process.env.ADMIN_PASSWORD;
}

async function verifyNamedPassword(password, prefix) {
  const hash = process.env[`${prefix}_PASSWORD_HASH`];
  const plain = process.env[`${prefix}_PASSWORD`];
  if (hash) return verifyScrypt(password, hash);
  return Boolean(plain) && password === plain;
}

function verifyScrypt(password, stored) {
  const [scheme, salt, hash] = String(stored).split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const computed = crypto.scryptSync(password, salt, 64).toString("base64url");
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(computed));
}

function normalizePhone(phone) {
  return String(phone).replace(/\D/g, "").slice(-10);
}

function addDays(dateValue, days) {
  const date = new Date(`${dateValue}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizeBuyer(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text === "kt") return "KT";
  if (text === "atlas") return "Atlas";
  return "";
}

function normalizeDeviceType(value) {
  return /^tablet$/i.test(String(value || "")) ? "Tablet" : "Phone";
}

function normalizeConditionType(value) {
  return /^new$/i.test(String(value || "")) ? "New" : "Used";
}

function defaultPhoneInvoiceLabel(buyer) {
  const stamp = new Date().toISOString().slice(0, 10);
  return `${buyer} Phone Invoice ${stamp}`;
}

function createPhoneInvoiceHtml(invoice, priceOverrides = {}) {
  const purchases = invoice.purchases || [];
  const invoiceLines = phoneInvoiceLinesWithPrices(purchases, priceOverrides);
  const hasLinePrices = invoiceLines.some((row) => row.unit_price !== null);
  const actualSale = invoice.sale_price === null || invoice.sale_price === undefined || invoice.sale_price === "" ? null : Number(invoice.sale_price);
  const totalSale = actualSale !== null ? actualSale : invoiceLines.reduce((sum, row) => sum + Number(row.line_total || 0), 0);
  const showTotal = actualSale !== null || hasLinePrices;
  const buyerName = invoice.buyer === "KT" ? "KT CORP" : invoice.buyer === "Atlas" ? "Atlas" : invoice.buyer || "Buyer";
  const invoiceDate = invoice.created_at ? new Date(invoice.created_at).toLocaleDateString("en-US") : new Date().toLocaleDateString("en-US");
  const rows = invoiceLines.map((row) => `
    <tr>
      <td>${escapeHtml(row.item_number)}</td>
      <td class="item">${escapeHtml(row.model)}</td>
      <td>${escapeHtml(row.carrier || "")}</td>
      <td>${escapeHtml(row.condition)}</td>
      <td>${Number(row.quantity || 0)}</td>
      ${hasLinePrices ? `<td class="num">${row.unit_price === null ? "" : moneyText(row.unit_price)}</td><td class="num">${row.line_total === null ? "" : moneyText(row.line_total)}</td>` : ""}
    </tr>
  `).join("");
  const priceHeaders = hasLinePrices ? `<th class="num">Unit Price</th><th class="num">Line Total</th>` : "";
  const emptyColspan = hasLinePrices ? 7 : 5;
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Buyer Invoice - ${escapeHtml(invoice.label)}</title>
<style>
body{font-family:Arial,Helvetica,sans-serif;background:#f5f7f8;color:#132126;margin:0}.page{max-width:980px;margin:28px auto;background:#fff;padding:42px;box-shadow:0 18px 50px rgba(19,33,38,.12)}.printbar{max-width:980px;margin:24px auto 0;text-align:right}.printbar button{background:#0f5e69;color:white;border:0;border-radius:6px;padding:11px 16px;font-weight:700;cursor:pointer}header{display:flex;justify-content:space-between;gap:24px;border-bottom:3px solid #0f5e69;padding-bottom:22px}.brand h1{font-size:36px;line-height:1;margin:0;color:#0f5e69;letter-spacing:0}.brand p,.meta p,.block p{margin:4px 0;color:#465a61}.meta{text-align:right}.meta strong{display:block;font-size:15px;color:#132126;margin-bottom:6px}.blocks{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin:28px 0}.block{border:1px solid #d9e4e7;border-radius:8px;padding:16px}.block h2{font-size:12px;text-transform:uppercase;letter-spacing:0;margin:0 0 10px;color:#0f5e69}.block strong{font-size:16px}table{border-collapse:collapse;width:100%;margin-top:8px}th,td{border-bottom:1px solid #e0e7e9;padding:12px 10px;text-align:left;vertical-align:top}th{background:#eef4f5;color:#28464f;text-transform:uppercase;font-size:12px;letter-spacing:0}.item{font-weight:700;color:#132126}.num{text-align:right}.total{margin-top:24px;display:flex;justify-content:flex-end}.total-box{min-width:280px;background:#0f5e69;color:white;border-radius:8px;padding:18px}.total-box span{display:block;text-transform:uppercase;font-size:12px;letter-spacing:0;opacity:.86}.total-box strong{font-size:30px}.note{margin-top:28px;color:#5a6c72;font-size:13px}@media(max-width:720px){.page{margin:0;padding:22px}.printbar{margin:12px}.blocks,header{display:block}.meta{text-align:left;margin-top:18px}table{font-size:13px}th,td{padding:9px 6px}}@media print{body{background:white}.printbar{display:none}.page{box-shadow:none;margin:0;max-width:none;padding:22px}.block,.total-box{break-inside:avoid}}
</style></head><body>
<div class="printbar"><button onclick="window.print()">Print / Save PDF</button></div>
<main class="page">
<header><div class="brand"><h1>Invoice</h1><p>${escapeHtml(invoice.label || "Phone Invoice")}</p></div><div class="meta"><strong>Invoice #${invoice.id}</strong><p>Date: ${invoiceDate}</p><p>Status: ${escapeHtml(invoice.status)}</p></div></header>
<section class="blocks"><div class="block"><h2>From</h2><strong>iFixTeck LLC</strong><p>1612 Lucerne Ave</p><p>Lake Worth, FL 33460</p></div><div class="block"><h2>Bill To</h2><strong>${escapeHtml(buyerName)}</strong><p>${escapeHtml(invoice.buyer)} buyer invoice</p></div></section>
<table><thead><tr><th>Item #</th><th>Model</th><th>Carrier</th><th>Condition</th><th>Qty</th>${priceHeaders}</tr></thead><tbody>${rows || `<tr><td colspan="${emptyColspan}">No purchases added.</td></tr>`}</tbody></table>
${showTotal ? `<section class="total"><div class="total-box"><span>Total Due</span><strong>${moneyText(totalSale)}</strong></div></section>` : ""}
<p class="note">Thank you for your business.</p>
</main>
</body></html>`;
}

function createGiftCardCloseoutInvoiceHtml(invoice, purchases = []) {
  const invoiceDate = invoice.closed_at || invoice.created_at ? new Date(invoice.closed_at || invoice.created_at).toLocaleDateString("en-US") : new Date().toLocaleDateString("en-US");
  const totalCost = purchases.reduce((sum, row) => sum + Number(row.quantity || 0) * Number(row.cost_each || 0), 0);
  const totalValue = purchases.reduce((sum, row) => sum + Number(row.gift_card_value || 0), 0);
  const totalProfit = totalValue - totalCost;
  const rows = purchases.map((row, index) => {
    const cost = Number(row.quantity || 0) * Number(row.cost_each || 0);
    const value = Number(row.gift_card_value || 0);
    const profit = value - cost;
    const cardNumber = Number(row.gift_card_number || index + 1);
    return `
      <tr>
        <td><strong>#${cardNumber}</strong></td>
        <td>${escapeHtml(giftCardInvoiceItemNumber(row, index + 1))}</td>
        <td class="item">${escapeHtml(row.model || "Phone")}</td>
        <td>${escapeHtml(row.gift_card_location || "")}</td>
        <td>${escapeHtml(row.source_buyer || row.buyer || "")}</td>
        <td>${escapeHtml(row.source_label || `Invoice #${row.invoice_id || ""}`)}</td>
        <td class="num">${moneyText(cost)}</td>
        <td class="num">${moneyText(value)}</td>
        <td class="num ${profit >= 0 ? "good" : "bad"}">${moneyText(profit)}</td>
        <td>${formatBusinessDate(row.gift_card_at)}</td>
      </tr>
    `;
  }).join("");
  const mediaSections = purchases.map((row, index) => {
    const cardNumber = Number(row.gift_card_number || index + 1);
    return `
      <section class="media-card">
        <div class="media-title">
          <div><strong>Gift Card #${cardNumber}</strong><span>${escapeHtml(row.model || "Phone")}</span></div>
          <em>${escapeHtml(row.gift_card_location || "No location saved")}</em>
        </div>
        <div class="media-grid">
          ${giftCardInvoiceMediaBlock("Gift Card Picture", row.gift_card_photo_data_url, row.gift_card_photo_file_name)}
          ${giftCardInvoiceMediaBlock("Receipt", row.gift_card_receipt_data_url, row.gift_card_receipt_file_name)}
        </div>
      </section>
    `;
  }).join("");
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Gift Card Invoice - ${escapeHtml(invoice.label || `#${invoice.id}`)}</title>
<style>
body{font-family:Arial,Helvetica,sans-serif;background:#f4f7f8;color:#132126;margin:0}.page{max-width:1120px;margin:28px auto;background:#fff;padding:42px;box-shadow:0 18px 50px rgba(19,33,38,.12)}.printbar{max-width:1120px;margin:24px auto 0;text-align:right}.printbar button{background:#0f5e69;color:white;border:0;border-radius:6px;padding:11px 16px;font-weight:700;cursor:pointer}header{display:flex;justify-content:space-between;gap:24px;border-bottom:3px solid #0f5e69;padding-bottom:22px}.brand h1{font-size:34px;line-height:1;margin:0;color:#0f5e69;letter-spacing:0}.brand p,.meta p,.block p{margin:4px 0;color:#465a61}.meta{text-align:right}.meta strong{display:block;font-size:15px;color:#132126;margin-bottom:6px}.blocks{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin:28px 0}.block{border:1px solid #d9e4e7;border-radius:8px;padding:16px}.block h2,.media-title em{font-size:12px;text-transform:uppercase;letter-spacing:0;margin:0 0 10px;color:#0f5e69}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:22px 0}.summary span{border:1px solid #d9e4e7;border-radius:8px;padding:14px}.summary small{display:block;text-transform:uppercase;color:#60757b;font-size:11px}.summary b{font-size:22px;color:#132126}table{border-collapse:collapse;width:100%;margin-top:8px}th,td{border-bottom:1px solid #e0e7e9;padding:11px 9px;text-align:left;vertical-align:top}th{background:#eef4f5;color:#28464f;text-transform:uppercase;font-size:11px;letter-spacing:0}.item{font-weight:700;color:#132126}.num{text-align:right}.good{color:#12724d}.bad{color:#ad2929}.media-section-title{margin:34px 0 12px;color:#0f5e69}.media-card{border:1px solid #d9e4e7;border-radius:8px;padding:16px;margin:14px 0;break-inside:avoid}.media-title{display:flex;justify-content:space-between;gap:16px;margin-bottom:12px}.media-title strong,.media-title span{display:block}.media-title span{color:#546971;margin-top:3px}.media-title em{font-style:normal;margin:0}.media-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.media-box{background:#f8fbfb;border:1px solid #e0e7e9;border-radius:8px;min-height:180px;padding:12px}.media-box h3{margin:0 0 10px;font-size:13px;text-transform:uppercase;color:#28464f}.media-box img{display:block;max-width:100%;max-height:420px;object-fit:contain;margin:auto}.pdf-box{height:420px}.pdf-box iframe{width:100%;height:360px;border:0;background:white}.pdf-link{display:inline-block;margin-top:8px;color:#0f5e69;font-weight:700}.empty-media{display:flex;align-items:center;justify-content:center;min-height:130px;color:#71858b;border:1px dashed #c8d7db;border-radius:7px}@media(max-width:800px){.page{margin:0;padding:22px}.printbar{margin:12px}.blocks,header,.summary,.media-grid{display:block}.summary span{display:block;margin-bottom:10px}.meta{text-align:left;margin-top:18px}table{font-size:12px;display:block;overflow-x:auto}th,td{padding:8px 6px}.media-box{margin-bottom:12px}}@media print{body{background:white}.printbar{display:none}.page{box-shadow:none;margin:0;max-width:none;padding:22px}.block,.summary span,.media-card{break-inside:avoid}.pdf-link{display:block}.pdf-box iframe{height:260px}}
</style></head><body>
<div class="printbar"><button onclick="window.print()">Print / Save PDF</button></div>
<main class="page">
<header><div class="brand"><h1>Gift Card Invoice</h1><p>${escapeHtml(invoice.label || "Gift Card Closeout")}</p></div><div class="meta"><strong>Invoice #${invoice.id}</strong><p>Date: ${invoiceDate}</p><p>Status: ${escapeHtml(invoice.status || "Closed")}</p></div></header>
<section class="blocks"><div class="block"><h2>Company</h2><strong>iFixTeck LLC</strong><p>1612 Lucerne Ave</p><p>Lake Worth, FL 33460</p></div><div class="block"><h2>Batch</h2><strong>Apple Gift Cards</strong><p>${escapeHtml(invoice.notes || "Gift card closeout batch")}</p></div></section>
<section class="summary"><span><small>Total Cards</small><b>${purchases.length}</b></span><span><small>Total Phones Cost</small><b>${moneyText(totalCost)}</b></span><span><small>Gift Card Value</small><b>${moneyText(totalValue)}</b></span><span><small>Profit</small><b class="${totalProfit >= 0 ? "good" : "bad"}">${moneyText(totalProfit)}</b></span></section>
<table><thead><tr><th>GC #</th><th>Item #</th><th>Phone</th><th>Location</th><th>Source</th><th>From Invoice</th><th class="num">Cost</th><th class="num">Value</th><th class="num">Profit</th><th>Date</th></tr></thead><tbody>${rows || `<tr><td colspan="10">No gift cards in this closeout.</td></tr>`}</tbody></table>
<h2 class="media-section-title">Saved Pictures & Receipts</h2>
${mediaSections || `<div class="empty-media">No saved pictures or receipts for this closeout.</div>`}
</main>
</body></html>`;
}

function giftCardInvoiceMediaBlock(title, dataUrl, fileName) {
  const safeTitle = escapeHtml(title);
  if (!dataUrl) return `<div class="media-box"><h3>${safeTitle}</h3><div class="empty-media">Not uploaded</div></div>`;
  const safeSrc = escapeHtml(dataUrl);
  const safeFileName = escapeHtml(fileName || title);
  if (isPdfDataUrl(dataUrl) || /\.pdf$/i.test(String(fileName || ""))) {
    return `<div class="media-box pdf-box"><h3>${safeTitle}</h3><iframe src="${safeSrc}" title="${safeTitle} PDF"></iframe><a class="pdf-link" href="${safeSrc}" target="_blank" rel="noopener">${safeFileName}</a></div>`;
  }
  return `<div class="media-box"><h3>${safeTitle}</h3><img src="${safeSrc}" alt="${safeTitle}"></div>`;
}

function giftCardInvoiceItemNumber(row, fallback) {
  const quantity = Math.max(1, Number(row.quantity || 1));
  const start = Number(row.invoice_item_start || fallback || 1);
  return quantity > 1 ? `${start}-${start + quantity - 1}` : String(start);
}

function isPdfDataUrl(value) {
  return String(value || "").startsWith("data:application/pdf");
}

function parsePhoneInvoicePriceOverrides(raw) {
  if (!raw) return {};
  try {
    const input = JSON.parse(String(raw));
    return Object.fromEntries(Object.entries(input || {}).map(([id, value]) => {
      const prices = Array.isArray(value) ? value : [value];
      return [id, prices.map((price) => Number(price)).filter((price) => Number.isFinite(price) && price >= 0)];
    }));
  } catch {
    return {};
  }
}

function phoneInvoiceLinesWithPrices(purchases, priceOverrides) {
  let itemNumber = 1;
  return purchases.flatMap((row) => {
    const quantity = Math.max(1, Number(row.quantity || 1));
    const itemStart = Number(row.invoice_item_start || itemNumber || 1);
    const overridePrices = Array.isArray(priceOverrides[row.id]) ? priceOverrides[row.id] : [];
    const condition = row.condition_type === "New" ? "NEW" : "USED";
    if (overridePrices.length > 1 || quantity > 1) {
      itemNumber = itemStart + quantity;
      return Array.from({ length: quantity }, (_, index) => {
        const unitPrice = overridePrices[index] === undefined ? null : Number(overridePrices[index]);
        return {
          item_number: String(itemStart + index),
          model: quantity > 1 ? `${row.model} (${index + 1} of ${quantity})` : row.model,
          carrier: row.carrier || "",
          condition,
          quantity: 1,
          unit_price: unitPrice,
          line_total: unitPrice === null ? null : unitPrice,
        };
      });
    }
    const unitPrice = overridePrices[0] === undefined ? null : Number(overridePrices[0]);
    const lineItemNumber = quantity > 1 ? `${itemStart}-${itemStart + quantity - 1}` : String(itemStart);
    itemNumber = itemStart + quantity;
    return [{
      item_number: lineItemNumber,
      model: row.model,
      carrier: row.carrier || "",
      condition,
      quantity,
      unit_price: unitPrice,
      line_total: unitPrice === null ? null : unitPrice * quantity,
    }];
  });
}

function moneyText(value) {
  return Number(value || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatBusinessDate(value) {
  if (!value) return "";
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString("en-US");
  }
  return new Date(value).toLocaleDateString("en-US", { timeZone: "America/New_York" });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function findMercuryProductForItem(item, mercuryPrices) {
  const itemText = normalizeMatchText(`${item.brand || ""} ${item.model || ""}`);
  if (!itemText) return null;
  const itemSkus = skuCandidatesFromText(`${item.brand || ""} ${item.model || ""}`);
  if (itemSkus.size) {
    const skuMatch = mercuryPrices.find((product) => hasSharedSku(itemSkus, skuCandidatesFromText(product.product)));
    if (skuMatch) return skuMatch;
  }
  const itemAlias = productAliasKey(`${item.brand || ""} ${item.model || ""}`);
  return mercuryPrices.find((product) => productAliasKey(product.product) === itemAlias)
    || mercuryPrices.find((product) => normalizeMatchText(product.product) === itemText)
    || mercuryPrices.find((product) => itemText.includes(normalizeMatchText(product.product)))
    || mercuryPrices.find((product) => normalizeMatchText(product.product).includes(itemText))
    || null;
}

function getMercuryPriceForItem(product, expiration, condition) {
  const damaged = /damaged/i.test(condition || "");
  const prices = (product.prices || []).filter((entry) => entry.damaged === damaged && entry.price !== null);
  const fallback = prices[0] || (product.prices || []).find((entry) => entry.price !== null) || null;
  const months = monthsUntilExpiration(expiration);
  if (months === null) return fallback;
  return prices.find((entry) => months >= monthsFromTier(entry.label)) || fallback;
}

function monthsUntilExpiration(expiration) {
  if (!/^\d{4}-\d{2}$/.test(String(expiration || ""))) return null;
  const [year, month] = expiration.split("-").map(Number);
  const now = new Date();
  return (year - now.getFullYear()) * 12 + (month - (now.getMonth() + 1));
}

function monthsFromTier(label) {
  const match = String(label || "").match(/(\d+)\+?\s*MO/i);
  return match ? Number(match[1]) : 0;
}

function normalizeMatchText(value) {
  return cleanMercuryProductName(value)
    .toLowerCase()
    .replace(/\[[^\]]*]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function skuCandidatesFromText(value) {
  const raw = String(value || "").toUpperCase();
  const normalized = normalizeMatchText(value);
  const candidates = new Set();
  addMatches(candidates, raw, /\b[A-Z]{2,4}-[A-Z]{2}-\d{3}\b/g);
  addMatches(candidates, raw, /\b\d{5}-\d{4}-\d{2}\b/g);
  addMatches(candidates, raw, /\b(?:MMT|NRC)[-:\s]*(\d{3,4}[A-Z]?)\b/g, (match) => match[1]);
  addMatches(candidates, raw, /\b\d{7}\b/g);
  addMatches(candidates, raw, /\b(?:7\d{3}|10\d{5}|11\d{5})\b/g);
  if (/\bG7\b/.test(raw)) {
    addMatches(candidates, raw, /\b(?:STP|STE|STK)-FT-(\d{3})\b/g, (match) => `G7-15-${match[1]}`);
    addMatches(candidates, raw, /\b(?:STP|STE|STK)-AT-(\d{3})\b/g, (match) => `G7-${match[1]}`);
    addMatches(candidates, raw, /\((\d{3})\)/g, (match) => normalized.includes("15 day") ? `G7-15-${match[1]}` : `G7-${match[1]}`);
  }
  if (/\bG6\b/.test(raw)) {
    addMatches(candidates, raw, /\bSTS-[A-Z]{2}-(\d{3})\b/g, (match) => `G6-SENSOR-${match[1]}`);
    addMatches(candidates, raw, /\bSTT-[A-Z]{2}-(\d{3})\b/g, (match) => `G6-TRANSMITTER-${match[1]}`);
  }
  if (/OMNI\s*POD|OMNIPOD|\bPOD\b/.test(raw)) {
    if (/0042|08508-3000-42/.test(raw)) candidates.add("OMNIPOD-5-LIBRE-5PK");
    else if (/0075|08508-3000-75/.test(raw)) candidates.add("OMNIPOD-5-DME-5PK");
    else if (/0021|08508-3000-21|PURPLE\s*&?\s*WHITE|PURPLE AND WHITE/.test(raw)) candidates.add("OMNIPOD-5-RETAIL-5PK");
    if (/DASH/.test(raw) && /10/.test(raw)) candidates.add("OMNIPOD-DASH-10PK");
    if (/DASH/.test(raw) && /5/.test(raw)) candidates.add("OMNIPOD-DASH-5PK");
  }
  if (/CONTOUR/.test(raw)) {
    addMatches(candidates, raw, /\b(70(?:80|90)G|7(?:277|278|308|309|311|312))\b/g, (match) => match[1].replace(/G$/, ""));
  }
  return candidates;
}

function addMatches(candidates, text, pattern, mapper = (match) => match[0]) {
  for (const match of text.matchAll(pattern)) {
    const value = String(mapper(match) || "").toUpperCase().replace(/[^A-Z0-9-]+/g, "");
    if (value) candidates.add(value);
  }
}

function hasSharedSku(left, right) {
  for (const value of left) {
    if (right.has(value)) return true;
  }
  return false;
}

function productAliasKey(value) {
  let text = normalizeMatchText(value)
    .replace(/\bfsl\b/g, "freestyle libre")
    .replace(/\bfs\b/g, "freestyle")
    .replace(/\bpk\b/g, "pack")
    .replace(/\bct\b/g, "count")
    .replace(/\bcts\b/g, "count")
    .replace(/\bone touch\b/g, "onetouch")
    .replace(/\bomni pod\b/g, "omnipod")
    .replace(/\bg6 g7\b/g, "g6g7")
    .replace(/\bg7 g6\b/g, "g6g7")
    .replace(/\bretail\b/g, " ")
    .replace(/\bdme\b/g, " ")
    .replace(/\bnfr\b/g, " ")
    .replace(/\bmail order\b/g, " ")
    .replace(/\bmo\b/g, " ")
    .replace(/\botc\b/g, " ")
    .replace(/\bsealed\b/g, " ");
  text = text.replace(/\b(\d+)\s*(?:count|pack|pk)\b/g, "$1");
  return text.replace(/\s+/g, " ").trim();
}

function parseBuyerPdfItemPrices(raw) {
  if (!raw) return {};
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Object.fromEntries(Object.entries(parsed || {}).flatMap(([id, price]) => {
      const itemId = Number(id);
      const itemPrice = Number(price);
      return itemId && Number.isFinite(itemPrice) && itemPrice >= 0 ? [[itemId, itemPrice]] : [];
    }));
  } catch {
    return {};
  }
}

function sameBuyerName(left, right) {
  const a = normalizeBuyerName(left);
  const b = normalizeBuyerName(right);
  return !!a && !!b && (a === b || a.includes(b) || b.includes(a));
}

function normalizeBuyerName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b(inc|llc|corp|corporation|company|co|medical|med|supplies|supply)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function createBuyerInvoicePdf(batch, mercuryPrices = [], options = {}) {
  const showPrices = options.showPrices !== false;
  const overrideUnitPrice = options.overrideUnitPrice === null || options.overrideUnitPrice === undefined ? null : Number(options.overrideUnitPrice);
  const itemPrices = options.itemPrices || {};
  const groupedRows = new Map();
  const photos = [];
  let mercuryTotal = 0;
  const invoiceNumber = formatInvoiceStartDate(batch.created_at);
  for (const purchase of batch.purchases || []) {
    for (const item of activeInvoiceItems(purchase.items || [])) {
      const product = findMercuryProductForItem(item, mercuryPrices);
      const quote = product ? getMercuryPriceForItem(product, item.expiration, item.condition) : null;
      const savedPrice = Number(item.expected_sell_each || 0);
      const itemOverridePrice = itemPrices[item.id] === undefined ? null : Number(itemPrices[item.id]);
      const unitPrice = itemOverridePrice !== null && !Number.isNaN(itemOverridePrice) && itemOverridePrice >= 0
        ? itemOverridePrice
        : overrideUnitPrice !== null ? overrideUnitPrice : quote?.price ?? (savedPrice > 0 ? savedPrice : null);
      const quantity = Number(item.quantity || 0);
      const lineTotal = unitPrice === null ? null : quantity * unitPrice;
      if (lineTotal !== null) mercuryTotal += lineTotal;
      const description =
        cleanMercuryProductName(product?.product) ||
        cleanMercuryProductName([item.brand, item.model].filter(Boolean).join(" ")) ||
        item.category ||
        "Diabetic supply";
      const row = {
        quantity,
        description,
        condition: item.condition || "Sealed",
        expiration: formatExpiration(item.expiration),
        expirations: new Map([[formatExpiration(item.expiration), quantity]]),
        unitPrice,
        lineTotal,
      };
      const rowKey = [
        product?.id || normalizeMatchText(row.description),
        row.condition.toLowerCase(),
        unitPrice === null ? "" : unitPrice.toFixed(2),
      ].join("|");
      const existing = groupedRows.get(rowKey);
      if (existing) {
        existing.quantity += row.quantity;
        existing.lineTotal = existing.lineTotal === null || row.lineTotal === null ? null : existing.lineTotal + row.lineTotal;
        existing.expirations.set(row.expiration, (existing.expirations.get(row.expiration) || 0) + row.quantity);
        if (existing.expiration !== row.expiration) existing.expiration = "See below";
      } else {
        groupedRows.set(rowKey, row);
      }
    }
    for (const photo of purchase.photos || []) {
      const image = parsePdfPhoto(photo);
      if (image) photos.push(image);
    }
  }
  const itemRows = Array.from(groupedRows.values()).map((row) => ({
    ...row,
    expirationBreakdown: Array.from(row.expirations.entries())
      .map(([expiration, quantity]) => ({ expiration, quantity })),
  }));

  const lines = [
    { text: "USW2934 Medical Supplies", x: 50, y: 746, size: 20, font: "bold" },
    { text: "Buyer Invoice", x: 50, y: 724, size: 12, font: "bold" },
    { text: "Phone: 561-510-1236", x: 50, y: 706, size: 10 },
    { text: process.env.COMPANY_ADDRESS || "5100 Lake Worth Rd, Greenacres, FL 33463", x: 50, y: 690, size: 10 },
    { text: `Invoice #: ${invoiceNumber}`, x: 410, y: 746, size: 11, font: "bold" },
    { text: `Date: ${new Date().toLocaleDateString("en-US")}`, x: 410, y: 728, size: 10 },
    { text: `Status: ${batch.status || "Active"}`, x: 410, y: 710, size: 10 },
    { text: batch.sold_to ? `Buyer: ${batch.sold_to}` : "Buyer: ", x: 410, y: 692, size: 10 },
    ...(batch.tracking_number ? [{ text: `Tracking: ${batch.tracking_number}`, x: 410, y: 674, size: 10 }] : []),
    { text: "Itemized Supplies", x: 50, y: 640, size: 14, font: "bold" },
    { text: "Qty", x: 54, y: 612, size: 8, font: "bold" },
    { text: "Description", x: 82, y: 612, size: 8, font: "bold" },
    { text: "Condition", x: 294, y: 612, size: 8, font: "bold" },
    { text: "Expiration", x: 370, y: 612, size: 8, font: "bold" },
    ...(showPrices ? [
      { text: "Unit Price", x: 448, y: 612, size: 8, font: "bold" },
      { text: "Line Total", x: 512, y: 612, size: 8, font: "bold" },
    ] : []),
  ];

  let y = 590;
  for (const row of itemRows) {
    const descriptionLines = wrapPdfLine(row.description, 31).slice(0, 2);
    const expirationBreakdown = row.expirationBreakdown || [];
    const hasEnteredExpiration = expirationBreakdown.some((entry) => entry.expiration !== "N/A");
    lines.push({ text: String(row.quantity), x: 54, y, size: 8 });
    lines.push({ text: descriptionLines[0] || "", x: 82, y, size: 8 });
    lines.push({ text: row.condition, x: 294, y, size: 8 });
    lines.push({ text: hasEnteredExpiration ? "Listed below" : row.expiration, x: 370, y, size: 8 });
    if (showPrices) {
      lines.push({ text: row.unitPrice === null ? "" : formatCurrency(row.unitPrice), x: 448, y, size: 8 });
      lines.push({ text: row.lineTotal === null ? "" : formatCurrency(row.lineTotal), x: 512, y, size: 8 });
    }
    if (descriptionLines[1]) {
      y -= 13;
      lines.push({ text: descriptionLines[1], x: 82, y, size: 8 });
    }
    if (hasEnteredExpiration) {
      for (const entry of expirationBreakdown) {
        y -= 12;
        lines.push({ text: `-${entry.quantity} Expiration ${entry.expiration}`, x: 82, y, size: 8 });
      }
    }
    y -= 24;
    if (y < 142) break;
  }

  const total = mercuryTotal > 0 ? mercuryTotal : Number(batch.sale_price || 0);
  if (showPrices) {
    lines.push({ text: `Invoice Total: ${formatCurrency(total)}`, x: 360, y: 108, size: 14, font: "bold" });
  }
  if (batch.sale_notes) {
    lines.push({ text: `Notes: ${batch.sale_notes}`, x: 50, y: 86, size: 9 });
  }
  if (photos.length) {
    lines.push({ text: `Photos: Included on final page`, x: 50, y: 72, size: 9 });
  }
  lines.push({ text: "Thank you for your business.", x: 50, y: 58, size: 10, font: "bold" });

  return buildProfessionalPdf(lines, photos);
}

function normalizeAtlasPartsModel(value) {
  let model = String(value || "")
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/^i(\d{2})\b/i, "iPhone $1")
    .replace(/\s+/g, " ")
    .trim();
  if (/^(XS|XR|X)\b/i.test(model)) model = `iPhone ${model}`;
  return model;
}

function normalizeAtlasPartsCondition(label) {
  const text = String(label || "").trim();
  if (/Grade\s*A\/B/i.test(text)) return "Parts";
  if (/Grade\s*C/i.test(text)) return "Parts Grade C";
  if (/Grade\s*D/i.test(text)) return "Parts Grade D";
  if (/DOA/i.test(text)) return "DOA";
  return "Parts";
}

function activeInvoiceItems(items) {
  return (items || []).filter((item) => !item.invoice_removed_at);
}

function buildProfessionalPdf(lines, photos = []) {
  const objects = [];
  const reserveObject = () => {
    objects.push(null);
    return objects.length;
  };
  const setObject = (ref, value) => {
    objects[ref - 1] = Buffer.isBuffer(value) ? value : Buffer.from(value, "binary");
  };
  const catalogRef = reserveObject();
  const pagesRef = reserveObject();
  const fontRef = reserveObject();
  const boldFontRef = reserveObject();
  const invoiceContentRef = reserveObject();
  const invoicePageRef = reserveObject();
  const imageRefs = photos.map((photo, index) => {
    const ref = reserveObject();
    setObject(ref, makePdfImageObject(photo, index));
    return ref;
  });
  const photoContentRef = photos.length ? reserveObject() : null;
  const photoPageRef = photos.length ? reserveObject() : null;

  const content = [
    "0.95 0.98 0.95 rg",
    "40 660 532 104 re f",
    "0.05 0.44 0.18 rg",
    "40 660 532 5 re f",
    "0.93 0.96 0.93 rg",
    "50 598 512 26 re f",
    "0.82 0.90 0.84 RG",
    "50 598 512 1 re S",
    "50 124 512 1 re S",
    "0 0 0 rg",
    "BT",
    ...lines.map((line) => {
      const font = line.font === "bold" ? "F2" : "F1";
      return `/${font} ${line.size || 10} Tf ${line.x} ${line.y} Td (${escapePdfText(line.text)}) Tj ${-line.x} ${-line.y} Td`;
    }),
    "ET",
  ].join("\n");

  setObject(fontRef, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  setObject(boldFontRef, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  setObject(invoiceContentRef, makePdfStreamObject(content));
  setObject(
    invoicePageRef,
    `<< /Type /Page /Parent ${pagesRef} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontRef} 0 R /F2 ${boldFontRef} 0 R >> >> /Contents ${invoiceContentRef} 0 R >>`
  );

  if (photos.length) {
    const photoContent = buildPhotoPageContent(photos);
    const imageResources = imageRefs.map((ref, index) => `/Im${index + 1} ${ref} 0 R`).join(" ");
    setObject(photoContentRef, makePdfStreamObject(photoContent));
    setObject(
      photoPageRef,
      `<< /Type /Page /Parent ${pagesRef} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontRef} 0 R /F2 ${boldFontRef} 0 R >> /XObject << ${imageResources} >> >> /Contents ${photoContentRef} 0 R >>`
    );
  }

  const pageRefs = [invoicePageRef, ...(photoPageRef ? [photoPageRef] : [])];
  setObject(catalogRef, `<< /Type /Catalog /Pages ${pagesRef} 0 R >>`);
  setObject(pagesRef, `<< /Type /Pages /Kids [${pageRefs.map((ref) => `${ref} 0 R`).join(" ")}] /Count ${pageRefs.length} >>`);

  const chunks = [Buffer.from("%PDF-1.4\n", "binary")];
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.concat(chunks).length);
    chunks.push(Buffer.from(`${index + 1} 0 obj\n`, "binary"));
    chunks.push(object);
    chunks.push(Buffer.from("\nendobj\n", "binary"));
  });
  const xrefOffset = Buffer.concat(chunks).length;
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, "binary"));
  offsets.slice(1).forEach((offset) => {
    chunks.push(Buffer.from(`${String(offset).padStart(10, "0")} 00000 n \n`, "binary"));
  });
  chunks.push(Buffer.from(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogRef} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`, "binary"));
  return Buffer.concat(chunks);
}

function buildPhotoPageContent(photos) {
  const safePhotos = photos;
  const columns = safePhotos.length <= 4 ? 2 : safePhotos.length <= 12 ? 3 : 4;
  const rows = Math.ceil(safePhotos.length / columns);
  const left = 50;
  const top = 632;
  const gap = columns === 4 ? 12 : 18;
  const cellWidth = columns === 2 ? 238 : columns === 3 ? 154 : 119;
  const cellHeight = Math.max(50, Math.min(154, Math.floor((520 - gap * (rows - 1)) / rows)));
  const commands = [
    "0.95 0.98 0.95 rg",
    "40 686 532 58 re f",
    "0.05 0.44 0.18 rg",
    "40 686 532 5 re f",
    "0 0 0 rg",
    "BT",
    "/F2 18 Tf 50 718 Td (Product Photos) Tj -50 -718 Td",
    "/F1 10 Tf 50 700 Td (Grouped product photos for this buyer invoice.) Tj -50 -700 Td",
    "ET",
  ];

  safePhotos.forEach((photo, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const cellX = left + column * (cellWidth + gap);
    const cellTop = top - row * (cellHeight + 34 + gap);
    const scale = Math.min(cellWidth / photo.width, cellHeight / photo.height);
    const width = Math.max(1, Math.round(photo.width * scale));
    const height = Math.max(1, Math.round(photo.height * scale));
    const x = cellX + Math.round((cellWidth - width) / 2);
    const y = cellTop - height;
    commands.push("0.82 0.90 0.84 RG");
    commands.push(`${cellX} ${cellTop - cellHeight} ${cellWidth} ${cellHeight} re S`);
    commands.push(`q ${width} 0 0 ${height} ${x} ${y} cm /Im${index + 1} Do Q`);
    commands.push("0 0 0 rg");
    commands.push("BT");
    commands.push(`/F1 8 Tf ${cellX} ${cellTop - cellHeight - 14} Td (${escapePdfText(photo.name)}) Tj ${-cellX} ${-(cellTop - cellHeight - 14)} Td`);
    commands.push("ET");
  });
  return commands.join("\n");
}

function makePdfStreamObject(content) {
  return `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`;
}

function makePdfImageObject(photo) {
  return Buffer.concat([
    Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${photo.width} /Height ${photo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${photo.bytes.length} >>\nstream\n`, "binary"),
    photo.bytes,
    Buffer.from("\nendstream", "binary"),
  ]);
}

function wrapPdfLine(value, maxLength) {
  const text = String(value || "");
  if (!text) return [""];
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (`${line} ${word}`.trim().length > maxLength) {
      lines.push(line);
      line = word;
    } else {
      line = `${line} ${word}`.trim();
    }
  }
  if (line) lines.push(line);
  return lines;
}

function escapePdfText(value) {
  return String(value).replace(/[\\()]/g, "\\$&");
}

function parsePdfPhoto(photo) {
  const dataUrl = String(photo?.data_url || "");
  const match = dataUrl.match(/^data:image\/jpe?g;base64,(.+)$/);
  if (!match) return null;
  const bytes = Buffer.from(match[1], "base64");
  const size = getJpegSize(bytes);
  if (!size) return null;
  return {
    bytes,
    width: size.width,
    height: size.height,
    name: String(photo.file_name || "Product photo").slice(0, 80),
  };
}

function getJpegSize(bytes) {
  if (!bytes || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset < bytes.length) {
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > bytes.length) return null;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isStartOfFrame && length >= 7) {
      return {
        height: bytes.readUInt16BE(offset + 3),
        width: bytes.readUInt16BE(offset + 5),
      };
    }
    offset += length;
  }
  return null;
}

function formatExpiration(value) {
  if (!value) return "N/A";
  const text = String(value);
  if (/^\d{4}-\d{2}$/.test(text)) {
    const [year, month] = text.split("-");
    return `${month}/${year}`;
  }
  return text;
}

function formatInvoiceStartDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toLocaleDateString("en-US");
  return date.toLocaleDateString("en-US");
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

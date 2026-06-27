import crypto from "node:crypto";
import express from "express";
import pg from "pg";

const { Pool } = pg;
const app = express();
const port = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === "production";
const mercuryPriceSheetCsvUrl =
  process.env.MERCURY_PRICE_SHEET_CSV_URL ||
  "https://docs.google.com/spreadsheets/d/1mZAIHlWJcicbfResT2X9kyf7iUcXo_1q35jwjSyMk2o/export?format=csv&gid=2027163115";
const followupDaysAfterFirstPurchase = 28;
let mercuryPriceCache = { fetchedAt: 0, rows: [] };

const requiredEnv = ["DATABASE_URL", "SESSION_SECRET", "ADMIN_USERNAME"];
for (const key of requiredEnv) {
  if (!process.env[key]) console.warn(`Missing ${key}`);
}

if (!process.env.ADMIN_PASSWORD_HASH && !process.env.ADMIN_PASSWORD) {
  console.warn("Missing ADMIN_PASSWORD_HASH. ADMIN_PASSWORD fallback is also not set.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
});

app.use(express.json({ limit: "8mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static("public", { extensions: ["html"] }));

await migrate();

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
    `select c.*, count(i.id)::int as invoice_count, coalesce(sum(i.total_paid),0)::numeric as total_paid
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
    where = `where lower(c.name) like $1 or c.phone like $1 or lower(c.email) like $1 or lower(c.address) like $1 or lower(c.location) like $1 or lower(c.source) like $1 or lower(c.notes) like $1`;
  }
  const result = await pool.query(
    `select c.*, count(i.id)::int as invoice_count, coalesce(sum(i.total_paid),0)::numeric as total_paid
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
      coalesce(sum(i.total_paid),0)::numeric as total_paid
     from invoice_batches b
     left join invoices i on i.batch_id = b.id
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

app.patch("/api/batches/:id/status", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const nextStatus = String(req.body?.status || "").trim();
  const soldTo = String(req.body?.sold_to || "").trim();
  const saleNotes = String(req.body?.sale_notes || "").trim();
  const trackingNumber = String(req.body?.tracking_number || "").trim();
  const salePrice = req.body?.sale_price === undefined || req.body?.sale_price === "" ? null : Number(req.body.sale_price);
  const allowed = new Set(["Active", "Sold", "Shipped"]);
  if (!id) return res.status(400).json({ error: "Invoice ID is required." });
  if (!allowed.has(nextStatus)) return res.status(400).json({ error: "Choose Active, Sold, or Shipped." });
  if ((nextStatus === "Sold" || nextStatus === "Shipped") && (!soldTo || !salePrice || salePrice <= 0)) {
    return res.status(400).json({ error: "Enter who bought it and what it sold for first." });
  }

  const result = await pool.query(
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
  if (!result.rows[0]) return res.status(404).json({ error: "Invoice not found." });
  res.json({ ok: true, batch: result.rows[0] });
});

app.get("/api/batches/:id/buyer-pdf", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).send("Invoice ID is required.");
  const batchResult = await pool.query("select * from invoice_batches where id = $1", [id]);
  const batch = batchResult.rows[0];
  if (!batch) return res.status(404).send("Invoice not found.");

  const batches = await attachPurchases([batch]);
  const fullBatch = batches[0];
  const mercuryPrices = await getMercuryPrices();
  const pdf = createBuyerInvoicePdf(fullBatch, mercuryPrices);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="buyer-invoice-${id}.pdf"`);
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
      crm_status: customerInput.crm_status || "Customer",
      next_follow_up_at: customerInput.next_follow_up_at || null,
    });
    const existingPurchaseResult = await client.query(
      "select exists (select 1 from invoices where customer_id = $1) as has_purchases",
      [customer.id]
    );
    const isFirstPurchase = !existingPurchaseResult.rows[0]?.has_purchases;

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
         next_follow_up_at = case when $3 then $2::date else next_follow_up_at end,
         updated_at = now()
       where id = $1`,
      [
        customer.id,
        addDays(invoiceInput.purchase_date || new Date().toISOString().slice(0, 10), followupDaysAfterFirstPurchase),
        isFirstPurchase,
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
  `);

  await pool.query(`
    alter table customers add column if not exists address text not null default '';
    alter table customers add column if not exists location text not null default '';
    alter table customers add column if not exists source text not null default '';
    alter table customers add column if not exists crm_status text not null default 'Customer';
    alter table customers add column if not exists next_follow_up_at date;
    alter table customers add column if not exists last_follow_up_at date;
    alter table invoice_batches add column if not exists sold_to text not null default '';
    alter table invoice_batches add column if not exists sale_price numeric(12,2);
    alter table invoice_batches add column if not exists sale_notes text not null default '';
    alter table invoice_batches add column if not exists tracking_number text not null default '';
    alter table invoice_batches add column if not exists sold_at timestamptz;
    alter table invoice_batches add column if not exists shipped_at timestamptz;
    alter table invoices add column if not exists batch_id integer references invoice_batches(id) on delete set null;
    alter table invoices add column if not exists status text not null default 'Active';
    alter table invoices add column if not exists status_updated_at timestamptz not null default now();
    update invoices set status = 'Active' where status is null or status = '';
  `);

  await pool.query(`
    insert into invoice_batches (label, status)
    select 'Open Invoice', 'Active'
    where not exists (select 1 from invoice_batches);

    update invoices
    set batch_id = (select id from invoice_batches order by id asc limit 1)
    where batch_id is null;
  `);
}

async function upsertCustomer(client, customer) {
  const result = await client.query(
    `insert into customers (name, phone, email, address, location, source, notes, crm_status, next_follow_up_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (phone) do update set
       name = coalesce(nullif(excluded.name,''), customers.name),
       email = coalesce(nullif(excluded.email,''), customers.email),
       address = coalesce(nullif(excluded.address,''), customers.address),
       location = coalesce(nullif(excluded.location,''), customers.location),
       source = coalesce(nullif(excluded.source,''), customers.source),
       crm_status = coalesce(nullif(excluded.crm_status,''), customers.crm_status),
       next_follow_up_at = coalesce(excluded.next_follow_up_at, customers.next_follow_up_at),
       notes = case
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

function parseMercuryPriceCsv(csv) {
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
      id: makePriceKey(productName),
      buyer: "Mercury",
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

function parseSession(req) {
  const cookies = Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim().split("="))
      .filter((pair) => pair.length === 2)
  );
  const token = cookies.dsb_session;
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
  const payload = Buffer.from(
    JSON.stringify({ username, exp: Date.now() + maxAgeSeconds * 1000 })
  ).toString("base64url");
  res.setHeader(
    "Set-Cookie",
    makeCookie("dsb_session", `${payload}.${sign(payload)}`, maxAgeSeconds)
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

function findMercuryProductForItem(item, mercuryPrices) {
  const itemText = normalizeMatchText(`${item.brand || ""} ${item.model || ""}`);
  if (!itemText) return null;
  return mercuryPrices.find((product) => normalizeMatchText(product.product) === itemText)
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

function createBuyerInvoicePdf(batch, mercuryPrices = []) {
  const groupedRows = new Map();
  const photos = [];
  let mercuryTotal = 0;
  for (const purchase of batch.purchases || []) {
    for (const item of purchase.items || []) {
      const product = findMercuryProductForItem(item, mercuryPrices);
      const quote = product ? getMercuryPriceForItem(product, item.expiration, item.condition) : null;
      const savedPrice = Number(item.expected_sell_each || 0);
      const unitPrice = quote?.price ?? (savedPrice > 0 ? savedPrice : null);
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
        if (existing.expiration !== row.expiration) existing.expiration = "Mixed";
      } else {
        groupedRows.set(rowKey, row);
      }
    }
    for (const photo of purchase.photos || []) {
      const image = parsePdfPhoto(photo);
      if (image) photos.push(image);
    }
  }
  const itemRows = Array.from(groupedRows.values());

  const lines = [
    { text: "SELL DIABETICS LLC", x: 50, y: 746, size: 20, font: "bold" },
    { text: "Buyer Invoice", x: 50, y: 724, size: 12, font: "bold" },
    { text: "Phone: 561-510-1236", x: 50, y: 706, size: 10 },
    { text: process.env.COMPANY_ADDRESS || "5100 Lake Worth Rd, Greenacres, FL 33463", x: 50, y: 690, size: 10 },
    { text: `Invoice #: ${batch.id}`, x: 410, y: 746, size: 11, font: "bold" },
    { text: `Date: ${new Date().toLocaleDateString("en-US")}`, x: 410, y: 728, size: 10 },
    { text: `Status: ${batch.status || "Active"}`, x: 410, y: 710, size: 10 },
    { text: batch.sold_to ? `Buyer: ${batch.sold_to}` : "Buyer: ", x: 410, y: 692, size: 10 },
    ...(batch.tracking_number ? [{ text: `Tracking: ${batch.tracking_number}`, x: 410, y: 674, size: 10 }] : []),
    { text: "Itemized Supplies", x: 50, y: 640, size: 14, font: "bold" },
    { text: "Qty", x: 54, y: 612, size: 8, font: "bold" },
    { text: "Description", x: 82, y: 612, size: 8, font: "bold" },
    { text: "Condition", x: 294, y: 612, size: 8, font: "bold" },
    { text: "Expiration", x: 370, y: 612, size: 8, font: "bold" },
    { text: "Unit Price", x: 448, y: 612, size: 8, font: "bold" },
    { text: "Line Total", x: 512, y: 612, size: 8, font: "bold" },
  ];

  let y = 590;
  for (const row of itemRows) {
    const descriptionLines = wrapPdfLine(row.description, 31).slice(0, 2);
    lines.push({ text: String(row.quantity), x: 54, y, size: 8 });
    lines.push({ text: descriptionLines[0] || "", x: 82, y, size: 8 });
    lines.push({ text: row.condition, x: 294, y, size: 8 });
    lines.push({ text: row.expiration, x: 370, y, size: 8 });
    lines.push({ text: row.unitPrice === null ? "" : formatCurrency(row.unitPrice), x: 448, y, size: 8 });
    lines.push({ text: row.lineTotal === null ? "" : formatCurrency(row.lineTotal), x: 512, y, size: 8 });
    if (descriptionLines[1]) {
      y -= 13;
      lines.push({ text: descriptionLines[1], x: 82, y, size: 8 });
    }
    y -= 24;
    if (y < 142) break;
  }

  const total = mercuryTotal > 0 ? mercuryTotal : Number(batch.sale_price || 0);
  lines.push({ text: `Invoice Total: ${formatCurrency(total)}`, x: 360, y: 108, size: 14, font: "bold" });
  if (batch.sale_notes) {
    lines.push({ text: `Notes: ${batch.sale_notes}`, x: 50, y: 86, size: 9 });
  }
  if (photos.length) {
    lines.push({ text: `Photos: Included on final page`, x: 50, y: 72, size: 9 });
  }
  lines.push({ text: "Thank you for your business.", x: 50, y: 58, size: 10, font: "bold" });

  return buildProfessionalPdf(lines, photos);
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

function formatCurrency(value) {
  return Number(value || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

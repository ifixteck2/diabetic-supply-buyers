import crypto from "node:crypto";
import express from "express";
import pg from "pg";

const { Pool } = pg;
const app = express();
const port = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === "production";

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
       next_follow_up_at = coalesce(nullif($2,'')::date, current_date + interval '30 days'),
       updated_at = now()
     where id = $1
     returning *`,
    [id, next]
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

app.patch("/api/batches/:id/status", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const nextStatus = String(req.body?.status || "").trim();
  const soldTo = String(req.body?.sold_to || "").trim();
  const saleNotes = String(req.body?.sale_notes || "").trim();
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
       sold_at = case when $1 in ('Sold','Shipped') and sold_at is null then now() else sold_at end,
       status_updated_at = now(),
       shipped_at = case when $1 = 'Shipped' then now() else shipped_at end
     where id = $2
     returning *`,
    [nextStatus, id, soldTo, salePrice, saleNotes]
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
  const pdf = createBuyerInvoicePdf(fullBatch);

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
         next_follow_up_at = coalesce(greatest(next_follow_up_at, $2::date), $2::date),
         updated_at = now()
       where id = $1`,
      [customer.id, addDays(invoiceInput.purchase_date || new Date().toISOString().slice(0, 10), 30)]
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
    alter table invoice_batches add column if not exists sold_at timestamptz;
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

function createBuyerInvoicePdf(batch) {
  const lines = [
    "Diabetic Supply Buyers",
    `Buyer Invoice #${batch.id}`,
    `Date: ${new Date().toLocaleDateString("en-US")}`,
    batch.sold_to ? `Buyer: ${batch.sold_to}` : "",
    "",
    "Items",
  ].filter(Boolean);

  for (const purchase of batch.purchases || []) {
    for (const item of purchase.items || []) {
      const description = [item.brand, item.model, item.condition, item.expiration ? `Exp ${item.expiration}` : ""]
        .filter(Boolean)
        .join(" - ");
      lines.push(`${item.quantity}x ${description}`);
    }
  }

  lines.push("");
  if (batch.sale_notes) lines.push(`Notes: ${batch.sale_notes}`);
  if (batch.sale_price) lines.push(`Invoice Total: ${formatCurrency(batch.sale_price)}`);

  return buildSimplePdf(lines);
}

function buildSimplePdf(lines) {
  const objects = [];
  const escapedLines = lines.flatMap((line) => wrapPdfLine(line, 84));
  const content = [
    "BT",
    "/F1 12 Tf",
    "50 750 Td",
    "16 TL",
    ...escapedLines.map((line) => `(${escapePdfText(line)}) Tj T*`),
    "ET",
  ].join("\n");

  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  objects.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "binary");
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

function formatCurrency(value) {
  return Number(value || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

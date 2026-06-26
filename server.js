import crypto from "node:crypto";
import express from "express";
import pg from "pg";

const { Pool } = pg;
const app = express();
const port = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === "production";

for (const key of ["DATABASE_URL", "SESSION_SECRET", "ADMIN_USERNAME"]) {
  if (!process.env[key]) console.warn(`Missing ${key}`);
}
if (!process.env.ADMIN_PASSWORD_HASH && !process.env.ADMIN_PASSWORD) console.warn("Missing admin password env.");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: isProduction ? { rejectUnauthorized: false } : false });
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static("public", { extensions: ["html"] }));
await migrate();

app.post("/api/login", async (req, res) => {
  const { username, password, remember } = req.body || {};
  const ok = username === process.env.ADMIN_USERNAME && (await verifyPassword(String(password || "")));
  if (!ok) return res.status(401).json({ error: "Invalid login." });
  setSessionCookie(res, username, remember ? 60 * 60 * 24 * 30 : 60 * 60 * 8);
  res.json({ ok: true, username });
});

app.post("/api/logout", (_req, res) => { res.setHeader("Set-Cookie", makeCookie("dsb_session", "", 0)); res.json({ ok: true }); });
app.get("/api/me", requireAuth, (req, res) => res.json({ ok: true, username: req.user.username }));

app.get("/api/customers/lookup", requireAuth, async (req, res) => {
  const phone = normalizePhone(req.query.phone || "");
  if (!phone) return res.status(400).json({ error: "Phone number is required." });
  const customer = await findCustomerByPhone(phone);
  if (!customer) return res.json({ customer: null, invoices: [] });
  res.json({ customer, invoices: await getCustomerHistory(customer.id) });
});

app.get("/api/customers", requireAuth, async (req, res) => {
  const search = String(req.query.search || "").trim();
  const params = [];
  let where = "";
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    where = `where lower(c.name) like $1 or c.phone like $1 or lower(c.email) like $1 or lower(c.location) like $1 or lower(c.source) like $1 or lower(c.notes) like $1`;
  }
  const result = await pool.query(
    `select c.*, count(i.id)::int as invoice_count, coalesce(sum(i.total_paid),0)::numeric as total_paid
     from customers c left join invoices i on i.customer_id = c.id ${where}
     group by c.id order by c.updated_at desc limit 100`,
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
    const customer = await upsertCustomer(client, { name: input.name || "", phone, email: input.email || "", location: input.location || "", source: input.source || "", notes: input.notes || "" });
    res.json({ ok: true, customer });
  } finally { client.release(); }
});

app.post("/api/batches", requireAuth, async (req, res) => {
  const label = String(req.body?.label || "").trim();
  const notes = String(req.body?.notes || "").trim();
  const result = await pool.query(`insert into invoice_batches (label, notes, status) values ($1, $2, 'Active') returning *`, [label || `Invoice ${new Date().toLocaleDateString("en-US")}`, notes]);
  res.json({ ok: true, batch: result.rows[0] });
});

app.get("/api/batches", requireAuth, async (req, res) => {
  const status = String(req.query.status || "Active").trim();
  const params = [];
  let where = "";
  if (status && status !== "All") { params.push(status); where = "where b.status = $1"; }
  const result = await pool.query(
    `select b.*, count(i.id)::int as purchase_count, coalesce(sum(i.total_paid),0)::numeric as total_paid
     from invoice_batches b left join invoices i on i.batch_id = b.id ${where}
     group by b.id order by b.created_at desc limit 100`,
    params
  );
  res.json({ batches: await attachPurchases(result.rows) });
});

app.patch("/api/batches/:id/status", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const nextStatus = String(req.body?.status || "").trim();
  const soldTo = String(req.body?.sold_to || "").trim();
  const saleNotes = String(req.body?.sale_notes || "").trim();
  const salePrice = req.body?.sale_price === undefined || req.body?.sale_price === "" ? null : Number(req.body.sale_price);
  if (!id) return res.status(400).json({ error: "Invoice ID is required." });
  if (!["Active", "Sold", "Shipped"].includes(nextStatus)) return res.status(400).json({ error: "Choose Active, Sold, or Shipped." });
  if ((nextStatus === "Sold" || nextStatus === "Shipped") && (!soldTo || !salePrice || salePrice <= 0)) return res.status(400).json({ error: "Enter who bought it and what it sold for first." });
  const result = await pool.query(
    `update invoice_batches set status = $1, sold_to = coalesce(nullif($3,''), sold_to), sale_price = coalesce($4, sale_price), sale_notes = coalesce(nullif($5,''), sale_notes), sold_at = case when $1 in ('Sold','Shipped') and sold_at is null then now() else sold_at end, status_updated_at = now(), shipped_at = case when $1 = 'Shipped' then now() else shipped_at end where id = $2 returning *`,
    [nextStatus, id, soldTo, salePrice, saleNotes]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "Invoice not found." });
  res.json({ ok: true, batch: result.rows[0] });
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
    const customer = await upsertCustomer(client, { name: customerInput.name || "", phone, email: customerInput.email || "", location: customerInput.location || "", source: customerInput.source || "", notes: customerInput.notes || "" });
    const totalPaid = items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_cost || 0), 0);
    const activeBatch = batchId ? await findBatch(client, batchId) : await getOrCreateActiveBatch(client);
    if (!activeBatch) throw new Error("Invoice batch not found.");
    const invoiceResult = await client.query(
      `insert into invoices (customer_id, batch_id, purchase_date, payout_method, total_paid, notes, status) values ($1, $2, $3, $4, $5, $6, 'Active') returning *`,
      [customer.id, activeBatch.id, invoiceInput.purchase_date || new Date().toISOString().slice(0, 10), invoiceInput.payout_method || "Cash", totalPaid, invoiceInput.notes || ""]
    );
    const invoice = invoiceResult.rows[0];
    for (const item of items) {
      await client.query(
        `insert into purchase_items (invoice_id, category, brand, model, quantity, expiration, condition, unit_cost, expected_sell_each, notes) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [invoice.id, item.category || "", item.brand || "", item.model || "", Number(item.quantity || 0), item.expiration || null, item.condition || "Sealed", Number(item.unit_cost || 0), Number(item.expected_sell_each || 0), item.notes || ""]
      );
    }
    await client.query("commit");
    res.json({ ok: true, customer, invoice, batch: activeBatch, items_saved: items.length });
  } catch (error) { await client.query("rollback"); console.error(error); res.status(500).json({ error: "Could not save purchase." }); } finally { client.release(); }
});

app.listen(port, () => console.log(`Diabetic Supply Buyers app running on ${port}`));

async function migrate() {
  await pool.query(`
    create table if not exists invoice_batches (id serial primary key, label text not null default '', notes text not null default '', status text not null default 'Active', sold_to text not null default '', sale_price numeric(12,2), sale_notes text not null default '', sold_at timestamptz, status_updated_at timestamptz not null default now(), shipped_at timestamptz, created_at timestamptz not null default now());
    create table if not exists customers (id serial primary key, name text not null default '', phone text not null unique, email text not null default '', location text not null default '', source text not null default '', notes text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    create table if not exists invoices (id serial primary key, customer_id integer not null references customers(id) on delete cascade, batch_id integer references invoice_batches(id) on delete set null, purchase_date date not null default current_date, payout_method text not null default 'Cash', total_paid numeric(12,2) not null default 0, notes text not null default '', status text not null default 'Active', status_updated_at timestamptz not null default now(), created_at timestamptz not null default now());
    create table if not exists purchase_items (id serial primary key, invoice_id integer not null references invoices(id) on delete cascade, category text not null default '', brand text not null default '', model text not null default '', quantity integer not null default 1, expiration text, condition text not null default 'Sealed', unit_cost numeric(12,2) not null default 0, expected_sell_each numeric(12,2) not null default 0, notes text not null default '', created_at timestamptz not null default now());
  `);
  await pool.query(`
    alter table customers add column if not exists location text not null default '';
    alter table customers add column if not exists source text not null default '';
    alter table invoice_batches add column if not exists sold_to text not null default '';
    alter table invoice_batches add column if not exists sale_price numeric(12,2);
    alter table invoice_batches add column if not exists sale_notes text not null default '';
    alter table invoice_batches add column if not exists sold_at timestamptz;
    alter table invoices add column if not exists batch_id integer references invoice_batches(id) on delete set null;
    alter table invoices add column if not exists status text not null default 'Active';
    alter table invoices add column if not exists status_updated_at timestamptz not null default now();
    update invoices set status = 'Active' where status is null or status = '';
  `);
  await pool.query(`insert into invoice_batches (label, status) select 'Open Invoice', 'Active' where not exists (select 1 from invoice_batches); update invoices set batch_id = (select id from invoice_batches order by id asc limit 1) where batch_id is null;`);
}

async function upsertCustomer(client, customer) {
  const result = await client.query(
    `insert into customers (name, phone, email, location, source, notes) values ($1,$2,$3,$4,$5,$6) on conflict (phone) do update set name = coalesce(nullif(excluded.name,''), customers.name), email = coalesce(nullif(excluded.email,''), customers.email), location = coalesce(nullif(excluded.location,''), customers.location), source = coalesce(nullif(excluded.source,''), customers.source), notes = case when excluded.notes = '' then customers.notes when customers.notes = '' then excluded.notes else customers.notes || E'\\n' || excluded.notes end, updated_at = now() returning *`,
    [customer.name, customer.phone, customer.email, customer.location, customer.source, customer.notes]
  );
  return result.rows[0];
}
async function findCustomerByPhone(phone) { const result = await pool.query("select * from customers where phone = $1", [phone]); return result.rows[0] || null; }
async function findBatch(client, batchId) { const result = await client.query("select * from invoice_batches where id = $1", [batchId]); return result.rows[0] || null; }
async function getOrCreateActiveBatch(client) { const existing = await client.query("select * from invoice_batches where status = 'Active' order by created_at desc limit 1"); if (existing.rows[0]) return existing.rows[0]; const created = await client.query(`insert into invoice_batches (label, status) values ($1, 'Active') returning *`, [`Invoice ${new Date().toLocaleDateString("en-US")}`]); return created.rows[0]; }
async function getCustomerHistory(customerId) { const invoices = await pool.query(`select i.*, b.status as batch_status, b.label as batch_label, b.id as batch_id from invoices i left join invoice_batches b on b.id = i.batch_id where i.customer_id = $1 order by i.purchase_date desc, i.created_at desc`, [customerId]); const invoiceIds = invoices.rows.map((invoice) => invoice.id); if (!invoiceIds.length) return []; const items = await pool.query(`select * from purchase_items where invoice_id = any($1::int[]) order by id asc`, [invoiceIds]); return invoices.rows.map((invoice) => ({ ...invoice, items: items.rows.filter((item) => item.invoice_id === invoice.id) })); }
async function attachPurchases(batches) { const batchIds = batches.map((batch) => batch.id); if (!batchIds.length) return []; const purchases = await pool.query(`select i.*, c.name as customer_name, c.phone as customer_phone from invoices i join customers c on c.id = i.customer_id where i.batch_id = any($1::int[]) order by i.purchase_date desc, i.created_at desc`, [batchIds]); const purchasesWithItems = await attachItems(purchases.rows); return batches.map((batch) => ({ ...batch, purchases: purchasesWithItems.filter((purchase) => purchase.batch_id === batch.id) })); }
async function attachItems(invoices) { const invoiceIds = invoices.map((invoice) => invoice.id); if (!invoiceIds.length) return []; const items = await pool.query(`select * from purchase_items where invoice_id = any($1::int[]) order by id asc`, [invoiceIds]); return invoices.map((invoice) => ({ ...invoice, items: items.rows.filter((item) => item.invoice_id === invoice.id) })); }
function requireAuth(req, res, next) { const session = parseSession(req); if (!session) return res.status(401).json({ error: "Login required." }); req.user = session; next(); }
function parseSession(req) { const cookies = Object.fromEntries(String(req.headers.cookie || "").split(";").map((part) => part.trim().split("=")).filter((pair) => pair.length === 2)); const token = cookies.dsb_session; if (!token) return null; const [payloadB64, sig] = token.split("."); if (!payloadB64 || !sig) return null; const expected = sign(payloadB64); if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null; try { const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")); if (!payload.exp || payload.exp < Date.now()) return null; return { username: payload.username }; } catch { return null; } }
function setSessionCookie(res, username, maxAgeSeconds) { const payload = Buffer.from(JSON.stringify({ username, exp: Date.now() + maxAgeSeconds * 1000 })).toString("base64url"); res.setHeader("Set-Cookie", makeCookie("dsb_session", `${payload}.${sign(payload)}`, maxAgeSeconds)); }
function makeCookie(name, value, maxAgeSeconds) { const secure = isProduction ? "; Secure" : ""; return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure}`; }
function sign(value) { return crypto.createHmac("sha256", process.env.SESSION_SECRET || "dev-secret").update(value).digest("base64url"); }
async function verifyPassword(password) { if (process.env.ADMIN_PASSWORD_HASH) return verifyScrypt(password, process.env.ADMIN_PASSWORD_HASH); return password === process.env.ADMIN_PASSWORD; }
function verifyScrypt(password, stored) { const [scheme, salt, hash] = String(stored).split("$"); if (scheme !== "scrypt" || !salt || !hash) return false; const computed = crypto.scryptSync(password, salt, 64).toString("base64url"); return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(computed)); }
function normalizePhone(phone) { return String(phone).replace(/\D/g, "").slice(-10); }

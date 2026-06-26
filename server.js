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

app.use(express.json({ limit: "1mb" }));
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

app.get("/api/customers", requireAuth, async (req, res) => {
  const search = String(req.query.search || "").trim();
  const params = [];
  let where = "";
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    where = `where lower(c.name) like $1 or c.phone like $1 or lower(c.email) like $1`;
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

app.post("/api/purchases", requireAuth, async (req, res) => {
  const body = req.body || {};
  const customerInput = body.customer || {};
  const invoiceInput = body.invoice || {};
  const items = Array.isArray(body.items) ? body.items : [];

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
      notes: customerInput.notes || "",
    });

    const totalPaid = items.reduce(
      (sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_cost || 0),
      0
    );

    const invoiceResult = await client.query(
      `insert into invoices (customer_id, purchase_date, payout_method, total_paid, notes, status)
       values ($1, $2, $3, $4, $5, 'Active')
       returning *`,
      [
        customer.id,
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

    await client.query("commit");
    res.json({ ok: true, customer, invoice, items_saved: items.length });
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
    `select i.*, c.name as customer_name, c.phone as customer_phone
     from invoices i
     join customers c on c.id = i.customer_id
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
    create table if not exists customers (
      id serial primary key,
      name text not null default '',
      phone text not null unique,
      email text not null default '',
      notes text not null default '',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists invoices (
      id serial primary key,
      customer_id integer not null references customers(id) on delete cascade,
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
  `);

  await pool.query(`
    alter table invoices add column if not exists status text not null default 'Active';
    alter table invoices add column if not exists status_updated_at timestamptz not null default now();
    update invoices set status = 'Active' where status is null or status = '';
  `);
}

async function upsertCustomer(client, customer) {
  const result = await client.query(
    `insert into customers (name, phone, email, notes)
     values ($1,$2,$3,$4)
     on conflict (phone) do update set
       name = coalesce(nullif(excluded.name,''), customers.name),
       email = coalesce(nullif(excluded.email,''), customers.email),
       notes = case
         when excluded.notes = '' then customers.notes
         when customers.notes = '' then excluded.notes
         else customers.notes || E'\\n' || excluded.notes
       end,
       updated_at = now()
     returning *`,
    [customer.name, customer.phone, customer.email, customer.notes]
  );
  return result.rows[0];
}

async function findCustomerByPhone(phone) {
  const result = await pool.query("select * from customers where phone = $1", [phone]);
  return result.rows[0] || null;
}

async function getCustomerHistory(customerId) {
  const invoices = await pool.query(
    `select * from invoices where customer_id = $1 order by purchase_date desc, created_at desc`,
    [customerId]
  );
  const invoiceIds = invoices.rows.map((invoice) => invoice.id);
  if (!invoiceIds.length) return [];
  const items = await pool.query(
    `select * from purchase_items where invoice_id = any($1::int[]) order by id asc`,
    [invoiceIds]
  );
  return invoices.rows.map((invoice) => ({
    ...invoice,
    items: items.rows.filter((item) => item.invoice_id === invoice.id),
  }));
}

async function attachItems(invoices) {
  const invoiceIds = invoices.map((invoice) => invoice.id);
  if (!invoiceIds.length) return [];
  const items = await pool.query(
    `select * from purchase_items where invoice_id = any($1::int[]) order by id asc`,
    [invoiceIds]
  );
  return invoices.map((invoice) => ({
    ...invoice,
    items: items.rows.filter((item) => item.invoice_id === invoice.id),
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

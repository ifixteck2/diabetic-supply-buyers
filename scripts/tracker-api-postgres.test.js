import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

// Point PGLITE_TEST_MODULE at an isolated @electric-sql/pglite installation.
test("all GPT tracker actions run against PostgreSQL with bearer authentication", { skip: !process.env.PGLITE_TEST_MODULE }, async (t) => {
  const { PGlite } = await import(pathToFileURL(process.env.PGLITE_TEST_MODULE).href);
  const db = new PGlite();
  t.after(() => db.close());
  const source = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
  const schema = JSON.parse(fs.readFileSync(new URL("../public/online-orders-openapi.json", import.meta.url), "utf8"));
  const ddlStart = source.indexOf("create table if not exists online_order_portal_monthly_tracker (");
  const ddlEnd = source.indexOf("create table if not exists app_migrations (", ddlStart);
  await db.exec(source.slice(ddlStart, ddlEnd));
  const routes = new Map(), exercised = new Set();
  const app = Object.fromEntries(["get", "post", "patch", "delete"].map((method) => [method, (path, ...handlers) => routes.set(`${method} ${path}`, handlers)]));
  const fakeToken = "disposable-local-api-test-token";
  const sandbox = {
    app, console, Buffer, crypto, process: { env: { ONLINE_ORDERS_API_TOKEN: fakeToken } },
    localDateInTimeZone: () => "2026-09-04",
    parseNamedSession: (req, name) => req.testSession === name ? { username: "local-test" } : null,
    onlineOrdersOnlyTables: { tracker: "online_order_portal_monthly_tracker", trackerSettings: "online_order_portal_monthly_settings", payables: "online_order_portal_payables" },
    pool: { query: (sql, args) => db.query(sql, args), connect: async () => ({ query: (sql, args) => db.query(sql, args), release() {} }) },
  };
  vm.createContext(sandbox);
  vm.runInContext(source.slice(source.indexOf("function requireOnlineOrdersAuth("), source.indexOf("function parseSession(")), sandbox);
  vm.runInContext(source.slice(source.indexOf('app.get("/api/online-orders-me",'), source.indexOf('app.get("/online-orders.html",')), sandbox);
  vm.runInContext(source.slice(source.indexOf('app.get("/api/online-monthly-tracker",'), source.indexOf('app.post("/api/phone-online-orders",')), sandbox);

  async function call(method, path, { body = {}, query = {}, id, token = fakeToken, header, session } = {}) {
    const key = `${method} ${path}`;
    const handlers = routes.get(key);
    assert.ok(handlers, `Route exists: ${key}`);
    const req = { body, query, params: { id: String(id || "") }, testSession: session,
      get(name) { return name.toLowerCase() === "authorization" ? token ? `Bearer ${token}` : "" : name.toLowerCase() === "x-online-orders-only" ? header : undefined; } };
    const res = { statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; }, setHeader(name, value) { this.headers[name] = value; }, json(value) { this.body = JSON.parse(JSON.stringify(value)); return this; } };
    let authorized = false;
    await handlers[0](req, res, () => { authorized = true; });
    if (authorized) { await handlers[1](req, res); exercised.add(key); }
    return res;
  }

  for (const [path, methods] of Object.entries(schema.paths)) for (const method of Object.keys(methods)) {
    const route = path.replaceAll("{id}", ":id");
    assert.ok(routes.has(`${method} ${route}`));
    assert.equal((await call(method, route, { token: "wrong", id: 999 })).statusCode, 401);
    assert.equal((await call(method, route, { token: "", id: 999 })).statusCode, 401);
  }
  assert.equal((await call("get", "/api/online-monthly-tracker", { token: "", session: "phone_session" })).statusCode, 403);
  assert.equal((await call("get", "/api/online-monthly-tracker", { token: "", session: "online_orders_session", header: "1" })).statusCode, 200);
  const connection = await call("get", "/api/online-orders-me");
  assert.equal(connection.body.ok, true);
  assert.equal(connection.body.portal, "online_orders");

  const entryIds = [];
  for (const [entry_type, amount] of [["Phone Profit", 110], ["Expense", 19.72], ["Cash In", 50], ["Cash Out", 10]]) {
    const result = await call("post", "/api/online-monthly-tracker", { body: { month: "2026-09", entry_type, amount, entry_date: "2026-09-02", description: "Disposable API test" } });
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.ok, true);
    entryIds.push(result.body.entry.id);
  }
  assert.equal((await call("patch", "/api/online-monthly-tracker/:id", { id: entryIds[0], body: { amount: 120, notes: "Corrected" } })).body.entry.amount, "120.00");
  assert.equal((await call("get", "/api/online-monthly-tracker", { query: { month: "2026-09", history_months: 6 } })).body.entries.length, 4);
  assert.equal((await call("delete", "/api/online-monthly-tracker/:id", { id: entryIds[2] })).body.ok, true);

  await call("patch", "/api/online-monthly-tracker/settings", { body: { month: "2026-09", monthly_budget: 21150, food_budget: 800, notes: "Keep this note" } });
  const partial = await call("patch", "/api/online-monthly-tracker/settings", { body: { month: "2026-09", food_budget: 900 } });
  assert.equal(Number(partial.body.settings.monthly_budget), 21150, "PATCH must preserve omitted profit target");
  assert.equal(partial.body.settings.notes, "Keep this note");
  assert.equal(Number(partial.body.settings.food_budget), 900);

  const billResult = await call("post", "/api/online-payables", { body: { title: "Disposable test bill", amount: 100, due_date: "2026-09-01", category: "Food", is_monthly: false } });
  assert.equal(billResult.statusCode, 200);
  const billId = billResult.body.payable.id;
  let result = await call("post", "/api/online-payables/:id/payments", { id: billId, body: { amount: 25, payment_date: "2026-08-31", payment_method: "Cash", notes: "First part" } });
  assert.equal(result.body.ok, true);
  assert.equal(Number(result.body.payable.balance_remaining), 75);
  result = await call("get", "/api/online-payables");
  assert.equal(result.body.payables[0].payments.length, 1);
  assert.equal(result.body.payables[0].payments[0].payment_date, "2026-08-31");
  result = await call("patch", "/api/online-payables/:id/status", { id: billId, body: { status: "Paid" } });
  assert.equal(result.body.ok, true);
  assert.equal(Number(result.body.payable.paid_amount), 100);
  assert.equal(Number(result.body.payable.balance_remaining), 0);
  await call("patch", "/api/online-payables/:id/status", { id: billId, body: { status: "Paid" } });
  result = await call("get", "/api/online-payables");
  assert.equal(result.body.payables[0].payments.length, 2, "Marking Paid twice must not duplicate payments");
  assert.ok(result.body.payables[0].payments.some((payment) => payment.payment_date === "2026-09-04"), "Paid date uses the business timezone");
  await call("patch", "/api/online-payables/:id/status", { id: billId, body: { status: "Unpaid" } });
  result = await call("get", "/api/online-payables");
  assert.equal(Number(result.body.payables[0].paid_amount), 0);
  assert.equal(result.body.payables[0].payments.length, 0);
  result = await call("post", "/api/online-payables/:id/payments", { id: billId, body: { amount: 100, payment_date: "2026-09-04" } });
  assert.equal(result.body.payable.status, "Paid");
  assert.equal((await call("delete", "/api/online-payables/:id", { id: billId })).body.ok, true);
  assert.equal((await call("get", "/api/online-payables")).body.payables.length, 0);
  assert.equal((await db.query("select count(*)::int as n from online_order_portal_payable_payments")).rows[0].n, 0);
  for (const [path, methods] of Object.entries(schema.paths)) for (const method of Object.keys(methods)) assert.ok(exercised.has(`${method} ${path.replaceAll("{id}", ":id")}`));
  assert.equal(routes.size, 11);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import "../public/financial-core.js";
const F = globalThis.FinancialCore;
const entry = (id, type, amount, rest = {}) => ({ id, entry_type: type, amount, entry_month: "2026-09-01", entry_date: "2026-09-04", quantity: 1, ...rest });
const report = (entries = [], bills = [], rest = {}) => F.report({ entries, bills, month: "2026-09", today: "2026-09-04", settings: { monthly_budget: 21150, food_budget: 800 }, ...rest });

test("reconciles the user's starting figures without counting cash injections as profit", () => {
  const r = report([entry(1, "Phone Profit", 745, { quantity: 4, source: "Miami", entry_date: "2026-08-31" }), entry(2, "Phone Profit", 110), entry(3, "Expense", 50.44, { category: "Food" }), entry(4, "Expense", 100), entry(5, "Cash In", 200), entry(6, "Cash Out", 30)]);
  assert.equal(r.profit, 855);
  assert.equal(r.spent, 150.44);
  assert.equal(r.net, 874.56);
  assert.equal(r.targetLeft, 20295);
  assert.equal(r.daysLeft, 27);
  assert.equal(r.neededPerDay, 751.67);
  assert.equal(r.quantity, 5);
  assert.equal(r.profitPerPhone, 171);
  assert.equal(r.foodRemaining, 749.56);
  assert.equal(r.daily[0].net, 745);
  assert.equal(r.rows.at(-1).movement, r.net);
  assert.equal(r.daily.at(-1).net, r.net);
});

test("partial payments belong to payment month, include food payments, and do not double count paid_amount", () => {
  const bill = { id: 1, title: "Food", amount: 800, paid_amount: 150, status: "Unpaid", due_date: "2026-09-01", category: "Food", payments: [{ id: 1, payment_date: "2026-08-31", amount: 50 }, { id: 2, payment_date: "2026-09-02", amount: 100 }] };
  const r = report([entry(1, "Phone Profit", 855)], [bill]);
  assert.equal(r.billPaid, 100);
  assert.equal(r.net, 755);
  assert.equal(r.foodSpent, 100);
  assert.equal(r.outstanding, 650);
  assert.equal(r.afterBills, 105);
  assert.equal(r.rows.filter((row) => row.kind === "payment").length, 1);
  assert.equal(report([], [bill], { month: "2026-08" }).billPaid, 50);
});

test("future bills are excluded, earlier unpaid bills remain visible, legacy payments counted once", () => {
  const bills = [
    { id: 1, title: "Prior", amount: 100, paid_amount: 10, status: "Unpaid", due_date: "2026-08-20" },
    { id: 2, title: "Future", amount: 500, status: "Unpaid", due_date: "2026-10-01" },
    { id: 3, title: "Paid", amount: 45, status: "Paid", paid_amount: 0, paid_at: "2026-09-01T16:00:00Z", due_date: "2026-09-01" },
  ];
  assert.equal(report([], bills).outstanding, 90);
  assert.equal(report([], bills).billPaid, 45);
  assert.equal(report([], bills).overdue.length, 1);
});

test("long term balances decrease by payments without becoming negative", () => {
  const [debt] = F.debts([{ amount: 10000, long_term_months: 18, paid_amount: 500, status: "Unpaid" }]);
  assert.equal(debt.original, 180000);
  assert.equal(debt.remaining, 179500);
  assert.equal(F.debts([{ long_term_balance: 100, paid_amount: 101 }])[0].remaining, 0);
});

test("handles leap years, ended months, future months, target met, and no records", () => {
  assert.equal(report([], [], { month: "2024-02" }).days, 29);
  assert.equal(report([], [], { month: "2024-02" }).neededPerDay, null);
  assert.equal(report([], [], { month: "2026-10" }).daysLeft, 31);
  assert.equal(report([entry(1, "Phone Profit", 22000)]).neededPerDay, 0);
  assert.equal(report().net, 0);
  assert.equal(report().profitPerPhone, 0);
  assert.equal(F.shiftMonth("2026-01", -1), "2025-12");
});

test("cent precision and signed ledger reconcile over thousands of transactions", () => {
  const entries = Array.from({ length: 4000 }, (_, id) => entry(id, id % 2 ? "Expense" : "Phone Profit", id % 2 ? 0.1 : 0.3));
  const r = report(entries);
  assert.equal(r.net, 400);
  assert.equal(r.rows.at(-1).movement, 400);
  assert.equal(r.daily.at(-1).net, 400);
});

test("CSV quotes commas/newlines and neutralizes spreadsheet formula injection", () => {
  const rows = report([entry(1, "Phone Profit", 10, { description: '=HYPERLINK("bad")', notes: "hello,\nworld" })]).rows;
  const output = F.csv(rows);
  assert.ok(output.includes('"\'=HYPERLINK(""bad"")"'));
  assert.ok(output.includes('"hello,\nworld"'));
  assert.ok(output.includes("Running month net"));
});

test("edit endpoint rejects invalid money, quantity, date, and unauthorized portal access", async () => {
  const source = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.patch("/api/online-monthly-tracker/:id",');
  const end = source.indexOf('app.delete("/api/online-monthly-tracker/:id",', start);
  let handler, queryCount = 0, queryValues;
  const sandbox = { app: { patch: (_route, _auth, fn) => { handler = fn; } }, requireOnlineOrdersAuth() {}, onlineOrdersOnlyTables: { tracker: "online_order_portal_monthly_tracker" }, normalizeTrackerEntryType: (type) => ["Phone Profit", "Expense", "Cash In", "Cash Out"].includes(type) ? type : "", console, pool: { async query(_sql, values) { queryCount++; queryValues = values; return { rows: [{ id: 7 }] }; } } };
  vm.runInNewContext(source.slice(start, end), sandbox);
  async function request(body, only = true) {
    const res = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.body = value; } };
    await handler({ params: { id: "7" }, body, onlineOrdersOnly: only }, res);
    return res;
  }
  for (const body of [{ amount: -1 }, { amount: "bad" }, { amount: 0 }, { quantity: 1.5 }, { entry_date: "2026-02-30" }, { month: "2026-13" }, { entry_type: "Revenue" }]) assert.equal((await request(body)).code, 400);
  assert.equal((await request({ amount: 10 }, false)).code, 403);
  assert.equal(queryCount, 0);
  assert.equal((await request({ amount: 19.72, description: "Corrected" })).code, 200);
  assert.equal(queryValues[4], 19.72);
  assert.equal(queryValues[9], "Corrected");
  assert.equal(queryValues[1], null);
  assert.equal(queryValues[6], null);
});

test("six month read keeps portal isolation and returns selected entries plus history", async () => {
  const source = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.get("/api/online-monthly-tracker",');
  const end = source.indexOf('app.patch("/api/online-monthly-tracker/settings",', start);
  let handler, calls = [];
  vm.runInNewContext(source.slice(start, end), { app: { get: (_path, _auth, fn) => { handler = fn; } }, requireOnlineOrdersAuth() {}, localDateInTimeZone: () => "2026-09-04", normalizeMonthInput: (value) => value, onlineOrdersOnlyTables: { tracker: "tracker", trackerSettings: "settings" }, console, pool: { async query(sql, values) { calls.push({ sql, values }); return { rows: [] }; } } });
  const res = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.body = value; } };
  await handler({ onlineOrdersOnly: false, query: {} }, res);
  assert.equal(res.code, 403);
  await handler({ onlineOrdersOnly: true, query: { history_months: 13 } }, res);
  assert.equal(res.code, 400);
  assert.equal(calls.length, 0);
  await handler({ onlineOrdersOnly: true, query: { month: "2026-09", history_months: 6 } }, res);
  assert.equal(calls.length, 3);
  assert.equal(res.body.month, "2026-09");
  assert.equal(calls[2].values[1], 6);
  assert.ok(Array.isArray(res.body.history_entries));
});

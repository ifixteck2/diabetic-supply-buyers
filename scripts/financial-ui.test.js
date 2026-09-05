import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

test("financial screen wiring renders records, filters, edits, and saves a dated partial payment", async () => {
  const html = fs.readFileSync(new URL("../public/phone-admin.html", import.meta.url), "utf8");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "HTML IDs must be unique");
  const control = () => ({ value: "", textContent: "", innerHTML: "", disabled: false, open: false,
    get options() { return [...this.innerHTML.matchAll(/<option value="([^"]*)"/g)].map((match) => ({ value: match[1] })); },
    classList: { toggle() {}, add() {}, remove() {} },
    parentElement: { classList: { toggle() {} } },
    addEventListener() {}, setAttribute() {}, reset() {}, reportValidity() { return true; },
    showModal() { this.open = true; }, close() { this.open = false; }, focus() {},
  });
  const controls = new Map(ids.map((id) => [id, control()]));
  controls.get("financialBillFilter").value = "open";
  const data = {
    entries: [{ id: 1, entry_month: "2026-09-01", entry_date: "2026-09-04", entry_type: "Phone Profit", amount: 110, quantity: 1, source: "Metro", phone_model: "A37", description: '<img src=x onerror="bad()">' }],
    bills: [{ id: 2, title: "Rent", amount: 500, paid_amount: 0, due_date: "2026-09-01", status: "Unpaid", payments: [] }],
  };
  const requests = [];
  let failed = false;
  const sandbox = { console, setTimeout, clearTimeout, Date, URL, Blob, Intl,
    document: { body: { dataset: { portal: "online-orders" } }, getElementById: (id) => controls.get(id) || null, querySelectorAll: () => [], querySelector: () => control() },
    alert(message) { throw Error(message); }, confirm: () => true,
    fetch: async (url, options) => {
      const body = options.body ? JSON.parse(options.body) : null;
      requests.push({ url, method: options.method, body });
      assert.equal(options.headers["X-Online-Orders-Only"], "1");
      let result = {};
      if (url.includes("/api/online-orders-me")) result = { ok: false };
      else if (url.startsWith("/api/online-monthly-tracker?")) result = failed ? { error: "Records unavailable" } : { entries: data.entries, history_entries: data.entries, settings: { monthly_budget: 21150, food_budget: 800 } };
      else if (url === "/api/online-payables") result = { payables: data.bills };
      else if (url === "/api/online-monthly-tracker/1" && options.method === "PATCH") { Object.assign(data.entries[0], body); result = { ok: true }; }
      else if (url === "/api/online-payables/2/payments" && options.method === "POST") { data.bills[0].paid_amount = body.amount; data.bills[0].payments.push({ id: 3, ...body }); result = { ok: true }; }
      else throw Error(`Unexpected request: ${url}`);
      return { ok: true, text: async () => JSON.stringify(result) };
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const name of ["financial-core.js", "financial-tracker.js", "phone-admin.js"]) vm.runInContext(fs.readFileSync(new URL(`../public/${name}`, import.meta.url), "utf8"), sandbox, { filename: name });
  controls.get("monthlyTrackerMonth").value = "2026-09";
  await vm.runInContext("loadMonthlyTracker()", sandbox);
  await vm.runInContext("loadOnlinePayables()", sandbox);
  assert.ok(controls.get("financialOverview").innerHTML.includes("Monthly Statement"));
  assert.ok(controls.get("financialOverview").innerHTML.includes("&lt;img"));
  assert.ok(!controls.get("financialOverview").innerHTML.includes('<img src=x'));
  assert.ok(controls.get("monthlyTrackerStats").innerHTML.includes("$110.00"));
  vm.runInContext("FinancialTracker.setView('transactions'); FinancialTracker.openEntry(1)", sandbox);
  assert.equal(controls.get("financialEntryDialog").open, true);
  assert.equal(controls.get("monthlyTrackerAmount").value, 110);
  controls.get("monthlyTrackerAmount").value = "120";
  await vm.runInContext("saveMonthlyTrackerEntry()", sandbox);
  assert.equal(controls.get("financialEntryDialog").open, false);
  assert.ok(requests.some((request) => request.method === "PATCH" && request.body.amount === 120));
  vm.runInContext("FinancialTracker.openPayment(2)", sandbox);
  assert.equal(controls.get("financialPaymentDialog").open, true);
  controls.get("financialPaymentAmount").value = "50";
  controls.get("financialPaymentDate").value = "2026-09-02";
  await controls.get("financialPaymentForm").onsubmit({ preventDefault() {} });
  assert.equal(controls.get("financialPaymentDialog").open, false);
  assert.ok(controls.get("onlinePayablesList").innerHTML.includes("Partially Paid"));
  assert.ok(controls.get("monthlyTrackerList").innerHTML.includes("Bill Payment"));
  assert.ok(controls.get("monthlyTrackerStats").innerHTML.includes("$70.00"));
  assert.equal(requests.find((request) => request.url.endsWith("/payments")).body.payment_date, "2026-09-02");
  failed = true;
  await vm.runInContext("loadMonthlyTracker()", sandbox);
  assert.equal(controls.get("monthlyTrackerStats").innerHTML, "");
  assert.equal(controls.get("financialLoadStatus").textContent, "Records unavailable");
  assert.equal(controls.get("saveMonthlyTrackerSettingsBtn").disabled, true);
});

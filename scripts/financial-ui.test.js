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
    showModal() { this.open = true; }, close() { this.open = false; }, focus() {}, scrollIntoView() {},
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
      else if (url === "/api/online-payables" && options.method === "POST") { data.bills.push({ id: 40, ...body, payments: [], paid_amount: 0 }); result = { ok: true }; }
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
  data.bills[0].category = "FOOD";
  const expense = { entry_month: "2026-09-01", entry_date: "2026-09-04", entry_type: "Expense", quantity: 1 };
  data.entries.push(
    { ...expense, id: 3, amount: 12.1, category: "Food", description: "Popeyes test" },
    { ...expense, id: 4, amount: 5.9, category: " food ", description: "Lunch test" },
    { ...expense, id: 5, amount: 90, category: "Food", entry_type: "Cash Out", description: "Transfer test" },
    { ...expense, id: 6, amount: 45, category: "Food", entry_type: "Phone Profit", description: "Sale test" },
    { ...expense, id: 7, amount: 20, category: "Shipping", description: "Shipping test" },
    { ...expense, id: 8, amount: 88, category: "Food", entry_month: "2026-08-01", description: "Previous month test" },
  );
  await vm.runInContext("loadMonthlyTracker();", sandbox);
  await vm.runInContext("loadOnlinePayables();", sandbox);
  controls.get("financialSearch").value = "unmatched old search";
  controls.get("financialTypeFilter").value = "Cash In";
  const categoryAction = controls.get("financialOverview").innerHTML.match(/onclick="(FinancialTracker.openSpendingCategory\(\d+\))" aria-label="View FOOD spending/);
  assert.ok(categoryAction, "Spending category renders a clickable control");
  vm.runInContext(categoryAction[1], sandbox);
  assert.equal(controls.get("financialSearch").value, "");
  assert.equal(controls.get("financialTypeFilter").value, "spending");
  const detail = controls.get("monthlyTrackerList").innerHTML;
  assert.ok(detail.includes("3 transactions"));
  assert.ok(detail.includes("$68.00"), "Detail total matches the category total");
  for (const description of ["Popeyes test", "Lunch test", "Bill Payment"]) assert.ok(detail.includes(description));
  for (const description of ["Transfer test", "Sale test", "Shipping test", "Previous month test"]) assert.ok(!detail.includes(description));
  data.entries.push({ ...expense, id: 9, amount: 250.25, entry_type: "Stocks Profit", category: "Stocks Profit", description: "Realized stock profit test" });
  await vm.runInContext("loadMonthlyTracker()", sandbox);
  const stockAction = controls.get("financialOverview").innerHTML.match(/onclick="(FinancialTracker.openStocksProfit\(\))"/);
  assert.ok(stockAction, "Stocks profit has its own clickable statement line");
  assert.ok(controls.get("financialOverview").innerHTML.includes('<th class="num">Stocks Profit</th>'));
  assert.ok(controls.get("monthlyTrackerStats").innerHTML.includes("Total Profit"));
  assert.ok(controls.get("monthlyTrackerStats").innerHTML.includes("$415.25"));
  vm.runInContext(stockAction[1], sandbox);
  assert.equal(controls.get("financialTypeFilter").value, "Stocks Profit");
  assert.equal(controls.get("financialCategoryFilter").value, "");
  assert.ok(controls.get("monthlyTrackerList").innerHTML.includes("1 transactions"));
  assert.ok(controls.get("monthlyTrackerList").innerHTML.includes("Realized stock profit test"));
  assert.ok(!controls.get("monthlyTrackerList").innerHTML.includes("Popeyes test"));
  vm.runInContext("FinancialTracker.openEntry(9)", sandbox);
  assert.equal(controls.get("monthlyTrackerType").value, "Stocks Profit");

  data.bills.push(
    { id: 10, title: "Phone", amount: 200, due_date: "2026-09-14", category: "Business" },
    { id: 11, title: "Insurance", amount: 750, due_date: "2026-09-21" },
    { id: 12, title: "Upcoming rent", amount: 2950, due_date: "2026-10-01" },
    { id: 13, title: "Undated bill", amount: 50 },
    { id: 14, title: "Settled bill", amount: 100, paid_amount: 100, due_date: "2026-09-01", payments: [{ payment_date: "2026-09-04", amount: 100 }] },
    { id: 15, title: '<img src=x onerror="bad()">', amount: 800, due_date: "2026-09-12", notes: "Private supplier note", payment_method: "Cash" },
  );
  sandbox.billFixtures = data.bills;
  const renderBills = () => vm.runInContext("FinancialTracker.renderBills(billFixtures, '2026-09-14')", sandbox);
  const billList = () => controls.get("onlinePayablesList").innerHTML;
  renderBills();
  assert.ok(!billList().includes("Settled bill"), "Paid bills are hidden from open view");
  assert.ok(billList().indexOf('id="billGroup-overdue"') < billList().indexOf('id="billGroup-soon"'));
  assert.ok(billList().indexOf('id="billGroup-soon"') < billList().indexOf('id="billGroup-upcoming"'));
  assert.ok(billList().includes("Due today"));
  assert.ok(billList().includes("Due in 7 days"));
  assert.ok(billList().includes("13 days overdue"));
  assert.ok(billList().includes("&lt;img"));
  assert.ok(!billList().includes('<img src=x'));
  assert.ok(billList().includes("$450.00"), "Partial payments show the remaining amount");
  assert.ok(billList().includes("Details &amp; payment history (1)"));
  assert.ok(!billList().includes("<table"), "Bills use compact rows, not the old wide table");
  const before = JSON.stringify(data.bills);
  controls.get("financialBillSort").value = "balance";
  renderBills();
  assert.ok(billList().indexOf('id="financialBill-15"') < billList().indexOf('id="financialBill-2"'));
  vm.runInContext("FinancialTracker.setBillFilter('partial')", sandbox);
  assert.ok(billList().includes('id="financialBill-2"'));
  assert.ok(!billList().includes('id="financialBill-15"'));
  vm.runInContext("FinancialTracker.setBillFilter('paid')", sandbox);
  assert.ok(billList().includes("Settled bill"));
  assert.ok(!billList().includes("Record Payment"));
  assert.ok(billList().includes("Mark Unpaid"));
  vm.runInContext("FinancialTracker.setBillFilter('soon')", sandbox);
  assert.ok(billList().includes("2 bills"));
  assert.ok(!billList().includes("Upcoming rent"));
  vm.runInContext("FinancialTracker.setBillFilter('all')", sandbox);
  controls.get("financialBillSearch").value = "private supplier";
  renderBills();
  assert.ok(billList().includes("1 bill matching your search"));
  assert.ok(billList().includes('id="financialBill-15"'));
  controls.get("financialBillSearch").value = "nothing matches";
  renderBills();
  assert.ok(billList().includes("No bills match this view."));
  assert.equal(JSON.stringify(data.bills), before, "Bill filters and sorting never modify financial records");
  vm.runInContext("FinancialTracker.openBillForm()", sandbox);
  assert.equal(controls.get("financialAddBill").open, true);
  controls.get("onlinePayableTitle").value = "New bill test";
  controls.get("onlinePayableAmount").value = "20.25";
  controls.get("onlinePayableDueDate").value = "2026-09-20";
  await vm.runInContext("saveOnlinePayable()", sandbox);
  assert.equal(controls.get("financialAddBill").open, false);
  assert.ok(data.bills.some((bill) => bill.title === "New bill test" && bill.amount === 20.25));
  assert.ok(billList().includes("New bill test"), "New bill is visible even when previous filters would hide it");
  failed = true;
  await vm.runInContext("loadMonthlyTracker()", sandbox);
  assert.equal(controls.get("monthlyTrackerStats").innerHTML, "");
  assert.equal(controls.get("financialLoadStatus").textContent, "Records unavailable");
  assert.equal(controls.get("saveMonthlyTrackerSettingsBtn").disabled, true);
});

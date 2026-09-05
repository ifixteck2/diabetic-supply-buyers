(function (root) {
  "use strict";
  const C = root.FinancialCore;
  const el = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const usd = (value) => Number(value || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
  const shortUsd = (value) => Number(value || 0).toLocaleString("en-US", { notation: "compact", style: "currency", currency: "USD", maximumFractionDigits: 1 });
  const date = (value) => {
    const key = C.dateKey(value);
    return key ? new Date(`${key}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "No date";
  };
  const tone = (amount) => amount < 0 ? "finance-negative" : "finance-positive";
  const amount = (value) => `<strong class="${tone(value)}">${usd(value)}</strong>`;
  const empty = (text) => `<p class="finance-empty">${esc(text)}</p>`;
  let context = null, currentReport = null, bills = [], today = "", view = "overview", paymentId = null;
  let ledgerPage = 0;

  function invalidate() {
    context = null;
    currentReport = null;
    ["monthlyTrackerStats", "financialOverview", "monthlyTrackerList", "financialPlanReport"].forEach((id) => { el(id).innerHTML = ""; });
    el("saveMonthlyTrackerSettingsBtn").disabled = true;
  }

  function init() {
    document.querySelectorAll("[data-finance-tab]").forEach((button) => { button.onclick = () => setView(button.dataset.financeTab); });
    ["financialSearch", "financialTypeFilter", "financialCategoryFilter"].forEach((id) => {
      el(id).addEventListener("input", () => { ledgerPage = 0; renderLedger(); });
    });
    ["financialBillSearch", "financialBillFilter"].forEach((id) => { el(id).addEventListener("input", () => renderBills(bills, today)); });
    el("financialPaymentForm").onsubmit = savePayment;
    el("monthlyTrackerType").onchange = toggleEntryFields;
  }
  function setView(next) {
    view = ["overview", "transactions", "plan"].includes(next) ? next : "overview";
    document.querySelectorAll("[data-finance-tab]").forEach((button) => {
      const active = button.dataset.financeTab === view;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    el("financialOverview").classList.toggle("hidden", view !== "overview");
    el("financialTransactionsView").classList.toggle("hidden", view !== "transactions");
    el("financialPlanView").classList.toggle("hidden", view !== "plan");
  }
  function stat(label, value, detail, color = "") {
    return `<div class="finance-stat ${color}"><span>${label}</span><strong>${usd(value)}</strong><small>${esc(detail)}</small></div>`;
  }
  function render(input) {
    if (context?.month !== input.month) ledgerPage = 0;
    context = input;
    el("saveMonthlyTrackerSettingsBtn").disabled = false;
    today = input.today;
    bills = input.bills;
    currentReport = C.report(input);
    const r = currentReport;
    const previousMonth = C.shiftMonth(input.month, -1);
    const previous = C.report({ ...input, month: previousMonth, entries: input.history });
    const compare = previous.rows.length ? `${usd(r.profit - previous.profit)} vs. previous month` : "No previous-month activity recorded";
    el("monthlyTrackerStats").innerHTML =
      stat("Phone Profit", r.profit, compare, "finance-green") +
      stat("Expenses & Bill Payments", r.spent, `${usd(r.expense)} expenses / ${usd(r.billPaid)} bills`, "finance-rose") +
      stat("Net Cash Flow", r.net, "Recorded profit + cash in - all payments", "finance-teal") +
      stat("Unpaid Through Month-End", r.outstanding, `${r.due.length} open bills, including earlier balances`, "finance-gold");
    el("financialOverview").innerHTML = `
      <div class="finance-overview-grid">
        <section class="finance-section finance-chart-section">
          <div class="finance-section-head"><h3>Cash Flow</h3><span>Cumulative monthly movement</span></div>
          ${renderChart(r)}
          <div class="finance-chart-legend"><span><i class="finance-dot"></i>Net movement</span><span>Money in <b>${usd(r.inflow)}</b></span><span>Money out <b>${usd(r.outflow)}</b></span></div>
        </section>
        <section class="finance-section finance-statement">
          <div class="finance-section-head"><h3>Monthly Statement</h3></div>
          ${statementLine("Phone profit", r.profit)}
          ${statementLine("Other cash in", r.cashIn)}
          ${statementLine("Expenses", -r.expense)}
          ${statementLine("Bill payments", -r.billPaid)}
          ${statementLine("Other cash out", -r.cashOut)}
          ${statementLine("Net cash flow", r.net, true)}
          ${statementLine("Still due through month-end", -r.outstanding)}
          ${statementLine("Net after outstanding bills", r.afterBills, true)}
        </section>
      </div>
      <p class="finance-note">Cash flow reflects recorded phone profits, cash adjustments, expenses, and bill payments. It is not a bank balance. Bill balances are current as of ${date(input.today)}. Online order totals are not added automatically.</p>
      <div class="finance-overview-grid finance-equal-grid">
        <section class="finance-section"><div class="finance-section-head"><h3>Spending by Category</h3><span>${usd(r.spent)}</span></div>${renderBars(r.categories, "spending")}</section>
        <section class="finance-section"><div class="finance-section-head"><h3>Profit by Source</h3><span>${r.quantity} phones / ${usd(r.profitPerPhone)} average</span></div>${renderBars(r.sources, "profit")}</section>
      </div>
      <section class="finance-section"><div class="finance-section-head"><h3>Six-Month Comparison</h3><span>Recorded activity</span></div>${renderHistory(input)}</section>
      <section class="finance-section"><div class="finance-section-head"><h3>Recent Transactions</h3><button class="btn secondary" onclick="FinancialTracker.setView('transactions')">View All</button></div>${transactionTable(r.rows.slice(-5).reverse(), false)}</section>`;
    el("financialPlanReport").innerHTML = renderPlan(r, input);
    const category = el("financialCategoryFilter").value;
    el("financialCategoryFilter").innerHTML = `<option value="">All categories</option>` + [...new Set(r.rows.map((row) => row.category))].sort().map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join("");
    el("financialCategoryFilter").value = [...el("financialCategoryFilter").options].some((option) => option.value === category) ? category : "";
    renderLedger();
    setView(view);
  }
  function statementLine(label, value, total = false) {
    return `<div class="finance-statement-line ${total ? "finance-total" : ""}"><span>${label}</span>${amount(value)}</div>`;
  }
  function renderChart(r) {
    if (!r.rows.length) return empty("No activity recorded for this month.");
    const values = r.daily.map((day) => day.net);
    const low = Math.min(0, ...values), high = Math.max(0, ...values);
    const span = high - low || 1;
    const min = low - span * 0.12, max = high + span * 0.12;
    const y = (value) => 22 + (max - value) / (max - min) * 176;
    const x = (index) => 66 + index / Math.max(1, values.length - 1) * 572;
    const points = values.map((value, index) => `${x(index).toFixed(2)},${y(value).toFixed(2)}`).join(" ");
    return `<div class="finance-chart" role="img" aria-label="Cumulative cash flow for ${esc(context.month)}: ending at ${usd(r.net)}">
      <svg viewBox="0 0 660 236" xmlns="http://www.w3.org/2000/svg">
        ${[low, (low + high) / 2, high].filter((value, index, list) => list.indexOf(value) === index).map((value) => `<line x1="66" y1="${y(value)}" x2="638" y2="${y(value)}" class="finance-grid-line"/><text x="58" y="${y(value) + 4}" text-anchor="end">${shortUsd(value)}</text>`).join("")}
        <line x1="66" y1="${y(0)}" x2="638" y2="${y(0)}" class="finance-zero-line"/>
        <polyline points="66,${y(0)} ${points} 638,${y(0)}" class="finance-chart-area"/>
        <polyline points="${points}" class="finance-chart-line"/>
        ${r.daily.map((day, index) => `<circle cx="${x(index)}" cy="${y(day.net)}" r="4" tabindex="0"><title>${date(day.date)}: ${usd(day.net)} net; ${usd(day.inflow)} in; ${usd(day.outflow)} out</title></circle>`).join("")}
        ${[0, 7, 14, 21, r.days - 1].map((index) => `<text x="${x(index)}" y="226" text-anchor="middle">${index + 1}</text>`).join("")}
      </svg>
    </div>`;
  }
  function renderBars(groups, kind) {
    if (!groups.length) return empty(kind === "profit" ? "No phone profits recorded." : "No expenses or bill payments recorded.");
    const total = groups.reduce((sum, row) => sum + C.cents(row.amount), 0);
    const max = Math.max(...groups.map((row) => row.amount), 1);
    const renderGroup = (row) => `<div class="finance-breakdown-row"><div><span>${esc(row.label)}</span><strong>${usd(row.amount)}</strong></div><div class="finance-bar-track"><span class="${kind}" style="width:${row.amount / max * 100}%"></span></div><small>${total ? Math.round(C.cents(row.amount) / total * 100) : 0}% ${kind === "profit" ? ` / ${row.quantity} phones` : ` / ${row.count} payments`}</small></div>`;
    return groups.slice(0, 5).map(renderGroup).join("") + (groups.length > 5 ? `<details><summary>${groups.length - 5} more categories</summary>${groups.slice(5).map(renderGroup).join("")}</details>` : "");
  }
  function renderHistory(input) {
    const reports = Array.from({ length: 6 }, (_, index) => {
      const month = C.shiftMonth(input.month, index - 5);
      return { month, ...C.report({ ...input, entries: input.history, month }) };
    });
    return `<div class="table-wrap"><table class="finance-table"><thead><tr><th>Month</th><th class="num">Phone Profit</th><th class="num">Expenses</th><th class="num">Bill Payments</th><th class="num">Other Cash, Net</th><th class="num">Net Cash Flow</th></tr></thead><tbody>${reports.map((row) => `<tr class="${row.month === input.month ? "finance-selected-row" : ""}"><td><button class="finance-text-button" onclick="FinancialTracker.goMonth('${row.month}')">${new Date(`${row.month}-01T12:00:00`).toLocaleDateString("en-US", { month: "short", year: "numeric" })}</button>${!row.rows.length ? `<small>No records</small>` : ""}</td><td class="num">${usd(row.profit)}</td><td class="num">${usd(row.expense)}</td><td class="num">${usd(row.billPaid)}</td><td class="num">${usd(row.cashIn - row.cashOut)}</td><td class="num">${amount(row.net)}</td></tr>`).join("")}</tbody></table></div>`;
  }
  function progress(value, total) {
    return `<progress max="${total || 1}" value="${Math.max(0, Math.min(value, total || 1))}" aria-label="${usd(value)} of ${usd(total)}"></progress>`;
  }
  function renderPlan(r, input) {
    const debtRows = C.debts(input.bills);
    const debtTotal = C.dollars(debtRows.reduce((sum, row) => sum + C.cents(row.remaining), 0));
    return `<div class="finance-overview-grid finance-equal-grid">
      <section class="finance-section"><div class="finance-section-head"><h3>Profit Target</h3><span>${r.budget ? Math.round(r.profit / r.budget * 100) + "% funded" : "No target set"}</span></div>${progress(r.profit, r.budget)}${statementLine("Target", r.budget)}${statementLine("Profit recorded", r.profit)}${statementLine("Remaining to target", r.targetLeft, true)}<div class="finance-statement-line"><span>${r.daysLeft} days remaining, including today</span><strong>${r.neededPerDay === null ? "Month ended" : `${usd(r.neededPerDay)} / day`}</strong></div></section>
      <section class="finance-section"><div class="finance-section-head"><h3>Food Budget</h3><span>${r.foodSpent > r.foodBudget ? "Over budget" : "Actual spending"}</span></div>${progress(r.foodSpent, r.foodBudget)}${statementLine("Budget", r.foodBudget)}${statementLine("Expenses + food bill payments", -r.foodSpent)}${statementLine("Remaining", r.foodRemaining, true)}</section>
      </div>
      <section class="finance-section"><div class="finance-section-head"><h3>Outstanding Bills</h3><button class="btn secondary" onclick="openOnlineMainTab('payables')">Open Bills</button></div>
        <p class="finance-note">Current balances due on or before ${date(C.endOfMonth(input.month))}, including earlier unpaid bills.</p>
        ${r.due.length ? `<div class="table-wrap"><table class="finance-table"><thead><tr><th>Due</th><th>Bill</th><th>Category</th><th class="num">Remaining</th><th></th></tr></thead><tbody>${r.due.slice().sort((a, b) => C.dateKey(a.due_date).localeCompare(C.dateKey(b.due_date))).map((bill) => `<tr><td>${date(bill.due_date)}${C.dateKey(bill.due_date) < input.today ? `<small class="finance-negative">Overdue</small>` : ""}</td><td>${esc(bill.title)}</td><td>${esc(bill.category)}</td><td class="num">${usd(C.dollars(C.remaining(bill)))}</td><td><button class="btn secondary" onclick="FinancialTracker.openPayment(${bill.id})">Record Payment</button></td></tr>`).join("")}</tbody></table></div>` : empty("No outstanding bills through this month-end.")}
      </section>
      <section class="finance-section"><div class="finance-section-head"><h3>Long-Term Balances</h3><span>${usd(debtTotal)} remaining</span></div>
        <p class="finance-note">Original recorded commitments less payments recorded against these bills. Interest and unrecorded payments are not included.</p>
        ${debtRows.length ? `<div class="table-wrap"><table class="finance-table"><thead><tr><th>Payee</th><th class="num">Monthly Payment</th><th class="num">Original Commitment</th><th class="num">Paid to Date</th><th class="num">Remaining</th><th>Progress</th></tr></thead><tbody>${debtRows.map((bill) => `<tr><td><strong>${esc(bill.title)}</strong><small>${Number(bill.long_term_months)} months recorded</small></td><td class="num">${usd(bill.amount)}</td><td class="num">${usd(bill.original)}</td><td class="num finance-positive">${usd(bill.repaid)}</td><td class="num"><strong>${usd(bill.remaining)}</strong></td><td>${progress(bill.repaid, bill.original)}</td></tr>`).join("")}</tbody></table></div>` : empty("No long-term commitments recorded.")}
      </section>`;
  }
  function filteredRows() {
    const text = el("financialSearch").value.toLowerCase().trim();
    const type = el("financialTypeFilter").value;
    const category = el("financialCategoryFilter").value;
    return (currentReport?.rows || []).filter((row) => (!type || row.type === type) && (!category || row.category === category) && (!text || [row.description, row.source, row.category, row.model, row.notes, row.method, row.date, row.inflow, row.outflow].join(" ").toLowerCase().includes(text)));
  }
  function transactionTable(rows, full) {
    if (!rows.length) return empty("No transactions match this view.");
    return `<div class="table-wrap"><table class="finance-table finance-ledger"><thead><tr><th>Date</th><th>Transaction</th><th>Category / Source</th><th class="num">In</th><th class="num">Out</th>${full ? `<th class="num">Running Month Net</th>` : ""}<th>Actions</th></tr></thead><tbody>${rows.map((row) => `<tr>
      <td>${date(row.date)}${row.date.slice(0, 7) !== context.month ? `<small>Assigned to ${esc(context.month)}</small>` : ""}</td>
      <td><strong>${esc(row.description)}</strong><small>${esc(row.type)}${row.model ? ` / ${esc(row.model)}` : ""}${row.type === "Phone Profit" ? ` / ${row.quantity} phones` : ""}</small>${row.notes ? `<details><summary>Notes</summary><p>${esc(row.notes)}</p></details>` : ""}</td>
      <td>${esc(row.category)}<small>${esc([row.source, row.method].filter(Boolean).join(" / "))}</small></td>
      <td class="num finance-positive">${row.inflow ? usd(row.inflow) : ""}</td><td class="num finance-negative">${row.outflow ? usd(row.outflow) : ""}</td>
      ${full ? `<td class="num">${amount(row.movement)}</td>` : ""}
      <td><div class="finance-row-actions">${row.kind === "entry" ? `<button class="btn secondary" onclick="FinancialTracker.openEntry(${row.id})">Edit</button><button class="btn danger" onclick="deleteMonthlyTrackerEntry(${row.id})">Delete</button>` : `<button class="btn secondary" onclick="FinancialTracker.showBill(${row.id})">View Bill</button>`}</div></td>
    </tr>`).join("")}</tbody></table></div>`;
  }
  function renderLedger() {
    if (!currentReport) return;
    const rows = filteredRows();
    const pages = Math.max(1, Math.ceil(rows.length / 25));
    ledgerPage = Math.min(ledgerPage, pages - 1);
    const totalIn = C.dollars(rows.reduce((sum, row) => sum + C.cents(row.inflow), 0));
    const totalOut = C.dollars(rows.reduce((sum, row) => sum + C.cents(row.outflow), 0));
    el("monthlyTrackerList").innerHTML = `<div class="finance-ledger-summary"><span>${rows.length} transactions</span><span>In <b>${usd(totalIn)}</b></span><span>Out <b>${usd(totalOut)}</b></span><span>Net ${amount(totalIn - totalOut)}</span></div>
      ${transactionTable(rows.slice().reverse().slice(ledgerPage * 25, ledgerPage * 25 + 25), true)}
      <div class="finance-pagination"><span>Page ${ledgerPage + 1} of ${pages}</span><button class="btn secondary" ${ledgerPage === 0 ? "disabled" : ""} onclick="FinancialTracker.page(-1)">Previous</button><button class="btn secondary" ${ledgerPage === pages - 1 ? "disabled" : ""} onclick="FinancialTracker.page(1)">Next</button></div>
      <p class="finance-note">Running month net includes all transactions in this reporting month, before any search filters.</p>`;
  }
  function renderBills(items, dateToday) {
    bills = items;
    today = dateToday;
    const open = bills.filter((bill) => C.remaining(bill) > 0);
    const overdue = open.filter((bill) => C.dateKey(bill.due_date) < today);
    const paidThisMonth = bills.reduce((sum, bill) => sum + C.payments(bill).filter((payment) => C.dateKey(payment.payment_date).slice(0, 7) === today.slice(0, 7)).reduce((s, payment) => s + C.cents(payment.amount), 0), 0);
    const totalRemaining = (rows) => C.dollars(rows.reduce((sum, bill) => sum + C.remaining(bill), 0));
    el("onlinePayableStats").innerHTML = stat("Outstanding", totalRemaining(open), `${open.length} open bills`, "finance-gold") + stat("Overdue", totalRemaining(overdue), `${overdue.length} bills past due`, "finance-rose") + stat("Paid This Month", C.dollars(paidThisMonth), "Full and partial payments", "finance-green") + stat("Long-Term Remaining", C.dollars(C.debts(bills).reduce((sum, bill) => sum + C.cents(bill.remaining), 0)), "After recorded payments", "finance-teal");
    const filter = el("financialBillFilter").value, search = el("financialBillSearch").value.toLowerCase().trim();
    const rows = bills.filter((bill) => (!search || `${bill.title} ${bill.category} ${bill.notes}`.toLowerCase().includes(search)) && (filter === "all" || filter === "paid" && C.remaining(bill) === 0 || filter === "open" && C.remaining(bill) > 0 || filter === "overdue" && C.remaining(bill) > 0 && C.dateKey(bill.due_date) < today)).sort((a, b) => C.dateKey(a.due_date).localeCompare(C.dateKey(b.due_date)) || String(a.title).localeCompare(String(b.title)));
    el("onlinePayablesList").innerHTML = `<div class="finance-section-head"><h3>${rows.length} Bills</h3><span>Current balances as of ${date(today)}</span></div>` + (rows.length ? `<div class="table-wrap"><table class="finance-table finance-bills"><thead><tr><th>Bill / Due Date</th><th>Category</th><th class="num">Amount</th><th class="num">Paid</th><th class="num">Remaining</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows.map(billRow).join("")}</tbody></table></div>` : empty("No bills match this view."));
  }
  function billRow(bill) {
    const left = C.remaining(bill), paid = C.paid(bill), history = C.payments(bill);
    const label = left === 0 ? "Paid" : paid ? "Partially Paid" : "Unpaid";
    return `<tr id="financialBill-${bill.id}"><td><strong>${esc(bill.title)}</strong><small>${date(bill.due_date)}${bill.is_monthly ? " / Monthly" : ""}</small>
      ${history.length ? `<details><summary>${history.length} payment${history.length === 1 ? "" : "s"}</summary><ul class="finance-payment-history">${history.slice().sort((a, b) => C.dateKey(b.payment_date).localeCompare(C.dateKey(a.payment_date))).map((payment) => `<li><strong>${usd(payment.amount)}</strong> / ${date(payment.payment_date)}<small>${esc(payment.payment_method || "")}${payment.notes ? ` / ${esc(payment.notes)}` : ""}</small></li>`).join("")}</ul></details>` : ""}
      ${bill.notes ? `<details><summary>Bill notes</summary><p>${esc(bill.notes)}</p></details>` : ""}</td><td>${esc(bill.category)}</td><td class="num">${usd(bill.amount)}</td><td class="num finance-positive">${usd(C.dollars(paid))}</td><td class="num"><strong>${usd(C.dollars(left))}</strong></td><td><span class="finance-status ${left === 0 ? "paid" : paid ? "partial" : "unpaid"}">${label}</span>${left && C.dateKey(bill.due_date) < today ? `<small class="finance-negative">Overdue</small>` : ""}</td><td><div class="finance-row-actions">${left ? `<button class="btn phone-btn" onclick="FinancialTracker.openPayment(${bill.id})">Record Payment</button>` : `<button class="btn secondary" onclick="FinancialTracker.reopenBill(${bill.id})">Mark Unpaid</button>`}<button class="btn danger" onclick="deleteOnlinePayable(${bill.id})">Delete</button></div></td></tr>`;
  }
  function showBill(id) {
    el("financialBillFilter").value = "all";
    el("financialBillSearch").value = "";
    openOnlineMainTab("payables");
    const row = el(`financialBill-${id}`);
    row?.scrollIntoView({ block: "center", behavior: "smooth" });
    row?.querySelector("details")?.setAttribute("open", "");
  }
  function toggleEntryFields() {
    const phone = el("monthlyTrackerType").value === "Phone Profit";
    ["monthlyTrackerModel", "monthlyTrackerQuantity"].forEach((id) => { el(id).parentElement.classList.toggle("hidden", !phone); });
  }
  function openEntry(id = null) {
    if (!context) return;
    const entry = id ? context?.entries.find((item) => Number(item.id) === Number(id)) : null;
    if (id && !entry) return;
    editingMonthlyTrackerId = id;
    el("financialEntryForm").reset();
    el("financialEntryTitle").textContent = id ? "Edit Entry" : "Add Entry";
    el("monthlyTrackerStatus").textContent = "";
    const defaultDate = context.month === today.slice(0, 7) ? today : `${context.month}-01`;
    const fields = { Type: entry?.entry_type || "Phone Profit", Date: entry ? C.dateKey(entry.entry_date) : defaultDate, Amount: entry?.amount || "", Category: entry?.category || "", Source: entry?.source || "", Model: entry?.phone_model || "", Quantity: entry?.quantity || 1, Description: entry?.description || "", Notes: entry?.notes || "" };
    Object.entries(fields).forEach(([key, value]) => { el(`monthlyTracker${key}`).value = value; });
    toggleEntryFields();
    el("financialEntryDialog").showModal();
  }
  function openPayment(id) {
    const bill = bills.find((item) => Number(item.id) === Number(id));
    if (!bill || !C.remaining(bill)) return;
    paymentId = id;
    el("financialPaymentForm").reset();
    el("financialPaymentTitle").textContent = `Payment / ${bill.title}`;
    el("financialPaymentBalance").textContent = `Bill ${usd(bill.amount)} / Paid ${usd(C.dollars(C.paid(bill)))} / Remaining ${usd(C.dollars(C.remaining(bill)))}`;
    el("financialPaymentAmount").value = C.dollars(C.remaining(bill)).toFixed(2);
    el("financialPaymentAmount").max = C.dollars(C.remaining(bill));
    el("financialPaymentDate").value = today;
    el("financialPaymentDate").max = today;
    el("financialPaymentMethod").value = bill.payment_method || "";
    el("financialPaymentStatus").textContent = "";
    el("financialPaymentDialog").showModal();
  }
  async function savePayment(event) {
    event.preventDefault();
    const button = el("financialPaymentSave");
    if (button.disabled) return;
    button.disabled = true;
    try {
      const result = await api(`/api/online-payables/${paymentId}/payments`, { method: "POST", body: { amount: Number(el("financialPaymentAmount").value), payment_date: el("financialPaymentDate").value, payment_method: el("financialPaymentMethod").value.trim(), notes: el("financialPaymentNotes").value.trim() } });
      if (!result?.ok) { el("financialPaymentStatus").textContent = result?.error || "Could not save payment."; return; }
      el("financialPaymentDialog").close();
      await loadOnlinePayables();
    } finally { button.disabled = false; }
  }
  function exportCsv() {
    if (!currentReport) return;
    const rows = view === "transactions" ? filteredRows() : currentReport.rows;
    const url = URL.createObjectURL(new Blob(["\uFEFF", C.csv(rows)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `iFixTeck-financials-${context.month}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  root.FinancialTracker = { init, render, renderBills, setView, openEntry, openPayment, showBill, exportCsv, invalidate,
    page(delta) { ledgerPage += delta; renderLedger(); },
    goMonth(month) { el("monthlyTrackerMonth").value = month; loadMonthlyTracker(); },
    async reopenBill(id) { if (confirm("Mark this bill unpaid and remove its recorded payments? This also changes cash flow and payment history.")) await setOnlinePayableStatus(id, "Unpaid"); },
  };
})(globalThis);

(function (root) {
  "use strict";
  const cents = (value) => Math.round((Number(value) || 0) * 100);
  const dollars = (value) => value / 100;
  const dateKey = (value) => String(value || "").slice(0, 10);
  const sum = (rows, field) => rows.reduce((total, row) => total + cents(row[field]), 0);
  const endOfMonth = (month) => `${month}-${new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()}`;
  function shiftMonth(month, offset) {
    const date = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + offset, 1));
    return date.toISOString().slice(0, 7);
  }
  function paid(bill) {
    return cents(bill.paid_amount) || (bill.status === "Paid" ? cents(bill.amount) : 0);
  }
  function remaining(bill) {
    return Math.max(0, cents(bill.amount) - paid(bill));
  }
  function payments(bill) {
    const rows = Array.isArray(bill.payments) ? bill.payments : [];
    if (rows.length) return rows;
    const date = dateKey(bill.paid_at || bill.last_payment_at);
    return paid(bill) && date ? [{ id: `legacy-${bill.id}`, amount: dollars(paid(bill)), payment_date: date, payment_method: bill.payment_method, notes: "Earlier recorded payment" }] : [];
  }
  function ledger(entries, bills, month) {
    const rows = entries.filter((entry) => dateKey(entry.entry_month).slice(0, 7) === month).map((entry) => {
      const incoming = entry.entry_type === "Phone Profit" || entry.entry_type === "Cash In";
      return {
        key: `entry-${entry.id}`, id: entry.id, kind: "entry", date: dateKey(entry.entry_date),
        type: entry.entry_type, category: entry.category || "Uncategorized", source: entry.source || "",
        description: entry.description || entry.phone_model || entry.category || entry.entry_type,
        model: entry.phone_model || "", quantity: entry.quantity || 1, notes: entry.notes || "", method: "",
        inflow: incoming ? Number(entry.amount) : 0, outflow: incoming ? 0 : Number(entry.amount),
      };
    });
    bills.forEach((bill) => payments(bill).forEach((payment) => {
      const date = dateKey(payment.payment_date || payment.created_at);
      if (date.slice(0, 7) !== month) return;
      rows.push({ key: `payment-${payment.id}`, id: bill.id, kind: "payment", date, type: "Bill Payment",
        category: bill.category || "Bills", source: bill.title, description: bill.title, model: "", quantity: "",
        notes: payment.notes || "", method: payment.payment_method || bill.payment_method || "",
        inflow: 0, outflow: Number(payment.amount) });
    }));
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key, "en", { numeric: true }));
    let balance = 0;
    return rows.map((row) => {
      balance += cents(row.inflow) - cents(row.outflow);
      return { ...row, movement: dollars(balance) };
    });
  }
  function group(rows, key, field) {
    const groups = new Map();
    rows.forEach((row) => {
      const label = String(row[key] || "Unspecified").trim();
      const lookup = label.toLowerCase();
      const item = groups.get(lookup) || { label, amount: 0, count: 0, quantity: 0 };
      item.amount += cents(row[field]);
      item.count += 1;
      item.quantity += Number(row.quantity || 0);
      groups.set(lookup, item);
    });
    return [...groups.values()].map((item) => ({ ...item, amount: dollars(item.amount) })).sort((a, b) => b.amount - a.amount);
  }
  function report({ entries = [], bills = [], settings = {}, month, today }) {
    const rows = ledger(entries, bills, month);
    const byType = (type) => rows.filter((row) => row.type === type);
    const profit = sum(byType("Phone Profit"), "inflow");
    const expense = sum(byType("Expense"), "outflow");
    const billPaid = sum(byType("Bill Payment"), "outflow");
    const cashIn = sum(byType("Cash In"), "inflow");
    const cashOut = sum(byType("Cash Out"), "outflow");
    const net = profit + cashIn - expense - billPaid - cashOut;
    const due = bills.filter((bill) => remaining(bill) > 0 && dateKey(bill.due_date) <= endOfMonth(month));
    const outstanding = due.reduce((total, bill) => total + remaining(bill), 0);
    const overdue = bills.filter((bill) => remaining(bill) > 0 && dateKey(bill.due_date) < today);
    const budget = cents(settings.monthly_budget);
    const foodBudget = cents(settings.food_budget);
    const spending = rows.filter((row) => row.type === "Expense" || row.type === "Bill Payment");
    const foodSpent = spending.filter((row) => /\bfood\b/i.test(row.category) || /popeyes/i.test(`${row.source} ${row.description}`)).reduce((total, row) => total + cents(row.outflow), 0);
    const days = Number(endOfMonth(month).slice(-2));
    const currentMonth = today.slice(0, 7);
    const daysLeft = month < currentMonth ? 0 : month > currentMonth ? days : days - Number(today.slice(-2)) + 1;
    const targetLeft = Math.max(0, budget - profit);
    const quantity = byType("Phone Profit").reduce((total, row) => total + Number(row.quantity || 0), 0);
    let running = 0;
    // Entries assigned to a different reporting month are carried into that month's first/last day.
    const daily = Array.from({ length: days }, (_, index) => {
      const date = `${month}-${String(index + 1).padStart(2, "0")}`;
      const dayRows = rows.filter((row) => (row.date < `${month}-01` ? `${month}-01` : row.date > endOfMonth(month) ? endOfMonth(month) : row.date) === date);
      const inflow = sum(dayRows, "inflow"), outflow = sum(dayRows, "outflow");
      running += inflow - outflow;
      return { date, inflow: dollars(inflow), outflow: dollars(outflow), net: dollars(running) };
    });
    return { rows, daily, due, overdue, days, daysLeft, quantity,
      profit: dollars(profit), expense: dollars(expense), billPaid: dollars(billPaid), cashIn: dollars(cashIn), cashOut: dollars(cashOut),
      inflow: dollars(profit + cashIn), outflow: dollars(expense + billPaid + cashOut), spent: dollars(expense + billPaid), net: dollars(net),
      outstanding: dollars(outstanding), afterBills: dollars(net - outstanding), budget: dollars(budget), targetLeft: dollars(targetLeft),
      neededPerDay: daysLeft ? dollars(Math.ceil(targetLeft / daysLeft)) : null,
      foodBudget: dollars(foodBudget), foodSpent: dollars(foodSpent), foodRemaining: dollars(foodBudget - foodSpent),
      profitPerPhone: quantity ? dollars(Math.round(profit / quantity)) : 0,
      categories: group(spending, "category", "outflow"), sources: group(byType("Phone Profit"), "source", "inflow"),
    };
  }
  function debts(bills) {
    return bills.filter((bill) => cents(bill.long_term_balance) > 0 || Number(bill.long_term_months) > 0).map((bill) => {
      const original = cents(bill.long_term_balance) || cents(bill.amount) * Number(bill.long_term_months || 0);
      const repaid = Math.min(original, paid(bill));
      return { ...bill, original: dollars(original), repaid: dollars(repaid), remaining: dollars(original - repaid) };
    });
  }
  function csv(rows) {
    const cell = (value) => {
      let text = String(value ?? "");
      if (typeof value !== "number" && /^[\s]*[=+@-]/.test(text)) text = `'${text}`;
      return `"${text.replace(/"/g, '""')}"`;
    };
    return [
      ["Date", "Type", "Category", "Description", "Source", "Phone model", "Quantity", "Payment method", "Inflow", "Outflow", "Running month net", "Notes"],
      ...rows.map((row) => [row.date, row.type, row.category, row.description, row.source, row.model, row.quantity, row.method, row.inflow, row.outflow, row.movement, row.notes]),
    ].map((row) => row.map(cell).join(",")).join("\r\n");
  }
  root.FinancialCore = { cents, dollars, dateKey, shiftMonth, endOfMonth, paid, remaining, payments, ledger, report, debts, csv };
})(globalThis);

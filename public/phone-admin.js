const $ = (id) => document.getElementById(id);
const money = (value) => Number(value || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
const status = (id, message, type = "ok") => {
  $(id).innerHTML = message ? `<div class="status ${type}">${message}</div>` : "";
};

let atlasPrices = [];
let phoneInvoices = [];

initPhonePortal();

async function initPhonePortal() {
  $("phonePurchaseDate").value = new Date().toISOString().slice(0, 10);
  bindPhoneEvents();
  const me = await api("/api/phone-me", { silent: true });
  if (me?.ok) showPhoneApp();
}

function bindPhoneEvents() {
  $("phoneLoginBtn").onclick = loginPhonePortal;
  $("phonePassword").addEventListener("keydown", (event) => {
    if (event.key === "Enter") loginPhonePortal();
  });
  $("phoneLogoutBtn").onclick = logoutPhonePortal;
  $("phoneRefreshBtn").onclick = refreshPhonePortal;
  $("createPhoneInvoiceBtn").onclick = createPhoneInvoice;
  $("savePhonePurchaseBtn").onclick = savePhonePurchase;
  $("clearPhonePurchaseBtn").onclick = resetPhonePurchase;
  $("refreshPriceCheckerBtn").onclick = refreshPhonePortal;
  ["phoneBuyer", "deviceType", "conditionType", "packaging", "grade", "phoneModel", "phoneCarrier"].forEach((id) => {
    $(id).addEventListener("change", handleFlowChange);
  });
  ["checkerDeviceType", "checkerConditionType", "checkerPackaging", "checkerGrade", "checkerModel", "checkerCarrier", "checkerQuantity"].forEach((id) => {
    $(id).addEventListener("change", handlePriceCheckerChange);
    if (id === "checkerQuantity") $(id).addEventListener("input", renderPriceCheckerResults);
  });
  document.querySelectorAll("[data-phone-tab]").forEach((button) => {
    button.onclick = () => openPhoneTab(button.dataset.phoneTab);
  });
}

async function loginPhonePortal() {
  const result = await api("/api/phone-login", {
    method: "POST",
    body: {
      username: $("phoneUsername").value.trim(),
      password: $("phonePassword").value,
      remember: $("phoneRemember").checked,
    },
  });
  if (result?.ok) showPhoneApp();
  else status("phoneLoginMsg", result?.error || "Login failed.", "bad");
}

async function logoutPhonePortal() {
  await api("/api/phone-logout", { method: "POST" });
  location.reload();
}

async function showPhoneApp() {
  $("phoneLogin").classList.add("hidden");
  $("phoneApp").classList.remove("hidden");
  await refreshPhonePortal();
}

async function refreshPhonePortal() {
  await loadAtlasPrices();
  await loadPhoneInvoices();
}

async function loadAtlasPrices() {
  const result = await api("/api/phone-price-sheet", { silent: true });
  atlasPrices = result.rows || [];
  renderModelOptions();
  renderCarrierOptions();
  updateProjectedPrice();
  renderPriceCheckerOptions();
}

async function loadPhoneInvoices() {
  const result = await api("/api/phone-invoices?status=All");
  phoneInvoices = result.invoices || [];
  renderInvoiceSelect();
  renderInvoiceLists();
  renderPhoneDashboard();
}

function openPhoneTab(name) {
  const titles = {
    dashboard: "Dashboard",
    purchase: "Add Purchase",
    priceChecker: "Price Checker",
    atlasPending: "Atlas Pending",
    ktPending: "KT Pending",
    pastInvoices: "Past Invoices",
  };
  document.querySelectorAll("[data-phone-tab]").forEach((button) => button.classList.toggle("active", button.dataset.phoneTab === name));
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.add("hidden"));
  $(`${name}PhoneTab`).classList.remove("hidden");
  $("phonePageTitle").textContent = titles[name] || "Phone Portal";
  renderInvoiceLists();
}

function handlePriceCheckerChange(event) {
  if (event.target.id === "checkerConditionType" || event.target.id === "checkerDeviceType") {
    toggleCheckerConditionFields();
    renderPriceCheckerModels();
  }
  if (event.target.id === "checkerModel" || event.target.id === "checkerConditionType" || event.target.id === "checkerDeviceType") {
    renderPriceCheckerCarriers();
  }
  renderPriceCheckerResults();
}

function handleFlowChange(event) {
  if (event.target.id === "conditionType" || event.target.id === "deviceType") {
    toggleConditionFields();
    renderModelOptions();
  }
  if (event.target.id === "phoneModel" || event.target.id === "conditionType" || event.target.id === "deviceType") {
    renderCarrierOptions();
  }
  if (event.target.id === "phoneBuyer") renderInvoiceSelect();
  updateProjectedPrice();
}

function toggleConditionFields() {
  const isNew = $("conditionType").value === "New";
  $("packagingWrap").classList.toggle("hidden", !isNew);
  $("gradeWrap").classList.toggle("hidden", isNew);
}

function matchingRows() {
  const deviceType = $("deviceType").value;
  const conditionType = $("conditionType").value;
  const buyer = $("phoneBuyer").value;
  return atlasPrices.filter((row) => row.buyer === buyer && row.device_type === deviceType && row.condition_type === conditionType);
}

function modelKey(row) {
  return [row.base_model || row.model, row.storage].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function renderModelOptions() {
  const previous = $("phoneModel").value;
  const models = [...new Set(matchingRows().map(modelKey).filter(Boolean))]
    .sort((a, b) => modelSortValue(b) - modelSortValue(a) || a.localeCompare(b));
  $("phoneModel").innerHTML = models.map((model) => `<option value="${escapeAttr(model)}">${escapeHtml(model)}</option>`).join("")
    || `<option value="">No Atlas models loaded</option>`;
  if (models.includes(previous)) $("phoneModel").value = previous;
}

function renderCarrierOptions() {
  const selectedModel = $("phoneModel").value;
  const rows = matchingRows().filter((row) => modelKey(row) === selectedModel);
  const carriers = [...new Set(rows.map((row) => row.carrier || "Unlocked"))].sort((a, b) => {
    if (a === "Unlocked") return -1;
    if (b === "Unlocked") return 1;
    return a.localeCompare(b);
  });
  const previous = $("phoneCarrier").value;
  $("phoneCarrier").innerHTML = carriers.map((carrier) => `<option value="${escapeAttr(carrier)}">${escapeHtml(carrier)}</option>`).join("")
    || `<option value="">Choose model first</option>`;
  if (carriers.includes(previous)) $("phoneCarrier").value = previous;
}

function selectedCondition() {
  if ($("conditionType").value !== "New") return $("grade").value;
  return $("packaging").value === "Sealed" ? "NEW" : $("packaging").value;
}

function pricingCondition() {
  const condition = selectedCondition();
  if ($("phoneBuyer").value === "Atlas" && $("conditionType").value === "Used" && condition !== "Parts") {
    return "Grade A";
  }
  return condition;
}

function checkerRows() {
  return atlasPrices.filter((row) => row.device_type === $("checkerDeviceType").value && row.condition_type === $("checkerConditionType").value);
}

function checkerConditionForBuyer(buyer) {
  if ($("checkerConditionType").value === "New") return $("checkerPackaging").value === "Sealed" ? "NEW" : $("checkerPackaging").value;
  const grade = $("checkerGrade").value;
  return buyer === "Atlas" && grade !== "Parts" ? "Grade A" : grade;
}

function renderPriceCheckerOptions() {
  toggleCheckerConditionFields();
  renderPriceCheckerModels();
  renderPriceCheckerCarriers();
  renderPriceCheckerResults();
}

function toggleCheckerConditionFields() {
  const isNew = $("checkerConditionType").value === "New";
  $("checkerPackagingWrap").classList.toggle("hidden", !isNew);
  $("checkerGradeWrap").classList.toggle("hidden", isNew);
}

function renderPriceCheckerModels() {
  const previous = $("checkerModel").value;
  const models = [...new Set(checkerRows().map(modelKey).filter(Boolean))]
    .sort((a, b) => modelSortValue(b) - modelSortValue(a) || a.localeCompare(b));
  $("checkerModel").innerHTML = models.map((model) => `<option value="${escapeAttr(model)}">${escapeHtml(model)}</option>`).join("")
    || `<option value="">No models loaded</option>`;
  if (models.includes(previous)) $("checkerModel").value = previous;
}

function renderPriceCheckerCarriers() {
  const selectedModel = $("checkerModel").value;
  const rows = checkerRows().filter((row) => modelKey(row) === selectedModel);
  const carriers = [...new Set(rows.map((row) => row.carrier || "Unlocked"))].sort((a, b) => {
    if (a === "Unlocked") return -1;
    if (b === "Unlocked") return 1;
    return a.localeCompare(b);
  });
  const previous = $("checkerCarrier").value;
  $("checkerCarrier").innerHTML = carriers.map((carrier) => `<option value="${escapeAttr(carrier)}">${escapeHtml(carrier)}</option>`).join("")
    || `<option value="">Choose model first</option>`;
  if (carriers.includes(previous)) $("checkerCarrier").value = previous;
}

function findCheckerPrice(buyer) {
  const selectedModel = $("checkerModel").value;
  const carrier = $("checkerCarrier").value;
  const condition = checkerConditionForBuyer(buyer);
  const rows = checkerRows().filter((row) => row.buyer === buyer);
  const exact = rows.find((row) => modelKey(row) === selectedModel && row.carrier === carrier && row.condition === condition);
  const fallback = rows.find((row) => modelKey(row) === selectedModel && row.condition === condition);
  return exact || fallback || null;
}

function renderPriceCheckerResults() {
  const quantity = Number($("checkerQuantity").value || 1);
  const cards = ["Atlas", "KT"].map((buyer) => {
    const row = findCheckerPrice(buyer);
    if (!row) {
      return `<div class="price-check-card missing"><span>${buyer}</span><strong>No price found</strong><em>${escapeHtml(checkerConditionForBuyer(buyer))}</em></div>`;
    }
    return `<div class="price-check-card"><span>${buyer}</span><strong>${money(row.price)}</strong><em>${escapeHtml(row.source_sheet || row.source || "Price sheet")} - ${escapeHtml(row.condition)} - ${escapeHtml(row.carrier || "Any")}</em><b>${money(Number(row.price || 0) * quantity)} total</b></div>`;
  }).join("");
  $("priceCheckerResults").innerHTML = cards;
}

function updateProjectedPrice() {
  const selectedModel = $("phoneModel").value;
  const carrier = $("phoneCarrier").value;
  const condition = pricingCondition();
  const exact = matchingRows().find((row) => modelKey(row) === selectedModel && row.carrier === carrier && row.condition === condition);
  const fallback = matchingRows().find((row) => modelKey(row) === selectedModel && row.condition === condition);
  const row = exact || fallback;
  if (row?.price) {
    $("phoneProjected").value = row.price;
    $("phonePricePreview").classList.remove("hidden");
    $("phonePricePreview").innerHTML = `<span>${escapeHtml($("phoneBuyer").value)} projected sell price</span><strong>${money(row.price)}</strong><em>${escapeHtml(row.source_sheet || row.source || "Price sheet")} - ${escapeHtml(row.condition)} - ${escapeHtml(row.carrier || "Unlocked")}</em>`;
  } else {
    $("phonePricePreview").classList.add("hidden");
  }
}

function renderInvoiceSelect() {
  const buyer = $("phoneBuyer").value;
  const pending = phoneInvoices.filter((invoice) => invoice.buyer === buyer && invoice.status === "Pending");
  $("phoneInvoiceSelect").innerHTML = pending.map((invoice) => (
    `<option value="${invoice.id}">#${invoice.id} - ${escapeHtml(invoice.label)} (${invoice.purchases?.length || 0})</option>`
  )).join("") || `<option value="">Create/select pending invoice</option>`;
}

async function createPhoneInvoice() {
  const buyer = $("phoneBuyer").value;
  const result = await api("/api/phone-invoices", {
    method: "POST",
    body: { buyer, label: $("newPhoneInvoiceLabel").value.trim() },
  });
  if (!result?.ok) return status("phonePurchaseStatus", result?.error || "Could not create invoice.", "bad");
  $("newPhoneInvoiceLabel").value = "";
  await loadPhoneInvoices();
  $("phoneInvoiceSelect").value = result.invoice.id;
  status("phonePurchaseStatus", `Created ${buyer} invoice #${result.invoice.id}.`);
}

async function savePhonePurchase() {
  const result = await api("/api/phone-purchases", {
    method: "POST",
    body: {
      buyer: $("phoneBuyer").value,
      invoice_id: Number($("phoneInvoiceSelect").value || 0) || null,
      purchase_date: $("phonePurchaseDate").value,
      device_type: $("deviceType").value,
      condition_type: $("conditionType").value,
      packaging: $("conditionType").value === "New" ? $("packaging").value : "",
      grade: $("conditionType").value === "Used" ? $("grade").value : "",
      model: $("phoneModel").value,
      carrier: $("phoneCarrier").value,
      quantity: Number($("phoneQuantity").value || 0),
      cost_each: Number($("phoneCost").value || 0),
      projected_sell_each: Number($("phoneProjected").value || 0),
      notes: $("phoneNotes").value.trim(),
    },
  });
  if (!result?.ok) return status("phonePurchaseStatus", result?.error || "Could not save purchase.", "bad");
  status("phonePurchaseStatus", `Added purchase to ${result.invoice.buyer} invoice #${result.invoice.id}.`);
  resetPhonePurchase(false);
  await loadPhoneInvoices();
}

function resetPhonePurchase(clearStatus = true) {
  $("deviceType").value = "Phone";
  $("conditionType").value = "Used";
  $("packaging").value = "Sealed";
  $("grade").value = "Grade A";
  $("phoneQuantity").value = 1;
  $("phoneCost").value = "";
  $("phoneProjected").value = "";
  $("phonePurchaseDate").value = new Date().toISOString().slice(0, 10);
  $("phoneNotes").value = "";
  toggleConditionFields();
  renderModelOptions();
  renderCarrierOptions();
  updateProjectedPrice();
  if (clearStatus) status("phonePurchaseStatus", "");
}

function renderInvoiceLists() {
  renderInvoiceGroup("atlasPendingList", "Atlas", "Pending");
  renderInvoiceGroup("ktPendingList", "KT", "Pending");
  renderPastInvoices();
}

function renderInvoiceGroup(id, buyer, view) {
  const list = phoneInvoices.filter((invoice) => {
    if (invoice.buyer !== buyer) return false;
    return view === "Pending" ? invoice.status === "Pending" : invoice.status !== "Pending";
  });
  $(id).innerHTML = list.map(renderPhoneInvoiceCard).join("") || `<div class="empty">No ${buyer} ${view.toLowerCase()} invoices yet.</div>`;
}

function renderPastInvoices() {
  const list = phoneInvoices
    .filter((invoice) => invoice.status !== "Pending")
    .sort((a, b) => new Date(b.status_updated_at || b.closed_at || b.created_at) - new Date(a.status_updated_at || a.closed_at || a.created_at));
  $("pastInvoicesList").innerHTML = list.map(renderPhoneInvoiceCard).join("") || `<div class="empty">No past invoices yet.</div>`;
}

function renderPhoneInvoiceCard(invoice) {
  const purchases = invoice.purchases || [];
  const totalCost = purchases.reduce((sum, row) => sum + Number(row.quantity || 0) * Number(row.cost_each || 0), 0);
  const projected = purchases.reduce((sum, row) => sum + Number(row.quantity || 0) * Number(row.projected_sell_each || 0), 0);
  const salePrice = invoice.sale_price === null || invoice.sale_price === undefined || invoice.sale_price === "" ? null : Number(invoice.sale_price);
  const actualProfit = salePrice === null ? null : salePrice - totalCost;
  const canRemove = invoice.status === "Pending";
  const rows = purchases.map((row) => `
    <tr class="phone-purchase-row">
      <td class="phone-device-cell">
        <strong>${escapeHtml(row.model)}</strong>
        <span>${escapeHtml(phoneInvoiceItemCondition(row))}</span>
      </td>
      <td>${escapeHtml(row.carrier || "")}</td>
      <td>${row.quantity}</td>
      <td>${money(row.cost_each)}</td>
      <td>${money(row.projected_sell_each)}</td>
      <td class="${profitClass(row)}">${money(profitEach(row))}</td>
      <td class="${profitClass(row)}"><strong>${money(profitTotal(row))}</strong></td>
      <td>${canRemove ? `<button class="mini-btn danger" onclick="removePhonePurchaseFromInvoice(${row.id})">Remove</button>` : ""}</td>
    </tr>
  `).join("");
  return `
    <article class="invoice-card phone-invoice-card">
      <div class="invoice-top">
        <div>
          <h3>${escapeHtml(invoice.label || `${invoice.buyer} Invoice`)}</h3>
          <p>#${invoice.id} - ${escapeHtml(invoice.buyer)} - ${new Date(invoice.created_at).toLocaleDateString()} - ${purchases.length} purchase${purchases.length === 1 ? "" : "s"}</p>
        </div>
        <span class="pill ${invoice.status?.toLowerCase()}">${escapeHtml(invoice.status)}</span>
      </div>
      <div class="table-wrap">
        <table class="phone-profit-table">
          <thead><tr><th>Device</th><th>Carrier</th><th>Qty</th><th>Cost Each</th><th>Sell Each</th><th>Profit Each</th><th>Total Profit</th><th></th></tr></thead>
          <tbody>${rows || `<tr><td colspan="8">No purchases added.</td></tr>`}</tbody>
        </table>
      </div>
      <div class="sale-summary">
        <span>Cost ${money(totalCost)}</span>
        <span>Projected ${money(projected)}</span>
        ${salePrice === null ? `<span>Actual Sale Not Set</span>` : `<span>Actual Sale ${money(salePrice)}</span>`}
        <strong>Profit ${money(projected - totalCost)}</strong>
        ${actualProfit === null ? "" : `<strong class="${actualProfit >= 0 ? "profit-good" : "profit-bad"}">Actual Profit ${money(actualProfit)}</strong>`}
      </div>
      <div class="sale-box phone-sale-box">
        <div class="form-grid three">
          <label>Actual Sale Amount<input id="phoneSalePrice${invoice.id}" type="number" min="0" step="0.01" value="${salePrice === null ? "" : salePrice}"></label>
          <label>Sale Notes<input id="phoneSaleNotes${invoice.id}" value="${escapeHtml(invoice.sale_notes || "")}" placeholder="Payment, tracking, buyer notes"></label>
          <label>Status<select id="phoneInvoiceStatus${invoice.id}"><option ${invoice.status === "Pending" ? "selected" : ""}>Pending</option><option ${invoice.status === "Shipped" ? "selected" : ""}>Shipped</option><option ${invoice.status === "Sold" ? "selected" : ""}>Sold</option><option ${invoice.status === "Closed" ? "selected" : ""}>Closed</option></select></label>
        </div>
        <div class="actions">
          <button class="mini-btn" onclick="savePhoneInvoiceSale(${invoice.id})">Save Sale Amount</button>
          <button class="mini-btn" onclick="setPhoneInvoiceStatusFromSelect(${invoice.id})">Save Status</button>
        </div>
      </div>
      <div class="invoice-actions">
        <strong>${money(projected || totalCost)}</strong>
        <div>
          <a class="mini-btn" href="/api/phone-invoices/${invoice.id}/html" target="_blank">Buyer Invoice PDF</a>
          ${invoice.status !== "Shipped" ? `<button class="mini-btn" onclick="setPhoneInvoiceStatus(${invoice.id}, 'Shipped')">Mark Shipped</button>` : ""}
          ${invoice.status !== "Sold" ? `<button class="mini-btn" onclick="setPhoneInvoiceStatus(${invoice.id}, 'Sold')">Mark Sold</button>` : ""}
          ${invoice.status !== "Pending" ? `<button class="mini-btn" onclick="setPhoneInvoiceStatus(${invoice.id}, 'Pending')">Reopen</button>` : ""}
          ${invoice.status !== "Closed" ? `<button class="mini-btn" onclick="setPhoneInvoiceStatus(${invoice.id}, 'Closed')">Close</button>` : ""}
        </div>
      </div>
    </article>
  `;
}

function phoneInvoiceItemCondition(row) {
  if (row.condition_type === "New") return row.packaging ? `NEW - ${row.packaging}` : "NEW";
  return row.grade || "USED";
}

function profitEach(row) {
  return Number(row.projected_sell_each || 0) - Number(row.cost_each || 0);
}

function profitTotal(row) {
  return profitEach(row) * Number(row.quantity || 0);
}

function profitClass(row) {
  return profitEach(row) >= 0 ? "profit-good" : "profit-bad";
}

function renderPhoneDashboard() {
  if (!$("phoneDashboardStats") || !$("phoneBuyerBreakdown")) return;
  const totals = phoneInvoices.reduce((acc, invoice) => addInvoiceStats(acc, invoice), emptyPhoneStats());
  const buyerStats = ["Atlas", "KT"].map((buyer) => phoneInvoices
    .filter((invoice) => invoice.buyer === buyer)
    .reduce((acc, invoice) => addInvoiceStats(acc, invoice), emptyPhoneStats(buyer)));
  $("phoneDashboardStats").innerHTML = `
    <div class="stat"><span>Total Cost</span><strong>${money(totals.cost)}</strong></div>
    <div class="stat"><span>Projected Sale</span><strong>${money(totals.projected)}</strong></div>
    <div class="stat"><span>Projected Profit</span><strong>${money(totals.projectedProfit)}</strong></div>
    <div class="stat"><span>Actual Sales</span><strong>${money(totals.actualSale)}</strong></div>
    <div class="stat"><span>Actual Profit</span><strong class="${totals.actualProfit >= 0 ? "profit-good" : "profit-bad"}">${money(totals.actualProfit)}</strong></div>
    <div class="stat"><span>Units</span><strong>${totals.units}</strong></div>
    <div class="stat"><span>Pending Cost</span><strong>${money(totals.pendingCost)}</strong></div>
    <div class="stat"><span>Shipped Cost</span><strong>${money(totals.shippedCost)}</strong></div>
    <div class="stat"><span>Needs Sale Amount</span><strong>${totals.needsSaleAmount}</strong></div>
    <div class="stat"><span>Avg Profit / Unit</span><strong>${money(totals.units ? totals.projectedProfit / totals.units : 0)}</strong></div>
  `;
  $("phoneBuyerBreakdown").innerHTML = `
    <table class="phone-breakdown-table">
      <thead><tr><th>Buyer</th><th>Invoices</th><th>Units</th><th>Cost</th><th>Projected Sale</th><th>Projected Profit</th><th>Actual Sales</th><th>Actual Profit</th><th>Needs Sale Amount</th></tr></thead>
      <tbody>${buyerStats.map((row) => `
        <tr>
          <td><strong>${row.buyer}</strong></td>
          <td>${row.invoices}</td>
          <td>${row.units}</td>
          <td>${money(row.cost)}</td>
          <td>${money(row.projected)}</td>
          <td class="${row.projectedProfit >= 0 ? "profit-good" : "profit-bad"}">${money(row.projectedProfit)}</td>
          <td>${money(row.actualSale)}</td>
          <td class="${row.actualProfit >= 0 ? "profit-good" : "profit-bad"}">${money(row.actualProfit)}</td>
          <td>${row.needsSaleAmount}</td>
        </tr>
      `).join("")}</tbody>
    </table>
  `;
}

function emptyPhoneStats(buyer = "All") {
  return { buyer, invoices: 0, units: 0, cost: 0, projected: 0, projectedProfit: 0, actualSale: 0, actualProfit: 0, pendingCost: 0, shippedCost: 0, needsSaleAmount: 0 };
}

function addInvoiceStats(acc, invoice) {
  const purchases = invoice.purchases || [];
  const cost = purchases.reduce((sum, row) => sum + Number(row.quantity || 0) * Number(row.cost_each || 0), 0);
  const projected = purchases.reduce((sum, row) => sum + Number(row.quantity || 0) * Number(row.projected_sell_each || 0), 0);
  const units = purchases.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  const salePrice = invoice.sale_price === null || invoice.sale_price === undefined || invoice.sale_price === "" ? null : Number(invoice.sale_price);
  acc.invoices += 1;
  acc.units += units;
  acc.cost += cost;
  acc.projected += projected;
  acc.projectedProfit += projected - cost;
  if (invoice.status === "Pending") acc.pendingCost += cost;
  if (invoice.status === "Shipped") acc.shippedCost += cost;
  if (invoice.status !== "Pending" && salePrice === null) acc.needsSaleAmount += 1;
  if (salePrice !== null) {
    acc.actualSale += salePrice;
    acc.actualProfit += salePrice - cost;
  }
  return acc;
}

window.setPhoneInvoiceStatus = async (id, nextStatus) => {
  const result = await api(`/api/phone-invoices/${id}/status`, {
    method: "PATCH",
    body: { status: nextStatus },
  });
  if (!result?.ok) return alert(result?.error || "Could not update invoice.");
  await loadPhoneInvoices();
};

window.setPhoneInvoiceStatusFromSelect = async (id) => {
  await setPhoneInvoiceStatus(id, $(`phoneInvoiceStatus${id}`).value);
};

window.savePhoneInvoiceSale = async (id) => {
  const result = await api(`/api/phone-invoices/${id}/sale`, {
    method: "PATCH",
    body: {
      sale_price: $(`phoneSalePrice${id}`).value,
      sale_notes: $(`phoneSaleNotes${id}`).value,
    },
  });
  if (!result?.ok) return alert(result?.error || "Could not save sale amount.");
  await loadPhoneInvoices();
};

window.removePhonePurchaseFromInvoice = async (id) => {
  if (!confirm("Remove this item from the pending invoice? It will stay saved as sold locally.")) {
    return false;
  }
  const result = await api(`/api/phone-purchases/${id}/invoice-removal`, {
    method: "PATCH",
    body: { remove: true, reason: "Sold locally" },
  });
  if (!result?.ok) {
    return alert(result?.error || "Could not remove this item from the invoice.");
  }
  await loadPhoneInvoices();
  return true;
};

async function api(url, options = {}) {
  const fetchOptions = {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json" },
  };
  if (options.body) fetchOptions.body = JSON.stringify(options.body);
  try {
    const response = await fetch(url, fetchOptions);
    const data = await response.json();
    if (!response.ok && !options.silent) return data;
    return data;
  } catch (error) {
    if (!options.silent) alert("Network error. Try again.");
    return null;
  }
}

function modelSortValue(model) {
  const number = Number(String(model).match(/iPhone\s+(\d+)/i)?.[1] || 0);
  const pro = /pro/i.test(model) ? 10 : 0;
  const max = /max/i.test(model) ? 5 : 0;
  const storage = Number(String(model).match(/(\d+)\s*TB/i)?.[1] || 0) * 1000
    || Number(String(model).match(/(\d+)\s*GB/i)?.[1] || 0);
  return number * 10000 + pro * 1000 + max * 100 + storage;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

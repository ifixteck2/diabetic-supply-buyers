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
  ["phoneBuyer", "deviceType", "conditionType", "packaging", "grade", "phoneModel", "phoneCarrier"].forEach((id) => {
    $(id).addEventListener("change", handleFlowChange);
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
}

async function loadPhoneInvoices() {
  const result = await api("/api/phone-invoices?status=All");
  phoneInvoices = result.invoices || [];
  renderInvoiceSelect();
  renderInvoiceLists();
}

function openPhoneTab(name) {
  const titles = {
    purchase: "Add Purchase",
    atlasPending: "Atlas Pending",
    atlasPast: "Atlas Past",
    ktPending: "KT Pending",
    ktPast: "KT Past",
  };
  document.querySelectorAll("[data-phone-tab]").forEach((button) => button.classList.toggle("active", button.dataset.phoneTab === name));
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.add("hidden"));
  $(`${name}PhoneTab`).classList.remove("hidden");
  $("phonePageTitle").textContent = titles[name] || "Phone Portal";
  renderInvoiceLists();
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
  return atlasPrices.filter((row) => row.device_type === deviceType && row.condition_type === conditionType);
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

function updateProjectedPrice() {
  const selectedModel = $("phoneModel").value;
  const carrier = $("phoneCarrier").value;
  const condition = selectedCondition();
  const exact = matchingRows().find((row) => modelKey(row) === selectedModel && row.carrier === carrier && row.condition === condition);
  const fallback = matchingRows().find((row) => modelKey(row) === selectedModel && row.condition === condition);
  const row = exact || fallback;
  if (row?.price) {
    $("phoneProjected").value = row.price;
    $("phonePricePreview").classList.remove("hidden");
    $("phonePricePreview").innerHTML = `<span>Atlas projected sell price</span><strong>${money(row.price)}</strong><em>${escapeHtml(row.source_sheet)} - ${escapeHtml(row.condition)} - ${escapeHtml(row.carrier || "Unlocked")}</em>`;
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
  renderInvoiceGroup("atlasPastList", "Atlas", "Past");
  renderInvoiceGroup("ktPendingList", "KT", "Pending");
  renderInvoiceGroup("ktPastList", "KT", "Past");
}

function renderInvoiceGroup(id, buyer, view) {
  const list = phoneInvoices.filter((invoice) => {
    if (invoice.buyer !== buyer) return false;
    return view === "Pending" ? invoice.status === "Pending" : invoice.status !== "Pending";
  });
  $(id).innerHTML = list.map(renderPhoneInvoiceCard).join("") || `<div class="empty">No ${buyer} ${view.toLowerCase()} invoices yet.</div>`;
}

function renderPhoneInvoiceCard(invoice) {
  const purchases = invoice.purchases || [];
  const totalCost = purchases.reduce((sum, row) => sum + Number(row.quantity || 0) * Number(row.cost_each || 0), 0);
  const projected = purchases.reduce((sum, row) => sum + Number(row.quantity || 0) * Number(row.projected_sell_each || 0), 0);
  const rows = purchases.map((row) => `
    <tr>
      <td>${escapeHtml(row.model)}</td>
      <td>${escapeHtml(row.carrier || "")}</td>
      <td>${escapeHtml(row.condition_type === "New" ? row.packaging : row.grade)}</td>
      <td>${row.quantity}</td>
      <td>${money(row.cost_each)}</td>
      <td>${money(Number(row.quantity || 0) * Number(row.cost_each || 0))}</td>
      <td>${money(row.projected_sell_each)}</td>
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
        <table>
          <thead><tr><th>Model</th><th>Carrier</th><th>Condition</th><th>Qty</th><th>Cost Each</th><th>Total Cost</th><th>Projected Each</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="7">No purchases added.</td></tr>`}</tbody>
        </table>
      </div>
      <div class="sale-summary">
        <span>Cost ${money(totalCost)}</span>
        <span>Projected ${money(projected)}</span>
        <strong>Profit ${money(projected - totalCost)}</strong>
      </div>
      <div class="invoice-actions">
        <strong>${money(projected || totalCost)}</strong>
        <div>
          <a class="mini-btn" href="/api/phone-invoices/${invoice.id}/html" target="_blank">Invoice</a>
          ${invoice.status === "Pending" ? `<button class="mini-btn" onclick="setPhoneInvoiceStatus(${invoice.id}, 'Sold')">Mark Sold</button><button class="mini-btn" onclick="setPhoneInvoiceStatus(${invoice.id}, 'Closed')">Close</button>` : `<button class="mini-btn" onclick="setPhoneInvoiceStatus(${invoice.id}, 'Pending')">Reopen</button>`}
        </div>
      </div>
    </article>
  `;
}

window.setPhoneInvoiceStatus = async (id, nextStatus) => {
  const result = await api(`/api/phone-invoices/${id}/status`, {
    method: "PATCH",
    body: { status: nextStatus },
  });
  if (!result?.ok) return alert(result?.error || "Could not update invoice.");
  await loadPhoneInvoices();
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

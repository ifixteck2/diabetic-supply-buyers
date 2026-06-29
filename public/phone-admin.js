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
  ["phoneBuyer", "deviceType", "phoneBrand", "conditionType", "packaging", "grade", "phoneModel", "phoneStorage", "phoneCarrier"].forEach((id) => {
    $(id).addEventListener("change", handleFlowChange);
  });
  ["checkerDeviceType", "checkerBrand", "checkerConditionType", "checkerPackaging", "checkerGrade", "checkerModel", "checkerStorage", "checkerCarrier", "deductCrackedBack", "deductCrackedLens", "deductBattery", "deductRepair", "deductFaceId"].forEach((id) => {
    $(id).addEventListener("change", handlePriceCheckerChange);
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
  renderPhoneStorageOptions();
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
  if (event.target.id === "checkerConditionType" || event.target.id === "checkerDeviceType" || event.target.id === "checkerBrand") {
    toggleCheckerConditionFields();
    renderPriceCheckerModels();
  }
  if (event.target.id === "checkerModel" || event.target.id === "checkerConditionType" || event.target.id === "checkerDeviceType" || event.target.id === "checkerBrand") {
    renderPriceCheckerStorage();
  }
  if (event.target.id === "checkerModel" || event.target.id === "checkerStorage" || event.target.id === "checkerConditionType" || event.target.id === "checkerDeviceType" || event.target.id === "checkerBrand") {
    renderPriceCheckerCarriers();
  }
  renderPriceCheckerResults();
}

function handleFlowChange(event) {
  const id = event.target.id;
  if (id === "conditionType" || id === "deviceType" || id === "phoneBrand" || id === "phoneBuyer") {
    toggleConditionFields();
    renderModelOptions();
  }
  if (id === "phoneModel" || id === "conditionType" || id === "deviceType" || id === "phoneBrand" || id === "phoneBuyer") {
    renderPhoneStorageOptions();
  }
  if (id === "phoneModel" || id === "phoneStorage" || id === "conditionType" || id === "deviceType" || id === "phoneBrand" || id === "phoneBuyer") {
    renderCarrierOptions();
  }
  if (id === "phoneBuyer") renderInvoiceSelect();
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
  return atlasPrices.filter((row) => row.buyer === buyer && row.device_type === deviceType && row.condition_type === conditionType && rowBrand(row) === $("phoneBrand").value);
}

function modelKey(row) {
  return [row.base_model || row.model, row.storage].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function renderModelOptions() {
  const previous = $("phoneModel").value;
  const models = [...new Set(matchingRows().map(checkerModelName).filter(Boolean))]
    .sort((a, b) => modelSortValue(b) - modelSortValue(a) || a.localeCompare(b));
  $("phoneModel").innerHTML = models.map((model) => `<option value="${escapeAttr(model)}">${escapeHtml(model)}</option>`).join("")
    || `<option value="">No Atlas models loaded</option>`;
  if (models.includes(previous)) $("phoneModel").value = previous;
}

function renderPhoneStorageOptions() {
  const selectedModel = $("phoneModel").value;
  const rows = matchingRows().filter((row) => checkerModelName(row) === selectedModel);
  const storageOptions = [...new Set(rows.map((row) => row.storage || "N/A").filter(Boolean))]
    .sort((a, b) => storageSortValue(a) - storageSortValue(b) || a.localeCompare(b));
  const previous = $("phoneStorage").value;
  $("phoneStorage").innerHTML = storageOptions.map((storage) => `<option value="${escapeAttr(storage)}">${escapeHtml(storage)}</option>`).join("")
    || `<option value="">Choose model first</option>`;
  if (storageOptions.includes(previous)) $("phoneStorage").value = previous;
}

function renderCarrierOptions() {
  const selectedModel = $("phoneModel").value;
  const selectedStorage = $("phoneStorage").value;
  const rows = matchingRows().filter((row) => checkerModelName(row) === selectedModel && (row.storage || "N/A") === selectedStorage);
  const allowed = new Set(["Unlocked", "Carrier Locked", "AT&T (Clean)", "Parts"]);
  const carriers = [...new Set(rows.map((row) => normalizeCheckerCarrier(row.carrier || "Unlocked")).filter((carrier) => allowed.has(carrier)))].sort((a, b) => {
    if (a === "Unlocked") return -1;
    if (b === "Unlocked") return 1;
    if (a === "Carrier Locked") return -1;
    if (b === "Carrier Locked") return 1;
    if (a === "AT&T (Clean)") return -1;
    if (b === "AT&T (Clean)") return 1;
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
  return atlasPrices.filter((row) => (
    row.device_type === $("checkerDeviceType").value
    && row.condition_type === $("checkerConditionType").value
    && rowBrand(row) === $("checkerBrand").value
  ));
}

function checkerConditionForBuyer(buyer) {
  if ($("checkerConditionType").value === "New") return $("checkerPackaging").value === "Sealed" ? "NEW" : $("checkerPackaging").value;
  return $("checkerGrade").value;
}

function renderPriceCheckerOptions() {
  toggleCheckerConditionFields();
  renderPriceCheckerModels();
  renderPriceCheckerStorage();
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
  const models = [...new Set(checkerRows().map(checkerModelName).filter(Boolean))]
    .sort((a, b) => modelSortValue(b) - modelSortValue(a) || a.localeCompare(b));
  $("checkerModel").innerHTML = models.map((model) => `<option value="${escapeAttr(model)}">${escapeHtml(model)}</option>`).join("")
    || `<option value="">No models loaded</option>`;
  if (models.includes(previous)) $("checkerModel").value = previous;
}

function renderPriceCheckerStorage() {
  const selectedModel = $("checkerModel").value;
  const rows = checkerRows().filter((row) => checkerModelName(row) === selectedModel);
  const storageOptions = [...new Set(rows.map((row) => row.storage || "N/A").filter(Boolean))]
    .sort((a, b) => storageSortValue(a) - storageSortValue(b) || a.localeCompare(b));
  const previous = $("checkerStorage").value;
  $("checkerStorage").innerHTML = storageOptions.map((storage) => `<option value="${escapeAttr(storage)}">${escapeHtml(storage)}</option>`).join("")
    || `<option value="">Choose model first</option>`;
  if (storageOptions.includes(previous)) $("checkerStorage").value = previous;
}

function renderPriceCheckerCarriers() {
  const selectedModel = $("checkerModel").value;
  const selectedStorage = $("checkerStorage").value;
  const rows = checkerRows().filter((row) => checkerModelName(row) === selectedModel && (row.storage || "N/A") === selectedStorage);
  const allowed = new Set(["Unlocked", "Carrier Locked", "AT&T (Clean)"]);
  const carriers = [...new Set(rows.map((row) => normalizeCheckerCarrier(row.carrier || "Unlocked")).filter((carrier) => allowed.has(carrier)))].sort((a, b) => {
    if (a === "Unlocked") return -1;
    if (b === "Unlocked") return 1;
    if (a === "Carrier Locked") return -1;
    if (b === "Carrier Locked") return 1;
    return a.localeCompare(b);
  });
  const previous = $("checkerCarrier").value;
  $("checkerCarrier").innerHTML = carriers.map((carrier) => `<option value="${escapeAttr(carrier)}">${escapeHtml(carrier)}</option>`).join("")
    || `<option value="">Choose model first</option>`;
  if (carriers.includes(previous)) $("checkerCarrier").value = previous;
}

function findCheckerPrice(buyer) {
  const selectedModel = $("checkerModel").value;
  const selectedStorage = $("checkerStorage").value;
  const carrier = $("checkerCarrier").value;
  const condition = checkerConditionForBuyer(buyer);
  const rows = checkerRows().filter((row) => row.buyer === buyer);
  const exact = rows.find((row) => checkerModelName(row) === selectedModel && (row.storage || "N/A") === selectedStorage && normalizeCheckerCarrier(row.carrier) === carrier && row.condition === condition);
  const fallback = rows.find((row) => checkerModelName(row) === selectedModel && (row.storage || "N/A") === selectedStorage && row.condition === condition);
  return exact || fallback || null;
}

function renderPriceCheckerResults() {
  const cards = ["Atlas", "KT"].map((buyer) => {
    const row = findCheckerPrice(buyer);
    if (!row) {
      return `<div class="price-check-card missing"><span>${buyer}</span><strong>No price found</strong><em>${escapeHtml(checkerConditionForBuyer(buyer))}</em></div>`;
    }
    const deduction = buyer === "Atlas" ? selectedAtlasDeduction(row) : { amount: 0, notes: [] };
    const finalEach = Math.max(0, Number(row.price || 0) - Number(deduction.amount || 0));
    const deductionText = deduction.amount ? `<i>Deductions: -${money(deduction.amount)}</i>` : "";
    const askText = deduction.notes.length ? `<i>${escapeHtml(deduction.notes.join(" | "))}</i>` : "";
    return `<div class="price-check-card"><span>${buyer}</span><strong>${money(finalEach)}</strong><em>${escapeHtml(row.source_sheet || row.source || "Price sheet")} - ${escapeHtml(row.condition)} - ${escapeHtml(normalizeCheckerCarrier(row.carrier || "Any"))}</em>${deductionText}${askText}</div>`;
  }).join("");
  $("priceCheckerResults").innerHTML = cards;
}

function checkerModelName(row) {
  return row.base_model || String(row.model || "").replace(/\b\d+\s*(GB|TB)\b/i, "").replace(/\b(Unlocked|Carrier Locked|AT&T \(Clean\)|AT&T|T-Mobile|Verizon|Cricket|Metro|Spectrum|Xfinity|US Cellular|Boost)\b/ig, "").replace(/\s+/g, " ").trim();
}

function rowBrand(row) {
  const text = `${row.base_model || ""} ${row.model || ""}`.toLowerCase();
  if (/pixel|google/.test(text)) return "Google";
  if (/samsung|galaxy|\bs\d{2}/.test(text)) return "Samsung";
  return "Apple";
}

function normalizeCheckerCarrier(carrier) {
  const text = String(carrier || "").trim();
  if (/^locked$/i.test(text) || /carrier locked/i.test(text)) return "Carrier Locked";
  if (/at&t/i.test(text)) return "AT&T (Clean)";
  if (/unlocked/i.test(text)) return "Unlocked";
  return text;
}

function storageSortValue(storage) {
  return Number(String(storage || "").match(/(\d+)\s*TB/i)?.[1] || 0) * 1000
    || Number(String(storage || "").match(/(\d+)\s*GB/i)?.[1] || 0);
}

function selectedAtlasDeduction(row) {
  const notes = [];
  let amount = 0;
  if ($("deductCrackedBack").checked) {
    const deduction = atlasCrackedBackDeduction(row.base_model || row.model);
    if (deduction) amount += deduction;
    else notes.push("Cracked back: ASK");
  }
  if ($("deductCrackedLens").checked) notes.push(`Cracked lens: ${atlasCrackedLensText(row.base_model || row.model)}`);
  if ($("deductBattery").checked) notes.push("Battery / degraded battery: ASK");
  if ($("deductRepair").checked) notes.push("Repair message: ASK");
  if ($("deductFaceId").checked) notes.push("Bad Face ID: price as Parts or ASK");
  return { amount, notes };
}

function atlasCrackedBackDeduction(model) {
  const text = String(model || "").toLowerCase();
  if (/15 pro max/.test(text)) return 90;
  if (/14 pro max/.test(text)) return 80;
  if (/14 pro/.test(text)) return 50;
  if (/14 plus/.test(text)) return 50;
  if (/\b14\b/.test(text)) return 70;
  if (/16 pro max/.test(text)) return 120;
  if (/16 plus/.test(text)) return 70;
  if (/\b16e\b/.test(text)) return 100;
  if (/\b16\b/.test(text)) return 60;
  if (/17 pro max/.test(text)) return 160;
  if (/17 pro/.test(text)) return 140;
  if (/17 air/.test(text)) return 100;
  if (/\b17\b/.test(text)) return 100;
  if (/15 pro/.test(text)) return 60;
  if (/15 plus/.test(text)) return 60;
  if (/\b15\b/.test(text)) return 90;
  if (/13 pro max/.test(text)) return 60;
  return 0;
}

function atlasCrackedLensText(model) {
  const text = String(model || "").toLowerCase();
  if (/15 pro max/.test(text)) return "-$70";
  if (/14 pro max/.test(text)) return "-$50";
  if (/14|15|16/.test(text)) return "-$40 to -$60";
  return "ASK";
}

function imageFileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read phone photo."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not load phone photo."));
      img.onload = () => {
        const max = 1200;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve({ file_name: file.name, data_url: canvas.toDataURL("image/jpeg", 0.78) });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function updateProjectedPrice() {
  const selectedModel = $("phoneModel").value;
  const selectedStorage = $("phoneStorage").value;
  const carrier = $("phoneCarrier").value;
  const condition = pricingCondition();
  const exact = matchingRows().find((row) => checkerModelName(row) === selectedModel && (row.storage || "N/A") === selectedStorage && row.carrier === carrier && row.condition === condition);
  const fallback = matchingRows().find((row) => checkerModelName(row) === selectedModel && (row.storage || "N/A") === selectedStorage && row.condition === condition);
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
  const photoFile = $("phonePhoto").files?.[0] || null;
  const photo = photoFile ? await imageFileToDataUrl(photoFile) : null;
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
      model: [$("phoneModel").value, $("phoneStorage").value && $("phoneStorage").value !== "N/A" ? $("phoneStorage").value : ""].filter(Boolean).join(" "),
      carrier: $("phoneCarrier").value,
      quantity: Number($("phoneQuantity").value || 0),
      cost_each: Number($("phoneCost").value || 0),
      projected_sell_each: Number($("phoneProjected").value || 0),
      imei: $("phoneImei").value.trim(),
      photo,
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
  $("phoneBrand").value = "Apple";
  $("phoneQuantity").value = 1;
  $("phoneCost").value = "";
  $("phoneProjected").value = "";
  $("phoneImei").value = "";
  $("phonePhoto").value = "";
  $("phonePurchaseDate").value = new Date().toISOString().slice(0, 10);
  $("phoneNotes").value = "";
  toggleConditionFields();
  renderModelOptions();
  renderPhoneStorageOptions();
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
  $("pastInvoicesList").innerHTML = list.map(renderPastInvoiceCard).join("") || `<div class="empty">No past invoices yet.</div>`;
}

function invoiceTotals(invoice) {
  const purchases = invoice.purchases || [];
  const totalCost = purchases.reduce((sum, row) => sum + Number(row.quantity || 0) * Number(row.cost_each || 0), 0);
  const projected = purchases.reduce((sum, row) => sum + Number(row.quantity || 0) * Number(row.projected_sell_each || 0), 0);
  const units = purchases.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  const salePrice = invoice.sale_price === null || invoice.sale_price === undefined || invoice.sale_price === "" ? null : Number(invoice.sale_price);
  const profit = salePrice === null ? projected - totalCost : salePrice - totalCost;
  return { totalCost, projected, units, salePrice, profit };
}

function renderPastInvoiceCard(invoice) {
  const totals = invoiceTotals(invoice);
  const date = new Date(invoice.status_updated_at || invoice.closed_at || invoice.created_at).toLocaleDateString();
  return `
    <article class="invoice-card phone-invoice-card past-invoice-card">
      <button class="past-invoice-summary" onclick="togglePastInvoice(${invoice.id})">
        <span><b>${escapeHtml(invoice.buyer)}</b><em>${escapeHtml(invoice.label || `${invoice.buyer} Invoice`)}</em></span>
        <span><small>Date</small>${date}</span>
        <span><small>Status</small>${escapeHtml(invoice.status)}</span>
        <span><small>Units</small>${totals.units}</span>
        <span><small>Cost</small>${money(totals.totalCost)}</span>
        <span><small>${totals.salePrice === null ? "Projected" : "Sold For"}</small>${money(totals.salePrice ?? totals.projected)}</span>
        <span class="${totals.profit >= 0 ? "profit-good" : "profit-bad"}"><small>Profit</small>${money(totals.profit)}</span>
        <strong>Open</strong>
      </button>
      <div id="pastInvoiceDetail${invoice.id}" class="past-invoice-detail hidden">
        ${renderPhoneInvoiceCard(invoice)}
      </div>
    </article>
  `;
}

function renderPhoneInvoiceCard(invoice) {
  const purchases = invoice.purchases || [];
  const { totalCost, projected, salePrice } = invoiceTotals(invoice);
  const actualProfit = salePrice === null ? null : salePrice - totalCost;
  const canRemove = invoice.status === "Pending";
  const rows = purchases.map((row) => `
    <tr class="phone-purchase-row">
      <td class="phone-device-cell">
        <strong>${escapeHtml(row.model)}</strong>
        <span>${escapeHtml(phoneInvoiceItemCondition(row))}</span>
        ${row.imei ? `<em>IMEI ${escapeHtml(row.imei)}</em>` : ""}
        ${row.photo_data_url ? `<button class="phone-photo-link" onclick="openPhonePhoto(${row.id})">View photo</button>` : ""}
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

window.togglePastInvoice = (id) => {
  $(`pastInvoiceDetail${id}`).classList.toggle("hidden");
};

window.openPhonePhoto = (id) => {
  const purchase = phoneInvoices.flatMap((invoice) => invoice.purchases || []).find((row) => Number(row.id) === Number(id));
  if (!purchase?.photo_data_url) return;
  const viewer = document.createElement("div");
  viewer.className = "photo-viewer";
  viewer.innerHTML = `<div class="photo-viewer-backdrop" onclick="this.parentElement.remove()"></div><div class="photo-viewer-panel"><button class="photo-viewer-close" onclick="this.closest('.photo-viewer').remove()">Close</button><img src="${escapeAttr(purchase.photo_data_url)}" alt="Phone photo"><p>${escapeHtml(purchase.model || "Phone")} ${purchase.imei ? `- IMEI ${escapeHtml(purchase.imei)}` : ""}</p></div>`;
  document.body.appendChild(viewer);
};

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

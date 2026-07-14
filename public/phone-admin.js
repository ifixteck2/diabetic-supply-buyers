const $ = (id) => document.getElementById(id);
const money = (value) => Number(value || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
const status = (id, message, type = "ok") => {
  $(id).innerHTML = message ? `<div class="status ${type}">${message}</div>` : "";
};

let atlasPrices = [];
let phoneInvoices = [];
let manualPhoneReturns = [];
let editingPhonePurchaseId = null;

initPhonePortal();

async function initPhonePortal() {
  $("phonePurchaseDate").value = new Date().toISOString().slice(0, 10);
  $("manualReturnDate").value = new Date().toISOString().slice(0, 10);
  $("manualGiftCardDate").value = new Date().toISOString().slice(0, 10);
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
  $("parseQuickPhoneBtn").onclick = () => parseQuickPhoneText(false);
  $("addQuickPhoneBtn").onclick = () => parseQuickPhoneText(true);
  $("moveLatestPhonesBtn").onclick = moveLatestPhones;
  $("addManualReturnBtn").onclick = addManualKtReturn;
  $("addManualGiftCardBtn").onclick = addManualGiftCard;
  ["phoneBuyer", "deviceType", "phoneBrand", "conditionType", "packaging", "grade", "phoneModel", "phoneStorage", "phoneCarrier", "ktDeductCrackedBack", "atlasDeductCrackedBack", "atlasDeductCrackedLens", "atlasDeductBattery", "atlasDeductRepair", "atlasDeductFaceId"].forEach((id) => {
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
  await loadManualPhoneReturns();
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

async function loadManualPhoneReturns() {
  const result = await api("/api/phone-manual-returns", { silent: true });
  manualPhoneReturns = result?.returns || [];
  renderInvoiceLists();
}

function openPhoneTab(name) {
  const titles = {
    dashboard: "Dashboard",
    purchase: "Add Purchase",
    priceChecker: "Price Checker",
    atlasPending: "Atlas Pending",
    ktPending: "KT Pending",
    locallySold: "Locally Sold",
    giftCards: "Gift Cards",
    ktReturns: "Returns",
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
  clearPurchaseFlowAfter(id);
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
  updatePurchaseFlowVisibility();
}

function toggleConditionFields() {
  const isNew = $("conditionType").value === "New";
  togglePurchaseDeductionFields();
  updatePurchaseFlowVisibility();
}

function togglePurchaseDeductionFields() {
  $("atlasPurchaseDeductions").classList.toggle("hidden", $("phoneBuyer").value !== "Atlas");
  $("ktPurchaseDeductions").classList.toggle("hidden", $("phoneBuyer").value !== "KT");
}

function clearPurchaseFlowAfter(id) {
  const clears = {
    deviceType: ["phoneBrand", "phoneModel", "phoneStorage", "phoneCarrier", "conditionType", "packaging", "grade"],
    phoneBrand: ["phoneModel", "phoneStorage", "phoneCarrier", "conditionType", "packaging", "grade"],
    phoneModel: ["phoneStorage", "phoneCarrier"],
    phoneStorage: ["phoneCarrier", "conditionType", "packaging", "grade"],
    phoneCarrier: ["conditionType", "packaging", "grade"],
    conditionType: ["packaging", "grade"],
  };
  (clears[id] || []).forEach((fieldId) => {
    if ($(fieldId)) $(fieldId).value = "";
  });
}

function updatePurchaseFlowVisibility() {
  const hasBrand = Boolean($("phoneBrand").value);
  const hasModel = hasBrand && Boolean($("phoneModel").value);
  const hasStorage = hasModel && Boolean($("phoneStorage").value);
  const hasCarrier = hasStorage && Boolean($("phoneCarrier").value);
  const hasCondition = hasCarrier && Boolean($("conditionType").value);
  const needsPackaging = $("conditionType").value === "New";
  const conditionDetailReady = hasCondition && (needsPackaging ? Boolean($("packaging").value) : Boolean($("grade").value));
  $("purchaseBrandWrap").classList.remove("hidden");
  $("purchaseModelWrap").classList.toggle("hidden", !hasBrand);
  $("purchaseStorageWrap").classList.toggle("hidden", !hasModel);
  $("purchaseCarrierWrap").classList.toggle("hidden", !hasStorage);
  $("purchaseConditionWrap").classList.toggle("hidden", !hasCarrier);
  $("packagingWrap").classList.toggle("hidden", !(hasCondition && needsPackaging));
  $("gradeWrap").classList.toggle("hidden", !(hasCondition && !needsPackaging));
  $("purchaseQuantityWrap").classList.toggle("hidden", !conditionDetailReady);
  $("purchaseDetailsWrap").classList.toggle("hidden", !conditionDetailReady);
  $("purchaseExtrasWrap").classList.toggle("hidden", !conditionDetailReady);
}

function matchingRows() {
  const deviceType = $("deviceType").value;
  const conditionType = $("conditionType").value;
  const buyer = $("phoneBuyer").value;
  return atlasPrices.filter((row) => row.buyer === buyer
    && row.device_type === deviceType
    && (!conditionType || row.condition_type === conditionType)
    && rowBrand(row) === $("phoneBrand").value);
}

function modelKey(row) {
  return [row.base_model || row.model, row.storage].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function renderModelOptions() {
  const previous = $("phoneModel").value;
  const models = [...new Set([...matchingRows().map(checkerModelName).filter(Boolean), ...fallbackPhoneModels($("deviceType").value, $("phoneBrand").value)])]
    .sort((a, b) => modelSortValue(b) - modelSortValue(a) || a.localeCompare(b));
  $("phoneModel").innerHTML = `<option value="">Choose model</option>` + models.map((model) => `<option value="${escapeAttr(model)}">${escapeHtml(model)}</option>`).join("")
    || `<option value="">No Atlas models loaded</option>`;
  if (models.includes(previous)) $("phoneModel").value = previous;
}

function renderPhoneStorageOptions() {
  const selectedModel = $("phoneModel").value;
  const rows = matchingRows().filter((row) => checkerModelName(row) === selectedModel);
  const storageOptions = [...new Set([...rows.map((row) => row.storage || "N/A").filter(Boolean), ...fallbackPhoneStorage($("deviceType").value, $("phoneBrand").value, selectedModel)])]
    .sort((a, b) => storageSortValue(a) - storageSortValue(b) || a.localeCompare(b));
  const previous = $("phoneStorage").value;
  $("phoneStorage").innerHTML = `<option value="">Choose gigabytes</option>` + storageOptions.map((storage) => `<option value="${escapeAttr(storage)}">${escapeHtml(storage)}</option>`).join("")
    || `<option value="">Choose model first</option>`;
  if (storageOptions.includes(previous)) $("phoneStorage").value = previous;
}

function renderCarrierOptions() {
  const selectedModel = $("phoneModel").value;
  const selectedStorage = $("phoneStorage").value;
  const rows = matchingRows().filter((row) => checkerModelName(row) === selectedModel && (row.storage || "N/A") === selectedStorage);
  const allowed = new Set(["Unlocked", "Carrier Locked", "AT&T (Clean)", "Parts"]);
  const carriers = [...new Set([...rows.map((row) => normalizeCheckerCarrier(row.carrier || "Unlocked")).filter((carrier) => allowed.has(carrier)), ...fallbackPhoneCarriers($("deviceType").value, $("phoneBrand").value)])].sort((a, b) => {
    if (a === "Unlocked") return -1;
    if (b === "Unlocked") return 1;
    if (a === "Carrier Locked") return -1;
    if (b === "Carrier Locked") return 1;
    if (a === "AT&T (Clean)") return -1;
    if (b === "AT&T (Clean)") return 1;
    return a.localeCompare(b);
  });
  const previous = $("phoneCarrier").value;
  $("phoneCarrier").innerHTML = `<option value="">Choose carrier</option>` + carriers.map((carrier) => `<option value="${escapeAttr(carrier)}">${escapeHtml(carrier)}</option>`).join("")
    || `<option value="">Choose model first</option>`;
  if (carriers.includes(previous)) $("phoneCarrier").value = previous;
}

function selectedCondition() {
  if ($("conditionType").value !== "New") return $("grade").value;
  return $("packaging").value === "Sealed" ? "NEW" : $("packaging").value;
}

function pricingCondition() {
  return selectedCondition();
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
  const models = [...new Set([...checkerRows().map(checkerModelName).filter(Boolean), ...fallbackPhoneModels($("checkerDeviceType").value, $("checkerBrand").value)])]
    .sort((a, b) => modelSortValue(b) - modelSortValue(a) || a.localeCompare(b));
  $("checkerModel").innerHTML = models.map((model) => `<option value="${escapeAttr(model)}">${escapeHtml(model)}</option>`).join("")
    || `<option value="">No models loaded</option>`;
  if (models.includes(previous)) $("checkerModel").value = previous;
}

function renderPriceCheckerStorage() {
  const selectedModel = $("checkerModel").value;
  const rows = checkerRows().filter((row) => checkerModelName(row) === selectedModel);
  const storageOptions = [...new Set([...rows.map((row) => row.storage || "N/A").filter(Boolean), ...fallbackPhoneStorage($("checkerDeviceType").value, $("checkerBrand").value, selectedModel)])]
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
  const carriers = [...new Set([...rows.map((row) => normalizeCheckerCarrier(row.carrier || "Unlocked")).filter((carrier) => allowed.has(carrier)), ...fallbackPhoneCarriers($("checkerDeviceType").value, $("checkerBrand").value)])].sort((a, b) => {
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
  return findCheckerPriceWithCondition(buyer, checkerConditionForBuyer(buyer));
}

function findCheckerPriceWithCondition(buyer, condition) {
  const selectedModel = $("checkerModel").value;
  const selectedStorage = $("checkerStorage").value;
  const carrier = $("checkerCarrier").value;
  const rows = checkerRows().filter((row) => row.buyer === buyer);
  const exact = rows.find((row) => checkerModelName(row) === selectedModel && (row.storage || "N/A") === selectedStorage && normalizeCheckerCarrier(row.carrier) === carrier && row.condition === condition);
  const fallback = rows.find((row) => checkerModelName(row) === selectedModel && (row.storage || "N/A") === selectedStorage && normalizeCheckerCarrier(row.carrier || "Any") === "Any" && row.condition === condition);
  return exact || fallback || null;
}

function renderPriceCheckerResults() {
  const cards = ["Atlas", "KT"].map((buyer) => {
    const row = findCheckerPrice(buyer);
    if (!row) {
      return `<div class="price-check-card missing"><span>${buyer}</span><strong>No price found</strong><em>${escapeHtml(checkerConditionForBuyer(buyer))}</em></div>`;
    }
    const pricedRow = row;
    const deduction = buyer === "Atlas" ? selectedAtlasDeduction(row) : selectedKtDeduction(row, $("deductCrackedBack").checked);
    const finalEach = Math.max(0, Number(pricedRow.price || 0) - Number(deduction.amount || 0));
    const deductionText = deduction.amount ? `<i>Deductions: -${money(deduction.amount)}</i>` : "";
    const askText = deduction.notes.length ? `<i>${escapeHtml(deduction.notes.join(" | "))}</i>` : "";
    return `<div class="price-check-card"><span>${buyer}</span><strong>${money(finalEach)}</strong><em>${escapeHtml(pricedRow.source_sheet || pricedRow.source || "Price sheet")} - ${escapeHtml(pricedRow.condition)} - ${escapeHtml(normalizeCheckerCarrier(pricedRow.carrier || "Any"))}</em>${deductionText}${askText}</div>`;
  }).join("");
  $("priceCheckerResults").innerHTML = cards;
}

function checkerModelName(row) {
  return row.base_model || String(row.model || "").replace(/\b\d+\s*(GB|TB)\b/i, "").replace(/AT&T\s*\(Clean\)|Carrier Locked|Unlocked|T-Mobile|Verizon|Cricket|Metro|Spectrum|Xfinity|US Cellular|Boost/ig, "").replace(/\s+/g, " ").trim();
}

function rowBrand(row) {
  const text = `${row.base_model || ""} ${row.model || ""}`.toLowerCase();
  if (/pixel|google/.test(text)) return "Google";
  if (/samsung|galaxy|\bs\d{2}/.test(text)) return "Samsung";
  return "Apple";
}

const APPLE_FALLBACK_MODELS = [
  "iPhone 17 Pro Max",
  "iPhone 17 Pro",
  "iPhone 17 Air",
  "iPhone 17",
  "iPhone 16 Pro Max",
  "iPhone 16 Pro",
  "iPhone 16 Plus",
  "iPhone 16e",
  "iPhone 16",
  "iPhone 15 Pro Max",
  "iPhone 15 Pro",
  "iPhone 15 Plus",
  "iPhone 15",
  "iPhone 14 Pro Max",
  "iPhone 14 Pro",
  "iPhone 14 Plus",
  "iPhone 14",
  "iPhone 13 Pro Max",
  "iPhone 13 Pro",
  "iPhone 13",
];

function fallbackPhoneModels(deviceType, brand) {
  if (deviceType !== "Phone" || brand !== "Apple") return [];
  return APPLE_FALLBACK_MODELS;
}

function fallbackPhoneStorage(deviceType, brand, model) {
  if (deviceType !== "Phone" || brand !== "Apple" || !model) return [];
  if (/17 Pro Max|17 Pro|16 Pro Max|16 Pro|15 Pro Max|15 Pro/i.test(model)) return ["128GB", "256GB", "512GB", "1TB"];
  if (/17|16 Plus|16e|16|15 Plus|15|14 Plus|14|13/i.test(model)) return ["128GB", "256GB", "512GB"];
  return ["128GB", "256GB", "512GB"];
}

function fallbackPhoneCarriers(deviceType, brand) {
  if (deviceType !== "Phone" || brand !== "Apple") return [];
  return ["Unlocked", "Carrier Locked", "AT&T (Clean)"];
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
  return atlasDeductionFromSelection(row, {
    crackedBack: $("deductCrackedBack").checked,
    crackedLens: $("deductCrackedLens").checked,
    battery: $("deductBattery").checked,
    repair: $("deductRepair").checked,
    faceId: $("deductFaceId").checked,
  });
}

function selectedAtlasPurchaseDeduction(row) {
  return atlasDeductionFromSelection(row, {
    crackedBack: $("atlasDeductCrackedBack").checked,
    crackedLens: $("atlasDeductCrackedLens").checked,
    battery: $("atlasDeductBattery").checked,
    repair: $("atlasDeductRepair").checked,
    faceId: $("atlasDeductFaceId").checked,
  });
}

function atlasDeductionFromSelection(row, selection) {
  const notes = [];
  let amount = 0;
  if (selection.crackedBack) {
    const deduction = atlasCrackedBackDeduction(row.base_model || row.model);
    if (deduction) amount += deduction;
    else notes.push("Atlas cracked back: ASK");
  }
  if (selection.crackedLens) {
    const lensText = atlasCrackedLensText(row.base_model || row.model);
    const lensAmount = atlasDeductionAmountFromText(lensText);
    if (lensAmount) amount += lensAmount;
    notes.push(`Atlas cracked lens: ${lensText}`);
  }
  if (selection.battery) notes.push("Atlas battery / degraded battery: ASK");
  if (selection.repair) notes.push("Atlas repair message: ASK");
  if (selection.faceId) notes.push("Atlas bad Face ID: price as Parts or ASK");
  if (amount) notes.unshift(`Atlas cracked back: -${money(amount)}`);
  return { amount, notes };
}

function selectedKtDeduction(row, crackedBack) {
  if (!crackedBack) return { amount: 0, notes: [] };
  const amount = ktCrackedBackDeduction(row.base_model || row.model);
  return amount
    ? { amount, notes: [`KT cracked back glass: -${money(amount)}`] }
    : { amount: 0, notes: ["KT cracked back glass: ASK"] };
}

function ktCrackedBackDeduction(model) {
  const text = String(model || "").toLowerCase();
  if (/17 pro max/.test(text)) return 180;
  if (/17 pro/.test(text)) return 140;
  if (/\b17e\b/.test(text) || /\b17\b/.test(text)) return 200;
  if (/16 pro max/.test(text)) return 120;
  if (/16 pro/.test(text)) return 120;
  if (/16 plus/.test(text)) return 60;
  if (/\b16\b/.test(text)) return 60;
  if (/15 pro max/.test(text)) return 80;
  if (/15 pro/.test(text)) return 70;
  if (/15 plus/.test(text)) return 70;
  if (/\b15\b/.test(text)) return 40;
  if (/14 pro max/.test(text)) return 50;
  if (/14 pro/.test(text)) return 50;
  if (/14 plus/.test(text)) return 50;
  if (/\b14\b/.test(text)) return 60;
  if (/13 pro max/.test(text)) return 50;
  if (/13 pro/.test(text)) return 50;
  if (/\b13\b/.test(text)) return 50;
  return 0;
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

function atlasDeductionAmountFromText(value) {
  const text = String(value || "");
  if (/to|ask/i.test(text)) return 0;
  return Number(text.match(/\$?(\d+(?:\.\d+)?)/)?.[1] || 0);
}

function imageFileToDataUrl(file, options = {}) {
  const max = options.max || 1200;
  const quality = options.quality || 0.78;
  const label = options.label || "phone photo";
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${label}.`));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error(`Could not load ${label}.`));
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve({ file_name: file.name, data_url: canvas.toDataURL("image/jpeg", quality) });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function giftCardImageToDataUrl(file) {
  return imageFileToDataUrl(file, { max: 2400, quality: 0.94, label: "gift card image" });
}

function updateProjectedPrice() {
  const selectedModel = $("phoneModel").value;
  const selectedStorage = $("phoneStorage").value;
  const carrier = $("phoneCarrier").value;
  const condition = phonePricingCondition();
  const exact = matchingRows().find((row) => checkerModelName(row) === selectedModel && (row.storage || "N/A") === selectedStorage && normalizeCheckerCarrier(row.carrier) === carrier && row.condition === condition);
  const fallback = matchingRows().find((row) => checkerModelName(row) === selectedModel && (row.storage || "N/A") === selectedStorage && normalizeCheckerCarrier(row.carrier || "Any") === "Any" && row.condition === condition);
  const row = exact || fallback;
  if (row?.price) {
    const deduction = selectedPhonePurchaseDeduction(row);
    const finalPrice = Math.max(0, Number(row.price || 0) - Number(deduction.amount || 0));
    $("phoneProjected").value = finalPrice;
  } else {
    $("phoneProjected").value = "";
  }
  $("phonePricePreview").classList.add("hidden");
}

function phonePricingCondition() {
  return pricingCondition();
}

function selectedPhonePurchaseDeduction(row) {
  if ($("phoneBuyer").value === "Atlas") return selectedAtlasPurchaseDeduction(row);
  return selectedKtDeduction(row, $("phoneBuyer").value === "KT" && $("ktDeductCrackedBack").checked);
}

function selectedKtPurchaseDeductions() {
  if ($("phoneBuyer").value !== "KT") return [];
  const deductions = [];
  if ($("ktDeductCrackedBack")?.checked) deductions.push("KT cracked back glass");
  return deductions;
}

function selectedAtlasPurchaseDeductions() {
  if ($("phoneBuyer").value !== "Atlas") return [];
  const selectedModel = $("phoneModel").value;
  const selectedStorage = $("phoneStorage").value;
  const carrier = $("phoneCarrier").value;
  const condition = phonePricingCondition();
  const exact = matchingRows().find((row) => checkerModelName(row) === selectedModel && (row.storage || "N/A") === selectedStorage && row.carrier === carrier && row.condition === condition);
  const fallback = matchingRows().find((row) => checkerModelName(row) === selectedModel && (row.storage || "N/A") === selectedStorage && row.condition === condition);
  return selectedAtlasPurchaseDeduction(exact || fallback || { model: selectedModel }).notes;
}

function renderInvoiceSelect() {
  const buyer = $("phoneBuyer").value;
  const pending = phoneInvoices.filter((invoice) => invoice.buyer === buyer && invoice.status === "Pending");
  $("phoneInvoiceSelect").innerHTML = pending.map((invoice) => (
    `<option value="${invoice.id}">#${invoice.id} - ${escapeHtml(invoice.label)} (${invoiceTotals(invoice).units} phones)</option>`
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

async function savePhonePurchase(options = {}) {
  const photoFile = $("phonePhoto").files?.[0] || null;
  const photo = photoFile ? await imageFileToDataUrl(photoFile) : null;
  const body = phonePurchasePayload(photo);
  const result = await api(editingPhonePurchaseId ? `/api/phone-purchases/${editingPhonePurchaseId}` : "/api/phone-purchases", {
    method: editingPhonePurchaseId ? "PATCH" : "POST",
    body,
  });
  if (!result?.ok) {
    if (!options.silent) status("phonePurchaseStatus", result?.error || "Could not save purchase.", "bad");
    return result;
  }
  if (!options.silent) status("phonePurchaseStatus", editingPhonePurchaseId ? `Updated phone on ${result.invoice.buyer} invoice #${result.invoice.id}.` : `Added purchase to ${result.invoice.buyer} invoice #${result.invoice.id}.`);
  if (!options.keepForm) resetPhonePurchase(false);
  if (!options.silent) await loadPhoneInvoices();
  return result;
}

async function parseQuickPhoneText(saveAfterParse) {
  const entries = quickPhoneEntries();
  if (saveAfterParse && entries.length > 1) return addQuickPhoneLines(entries);
  const parsed = parseQuickPhoneLine(entries[0] || "");
  if (!parsed.modelText) {
    return status("quickPhoneStatus", "Type at least a model, like iPhone 17 256GB unlocked grade C.", "bad");
  }
  applyQuickPhoneFields(parsed);
  if (!saveAfterParse) {
    status("quickPhoneStatus", `Filled flow for ${escapeHtml($("phoneModel").value || parsed.modelText)}.`);
    return null;
  }
  await savePhonePurchase();
  status("quickPhoneStatus", `Added ${escapeHtml(parsed.modelText)} to the selected invoice.`);
  $("quickPhoneText").value = "";
  return null;
}

function quickPhoneLines() {
  return String($("quickPhoneText").value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function quickPhoneEntries() {
  return splitQuickPhoneEntries($("quickPhoneText").value);
}

async function addQuickPhoneLines(entries) {
  let added = 0;
  const failures = [];
  for (const entry of entries) {
    const parsed = parseQuickPhoneLine(entry);
    if (!parsed.modelText) {
      failures.push(typeof entry === "string" ? entry : entry.text);
      continue;
    }
    applyQuickPhoneFields(parsed);
    const result = await savePhonePurchase({ silent: true, keepForm: true });
    if (result?.ok) added += 1;
    else failures.push(`${typeof entry === "string" ? entry : entry.text} (${result?.error || "not saved"})`);
  }
  await loadPhoneInvoices();
  if (failures.length) {
    status("quickPhoneStatus", `Added ${added}. Could not add: ${escapeHtml(failures.join("; "))}`, "bad");
  } else {
    status("quickPhoneStatus", `Added ${added} phones to the selected invoice.`);
    $("quickPhoneText").value = "";
  }
  resetPhonePurchase(false);
  return null;
}

async function moveLatestPhones() {
  const count = Math.max(1, Math.min(25, Number($("moveLatestPhoneCount").value || 5)));
  const buyer = $("moveLatestPhoneBuyer").value;
  if (!confirm(`Move the latest ${count} active phone purchase${count === 1 ? "" : "s"} to the ${buyer} pending invoice?`)) return;
  status("moveLatestPhonesStatus", "Moving phones...");
  const result = await api("/api/phone-purchases/move-latest", {
    method: "POST",
    body: { count, buyer },
  });
  if (!result?.ok) {
    status("moveLatestPhonesStatus", result?.error || "Could not move those phones.", "bad");
    return;
  }
  const moved = result.moved?.length || 0;
  status(
    "moveLatestPhonesStatus",
    moved
      ? `Moved ${moved} phone${moved === 1 ? "" : "s"} to ${buyer} invoice #${result.invoice.id}.`
      : `No active phones found outside the ${buyer} pending invoice.`,
    moved ? "ok" : "bad"
  );
  await loadPhoneInvoices();
  openPhoneTab(`${buyer.toLowerCase()}Pending`);
}

function parseQuickPhoneLine(value) {
  const entry = typeof value === "object" && value ? value : { text: String(value || "") };
  const raw = normalizeQuickPurchaseInput([entry.text, entry.seller ? `From ${entry.seller}` : "", entry.purchaseLocation ? `Bought at ${entry.purchaseLocation}` : ""].filter(Boolean).join(" "));
  const sellerLocation = extractQuickSellerLocation(raw);
  let seller = entry.seller || sellerLocation?.seller || extractQuickInlineSeller(raw) || "";
  const purchaseLocation = entry.purchaseLocation || sellerLocation?.purchaseLocation || extractQuickInlinePurchaseLocation(raw) || "";
  const itemRaw = removeQuickSellerAndLocation(raw, seller, purchaseLocation);
  const text = raw.toLowerCase();
  const atlasPurchase = entry.invoiceLane === "atlas" || /\b(?:atlas|parts|for parts|part out|parts only)\b/i.test(raw);
  const buyer = atlasPurchase || /\batlas\b/i.test(raw) ? "Atlas" : /\bkt\b|kt corp/i.test(raw) ? "KT" : $("phoneBuyer").value;
  const quantityResult = extractQuickQuantity(itemRaw);
  let itemText = quantityResult.text;
  const priceResult = extractQuickPrice(itemText);
  const cost = priceResult.price || 0;
  const priceSource = priceResult.source;
  itemText = priceResult.text;
  if (!seller && !priceSource) {
    const looseSeller = extractQuickLooseSeller(itemText);
    if (looseSeller) {
      seller = looseSeller;
      itemText = removeQuickLooseSeller(itemText);
    }
  }
  const storageResult = extractQuickStorage(itemText);
  const storage = atlasPurchase ? "N/A" : storageResult.storage || "N/A";
  itemText = storageResult.text;
  const conditionResult = extractQuickCondition(itemText);
  const conditionValue = atlasPurchase ? "Parts" : conditionResult.condition;
  itemText = conditionResult.text;
  const carrierResult = extractQuickCarrier(itemText);
  const carrier = atlasPurchase ? "Parts" : mapQuickCarrier(carrierResult.carrier);
  itemText = carrierResult.text;
  const gradeResult = extractQuickGrade(itemText);
  const grade = atlasPurchase ? "Parts" : gradeResult.grade || "Grade A";
  itemText = gradeResult.text;
  const colorResult = extractQuickColor(itemText);
  itemText = colorResult.text;
  const modelText = quickCleanModel(itemText, raw);
  const deviceType = /\bipad|tablet\b/i.test(modelText) ? "Tablet" : "Phone";
  const brand = /pixel|google/i.test(modelText) ? "Google" : /samsung|galaxy|\bs\d{1,2}\b|z\s*(fold|flip)|note\s*\d/i.test(modelText) ? "Samsung" : "Apple";
  const conditionType = conditionValue === "New" || conditionValue === "Open Box" ? "New" : "Used";
  const packaging = conditionValue === "Open Box" ? "Open" : "Sealed";
  const imei = raw.match(/\bimei\s*[:#-]?\s*([a-z0-9-]{6,})\b/i)?.[1] || "";
  const deductions = {
    crackedBack: /cracked?\s+back|back\s+crack|back\s+glass/i.test(raw),
    crackedLens: /cracked?\s+lens|camera\s+lens/i.test(raw),
    battery: /battery|degraded/i.test(raw),
    repair: /repair\s+message/i.test(raw),
    faceId: /face\s*id/i.test(raw),
  };
  const notes = [
    priceSource ? `Source: ${priceSource}` : "",
    seller ? `Seller ${seller}` : "",
    purchaseLocation ? `Bought at ${purchaseLocation}` : "",
    gradeResult.raw ? gradeResult.raw : "",
    colorResult.color ? colorResult.color : "",
    atlasPurchase ? "Parts" : "",
  ].filter(Boolean).join(" | ");
  return { raw, buyer, deviceType, brand, conditionType, packaging, grade, storage, carrier, quantity: quantityResult.quantity, cost, imei, deductions, modelText, notes };
}

function quickModelText(raw, brand, storage, carrier) {
  let text = String(raw || "")
    .replace(/\b(?:atlas|kt|kt corp)\b/ig, " ")
    .replace(/\b(?:qty|quantity)\s*\d+\b/ig, " ")
    .replace(/\b\d+\s*x\b/ig, " ")
    .replace(/\b(?:cost|paid|buy|bought|for)\s*\$?\s*\d+(?:\.\d{1,2})?\b/ig, " ")
    .replace(/\bimei\s*[:#-]?\s*[a-z0-9-]{6,}\b/ig, " ")
    .replace(/\bgrade\s*[abcd]\b/ig, " ")
    .replace(/\b(?:grade|used|new|sealed|open|parts?|cracked?|back|glass|lens|battery|degraded|repair|message|face\s*id)\b/ig, " ")
    .replace(/\b(?:unlocked|carrier locked|sim locked|locked|at&t|att clean)\b/ig, " ")
    .replace(/\b\d+\s*(?:gb|tb)\b/ig, " ")
    .replace(/\b(?:64|128|256|512|1024)\b/ig, " ")
    .replace(/\$\s*\d+(?:\.\d{1,2})?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) text = raw;
  if (brand === "Apple" && /^\d/.test(text)) text = `iPhone ${text}`;
  if (brand === "Samsung" && /^s\d/i.test(text)) text = `Galaxy ${text}`;
  return text.replace(/\s+/g, " ").trim();
}

function splitQuickPhoneEntries(value) {
  const rawLines = String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (rawLines.length <= 1) return rawLines.map((line) => ({ text: line }));
  const entries = [];
  let group = [];
  let currentSeller = "";
  let purchaseLocation = "";
  let invoiceLane = "";
  rawLines.forEach((line) => {
    const lane = quickStandaloneLane(line);
    if (lane) {
      invoiceLane = lane;
      group.forEach((entry) => { entry.invoiceLane = lane; });
      return;
    }
    const sellerLocation = extractQuickSellerLocation(line);
    if (sellerLocation) {
      group.forEach((entry) => {
        entry.seller = sellerLocation.seller;
        entry.purchaseLocation = entry.purchaseLocation || sellerLocation.purchaseLocation;
        entries.push(entry);
      });
      group = [];
      currentSeller = sellerLocation.seller;
      purchaseLocation = sellerLocation.purchaseLocation || purchaseLocation;
      return;
    }
    const seller = extractQuickSeller(line);
    if (seller) {
      group.forEach((entry) => {
        entry.seller = seller;
        entries.push(entry);
      });
      group = [];
      currentSeller = seller;
      return;
    }
    const lineLocation = extractQuickPurchaseLocation(line);
    if (lineLocation && !looksLikeQuickPurchaseLine(line)) {
      purchaseLocation = lineLocation;
      group.forEach((entry) => { entry.purchaseLocation = entry.purchaseLocation || purchaseLocation; });
      return;
    }
    if (group.length && !looksLikeQuickPurchaseLine(line) && extractQuickPrice(line).price) {
      group[group.length - 1].text += ` ${line}`;
      return;
    }
    group.push({ text: line, seller: currentSeller, purchaseLocation: lineLocation || purchaseLocation, invoiceLane });
  });
  group.forEach((entry) => entries.push(entry));
  return entries;
}

function quickStandaloneLane(line) {
  const value = String(line || "").trim();
  if (/^(?:atlas|parts|for\s+parts|parts\s+only|part\s+out)$/i.test(value)) return "atlas";
  if (/^(?:kt|main|regular)$/i.test(value)) return "regular";
  return "";
}

function normalizeQuickPurchaseInput(value) {
  return String(value || "")
    .replace(/\b(?:baught|bougnt|bougt|boughtt|buoght|boght|bouth|bough|bot|b0ught)\b/gi, "bought")
    .replace(/[–—]/g, "-")
    .replace(/\bapplewatch\b/gi, "apple watch")
    .replace(/\bpromax\b/gi, "pro max")
    .replace(/\bopenbox\b/gi, "open box")
    .replace(/\bcarrier\s+lock(?:ed)?\b/gi, "locked")
    .replace(/\bsim\s*lock(?:ed)?\b/gi, "locked")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeQuickPurchaseLine(line) {
  const value = normalizeQuickPurchaseInput(line);
  const withoutQty = extractQuickQuantity(value).text;
  return /\b(?:iphone\s*)?(?:[1-9]|1[0-9])e?(?:\s*(?:pro\s*max|pm|pro|p|max|plus|mini))?\b/i.test(withoutQty)
    || /\b(?:ipad|i\s*pad)\b/i.test(withoutQty)
    || /\b(?:google\s+)?pixel\s+\d+\b/i.test(withoutQty)
    || /\bs\d{1,2}(?:\s+(?:ultra|plus|fe))?\b/i.test(withoutQty)
    || /\bgalaxy\b/i.test(withoutQty);
}

function extractQuickSeller(line) {
  const match = normalizeQuickPurchaseInput(line).match(/^(?:from|seller|vendor|source|bought\s+from)\s*[:\-]?\s+(.+)$/i);
  return match ? quickTitle(stripQuickNoise(match[1])) : "";
}

function extractQuickSellerLocation(line) {
  const value = normalizeQuickPurchaseInput(line);
  const match = value.match(/\b(?:bought\s+)?from\s+(.+?)\s+(?:at|@)\s+(.+)$/i);
  if (!match) return null;
  return { seller: quickTitle(stripQuickNoise(match[1])), purchaseLocation: quickTitle(stripQuickNoise(match[2])) };
}

function extractQuickPurchaseLocation(line) {
  const value = normalizeQuickPurchaseInput(line);
  const match = value.match(/(?:bought|buy|purchase|purchased|got)\s+(?:at|@)\s+(.+)$/i) || value.match(/^(?:at|@)\s+(.+)$/i);
  return match ? quickTitle(stripQuickNoise(match[1])) : "";
}

function extractQuickInlineSeller(line) {
  const value = normalizeQuickPurchaseInput(line);
  const match = value.match(/\b(?:from|seller|vendor|source|bought\s+from)\s*[:\-]?\s+([a-z][a-z0-9 .'-]*?)(?:\s+(?:bought\s+)?(?:at|@)\s+|$)/i);
  return match ? quickTitle(stripQuickNoise(match[1])) : "";
}

function extractQuickInlinePurchaseLocation(line) {
  const value = normalizeQuickPurchaseInput(line);
  const match = value.match(/\b(?:bought|buy|purchase|purchased|got)\s+(?:at|@)\s+([a-z0-9 .'-]+)$/i) || value.match(/\b(?:at|@)\s+([a-z0-9 .'-]+)$/i);
  return match ? quickTitle(stripQuickNoise(match[1])) : "";
}

function removeQuickSellerAndLocation(line, seller, location) {
  let text = String(line || "");
  text = text
    .replace(/\b(?:from|seller|vendor|source|bought\s+from)\s*[:\-]?\s+[a-z][a-z0-9 .'-]*?(?=\s+(?:bought\s+)?(?:at|@)\s+|$)/ig, " ")
    .replace(/\b(?:bought|buy|purchase|purchased|got)\s+(?:at|@)\s+[a-z0-9 .'-]+$/ig, " ")
    .replace(/\b(?:at|@)\s+[a-z0-9 .'-]+$/ig, " ");
  if (seller) text = text.replace(new RegExp(`\\b${escapeRegExp(seller)}\\b`, "ig"), " ");
  if (location) text = text.replace(new RegExp(`\\b${escapeRegExp(location)}\\b`, "ig"), " ");
  return text.replace(/\s+/g, " ").trim();
}

function stripQuickNoise(value) {
  return String(value || "").replace(/[.,;:]+$/g, "").trim();
}

function extractQuickLooseSeller(value) {
  const match = String(value || "").trim().match(/\s+([a-z][a-z'-]{1,24})$/i);
  if (!match) return "";
  const word = match[1].toLowerCase();
  const blocked = new Set(["pro", "max", "plus", "mini", "ultra", "fold", "flip", "pixel", "iphone", "ipad", "new", "used", "locked", "unlocked", "lock", "grade", "parts", "black", "white", "blue", "silver", "gold", "orange", "green", "purple", "natural", "desert", "teal", "lavender"]);
  return blocked.has(word) ? "" : quickTitle(word);
}

function removeQuickLooseSeller(value) {
  const seller = extractQuickLooseSeller(value);
  return seller ? String(value || "").replace(new RegExp(`\\s+${escapeRegExp(seller)}$`, "i"), "").trim() : value;
}

function extractQuickQuantity(value) {
  let text = String(value || "").trim();
  const patterns = [/^(\d+)\s*x\b\s*/i, /^x\s*(\d+)\b\s*/i, /^qty\s*[:\-]?\s*(\d+)\b\s*/i, /\bx\s*(\d+)\b/i, /\bqty\s*[:\-]?\s*(\d+)\b/i];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return { quantity: Number(match[1]), text: removeQuickMatch(text, match) };
  }
  const leading = text.match(/^(\d+)\s+(?=(?:iphone\s*)?(?:1[0-9]|se|xr|xs)\b|(?:1[0-9])\s*(?:p|pm|pro|max|plus|mini)|s\d{1,2}\b)/i);
  if (leading) return { quantity: Number(leading[1]), text: text.slice(leading[0].length).trim() };
  return { quantity: 1, text };
}

function extractQuickPrice(value) {
  const text = String(value || "");
  const money = [...text.matchAll(/\$\s*([0-9][0-9,]*(?:\.\d{1,2})?)/g)];
  const matches = money.length ? money : [...text.matchAll(/\b([0-9][0-9,]*(?:\.\d{1,2})?)\b/g)].filter((match) => {
    const price = Number(match[1].replace(/,/g, ""));
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 4);
    return Number.isFinite(price) && price >= 50 && !normalizeQuickStorage(match[1], after.match(/^\s*(gb|g|tb|t)\b/i)?.[1] || "");
  });
  if (!matches.length) return { price: 0, text, source: "" };
  const match = matches[matches.length - 1];
  const afterPrice = text.slice(match.index + match[0].length);
  const source = quickTitle(stripQuickNoise(afterPrice.replace(/^[\s,;:-]+/, "")));
  const cleanedText = source ? text.slice(0, match.index).trim() : removeQuickMatch(text, match);
  return { price: Number(match[1].replace(/,/g, "")), text: cleanedText, source };
}

function extractQuickStorage(value) {
  const text = String(value || "");
  const explicit = text.match(/\b(\d+(?:\.\d+)?)\s*(TB|T|GB|G)\b/i);
  if (explicit) return { storage: normalizeQuickStorage(explicit[1], explicit[2]), text: removeQuickMatch(text, explicit) };
  const numbers = [...text.matchAll(/\b(\d{1,4})\b/g)];
  for (const match of numbers) {
    const storage = normalizeQuickStorage(match[1], "");
    if (storage) return { storage, text: removeQuickMatch(text, match) };
  }
  return { storage: "", text };
}

function normalizeQuickStorage(amount, unit) {
  const value = Number(String(amount || "").replace(/,/g, ""));
  if (!Number.isFinite(value)) return "";
  if (/^t/i.test(unit || "")) return `${Math.abs(value - 2) <= 0.1 ? 2 : 1}TB`;
  if (value >= 900) return "1TB";
  const snapped = [64, 128, 256, 512].find((target) => Math.abs(value - target) <= 2);
  return snapped ? `${snapped}GB` : "";
}

function extractQuickCondition(value) {
  const patterns = [
    { regex: /\b(?:bnib|sealed|brand\s+new|new)\b/i, condition: "New" },
    { regex: /\b(?:open\s*box|ob)\b/i, condition: "Open Box" },
    { regex: /\b(?:pre\s*owned|preowned|used)\b/i, condition: "Used" },
    { regex: /\bparts?\b/i, condition: "Parts" },
  ];
  for (const pattern of patterns) {
    const match = String(value || "").match(pattern.regex);
    if (match) return { condition: pattern.condition, text: removeQuickMatch(String(value || ""), match) };
  }
  return { condition: "", text: value };
}

function extractQuickCarrier(value) {
  const patterns = [
    { regex: /\bt[\-\s]?mobile\b|\btm\b/i, carrier: "Locked" },
    { regex: /\bverizon\b|\bvzw\b/i, carrier: "Locked" },
    { regex: /\bat&t\s*clean\b|\batt\s*clean\b|\batt\b|\bat&t\b/i, carrier: "AT&T" },
    { regex: /\bf\/?u\b|\bfu\b|\bfactory\s+unlocked\b|\bsim\s*free\b|\bunlocked\b|\bunlock\b/i, carrier: "Unlocked" },
    { regex: /\bcl\b|\blocked\b|\block\b/i, carrier: "Locked" },
  ];
  for (const pattern of patterns) {
    const match = String(value || "").match(pattern.regex);
    if (match) return { carrier: pattern.carrier, text: removeQuickMatch(String(value || ""), match) };
  }
  return { carrier: "", text: value };
}

function mapQuickCarrier(carrier) {
  if (/^AT&T$/i.test(carrier || "")) return "AT&T (Clean)";
  if (/^Locked$/i.test(carrier || "")) return "Carrier Locked";
  if (/^Unlocked$/i.test(carrier || "")) return "Unlocked";
  return "Unlocked";
}

function extractQuickGrade(value) {
  const match = String(value || "").match(/\bgrade\s*[:\-]?\s*(ab|[a-d][+-]?|excellent|good|fair|poor)\b/i) || String(value || "").match(/\b(ab|[a-d][+-]?)\b/i);
  if (!match) return { grade: "", raw: "", text: value };
  const raw = `Grade ${match[1].toUpperCase()}`;
  const simple = match[1].charAt(0).toUpperCase();
  const grade = ["A", "B", "C", "D"].includes(simple) ? `Grade ${simple}` : "Grade A";
  return { grade, raw, text: removeQuickMatch(String(value || ""), match) };
}

function extractQuickColor(value) {
  const colors = ["lavender", "black", "white", "silver", "gold", "blue", "pink", "orange", "green", "purple", "natural", "desert", "teal", "ultramarine"];
  for (const color of colors) {
    const pattern = color === "lavender" ? /\blav(?:e|a)?nd(?:e|a)r\b|\blavdener\b/i : new RegExp(`\\b${color}\\b`, "i");
    const match = String(value || "").match(pattern);
    if (match) return { color: `Color ${quickTitle(color)}`, text: removeQuickMatch(String(value || ""), match) };
  }
  return { color: "", text: value };
}

function quickCleanModel(value, fallback) {
  let text = normalizeQuickPurchaseInput(value)
    .replace(/\b(?:bought|buy|purchase|purchased|got|phone|phones|iphone|google|parts|atlas|kt|part\s+out|only|from|seller|vendor|source)\b/gi, " ")
    .replace(/\bi\s*pad\b/gi, "iPad")
    .replace(/\b(\d{2})\s*e\b/gi, "$1e")
    .replace(/\b(\d{2})\s*(?:pro\s*max|pm)\b/gi, "$1 Pro Max")
    .replace(/\b(\d{2})\s*(?:pro|p)\b/gi, "$1 Pro")
    .replace(/\b(\d{2})\s*plus\b/gi, "$1 Plus")
    .replace(/\b(\d{2})\s*mini\b/gi, "$1 Mini")
    .replace(/\bs(\d{1,2})\s*(ultra|plus|fe)?\b/gi, (_, num, suffix) => `Galaxy S${num}${suffix ? ` ${quickTitle(suffix)}` : ""}`)
    .replace(/\bgoogle\s+pixel\b/gi, "Pixel")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) text = fallback;
  text = quickTitle(text);
  if (/^pixel\s+/i.test(text)) text = `Google ${text}`;
  if (/^ipad\b/i.test(text)) text = text.replace(/^Ipad/i, "iPad");
  return text;
}

function removeQuickMatch(text, match) {
  return `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`.replace(/\s+/g, " ").trim();
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function quickTitle(value) {
  return String(value || "").toLowerCase().split(/\s+/).filter(Boolean).map((word) => {
    if (/^iphone$/i.test(word)) return "iPhone";
    if (/^ipad$/i.test(word)) return "iPad";
    if (/^(gb|tb)$/i.test(word)) return word.toUpperCase();
    if (/^s\d+$/i.test(word)) return word.toUpperCase();
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(" ");
}

function applyQuickPhoneFields(parsed) {
  $("phoneBuyer").value = parsed.buyer;
  renderInvoiceSelect();
  $("deviceType").value = parsed.deviceType;
  $("phoneBrand").value = parsed.brand;
  $("conditionType").value = parsed.conditionType;
  $("packaging").value = parsed.packaging;
  $("grade").value = parsed.grade;
  toggleConditionFields();
  renderModelOptions();
  const model = bestQuickModel(parsed);
  ensureSelectOption("phoneModel", model, model);
  $("phoneModel").value = model;
  renderPhoneStorageOptions();
  ensureSelectOption("phoneStorage", parsed.storage, parsed.storage);
  $("phoneStorage").value = parsed.storage;
  renderCarrierOptions();
  ensureSelectOption("phoneCarrier", parsed.carrier, parsed.carrier);
  $("phoneCarrier").value = parsed.carrier;
  $("phoneQuantity").value = parsed.quantity || 1;
  $("phoneCost").value = parsed.cost || "";
  $("phoneImei").value = parsed.imei;
  $("ktDeductCrackedBack").checked = parsed.buyer === "KT" && parsed.deductions.crackedBack;
  $("atlasDeductCrackedBack").checked = parsed.buyer === "Atlas" && parsed.deductions.crackedBack;
  $("atlasDeductCrackedLens").checked = parsed.buyer === "Atlas" && parsed.deductions.crackedLens;
  $("atlasDeductBattery").checked = parsed.buyer === "Atlas" && parsed.deductions.battery;
  $("atlasDeductRepair").checked = parsed.buyer === "Atlas" && parsed.deductions.repair;
  $("atlasDeductFaceId").checked = parsed.buyer === "Atlas" && parsed.deductions.faceId;
  const notes = [
    parsed.notes || "",
    parsed.deductions.crackedBack ? "Cracked back" : "",
    parsed.deductions.crackedLens ? "Cracked lens" : "",
    parsed.deductions.battery ? "Battery / degraded battery" : "",
    parsed.deductions.repair ? "Repair message" : "",
    parsed.deductions.faceId ? "Bad Face ID" : "",
  ].filter(Boolean).join(" | ");
  $("phoneNotes").value = notes;
  updateProjectedPrice();
  updatePurchaseFlowVisibility();
}

function bestQuickModel(parsed) {
  const wanted = normalizePhonePriceMatchText(parsed.modelText);
  const options = [...new Set(matchingRows().map(checkerModelName).filter(Boolean))];
  return options.find((model) => normalizePhonePriceMatchText(model) === wanted)
    || options.find((model) => normalizePhonePriceMatchText(model).includes(wanted) || wanted.includes(normalizePhonePriceMatchText(model)))
    || parsed.modelText;
}

function normalizePhonePriceMatchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\biphone\b/g, "")
    .replace(/\bgoogle\s+pixel\b/g, "pixel")
    .replace(/\bgalaxy\s+s/g, "s")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function phonePurchasePayload(photo) {
  const purchaseDeductions = [...selectedKtPurchaseDeductions(), ...selectedAtlasPurchaseDeductions()];
  const cleanNotes = $("phoneNotes").value.trim()
    .replace(/\s*\|\s*KT cracked back glass(?::[^|]*)?/gi, "")
    .replace(/^KT cracked back glass(?::[^|]*)?\s*\|\s*/i, "")
    .replace(/\s*\|\s*Atlas (cracked back|cracked lens|battery \/ degraded battery|repair message|bad Face ID)(?::[^|]*)?/gi, "")
    .replace(/^Atlas (cracked back|cracked lens|battery \/ degraded battery|repair message|bad Face ID)(?::[^|]*)?\s*\|\s*/i, "")
    .trim();
  const notes = [cleanNotes, ...purchaseDeductions].filter(Boolean).join(" | ");
  return {
    buyer: $("phoneBuyer").value,
    invoice_id: Number($("phoneInvoiceSelect").value || 0) || null,
    purchase_date: $("phonePurchaseDate").value,
    device_type: $("deviceType").value,
    condition_type: $("conditionType").value,
    packaging: $("conditionType").value === "New" ? $("packaging").value : "",
    grade: $("conditionType").value === "Used" ? selectedCondition() : "",
    model: [$("phoneModel").value, $("phoneStorage").value && $("phoneStorage").value !== "N/A" ? $("phoneStorage").value : ""].filter(Boolean).join(" "),
    carrier: $("phoneCarrier").value,
    quantity: Number($("phoneQuantity").value || 0),
    cost_each: Number($("phoneCost").value || 0),
    projected_sell_each: Number($("phoneProjected").value || 0),
    imei: $("phoneImei").value.trim(),
    photo,
    notes,
  };
}

function resetPhonePurchase(clearStatus = true) {
  editingPhonePurchaseId = null;
  $("savePhonePurchaseBtn").textContent = "Add Purchase To Invoice";
  $("phoneEditNotice").classList.add("hidden");
  $("phoneEditNotice").textContent = "";
  $("deviceType").value = "Phone";
  $("conditionType").value = "";
  $("packaging").value = "";
  $("grade").value = "";
  $("phoneBrand").value = "";
  $("phoneQuantity").value = 1;
  $("phoneCost").value = "";
  $("phoneProjected").value = "";
  $("phoneImei").value = "";
  $("phonePhoto").value = "";
  $("ktDeductCrackedBack").checked = false;
  $("atlasDeductCrackedBack").checked = false;
  $("atlasDeductCrackedLens").checked = false;
  $("atlasDeductBattery").checked = false;
  $("atlasDeductRepair").checked = false;
  $("atlasDeductFaceId").checked = false;
  $("phonePurchaseDate").value = new Date().toISOString().slice(0, 10);
  $("phoneNotes").value = "";
  toggleConditionFields();
  renderModelOptions();
  renderPhoneStorageOptions();
  renderCarrierOptions();
  updateProjectedPrice();
  updatePurchaseFlowVisibility();
  if (clearStatus) status("phonePurchaseStatus", "");
}

function renderInvoiceLists() {
  renderInvoiceGroup("atlasPendingList", "Atlas", "Pending");
  renderInvoiceGroup("ktPendingList", "KT", "Pending");
  renderLocallySold();
  renderGiftCards();
  renderKtReturns();
  renderPastInvoices();
}

function renderInvoiceGroup(id, buyer, view) {
  const list = phoneInvoices.filter((invoice) => {
    if (invoice.buyer !== buyer) return false;
    return view === "Pending" ? invoice.status === "Pending" : invoice.status !== "Pending";
  });
  const summary = view === "Pending" && list.length ? renderPendingBuyerSummary(buyer, list) : "";
  $(id).innerHTML = summary + (list.map(renderPhoneInvoiceCard).join("") || `<div class="empty">No ${buyer} ${view.toLowerCase()} invoices yet.</div>`);
}

function renderPendingBuyerSummary(buyer, invoices) {
  const purchases = invoices.flatMap((invoice) => invoice.purchases || []);
  const totalCost = purchases.reduce((sum, row) => sum + phoneLineCost(row), 0);
  const totalUnits = purchases.reduce((sum, row) => sum + phoneLineQuantity(row), 0);
  const newestDate = purchases.reduce((latest, row) => {
    const time = new Date(row.invoice_added_at || row.purchase_date || row.created_at || 0).getTime();
    return Math.max(latest, Number.isNaN(time) ? 0 : time);
  }, 0);
  return `
    <article class="pending-page-summary">
      <div>
        <span>${escapeHtml(buyer)} Pending</span>
        <strong>${money(totalCost)}</strong>
        <em>${totalUnits} phone${totalUnits === 1 ? "" : "s"} across ${invoices.length} pending invoice${invoices.length === 1 ? "" : "s"}</em>
      </div>
      <div class="pending-page-metrics">
        <span><small>Invoices</small><b>${invoices.length}</b></span>
        <span><small>Phones</small><b>${totalUnits}</b></span>
        <span><small>Avg Cost</small><b>${money(totalUnits ? totalCost / totalUnits : 0)}</b></span>
        <span><small>Newest Add</small><b>${newestDate ? new Date(newestDate).toLocaleDateString() : "None"}</b></span>
      </div>
    </article>
  `;
}

function renderPastInvoices() {
  const list = phoneInvoices
    .filter((invoice) => invoice.status !== "Pending")
    .sort((a, b) => new Date(b.status_updated_at || b.closed_at || b.created_at) - new Date(a.status_updated_at || a.closed_at || a.created_at));
  $("pastInvoicesList").innerHTML = list.map(renderPastInvoiceCard).join("") || `<div class="empty">No past invoices yet.</div>`;
}

function renderKtReturns() {
  const list = phoneInvoices
    .filter((invoice) => (invoice.returns || []).length)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const normalReturns = list.map(renderKtReturnCard).join("");
  const manualReturns = renderManualKtReturns();
  $("ktReturnsList").innerHTML = [manualReturns, normalReturns].filter(Boolean).join("") || `<div class="empty">No returns yet.</div>`;
}

async function addManualKtReturn() {
  const result = await api("/api/phone-manual-returns", {
    method: "POST",
    body: {
      old_invoice_label: $("manualReturnInvoice").value.trim(),
      returned_at: $("manualReturnDate").value,
      model: $("manualReturnModel").value.trim(),
      carrier: $("manualReturnCarrier").value.trim(),
      condition: $("manualReturnCondition").value.trim(),
      quantity: Number($("manualReturnQuantity").value || 1),
      cost_each: Number($("manualReturnCost").value || 0),
      reason: $("manualReturnReason").value.trim(),
      notes: $("manualReturnNotes").value.trim(),
    },
  });
  if (!result?.ok) return status("manualReturnStatus", result?.error || "Could not add manual return.", "bad");
  ["manualReturnInvoice", "manualReturnModel", "manualReturnCarrier", "manualReturnCondition", "manualReturnCost", "manualReturnReason", "manualReturnNotes"].forEach((id) => {
    $(id).value = "";
  });
  $("manualReturnQuantity").value = "1";
  $("manualReturnDate").value = new Date().toISOString().slice(0, 10);
  status("manualReturnStatus", "Manual KT return added.");
  await loadManualPhoneReturns();
  openPhoneTab("ktReturns");
}

function renderManualKtReturns() {
  if (!manualPhoneReturns.length) return "";
  const totalCost = manualPhoneReturns.reduce((sum, row) => sum + Number(row.quantity || 0) * Number(row.cost_each || 0), 0);
  const totalSales = manualPhoneReturns.reduce((sum, row) => sum + Number(row.sale_price || 0), 0);
  const totalLoss = totalSales - totalCost;
  const soldCount = manualPhoneReturns.filter((row) => row.sale_price !== null && row.sale_price !== undefined && row.sale_price !== "").length;
  const openCount = manualPhoneReturns.length - soldCount;
  const rows = manualPhoneReturns.map((row) => {
    const cost = Number(row.quantity || 0) * Number(row.cost_each || 0);
    const sale = row.sale_price === null || row.sale_price === undefined || row.sale_price === "" ? null : Number(row.sale_price);
    const profit = sale === null ? null : sale - cost;
    const returnStatuses = ["KT", "Atlas", "Returned", "Sold"];
    const statusValue = returnStatuses.includes(String(row.status || "")) ? String(row.status) : "Returned";
    const statusClass = statusValue.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return `
      <tr>
        <td class="phone-device-cell return-phone-cell">
          <strong>${escapeHtml(row.model)}</strong>
          <span>${escapeHtml(row.condition || "Returned")}</span>
          ${row.carrier ? `<em>${escapeHtml(row.carrier)}</em>` : ""}
          ${row.reason ? `<em>Reason: ${escapeHtml(row.reason)}</em>` : ""}
          ${row.notes ? `<em>${escapeHtml(row.notes)}</em>` : ""}
        </td>
        <td class="return-source-cell">
          <strong>${escapeHtml(row.old_invoice_label || "Old KT invoice")}</strong>
          <em>Returned ${row.returned_at ? new Date(row.returned_at).toLocaleDateString() : "date not set"}</em>
        </td>
        <td class="return-cost-cell">
          <strong>${row.quantity || 1}x</strong>
          <em>${money(row.cost_each)} each</em>
          <em>Total ${money(cost)}</em>
        </td>
        <td class="return-status-cell">
          <span class="return-status-pill ${statusClass}">${escapeHtml(statusValue)}</span>
          <select id="manualReturnStatus${row.id}">
            ${returnStatuses.map((status) => `<option ${statusValue === status ? "selected" : ""}>${status}</option>`).join("")}
          </select>
        </td>
        <td class="return-sale-cell">
          <div class="return-inline-fields">
            <input id="manualReturnSale${row.id}" type="number" min="0" step="0.01" value="${sale === null ? "" : sale}" placeholder="Sold for">
            <input id="manualReturnSoldAt${row.id}" type="date" value="${row.sold_at ? String(row.sold_at).slice(0, 10) : ""}">
            <input id="manualReturnSaleNotes${row.id}" value="${escapeAttr(row.sale_notes || "")}" placeholder="Sale notes">
          </div>
          <button class="mini-btn" onclick="saveManualReturnSale(${row.id})">Save Sale</button>
        </td>
        <td class="${profit === null || profit >= 0 ? "profit-good" : "profit-bad"} return-profit">${profit === null ? "Not Sold" : money(profit)}</td>
      </tr>
    `;
  }).join("");
  return `
    <article class="invoice-card phone-invoice-card return-invoice-card manual-return-card">
      <div class="invoice-top">
        <div class="phone-invoice-title">
          <h3>Manual KT Returns</h3>
          <p>${manualPhoneReturns.length} old return${manualPhoneReturns.length === 1 ? "" : "s"} entered manually</p>
        </div>
        <span class="pill closed">Manual</span>
      </div>
      <div class="return-summary-grid">
        <div class="return-stat"><span>Total Returns</span><strong>${manualPhoneReturns.length}</strong></div>
        <div class="return-stat"><span>Still Open</span><strong>${openCount}</strong></div>
        <div class="return-stat"><span>Sold</span><strong>${soldCount}</strong></div>
        <div class="return-stat"><span>Total Cost</span><strong>${money(totalCost)}</strong></div>
        <div class="return-stat"><span>Sold Total</span><strong>${money(totalSales)}</strong></div>
        <div class="return-stat"><span>Profit / Loss</span><strong class="${totalLoss >= 0 ? "profit-good" : "profit-bad"}">${money(totalLoss)}</strong></div>
      </div>
      <div class="table-wrap">
        <table class="phone-profit-table manual-return-table">
          <thead><tr><th>Phone</th><th>Source</th><th>Cost</th><th>Status</th><th>Sale Details</th><th>Profit/Loss</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </article>
  `;
}

window.saveManualReturnSale = async (id) => {
  const result = await api(`/api/phone-manual-returns/${id}/sale`, {
    method: "PATCH",
    body: {
      status: $(`manualReturnStatus${id}`).value,
      sale_price: $(`manualReturnSale${id}`).value,
      sold_at: $(`manualReturnSoldAt${id}`).value,
      sale_notes: $(`manualReturnSaleNotes${id}`).value,
    },
  });
  if (!result?.ok) return alert(result?.error || "Could not save return sale.");
  await loadManualPhoneReturns();
  openPhoneTab("ktReturns");
  return true;
};

window.savePhoneReturnStatus = async (id) => {
  const result = await api(`/api/phone-purchases/${id}/return-status`, {
    method: "PATCH",
    body: {
      status: $(`phoneReturnStatus${id}`).value,
    },
  });
  if (!result?.ok) return alert(result?.error || "Could not save return status.");
  await loadPhoneInvoices();
  openPhoneTab("ktReturns");
  return true;
};

function renderLocallySold() {
  const list = phoneInvoices
    .filter((invoice) => (invoice.local_sold || []).length)
    .sort((a, b) => newestLocalSoldDate(b) - newestLocalSoldDate(a));
  $("locallySoldList").innerHTML = list.map(renderLocallySoldCard).join("") || `<div class="empty">No locally sold phones yet.</div>`;
}

function newestLocalSoldDate(invoice) {
  const dates = (invoice.local_sold || []).map((row) => new Date(row.local_sold_at || row.invoice_removed_at || row.created_at || 0).getTime());
  return Math.max(0, ...dates);
}

function renderLocallySoldCard(invoice) {
  const localSold = invoice.local_sold || [];
  const totalCost = localSold.reduce((sum, row) => sum + Number(row.quantity || 0) * Number(row.cost_each || 0), 0);
  const totalSale = localSold.reduce((sum, row) => sum + Number(row.local_sale_price || 0), 0);
  const totalProfit = totalSale ? totalSale - totalCost : null;
  const rows = localSold.map((row) => {
    const cost = Number(row.quantity || 0) * Number(row.cost_each || 0);
    const sale = row.local_sale_price === null || row.local_sale_price === undefined || row.local_sale_price === "" ? null : Number(row.local_sale_price);
    const profit = sale === null ? null : sale - cost;
    return `
      <tr>
        <td class="phone-device-cell">
          <strong>${escapeHtml(row.model)}</strong>
          <span>${escapeHtml(phoneInvoiceItemCondition(row))}</span>
          ${row.imei ? `<em>IMEI ${escapeHtml(row.imei)}</em>` : ""}
          ${row.notes ? `<em>${escapeHtml(row.notes)}</em>` : ""}
        </td>
        <td>${escapeHtml(row.carrier || "")}</td>
        <td>${row.quantity}</td>
        <td>${money(row.cost_each)}</td>
        <td>${sale === null ? "Not Set" : money(sale)}</td>
        <td class="${profit === null || profit >= 0 ? "profit-good" : "profit-bad"}">${profit === null ? "Not Set" : money(profit)}</td>
        <td>${row.local_sold_at || row.invoice_removed_at ? new Date(row.local_sold_at || row.invoice_removed_at).toLocaleDateString() : ""}</td>
      </tr>
    `;
  }).join("");
  return `
    <article class="invoice-card phone-invoice-card local-sold-card">
      <div class="invoice-top">
        <div class="phone-invoice-title">
          <h3>${escapeHtml(invoice.label || `${invoice.buyer} Invoice`)}</h3>
          <p>#${invoice.id} - ${escapeHtml(invoice.buyer)} - ${localSold.length} locally sold item${localSold.length === 1 ? "" : "s"}</p>
        </div>
        <span class="pill sold">Locally Sold</span>
      </div>
      <div class="table-wrap">
        <table class="phone-profit-table">
          <thead><tr><th>Phone</th><th>Carrier</th><th>Qty</th><th>Cost Each</th><th>Sold For</th><th>Profit</th><th>Sold</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="sale-summary">
        <span>Cost ${money(totalCost)}</span>
        <span>Local Sales ${totalSale ? money(totalSale) : "Not Set"}</span>
        ${totalProfit === null ? "" : `<strong class="${totalProfit >= 0 ? "profit-good" : "profit-bad"}">Profit ${money(totalProfit)}</strong>`}
      </div>
    </article>
  `;
}

function renderGiftCards() {
  const rows = phoneInvoices.flatMap((invoice) => (invoice.gift_cards || []).map((row) => ({ ...row, invoice })))
    .sort((a, b) => new Date(b.gift_card_at || b.invoice_removed_at || b.created_at || 0) - new Date(a.gift_card_at || a.invoice_removed_at || a.created_at || 0));
  if (!rows.length) {
    $("giftCardsList").innerHTML = `<div class="empty">No Apple gift card trade-ins yet.</div>`;
    return;
  }
  const cardNumbers = new Map([...rows].sort((a, b) => new Date(a.gift_card_at || a.invoice_removed_at || a.created_at || 0) - new Date(b.gift_card_at || b.invoice_removed_at || b.created_at || 0)).map((row, index) => [row.id, index + 1]));
  const totalCost = rows.reduce((sum, row) => sum + phoneLineCost(row), 0);
  const totalValue = rows.reduce((sum, row) => sum + Number(row.gift_card_value || 0), 0);
  const totalProfit = totalValue - totalCost;
  const newestDate = rows[0]?.gift_card_at ? new Date(rows[0].gift_card_at).toLocaleDateString() : "None";
  const body = rows.map((row) => {
    const cost = phoneLineCost(row);
    const value = Number(row.gift_card_value || 0);
    const profit = value - cost;
    const cardNumber = cardNumbers.get(row.id) || "";
    const cardPhotoId = `giftCardPhoto${row.id}`;
    const receiptPhotoId = `giftCardReceipt${row.id}`;
    const receiptIsPdf = isPdfDataUrl(row.gift_card_receipt_data_url) || /\.pdf$/i.test(row.gift_card_receipt_file_name || "");
    return `
      <tr>
        <td><strong class="gift-card-number">#${cardNumber}</strong></td>
        <td class="phone-device-cell">
          <strong>${escapeHtml(row.model)}</strong>
          <span>${escapeHtml(phoneInvoiceItemCondition(row))}</span>
          ${row.imei ? `<em>IMEI ${escapeHtml(row.imei)}</em>` : ""}
          ${row.notes ? `<em>${escapeHtml(row.notes)}</em>` : ""}
        </td>
        <td>${escapeHtml(row.invoice?.buyer || row.buyer || "")}</td>
        <td>${escapeHtml(row.invoice?.label || `Invoice #${row.invoice_id}`)}</td>
        <td>${row.quantity}</td>
        <td>${money(cost)}</td>
        <td>${money(value)}</td>
        <td class="${profit >= 0 ? "profit-good" : "profit-bad"}">${money(profit)}</td>
        <td>${row.gift_card_at ? new Date(row.gift_card_at).toLocaleDateString() : ""}</td>
        <td>
          <div class="phone-row-actions gift-card-actions">
            <div class="gift-card-media">
              ${row.gift_card_photo_data_url ? `<button class="gift-card-thumb" onclick="openGiftCardImage(${row.id}, 'card')" title="View gift card"><img src="${escapeAttr(row.gift_card_photo_data_url)}" alt="Gift card"></button>` : `<span class="gift-card-empty">No card photo</span>`}
              ${row.gift_card_receipt_data_url ? (receiptIsPdf ? `<button class="gift-card-thumb gift-card-pdf" onclick="openGiftCardImage(${row.id}, 'receipt')" title="View receipt PDF">PDF<br>Receipt</button>` : `<button class="gift-card-thumb" onclick="openGiftCardImage(${row.id}, 'receipt')" title="View receipt"><img src="${escapeAttr(row.gift_card_receipt_data_url)}" alt="Receipt"></button>`) : `<span class="gift-card-empty">No receipt</span>`}
            </div>
            <label class="mini-file">Card<input id="${cardPhotoId}" type="file" accept="image/*"></label>
            <label class="mini-file">Receipt<input id="${receiptPhotoId}" type="file" accept="image/*,.pdf,application/pdf"></label>
            <button class="mini-btn" onclick="saveGiftCardDetails(${row.id})">Save</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
  $("giftCardsList").innerHTML = `
    <article class="invoice-card phone-invoice-card gift-card-card">
      <div class="invoice-top">
        <div class="phone-invoice-title">
          <h3>Apple Gift Cards</h3>
          <p>${rows.length} trade-in${rows.length === 1 ? "" : "s"} tracked for iPhone 18 season</p>
        </div>
        <span class="pill sold">Gift Cards</span>
      </div>
      <div class="gift-card-summary">
        <span><small>Total Cards</small><b>${rows.length}</b></span>
        <span><small>Total Phones Cost</small><b>${money(totalCost)}</b></span>
        <span><small>Gift Card Value</small><b>${money(totalValue)}</b></span>
        <span><small>Profit</small><b class="${totalProfit >= 0 ? "profit-good" : "profit-bad"}">${money(totalProfit)}</b></span>
        <span><small>Latest Card</small><b>${newestDate}</b></span>
      </div>
      <div class="table-wrap">
        <table class="phone-profit-table gift-card-table">
          <thead><tr><th>GC #</th><th>Phone Traded In</th><th>Source</th><th>From Invoice</th><th>Qty</th><th>Cost</th><th>Gift Card Value</th><th>Profit</th><th>Date</th><th>Card Info</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </article>
  `;
}

async function addManualGiftCard() {
  const result = await api("/api/phone-gift-cards", {
    method: "POST",
    body: {
      model: $("manualGiftCardModel").value.trim(),
      quantity: Number($("manualGiftCardQuantity").value || 1),
      cost_each: Number($("manualGiftCardCost").value || 0),
      gift_card_value: Number($("manualGiftCardValue").value || 0),
      gift_card_at: $("manualGiftCardDate").value,
    },
  });
  if (!result?.ok) return status("manualGiftCardStatus", result?.error || "Could not add gift card.", "bad");
  $("manualGiftCardModel").value = "";
  $("manualGiftCardQuantity").value = "1";
  $("manualGiftCardCost").value = "";
  $("manualGiftCardValue").value = "";
  $("manualGiftCardDate").value = new Date().toISOString().slice(0, 10);
  status("manualGiftCardStatus", `${result.count || 1} gift card${Number(result.count || 1) === 1 ? "" : "s"} added.`);
  await loadPhoneInvoices();
  openPhoneTab("giftCards");
}

function phoneLineCost(row) {
  return Number(row.quantity || 0) * Number(row.cost_each || 0);
}

function renderKtReturnCard(invoice) {
  const returns = invoice.returns || [];
  const totalCost = returns.reduce((sum, row) => sum + Number(row.quantity || 0) * Number(row.cost_each || 0), 0);
  const totalUnits = returns.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  const rows = returns.map((row) => {
    const cost = Number(row.quantity || 0) * Number(row.cost_each || 0);
    const returnStatuses = ["KT", "Atlas", "Returned", "Sold"];
    const statusValue = returnStatuses.includes(String(row.return_status || "")) ? String(row.return_status) : "Returned";
    const statusClass = statusValue.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return `
      <tr>
        <td class="phone-device-cell return-phone-cell">
          <strong>${escapeHtml(row.model)}</strong>
          <span>${escapeHtml(phoneInvoiceItemCondition(row))}</span>
          ${row.carrier ? `<em>${escapeHtml(row.carrier)}</em>` : ""}
          ${row.imei ? `<em>IMEI ${escapeHtml(row.imei)}</em>` : ""}
          ${row.notes ? `<em>${escapeHtml(row.notes)}</em>` : ""}
        </td>
        <td class="return-source-cell">
          <strong>${escapeHtml(invoice.label || `${invoice.buyer} Invoice`)}</strong>
          <em>${escapeHtml(invoice.buyer)} #${invoice.id}</em>
          <em>Returned ${row.returned_at ? new Date(row.returned_at).toLocaleDateString() : "date not set"}</em>
        </td>
        <td class="return-cost-cell">
          <strong>${row.quantity || 1}x</strong>
          <em>${money(row.cost_each)} each</em>
          <em>Total ${money(cost)}</em>
        </td>
        <td class="return-status-cell">
          <span class="return-status-pill ${statusClass}">${escapeHtml(statusValue)}</span>
          <select id="phoneReturnStatus${row.id}">
            ${returnStatuses.map((status) => `<option ${statusValue === status ? "selected" : ""}>${status}</option>`).join("")}
          </select>
          <button class="mini-btn return-status-save" onclick="savePhoneReturnStatus(${row.id})">Save</button>
        </td>
        <td class="return-reason-cell">${escapeHtml(row.return_reason || row.invoice_removed_reason || "Returned")}</td>
      </tr>
    `;
  }).join("");
  return `
    <article class="invoice-card phone-invoice-card return-invoice-card regular-return-card">
      <div class="invoice-top">
        <div class="phone-invoice-title">
          <h3>${escapeHtml(invoice.label || `${invoice.buyer} Invoice`)}</h3>
          <p>#${invoice.id} - ${escapeHtml(invoice.buyer)} - ${new Date(invoice.created_at).toLocaleDateString()} - ${returns.length} returned item${returns.length === 1 ? "" : "s"}</p>
        </div>
        <span class="pill closed">Returns</span>
      </div>
      <div class="return-summary-grid invoice-return-summary">
        <div class="return-stat"><span>Buyer</span><strong>${escapeHtml(invoice.buyer)}</strong></div>
        <div class="return-stat"><span>Returned Items</span><strong>${returns.length}</strong></div>
        <div class="return-stat"><span>Total Phones</span><strong>${totalUnits}</strong></div>
        <div class="return-stat"><span>Returned Cost</span><strong>${money(totalCost)}</strong></div>
      </div>
      <div class="table-wrap">
        <table class="phone-profit-table manual-return-table invoice-return-table">
          <thead><tr><th>Phone</th><th>Source</th><th>Cost</th><th>Status</th><th>Reason</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </article>
  `;
}

function invoiceTotals(invoice) {
  const purchases = invoice.purchases || [];
  const totalCost = purchases.reduce((sum, row) => sum + Number(row.quantity || 0) * Number(row.cost_each || 0), 0);
  const units = purchases.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  const salePrice = invoice.sale_price === null || invoice.sale_price === undefined || invoice.sale_price === "" ? null : Number(invoice.sale_price);
  const profit = salePrice === null ? null : salePrice - totalCost;
  return { totalCost, units, salePrice, profit };
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
        <span><small>Sold For</small>${totals.salePrice === null ? "Not Set" : money(totals.salePrice)}</span>
        <span class="${totals.profit === null || totals.profit >= 0 ? "profit-good" : "profit-bad"}"><small>Profit</small>${totals.profit === null ? "Not Set" : money(totals.profit)}</span>
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
  const { totalCost, units, salePrice } = invoiceTotals(invoice);
  const actualProfit = salePrice === null ? null : salePrice - totalCost;
  const canRemove = invoice.status === "Pending";
  const canReturn = salePrice === null;
  const isPending = invoice.status === "Pending";
  let itemNumber = 1;
  const rows = purchases.map((row) => {
    const itemLabel = phoneInvoiceItemNumber(row, itemNumber);
    itemNumber += phoneInvoiceQuantity(row);
    return `
    <tr class="phone-purchase-row">
      <td>${escapeHtml(itemLabel)}</td>
      <td class="phone-device-cell">
        <strong>${escapeHtml(row.model)}</strong>
        <span>${escapeHtml(phoneInvoiceItemCondition(row))}</span>
        ${row.imei ? `<em>IMEI ${escapeHtml(row.imei)}</em>` : ""}
        ${row.photo_data_url ? `<button class="phone-photo-link" onclick="openPhonePhoto(${row.id})">View photo</button>` : ""}
      </td>
      <td>${escapeHtml(row.carrier || "")}</td>
      <td>${row.quantity}</td>
      <td>${money(row.cost_each)}</td>
      <td><div class="phone-row-actions"><button class="mini-btn" onclick="startPhonePurchaseEdit(${row.id})">Edit</button>${canRemove ? `<button class="mini-btn" onclick="movePhonePurchaseToInvoice(${row.id})">Move</button>` : ""}${canRemove ? `<button class="mini-btn" onclick="movePhonePurchaseToGiftCard(${row.id})">Move to GC</button>` : ""}${canReturn ? `<button class="mini-btn warning" onclick="returnPhonePurchaseToKt(${row.id})">Return</button>` : ""}${canRemove ? `<button class="mini-btn danger" onclick="removePhonePurchaseFromInvoice(${row.id})">Locally Sold</button>` : ""}</div></td>
    </tr>
  `;
  }).join("");
  itemNumber = 1;
  const pendingRows = purchases.map((row) => {
    const itemLabel = phoneInvoiceItemNumber(row, itemNumber);
    const lineCost = phoneLineCost(row);
    itemNumber += phoneInvoiceQuantity(row);
    return `
    <tr class="pending-phone-row">
      <td><strong>${escapeHtml(itemLabel)}</strong></td>
      <td class="phone-device-cell">
        <strong>${escapeHtml(row.model)}</strong>
        <span>${escapeHtml(phoneInvoiceItemCondition(row))}</span>
        <em>${escapeHtml(row.device_type || "Phone")} purchase${row.purchase_date ? ` - Bought ${new Date(row.purchase_date).toLocaleDateString()}` : ""}</em>
        ${row.imei ? `<em>IMEI ${escapeHtml(row.imei)}</em>` : ""}
        ${row.notes ? `<em>${escapeHtml(row.notes)}</em>` : ""}
        ${row.photo_data_url ? `<button class="phone-photo-link" onclick="openPhonePhoto(${row.id})">View photo</button>` : ""}
      </td>
      <td>${escapeHtml(row.carrier || "")}</td>
      <td>${row.quantity}</td>
      <td>${money(row.cost_each)}</td>
      <td>${money(lineCost)}</td>
      <td>${phoneAddedDate(row)}</td>
      <td><div class="phone-row-actions"><button class="mini-btn" onclick="startPhonePurchaseEdit(${row.id})">Edit</button>${canRemove ? `<button class="mini-btn" onclick="movePhonePurchaseToInvoice(${row.id})">Move</button>` : ""}${canRemove ? `<button class="mini-btn" onclick="movePhonePurchaseToGiftCard(${row.id})">Move to GC</button>` : ""}${canReturn ? `<button class="mini-btn warning" onclick="returnPhonePurchaseToKt(${row.id})">Return</button>` : ""}${canRemove ? `<button class="mini-btn danger" onclick="removePhonePurchaseFromInvoice(${row.id})">Locally Sold</button>` : ""}</div></td>
    </tr>
  `;
  }).join("");
  const saleControls = `
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
  `;
  const averageCost = units ? totalCost / units : 0;
  const invoiceCreated = new Date(invoice.created_at).toLocaleDateString();
  const newestAdded = purchases.reduce((latest, row) => {
    const time = new Date(row.invoice_added_at || row.purchase_date || row.created_at || 0).getTime();
    return Math.max(latest, Number.isNaN(time) ? 0 : time);
  }, 0);
  return `
    <article class="invoice-card phone-invoice-card ${isPending ? "phone-invoice-compact" : ""}">
      <div class="invoice-top">
        <div class="phone-invoice-title">
          <h3>${escapeHtml(invoice.label || `${invoice.buyer} Invoice`)}</h3>
          <p>#${invoice.id} - ${escapeHtml(invoice.buyer)} - Created ${invoiceCreated} - ${units} phone${units === 1 ? "" : "s"} total</p>
        </div>
        ${isPending ? `
          <div class="pending-invoice-metrics">
            <span><small>Total Cost</small><b>${money(totalCost)}</b></span>
            <span><small>Phones</small><b>${units}</b></span>
            <span><small>Avg Cost</small><b>${money(averageCost)}</b></span>
            <span><small>Newest Add</small><b>${newestAdded ? new Date(newestAdded).toLocaleDateString() : "None"}</b></span>
          </div>
        ` : ""}
        <span class="pill ${invoice.status?.toLowerCase()}">${escapeHtml(invoice.status)}</span>
      </div>
      ${isPending ? `
        <div class="table-wrap pending-table-wrap">
          <table class="phone-profit-table pending-phone-table">
            <thead><tr><th>Item #</th><th>Phone Details</th><th>Carrier</th><th>Qty</th><th>Unit Cost</th><th>Line Cost</th><th>Added</th><th>Actions</th></tr></thead>
            <tbody>${pendingRows || `<tr><td colspan="8">No purchases added.</td></tr>`}</tbody>
          </table>
        </div>
      ` : `
        <div class="table-wrap">
          <table class="phone-profit-table">
            <thead><tr><th>Item #</th><th>Device</th><th>Carrier</th><th>Qty</th><th>Cost Each</th><th></th></tr></thead>
            <tbody>${rows || `<tr><td colspan="6">No purchases added.</td></tr>`}</tbody>
          </table>
        </div>
      `}
      <div class="sale-summary ${isPending ? "pending-sale-summary" : ""}">
        <span>Cost ${money(totalCost)}</span>
        ${salePrice === null ? `<span>Actual Sale Not Set</span>` : `<span>Actual Sale ${money(salePrice)}</span>`}
        ${actualProfit === null ? "" : `<strong class="${actualProfit >= 0 ? "profit-good" : "profit-bad"}">Actual Profit ${money(actualProfit)}</strong>`}
      </div>
      ${isPending ? `<details class="phone-controls"><summary>Sale / Status Controls</summary>${saleControls}</details>` : saleControls}
      <div class="invoice-actions">
        <strong>${salePrice === null ? money(totalCost) : money(salePrice)}</strong>
        <div>
          <button class="mini-btn" onclick="openPhoneBuyerPdf(${invoice.id})">Buyer Invoice PDF</button>
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

window.startPhonePurchaseEdit = (id) => {
  const invoice = phoneInvoices.find((entry) => (entry.purchases || []).some((row) => Number(row.id) === Number(id)));
  const purchase = invoice?.purchases?.find((row) => Number(row.id) === Number(id));
  if (!invoice || !purchase) return alert("Could not find that phone purchase.");
  editingPhonePurchaseId = Number(id);
  $("phoneBuyer").value = purchase.buyer || invoice.buyer || "Atlas";
  renderInvoiceSelect();
  ensureSelectOption("phoneInvoiceSelect", String(invoice.id), `#${invoice.id} - ${invoice.label || invoice.buyer} (${invoice.status})`);
  $("phoneInvoiceSelect").value = String(invoice.id);
  $("deviceType").value = purchase.device_type || "Phone";
  $("conditionType").value = purchase.condition_type || "Used";
  $("packaging").value = purchase.packaging || "Sealed";
  $("grade").value = purchase.grade || "Grade A";
  $("phoneBrand").value = brandForPurchase(purchase);
  toggleConditionFields();
  renderModelOptions();
  const parsed = splitPhoneModel(purchase.model);
  ensureSelectOption("phoneModel", parsed.model, parsed.model);
  $("phoneModel").value = parsed.model;
  renderPhoneStorageOptions();
  ensureSelectOption("phoneStorage", parsed.storage, parsed.storage);
  $("phoneStorage").value = parsed.storage;
  renderCarrierOptions();
  ensureSelectOption("phoneCarrier", purchase.carrier || "Unlocked", purchase.carrier || "Unlocked");
  $("phoneCarrier").value = purchase.carrier || "Unlocked";
  $("phoneQuantity").value = purchase.quantity || 1;
  $("phoneCost").value = purchase.cost_each || "";
  $("phoneProjected").value = purchase.projected_sell_each || "";
  $("phonePurchaseDate").value = String(purchase.purchase_date || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
  $("phoneImei").value = purchase.imei || "";
  $("phonePhoto").value = "";
  $("phoneNotes").value = purchase.notes || "";
  $("ktDeductCrackedBack").checked = /cracked back/i.test(purchase.notes || "");
  $("atlasDeductCrackedBack").checked = /atlas cracked back|cracked?\s+back|back\s+crack|back\s+glass/i.test(purchase.notes || "");
  $("atlasDeductCrackedLens").checked = /atlas cracked lens/i.test(purchase.notes || "");
  $("atlasDeductBattery").checked = /atlas battery|degraded battery/i.test(purchase.notes || "");
  $("atlasDeductRepair").checked = /atlas repair message/i.test(purchase.notes || "");
  $("atlasDeductFaceId").checked = /atlas bad face id/i.test(purchase.notes || "");
  $("savePhonePurchaseBtn").textContent = "Save Changes";
  $("phoneEditNotice").classList.remove("hidden");
  $("phoneEditNotice").textContent = `Editing ${purchase.model} from invoice #${invoice.id}. Choose a new photo only if you want to replace the old one.`;
  updateProjectedPrice();
  updatePurchaseFlowVisibility();
  openPhoneTab("purchase");
  status("phonePurchaseStatus", "");
  window.scrollTo({ top: 0, behavior: "smooth" });
};

function splitPhoneModel(model) {
  const text = String(model || "").replace(/\s+/g, " ").trim();
  const storageMatch = text.match(/\b\d+\s*(?:GB|TB)\b/i);
  const storage = storageMatch ? storageMatch[0].replace(/\s+/g, "") : "N/A";
  const cleanModel = text
    .replace(/\b\d+\s*(?:GB|TB)\b/i, "")
    .replace(/AT&T\s*\(Clean\)|Carrier Locked|Unlocked|T-Mobile|Verizon|Cricket|Metro|Spectrum|Xfinity|US Cellular|Boost/ig, "")
    .replace(/\s+/g, " ")
    .trim();
  return { model: cleanModel || text, storage };
}

function brandForPurchase(purchase) {
  const text = `${purchase.model || ""}`.toLowerCase();
  if (/pixel|google/.test(text)) return "Google";
  if (/samsung|galaxy|\bs\d{2}|note\s+\d|z\s+(fold|flip)/.test(text)) return "Samsung";
  return "Apple";
}

function ensureSelectOption(id, value, label) {
  if (!value) return;
  const select = $(id);
  if ([...select.options].some((option) => option.value === value)) return;
  select.insertAdjacentHTML("beforeend", `<option value="${escapeAttr(value)}">${escapeHtml(label || value)}</option>`);
}

function phoneInvoiceItemCondition(row) {
  if (row.condition_type === "New") return row.packaging ? `NEW - ${row.packaging}` : "NEW";
  return row.grade || "USED";
}

function phoneInvoiceQuantity(row) {
  return Math.max(1, Number(row.quantity || 1));
}

function phoneInvoiceItemNumber(row, start) {
  const quantity = phoneInvoiceQuantity(row);
  return quantity > 1 ? `${start}-${start + quantity - 1}` : String(start);
}

function phoneAddedDate(row) {
  const addedAt = row.invoice_added_at || row.created_at;
  if (!addedAt) return "";
  return new Date(addedAt).toLocaleDateString();
}

window.movePhonePurchaseToInvoice = async (id) => {
  const currentInvoice = phoneInvoices.find((invoice) => (invoice.purchases || []).some((row) => Number(row.id) === Number(id)));
  const purchase = currentInvoice?.purchases?.find((row) => Number(row.id) === Number(id));
  if (!currentInvoice || !purchase) return alert("Could not find that phone purchase.");
  const pendingInvoices = phoneInvoices
    .filter((invoice) => invoice.status === "Pending" && Number(invoice.id) !== Number(currentInvoice.id))
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  if (!pendingInvoices.length) return alert("There are no other pending invoices to move this phone into.");
  const choices = pendingInvoices.map((invoice) => `#${invoice.id} - ${invoice.buyer} - ${invoice.label || "Pending Invoice"}`).join("\n");
  const invoiceId = prompt(`Move ${purchase.model} to which invoice?\n\n${choices}\n\nEnter invoice number:`);
  if (invoiceId === null) return false;
  const targetId = Number(String(invoiceId).replace(/[^0-9]/g, ""));
  if (!targetId || !pendingInvoices.some((invoice) => Number(invoice.id) === targetId)) {
    alert("Enter one of the pending invoice numbers shown.");
    return false;
  }
  const result = await api(`/api/phone-purchases/${id}/move-invoice`, {
    method: "PATCH",
    body: { invoice_id: targetId },
  });
  if (!result?.ok) return alert(result?.error || "Could not move this phone.");
  await loadPhoneInvoices();
  openPhoneTab(`${String(result.invoice.buyer || "").toLowerCase()}Pending`);
  return true;
};

window.openPhoneBuyerPdf = (id) => {
  const invoice = phoneInvoices.find((entry) => Number(entry.id) === Number(id));
  if (!invoice) return alert("Could not find that invoice.");
  window.open(`/api/phone-invoices/${id}/html`, "_blank");
  return true;
};

function renderPhoneDashboard() {
  if (!$("phoneDashboardStats") || !$("phoneBuyerBreakdown")) return;
  const totals = buildCombinedPhoneStats();
  const buyerStats = ["Atlas", "KT"].map((buyer) => buildCombinedPhoneStats(buyer));
  $("phoneDashboardStats").innerHTML = `
    <div class="stat"><span>Total Cost</span><strong>${money(totals.cost)}</strong></div>
    <div class="stat"><span>Actual Sales</span><strong>${money(totals.actualSale)}</strong></div>
    <div class="stat"><span>Actual Profit</span><strong class="${totals.actualProfit >= 0 ? "profit-good" : "profit-bad"}">${money(totals.actualProfit)}</strong></div>
    <div class="stat"><span>Units</span><strong>${totals.units}</strong></div>
    <div class="stat"><span>Pending Cost</span><strong>${money(totals.pendingCost)}</strong></div>
    <div class="stat"><span>Shipped Cost</span><strong>${money(totals.shippedCost)}</strong></div>
    <div class="stat"><span>Needs Sale Amount</span><strong>${totals.needsSaleAmount}</strong></div>
    <div class="stat"><span>Sold / Traded Units</span><strong>${totals.completedUnits}</strong></div>
  `;
  $("phoneBuyerBreakdown").innerHTML = `
    <table class="phone-breakdown-table">
      <thead><tr><th>Buyer</th><th>Invoices</th><th>Total Units</th><th>Sold / Traded</th><th>Cost</th><th>Actual Sales</th><th>Actual Profit</th><th>Needs Sale Amount</th></tr></thead>
      <tbody>${buyerStats.map((row) => `
        <tr>
          <td><strong>${row.buyer}</strong></td>
          <td>${row.invoices}</td>
          <td>${row.units}</td>
          <td>${row.completedUnits}</td>
          <td>${money(row.cost)}</td>
          <td>${money(row.actualSale)}</td>
          <td class="${row.actualProfit >= 0 ? "profit-good" : "profit-bad"}">${money(row.actualProfit)}</td>
          <td>${row.needsSaleAmount}</td>
        </tr>
      `).join("")}</tbody>
    </table>
  `;
  renderPhoneMoneyDashboard();
}

function emptyPhoneStats(buyer = "All") {
  return { buyer, invoices: 0, units: 0, completedUnits: 0, cost: 0, actualSale: 0, actualProfit: 0, pendingCost: 0, shippedCost: 0, needsSaleAmount: 0 };
}

function buildCombinedPhoneStats(buyer = "All") {
  const stats = emptyPhoneStats(buyer);
  phoneInvoices
    .filter((invoice) => buyer === "All" || invoice.buyer === buyer)
    .forEach((invoice) => addInvoiceStats(stats, invoice));
  phoneInvoices
    .filter((invoice) => buyer === "All" || invoice.buyer === buyer)
    .forEach((invoice) => addRemovedPhoneStats(stats, invoice));
  manualPhoneReturns
    .filter((row) => buyer === "All" || (row.buyer || "KT") === buyer)
    .forEach((row) => addManualReturnStats(stats, row));
  return stats;
}

function addInvoiceStats(acc, invoice) {
  if (isManualGiftCardInvoice(invoice)) return acc;
  const purchases = invoice.purchases || [];
  const cost = purchases.reduce((sum, row) => sum + Number(row.quantity || 0) * Number(row.cost_each || 0), 0);
  const units = purchases.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  const salePrice = invoice.sale_price === null || invoice.sale_price === undefined || invoice.sale_price === "" ? null : Number(invoice.sale_price);
  acc.invoices += 1;
  acc.units += units;
  acc.cost += cost;
  if (invoice.status === "Pending") acc.pendingCost += cost;
  if (invoice.status === "Shipped") acc.shippedCost += cost;
  if (invoice.status !== "Pending" && salePrice === null) acc.needsSaleAmount += 1;
  if (salePrice !== null) {
    acc.actualSale += salePrice;
    acc.actualProfit += salePrice - cost;
    acc.completedUnits += units;
  }
  return acc;
}

function isManualGiftCardInvoice(invoice) {
  return invoice?.buyer === "Apple GC" && invoice?.label === "Manual Gift Cards";
}

function addRemovedPhoneStats(acc, invoice) {
  (invoice.local_sold || []).forEach((row) => addCompletedPhoneLineStats(acc, row, row.local_sale_price));
  (invoice.gift_cards || []).forEach((row) => addCompletedPhoneLineStats(acc, row, row.gift_card_value));
  (invoice.returns || []).forEach((row) => {
    acc.units += phoneLineQuantity(row);
    acc.cost += phoneLineCost(row);
  });
  return acc;
}

function addManualReturnStats(acc, row) {
  const cost = phoneLineCost(row);
  const sale = row.sale_price === null || row.sale_price === undefined || row.sale_price === "" ? null : Number(row.sale_price);
  acc.units += phoneLineQuantity(row);
  acc.cost += cost;
  if (sale !== null) {
    acc.actualSale += sale;
    acc.actualProfit += sale - cost;
    acc.completedUnits += phoneLineQuantity(row);
  }
  return acc;
}

function addCompletedPhoneLineStats(acc, row, saleValue) {
  const cost = phoneLineCost(row);
  const sale = saleValue === null || saleValue === undefined || saleValue === "" ? null : Number(saleValue);
  acc.units += phoneLineQuantity(row);
  acc.cost += cost;
  if (sale !== null) {
    acc.actualSale += sale;
    acc.actualProfit += sale - cost;
    acc.completedUnits += phoneLineQuantity(row);
  }
  return acc;
}

function phoneLineQuantity(row) {
  return Number(row.quantity || 0);
}

function renderPhoneMoneyDashboard() {
  if (!$("phoneMoneyStats") || !$("phoneProfitGraph")) return;
  const events = getPhoneMoneyEvents();
  const totalSales = events.reduce((sum, event) => sum + event.sale, 0);
  const totalCost = events.reduce((sum, event) => sum + event.cost, 0);
  const totalProfit = events.reduce((sum, event) => sum + event.profit, 0);
  const totalUnits = events.reduce((sum, event) => sum + event.units, 0);
  const grossMargin = totalSales ? totalProfit / totalSales * 100 : 0;
  const sourceRows = buildMoneySourceBreakdown(events);
  $("phoneMoneyStats").innerHTML = `
    <div class="stat"><span>Gross Receipts</span><strong>${money(totalSales)}</strong></div>
    <div class="stat"><span>Cost of Goods Sold</span><strong>${money(totalCost)}</strong></div>
    <div class="stat"><span>Gross Profit</span><strong class="${totalProfit >= 0 ? "profit-good" : "profit-bad"}">${money(totalProfit)}</strong></div>
    <div class="stat"><span>Gross Margin</span><strong>${grossMargin.toFixed(1)}%</strong></div>
    <div class="stat"><span>Transactions</span><strong>${events.length}</strong></div>
    <div class="stat"><span>Units Closed</span><strong>${totalUnits}</strong></div>
  `;
  $("phoneProfitGraph").innerHTML = `
    ${renderPhoneProfitGraph(events)}
    ${renderMoneySourceBreakdown(sourceRows)}
  `;
}

function getPhoneMoneyEvents() {
  const events = [];
  phoneInvoices.forEach((invoice) => {
    const invoiceSale = invoice.sale_price === null || invoice.sale_price === undefined || invoice.sale_price === "" ? null : Number(invoice.sale_price);
    if (invoiceSale !== null && !isManualGiftCardInvoice(invoice)) {
      const cost = (invoice.purchases || []).reduce((sum, row) => sum + phoneLineCost(row), 0);
      events.push({
        date: eventDate(invoice.sold_at || invoice.closed_at || invoice.status_updated_at || invoice.created_at),
        label: invoice.label || `${invoice.buyer} Invoice`,
        type: "Buyer Invoice",
        buyer: invoice.buyer || "",
        reference: `Invoice #${invoice.id}`,
        units: (invoice.purchases || []).reduce((sum, row) => sum + phoneLineQuantity(row), 0),
        sale: invoiceSale,
        cost,
        profit: invoiceSale - cost,
      });
    }
    (invoice.local_sold || []).forEach((row) => {
      const sale = row.local_sale_price === null || row.local_sale_price === undefined || row.local_sale_price === "" ? null : Number(row.local_sale_price);
      if (sale === null) return;
      const cost = phoneLineCost(row);
      events.push({
        date: eventDate(row.local_sold_at || row.invoice_removed_at || row.created_at),
        label: row.model || "Local sale",
        type: "Local sale",
        buyer: invoice.buyer || row.buyer || "",
        reference: `Phone #${row.id}`,
        units: phoneLineQuantity(row),
        sale,
        cost,
        profit: sale - cost,
      });
    });
    (invoice.gift_cards || []).forEach((row) => {
      const sale = row.gift_card_value === null || row.gift_card_value === undefined || row.gift_card_value === "" ? null : Number(row.gift_card_value);
      if (sale === null) return;
      const cost = phoneLineCost(row);
      events.push({
        date: eventDate(row.gift_card_at || row.invoice_removed_at || row.created_at),
        label: row.model || "Apple gift card",
        type: "Apple Gift Card",
        buyer: invoice.buyer || row.buyer || "",
        reference: `Gift Card Trade #${row.id}`,
        units: phoneLineQuantity(row),
        sale,
        cost,
        profit: sale - cost,
      });
    });
  });
  manualPhoneReturns.forEach((row) => {
    const sale = row.sale_price === null || row.sale_price === undefined || row.sale_price === "" ? null : Number(row.sale_price);
    if (sale === null) return;
    const cost = phoneLineCost(row);
    events.push({
      date: eventDate(row.sold_at || row.returned_at || row.created_at),
      label: row.model || "Manual return",
      type: "Return sale",
      buyer: row.buyer || "KT",
      reference: `Manual Return #${row.id}`,
      units: phoneLineQuantity(row),
      sale,
      cost,
      profit: sale - cost,
    });
  });
  return events.filter((event) => event.date instanceof Date && !Number.isNaN(event.date.getTime()))
    .sort((a, b) => a.date - b.date);
}

function eventDate(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function renderPhoneProfitGraph(events) {
  if (!events.length) return `<div class="empty">No completed phone sales yet.</div>`;
  let runningProfit = 0;
  const graphPoints = events.map((event, index) => ({ ...event, transactionNumber: index + 1, runningProfit: runningProfit += event.profit }));
  const values = graphPoints.flatMap((point) => [point.runningProfit, point.profit, 0]);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = Math.max(1, maxValue - minValue);
  const width = 920;
  const height = 280;
  const pad = 34;
  const innerWidth = width - pad * 2;
  const innerHeight = height - pad * 2;
  const xFor = (index) => pad + (graphPoints.length === 1 ? innerWidth / 2 : (index / (graphPoints.length - 1)) * innerWidth);
  const yFor = (value) => pad + (1 - ((value - minValue) / range)) * innerHeight;
  const barWidth = Math.max(6, Math.min(24, innerWidth / Math.max(1, graphPoints.length) * 0.55));
  const zeroY = yFor(0);
  const linePoints = graphPoints.map((point, index) => `${xFor(index)},${yFor(point.runningProfit)}`).join(" ");
  const bars = graphPoints.map((point, index) => {
    const x = xFor(index);
    const y = yFor(Math.max(point.profit, 0));
    const barHeight = Math.max(2, Math.abs(yFor(point.profit) - zeroY));
    const top = point.profit >= 0 ? y : zeroY;
    return `<rect x="${x - barWidth / 2}" y="${top}" width="${barWidth}" height="${barHeight}" rx="4" class="${point.profit >= 0 ? "profit-bar-good" : "profit-bar-bad"}"><title>#${point.transactionNumber} ${point.reference || point.type} - ${point.date.toLocaleDateString()} profit ${money(point.profit)}</title></rect>`;
  }).join("");
  const dots = graphPoints.map((point, index) => `<circle cx="${xFor(index)}" cy="${yFor(point.runningProfit)}" r="5"><title>#${point.transactionNumber} running profit ${money(point.runningProfit)}</title></circle>`).join("");
  const ledgerRows = [...graphPoints].reverse().map((event) => `
    <tr>
      <td>${event.transactionNumber}</td>
      <td>${event.date.toLocaleDateString()}</td>
      <td><strong>${escapeHtml(event.reference || event.type)}</strong><em>${escapeHtml(event.type)}${event.buyer ? ` - ${escapeHtml(event.buyer)}` : ""}</em></td>
      <td>${escapeHtml(event.label)}</td>
      <td>${event.units}</td>
      <td>${money(event.sale)}</td>
      <td>${money(event.cost)}</td>
      <td class="${event.profit >= 0 ? "profit-good" : "profit-bad"}">${money(event.profit)}</td>
      <td class="${event.runningProfit >= 0 ? "profit-good" : "profit-bad"}">${money(event.runningProfit)}</td>
    </tr>
  `).join("");
  const finalPoint = graphPoints[graphPoints.length - 1];
  return `
    <div class="profit-chart-card">
      <div class="profit-chart-head">
        <div><strong>Transaction Profit Trend</strong><span>Each bar is one closed transaction. Gift cards are not combined by date.</span></div>
        <b class="${finalPoint.runningProfit >= 0 ? "profit-good" : "profit-bad"}">${money(finalPoint.runningProfit)}</b>
      </div>
      <svg class="profit-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Phone profit graph">
        <line x1="${pad}" y1="${zeroY}" x2="${width - pad}" y2="${zeroY}" class="profit-zero-line"></line>
        ${bars}
        <polyline points="${linePoints}" class="profit-running-line"></polyline>
        ${dots}
      </svg>
    </div>
    <div class="table-wrap money-event-wrap">
      <table class="phone-breakdown-table money-event-table">
        <thead><tr><th>#</th><th>Date</th><th>Reference</th><th>Item</th><th>Units</th><th>Receipts</th><th>COGS</th><th>Gross Profit</th><th>Running Profit</th></tr></thead>
        <tbody>${ledgerRows}</tbody>
      </table>
    </div>
  `;
}

function buildMoneySourceBreakdown(events) {
  const rows = new Map();
  events.forEach((event) => {
    const key = event.type || "Other";
    const row = rows.get(key) || { type: key, transactions: 0, units: 0, sale: 0, cost: 0, profit: 0 };
    row.transactions += 1;
    row.units += event.units;
    row.sale += event.sale;
    row.cost += event.cost;
    row.profit += event.profit;
    rows.set(key, row);
  });
  return [...rows.values()].sort((a, b) => b.profit - a.profit);
}

function renderMoneySourceBreakdown(rows) {
  if (!rows.length) return "";
  return `
    <div class="table-wrap money-source-wrap">
      <table class="phone-breakdown-table money-source-table">
        <thead><tr><th>Source</th><th>Transactions</th><th>Units</th><th>Receipts</th><th>COGS</th><th>Gross Profit</th><th>Margin</th></tr></thead>
        <tbody>${rows.map((row) => {
          const margin = row.sale ? row.profit / row.sale * 100 : 0;
          return `
            <tr>
              <td><strong>${escapeHtml(row.type)}</strong></td>
              <td>${row.transactions}</td>
              <td>${row.units}</td>
              <td>${money(row.sale)}</td>
              <td>${money(row.cost)}</td>
              <td class="${row.profit >= 0 ? "profit-good" : "profit-bad"}">${money(row.profit)}</td>
              <td>${margin.toFixed(1)}%</td>
            </tr>
          `;
        }).join("")}</tbody>
      </table>
    </div>
  `;
}

window.setPhoneInvoiceStatus = async (id, nextStatus) => {
  if (nextStatus === "Sold") {
    const saved = await ensurePhoneSaleAmountBeforeSold(id);
    if (!saved) return false;
  }
  const result = await api(`/api/phone-invoices/${id}/status`, {
    method: "PATCH",
    body: { status: nextStatus },
  });
  if (!result?.ok) return alert(result?.error || "Could not update invoice.");
  await loadPhoneInvoices();
  return true;
};

window.setPhoneInvoiceStatusFromSelect = async (id) => {
  await setPhoneInvoiceStatus(id, $(`phoneInvoiceStatus${id}`).value);
};

window.savePhoneInvoiceSale = async (id) => {
  const result = await savePhoneInvoiceSaleValue(id, $(`phoneSalePrice${id}`).value, $(`phoneSaleNotes${id}`).value);
  if (!result?.ok) return alert(result?.error || "Could not save sale amount.");
  await loadPhoneInvoices();
};

async function ensurePhoneSaleAmountBeforeSold(id) {
  const invoice = phoneInvoices.find((entry) => Number(entry.id) === Number(id));
  if (!invoice) return true;
  const currentInput = $(`phoneSalePrice${id}`)?.value?.trim() || "";
  const existingSale = invoice.sale_price === null || invoice.sale_price === undefined || invoice.sale_price === "" ? "" : String(invoice.sale_price);
  let salePrice = currentInput || existingSale;
  if (!salePrice) {
    salePrice = prompt(`Amount sold for ${invoice.label || `${invoice.buyer} Invoice`}?`, "");
    if (salePrice === null) return false;
  }
  const cleanPrice = Number(String(salePrice).replace(/[$,\s]/g, ""));
  if (Number.isNaN(cleanPrice) || cleanPrice <= 0) {
    alert("Enter a valid sold amount before marking the invoice Sold.");
    return false;
  }
  const saleNotes = $(`phoneSaleNotes${id}`)?.value || invoice.sale_notes || "";
  const result = await savePhoneInvoiceSaleValue(id, cleanPrice, saleNotes);
  if (!result?.ok) {
    alert(result?.error || "Could not save sale amount.");
    return false;
  }
  return true;
}

async function savePhoneInvoiceSaleValue(id, salePrice, saleNotes = "") {
  return api(`/api/phone-invoices/${id}/sale`, {
    method: "PATCH",
    body: {
      sale_price: salePrice,
      sale_notes: saleNotes,
    },
  });
}

window.removePhonePurchaseFromInvoice = async (id) => {
  const salePriceInput = prompt("Amount sold locally? Leave blank if you do not know yet.");
  if (salePriceInput === null) {
    return false;
  }
  const cleanSalePrice = String(salePriceInput || "").replace(/[$,\s]/g, "");
  if (cleanSalePrice && (Number.isNaN(Number(cleanSalePrice)) || Number(cleanSalePrice) < 0)) {
    alert("Enter a valid local sale amount, or leave it blank.");
    return false;
  }
  const result = await api(`/api/phone-purchases/${id}/invoice-removal`, {
    method: "PATCH",
    body: { remove: true, reason: "Sold locally", local_sale_price: cleanSalePrice },
  });
  if (!result?.ok) {
    return alert(result?.error || "Could not move this item to locally sold.");
  }
  await loadPhoneInvoices();
  openPhoneTab("locallySold");
  return true;
};

window.movePhonePurchaseToGiftCard = async (id) => {
  const valueInput = prompt("Apple gift card value?");
  if (valueInput === null) return false;
  const cleanValue = String(valueInput || "").replace(/[$,\s]/g, "");
  if (!cleanValue || Number.isNaN(Number(cleanValue)) || Number(cleanValue) < 0) {
    alert("Enter the Apple gift card value.");
    return false;
  }
  const result = await api(`/api/phone-purchases/${id}/gift-card`, {
    method: "PATCH",
    body: {
      gift_card_value: cleanValue,
      gift_card_notes: "Apple trade-in gift card",
    },
  });
  if (!result?.ok) {
    return alert(result?.error || "Could not move this item to gift cards.");
  }
  await loadPhoneInvoices();
  openPhoneTab("giftCards");
  return true;
};

window.saveGiftCardDetails = async (id) => {
  const cardFile = $(`giftCardPhoto${id}`)?.files?.[0] || null;
  const receiptFile = $(`giftCardReceipt${id}`)?.files?.[0] || null;
  const receiptIsPdf = receiptFile && isPdfFile(receiptFile);
  const result = await api(`/api/phone-purchases/${id}/gift-card-details`, {
    method: "PATCH",
    body: {
      gift_card_photo: cardFile ? await giftCardImageToDataUrl(cardFile) : null,
      receipt_photo: receiptFile && !receiptIsPdf ? await giftCardImageToDataUrl(receiptFile) : null,
    },
  });
  if (!result?.ok) {
    return alert(result?.error || "Could not save gift card details.");
  }
  if (receiptIsPdf) {
    const pdfResult = await uploadGiftCardReceiptPdf(id, receiptFile);
    if (!pdfResult?.ok) {
      return alert(pdfResult?.error || "Could not upload PDF receipt.");
    }
  }
  await loadPhoneInvoices();
  openPhoneTab("giftCards");
  alert("Gift card details saved.");
  return true;
};

async function uploadGiftCardReceiptPdf(id, file) {
  try {
    const response = await fetch(`/api/phone-purchases/${id}/gift-card-receipt-pdf`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/pdf",
        "X-File-Name": encodeURIComponent(file.name || "receipt.pdf"),
      },
      body: file,
    });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: text || `Request failed with status ${response.status}` };
    }
    if (!response.ok) return data;
    return data;
  } catch (error) {
    return { error: `Network error uploading PDF receipt. ${error?.message || ""}`.trim() };
  }
}

function isPdfFile(file) {
  return file?.type === "application/pdf" || /\.pdf$/i.test(file?.name || "");
}

function isPdfDataUrl(value) {
  return String(value || "").startsWith("data:application/pdf");
}

window.openGiftCardImage = (id, kind) => {
  const row = phoneInvoices.flatMap((invoice) => invoice.gift_cards || []).find((entry) => Number(entry.id) === Number(id));
  const src = kind === "receipt" ? row?.gift_card_receipt_data_url : row?.gift_card_photo_data_url;
  if (!src) return;
  const label = kind === "receipt" ? "Receipt" : "Gift card";
  const viewer = document.createElement("div");
  viewer.className = "photo-viewer";
  const media = isPdfDataUrl(src)
    ? `<iframe class="gift-card-pdf-viewer" src="${escapeAttr(src)}" title="${escapeAttr(label)} PDF"></iframe>`
    : `<img src="${escapeAttr(src)}" alt="${label} photo">`;
  viewer.innerHTML = `<div class="photo-viewer-backdrop" onclick="this.parentElement.remove()"></div><div class="photo-viewer-panel"><button class="photo-viewer-close" onclick="this.closest('.photo-viewer').remove()">Close</button>${media}<p>${escapeHtml(label)} - ${escapeHtml(row.model || "Phone")}</p></div>`;
  document.body.appendChild(viewer);
};

window.returnPhonePurchaseToKt = async (id) => {
  const reason = prompt("Reason for return?");
  if (reason === null) return false;
  if (!reason.trim()) {
    alert("Enter a return reason.");
    return false;
  }
  const result = await api(`/api/phone-purchases/${id}/return`, {
    method: "PATCH",
    body: { reason: reason.trim() },
  });
  if (!result?.ok) {
    return alert(result?.error || "Could not return this item.");
  }
  await loadPhoneInvoices();
  openPhoneTab("ktReturns");
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
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: text || `Request failed with status ${response.status}` };
    }
    if (!response.ok && !options.silent) return data;
    return data;
  } catch (error) {
    if (!options.silent) alert(`Network error. Try again. ${error?.message || ""}`.trim());
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

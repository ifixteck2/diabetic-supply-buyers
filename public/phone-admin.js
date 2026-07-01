const $ = (id) => document.getElementById(id);
const money = (value) => Number(value || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
const status = (id, message, type = "ok") => {
  $(id).innerHTML = message ? `<div class="status ${type}">${message}</div>` : "";
};

let atlasPrices = [];
let phoneInvoices = [];
let editingPhonePurchaseId = null;

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
  $("parseQuickPhoneBtn").onclick = () => parseQuickPhoneText(false);
  $("addQuickPhoneBtn").onclick = () => parseQuickPhoneText(true);
  $("moveLatestPhonesBtn").onclick = moveLatestPhones;
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
    ktReturns: "KT Returns",
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
  togglePurchaseDeductionFields();
}

function togglePurchaseDeductionFields() {
  $("atlasPurchaseDeductions").classList.toggle("hidden", $("phoneBuyer").value !== "Atlas");
  $("ktPurchaseDeductions").classList.toggle("hidden", $("phoneBuyer").value !== "KT");
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
  const condition = phonePricingCondition();
  const exact = matchingRows().find((row) => checkerModelName(row) === selectedModel && (row.storage || "N/A") === selectedStorage && normalizeCheckerCarrier(row.carrier) === carrier && row.condition === condition);
  const fallback = matchingRows().find((row) => checkerModelName(row) === selectedModel && (row.storage || "N/A") === selectedStorage && normalizeCheckerCarrier(row.carrier || "Any") === "Any" && row.condition === condition);
  const row = exact || fallback;
  if (row?.price) {
    const deduction = selectedPhonePurchaseDeduction(row);
    const finalPrice = Math.max(0, Number(row.price || 0) - Number(deduction.amount || 0));
    $("phoneProjected").value = finalPrice;
    $("phonePricePreview").classList.remove("hidden");
    const deductionText = deduction.notes.length ? ` - ${escapeHtml(deduction.notes.join(", "))}` : "";
    $("phonePricePreview").innerHTML = `<span>${escapeHtml($("phoneBuyer").value)} projected sell price</span><strong>${money(finalPrice)}</strong><em>${escapeHtml(row.source_sheet || row.source || "Price sheet")} - ${escapeHtml(row.condition)} - ${escapeHtml(row.carrier || "Unlocked")}${deductionText}</em>`;
  } else {
    $("phonePricePreview").classList.add("hidden");
  }
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
    else failures.push(`${line} (${result?.error || "not saved"})`);
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
  itemText = priceResult.text;
  if (!seller) {
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
  if (!matches.length) return { price: 0, text };
  const match = matches[matches.length - 1];
  return { price: Number(match[1].replace(/,/g, "")), text: removeQuickMatch(text, match) };
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
  $("conditionType").value = "Used";
  $("packaging").value = "Sealed";
  $("grade").value = "Grade A";
  $("phoneBrand").value = "Apple";
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
  if (clearStatus) status("phonePurchaseStatus", "");
}

function renderInvoiceLists() {
  renderInvoiceGroup("atlasPendingList", "Atlas", "Pending");
  renderInvoiceGroup("ktPendingList", "KT", "Pending");
  renderKtReturns();
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

function renderKtReturns() {
  const list = phoneInvoices
    .filter((invoice) => invoice.buyer === "KT" && (invoice.returns || []).length)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  $("ktReturnsList").innerHTML = list.map(renderKtReturnCard).join("") || `<div class="empty">No KT returns yet.</div>`;
}

function renderKtReturnCard(invoice) {
  const returns = invoice.returns || [];
  const totalCost = returns.reduce((sum, row) => sum + Number(row.quantity || 0) * Number(row.cost_each || 0), 0);
  const rows = returns.map((row) => `
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
      <td>${escapeHtml(row.return_reason || row.invoice_removed_reason || "Returned")}</td>
      <td>${row.returned_at ? new Date(row.returned_at).toLocaleDateString() : ""}</td>
    </tr>
  `).join("");
  return `
    <article class="invoice-card phone-invoice-card return-invoice-card">
      <div class="invoice-top">
        <div class="phone-invoice-title">
          <h3>${escapeHtml(invoice.label || "KT Invoice")}</h3>
          <p>#${invoice.id} - ${new Date(invoice.created_at).toLocaleDateString()} - ${returns.length} returned item${returns.length === 1 ? "" : "s"}</p>
        </div>
        <span class="pill closed">Returns</span>
      </div>
      <div class="table-wrap">
        <table class="phone-profit-table">
          <thead><tr><th>Phone</th><th>Carrier</th><th>Qty</th><th>Cost Each</th><th>Reason</th><th>Returned</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="sale-summary"><span>Returned Cost ${money(totalCost)}</span></div>
    </article>
  `;
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
  const { totalCost, projected, units, salePrice } = invoiceTotals(invoice);
  const actualProfit = salePrice === null ? null : salePrice - totalCost;
  const projectedProfit = projected - totalCost;
  const canRemove = invoice.status === "Pending";
  const canReturn = invoice.buyer === "KT";
  const isPending = invoice.status === "Pending";
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
      <td><div class="phone-row-actions"><button class="mini-btn" onclick="startPhonePurchaseEdit(${row.id})">Edit</button>${canReturn ? `<button class="mini-btn warning" onclick="returnPhonePurchaseToKt(${row.id})">Return</button>` : ""}${canRemove ? `<button class="mini-btn danger" onclick="removePhonePurchaseFromInvoice(${row.id})">Remove</button>` : ""}</div></td>
    </tr>
  `).join("");
  const pendingRows = purchases.map((row) => `
    <tr class="pending-phone-row">
      <td class="phone-device-cell">
        <strong>${escapeHtml(row.model)}</strong>
        <span>${escapeHtml(phoneInvoiceItemCondition(row))}</span>
        ${row.imei ? `<em>IMEI ${escapeHtml(row.imei)}</em>` : ""}
        ${row.notes ? `<em>${escapeHtml(row.notes)}</em>` : ""}
        ${row.photo_data_url ? `<button class="phone-photo-link" onclick="openPhonePhoto(${row.id})">View photo</button>` : ""}
      </td>
      <td>${escapeHtml(row.carrier || "")}</td>
      <td>${row.quantity}</td>
      <td>${money(row.cost_each)}</td>
      <td>${money(row.projected_sell_each)}</td>
      <td class="${profitClass(row)}"><strong>${money(profitTotal(row))}</strong></td>
      <td><div class="phone-row-actions"><button class="mini-btn" onclick="startPhonePurchaseEdit(${row.id})">Edit</button>${canReturn ? `<button class="mini-btn warning" onclick="returnPhonePurchaseToKt(${row.id})">Return</button>` : ""}${canRemove ? `<button class="mini-btn danger" onclick="removePhonePurchaseFromInvoice(${row.id})">Remove</button>` : ""}</div></td>
    </tr>
  `).join("");
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
  return `
    <article class="invoice-card phone-invoice-card ${isPending ? "phone-invoice-compact" : ""}">
      <div class="invoice-top">
        <div class="phone-invoice-title">
          <h3>${escapeHtml(invoice.label || `${invoice.buyer} Invoice`)}</h3>
          <p>#${invoice.id} - ${escapeHtml(invoice.buyer)} - ${new Date(invoice.created_at).toLocaleDateString()} - ${units} phone${units === 1 ? "" : "s"} total</p>
        </div>
        ${isPending ? `
          <div class="pending-invoice-metrics">
            <span><small>Cost</small><b>${money(totalCost)}</b></span>
            <span><small>Projected</small><b>${money(projected)}</b></span>
            <span class="${projectedProfit >= 0 ? "profit-good" : "profit-bad"}"><small>Profit</small><b>${money(projectedProfit)}</b></span>
          </div>
        ` : ""}
        <span class="pill ${invoice.status?.toLowerCase()}">${escapeHtml(invoice.status)}</span>
      </div>
      ${isPending ? `
        <div class="table-wrap pending-table-wrap">
          <table class="phone-profit-table pending-phone-table">
            <thead><tr><th>Phone</th><th>Carrier</th><th>Qty</th><th>Cost</th><th>Sell</th><th>Profit</th><th></th></tr></thead>
            <tbody>${pendingRows || `<tr><td colspan="7">No purchases added.</td></tr>`}</tbody>
          </table>
        </div>
      ` : `
        <div class="table-wrap">
          <table class="phone-profit-table">
            <thead><tr><th>Device</th><th>Carrier</th><th>Qty</th><th>Cost Each</th><th>Sell Each</th><th>Profit Each</th><th>Total Profit</th><th></th></tr></thead>
            <tbody>${rows || `<tr><td colspan="8">No purchases added.</td></tr>`}</tbody>
          </table>
        </div>
      `}
      <div class="sale-summary ${isPending ? "pending-sale-summary" : ""}">
        <span>Cost ${money(totalCost)}</span>
        <span>Projected ${money(projected)}</span>
        ${salePrice === null ? `<span>Actual Sale Not Set</span>` : `<span>Actual Sale ${money(salePrice)}</span>`}
        <strong>Profit ${money(projectedProfit)}</strong>
        ${actualProfit === null ? "" : `<strong class="${actualProfit >= 0 ? "profit-good" : "profit-bad"}">Actual Profit ${money(actualProfit)}</strong>`}
      </div>
      ${isPending ? `<details class="phone-controls"><summary>Sale / Status Controls</summary>${saleControls}</details>` : saleControls}
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

window.returnPhonePurchaseToKt = async (id) => {
  const reason = prompt("Reason for KT return?");
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

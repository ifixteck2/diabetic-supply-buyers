const $ = (id) => document.getElementById(id);
const money = (value) => Number(value || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
const profitMoney = (value) => Math.ceil(Number(value || 0)).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const status = (id, message, type = "ok") => {
  $(id).innerHTML = message ? `<div class="status ${type}">${message}</div>` : "";
};
const onlineOrdersOnly = document.body?.dataset.portal === "online-orders";

let atlasPrices = [];
let phoneInvoices = [];
let manualPhoneReturns = [];
let phoneHoldingItems = [];
let phoneOnlineOrders = [];
let phoneOnlineOrderInvoices = [];
let prepaidPortRecords = [];
let monthlyTrackerEntries = [];
let monthlyTrackerHistory = [];
let monthlyTrackerLoaded = false;
let onlinePayablesLoaded = false;
let monthlyTrackerRequest = 0;
let editingMonthlyTrackerId = null;
let monthlyTrackerSettings = defaultMonthlyTrackerSettings();
let onlinePayables = [];
let editingPhonePurchaseId = null;
let editingOnlineOrderId = null;
let onlineOrderSubTab = "add";

initPhonePortal();

async function initPhonePortal() {
  $("phonePurchaseDate").value = localTodayInput();
  $("manualReturnDate").value = localTodayInput();
  $("manualGiftCardDate").value = localTodayInput();
  $("directHoldingDate").value = localTodayInput();
  $("onlineOrderDate").value = localTodayInput();
  if ($("onlinePayableDueDate")) $("onlinePayableDueDate").value = localTodayInput();
  if ($("monthlyTrackerMonth")) $("monthlyTrackerMonth").value = localMonthInput();
  if ($("monthlyTrackerDate")) $("monthlyTrackerDate").value = localTodayInput();
  bindPhoneEvents();
  const me = await api(onlineOrdersOnly ? "/api/online-orders-me" : "/api/phone-me", { silent: true });
  if (me?.ok) showPhoneApp();
}

function bindPhoneEvents() {
  if (!onlineOrdersOnly) {
    document.querySelectorAll("[data-online-only]").forEach((element) => element.classList.add("hidden"));
  }
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
  $("addDirectHoldingBtn").onclick = addDirectHoldingPhone;
  $("closeGiftCardBatchBtn").onclick = closeCurrentGiftCardBatch;
  $("saveOnlineOrderBtn").onclick = saveOnlineOrder;
  $("savePrepaidPortBtn").onclick = savePrepaidPort;
  $("bulkPortNumbersBtn").onclick = saveBulkPortNumbers;
  $("saveSinglePrepaidCardBtn").onclick = saveSinglePrepaidCard;
  $("bulkPrepaidCardsBtn").onclick = saveBulkPrepaidCards;
  $("refreshPrepaidPortsBtn").onclick = loadPrepaidPorts;
  if ($("financialEntryForm")) $("financialEntryForm").onsubmit = (event) => { event.preventDefault(); saveMonthlyTrackerEntry(); };
  if (onlineOrdersOnly) FinancialTracker.init();
  if ($("saveMonthlyTrackerSettingsBtn")) $("saveMonthlyTrackerSettingsBtn").onclick = saveMonthlyTrackerSettings;
  if ($("monthlyTrackerMonth")) $("monthlyTrackerMonth").onchange = loadMonthlyTracker;
  if ($("saveOnlinePayableBtn")) $("saveOnlinePayableBtn").onclick = saveOnlinePayable;
  $("cancelOnlineOrderEditBtn").onclick = () => resetOnlineOrderForm();
  $("saveOnlineOrderEditBtn").onclick = saveOnlineOrderEdit;
  $("editOnlineOrderProvider").addEventListener("change", toggleEditOnlineOrderProvider);
  $("onlineOrderPlacedNowBtn").onclick = stampOnlineOrderPlacedNow;
  $("onlineOrdersBackBtn").textContent = onlineOrdersOnly ? "Log Out" : "Back To Phone Portal";
  $("onlineOrdersBackBtn").onclick = () => {
    if (onlineOrdersOnly) return logoutPhonePortal();
    return closeOnlineOrdersPage("dashboard");
  };
  $("onlineOrdersRefreshBtn").onclick = async () => {
    if (onlineOrdersOnly) return refreshOnlineOrdersOnlyPortal();
    await loadPhoneOnlineOrders();
    await loadPhoneOnlineOrderInvoices();
    await loadPrepaidPorts();
  };
  $("onlineOrderSearch").addEventListener("input", renderOnlineOrders);
  $("onlineOrdersClearSearchBtn").onclick = () => {
    $("onlineOrderSearch").value = "";
    renderOnlineOrders();
  };
  $("onlineOrderProvider").addEventListener("change", toggleOnlineOrderProvider);
  document.querySelectorAll("[data-online-main-tab]").forEach((button) => {
    button.onclick = () => openOnlineMainTab(button.dataset.onlineMainTab);
  });
  document.querySelectorAll("[data-online-order-tab]").forEach((button) => {
    button.onclick = () => openOnlineOrderTab(button.dataset.onlineOrderTab);
  });
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
  const result = await api(onlineOrdersOnly ? "/api/online-orders-login" : "/api/phone-login", {
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
  await api(onlineOrdersOnly ? "/api/online-orders-logout" : "/api/phone-logout", { method: "POST" });
  location.reload();
}

async function showPhoneApp() {
  $("phoneLogin").classList.add("hidden");
  if (onlineOrdersOnly) {
    document.querySelector(".admin-shell").classList.add("hidden");
    $("onlineOrdersPage").classList.remove("hidden");
    $("phoneApp").classList.remove("hidden");
    openOnlineMainTab("tracker");
    await refreshOnlineOrdersOnlyPortal();
    return;
  }
  $("phoneApp").classList.remove("hidden");
  await refreshPhonePortal();
}

async function refreshPhonePortal() {
  if (onlineOrdersOnly) return refreshOnlineOrdersOnlyPortal();
  await loadAtlasPrices();
  await loadPhoneInvoices();
  await loadManualPhoneReturns();
  await loadPhoneHolding();
  await loadPhoneOnlineOrders();
  await loadPhoneOnlineOrderInvoices();
  await loadPrepaidPorts();
}

async function refreshOnlineOrdersOnlyPortal() {
  await Promise.all([loadPhoneOnlineOrders(), loadPhoneOnlineOrderInvoices(), loadPrepaidPorts(), loadMonthlyTracker(), loadOnlinePayables()]);
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

async function loadPhoneHolding() {
  const result = await api("/api/phone-holding", { silent: true });
  phoneHoldingItems = result?.items || [];
  renderInvoiceLists();
}

async function loadPhoneOnlineOrders() {
  const result = await api("/api/phone-online-orders", { silent: true });
  phoneOnlineOrders = result?.orders || [];
  renderOnlineOrders();
}

async function loadPhoneOnlineOrderInvoices() {
  const result = await api("/api/phone-online-order-invoices", { silent: true });
  phoneOnlineOrderInvoices = result?.invoices || [];
  renderOnlineOrders();
}

async function loadPrepaidPorts() {
  const result = await api("/api/phone-prepaid-ports", { silent: true });
  prepaidPortRecords = result?.ports || [];
  renderPrepaidPorts();
}

async function loadMonthlyTracker() {
  if (!onlineOrdersOnly || !$("monthlyTrackerMonth")) return;
  const month = $("monthlyTrackerMonth").value || localMonthInput();
  const request = ++monthlyTrackerRequest;
  monthlyTrackerLoaded = false;
  FinancialTracker.invalidate();
  $("financialLoadStatus").textContent = "Loading financial records...";
  const result = await api(`/api/online-monthly-tracker?month=${encodeURIComponent(month)}&history_months=6`, { silent: true });
  if (request !== monthlyTrackerRequest) return;
  if (!Array.isArray(result?.entries)) {
    $("financialLoadStatus").textContent = result?.error || "Financial records could not be loaded. Refresh to try again.";
    ["monthlyTrackerStats", "financialOverview", "monthlyTrackerList", "financialPlanReport"].forEach((id) => { $(id).innerHTML = ""; });
    return;
  }
  monthlyTrackerEntries = result.entries;
  monthlyTrackerHistory = result.history_entries || result.entries;
  monthlyTrackerSettings = result?.settings || defaultMonthlyTrackerSettings(month);
  monthlyTrackerLoaded = true;
  fillMonthlyTrackerSettings();
  renderMonthlyTracker();
}

async function loadOnlinePayables() {
  if (!onlineOrdersOnly || !$("onlinePayablesList")) return;
  const result = await api("/api/online-payables", { silent: true });
  if (!Array.isArray(result?.payables)) {
    onlinePayablesLoaded = false;
    FinancialTracker.invalidate();
    $("onlinePayableStats").innerHTML = "";
    $("financialLoadStatus").textContent = result?.error || "Bills could not be loaded. Refresh to try again.";
    $("onlinePayablesList").textContent = "Bills could not be loaded. Refresh to try again.";
    return;
  }
  onlinePayables = result.payables;
  onlinePayablesLoaded = true;
  renderOnlinePayables();
  renderMonthlyTracker();
}

function openPhoneTab(name) {
  if (onlineOrdersOnly) {
    openOnlineOrdersPage();
    return;
  }
  if (name === "onlineOrders") {
    openOnlineOrdersPage();
    return;
  }
  $("onlineOrdersPage").classList.add("hidden");
  document.querySelector(".admin-shell").classList.remove("hidden");
  const titles = {
    dashboard: "Dashboard",
    purchase: "Add Purchase",
    priceChecker: "Price Checker",
    holding: "Holding",
    atlasPending: "Atlas Pending",
    ktPending: "KT Pending",
    locallySold: "Locally Sold",
    giftCards: "Gift Cards",
    ktReturns: "Returns",
    pastInvoices: "Past Invoices",
    onlineOrders: "Online Orders",
  };
  document.querySelectorAll("[data-phone-tab]").forEach((button) => button.classList.toggle("active", button.dataset.phoneTab === name));
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.add("hidden"));
  $(`${name}PhoneTab`).classList.remove("hidden");
  $("phonePageTitle").textContent = titles[name] || "Phone Portal";
  renderInvoiceLists();
}

function openOnlineOrdersPage() {
  document.querySelector(".admin-shell").classList.add("hidden");
  $("onlineOrdersPage").classList.remove("hidden");
  document.querySelectorAll("[data-phone-tab]").forEach((button) => button.classList.toggle("active", button.dataset.phoneTab === "onlineOrders"));
  openOnlineMainTab(onlineOrdersOnly ? "tracker" : "orders");
  renderOnlineOrders();
}

function closeOnlineOrdersPage(tabName = "dashboard") {
  if (onlineOrdersOnly) return;
  $("onlineOrdersPage").classList.add("hidden");
  document.querySelector(".admin-shell").classList.remove("hidden");
  openPhoneTab(tabName);
}

function openOnlineOrderTab(name) {
  const panelNames = { add: "Add", stats: "Stats", pending: "Pending", transit: "Transit", stock: "Stock", invoices: "Invoices", prepaid: "Prepaid", addresses: "Addresses", lost: "Lost", completed: "Completed" };
  const selected = panelNames[name] ? name : "add";
  onlineOrderSubTab = selected;
  openOnlineMainTab("orders", { keepSubTab: true });
  document.querySelectorAll("[data-online-order-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.onlineOrderTab === selected);
  });
  Object.entries(panelNames).forEach(([tabName, panelName]) => {
    const panel = $(`onlineOrders${panelName}Panel`);
    if (panel) panel.classList.toggle("hidden", tabName !== selected);
  });
}

function openOnlineMainTab(name, options = {}) {
  const selected = (name === "tracker" || name === "payables") && onlineOrdersOnly ? name : "orders";
  if (onlineOrdersOnly) {
    const header = document.querySelector(".online-orders-header h1");
    if (header) header.textContent = selected === "orders" ? "Online Orders" : "Financial Workspace";
    const description = document.querySelector(".online-orders-header p");
    if (description) description.classList.toggle("hidden", selected !== "orders");
  }
  document.querySelectorAll("[data-online-main-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.onlineMainTab === selected);
  });
  const subTabs = document.querySelector(".online-order-sub-tabs");
  if (subTabs) subTabs.classList.toggle("hidden", selected !== "orders");
  const trackerPanel = $("onlineOrdersTrackerPanel");
  if (trackerPanel) trackerPanel.classList.toggle("hidden", selected !== "tracker");
  const payablesPanel = $("onlineOrdersPayablesPanel");
  if (payablesPanel) payablesPanel.classList.toggle("hidden", selected !== "payables");
  if (selected === "tracker" || selected === "payables") {
    ["Add", "Stats", "Pending", "Transit", "Stock", "Invoices", "Prepaid", "Addresses", "Lost", "Completed"].forEach((panelName) => {
      const panel = $(`onlineOrders${panelName}Panel`);
      if (panel) panel.classList.add("hidden");
    });
    if (selected === "tracker") renderMonthlyTracker();
    if (selected === "payables") renderOnlinePayables();
    return;
  }
  if (!options.keepSubTab) openOnlineOrderTab(onlineOrderSubTab);
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

const APPLE_TRADE_IN_VALUES = [
  { model: "iPhone 17 Pro Max", value: null, note: "Not eligible yet" },
  { model: "iPhone 17 Pro", value: null, note: "Not eligible yet" },
  { model: "iPhone 17 Air", value: null, note: "Not eligible yet" },
  { model: "iPhone 17", value: null, note: "Not eligible yet" },
  { model: "iPhone 16 Pro Max", value: 695 },
  { model: "iPhone 16 Pro", value: 560 },
  { model: "iPhone 16 Plus", value: 465 },
  { model: "iPhone 16e", value: 310 },
  { model: "iPhone 16", value: 460 },
  { model: "iPhone 15 Pro Max", value: 490 },
  { model: "iPhone 15 Pro", value: 410 },
  { model: "iPhone 15 Plus", value: 325 },
  { model: "iPhone 15", value: 320 },
  { model: "iPhone 14 Pro Max", value: 375 },
  { model: "iPhone 14 Pro", value: 320 },
  { model: "iPhone 14 Plus", value: 235 },
  { model: "iPhone 14", value: 225 },
  { model: "iPhone 13 Pro Max", value: 320 },
  { model: "iPhone 13 Pro", value: 260 },
  { model: "iPhone 13", value: 195 },
  { model: "iPhone 13 mini", value: 150 },
  { model: "iPhone 12 Pro Max", value: 220 },
  { model: "iPhone 12 Pro", value: 180 },
  { model: "iPhone 12", value: 125 },
  { model: "iPhone 12 mini", value: 85 },
  { model: "iPhone 11 Pro Max", value: 150 },
  { model: "iPhone 11 Pro", value: 135 },
  { model: "iPhone 11", value: 100 },
  { model: "iPhone SE (3rd Gen)", value: 80 },
  { model: "iPhone SE (2nd Gen)", value: 45 },
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
  if ($("phoneBuyer").value === "Holding") {
    $("phoneProjected").value = "";
    $("phonePricePreview").classList.add("hidden");
    return;
  }
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
  const isHolding = buyer === "Holding";
  $("phoneInvoiceSelect").disabled = isHolding;
  $("newPhoneInvoiceLabel").disabled = isHolding;
  $("createPhoneInvoiceBtn").disabled = isHolding;
  $("phoneHoldingTypeWrap").classList.toggle("hidden", !isHolding);
  $("savePhonePurchaseBtn").textContent = editingPhonePurchaseId ? "Save Changes" : isHolding ? "Add To Holding" : "Add Purchase To Invoice";
  if (isHolding) {
    $("phoneInvoiceSelect").innerHTML = `<option value="">Holding - no invoice</option>`;
    return;
  }
  const pending = phoneInvoices.filter((invoice) => invoice.buyer === buyer && invoice.status === "Pending");
  $("phoneInvoiceSelect").innerHTML = pending.map((invoice) => (
    `<option value="${invoice.id}">#${invoice.id} - ${escapeHtml(invoice.label)} (${invoiceTotals(invoice).units} phones)</option>`
  )).join("") || `<option value="">Create/select pending invoice</option>`;
}

async function createPhoneInvoice() {
  const buyer = $("phoneBuyer").value;
  if (buyer === "Holding") return status("phonePurchaseStatus", "Holding phones do not need an invoice.", "bad");
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
  if (!editingPhonePurchaseId && body.buyer === "Holding") return savePhoneHoldingPurchase(body, options);
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

async function savePhoneHoldingPurchase(body, options = {}) {
  const result = await api("/api/phone-holding", {
    method: "POST",
    body,
  });
  if (!result?.ok) {
    if (!options.silent) status("phonePurchaseStatus", result?.error || "Could not save holding phone.", "bad");
    return result;
  }
  if (!options.silent) status("phonePurchaseStatus", "Added phone to Holding.");
  if (!options.keepForm) resetPhonePurchase(false);
  if (!options.silent) {
    await loadPhoneHolding();
    openPhoneTab("holding");
  }
  return result;
}

async function addDirectHoldingPhone() {
  const model = $("directHoldingModel").value.trim();
  const costEach = Number($("directHoldingCost").value || 0);
  const quantity = Number($("directHoldingQuantity").value || 1);
  if (!model) return status("directHoldingStatus", "Enter the phone model.", "bad");
  if (!Number.isFinite(costEach) || costEach < 0) return status("directHoldingStatus", "Enter your cost.", "bad");
  if (!Number.isInteger(quantity) || quantity < 1) return status("directHoldingStatus", "Quantity must be at least 1.", "bad");
  const result = await api("/api/phone-holding", {
    method: "POST",
    body: {
      purchase_date: $("directHoldingDate").value,
      device_type: "Phone",
      condition_type: "Used",
      packaging: "",
      grade: "Holding",
      model,
      carrier: $("directHoldingCarrier").value.trim(),
      quantity,
      cost_each: costEach,
      imei: $("directHoldingImei").value.trim(),
      placed_at: $("directHoldingSource").value.trim(),
      notes: $("directHoldingNotes").value.trim(),
      holding_type: $("directHoldingType").value,
    },
  });
  if (!result?.ok) return status("directHoldingStatus", result?.error || "Could not add this phone to Holding.", "bad");
  ["directHoldingModel", "directHoldingCost", "directHoldingCarrier", "directHoldingImei", "directHoldingSource", "directHoldingNotes"].forEach((id) => { $(id).value = ""; });
  $("directHoldingQuantity").value = "1";
  $("directHoldingDate").value = localTodayInput();
  status("directHoldingStatus", "Added phone to Holding.");
  await loadPhoneHolding();
  openPhoneTab("holding");
  return true;
}

async function parseQuickPhoneText(saveAfterParse) {
  const entries = quickPhoneEntries();
  if (saveAfterParse && entries.length > 1) return addQuickPhoneLines(entries);
  const parsed = parseQuickPhoneLine(entries[0] || "");
  applyQuickImeiFallback(parsed, entries.length);
  if (!parsed.modelText) {
    return status("quickPhoneStatus", "Type at least a model, like iPhone 17 256GB unlocked grade C.", "bad");
  }
  if (saveAfterParse && !completeQuickRequiredDetails(parsed)) {
    return status("quickPhoneStatus", "Seller name and IMEI are required unless you put Mike after the price.", "bad");
  }
  applyQuickPhoneFields(parsed);
  if (!saveAfterParse) {
    status("quickPhoneStatus", `Filled flow for ${escapeHtml($("phoneModel").value || parsed.modelText)}.`);
    return null;
  }
  await savePhonePurchase();
  status("quickPhoneStatus", $("phoneBuyer").value === "Holding" ? `Added ${escapeHtml(parsed.modelText)} to Holding.` : `Added ${escapeHtml(parsed.modelText)} to the selected invoice.`);
  $("quickPhoneText").value = "";
  $("quickPhoneImei").value = "";
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

function applyQuickImeiFallback(parsed, entryCount) {
  const quickImei = $("quickPhoneImei")?.value.trim() || "";
  if (entryCount === 1 && quickImei && !parsed.imei) parsed.imei = quickImei;
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
    if (!completeQuickRequiredDetails(parsed)) {
      failures.push(`${typeof entry === "string" ? entry : entry.text} (missing seller or IMEI)`);
      continue;
    }
    applyQuickPhoneFields(parsed);
    const result = await savePhonePurchase({ silent: true, keepForm: true });
    if (result?.ok) added += 1;
    else failures.push(`${typeof entry === "string" ? entry : entry.text} (${result?.error || "not saved"})`);
  }
  await loadPhoneInvoices();
  await loadPhoneHolding();
  if (failures.length) {
    status("quickPhoneStatus", `Added ${added}. Could not add: ${escapeHtml(failures.join("; "))}`, "bad");
  } else {
    status("quickPhoneStatus", $("phoneBuyer").value === "Holding" ? `Added ${added} phones to Holding.` : `Added ${added} phones to the selected invoice.`);
    $("quickPhoneText").value = "";
    $("quickPhoneImei").value = "";
  }
  resetPhonePurchase(false);
  return null;
}

function completeQuickRequiredDetails(parsed) {
  if (isQuickMikeSource(parsed)) return true;
  const seller = quickTitle(stripQuickNoise(window.prompt(`Who did you get this ${parsed.modelText || "phone"} from?`, parsed.seller || "") || ""));
  if (!seller) return false;
  const imei = stripQuickNoise(window.prompt(`Enter IMEI / serial for ${parsed.modelText || "this phone"}`, parsed.imei || "") || "");
  if (!imei) return false;
  parsed.seller = seller;
  parsed.imei = imei;
  parsed.placedAt = parsed.placedAt || seller;
  parsed.notes = mergeQuickNotes(parsed.notes, `Seller ${seller}`);
  return true;
}

function isQuickMikeSource(parsed) {
  return /^mike$/i.test(String(parsed.priceSource || parsed.placedAt || parsed.seller || "").trim());
}

function mergeQuickNotes(notes, addition) {
  const parts = String(notes || "").split(/\s+\|\s+/).filter(Boolean);
  if (!parts.some((part) => part.toLowerCase() === addition.toLowerCase())) parts.push(addition);
  return parts.join(" | ");
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
  const placedAt = priceSource || purchaseLocation || seller || "";
  return { raw, buyer, deviceType, brand, conditionType, packaging, grade, storage, carrier, quantity: quantityResult.quantity, cost, imei, deductions, modelText, notes, placedAt, seller, purchaseLocation, priceSource };
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
  $("phonePlacedAt").value = parsed.placedAt || "";
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
    placed_at: $("phonePlacedAt").value.trim(),
    photo,
    holding_type: $("phoneHoldingType")?.value || "Holding For Sale",
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
  $("phonePlacedAt").value = "";
  $("phonePhoto").value = "";
  $("ktDeductCrackedBack").checked = false;
  $("atlasDeductCrackedBack").checked = false;
  $("atlasDeductCrackedLens").checked = false;
  $("atlasDeductBattery").checked = false;
  $("atlasDeductRepair").checked = false;
  $("atlasDeductFaceId").checked = false;
  $("phonePurchaseDate").value = localTodayInput();
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
  renderPhoneHolding();
  renderLocallySold();
  renderGiftCards();
  renderKtReturns();
  renderPastInvoices();
}

function toggleOnlineOrderProvider() {
  const isOther = $("onlineOrderProvider").value === "Other";
  $("onlineOrderOtherProviderWrap").classList.toggle("hidden", !isOther);
}

async function saveOnlineOrder() {
  const provider = $("onlineOrderProvider").value === "Other" ? $("onlineOrderOtherProvider").value.trim() : $("onlineOrderProvider").value;
  const paymentMethod = $("onlineOrderCard").value.trim();
  if (!paymentMethod) return status("onlineOrderStatus", "Enter the payment method before adding this order.", "bad");
  if (!editingOnlineOrderId && !$("onlineOrderPlacedTimestamp").value) stampOnlineOrderPlacedNow(false);
  const result = await api(editingOnlineOrderId ? `/api/phone-online-orders/${editingOnlineOrderId}` : "/api/phone-online-orders", {
    method: editingOnlineOrderId ? "PATCH" : "POST",
    body: {
      provider,
      order_number: $("onlineOrderNumber").value.trim(),
      phone_model: $("onlineOrderModel").value.trim(),
      first_name: $("onlineOrderFirstName").value.trim(),
      last_name: $("onlineOrderLastName").value.trim(),
      order_date: $("onlineOrderDate").value,
      placed_at: $("onlineOrderPlacedAt").value.trim(),
      shipping_address: $("onlineOrderAddress").value.trim(),
      cc_used: paymentMethod,
      cost: Number($("onlineOrderCost").value || 0),
      port_number_cost: Number($("onlineOrderPortCost").value || 0),
      phone_number: $("onlineOrderPhoneNumber").value.trim(),
      call_phone_number: $("onlineOrderCallPhoneNumber").value.trim(),
      account_pin: $("onlineOrderAccountPin").value.trim(),
      email: $("onlineOrderEmail").value.trim(),
      tracking_info: $("onlineOrderTracking").value.trim(),
      order_placed_at: $("onlineOrderPlacedTimestamp").value,
    },
  });
  if (!result?.ok) return status("onlineOrderStatus", result?.error || "Could not save online order.", "bad");
  const message = editingOnlineOrderId ? "Online order updated." : "Online order added.";
  resetOnlineOrderForm(message);
  await loadPhoneOnlineOrders();
  openOnlineOrderTab("pending");
}

function resetOnlineOrderForm(message = "") {
  editingOnlineOrderId = null;
  ["onlineOrderOtherProvider", "onlineOrderNumber", "onlineOrderModel", "onlineOrderFirstName", "onlineOrderLastName", "onlineOrderPlacedAt", "onlineOrderAddress", "onlineOrderCard", "onlineOrderCost", "onlineOrderPortCost", "onlineOrderPhoneNumber", "onlineOrderCallPhoneNumber", "onlineOrderAccountPin", "onlineOrderEmail", "onlineOrderTracking", "onlineOrderPlacedTimestamp"].forEach((id) => { $(id).value = ""; });
  $("onlineOrderProvider").value = "Boost Mobile";
  $("onlineOrderDate").value = localTodayInput();
  $("saveOnlineOrderBtn").textContent = "Add Order";
  $("cancelOnlineOrderEditBtn").classList.add("hidden");
  toggleOnlineOrderProvider();
  status("onlineOrderStatus", message);
}

function stampOnlineOrderPlacedNow(showMessage = true) {
  const now = new Date();
  $("onlineOrderDate").value = localDateKey(now);
  $("onlineOrderPlacedTimestamp").value = now.toISOString();
  if (showMessage) status("onlineOrderStatus", `Order placed time stamped: ${formatDateTime(now)}.`);
}

function renderOnlineOrders() {
  if (!$("onlineOrderStats")) return;
  const searchTerm = $("onlineOrderSearch")?.value || "";
  const filteredOrders = onlineOrderSearchResults(phoneOnlineOrders, searchTerm);
  const searchActive = onlineOrderSearchTokens(searchTerm).length > 0;
  $("onlineOrderSearchStatus").innerHTML = searchActive
    ? `<span>Showing ${filteredOrders.length} of ${phoneOnlineOrders.length} orders matching "${escapeHtml(searchTerm.trim())}"</span>`
    : "";
  const ordered = [
    ...filteredOrders.filter((order) => order.status === "Ordered"),
    ...onlineOrderLineStatusItems(filteredOrders, "Ordered"),
  ];
  const transit = [
    ...filteredOrders.filter((order) => order.status === "Shipped"),
    ...onlineOrderLineStatusItems(filteredOrders, "Shipped"),
  ];
  const stock = filteredOrders.filter((order) => order.status === "Received");
  const stockItems = onlineOrderStockItems(stock);
  const lost = filteredOrders.filter((order) => order.status === "Lost");
  const completed = filteredOrders.filter((order) => isOnlineOrderCompleted(order));
  const completedVisible = completed.filter((order) => order.status !== "Lost");
  const stats = onlineOrderStatsSnapshot(filteredOrders, ordered, transit, stockItems, completed);
  $("onlineOrderStats").innerHTML = renderOnlineOrderStatsCards(stats);
  $("onlineOrderStatsDetail").innerHTML = renderOnlineOrderStatsDetail(filteredOrders, ordered, transit, stockItems, completed, stats);
  $("onlineOrderModelSummary").innerHTML = renderOnlineOrderModelSummary(ordered, transit, stockItems);
  $("onlineOrdersPlacedList").innerHTML = renderOnlineOrderCompactList(ordered, "No pending online orders.");
  $("onlineOrdersTransitList").innerHTML = renderOnlineOrderTransitList(transit);
  $("onlineOrdersStockList").innerHTML = renderOnlineOrderModelGroups(stockItems, "No received online orders in stock.");
  $("onlineOrdersInvoicesList").innerHTML = renderOnlineOrderInvoicesList(phoneOnlineOrderInvoices);
  $("onlineOrdersAddressList").innerHTML = renderOnlineOrderAddressList(filteredOrders);
  $("onlineOrdersLostList").innerHTML = renderOnlineOrderLostList(lost);
  $("onlineOrdersCompletedList").innerHTML = renderOnlineOrderCompactList(completedVisible, "No completed online orders yet.");
  renderMonthlyTracker();
}

async function saveMonthlyTrackerEntry() {
  if (!$("financialEntryForm").reportValidity()) return;
  const button = $("saveMonthlyTrackerBtn");
  if (button.disabled) return;
  button.disabled = true;
  try {
  const result = await api(editingMonthlyTrackerId ? `/api/online-monthly-tracker/${editingMonthlyTrackerId}` : "/api/online-monthly-tracker", {
    method: editingMonthlyTrackerId ? "PATCH" : "POST",
    body: {
      month: $("monthlyTrackerMonth").value || localMonthInput(),
      entry_type: $("monthlyTrackerType").value,
      entry_date: $("monthlyTrackerDate").value,
      category: $("monthlyTrackerCategory").value.trim(),
      source: $("monthlyTrackerSource").value.trim(),
      phone_model: $("monthlyTrackerType").value === "Phone Profit" ? $("monthlyTrackerModel").value.trim() : "",
      quantity: $("monthlyTrackerType").value === "Phone Profit" ? Number($("monthlyTrackerQuantity").value || 1) : 1,
      amount: Number($("monthlyTrackerAmount").value || 0),
      description: $("monthlyTrackerDescription").value.trim(),
      notes: $("monthlyTrackerNotes").value.trim(),
    },
  });
  if (!result?.ok) return status("monthlyTrackerStatus", result?.error || "Could not add tracker entry.", "bad");
  editingMonthlyTrackerId = null;
  $("financialEntryDialog").close();
  ["monthlyTrackerAmount", "monthlyTrackerCategory", "monthlyTrackerSource", "monthlyTrackerModel", "monthlyTrackerDescription", "monthlyTrackerNotes"].forEach((id) => { $(id).value = ""; });
  $("monthlyTrackerQuantity").value = "1";
  $("monthlyTrackerDate").value = localTodayInput();
  status("monthlyTrackerStatus", "Tracker entry added.");
  await loadMonthlyTracker();
  } finally { button.disabled = false; }
}

async function saveOnlinePayable() {
  const result = await api("/api/online-payables", {
    method: "POST",
    body: {
      title: $("onlinePayableTitle").value.trim(),
      amount: Number($("onlinePayableAmount").value || 0),
      due_date: $("onlinePayableDueDate").value,
      category: $("onlinePayableCategory").value.trim(),
      payment_method: $("onlinePayableMethod").value.trim(),
      is_monthly: $("onlinePayableMonthly").checked,
      long_term_months: Number($("onlinePayableLongTermMonths").value || 0),
      long_term_balance: Number($("onlinePayableLongTermBalance").value || 0),
      notes: $("onlinePayableNotes").value.trim(),
    },
  });
  if (!result?.ok) return status("onlinePayableStatus", result?.error || "Could not add this payment.", "bad");
  ["onlinePayableTitle", "onlinePayableAmount", "onlinePayableCategory", "onlinePayableMethod", "onlinePayableNotes", "onlinePayableLongTermMonths", "onlinePayableLongTermBalance"].forEach((id) => { $(id).value = ""; });
  $("onlinePayableMonthly").checked = false;
  $("onlinePayableDueDate").value = localTodayInput();
  status("onlinePayableStatus", "Bill added.");
  if ($("financialAddBill")) $("financialAddBill").open = false;
  await loadOnlinePayables();
}

function renderOnlinePayables() {
  if (!onlineOrdersOnly || !$("onlinePayablesList")) return;
  if (!onlinePayablesLoaded) return;
  FinancialTracker.renderBills(onlinePayables, localTodayInput());
}

function renderLongTermBalances(items) {
  if (!items.length) return `<div class="empty">No long-term balances saved yet.</div>`;
  return `
    <div class="long-term-balance-list">
      ${items.map((item) => `
        <div class="long-term-balance-row">
          <div>
            <strong>${escapeHtml(item.title || "Balance")}</strong>
            <span>${money(item.amount)} / month${Number(item.long_term_months || 0) ? ` for ${Number(item.long_term_months)} months` : ""}</span>
            ${item.notes ? `<em>${escapeHtml(item.notes)}</em>` : ""}
          </div>
          <div>
            <small>Total Balance</small>
            <b>${money(longTermBalanceValue(item))}</b>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function longTermBalanceValue(item) {
  const savedBalance = Number(item.long_term_balance || 0);
  if (savedBalance > 0) return savedBalance;
  return Number(item.amount || 0) * Number(item.long_term_months || 0);
}

function renderPayableTable(items, emptyText) {
  if (!items.length) return `<div class="empty">${escapeHtml(emptyText)}</div>`;
  return `
    <div class="table-wrap">
      <table class="payables-table">
        <thead><tr><th>Due</th><th>What</th><th>Category</th><th>Method</th><th>Amount</th><th>Paid</th><th>Remaining</th><th>Status</th><th></th></tr></thead>
        <tbody>${items.map(renderPayableRow).join("")}</tbody>
      </table>
    </div>
  `;
}

function renderPayableRow(item) {
  const paid = item.status === "Paid";
  const remaining = payableRemaining(item);
  const payments = payablePayments(item);
  const paymentText = payments.length
    ? payments.slice(0, 3).map((payment) => `${formatDate(payment.payment_date || payment.created_at)} ${money(payment.amount)}`).join(" | ")
    : "";
  return `
    <tr>
      <td>${item.due_date ? formatDate(item.due_date) : ""}</td>
      <td><strong>${escapeHtml(item.title || "Payment")}</strong>${item.is_monthly ? `<span class="payable-monthly-pill">Monthly</span>` : ""}${item.notes ? `<em>${escapeHtml(item.notes)}</em>` : ""}${paymentText ? `<em>Payments: ${escapeHtml(paymentText)}</em>` : ""}</td>
      <td>${escapeHtml(item.category || "")}</td>
      <td>${escapeHtml(item.payment_method || "")}</td>
      <td><strong>${money(item.amount)}</strong></td>
      <td><strong class="profit-good">${money(payablePaidAmount(item))}</strong></td>
      <td><strong class="${remaining > 0 ? "profit-bad" : "profit-good"}">${money(remaining)}</strong></td>
      <td><span class="pill ${paid ? "sold" : "pending"}">${paid ? "Paid" : "Unpaid"}</span>${item.paid_at ? `<em>${formatDate(item.paid_at)}</em>` : ""}</td>
      <td class="payable-actions">
        ${remaining > 0 ? `<button class="mini-btn secondary" onclick="addOnlinePayablePartialPayment(${item.id})">Partial</button>` : ""}
        <button class="mini-btn ${paid ? "secondary" : "phone-btn"}" onclick="setOnlinePayableStatus(${item.id}, '${paid ? "Unpaid" : "Paid"}')">${paid ? "Mark Unpaid" : "Paid"}</button>
        <button class="mini-btn danger" onclick="deleteOnlinePayable(${item.id})">Delete</button>
      </td>
    </tr>
  `;
}

function payablePaidAmount(item) {
  if (item.status === "Paid" && Number(item.paid_amount || 0) === 0) return Number(item.amount || 0);
  return Number(item.paid_amount || 0);
}

function payableRemaining(item) {
  if (item.status === "Paid") return 0;
  if (item.balance_remaining !== undefined && item.balance_remaining !== null) return Number(item.balance_remaining || 0);
  return Math.max(0, Number(item.amount || 0) - payablePaidAmount(item));
}

function payablePayments(item) {
  return Array.isArray(item.payments) ? item.payments : [];
}

window.addOnlinePayablePartialPayment = async (id) => {
  const amountText = prompt("How much did you pay toward this bill?");
  if (amountText === null) return false;
  const amount = Number(String(amountText).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return alert("Enter a valid payment amount.");
  const paymentMethod = prompt("Payment method? Leave blank if none.") || "";
  const notes = prompt("Notes? Leave blank if none.") || "";
  const result = await api(`/api/online-payables/${id}/payments`, {
    method: "POST",
    body: { amount, payment_date: localTodayInput(), payment_method: paymentMethod.trim(), notes: notes.trim() },
  });
  if (!result?.ok) return alert(result?.error || "Could not add partial payment.");
  await loadOnlinePayables();
  return true;
};

window.setOnlinePayableStatus = async (id, nextStatus) => {
  const result = await api(`/api/online-payables/${id}/status`, { method: "PATCH", body: { status: nextStatus } });
  if (!result?.ok) return alert(result?.error || "Could not update this payment.");
  await loadOnlinePayables();
  return true;
};

window.deleteOnlinePayable = async (id) => {
  if (!confirm("Delete this payment from the list?")) return false;
  const result = await api(`/api/online-payables/${id}`, { method: "DELETE" });
  if (!result?.ok) return alert(result?.error || "Could not delete this payment.");
  await loadOnlinePayables();
  return true;
};

async function saveMonthlyTrackerSettings() {
  const result = await api("/api/online-monthly-tracker/settings", {
    method: "PATCH",
    body: {
      month: $("monthlyTrackerMonth").value || localMonthInput(),
      monthly_budget: Number($("monthlyTrackerBudget").value || 0),
      food_budget: Number($("monthlyTrackerFoodBudget").value || 0),
      notes: $("monthlyTrackerPlanNotes").value.trim(),
    },
  });
  if (!result?.ok) return status("monthlyTrackerSettingsStatus", result?.error || "Could not save monthly plan.", "bad");
  monthlyTrackerSettings = result.settings || defaultMonthlyTrackerSettings();
  fillMonthlyTrackerSettings();
  status("monthlyTrackerSettingsStatus", "Monthly plan saved.");
  renderMonthlyTracker();
}

function renderMonthlyTracker() {
  if (!onlineOrdersOnly || !$("monthlyTrackerStats")) return;
  if (!monthlyTrackerLoaded || !onlinePayablesLoaded) return;
  $("financialLoadStatus").textContent = "";
  const month = $("monthlyTrackerMonth")?.value || localMonthInput();
  FinancialTracker.render({ month, entries: monthlyTrackerEntries, history: monthlyTrackerHistory, bills: onlinePayables, settings: monthlyTrackerSettings, today: localTodayInput() });
}

function renderMonthlyCashFlowReport(entries, totals, orderSnapshot, month) {
  const settings = monthlyTrackerSettings || defaultMonthlyTrackerSettings(month);
  const monthlyBudget = Number(settings.monthly_budget || 0);
  const foodBudget = Number(settings.food_budget || 0);
  const foodSpent = monthlyTrackerFoodSpent(entries);
  const foodRemaining = foodBudget - foodSpent;
  const paidPayablesTotal = monthlyBillPaymentsTotal(month);
  const unpaidPayables = monthlyPayables(month, "Unpaid");
  const unpaidPayablesTotal = unpaidPayables.reduce((sum, item) => sum + payableRemaining(item), 0);
  const totalSpent = totals.expense + paidPayablesTotal;
  const cashFlow = totals.phoneProfit + totals.cashIn - totalSpent - totals.cashOut;
  const cashAfterPayables = cashFlow - unpaidPayablesTotal;
  const breakEvenRemaining = Math.max(0, monthlyBudget - totals.phoneProfit);
  const neededPerDay = monthlyBudget ? breakEvenRemaining / monthDays(month) : 0;
  const profitEntries = entries.filter((entry) => entry.entry_type === "Phone Profit");
  const expenseEntries = entries.filter((entry) => entry.entry_type === "Expense");
  const cashEntries = entries.filter((entry) => entry.entry_type === "Cash In" || entry.entry_type === "Cash Out");
  return `
    <section class="monthly-report">
      <div class="monthly-report-title">
        <div>
          <span>Cash Flow Tracker</span>
          <h3>${escapeHtml(monthLabel(month))}</h3>
        </div>
        <strong class="${cashFlow >= 0 ? "profit-good" : "profit-bad"}">${money(cashFlow)}</strong>
      </div>
      <div class="monthly-report-grid">
        ${renderMonthlyReportCard("Profit / Money Made", profitEntries, totals.phoneProfit, "No profit entered yet.", true)}
        ${renderMonthlyReportCard("Actual Money Spent", expenseEntries, totals.expense, "No spending entered yet.", false)}
      </div>
      <div class="monthly-plan-grid">
        <div class="monthly-report-card monthly-report-totals">
          <h4>Current Cash Flow</h4>
          <div><span>Profit</span><strong>${money(totals.phoneProfit + totals.cashIn)}</strong></div>
          <div><span>Tracker Spending</span><strong>${money(totals.expense + totals.cashOut)}</strong></div>
          <div><span>Paid From Pay List</span><strong>${money(paidPayablesTotal)}</strong></div>
          <div class="monthly-total-row"><span>Cash Flow</span><strong class="${cashFlow >= 0 ? "profit-good" : "profit-bad"}">${money(cashFlow)}</strong></div>
          ${cashEntries.length ? `<small>Includes ${cashEntries.length} cash in/out adjustment${cashEntries.length === 1 ? "" : "s"}.</small>` : ""}
        </div>
        <div class="monthly-report-card monthly-report-totals">
          <h4>Monthly Plan</h4>
          <div><span>Monthly Expenses / Budget</span><strong>${money(monthlyBudget)}</strong></div>
          <div><span>Profit Made</span><strong>${money(totals.phoneProfit)}</strong></div>
          <div><span>Remaining To Break Even</span><strong>${money(breakEvenRemaining)}</strong></div>
          <div class="monthly-total-row"><span>Needed Per Day</span><strong>${money(neededPerDay)}</strong></div>
          <small>${monthDays(month)} days in ${escapeHtml(monthLabel(month))}</small>
        </div>
        <div class="monthly-report-card monthly-report-totals">
          <h4>Bills</h4>
          <div><span>Unpaid Items</span><strong>${unpaidPayables.length}</strong></div>
          <div><span>Unpaid Total</span><strong>${money(unpaidPayablesTotal)}</strong></div>
          <div class="monthly-total-row"><span>Cash After Bills</span><strong class="${cashAfterPayables >= 0 ? "profit-good" : "profit-bad"}">${money(cashAfterPayables)}</strong></div>
        </div>
        <div class="monthly-report-card monthly-report-totals">
          <h4>Food Budget</h4>
          <div><span>Budget</span><strong>${money(foodBudget)}</strong></div>
          <div><span>Spent</span><strong>${money(foodSpent)}</strong></div>
          <div class="monthly-total-row"><span>Remaining</span><strong class="${foodRemainingClass(foodRemaining)}">${money(foodRemaining)}</strong></div>
        </div>
      </div>
    </section>
  `;
}

function renderMonthlyReportCard(title, rows, total, emptyText, positive) {
  return `
    <div class="monthly-report-card">
      <div class="monthly-report-card-head">
        <h4>${escapeHtml(title)}</h4>
        <strong class="${positive ? "profit-good" : "profit-bad"}">${positive ? "+" : "-"}${money(total).replace("-", "")}</strong>
      </div>
      <div class="monthly-report-lines">
        ${rows.length ? rows.map((entry) => {
          const detail = [entry.source, entry.phone_model].filter(Boolean).join(" - ") || entry.description || entry.category;
          const label = [entry.entry_date ? formatDate(entry.entry_date) : "", entry.category || entry.description || title].filter(Boolean).join(" - ");
          return `<div><span>${escapeHtml(label)}</span><em>${escapeHtml(detail || "")}</em><strong class="${positive ? "profit-good" : "profit-bad"}">${positive ? "+" : "-"}${money(entry.amount).replace("-", "")}</strong></div>`;
        }).join("") : `<p class="empty compact-empty">${escapeHtml(emptyText)}</p>`}
      </div>
      <div class="monthly-report-total"><span>Total</span><strong>${money(total)}</strong></div>
    </div>
  `;
}

function defaultMonthlyTrackerSettings(month = localMonthInput()) {
  return { entry_month: `${month}-01`, monthly_budget: 0, food_budget: 0, notes: "" };
}

function fillMonthlyTrackerSettings() {
  if (!$("monthlyTrackerBudget")) return;
  $("monthlyTrackerBudget").value = Number(monthlyTrackerSettings.monthly_budget || 0) || "";
  $("monthlyTrackerFoodBudget").value = Number(monthlyTrackerSettings.food_budget || 0) || "";
  $("monthlyTrackerPlanNotes").value = monthlyTrackerSettings.notes || "";
}

function monthlyPayables(month, statusValue) {
  const monthKey = String(month || localMonthInput());
  return onlinePayables.filter((item) => {
    if (statusValue === "Unpaid") return item.status !== "Paid";
    if (item.status !== statusValue) return false;
    const paidMonth = String(item.last_payment_at || item.paid_at || item.updated_at || "").slice(0, 7);
    return paidMonth === monthKey;
  });
}

function monthlyPayablesTotal(month, statusValue) {
  return monthlyPayables(month, statusValue).reduce((sum, item) => {
    if (statusValue === "Paid") return sum + payablePaidAmount(item);
    if (statusValue === "Unpaid") return sum + payableRemaining(item);
    return sum + Number(item.amount || 0);
  }, 0);
}

function monthlyBillPaymentsTotal(month) {
  const monthKey = String(month || localMonthInput());
  const paymentsTotal = onlinePayables.reduce((sum, item) => {
    const payments = payablePayments(item);
    return sum + payments.reduce((paymentSum, payment) => {
      const paymentMonth = String(payment.payment_date || payment.created_at || "").slice(0, 7);
      return paymentMonth === monthKey ? paymentSum + Number(payment.amount || 0) : paymentSum;
    }, 0);
  }, 0);
  const fallbackPaidTotal = onlinePayables.reduce((sum, item) => {
    if (payablePayments(item).length) return sum;
    const paidMonth = String(item.last_payment_at || item.paid_at || "").slice(0, 7);
    return paidMonth === monthKey ? sum + payablePaidAmount(item) : sum;
  }, 0);
  return paymentsTotal + fallbackPaidTotal;
}

function monthlyTrackerFoodSpent(entries) {
  return entries.reduce((sum, entry) => {
    if (entry.entry_type !== "Expense") return sum;
    const text = `${entry.category || ""} ${entry.source || ""} ${entry.description || ""}`.toLowerCase();
    return text.includes("food") || text.includes("popeyes") ? sum + Number(entry.amount || 0) : sum;
  }, 0);
}

function foodRemainingClass(value) {
  return value >= 0 ? "profit-good" : "profit-bad";
}

function monthDays(month) {
  const [year, monthNumber] = String(month || localMonthInput()).split("-").map(Number);
  return new Date(year || new Date().getFullYear(), monthNumber || 1, 0).getDate();
}

function monthLabel(month) {
  const [year, monthNumber] = String(month || localMonthInput()).split("-").map(Number);
  return new Date(year || new Date().getFullYear(), (monthNumber || 1) - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function monthlyTrackerTotals(entries) {
  return entries.reduce((totals, entry) => {
    const amount = Number(entry.amount || 0);
    const type = String(entry.entry_type || "");
    if (type === "Phone Profit") totals.phoneProfit += amount;
    if (type === "Expense") {
      totals.expense += amount;
      totals.expenseCount += 1;
    }
    if (type === "Cash In") totals.cashIn += amount;
    if (type === "Cash Out") totals.cashOut += amount;
    return totals;
  }, { phoneProfit: 0, expense: 0, expenseCount: 0, cashIn: 0, cashOut: 0 });
}

function monthlyTrackerOrderSnapshot(month) {
  const monthKey = String(month || localMonthInput());
  const soldInvoices = phoneOnlineOrderInvoices.filter((invoice) => invoice.status === "Sold" && String(invoice.sold_at || invoice.updated_at || invoice.created_at || "").slice(0, 7) === monthKey);
  const invoiceCost = soldInvoices.reduce((sum, invoice) => sum + onlineOrderInvoiceCost(invoice), 0);
  const invoiceValue = soldInvoices.reduce((sum, invoice) => sum + Number(invoice.sale_price || 0), 0);
  const completedOrders = phoneOnlineOrders.filter((order) => isOnlineOrderCompleted(order) && String(order.local_sold_at || order.gift_card_at || order.updated_at || order.created_at || "").slice(0, 7) === monthKey);
  const orderCost = completedOrders.reduce((sum, order) => sum + onlineOrderCompletedTotalCost(order), 0);
  const orderValue = completedOrders.reduce((sum, order) => {
    if (order.status === "Lost") return sum;
    if (order.status === "Sold Local") return sum + Number(order.local_sale_price || 0);
    if (order.status === "Gift Card") return sum + Number(order.gift_card_value || 0);
    return sum;
  }, 0);
  return {
    count: completedOrders.length + soldInvoices.length,
    cost: orderCost + invoiceCost,
    value: orderValue + invoiceValue,
    profit: orderValue + invoiceValue - orderCost - invoiceCost,
  };
}

function renderMonthlyTrackerRow(entry) {
  const type = String(entry.entry_type || "");
  const amount = Number(entry.amount || 0);
  const signedAmount = type === "Expense" || type === "Cash Out" ? -amount : amount;
  return `
    <tr>
      <td>${entry.entry_date ? formatDate(entry.entry_date) : ""}</td>
      <td><span class="monthly-type ${escapeAttr(type.toLowerCase().replace(/\s+/g, "-"))}">${escapeHtml(type)}</span></td>
      <td>${escapeHtml(entry.category || "")}</td>
      <td><strong>${escapeHtml(entry.phone_model || "")}</strong><span>${escapeHtml(entry.source || "")}</span></td>
      <td>${escapeHtml(entry.description || "")}${entry.notes ? `<em>${escapeHtml(entry.notes)}</em>` : ""}</td>
      <td>${entry.quantity || 1}</td>
      <td class="${signedAmount >= 0 ? "profit-good" : "profit-bad"}">${money(signedAmount)}</td>
      <td><button class="mini-btn danger" onclick="deleteMonthlyTrackerEntry(${entry.id})">Delete</button></td>
    </tr>
  `;
}

window.deleteMonthlyTrackerEntry = async (id) => {
  if (!confirm("Delete this tracker entry?")) return false;
  const result = await api(`/api/online-monthly-tracker/${id}`, { method: "DELETE" });
  if (!result?.ok) return alert(result?.error || "Could not delete tracker entry.");
  await loadMonthlyTracker();
  return true;
};

async function savePrepaidPort() {
  const result = await api("/api/phone-prepaid-ports", {
    method: "POST",
    body: {
      record_type: "Port Number",
      provider: $("prepaidPortProvider").value.trim(),
      port_number: $("prepaidPortNumber").value.trim(),
      account_number: $("prepaidPortAccount").value.trim(),
      pin: $("prepaidPortPin").value.trim(),
      cost: Number($("prepaidPortCost").value || 15),
      notes: $("prepaidPortNotes").value.trim(),
    },
  });
  if (!result?.ok) return status("prepaidPortStatus", result?.error || "Could not save port number.", "bad");
  ["prepaidPortNumber", "prepaidPortAccount", "prepaidPortPin", "prepaidPortNotes"].forEach((id) => { $(id).value = ""; });
  $("prepaidPortCost").value = "15";
  status("prepaidPortStatus", "Port number added.");
  await loadPrepaidPorts();
}

async function saveBulkPortNumbers() {
  const parsed = parseBulkPortNumbers($("bulkPortNumbers").value);
  if (parsed.errors.length) return status("bulkPortStatus", parsed.errors.join("<br>"), "bad");
  const provider = $("bulkPortProvider").value.trim() || "Port Number";
  const cost = Number($("bulkPortCost").value || 15);
  const notes = $("bulkPortNotes").value.trim();
  if (!parsed.records.length) return status("bulkPortStatus", "Paste at least one port number line.", "bad");
  if (!Number.isFinite(cost) || cost < 0) return status("bulkPortStatus", "Enter a valid cost each.", "bad");
  const result = await api("/api/phone-prepaid-ports/bulk-ports", {
    method: "POST",
    body: { provider, cost, notes, records: parsed.records },
  });
  if (!result?.ok) return status("bulkPortStatus", result?.error || "Could not save bulk port numbers.", "bad");
  $("bulkPortNumbers").value = "";
  $("bulkPortCost").value = "15";
  status("bulkPortStatus", `Added ${result.ports?.length || parsed.records.length} port numbers.`);
  await loadPrepaidPorts();
}

async function saveSinglePrepaidCard() {
  const result = await api("/api/phone-prepaid-ports", {
    method: "POST",
    body: {
      record_type: "Prepaid Card",
      provider: $("singlePrepaidProvider").value.trim() || "Prepaid Card",
      prepaid_card: $("prepaidCardNumber").value.trim(),
      pin: $("singlePrepaidPin").value.trim(),
      expiration_month: $("prepaidCardExpMonth").value.trim(),
      expiration_year: $("prepaidCardExpYear").value.trim(),
      cvv: $("prepaidCardCvv").value.trim(),
      cost: 0,
      notes: $("singlePrepaidNotes").value.trim(),
    },
  });
  if (!result?.ok) return status("singlePrepaidStatus", result?.error || "Could not save prepaid card.", "bad");
  ["prepaidCardNumber", "singlePrepaidPin", "prepaidCardExpMonth", "prepaidCardExpYear", "prepaidCardCvv", "singlePrepaidNotes"].forEach((id) => { $(id).value = ""; });
  status("singlePrepaidStatus", "Prepaid card added.");
  await loadPrepaidPorts();
}

async function saveBulkPrepaidCards() {
  const parsed = parseBulkPrepaidCards($("bulkPrepaidCards").value);
  if (parsed.errors.length) return status("bulkPrepaidStatus", parsed.errors.join("<br>"), "bad");
  const provider = $("bulkPrepaidProvider").value.trim() || "Prepaid Card";
  const notes = $("bulkPrepaidNotes").value.trim();
  if (!parsed.records.length) return status("bulkPrepaidStatus", "Paste at least one prepaid card line.", "bad");
  const result = await api("/api/phone-prepaid-ports/bulk", {
    method: "POST",
    body: {
      records: parsed.records.map((record) => ({ ...record, provider, cost: 0, notes })),
    },
  });
  if (!result?.ok) return status("bulkPrepaidStatus", result?.error || "Could not save bulk prepaid cards.", "bad");
  $("bulkPrepaidCards").value = "";
  status("bulkPrepaidStatus", `Added ${result.ports?.length || parsed.records.length} prepaid cards.`);
  await loadPrepaidPorts();
}

function parseBulkPortNumbers(value) {
  const errors = [];
  const text = String(value || "").trim();
  const chunks = text.match(/\[[^\]]+\]/g) || text.split(/\r?\n/).filter(Boolean);
  const records = chunks.map((chunk, index) => {
    const phoneMatch = chunk.match(/phone\s*#?\s*:\s*([0-9()\-\s.]+)/i);
    const accountMatch = chunk.match(/account\s*#?\s*:\s*([a-z0-9\-]+)/i);
    const pinMatch = chunk.match(/pin\s*:\s*([a-z0-9\-]+)/i);
    const portNumber = phoneMatch ? phoneMatch[1].replace(/\D/g, "") : "";
    const accountNumber = accountMatch ? accountMatch[1].trim() : "";
    const pin = pinMatch ? pinMatch[1].trim() : "";
    if (!/^\d{10,11}$/.test(portNumber)) errors.push(`Line ${index + 1}: phone number is missing or invalid.`);
    if (!accountNumber) errors.push(`Line ${index + 1}: account number is missing.`);
    if (!pin) errors.push(`Line ${index + 1}: PIN is missing.`);
    return { port_number: portNumber, account_number: accountNumber, pin };
  });
  return { records, errors };
}

function parseBulkPrepaidCards(value) {
  const errors = [];
  const records = String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parts = line.split(/\s+/);
      const card = (parts[0] || "").replace(/\D/g, "");
      const month = (parts[1] || "").replace(/\D/g, "").padStart(2, "0");
      const fullYear = (parts[2] || "").replace(/\D/g, "");
      const slashExp = parts.find((part) => /^\d{1,2}\/\d{2,4}$/.test(part));
      const cvv = (parts[parts.length - 1] || "").replace(/\D/g, "");
      let expMonth = month;
      let expYear = fullYear;
      if (slashExp) {
        const [slashMonth, slashYear] = slashExp.split("/");
        expMonth = slashMonth.replace(/\D/g, "").padStart(2, "0");
        expYear = slashYear.length === 2 ? `20${slashYear}` : slashYear;
      }
      if (!/^\d{12,19}$/.test(card)) errors.push(`Line ${index + 1}: card number is missing or invalid.`);
      if (!/^(0[1-9]|1[0-2])$/.test(expMonth)) errors.push(`Line ${index + 1}: expiration month is invalid.`);
      if (!/^\d{4}$/.test(expYear)) errors.push(`Line ${index + 1}: expiration year is invalid.`);
      if (!/^\d{3,4}$/.test(cvv)) errors.push(`Line ${index + 1}: CVV is missing or invalid.`);
      return { prepaid_card: card, expiration_month: expMonth, expiration_year: expYear, cvv };
    });
  return { records, errors };
}

function renderPrepaidPorts() {
  if (!$("prepaidPortList")) return;
  const ports = prepaidPortRecords.filter((record) => prepaidPortType(record) === "Port Number");
  const cards = prepaidPortRecords.filter((record) => prepaidPortType(record) === "Prepaid Card");
  const availablePorts = ports.filter((record) => prepaidPortUsableStatus(record) === "Available");
  const failedPorts = ports.filter((record) => prepaidPortUsableStatus(record) === "Failed");
  const expiredPorts = ports.filter((record) => prepaidPortUsableStatus(record) === "Expired");
  const usedPorts = ports.filter((record) => prepaidPortUsableStatus(record) === "Used");
  const availableCards = cards.filter((record) => prepaidPortUsableStatus(record) === "Available");
  const usedCards = cards.filter((record) => prepaidPortUsableStatus(record) === "Used");
  const failedCards = cards.filter((record) => prepaidPortUsableStatus(record) === "Failed");
  const totalCost = prepaidPortRecords.reduce((sum, record) => sum + Number(record.cost || 0), 0);
  $("prepaidPortStats").innerHTML = `
    <div class="stat"><span>Available Ports</span><strong>${availablePorts.length}</strong><em>ready for orders</em></div>
    <div class="stat"><span>Available Cards</span><strong>${availableCards.length}</strong><em>ready to use</em></div>
    <div class="stat"><span>Failed Ports</span><strong>${failedPorts.length}</strong><em>24 hour wait</em></div>
    <div class="stat"><span>Expired Ports</span><strong>${expiredPorts.length}</strong><em>older than 5 days</em></div>
    <div class="stat"><span>Used Records</span><strong>${usedPorts.length + usedCards.length}</strong><em>ports + cards</em></div>
    <div class="stat"><span>Total Cost</span><strong>${money(totalCost)}</strong><em>all records</em></div>
  `;
  $("prepaidPortList").innerHTML = `
    ${renderPrepaidPortGroup("Port Numbers Available", availablePorts, "No available port numbers.")}
    ${renderPrepaidPortGroup("Port Numbers Failed / Waiting 24 Hours", failedPorts, "No failed port numbers waiting.")}
    ${renderPrepaidPortGroup("Port Numbers Expired", expiredPorts, "No expired port numbers.")}
    ${renderPrepaidPortGroup("Port Numbers Used", usedPorts, "No used port numbers yet.")}
    ${renderPrepaidPortGroup("Prepaid Cards Available", availableCards, "No available prepaid cards.")}
    ${renderPrepaidPortGroup("Prepaid Cards Failed / Waiting 24 Hours", failedCards, "No failed prepaid cards waiting.")}
    ${renderPrepaidPortGroup("Prepaid Cards Used", usedCards, "No used prepaid cards yet.")}
  `;
}

function renderPrepaidPortGroup(title, records, emptyMessage) {
  return `
    <section class="prepaid-port-group">
      <div class="prepaid-port-group-head"><h3>${escapeHtml(title)}</h3><span>${records.length}</span></div>
      <div class="prepaid-port-rows">
        ${records.length ? records.map(renderPrepaidPortRow).join("") : `<div class="empty">${escapeHtml(emptyMessage)}</div>`}
      </div>
    </section>
  `;
}

function renderPrepaidPortRow(record) {
  const usableStatus = prepaidPortUsableStatus(record);
  const recordType = prepaidPortType(record);
  const waitLabel = usableStatus === "Failed" && record.usable_after ? `Usable after ${formatDateTime(record.usable_after)}` : "";
  const expiresLabel = recordType === "Port Number" && usableStatus === "Available" ? prepaidPortExpiresLabel(record) : "";
  return `
    <article class="prepaid-port-row ${escapeAttr(usableStatus.toLowerCase())}">
      <div>
        <strong>${escapeHtml(record.port_number || record.prepaid_card || `Record #${record.id}`)}</strong>
        <span>${escapeHtml([recordType, record.provider, record.account_number ? `Account: ${record.account_number}` : "", record.prepaid_card ? `Card: ${record.prepaid_card}` : "", prepaidCardExpiration(record), record.cvv ? `CVV: ${record.cvv}` : "", record.pin ? `PIN: ${record.pin}` : ""].filter(Boolean).join(" - "))}</span>
        ${record.notes ? `<em>${escapeHtml(record.notes)}</em>` : ""}
      </div>
      ${renderPrepaidMoneyBlock(record, recordType)}
      <div class="prepaid-port-status">
        <span class="pill ${usableStatus === "Available" ? "sold" : usableStatus === "Failed" ? "pending" : usableStatus === "Expired" ? "active" : "shipped"}">${escapeHtml(usableStatus)}</span>
        ${waitLabel ? `<small>${escapeHtml(waitLabel)}</small>` : ""}
        ${expiresLabel ? `<small>${escapeHtml(expiresLabel)}</small>` : ""}
      </div>
      <div class="phone-row-actions prepaid-port-actions">
        ${usableStatus !== "Used" ? `<button class="mini-btn" onclick="setPrepaidPortStatus(${record.id}, 'Used')">Used</button>` : ""}
        ${usableStatus !== "Failed" ? `<button class="mini-btn danger" onclick="setPrepaidPortStatus(${record.id}, 'Failed')">Failed</button>` : ""}
        ${usableStatus !== "Available" ? `<button class="mini-btn" onclick="setPrepaidPortStatus(${record.id}, 'Available')">Available</button>` : ""}
      </div>
    </article>
  `;
}

function prepaidPortUsableStatus(record) {
  return record.usable_status || record.status || "Available";
}

function prepaidPortType(record) {
  return record.display_type || record.record_type || (record.prepaid_card && !record.port_number ? "Prepaid Card" : "Port Number");
}

function renderPrepaidMoneyBlock(record, recordType) {
  const usedAmount = record.used_amount !== null && record.used_amount !== undefined && record.used_amount !== "" ? `<small>Used For</small><b>${money(record.used_amount)}</b>` : "";
  if (recordType === "Prepaid Card") {
    return `<div class="prepaid-port-money prepaid-card-value">${usedAmount || `<small>Value Used</small><b>-</b>`}</div>`;
  }
  return `
    <div class="prepaid-port-money">
      <small>Cost</small><b>${money(record.cost)}</b>
      ${usedAmount}
    </div>
  `;
}

function prepaidPortExpiresLabel(record) {
  const created = new Date(record.created_at);
  if (Number.isNaN(created.getTime())) return "";
  const expires = new Date(created);
  expires.setDate(expires.getDate() + 5);
  return `Good until ${formatDateTime(expires)}`;
}

function prepaidCardExpiration(record) {
  if (!record.expiration_month && !record.expiration_year) return "";
  const year = String(record.expiration_year || "").slice(-2);
  return `Exp: ${record.expiration_month || ""}/${year}`;
}

window.setPrepaidPortStatus = async (id, nextStatus) => {
  const record = prepaidPortRecords.find((entry) => Number(entry.id) === Number(id));
  let usedAmount = null;
  if (nextStatus === "Used" && prepaidPortType(record) === "Prepaid Card") {
    const amountInput = prompt("Amount used on this prepaid card?", record?.used_amount || "");
    if (amountInput === null) return false;
    usedAmount = String(amountInput || "").replace(/[$,\s]/g, "");
    if (!usedAmount || Number.isNaN(Number(usedAmount)) || Number(usedAmount) < 0) {
      alert("Enter a valid amount used.");
      return false;
    }
  }
  const note = nextStatus === "Failed" ? prompt("Why did it fail? Optional.", "") : "";
  if (note === null) return false;
  const result = await api(`/api/phone-prepaid-ports/${id}/status`, {
    method: "PATCH",
    body: { status: nextStatus, notes: note, used_amount: usedAmount },
  });
  if (!result?.ok) return alert(result?.error || "Could not update prepaid card / port number.");
  await loadPrepaidPorts();
  return true;
};

function onlineOrderStatsSnapshot(allOrders, ordered, transit, stockItems, completed) {
  const orderedCost = ordered.reduce((sum, order) => sum + onlineOrderTotalCost(order), 0);
  const transitCost = transit.reduce((sum, order) => sum + onlineOrderTotalCost(order), 0);
  const stockCost = stockItems.reduce((sum, order) => sum + onlineOrderTotalCost(order), 0);
  const openOnlineInvoices = phoneOnlineOrderInvoices.filter((invoice) => invoice.status === "Open");
  const openInvoiceItems = openOnlineInvoices.flatMap((invoice) => onlineOrderInvoiceStatsItems(invoice));
  const openInvoiceCost = openOnlineInvoices.reduce((sum, invoice) => sum + onlineOrderInvoiceCost(invoice), 0);
  const openInvoiceExpectedValue = onlineOrderExpectedValue(openInvoiceItems);
  const openInvoicePendingProfit = onlineOrderPendingProfit(openInvoiceItems);
  const soldOnlineInvoices = phoneOnlineOrderInvoices.filter((invoice) => invoice.status === "Sold");
  const soldOnlineInvoiceCost = soldOnlineInvoices.reduce((sum, invoice) => sum + onlineOrderInvoiceCost(invoice), 0);
  const soldOnlineInvoiceValue = soldOnlineInvoices.reduce((sum, invoice) => sum + Number(invoice.sale_price || 0), 0);
  const completedCost = completed.reduce((sum, order) => sum + onlineOrderCompletedTotalCost(order), 0) + soldOnlineInvoiceCost;
  const localSales = completed.reduce((sum, order) => sum + Number(order.local_sale_price || 0), 0);
  const giftCards = completed.reduce((sum, order) => sum + Number(order.gift_card_value || 0), 0);
  const lostCost = completed.filter((order) => order.status === "Lost").reduce((sum, order) => sum + onlineOrderCompletedTotalCost(order), 0);
  const completedValue = localSales + giftCards + soldOnlineInvoiceValue;
  const openItems = [...ordered, ...transit, ...stockItems];
  const openExpectedValue = openItems.reduce((sum, order) => {
    const expectedSale = onlineOrderExpectedSalePrice(order);
    return expectedSale === null ? sum : sum + expectedSale;
  }, 0) + openInvoiceExpectedValue;
  const openCost = orderedCost + transitCost + stockCost + openInvoiceCost;
  const pendingProfit = onlineOrderPendingProfit(openItems) + openInvoicePendingProfit;
  const completedProfit = completedValue - completedCost;
  const todayKey = localTodayInput();
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  sevenDaysAgo.setHours(0, 0, 0, 0);
  const todayOrders = allOrders.filter((order) => String(order.order_date || "").slice(0, 10) === todayKey);
  const weekOrders = allOrders.filter((order) => onlineOrderDateTime(order) >= sevenDaysAgo.getTime());
  return {
    totalOrders: allOrders.length,
    openPhoneCount: openItems.length + openInvoiceItems.length,
    orderedCount: ordered.length,
    transitCount: transit.length,
    stockCount: stockItems.length,
    completedCount: completed.length + soldOnlineInvoices.length,
    orderedCost,
    transitCost,
    stockCost,
    openInvoiceCount: openInvoiceItems.length,
    openInvoiceCost,
    openInvoiceExpectedValue,
    openInvoicePendingProfit,
    completedCost,
    openCost,
    openExpectedValue,
    pendingProfit,
    localSales,
    giftCards,
    soldOnlineInvoiceCost,
    soldOnlineInvoiceValue,
    lostCost,
    completedValue,
    completedProfit,
    todayCount: todayOrders.length,
    weekCount: weekOrders.length,
    totalCost: openCost + completedCost,
    totalValue: openExpectedValue + completedValue,
    totalProfit: pendingProfit + completedProfit,
    avgCompletedProfit: completed.length + soldOnlineInvoices.length ? completedProfit / (completed.length + soldOnlineInvoices.length) : 0,
  };
}

function renderOnlineOrderStatsCards(stats) {
  return `
    <div class="stat"><span>Open Phones</span><strong>${stats.openPhoneCount}</strong><em>${money(stats.openCost)} total cost</em></div>
    <div class="stat"><span>Ordered</span><strong>${stats.orderedCount}</strong><em>${money(stats.orderedCost)} not shipped</em></div>
    <div class="stat"><span>In Transit</span><strong>${stats.transitCount}</strong><em>${money(stats.transitCost)} shipped</em></div>
    <div class="stat"><span>In Stock</span><strong>${stats.stockCount}</strong><em>${money(stats.stockCost)} ready</em></div>
    <div class="stat"><span>Expected Open Value</span><strong>${money(stats.openExpectedValue)}</strong><em>16e $310 / A37 $200 / A17 $95</em></div>
    <div class="stat"><span>Pending Profit</span><strong class="${stats.pendingProfit >= 0 ? "profit-good" : "profit-bad"}">${profitMoney(stats.pendingProfit)}</strong><em>open expected profit</em></div>
    <div class="stat"><span>Completed Profit</span><strong class="${stats.completedProfit >= 0 ? "profit-good" : "profit-bad"}">${profitMoney(stats.completedProfit)}</strong><em>${money(stats.completedValue)} collected / ${money(stats.lostCost)} lost</em></div>
    <div class="stat"><span>All Profit</span><strong class="${stats.totalProfit >= 0 ? "profit-good" : "profit-bad"}">${profitMoney(stats.totalProfit)}</strong><em>open + completed</em></div>
  `;
}

function renderOnlineOrderStatsDetail(allOrders, ordered, transit, stockItems, completed, stats) {
  const statusRows = [
    { label: "Ordered", count: ordered.length, cost: stats.orderedCost, value: onlineOrderExpectedValue(ordered), profit: onlineOrderPendingProfit(ordered) },
    { label: "In Transit", count: transit.length, cost: stats.transitCost, value: onlineOrderExpectedValue(transit), profit: onlineOrderPendingProfit(transit) },
    { label: "In Stock", count: stockItems.length, cost: stats.stockCost, value: onlineOrderExpectedValue(stockItems), profit: onlineOrderPendingProfit(stockItems) },
    { label: "Open Invoices", count: stats.openInvoiceCount, cost: stats.openInvoiceCost, value: stats.openInvoiceExpectedValue, profit: stats.openInvoicePendingProfit },
    { label: "Sold Local", count: completed.filter((order) => order.status === "Sold Local").length, cost: completed.filter((order) => order.status === "Sold Local").reduce((sum, order) => sum + onlineOrderCompletedTotalCost(order), 0), value: stats.localSales, profit: stats.localSales - completed.filter((order) => order.status === "Sold Local").reduce((sum, order) => sum + onlineOrderCompletedTotalCost(order), 0) },
    { label: "Local Invoices", count: phoneOnlineOrderInvoices.filter((invoice) => invoice.status === "Sold").length, cost: stats.soldOnlineInvoiceCost, value: stats.soldOnlineInvoiceValue, profit: stats.soldOnlineInvoiceValue - stats.soldOnlineInvoiceCost },
    { label: "Gift Cards", count: completed.filter((order) => order.status === "Gift Card").length, cost: completed.filter((order) => order.status === "Gift Card").reduce((sum, order) => sum + onlineOrderCompletedTotalCost(order), 0), value: stats.giftCards, profit: stats.giftCards - completed.filter((order) => order.status === "Gift Card").reduce((sum, order) => sum + onlineOrderCompletedTotalCost(order), 0) },
    { label: "Lost Packages", count: completed.filter((order) => order.status === "Lost").length, cost: stats.lostCost, value: 0, profit: -stats.lostCost },
  ];
  return `
    <div class="online-order-stats-layout">
      <section class="online-order-stats-block">
        <h3>Money Summary</h3>
        <div class="online-order-ledger">
          <span><small>Total Cost Tracked</small><b>${money(stats.totalCost)}</b></span>
          <span><small>Total Value Tracked</small><b>${money(stats.totalValue)}</b></span>
          <span><small>Completed Orders</small><b>${stats.completedCount}</b></span>
          <span><small>Average Completed Profit</small><b class="${stats.avgCompletedProfit >= 0 ? "profit-good" : "profit-bad"}">${profitMoney(stats.avgCompletedProfit)}</b></span>
          <span><small>Orders Today</small><b>${stats.todayCount}</b></span>
          <span><small>Orders Last 7 Days</small><b>${stats.weekCount}</b></span>
        </div>
      </section>
      <section class="online-order-stats-block">
        <h3>Status Breakdown</h3>
        ${renderOnlineOrderStatsTable(statusRows)}
      </section>
      <section class="online-order-stats-block">
        <h3>Provider Breakdown</h3>
        ${renderOnlineOrderStatsTable(onlineOrderProviderStatsRows(allOrders))}
      </section>
    </div>
  `;
}

function renderOnlineOrderStatsTable(rows) {
  return `
    <div class="online-order-stats-table">
      <div class="online-order-stats-table-head"><span>Name</span><span>Phones</span><span>Cost</span><span>Value</span><span>Profit</span></div>
      ${rows.map((row) => `
        <div class="online-order-stats-table-row">
          <span>${escapeHtml(row.label)}</span>
          <span>${row.count}</span>
          <span>${money(row.cost)}</span>
          <span>${money(row.value)}</span>
          <span class="${row.profit >= 0 ? "profit-good" : "profit-bad"}">${profitMoney(row.profit)}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function onlineOrderProviderStatsRows(orders) {
  const groups = new Map();
  orders.forEach((order) => {
    const provider = onlineOrderProviderLabel(order.provider);
    const completed = isOnlineOrderCompleted(order);
    const items = order.status === "Received" ? onlineOrderStockItems([order]) : [order];
    const group = groups.get(provider) || { label: provider, count: 0, cost: 0, value: 0, profit: 0 };
    if (completed) {
      const value = order.status === "Lost" ? 0 : order.status === "Sold Local" ? Number(order.local_sale_price || 0) : Number(order.gift_card_value || 0);
      const cost = onlineOrderCompletedTotalCost(order);
      group.count += 1;
      group.cost += cost;
      group.value += value;
      group.profit += value - cost;
    } else {
      items.forEach((item) => {
        const expectedSale = onlineOrderExpectedSalePrice(item);
        const cost = onlineOrderTotalCost(item);
        group.count += 1;
        group.cost += cost;
        if (expectedSale !== null) {
          group.value += expectedSale;
          group.profit += expectedSale - cost;
        }
      });
    }
    groups.set(provider, group);
  });
  return Array.from(groups.values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function onlineOrderExpectedValue(orders) {
  return orders.reduce((sum, order) => sum + (onlineOrderExpectedSalePrice(order) || 0), 0);
}

function onlineOrderPendingProfit(orders) {
  return orders.reduce((sum, order) => {
    const expectedSale = onlineOrderExpectedSalePrice(order);
    return expectedSale === null ? sum : sum + expectedSale - onlineOrderTotalCost(order);
  }, 0);
}

function onlineOrderSearchResults(orders, searchTerm) {
  const tokens = onlineOrderSearchTokens(searchTerm);
  if (!tokens.length) return orders;
  return orders.filter((order) => {
    const haystack = onlineOrderSearchText(order);
    const digits = onlineOrderSearchDigits(order);
    return tokens.every((token) => haystack.includes(token.text) || (token.digits && digits.includes(token.digits)));
  });
}

function onlineOrderSearchTokens(value) {
  return String(value || "")
    .toLowerCase()
    .split(/\s+/)
    .map((text) => ({ text: text.trim(), digits: text.replace(/\D/g, "") }))
    .filter((token) => token.text);
}

function onlineOrderSearchText(order) {
  return [
    order.id,
    order.provider,
    order.order_number,
    order.phone_model,
    order.first_name,
    order.last_name,
    onlineOrderCustomerName(order),
    order.email,
    order.shipping_address,
    order.cc_used,
    order.phone_number,
    order.call_phone_number,
    order.account_pin,
    order.tracking_info,
    order.received_info,
    order.placed_at,
    order.status,
    order.local_sale_notes,
    order.gift_card_location,
    order.gift_card_notes,
    ...(onlineOrderLineItems(order).flatMap((line) => [line.id, line.phone_model, line.confirmation_number, line.payment_method, line.tracking_info, line.received_info, line.status, line.notes])),
  ].join(" ").toLowerCase();
}

function onlineOrderSearchDigits(order) {
  return [
    order.id,
    order.order_number,
    order.phone_number,
    order.call_phone_number,
    order.account_pin,
    order.tracking_info,
    order.received_info,
    order.shipping_address,
    order.email,
    order.cc_used,
    ...(onlineOrderLineItems(order).flatMap((line) => [line.id, line.phone_model, line.confirmation_number, line.payment_method, line.tracking_info, line.received_info, line.notes])),
  ].join(" ").replace(/\D/g, "");
}

function renderOnlineOrderAddressList(orders) {
  const groups = groupOnlineOrdersByAddress(orders);
  if (!groups.length) return `<div class="empty">No shipping addresses saved yet.</div>`;
  return groups.map((group) => `
    <details class="online-order-address-group">
      <summary>
        <div class="online-order-address-title">
          <strong>${escapeHtml(group.address)}</strong>
          <span>${group.total} total use${group.total === 1 ? "" : "s"}</span>
        </div>
        <div class="online-order-address-metrics">
          <span><small>Pending</small><b>${group.pending}</b></span>
          <span><small>In Transit</small><b>${group.transit}</b></span>
          <span><small>In Stock</small><b>${group.stock}</b></span>
          <span><small>Completed</small><b>${group.completed}</b></span>
        </div>
      </summary>
      <div class="online-order-address-orders">
        ${renderOnlineOrderAddressStatusBlock("Pending Orders", group.orders.filter((order) => order.status === "Ordered"))}
        ${renderOnlineOrderAddressStatusBlock("In Transit", group.orders.filter((order) => order.status === "Shipped"))}
        ${renderOnlineOrderAddressStatusBlock("Other Orders", group.orders.filter((order) => !["Ordered", "Shipped"].includes(order.status)))}
      </div>
    </details>
  `).join("");
}

function renderOnlineOrderAddressStatusBlock(title, orders) {
  if (!orders.length) return "";
  return `
    <div class="online-order-address-status-block">
      <h4>${escapeHtml(title)} <span>${orders.length}</span></h4>
      <div class="online-order-address-mini-list">
        ${orders.map(renderOnlineOrderAddressMiniRow).join("")}
      </div>
    </div>
  `;
}

function renderOnlineOrderAddressMiniRow(order) {
  const customerName = onlineOrderCustomerName(order);
  return `
    <div class="online-order-address-row">
      <div>
        <strong>${escapeHtml(order.phone_model || "No model saved")}</strong>
        <span>${escapeHtml([order.provider, order.order_number || `Order #${order.id}`, customerName].filter(Boolean).join(" - "))}</span>
      </div>
      <div>
        <b>${escapeHtml(order.status || "Ordered")}</b>
        <em>${formatDateTime(order.order_placed_at || order.created_at)}</em>
      </div>
    </div>
  `;
}

function groupOnlineOrdersByAddress(orders) {
  const groups = new Map();
  orders.forEach((order) => {
    const key = normalizeOnlineOrderAddress(order.shipping_address);
    if (!key) return;
    const group = groups.get(key) || { address: formatOnlineOrderAddress(order.shipping_address), orders: [], total: 0, pending: 0, transit: 0, stock: 0, completed: 0 };
    const formattedAddress = formatOnlineOrderAddress(order.shipping_address);
    if (formattedAddress && formattedAddress.length < group.address.length) group.address = formattedAddress;
    group.orders.push(order);
    group.total += 1;
    if (order.status === "Ordered") group.pending += 1;
    else if (order.status === "Shipped") group.transit += 1;
    else if (order.status === "Received") group.stock += 1;
    else group.completed += 1;
    groups.set(key, group);
  });
  return Array.from(groups.values())
    .map((group) => ({ ...group, orders: group.orders.slice().sort(sortOnlineOrdersNewestFirst) }))
    .sort((a, b) => (b.pending + b.transit) - (a.pending + a.transit) || b.total - a.total || a.address.localeCompare(b.address));
}

function normalizeOnlineOrderAddress(value) {
  let address = String(value || "").toLowerCase();
  address = address
    .replace(/[#]/g, " apt ")
    .replace(/[.,;:()\r\n]+/g, " ")
    .replace(/\b(united states|usa|us)\b/g, " ")
    .replace(/\b(florida|fl)\b/g, " ")
    .replace(/\b\d{5}(?:-\d{4})?\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!address) return "";

  const replacements = [
    [/\b(apartment|apt\.?|unit|suite|ste)\b/g, "apt"],
    [/\b(street|st\.?)\b/g, "st"],
    [/\b(avenue|ave\.?)\b/g, "ave"],
    [/\b(road|rd\.?)\b/g, "rd"],
    [/\b(drive|dr\.?)\b/g, "dr"],
    [/\b(lane|ln\.?)\b/g, "ln"],
    [/\b(court|ct\.?)\b/g, "ct"],
    [/\b(place|pl\.?)\b/g, "pl"],
    [/\b(boulevard|blvd\.?)\b/g, "blvd"],
    [/\b(terrace|ter\.?)\b/g, "ter"],
    [/\b(circle|cir\.?)\b/g, "cir"],
    [/\b(trail|trl\.?)\b/g, "trl"],
    [/\b(parkway|pkwy\.?)\b/g, "pkwy"],
    [/\b(highway|hwy\.?)\b/g, "hwy"],
    [/\b(north|n\.?)\b/g, "n"],
    [/\b(south|s\.?)\b/g, "s"],
    [/\b(east|e\.?)\b/g, "e"],
    [/\b(west|w\.?)\b/g, "w"],
  ];
  replacements.forEach(([pattern, replacement]) => {
    address = address.replace(pattern, replacement);
  });

  address = address.replace(/\s+/g, " ").trim();
  const start = address.match(/^(\d+[a-z]?)\s+(.+)$/);
  if (!start) return address;
  const tokens = start[2].split(" ");
  const aptIndex = tokens.findIndex((token) => token === "apt");
  const streetTokens = aptIndex >= 0 ? tokens.slice(0, aptIndex) : tokens;
  const aptToken = aptIndex >= 0 ? tokens[aptIndex + 1] || "" : "";
  const streetEnd = streetTokens.findIndex((token) => ["st", "ave", "rd", "dr", "ln", "ct", "pl", "blvd", "ter", "cir", "trl", "pkwy", "hwy", "way"].includes(token));
  const street = streetEnd >= 0 ? streetTokens.slice(0, streetEnd + 1).join(" ") : streetTokens.join(" ");
  return [start[1], street, aptToken ? `apt ${aptToken}` : ""].filter(Boolean).join(" ").trim();
}

function formatOnlineOrderAddress(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function renderOnlineOrderModelSummary(ordered, transit, stock) {
  const rows = [
    { label: "iPhone 16e", key: "iphone16e" },
    { label: "Samsung A37", key: "samsunga37" },
    { label: "Samsung A17", key: "samsunga17" },
  ].map((model) => {
    const pendingOrders = onlineOrdersByModel(ordered, model.key);
    const transitOrders = onlineOrdersByModel(transit, model.key);
    const stockOrders = onlineOrdersByModel(stock, model.key);
    const pendingCount = pendingOrders.length;
    const transitCount = transitOrders.length;
    const stockCount = stockOrders.length;
    const pendingProfit = [...pendingOrders, ...transitOrders, ...stockOrders].reduce((sum, order) => {
      const expectedSale = onlineOrderExpectedSalePrice(order);
      return expectedSale === null ? sum : sum + expectedSale - onlineOrderTotalCost(order);
    }, 0);
    return { ...model, pendingCount, transitCount, stockCount, total: pendingCount + transitCount + stockCount, pendingProfit };
  });
  const totalPending = rows.reduce((sum, row) => sum + row.pendingCount, 0);
  const totalTransit = rows.reduce((sum, row) => sum + row.transitCount, 0);
  const totalStock = rows.reduce((sum, row) => sum + row.stockCount, 0);
  const totalPendingProfit = rows.reduce((sum, row) => sum + row.pendingProfit, 0);
  return `
    <div class="online-order-model-head">
      <div>
        <h3>Phones Ordered By Model</h3>
        <p>Open phones for the models you are ordering: pending, in transit, and in stock.</p>
      </div>
      <strong>${totalPending + totalTransit + totalStock} open / ${profitMoney(totalPendingProfit)} open profit</strong>
    </div>
    <div class="online-order-model-grid">
      ${rows.map((row) => `
        <div class="online-order-model-card">
          <h4>${escapeHtml(row.label)}</h4>
          <span><small>Pending</small><b>${row.pendingCount}</b></span>
          <span><small>In Transit</small><b>${row.transitCount}</b></span>
          <span><small>In Stock</small><b>${row.stockCount}</b></span>
          <span><small>Open Profit</small><b class="${row.pendingProfit >= 0 ? "profit-good" : "profit-bad"}">${profitMoney(row.pendingProfit)}</b></span>
        </div>
      `).join("")}
      <div class="online-order-model-card total">
        <h4>All Models</h4>
        <span><small>Pending</small><b>${totalPending}</b></span>
        <span><small>In Transit</small><b>${totalTransit}</b></span>
        <span><small>In Stock</small><b>${totalStock}</b></span>
        <span><small>Open Profit</small><b class="${totalPendingProfit >= 0 ? "profit-good" : "profit-bad"}">${profitMoney(totalPendingProfit)}</b></span>
      </div>
    </div>
  `;
}

function countOnlineOrdersByModel(orders, modelKey) {
  return onlineOrdersByModel(orders, modelKey).length;
}

function onlineOrdersByModel(orders, modelKey) {
  return orders.filter((order) => onlineOrderModelKey(order.phone_model) === modelKey);
}

function onlineOrderModelKey(value) {
  const text = String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (text.includes("iphone16e") || text.includes("16e")) return "iphone16e";
  if (text.includes("samsunga17") || text.includes("galaxya17") || text.includes("a17")) return "samsunga17";
  if (text.includes("samsunga37") || text.includes("galaxya37") || text.includes("a37")) return "samsunga37";
  return "other";
}

function renderOnlineOrderProviderGroups(orders, emptyMessage = "No open online orders.") {
  if (!orders.length) return `<div class="empty">${escapeHtml(emptyMessage)}</div>`;
  return groupOnlineOrdersByProvider(orders).map((group) => `
    <details class="online-order-provider-group">
      <summary>
        <div class="online-order-provider-title">
          <strong>${escapeHtml(group.provider)}</strong>
          <span>${group.orders.length} order${group.orders.length === 1 ? "" : "s"}</span>
        </div>
        <div class="online-order-provider-metrics">
          <span><small>Total Cost</small><b>${money(group.cost)}</b></span>
          <span><small>Newest</small><b>${group.newest ? formatDate(group.newest) : "-"}</b></span>
        </div>
      </summary>
      <div class="online-order-provider-orders">
        ${group.orders.map(renderOnlineOrderCard).join("")}
      </div>
    </details>
  `).join("");
}

function renderOnlineOrderTransitList(orders) {
  return renderOnlineOrderCompactList(orders, "No shipped online orders in transit.", "In Transit");
}

function renderOnlineOrderLostList(orders) {
  if (!orders.length) return `<div class="empty">No lost packages yet.</div>`;
  const totalCost = orders.reduce((sum, order) => sum + onlineOrderCompletedTotalCost(order), 0);
  return `
    <div class="online-order-lost-summary">
      <span><small>Lost Packages</small><b>${orders.length}</b></span>
      <span><small>Total Loss</small><b class="profit-bad">${profitMoney(-totalCost)}</b></span>
    </div>
    ${renderOnlineOrderCompactList(orders, "No lost packages yet.", "Lost")}
  `;
}

function renderOnlineOrderInvoicesList(invoices) {
  if (!invoices.length) return `<div class="empty">No local invoices yet. Transfer received phones from In Stock to start one.</div>`;
  return invoices.map((invoice) => {
    const items = Array.isArray(invoice.items) ? invoice.items : [];
    const totalCost = onlineOrderInvoiceCost(invoice);
    const salePrice = invoice.sale_price === null || invoice.sale_price === undefined || invoice.sale_price === "" ? null : Number(invoice.sale_price);
    const profit = salePrice === null ? null : salePrice - totalCost;
    return `
      <details class="online-order-provider-group online-order-invoice-card" ${invoice.status === "Open" ? "open" : ""}>
        <summary>
          <div class="online-order-provider-title">
            <strong>${escapeHtml(invoice.label || `Invoice #${invoice.id}`)}</strong>
            <span>${items.length} phone${items.length === 1 ? "" : "s"} - ${escapeHtml(invoice.status || "Open")}</span>
          </div>
          <div class="online-order-provider-metrics">
            <span><small>Total Cost</small><b>${money(totalCost)}</b></span>
            <span><small>Sold For</small><b>${salePrice === null ? "-" : money(salePrice)}</b></span>
            <span><small>Profit</small><b class="${profit === null || profit >= 0 ? "profit-good" : "profit-bad"}">${profit === null ? "-" : profitMoney(profit)}</b></span>
          </div>
        </summary>
        <div class="online-order-provider-orders">
          <div class="phone-row-actions online-order-actions">
            ${invoice.status === "Open" ? `<button class="mini-btn danger" onclick="sellOnlineOrderInvoice(${invoice.id})">Sell</button>` : ""}
          </div>
          ${items.length ? items.map(renderOnlineOrderInvoiceItem).join("") : `<div class="empty">No phones on this invoice.</div>`}
        </div>
      </details>
    `;
  }).join("");
}

function renderOnlineOrderInvoiceItem(item) {
  const cost = onlineOrderInvoiceItemCost(item);
  const orderNumber = item.item_type === "line"
    ? item.confirmation_number || `Line #${item.id}`
    : item.order_number || `Order #${item.id}`;
  const customerName = [item.first_name, item.last_name].map((part) => String(part || "").trim()).filter(Boolean).join(" ");
  const parentOrderId = item.item_type === "line" ? item.online_order_id : item.id;
  return `
    <article class="online-order-card invoiced">
      <div class="online-order-main">
        <div>
          <span class="online-provider">${escapeHtml(item.item_type === "line" ? "Line Added" : item.provider || "Online Order")}</span>
          <h3>${escapeHtml(item.phone_model || "No model saved")}</h3>
          <p>${escapeHtml([orderNumber, customerName, item.email || ""].filter(Boolean).join(" - "))}</p>
        </div>
        <span class="pill shipped">Invoiced</span>
      </div>
      <div class="online-order-grid">
        <span><small>Cost</small><b>${money(cost)}</b></span>
        <span><small>Payment Method</small><b>${escapeHtml(item.payment_method || item.cc_used || "")}</b></span>
        <span><small>Order</small><b>${escapeHtml(item.parent_order_number || item.order_number || "")}</b></span>
        <span><small>Phone Number</small><b>${escapeHtml(item.phone_number || "")}</b></span>
        <span><small>Call Phone #</small><b>${escapeHtml(item.call_phone_number || "")}</b></span>
        <span><small>Account PIN</small><b>${escapeHtml(item.account_pin || "")}</b></span>
        <span><small>Email</small><b>${escapeHtml(item.email || "")}</b></span>
        <span><small>Where Placed</small><b>${escapeHtml(item.placed_at || "")}</b></span>
        <span><small>Tracking / Received</small><b>${renderTrackingLink(item.tracking_info || item.received_info || "")}</b></span>
      </div>
      <div class="online-order-address">${escapeHtml(item.shipping_address || "No shipping address saved")}</div>
      <div class="phone-row-actions online-order-actions">
        ${parentOrderId ? `<button class="mini-btn" onclick="addOnlineOrderLine(${parentOrderId})">Add Line</button>` : ""}
      </div>
    </article>
  `;
}

function onlineOrderInvoiceItemCost(item) {
  return Number(item.cost || 0) + Number(item.port_number_cost || 0);
}

function onlineOrderInvoiceCost(invoice) {
  return (invoice.items || []).reduce((sum, item) => sum + onlineOrderInvoiceItemCost(item), 0);
}

function onlineOrderInvoiceStatsItems(invoice) {
  return (invoice.items || []).map((item) => ({
    ...item,
    cost: onlineOrderInvoiceItemCost(item),
    port_number_cost: 0,
    status: invoice.status === "Sold" ? "Sold Local" : "Invoiced",
  }));
}

function renderOnlineOrderCompactList(orders, emptyMessage = "No online orders.", statusLabel = "") {
  if (!orders.length) return `<div class="empty">${escapeHtml(emptyMessage)}</div>`;
  return orders.slice().sort(sortOnlineOrdersNewestFirst).map((order) => renderOnlineOrderCompactItem(order, statusLabel)).join("");
}

function renderOnlineOrderCompactItem(order, statusLabel = "") {
  const customerName = onlineOrderCustomerName(order);
  const label = order.is_line_item && order.status === "Ordered" ? "LINE ADDED" : statusLabel || order.status || "Ordered";
  const value = onlineOrderOrderValue(order);
  const totalCost = isOnlineOrderCompleted(order) ? onlineOrderCompletedTotalCost(order) : onlineOrderTotalCost(order);
  const profit = value === null ? null : value - totalCost;
  const orderDate = order.order_date ? formatDate(order.order_date) : "";
  return `
    <details class="online-order-transit-item">
      <summary>
        <div class="online-order-row-summary">
          <div class="online-order-row-model">
            <strong>${escapeHtml(order.phone_model || "No model saved")}</strong>
            <span>${escapeHtml(order.provider || "Online Order")}</span>
          </div>
          <div class="online-order-row-info">
            <b>${escapeHtml(order.order_number || `Order #${order.id}`)}</b>
            <span>${escapeHtml([orderDate, customerName, order.email || ""].filter(Boolean).join(" - "))}</span>
          </div>
          <div class="online-order-row-address">${escapeHtml(order.shipping_address || "No shipping address saved")}</div>
          <div class="online-order-row-money">
            <span><small>Cost</small><b>${money(totalCost)}</b></span>
            <span><small>Profit</small><b class="${profit === null || profit >= 0 ? "profit-good" : "profit-bad"}">${profit === null ? "-" : profitMoney(profit)}</b></span>
          </div>
          <span class="pill ${onlineOrderStatusClass(order.status)}">${escapeHtml(label)}</span>
        </div>
      </summary>
      <div class="online-order-transit-details">
        ${renderOnlineOrderCard(order)}
      </div>
    </details>
  `;
}

function renderOnlineOrderModelGroups(orders, emptyMessage = "No online orders.") {
  if (!orders.length) return `<div class="empty">${escapeHtml(emptyMessage)}</div>`;
  return groupOnlineOrdersByStockModel(orders).map((group) => `
    <details class="online-order-provider-group online-order-model-group" open>
      <summary>
        <div class="online-order-provider-title">
          <strong>${escapeHtml(group.model)}</strong>
          <span>${group.orders.length} phone${group.orders.length === 1 ? "" : "s"} in stock</span>
        </div>
        <div class="online-order-provider-metrics">
          <span><small>Total Cost</small><b>${money(group.cost)}</b></span>
          <span><small>Pending Profit</small><b class="${group.profit >= 0 ? "profit-good" : "profit-bad"}">${profitMoney(group.profit)}</b></span>
        </div>
      </summary>
      <div class="online-order-provider-orders">
        ${group.orders.map((order) => renderOnlineOrderCompactItem(order)).join("")}
      </div>
    </details>
  `).join("");
}

function groupOnlineOrdersByProvider(orders) {
  const groups = new Map();
  orders.forEach((order) => {
    const provider = onlineOrderProviderLabel(order.provider);
    const group = groups.get(provider) || { provider, orders: [], cost: 0, newest: "" };
    group.orders.push(order);
    group.cost += onlineOrderTotalCost(order);
    const orderDate = order.order_date || order.created_at || "";
    if (isNewerOnlineOrderDate(orderDate, group.newest)) group.newest = orderDate;
    groups.set(provider, group);
  });
  const priority = ["Boost Mobile", "Metro PCS", "Cricket"];
  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      orders: group.orders.slice().sort(sortOnlineOrdersNewestFirst),
    }))
    .sort((a, b) => {
      const aIndex = priority.indexOf(a.provider);
      const bIndex = priority.indexOf(b.provider);
      if (aIndex !== -1 || bIndex !== -1) return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
      return a.provider.localeCompare(b.provider);
    });
}

function groupOnlineOrdersByStockModel(orders) {
  const groups = new Map();
  orders.forEach((order) => {
    const model = onlineOrderModelLabel(order.phone_model);
    const group = groups.get(model) || { model, key: onlineOrderModelKey(order.phone_model), orders: [], cost: 0, profit: 0 };
    const expectedSale = onlineOrderExpectedSalePrice(order);
    const totalCost = onlineOrderTotalCost(order);
    group.orders.push(order);
    group.cost += totalCost;
    if (expectedSale !== null) group.profit += expectedSale - totalCost;
    groups.set(model, group);
  });
  const priority = ["iphone16e", "samsunga37", "samsunga17"];
  return Array.from(groups.values())
    .map((group) => ({ ...group, orders: group.orders.slice().sort(sortOnlineOrdersNewestFirst) }))
    .sort((a, b) => {
      const aIndex = priority.indexOf(a.key);
      const bIndex = priority.indexOf(b.key);
      if (aIndex !== -1 || bIndex !== -1) return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
      return a.model.localeCompare(b.model);
    });
}

function onlineOrderProviderLabel(value) {
  const text = String(value || "Other").trim();
  if (/^boost/i.test(text)) return "Boost Mobile";
  if (/^metro/i.test(text)) return "Metro PCS";
  if (/^cricket/i.test(text)) return "Cricket";
  return text || "Other";
}

function sortOnlineOrdersNewestFirst(a, b) {
  const dateDiff = onlineOrderDateTime(b) - onlineOrderDateTime(a);
  if (dateDiff) return dateDiff;
  return Number(b.id || 0) - Number(a.id || 0);
}

function onlineOrderDateTime(order) {
  const value = order?.order_date || order?.created_at || "";
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function isNewerOnlineOrderDate(candidate, current) {
  if (!candidate) return false;
  if (!current) return true;
  const candidateTime = new Date(candidate).getTime();
  const currentTime = new Date(current).getTime();
  return Number.isFinite(candidateTime) && (!Number.isFinite(currentTime) || candidateTime > currentTime);
}

function renderOnlineOrderCard(order) {
  const isLineItem = Boolean(order.is_line_item);
  const completedOrder = isOnlineOrderCompleted(order);
  const value = order.status === "Lost" ? 0 : order.status === "Sold Local" ? Number(order.local_sale_price || 0) : order.status === "Gift Card" ? Number(order.gift_card_value || 0) : onlineOrderExpectedSalePrice(order);
  const totalCost = onlineOrderTotalCost(order);
  const profit = value === null ? null : value - totalCost;
  const profitLabel = completedOrder ? "Completed Profit" : "Pending Profit";
  const customerName = onlineOrderCustomerName(order);
  return `
    <article class="online-order-card ${escapeAttr(order.status || "Ordered").toLowerCase().replace(/\s+/g, "-")}">
      <div class="online-order-main">
        <div>
          <span class="online-provider">${escapeHtml(order.provider || "Online Order")}</span>
          <h3>${escapeHtml(order.phone_model || "No model saved")}</h3>
          <p>${escapeHtml([order.order_number || `Order #${order.id}`, order.order_date ? formatDate(order.order_date) : "", customerName, order.email || ""].filter(Boolean).join(" - "))}</p>
        </div>
        <span class="pill ${onlineOrderStatusClass(order.status)}">${escapeHtml(order.status || "Ordered")}</span>
      </div>
      <div class="online-order-grid">
        <span><small>Total Cost</small><b>${money(totalCost)}</b></span>
        <span><small>Port Cost</small><b>${money(order.port_number_cost)}</b></span>
        <span><small>Where Placed</small><b>${escapeHtml(order.placed_at || "")}</b></span>
        <span><small>Order Placed</small><b>${formatDateTime(order.order_placed_at || order.created_at)}</b></span>
        <span><small>Name</small><b>${escapeHtml(customerName)}</b></span>
        <span><small>Payment Method</small><b>${escapeHtml(order.cc_used || "")}</b></span>
        <span><small>Phone Number</small><b>${escapeHtml(order.phone_number || "")}</b></span>
        <span><small>Call Phone #</small><b>${escapeHtml(order.call_phone_number || "")}</b></span>
        <span><small>Account PIN</small><b>${escapeHtml(order.account_pin || "")}</b></span>
        <span><small>Tracking / Received</small><b>${renderTrackingLink(order.tracking_info || order.received_info || "")}</b></span>
        <span><small>Expected Sale</small><b>${value === null ? "-" : money(value)}</b></span>
        <span><small>${profitLabel}</small><b class="${profit === null || profit >= 0 ? "profit-good" : "profit-bad"}">${profit === null ? "-" : profitMoney(profit)}</b></span>
      </div>
      <div class="online-order-address">${escapeHtml(order.shipping_address || "No shipping address saved")}</div>
      ${isLineItem ? `<div class="online-order-result">Added line under ${escapeHtml(order.parent_order_label || "received order")}${order.confirmation_number ? ` - Confirmation #${escapeHtml(order.confirmation_number)}` : ""}.</div>` : ""}
      ${order.status === "Gift Card" ? `<div class="online-order-result">Gift Card: ${money(order.gift_card_value)}${order.gift_card_location ? ` - ${escapeHtml(order.gift_card_location)}` : ""}</div>` : ""}
      ${order.status === "Sold Local" ? `<div class="online-order-result">Sold Local: ${money(order.local_sale_price)}${order.local_sale_notes ? ` - ${escapeHtml(order.local_sale_notes)}` : ""}</div>` : ""}
      ${order.status === "Lost" ? `<div class="online-order-result online-order-lost-result">Lost Package: ${escapeHtml(order.received_info || "No note saved")}</div>` : ""}
      <div class="phone-row-actions online-order-actions">
        ${isLineItem ? `<button class="mini-btn" onclick="editOnlineOrderLine(${order.line_id})">Edit Line</button>` : ""}
        ${!isLineItem ? `<button class="mini-btn" onclick="startOnlineOrderEdit(${order.id})">Edit</button>` : ""}
        ${isLineItem && order.status === "Ordered" ? `<button class="mini-btn" onclick="markOnlineOrderLineShipped(${order.line_id})">Shipped</button>` : ""}
        ${isLineItem && order.status === "Shipped" ? `<button class="mini-btn" onclick="markOnlineOrderLineReceived(${order.line_id})">Received</button>` : ""}
        ${!isLineItem && order.status === "Ordered" ? `<button class="mini-btn" onclick="markOnlineOrderShipped(${order.id})">Shipped</button>` : ""}
        ${!isLineItem && order.status === "Shipped" ? `<button class="mini-btn" onclick="addOnlineOrderLine(${order.id})">Add Line</button><button class="mini-btn" onclick="markOnlineOrderReceived(${order.id})">Received</button><button class="mini-btn danger" onclick="markOnlineOrderLost(${order.id})">Lost</button>` : ""}
        ${isLineItem && (order.status === "Received" || order.status === "Line Added") ? `<button class="mini-btn" onclick="transferOnlineOrderLineToInvoice(${order.line_id})">Transfer to Invoice</button>` : ""}
        ${!isLineItem && order.status === "Received" ? `<button class="mini-btn" onclick="addOnlineOrderLine(${order.id})">Add Line</button><button class="mini-btn" onclick="transferOnlineOrderToInvoice(${order.id})">Transfer to Invoice</button>${onlineOrdersOnly ? "" : `<button class="mini-btn" onclick="moveOnlineOrderToGiftCard(${order.id})">Move to Gift Cards</button>`}` : ""}
      </div>
    </article>
  `;
}

function onlineOrderStatusClass(statusText) {
  if (statusText === "Lost") return "lost";
  if (statusText === "Shipped" || statusText === "Received" || statusText === "Line Added") return "shipped";
  if (statusText === "Sold Local" || statusText === "Gift Card") return "sold";
  return "pending";
}

function isOnlineOrderCompleted(order) {
  return ["Sold Local", "Gift Card", "Lost"].includes(order?.status);
}

function onlineOrderStockItems(stockOrders) {
  return stockOrders.flatMap((order) => [
    order,
    ...onlineOrderLineStatusItems([order], "Received", true),
  ]);
}

function onlineOrderLineStatusItems(orders, statusText, includeLegacyReceived = false) {
  return orders.flatMap((order) => onlineOrderLineItems(order)
    .filter((line) => {
      const lineStatus = line.status || "Line Added";
      return lineStatus === statusText || (includeLegacyReceived && statusText === "Received" && lineStatus === "Line Added");
    })
    .map((line) => ({
      ...order,
      id: `line-${line.id}`,
      line_id: line.id,
      parent_order_id: order.id,
      parent_order_label: order.order_number || `Order #${order.id}`,
      phone_model: line.phone_model,
      cc_used: line.payment_method || order.cc_used,
      payment_method: line.payment_method || "",
      cost: Number(line.cost || 0),
      line_cost: Number(line.cost || 0),
      port_number_cost: 0,
      status: line.status || "Line Added",
      created_at: line.created_at || order.created_at,
      order_placed_at: line.created_at || order.order_placed_at,
      order_number: line.confirmation_number || `${order.order_number || `Order #${order.id}`} / Line #${line.id}`,
      confirmation_number: line.confirmation_number || "",
      tracking_info: line.tracking_info || "",
      received_info: line.received_info || "",
      is_line_item: true,
    })));
}

function onlineOrderLineItems(order) {
  return Array.isArray(order?.line_items) ? order.line_items : [];
}

function onlineOrderCustomerName(order) {
  return [order.first_name, order.last_name].map((part) => String(part || "").trim()).filter(Boolean).join(" ");
}

function onlineOrderTotalCost(order) {
  return Number(order?.cost || 0) + Number(order?.port_number_cost || 0);
}

function onlineOrderCompletedTotalCost(order) {
  const lineCost = onlineOrderLineItems(order).reduce((sum, line) => sum + Number(line.cost || 0), 0);
  return onlineOrderTotalCost(order) + lineCost;
}

function onlineOrderExpectedSalePrice(order) {
  const key = onlineOrderModelKey(order?.phone_model);
  if (key === "iphone16e") return 310;
  if (key === "samsunga37") return 200;
  if (key === "samsunga17") return 95;
  return null;
}

function onlineOrderOrderValue(order) {
  if (order?.status === "Lost") return 0;
  if (order?.status === "Sold Local") return Number(order.local_sale_price || 0);
  if (order?.status === "Gift Card") return Number(order.gift_card_value || 0);
  return onlineOrderExpectedSalePrice(order);
}

function onlineOrderModelLabel(value) {
  const key = onlineOrderModelKey(value);
  if (key === "iphone16e") return "iPhone 16e";
  if (key === "samsunga37") return "Samsung A37";
  if (key === "samsunga17") return "Samsung A17";
  return String(value || "Other Model").trim() || "Other Model";
}

function renderTrackingLink(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const trackingNumber = trackingNumberFromText(raw);
  const url = trackingUrlForNumber(trackingNumber || raw);
  return `<a class="tracking-link" href="${escapeAttr(url)}" target="_blank" rel="noopener">${escapeHtml(raw)}</a>`;
}

function trackingNumberFromText(value) {
  const match = String(value || "").match(/\b(1Z[0-9A-Z]{16}|9[0-9]{21,33}|[0-9]{12,22}|[0-9]{20,34})\b/i);
  return match ? match[1].toUpperCase() : "";
}

function trackingUrlForNumber(value) {
  const clean = String(value || "").trim().replace(/\s+/g, "");
  if (/^1Z[0-9A-Z]{16}$/i.test(clean)) return `https://www.ups.com/track?tracknum=${encodeURIComponent(clean)}`;
  if (/^\d{12}$/.test(clean) || /^\d{15}$/.test(clean) || /^\d{20,22}$/.test(clean)) return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(clean)}`;
  if (/^9\d{21,33}$/.test(clean) || /^\d{20,34}$/.test(clean)) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(clean)}`;
  return `https://www.google.com/search?q=${encodeURIComponent(`${value} tracking`)}`;
}

window.startOnlineOrderEdit = (id) => {
  const order = phoneOnlineOrders.find((entry) => Number(entry.id) === Number(id));
  if (!order) return alert("Could not find this online order.");
  editingOnlineOrderId = Number(id);
  const providerOptions = ["Boost Mobile", "Metro PCS", "Cricket"];
  if (providerOptions.includes(order.provider)) {
    $("editOnlineOrderProvider").value = order.provider;
    $("editOnlineOrderOtherProvider").value = "";
  } else {
    $("editOnlineOrderProvider").value = "Other";
    $("editOnlineOrderOtherProvider").value = order.provider || "";
  }
  toggleEditOnlineOrderProvider();
  $("editOnlineOrderNumber").value = order.order_number || "";
  $("editOnlineOrderModel").value = order.phone_model || "";
  $("editOnlineOrderFirstName").value = order.first_name || "";
  $("editOnlineOrderLastName").value = order.last_name || "";
  $("editOnlineOrderDate").value = String(order.order_date || "").slice(0, 10) || localTodayInput();
  $("editOnlineOrderPlacedAt").value = order.placed_at || "";
  $("editOnlineOrderCard").value = order.cc_used || "";
  $("editOnlineOrderCost").value = order.cost || "";
  $("editOnlineOrderPortCost").value = order.port_number_cost || "";
  $("editOnlineOrderPhoneNumber").value = order.phone_number || "";
  $("editOnlineOrderCallPhoneNumber").value = order.call_phone_number || "";
  $("editOnlineOrderAccountPin").value = order.account_pin || "";
  $("editOnlineOrderEmail").value = order.email || "";
  $("editOnlineOrderAddress").value = order.shipping_address || "";
  $("editOnlineOrderTracking").value = order.tracking_info || order.received_info || "";
  $("editOnlineOrderPlacedTimestamp").value = order.order_placed_at ? new Date(order.order_placed_at).toISOString() : "";
  status("onlineOrderEditStatus", "");
  $("onlineOrderEditModal").classList.remove("hidden");
};

function toggleEditOnlineOrderProvider() {
  const isOther = $("editOnlineOrderProvider").value === "Other";
  $("editOnlineOrderOtherProviderWrap").classList.toggle("hidden", !isOther);
}

window.closeOnlineOrderEditModal = () => {
  editingOnlineOrderId = null;
  $("onlineOrderEditModal").classList.add("hidden");
  status("onlineOrderEditStatus", "");
};

async function saveOnlineOrderEdit() {
  if (!editingOnlineOrderId) return status("onlineOrderEditStatus", "No order selected.", "bad");
  const provider = $("editOnlineOrderProvider").value === "Other" ? $("editOnlineOrderOtherProvider").value.trim() : $("editOnlineOrderProvider").value;
  const paymentMethod = $("editOnlineOrderCard").value.trim();
  if (!paymentMethod) return status("onlineOrderEditStatus", "Enter the payment method before saving this order.", "bad");
  const result = await api(`/api/phone-online-orders/${editingOnlineOrderId}`, {
    method: "PATCH",
    body: {
      provider,
      order_number: $("editOnlineOrderNumber").value.trim(),
      phone_model: $("editOnlineOrderModel").value.trim(),
      first_name: $("editOnlineOrderFirstName").value.trim(),
      last_name: $("editOnlineOrderLastName").value.trim(),
      order_date: $("editOnlineOrderDate").value,
      placed_at: $("editOnlineOrderPlacedAt").value.trim(),
      shipping_address: $("editOnlineOrderAddress").value.trim(),
      cc_used: paymentMethod,
      cost: Number($("editOnlineOrderCost").value || 0),
      port_number_cost: Number($("editOnlineOrderPortCost").value || 0),
      phone_number: $("editOnlineOrderPhoneNumber").value.trim(),
      call_phone_number: $("editOnlineOrderCallPhoneNumber").value.trim(),
      account_pin: $("editOnlineOrderAccountPin").value.trim(),
      email: $("editOnlineOrderEmail").value.trim(),
      tracking_info: $("editOnlineOrderTracking").value.trim(),
      order_placed_at: $("editOnlineOrderPlacedTimestamp").value,
    },
  });
  if (!result?.ok) return status("onlineOrderEditStatus", result?.error || "Could not update this order.", "bad");
  closeOnlineOrderEditModal();
  await loadPhoneOnlineOrders();
  await loadPhoneOnlineOrderInvoices();
}

function renderInvoiceGroup(id, buyer, view) {
  const list = phoneInvoices.filter((invoice) => {
    if (invoice.buyer !== buyer) return false;
    return view === "Pending" ? invoice.status === "Pending" : invoice.status !== "Pending";
  });
  const summary = view === "Pending" && list.length ? renderPendingBuyerSummary(buyer, list) : "";
  $(id).innerHTML = summary + (list.map(renderPhoneInvoiceCard).join("") || `<div class="empty">No ${buyer} ${view.toLowerCase()} invoices yet.</div>`);
}

function renderPhoneHolding() {
  if (!$("phoneHoldingList")) return;
  const totalCost = phoneHoldingItems.reduce((sum, row) => sum + Number(row.quantity || 0) * Number(row.cost_each || 0), 0);
  const totalPhones = phoneHoldingItems.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  const tradeInItems = phoneHoldingItems.filter((row) => holdingTypeLabel(row.holding_type) === "Holding For Trade In");
  const saleItems = phoneHoldingItems.filter((row) => holdingTypeLabel(row.holding_type) === "Holding For Sale");
  $("phoneHoldingList").innerHTML = `
    <article class="pending-page-summary holding-summary">
      <div>
        <span>Holding</span>
        <strong>${money(totalCost)}</strong>
        <em>${totalPhones} phone${totalPhones === 1 ? "" : "s"} being held</em>
      </div>
      <div class="pending-page-metrics">
        <span><small>Trade In</small><b>${holdingGroupUnits(tradeInItems)}</b></span>
        <span><small>For Sale</small><b>${holdingGroupUnits(saleItems)}</b></span>
        <span><small>Total Cost</small><b>${money(totalCost)}</b></span>
        <span><small>Records</small><b>${phoneHoldingItems.length}</b></span>
      </div>
    </article>
    ${renderPhoneHoldingGroup("Holding For Trade In", tradeInItems)}
    ${renderPhoneHoldingGroup("Holding For Sale", saleItems)}
  `;
}

function renderPhoneHoldingGroup(title, items) {
  const totalCost = items.reduce((sum, row) => sum + Number(row.quantity || 0) * Number(row.cost_each || 0), 0);
  const totalPhones = holdingGroupUnits(items);
  const rows = items.map((row, index) => {
    const cost = Number(row.quantity || 0) * Number(row.cost_each || 0);
    const condition = row.condition_type === "New" ? `New${row.packaging ? ` - ${row.packaging}` : ""}` : row.grade || row.condition_type || "Used";
    return `
      <tr>
        <td><strong>${index + 1}</strong></td>
        <td class="phone-device-cell">
          <strong>${escapeHtml(row.model || "Phone")}</strong>
          <span>${escapeHtml(condition)}</span>
          ${row.imei ? `<em>IMEI ${escapeHtml(row.imei)}</em>` : ""}
          ${row.notes ? `<em>${escapeHtml(row.notes)}</em>` : ""}
        </td>
        <td>${escapeHtml(row.carrier || "")}</td>
        <td>${row.quantity || 1}</td>
        <td>${money(row.cost_each)}</td>
        <td>${money(cost)}</td>
        <td>${escapeHtml(row.placed_at || "")}</td>
        <td>${row.purchase_date ? formatDate(row.purchase_date) : ""}</td>
        <td><span class="pill pending">${escapeHtml(holdingTypeLabel(row.holding_type))}</span></td>
      </tr>
    `;
  }).join("");
  return `
    <article class="invoice-card phone-invoice-card holding-group-card">
      <div class="invoice-top">
        <div class="phone-invoice-title">
          <h3>${escapeHtml(title)}</h3>
          <p>${totalPhones} phone${totalPhones === 1 ? "" : "s"} - ${money(totalCost)} total cost</p>
        </div>
        <span class="pill pending">Holding</span>
      </div>
      ${items.length ? "" : `<div class="empty">No phones in ${escapeHtml(title)} yet.</div>`}
    <div class="table-wrap pending-table-wrap">
      <table class="phone-profit-table pending-phone-table holding-phone-table">
        <thead><tr><th>#</th><th>Phone</th><th>Carrier</th><th>Qty</th><th>Cost Each</th><th>Total Cost</th><th>Source</th><th>Date</th><th>Status</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="9">No phones here yet.</td></tr>`}</tbody>
      </table>
    </div>
    </article>
  `;
}

function holdingTypeLabel(value) {
  return String(value || "").toLowerCase().includes("trade") ? "Holding For Trade In" : "Holding For Sale";
}

function holdingGroupUnits(items) {
  return items.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
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
    const returnStatuses = ["KT", "Atlas", "Returned", "Sold", "Holding"];
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
          ${statusValue === "Holding" ? "" : `<button class="mini-btn warning" onclick="moveManualReturnToHolding(${row.id})">Move to Holding</button>`}
        </td>
        <td class="${profit === null || profit >= 0 ? "profit-good" : "profit-bad"} return-profit">${profit === null ? "Not Sold" : profitMoney(profit)}</td>
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
        <div class="return-stat"><span>Profit / Loss</span><strong class="${totalLoss >= 0 ? "profit-good" : "profit-bad"}">${profitMoney(totalLoss)}</strong></div>
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

window.moveManualReturnToHolding = async (id) => {
  const holdingType = promptHoldingType();
  if (!holdingType) return false;
  const row = manualPhoneReturns.find((entry) => Number(entry.id) === Number(id));
  const label = row?.model || "this return";
  if (!confirm(`Move ${label} to ${holdingType}?`)) return false;
  const result = await api(`/api/phone-manual-returns/${id}/holding`, {
    method: "PATCH",
    body: { holding_type: holdingType },
  });
  if (!result?.ok) return alert(result?.error || "Could not move this return to Holding.");
  await loadManualPhoneReturns();
  await loadPhoneHolding();
  openPhoneTab("holding");
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

window.movePhoneReturnToHolding = async (id) => {
  const holdingType = promptHoldingType();
  if (!holdingType) return false;
  const purchase = phoneInvoices.flatMap((invoice) => invoice.returns || []).find((row) => Number(row.id) === Number(id));
  const label = purchase?.model || "this return";
  if (!confirm(`Move ${label} to ${holdingType}?`)) return false;
  const result = await api(`/api/phone-purchases/${id}/return-holding`, {
    method: "PATCH",
    body: { holding_type: holdingType },
  });
  if (!result?.ok) return alert(result?.error || "Could not move this return to Holding.");
  await loadPhoneInvoices();
  await loadPhoneHolding();
  openPhoneTab("holding");
  return true;
};

function promptHoldingType() {
  const choice = prompt("Move to Holding:\n1 = Holding For Trade In\n2 = Holding For Sale", "2");
  if (choice === null) return "";
  return String(choice || "").trim() === "1" || /trade/i.test(String(choice || "")) ? "Holding For Trade In" : "Holding For Sale";
}

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
        <td class="${profit === null || profit >= 0 ? "profit-good" : "profit-bad"}">${profit === null ? "Not Set" : profitMoney(profit)}</td>
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
        ${totalProfit === null ? "" : `<strong class="${totalProfit >= 0 ? "profit-good" : "profit-bad"}">Profit ${profitMoney(totalProfit)}</strong>`}
      </div>
    </article>
  `;
}

function renderGiftCards() {
  const rows = phoneInvoices.flatMap((invoice) => (invoice.gift_cards || []).map((row) => ({ ...row, invoice })))
    .sort((a, b) => new Date(a.gift_card_at || a.invoice_removed_at || a.created_at || 0) - new Date(b.gift_card_at || b.invoice_removed_at || b.created_at || 0) || Number(a.id || 0) - Number(b.id || 0));
  renderGiftCardCloseoutSummary(rows);
  if (!rows.length) {
    $("giftCardsList").innerHTML = `${renderAppleTradeInReference()}<div class="empty">No Apple gift card trade-ins yet.</div>`;
    return;
  }
  const cardNumbers = new Map(rows.map((row, index) => [row.id, index + 1]));
  const openRows = rows.filter((row) => !row.gift_card_closeout_invoice_id);
  const totalCost = rows.reduce((sum, row) => sum + phoneLineCost(row), 0);
  const totalValue = rows.reduce((sum, row) => sum + Number(row.gift_card_value || 0), 0);
  const totalProfit = totalValue - totalCost;
  const newest = rows[rows.length - 1];
  const newestDate = newest?.gift_card_at ? formatDate(newest.gift_card_at) : "None";
  const body = renderGiftCardRows(openRows, cardNumbers);
  const closeoutReports = renderGiftCardCloseoutReports(rows, cardNumbers);
  const weeklyReports = renderGiftCardWeeklyReports(rows, cardNumbers);
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
        <span><small>Profit</small><b class="${totalProfit >= 0 ? "profit-good" : "profit-bad"}">${profitMoney(totalProfit)}</b></span>
        <span><small>Latest Card</small><b>${newestDate}</b></span>
      </div>
      ${closeoutReports}
      ${weeklyReports}
      ${renderAppleTradeInReference()}
      <div class="gift-card-open-list">
        <h4>Current Open Gift Cards</h4>
        ${openRows.length ? `
          <div class="table-wrap">
            <table class="phone-profit-table gift-card-table">
              <thead><tr><th>GC #</th><th>Invoice Item #</th><th>Phone Traded In</th><th>Source</th><th>Location</th><th>From Invoice</th><th>Qty</th><th>Cost</th><th>Gift Card Value</th><th>Apple Est.</th><th>Profit</th><th>Date</th><th>Card Info</th></tr></thead>
              <tbody>${body}</tbody>
            </table>
          </div>
        ` : `<div class="empty">No open gift cards. Closed cards are inside their closeout invoices above.</div>`}
      </div>
    </article>
  `;
}

function renderGiftCardCloseoutSummary(rows) {
  if (!$("giftCardCloseoutSummary")) return;
  const openRows = rows.filter((row) => !row.gift_card_closeout_invoice_id);
  const totalCost = openRows.reduce((sum, row) => sum + phoneLineCost(row), 0);
  const totalValue = openRows.reduce((sum, row) => sum + Number(row.gift_card_value || 0), 0);
  const totalProfit = totalValue - totalCost;
  $("giftCardCloseoutSummary").innerHTML = openRows.length ? `
    <div class="gift-card-closeout-grid">
      <span><small>Current Open Cards</small><b>${openRows.length}</b></span>
      <span><small>Total Phones Cost</small><b>${money(totalCost)}</b></span>
      <span><small>Gift Card Value</small><b>${money(totalValue)}</b></span>
      <span><small>Profit</small><b class="${totalProfit >= 0 ? "profit-good" : "profit-bad"}">${profitMoney(totalProfit)}</b></span>
    </div>
  ` : `<div class="empty">No open gift cards to close out. New gift cards will start the next batch.</div>`;
  $("closeGiftCardBatchBtn").disabled = !openRows.length;
}

function renderGiftCardRows(rows, cardNumbers, options = {}) {
  const fieldContext = String(options.context || "main").replace(/[^a-z0-9_-]/gi, "");
  return rows.map((row) => {
    const cost = phoneLineCost(row);
    const value = Number(row.gift_card_value || 0);
    const profit = value - cost;
    const cardNumber = cardNumbers.get(row.id) || "";
    const invoiceItemLabel = phoneInvoiceItemNumber(row, cardNumber);
    const cardPhotoId = `giftCardPhoto${row.id}_${fieldContext}`;
    const receiptPhotoId = `giftCardReceipt${row.id}_${fieldContext}`;
    const receiptIsPdf = isPdfDataUrl(row.gift_card_receipt_data_url) || /\.pdf$/i.test(row.gift_card_receipt_file_name || "");
    const appleTrade = appleTradeInForModel(row.model);
    const appleDelta = appleTrade && appleTrade.value !== null ? value - appleTrade.value : null;
    const appleDeltaLabel = appleDelta === null ? "" : `<em class="${appleDelta >= 0 ? "profit-good" : "profit-bad"}">${appleDelta >= 0 ? "+" : ""}${profitMoney(appleDelta)} vs Apple</em>`;
    return `
      <tr>
        <td><strong class="gift-card-number">#${cardNumber}</strong></td>
        <td><strong>${escapeHtml(invoiceItemLabel)}</strong></td>
        <td class="phone-device-cell">
          <strong>${escapeHtml(row.model)}</strong>
          <span>${escapeHtml(phoneInvoiceItemCondition(row))}</span>
          ${row.imei ? `<em>IMEI ${escapeHtml(row.imei)}</em>` : ""}
          ${row.notes ? `<em>${escapeHtml(row.notes)}</em>` : ""}
        </td>
        <td>${escapeHtml(row.invoice?.buyer || row.buyer || "")}</td>
        <td>${escapeHtml(row.gift_card_location || "")}</td>
        <td>${escapeHtml(row.invoice?.label || `Invoice #${row.invoice_id}`)}</td>
        <td>${row.quantity}</td>
        <td>${money(cost)}</td>
        <td>${money(value)}</td>
        <td class="apple-estimate-cell">${renderAppleTradeInValue(appleTrade)}${appleDeltaLabel}</td>
        <td class="${profit >= 0 ? "profit-good" : "profit-bad"}">${profitMoney(profit)}</td>
        <td>${row.gift_card_at ? formatDate(row.gift_card_at) : ""}</td>
        <td>
          <div class="phone-row-actions gift-card-actions">
            <div class="gift-card-media">
              ${row.gift_card_photo_data_url ? `<button class="gift-card-thumb" onclick="openGiftCardImage(${row.id}, 'card')" title="View gift card"><img src="${escapeAttr(row.gift_card_photo_data_url)}" alt="Gift card"></button>` : `<span class="gift-card-empty">No card photo</span>`}
              ${row.gift_card_receipt_data_url ? (receiptIsPdf ? `<button class="gift-card-thumb gift-card-pdf" onclick="openGiftCardImage(${row.id}, 'receipt')" title="View receipt PDF">PDF<br>Receipt</button>` : `<button class="gift-card-thumb" onclick="openGiftCardImage(${row.id}, 'receipt')" title="View receipt"><img src="${escapeAttr(row.gift_card_receipt_data_url)}" alt="Receipt"></button>`) : `<span class="gift-card-empty">No receipt</span>`}
            </div>
            ${options.readonly ? "" : `<button class="mini-btn" onclick="editGiftCard(${row.id})">Edit</button>
            <label class="mini-file">Card<input id="${cardPhotoId}" type="file" accept="image/*"></label>
            <label class="mini-file">Receipt<input id="${receiptPhotoId}" type="file" accept="image/*,.pdf,application/pdf"></label>
            <button class="mini-btn" onclick="saveGiftCardDetails(${row.id}, '${escapeAttr(fieldContext)}')">Save</button>`}
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function renderGiftCardCloseoutReports(rows, cardNumbers) {
  const reports = buildGiftCardCloseoutReports(rows);
  if (!reports.length) return "";
  return `
    <section class="gift-card-closeout-reports">
      <div class="gift-card-weekly-head">
        <div>
          <h4>Gift Card Closeout Invoices</h4>
          <p>Manual batches for holding gift cards until you use them.</p>
        </div>
        <span>${reports.length} batch${reports.length === 1 ? "" : "es"}</span>
      </div>
      ${reports.map((report, index) => `
        <details class="gift-card-week-report gift-card-closeout-report" ${report.closed ? "" : "open"}>
          <summary>
            <strong>${escapeHtml(report.label)}</strong>
            <span>${report.rows.length} card${report.rows.length === 1 ? "" : "s"} - Value ${money(report.value)} - Profit ${profitMoney(report.profit)} - Click to view cards</span>
          </summary>
          <div class="gift-card-week-stats">
            <span><small>Status</small><b>${escapeHtml(report.closed ? "Closed" : "Current Open Batch")}</b></span>
            <span><small>Total Cards</small><b>${report.rows.length}</b></span>
            <span><small>Total Cost</small><b>${money(report.cost)}</b></span>
            <span><small>Gift Card Value</small><b>${money(report.value)}</b></span>
            <span><small>Profit</small><b class="${report.profit >= 0 ? "profit-good" : "profit-bad"}">${profitMoney(report.profit)}</b></span>
          </div>
          ${report.closed && report.invoiceId ? `<div class="gift-card-closeout-actions"><button class="mini-btn" onclick="openGiftCardCloseoutInvoice(${report.invoiceId})">Gift Card Invoice</button></div>` : ""}
          <div class="table-wrap">
            <table class="phone-profit-table gift-card-table">
              <thead><tr><th>GC #</th><th>Invoice Item #</th><th>Phone Traded In</th><th>Source</th><th>Location</th><th>From Invoice</th><th>Qty</th><th>Cost</th><th>Gift Card Value</th><th>Apple Est.</th><th>Profit</th><th>Date</th><th>Card Info</th></tr></thead>
              <tbody>${renderGiftCardRows(report.rows, cardNumbers, { context: `closeout-${report.key}` })}</tbody>
            </table>
          </div>
        </details>
      `).join("")}
    </section>
  `;
}

function buildGiftCardCloseoutReports(rows) {
  const closeoutInvoices = new Map(phoneInvoices.filter((invoice) => invoice.buyer === "Apple GC").map((invoice) => [Number(invoice.id), invoice]));
  const groups = new Map();
  rows.forEach((row) => {
    const closeoutId = Number(row.gift_card_closeout_invoice_id || 0);
    const key = closeoutId ? `closed-${closeoutId}` : "open";
    const invoice = closeoutInvoices.get(closeoutId);
    const report = groups.get(key) || {
      key,
      invoiceId: closeoutId || null,
      label: closeoutId ? invoice?.label || `Gift Card Closeout #${closeoutId}` : "Current Open Batch",
      closed: Boolean(closeoutId),
      closedAt: invoice?.closed_at || invoice?.created_at || "",
      rows: [],
      cost: 0,
      value: 0,
      profit: 0,
    };
    const cost = phoneLineCost(row);
    const value = Number(row.gift_card_value || 0);
    report.rows.push(row);
    report.cost += cost;
    report.value += value;
    report.profit += value - cost;
    groups.set(key, report);
  });
  return [...groups.values()]
    .map((report) => ({ ...report, rows: [...report.rows].sort((a, b) => giftCardReportDate(a) - giftCardReportDate(b) || Number(a.id || 0) - Number(b.id || 0)) }))
    .sort((a, b) => {
      if (a.closed !== b.closed) return a.closed ? 1 : -1;
      return new Date(b.closedAt || 0) - new Date(a.closedAt || 0);
    });
}

function renderGiftCardWeeklyReports(rows, cardNumbers) {
  const reports = buildGiftCardWeeklyReports(rows);
  if (!reports.length) return "";
  return `
    <section class="gift-card-weekly-reports">
      <div class="gift-card-weekly-head">
        <div>
          <h4>Weekly Closeout Reports</h4>
          <p>Each report ends Sunday and stays as its own gift-card accounting period.</p>
        </div>
        <span>${reports.length} week${reports.length === 1 ? "" : "s"}</span>
      </div>
      ${reports.map((report, index) => `
        <details class="gift-card-week-report">
          <summary>
            <strong>Week Ending ${formatDate(report.weekEnding)}</strong>
            <span>${report.rows.length} card${report.rows.length === 1 ? "" : "s"} - Value ${money(report.value)} - Profit ${profitMoney(report.profit)}</span>
          </summary>
          <div class="gift-card-week-stats">
            <span><small>Period</small><b>${formatDate(report.weekStart)} - ${formatDate(report.weekEnding)}</b></span>
            <span><small>Total Cards</small><b>${report.rows.length}</b></span>
            <span><small>Total Cost</small><b>${money(report.cost)}</b></span>
            <span><small>Gift Card Value</small><b>${money(report.value)}</b></span>
            <span><small>Profit</small><b class="${report.profit >= 0 ? "profit-good" : "profit-bad"}">${profitMoney(report.profit)}</b></span>
          </div>
          <div class="table-wrap">
            <table class="phone-profit-table gift-card-table">
              <thead><tr><th>GC #</th><th>Invoice Item #</th><th>Phone Traded In</th><th>Source</th><th>Location</th><th>From Invoice</th><th>Qty</th><th>Cost</th><th>Gift Card Value</th><th>Apple Est.</th><th>Profit</th><th>Date</th><th>Card Info</th></tr></thead>
              <tbody>${renderGiftCardRows(report.rows, cardNumbers, { context: `week-${localDateKey(report.weekEnding)}` })}</tbody>
            </table>
          </div>
        </details>
      `).join("")}
    </section>
  `;
}

function buildGiftCardWeeklyReports(rows) {
  const groups = new Map();
  rows.forEach((row) => {
    const end = giftCardWeekEnding(row.gift_card_at || row.invoice_removed_at || row.created_at);
    const key = localDateKey(end);
    const report = groups.get(key) || {
      weekEnding: end,
      weekStart: addDays(end, -6),
      rows: [],
      cost: 0,
      value: 0,
      profit: 0,
    };
    const cost = phoneLineCost(row);
    const value = Number(row.gift_card_value || 0);
    report.rows.push(row);
    report.cost += cost;
    report.value += value;
    report.profit += value - cost;
    groups.set(key, report);
  });
  return [...groups.values()]
    .map((report) => ({ ...report, rows: [...report.rows].sort((a, b) => giftCardReportDate(a) - giftCardReportDate(b) || Number(a.id || 0) - Number(b.id || 0)) }))
    .sort((a, b) => b.weekEnding - a.weekEnding);
}

function giftCardWeekEnding(value) {
  const date = giftCardReportDate({ gift_card_at: value });
  date.setDate(date.getDate() + ((7 - date.getDay()) % 7));
  return date;
}

function giftCardReportDate(row) {
  const value = row?.gift_card_at || row?.invoice_removed_at || row?.created_at || new Date();
  const text = String(value || "");
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date(value);
  if (Number.isNaN(date.getTime())) return new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDate(date) {
  if (date instanceof Date) return date.toLocaleDateString();
  const match = String(date || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString();
  return new Date(date).toLocaleDateString();
}

function formatDateTime(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], { month: "numeric", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function localTodayInput() {
  return localDateKey(new Date());
}

function localMonthInput() {
  return localTodayInput().slice(0, 7);
}

function renderAppleTradeInReference() {
  const rows = APPLE_TRADE_IN_VALUES.map((row) => `
    <tr>
      <td>${escapeHtml(row.model)}</td>
      <td>${row.value === null ? `<span class="trade-na">${escapeHtml(row.note || "Not eligible")}</span>` : money(row.value)}</td>
    </tr>
  `).join("");
  return `
    <details class="apple-trade-reference" open>
      <summary>Apple iPhone Trade-In Reference</summary>
      <p>Apple values are listed as up-to amounts and can change by condition, configuration, and eligibility.</p>
      <div class="table-wrap apple-trade-wrap">
        <table class="apple-trade-table">
          <thead><tr><th>iPhone Model</th><th>Apple Trade-In</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </details>
  `;
}

function appleTradeInForModel(model) {
  const key = appleTradeKey(model);
  if (!key) return null;
  return [...APPLE_TRADE_IN_VALUES]
    .sort((a, b) => appleTradeKey(b.model).length - appleTradeKey(a.model).length)
    .find((row) => key.includes(appleTradeKey(row.model))) || null;
}

function appleTradeKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\bapple\b/g, "")
    .replace(/\biphone\b/g, "")
    .replace(/\b\d+\s*(gb|tb)\b/g, "")
    .replace(/\b(unlocked|locked|carrier|at&t|clean|grade|new|sealed|open|used|parts)\b/g, "")
    .replace(/[()]/g, "")
    .replace(/\b3rd\b/g, "third")
    .replace(/\b2nd\b/g, "second")
    .replace(/\s+/g, " ")
    .trim();
}

function renderAppleTradeInValue(row) {
  if (!row) return `<span class="trade-na">N/A</span>`;
  if (row.value === null) return `<span class="trade-na">${escapeHtml(row.note || "Not eligible")}</span>`;
  return `<strong>${money(row.value)}</strong>`;
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
      gift_card_location: $("manualGiftCardLocation").value.trim(),
    },
  });
  if (!result?.ok) return status("manualGiftCardStatus", result?.error || "Could not add gift card.", "bad");
  $("manualGiftCardModel").value = "";
  $("manualGiftCardQuantity").value = "1";
  $("manualGiftCardLocation").value = "";
  $("manualGiftCardCost").value = "";
  $("manualGiftCardValue").value = "";
  $("manualGiftCardDate").value = localTodayInput();
  status("manualGiftCardStatus", `${result.count || 1} gift card${Number(result.count || 1) === 1 ? "" : "s"} added.`);
  await loadPhoneInvoices();
  openPhoneTab("giftCards");
}

window.editGiftCard = async (id) => {
  const row = phoneInvoices.flatMap((invoice) => invoice.gift_cards || []).find((entry) => Number(entry.id) === Number(id));
  if (!row) return alert("Gift card not found.");
  const model = prompt("Phone model", row.model || "");
  if (model === null) return false;
  const totalCost = prompt("Total Phones Cost", String(phoneLineCost(row) || ""));
  if (totalCost === null) return false;
  const giftCardValue = prompt("Gift Card Value", String(row.gift_card_value || ""));
  if (giftCardValue === null) return false;
  const giftCardDate = prompt("Gift Card Date", row.gift_card_at ? localDateKey(giftCardReportDate(row)) : localTodayInput());
  if (giftCardDate === null) return false;
  const location = prompt("Location", row.gift_card_location || "");
  if (location === null) return false;
  const notes = prompt("Notes", row.notes || "");
  if (notes === null) return false;
  const result = await api(`/api/phone-gift-cards/${id}`, {
    method: "PATCH",
    body: {
      model: model.trim(),
      total_cost: Number(totalCost || 0),
      gift_card_value: Number(giftCardValue || 0),
      gift_card_at: giftCardDate.trim(),
      gift_card_location: location.trim(),
      notes: notes.trim(),
    },
  });
  if (!result?.ok) return alert(result?.error || "Could not edit gift card.");
  await loadPhoneInvoices();
  openPhoneTab("giftCards");
  return true;
};

async function closeCurrentGiftCardBatch() {
  const rows = phoneInvoices.flatMap((invoice) => invoice.gift_cards || []);
  const openRows = rows.filter((row) => !row.gift_card_closeout_invoice_id);
  if (!openRows.length) {
    status("giftCardCloseoutStatus", "There are no open gift cards to close out.", "bad");
    return;
  }
  const totalValue = openRows.reduce((sum, row) => sum + Number(row.gift_card_value || 0), 0);
  const label = $("giftCardCloseoutLabel").value.trim();
  const notes = $("giftCardCloseoutNotes").value.trim();
  if (!confirm(`Close out ${openRows.length} gift card${openRows.length === 1 ? "" : "s"} totaling ${money(totalValue)} into one invoice?`)) return;
  status("giftCardCloseoutStatus", "Closing out current gift cards...");
  const result = await api("/api/phone-gift-cards/closeout", {
    method: "POST",
    body: { label, notes },
  });
  if (!result?.ok) {
    status("giftCardCloseoutStatus", result?.error || "Could not close out gift cards.", "bad");
    return;
  }
  $("giftCardCloseoutLabel").value = "";
  $("giftCardCloseoutNotes").value = "";
  status("giftCardCloseoutStatus", `Closed ${result.count} gift card${Number(result.count || 0) === 1 ? "" : "s"} into ${escapeHtml(result.invoice?.label || "a Gift Card invoice")}.`);
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
    const returnStatuses = ["KT", "Atlas", "Returned", "Sold", "Holding"];
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
          ${statusValue === "Holding" ? "" : `<button class="mini-btn warning return-status-save" onclick="movePhoneReturnToHolding(${row.id})">Move to Holding</button>`}
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
        <span class="${totals.profit === null || totals.profit >= 0 ? "profit-good" : "profit-bad"}"><small>Profit</small>${totals.profit === null ? "Not Set" : profitMoney(totals.profit)}</span>
        <strong>Open</strong>
      </button>
      <div id="pastInvoiceDetail${invoice.id}" class="past-invoice-detail hidden">
        ${renderPhoneInvoiceCard(invoice, { allowPastDelete: true })}
      </div>
    </article>
  `;
}

function renderPhoneInvoiceCard(invoice, options = {}) {
  const purchases = invoice.purchases || [];
  const { totalCost, units, salePrice } = invoiceTotals(invoice);
  const actualProfit = salePrice === null ? null : salePrice - totalCost;
  const canRemove = invoice.status === "Pending";
  const canReturn = salePrice === null;
  const isPending = invoice.status === "Pending";
  const canDeleteMistake = true;
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
        ${row.placed_at ? `<em>Placed at ${escapeHtml(row.placed_at)}</em>` : ""}
        ${row.imei ? `<em>IMEI ${escapeHtml(row.imei)}</em>` : ""}
        ${row.photo_data_url ? `<button class="phone-photo-link" onclick="openPhonePhoto(${row.id})">View photo</button>` : ""}
      </td>
      <td>${escapeHtml(row.carrier || "")}</td>
      <td>${row.quantity}</td>
      <td>${money(row.cost_each)}</td>
      <td><div class="phone-row-actions"><button class="mini-btn" onclick="startPhonePurchaseEdit(${row.id})">Edit</button>${canRemove ? `<button class="mini-btn" onclick="movePhonePurchaseToInvoice(${row.id})">Move</button>` : ""}${canRemove ? `<button class="mini-btn" onclick="movePhonePurchaseToHolding(${row.id})">Hold</button>` : ""}${canRemove ? `<button class="mini-btn" onclick="movePhonePurchaseToGiftCard(${row.id})">Move to GC</button>` : ""}${canReturn ? `<button class="mini-btn warning" onclick="returnPhonePurchaseToKt(${row.id})">Return</button>` : ""}${canRemove ? `<button class="mini-btn danger" onclick="removePhonePurchaseFromInvoice(${row.id})">Locally Sold</button>` : ""}${canDeleteMistake ? `<button class="mini-btn danger" onclick="deletePhonePurchaseFromPastInvoice(${row.id})">Delete</button>` : ""}</div></td>
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
        ${row.placed_at ? `<em>Placed at ${escapeHtml(row.placed_at)}</em>` : ""}
        ${row.imei ? `<em>IMEI ${escapeHtml(row.imei)}</em>` : ""}
        ${row.notes ? `<em>${escapeHtml(row.notes)}</em>` : ""}
        ${row.photo_data_url ? `<button class="phone-photo-link" onclick="openPhonePhoto(${row.id})">View photo</button>` : ""}
      </td>
      <td>${escapeHtml(row.carrier || "")}</td>
      <td>${row.quantity}</td>
      <td>${money(row.cost_each)}</td>
      <td>${money(lineCost)}</td>
      <td>${phoneAddedDate(row)}</td>
      <td><div class="phone-row-actions"><button class="mini-btn" onclick="startPhonePurchaseEdit(${row.id})">Edit</button>${canRemove ? `<button class="mini-btn" onclick="movePhonePurchaseToInvoice(${row.id})">Move</button>` : ""}${canRemove ? `<button class="mini-btn" onclick="movePhonePurchaseToHolding(${row.id})">Hold</button>` : ""}${canRemove ? `<button class="mini-btn" onclick="movePhonePurchaseToGiftCard(${row.id})">Move to GC</button>` : ""}${canReturn ? `<button class="mini-btn warning" onclick="returnPhonePurchaseToKt(${row.id})">Return</button>` : ""}${canRemove ? `<button class="mini-btn danger" onclick="removePhonePurchaseFromInvoice(${row.id})">Locally Sold</button>` : ""}${canDeleteMistake ? `<button class="mini-btn danger" onclick="deletePhonePurchaseFromPastInvoice(${row.id})">Delete</button>` : ""}</div></td>
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
        ${actualProfit === null ? "" : `<strong class="${actualProfit >= 0 ? "profit-good" : "profit-bad"}">Actual Profit ${profitMoney(actualProfit)}</strong>`}
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
  $("phonePlacedAt").value = purchase.placed_at || "";
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
  const itemStart = Number(row.invoice_item_start || start || 1);
  return quantity > 1 ? `${itemStart}-${itemStart + quantity - 1}` : String(itemStart);
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
    <div class="stat"><span>Actual Profit</span><strong class="${totals.actualProfit >= 0 ? "profit-good" : "profit-bad"}">${profitMoney(totals.actualProfit)}</strong></div>
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
          <td class="${row.actualProfit >= 0 ? "profit-good" : "profit-bad"}">${profitMoney(row.actualProfit)}</td>
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
  return invoice?.buyer === "Apple GC";
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
    <div class="stat"><span>Gross Profit</span><strong class="${totalProfit >= 0 ? "profit-good" : "profit-bad"}">${profitMoney(totalProfit)}</strong></div>
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
    return `<rect x="${x - barWidth / 2}" y="${top}" width="${barWidth}" height="${barHeight}" rx="4" class="${point.profit >= 0 ? "profit-bar-good" : "profit-bar-bad"}"><title>#${point.transactionNumber} ${point.reference || point.type} - ${point.date.toLocaleDateString()} profit ${profitMoney(point.profit)}</title></rect>`;
  }).join("");
  const dots = graphPoints.map((point, index) => `<circle cx="${xFor(index)}" cy="${yFor(point.runningProfit)}" r="5"><title>#${point.transactionNumber} running profit ${profitMoney(point.runningProfit)}</title></circle>`).join("");
  const ledgerRows = [...graphPoints].reverse().map((event) => `
    <tr>
      <td>${event.transactionNumber}</td>
      <td>${event.date.toLocaleDateString()}</td>
      <td><strong>${escapeHtml(event.reference || event.type)}</strong><em>${escapeHtml(event.type)}${event.buyer ? ` - ${escapeHtml(event.buyer)}` : ""}</em></td>
      <td>${escapeHtml(event.label)}</td>
      <td>${event.units}</td>
      <td>${money(event.sale)}</td>
      <td>${money(event.cost)}</td>
      <td class="${event.profit >= 0 ? "profit-good" : "profit-bad"}">${profitMoney(event.profit)}</td>
      <td class="${event.runningProfit >= 0 ? "profit-good" : "profit-bad"}">${profitMoney(event.runningProfit)}</td>
    </tr>
  `).join("");
  const finalPoint = graphPoints[graphPoints.length - 1];
  return `
    <div class="profit-chart-card">
      <div class="profit-chart-head">
        <div><strong>Transaction Profit Trend</strong><span>Each bar is one closed transaction. Gift cards are not combined by date.</span></div>
        <b class="${finalPoint.runningProfit >= 0 ? "profit-good" : "profit-bad"}">${profitMoney(finalPoint.runningProfit)}</b>
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
              <td class="${row.profit >= 0 ? "profit-good" : "profit-bad"}">${profitMoney(row.profit)}</td>
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

window.movePhonePurchaseToHolding = async (id) => {
  const holdingType = promptHoldingType();
  if (!holdingType) return false;
  const purchase = phoneInvoices.flatMap((invoice) => invoice.purchases || []).find((row) => Number(row.id) === Number(id));
  const label = purchase?.model || "this phone";
  if (!confirm(`Move ${label} to ${holdingType}? It will be removed from the active invoice.`)) return false;
  const result = await api(`/api/phone-purchases/${id}/holding`, {
    method: "PATCH",
    body: { holding_type: holdingType },
  });
  if (!result?.ok) {
    return alert(result?.error || "Could not move this phone to Holding.");
  }
  await loadPhoneInvoices();
  await loadPhoneHolding();
  openPhoneTab("holding");
  return true;
};

window.deletePhonePurchaseFromPastInvoice = async (id) => {
  const purchase = phoneInvoices.flatMap((invoice) => invoice.purchases || []).find((row) => Number(row.id) === Number(id));
  const label = purchase?.model || "this phone";
  if (!confirm(`Delete ${label} from this past invoice? This is only for items added by mistake.`)) return false;
  const result = await api(`/api/phone-purchases/${id}`, { method: "DELETE" });
  if (!result?.ok) return alert(result?.error || "Could not delete this item.");
  await loadPhoneInvoices();
  openPhoneTab("pastInvoices");
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
  const locationInput = prompt("Gift card location? Example: Apple Store, Apple Online, Best Buy");
  if (locationInput === null) return false;
  const result = await api(`/api/phone-purchases/${id}/gift-card`, {
    method: "PATCH",
    body: {
      gift_card_value: cleanValue,
      gift_card_notes: "Apple trade-in gift card",
      gift_card_location: locationInput.trim(),
    },
  });
  if (!result?.ok) {
    return alert(result?.error || "Could not move this item to gift cards.");
  }
  await loadPhoneInvoices();
  openPhoneTab("giftCards");
  return true;
};

window.markOnlineOrderReceived = async (id) => {
  const existing = phoneOnlineOrders.find((order) => Number(order.id) === Number(id));
  const trackingInput = prompt("Tracking / what did you receive?", existing?.tracking_info || "");
  if (trackingInput === null) return false;
  const result = await api(`/api/phone-online-orders/${id}/received`, {
    method: "PATCH",
    body: {
      tracking_info: trackingInput.trim(),
      received_info: trackingInput.trim(),
    },
  });
  if (!result?.ok) return alert(result?.error || "Could not mark this order received.");
  await loadPhoneOnlineOrders();
  openOnlineOrderTab("stock");
  return true;
};

window.markOnlineOrderLineReceived = async (lineId) => {
  const line = onlineOrderLineStatusItems(phoneOnlineOrders, "Shipped")
    .find((item) => Number(item.line_id) === Number(lineId));
  if (!line) return alert("Could not find this shipped line.");
  const receivedInput = prompt("Received note for this added line?", line.tracking_info || "");
  if (receivedInput === null) return false;
  const result = await api(`/api/phone-online-order-lines/${lineId}/received`, {
    method: "PATCH",
    body: {
      received_info: receivedInput.trim(),
    },
  });
  if (!result?.ok) return alert(result?.error || "Could not mark this added line received.");
  await loadPhoneOnlineOrders();
  openOnlineOrderTab("stock");
  return true;
};

window.markOnlineOrderLineShipped = async (lineId) => {
  const line = onlineOrderLineStatusItems(phoneOnlineOrders, "Ordered")
    .find((item) => Number(item.line_id) === Number(lineId));
  if (!line) return alert("Could not find this pending line.");
  const trackingInput = prompt("Tracking number for this added line?", line.tracking_info || "");
  if (trackingInput === null) return false;
  const trackingNumber = trackingInput.trim();
  if (!trackingNumber) return alert("Enter the tracking number for this added line.");
  const result = await api(`/api/phone-online-order-lines/${lineId}/shipped`, {
    method: "PATCH",
    body: {
      tracking_info: trackingNumber,
    },
  });
  if (!result?.ok) return alert(result?.error || "Could not mark this added line shipped.");
  await loadPhoneOnlineOrders();
  openOnlineOrderTab("transit");
  return true;
};

window.markOnlineOrderShipped = async (id) => {
  const existing = phoneOnlineOrders.find((order) => Number(order.id) === Number(id));
  const trackingInput = prompt("Tracking number or shipped note", existing?.tracking_info || "");
  if (trackingInput === null) return false;
  const result = await api(`/api/phone-online-orders/${id}/shipped`, {
    method: "PATCH",
    body: {
      tracking_info: trackingInput.trim(),
    },
  });
  if (!result?.ok) return alert(result?.error || "Could not mark this order shipped.");
  await loadPhoneOnlineOrders();
  openOnlineOrderTab("transit");
  return true;
};

window.markOnlineOrderLost = async (id) => {
  const existing = phoneOnlineOrders.find((order) => Number(order.id) === Number(id));
  const noteInput = prompt("Lost package note", existing?.tracking_info || existing?.received_info || "");
  if (noteInput === null) return false;
  const ok = confirm("Mark this in-transit package LOST? This will count the order cost as a loss in profits.");
  if (!ok) return false;
  const result = await api(`/api/phone-online-orders/${id}/lost`, {
    method: "PATCH",
    body: {
      lost_note: noteInput.trim(),
    },
  });
  if (!result?.ok) return alert(result?.error || "Could not mark this package lost.");
  await loadPhoneOnlineOrders();
  openOnlineOrderTab("completed");
  return true;
};

window.addOnlineOrderLine = async (id) => {
  const modelInput = prompt("Add line phone model:\n1 = iPhone 16e\n2 = Samsung A37\n3 = Samsung A17", "1");
  if (modelInput === null) return false;
  const cleanModel = String(modelInput || "").trim().toLowerCase();
  let phoneModel = "iPhone 16e";
  if (cleanModel === "2" || cleanModel.includes("a37")) phoneModel = "Samsung A37";
  if (cleanModel === "3" || cleanModel.includes("a17")) phoneModel = "Samsung A17";
  if (cleanModel.includes("samsung") && !cleanModel.includes("a17")) phoneModel = "Samsung A37";
  const quantityInput = prompt(`How many ${phoneModel} lines did you add?`, "1");
  if (quantityInput === null) return false;
  const quantity = Math.floor(Number(String(quantityInput || "").replace(/[^\d.]/g, "")));
  if (!Number.isFinite(quantity) || quantity < 1 || quantity > 100) {
    alert("Enter a valid quantity between 1 and 100.");
    return false;
  }
  const confirmationInput = prompt(`Confirmation number for the added ${phoneModel} line${quantity === 1 ? "" : "s"}?`);
  if (confirmationInput === null) return false;
  const confirmationNumber = String(confirmationInput || "").trim();
  if (!confirmationNumber) {
    alert("Enter the confirmation number for the added line.");
    return false;
  }
  const paymentInput = prompt(`Payment method for the added ${phoneModel} line${quantity === 1 ? "" : "s"}?`);
  if (paymentInput === null) return false;
  const paymentMethod = String(paymentInput || "").trim();
  if (!paymentMethod) {
    alert("Enter the payment method for the added line.");
    return false;
  }
  const costInput = prompt(`Your cost per ${phoneModel}?`);
  if (costInput === null) return false;
  const cleanCost = String(costInput || "").replace(/[$,\s]/g, "");
  if (!cleanCost || Number.isNaN(Number(cleanCost)) || Number(cleanCost) < 0) {
    alert("Enter a valid line cost.");
    return false;
  }
  const result = await api(`/api/phone-online-orders/${id}/lines`, {
    method: "POST",
    body: {
      phone_model: phoneModel,
      confirmation_number: confirmationNumber,
      payment_method: paymentMethod,
      cost: cleanCost,
      quantity,
    },
  });
  if (!result?.ok) return alert(result?.error || "Could not add this line.");
  await loadPhoneOnlineOrders();
  openOnlineOrderTab("pending");
  return true;
};

window.editOnlineOrderLine = async (lineId) => {
  const line = [
    ...onlineOrderLineStatusItems(phoneOnlineOrders, "Ordered"),
    ...onlineOrderLineStatusItems(phoneOnlineOrders, "Received", true),
  ]
    .find((item) => Number(item.line_id) === Number(lineId));
  if (!line) return alert("Could not find this added line.");
  const modelInput = prompt("Line phone model:\n1 = iPhone 16e\n2 = Samsung A37\n3 = Samsung A17", line.phone_model || "iPhone 16e");
  if (modelInput === null) return false;
  const cleanModel = String(modelInput || "").trim().toLowerCase();
  let phoneModel = line.phone_model || "iPhone 16e";
  if (cleanModel === "1" || cleanModel.includes("16e") || cleanModel.includes("iphone")) phoneModel = "iPhone 16e";
  if (cleanModel === "2" || cleanModel.includes("a37")) phoneModel = "Samsung A37";
  if (cleanModel === "3" || cleanModel.includes("a17")) phoneModel = "Samsung A17";
  if (cleanModel.includes("samsung") && !cleanModel.includes("a17")) phoneModel = "Samsung A37";

  const confirmationInput = prompt(`Confirmation number for this ${phoneModel} line?`, line.confirmation_number || "");
  if (confirmationInput === null) return false;
  const confirmationNumber = String(confirmationInput || "").trim();
  if (!confirmationNumber) {
    alert("Enter the confirmation number for this line.");
    return false;
  }

  const paymentInput = prompt(`Payment method for this ${phoneModel} line?`, line.payment_method || line.cc_used || "");
  if (paymentInput === null) return false;
  const paymentMethod = String(paymentInput || "").trim();
  if (!paymentMethod) {
    alert("Enter the payment method for this line.");
    return false;
  }

  const costInput = prompt(`Your cost for this ${phoneModel} line?`, String(line.line_cost ?? line.cost ?? ""));
  if (costInput === null) return false;
  const cleanCost = String(costInput || "").replace(/[$,\s]/g, "");
  if (!cleanCost || Number.isNaN(Number(cleanCost)) || Number(cleanCost) < 0) {
    alert("Enter a valid line cost.");
    return false;
  }

  const result = await api(`/api/phone-online-order-lines/${lineId}`, {
    method: "PATCH",
    body: {
      phone_model: phoneModel,
      confirmation_number: confirmationNumber,
      payment_method: paymentMethod,
      cost: cleanCost,
    },
  });
  if (!result?.ok) return alert(result?.error || "Could not update this added line.");
  await loadPhoneOnlineOrders();
  openOnlineOrderTab("stock");
  return true;
};

window.transferOnlineOrderToInvoice = async (id) => {
  const labelInput = prompt("Invoice name? Leave blank to use the current open invoice.", "");
  if (labelInput === null) return false;
  const result = await api(`/api/phone-online-orders/${id}/invoice`, {
    method: "PATCH",
    body: { label: labelInput.trim() },
  });
  if (!result?.ok) return alert(result?.error || "Could not transfer this order to an invoice.");
  await loadPhoneOnlineOrders();
  await loadPhoneOnlineOrderInvoices();
  openOnlineOrderTab("invoices");
  return true;
};

window.transferOnlineOrderLineToInvoice = async (lineId) => {
  const labelInput = prompt("Invoice name? Leave blank to use the current open invoice.", "");
  if (labelInput === null) return false;
  const result = await api(`/api/phone-online-order-lines/${lineId}/invoice`, {
    method: "PATCH",
    body: { label: labelInput.trim() },
  });
  if (!result?.ok) return alert(result?.error || "Could not transfer this line to an invoice.");
  await loadPhoneOnlineOrders();
  await loadPhoneOnlineOrderInvoices();
  openOnlineOrderTab("invoices");
  return true;
};

window.sellOnlineOrderInvoice = async (id) => {
  const invoice = phoneOnlineOrderInvoices.find((item) => Number(item.id) === Number(id));
  const saleInput = prompt(`Amount sold for ${invoice?.label || `Invoice #${id}`}?`, "");
  if (saleInput === null) return false;
  const cleanSale = String(saleInput || "").replace(/[$,\s]/g, "");
  if (!cleanSale || Number.isNaN(Number(cleanSale)) || Number(cleanSale) < 0) {
    alert("Enter a valid invoice sale amount.");
    return false;
  }
  const notesInput = prompt("Sale notes? Example: Facebook, cash, buyer name", invoice?.sale_notes || "");
  if (notesInput === null) return false;
  const result = await api(`/api/phone-online-order-invoices/${id}/sell`, {
    method: "PATCH",
    body: {
      sale_price: cleanSale,
      sale_notes: notesInput.trim(),
    },
  });
  if (!result?.ok) return alert(result?.error || "Could not sell this invoice.");
  await loadPhoneOnlineOrderInvoices();
  openOnlineOrderTab("invoices");
  return true;
};

window.sellOnlineOrderLocal = async (id) => {
  const saleInput = prompt("Amount sold locally?");
  if (saleInput === null) return false;
  const cleanSale = String(saleInput || "").replace(/[$,\s]/g, "");
  if (!cleanSale || Number.isNaN(Number(cleanSale)) || Number(cleanSale) < 0) {
    alert("Enter a valid local sale amount.");
    return false;
  }
  const notesInput = prompt("Sale notes? Example: Facebook, cash, buyer name", "");
  if (notesInput === null) return false;
  const result = await api(`/api/phone-online-orders/${id}/local-sale`, {
    method: "PATCH",
    body: {
      sale_price: cleanSale,
      sale_notes: notesInput.trim(),
    },
  });
  if (!result?.ok) return alert(result?.error || "Could not mark this online order sold locally.");
  await loadPhoneOnlineOrders();
  openOnlineOrderTab("completed");
  return true;
};

window.moveOnlineOrderToGiftCard = async (id) => {
  const modelInput = prompt("Phone model for the gift card record? Example: iPhone 16 Pro Max 256GB");
  if (modelInput === null) return false;
  if (!modelInput.trim()) {
    alert("Enter the phone model.");
    return false;
  }
  const valueInput = prompt("Apple gift card value?");
  if (valueInput === null) return false;
  const cleanValue = String(valueInput || "").replace(/[$,\s]/g, "");
  if (!cleanValue || Number.isNaN(Number(cleanValue)) || Number(cleanValue) < 0) {
    alert("Enter the Apple gift card value.");
    return false;
  }
  const locationInput = prompt("Gift card location? Example: Apple Store, Apple Online, Best Buy");
  if (locationInput === null) return false;
  const notesInput = prompt("Gift card notes? Optional.", "");
  if (notesInput === null) return false;
  const result = await api(`/api/phone-online-orders/${id}/gift-card`, {
    method: "PATCH",
    body: {
      model: modelInput.trim(),
      gift_card_value: cleanValue,
      gift_card_location: locationInput.trim(),
      gift_card_notes: notesInput.trim(),
    },
  });
  if (!result?.ok) return alert(result?.error || "Could not move this online order to gift cards.");
  await loadPhoneOnlineOrders();
  await loadPhoneInvoices();
  openOnlineOrderTab("completed");
  return true;
};

window.saveGiftCardDetails = async (id, context = "main") => {
  const fieldContext = String(context || "main").replace(/[^a-z0-9_-]/gi, "");
  const cardFile = $(`giftCardPhoto${id}_${fieldContext}`)?.files?.[0] || null;
  const receiptFile = $(`giftCardReceipt${id}_${fieldContext}`)?.files?.[0] || null;
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
      const cleanText = String(text || "").trim();
      const isHtmlError = /<!doctype html|<html[\s>]/i.test(cleanText);
      data = {
        error: isHtmlError
          ? `Server error ${response.status}. Please try again in a minute.`
          : cleanText.slice(0, 500) || `Request failed with status ${response.status}`,
      };
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

window.openGiftCardCloseoutInvoice = (id) => {
  if (!id) return false;
  window.open(`/api/phone-gift-card-closeouts/${id}/html`, "_blank");
  return true;
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
  const headers = { "Content-Type": "application/json" };
  if (onlineOrdersOnly) headers["X-Online-Orders-Only"] = "1";
  const fetchOptions = {
    method: options.method || "GET",
    headers,
  };
  if (options.body) fetchOptions.body = JSON.stringify(options.body);
  try {
    const response = await fetch(url, fetchOptions);
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      const cleanText = String(text || "").trim();
      const isHtmlError = /<!doctype html|<html[\s>]/i.test(cleanText);
      data = {
        error: isHtmlError
          ? `Server error ${response.status}. Please try again in a minute.`
          : cleanText.slice(0, 500) || `Request failed with status ${response.status}`,
      };
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

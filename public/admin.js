const $ = (id) => document.getElementById(id);
const money = (value) => Number(value || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
const cleanPhone = (value) => String(value || "").replace(/\D/g, "").slice(-10);
const formatPhone = (value) => cleanPhone(value).replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3");
const status = (id, message, type = "ok") => {
  $(id).innerHTML = message ? `<div class="status ${type}">${message}</div>` : "";
};

let items = [];
let photos = [];
let loadedCustomer = null;
let batchesCache = [];
let allBatchesCache = [];
let customersCache = [];
let followupsCache = [];
let managerPhone = "";
let managerInvoicesCache = [];
let editingCustomerPhone = "";
let editItemsByPurchase = {};
let editEditorByPurchase = {};
let mercuryPrices = [];
let loginFollowupNoticeShown = false;

init();

async function init() {
  $("purchaseDate").value = new Date().toISOString().slice(0, 10);
  bindEvents();
  renderItems();
  renderPhotos();

  const me = await api("/api/me", { silent: true });
  if (me?.ok) showApp();
}

function bindEvents() {
  $("loginBtn").onclick = login;
  $("logoutBtn").onclick = logout;
  $("refreshBtn").onclick = refreshAll;
  $("newPurchaseBtn").onclick = resetPurchaseForm;
  $("lookupPhone").addEventListener("input", debounce(showPhoneCustomerSuggestions, 180));
  $("lookupPhone").addEventListener("focus", showPhoneCustomerSuggestions);
  $("lookupPhone").addEventListener("blur", () => {
    setTimeout(hidePhoneCustomerSuggestions, 160);
    lookupCustomer();
  });
  $("lookupPhone").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      hidePhoneCustomerSuggestions();
      lookupCustomer();
    }
  });
  $("addItemBtn").onclick = addItem;
  $("clearItemBtn").onclick = clearItem;
  $("clearInvoiceBtn").onclick = clearInvoice;
  $("savePurchaseBtn").onclick = savePurchase;
  $("createBatchBtn").onclick = createBatch;
  $("saveLeadBtn").onclick = saveLead;
  $("clearLeadBtn").onclick = clearLead;
  $("refreshLeadsBtn").onclick = loadCustomers;
  $("refreshFollowupsBtn").onclick = loadFollowups;
  $("saveCustomerProfileBtn").onclick = saveCustomerProfile;
  $("clearCustomerProfileBtn").onclick = clearCustomerProfile;
  $("backToCustomersBtn").onclick = showCustomerList;
  $("backFromEditCustomerBtn").onclick = showCustomerList;
  $("saveEditCustomerBtn").onclick = saveEditCustomerProfile;
  $("viewEditCustomerHistoryBtn").onclick = () => {
    if (editingCustomerPhone) openCustomerManager(editingCustomerPhone);
  };
  $("photoInput").onchange = handlePhotoInput;
  $("clearPhotosBtn").onclick = clearPhotos;
  $("invoiceFilter").onchange = loadBatches;
  $("historyFilter").onchange = renderInvoiceHistory;
  $("customerSearch").addEventListener("input", debounce(loadCustomers, 250));
  $("priceProductSelect").onchange = applySelectedPriceProduct;
  $("expiration").onchange = updateBuyerPricePreview;
  $("condition").onchange = updateBuyerPricePreview;

  document.querySelectorAll(".tab").forEach((button) => {
    button.onclick = () => openTab(button.dataset.tab);
  });
  document.querySelectorAll("[data-open-tab]").forEach((button) => {
    button.onclick = () => openTab(button.dataset.openTab);
  });
}

async function login() {
  const result = await api("/api/login", {
    method: "POST",
    body: {
      username: $("username").value.trim(),
      password: $("password").value,
      remember: $("remember").checked,
    },
  });
  if (result?.ok) showApp();
  else status("loginMsg", result?.error || "Login failed.", "bad");
}

async function logout() {
  await api("/api/logout", { method: "POST" });
  location.reload();
}

async function showApp() {
  $("login").classList.add("hidden");
  $("app").classList.remove("hidden");
  await refreshAll();
  showLoginFollowupNotice();
}

async function refreshAll() {
  await loadBuyerPrices();
  await Promise.all([loadBatches(), loadCustomers(), loadFollowups()]);
  renderDashboard();
}

function openTab(name) {
  const titles = { dashboard: "Dashboard", growth: "Growth CRM", leads: "Leads", followups: "Follow Ups", templates: "Templates", purchase: "New Purchase", invoices: "Active Invoices", history: "Invoice History", customers: "Customers" };
  document.querySelectorAll(".tab").forEach((button) => button.classList.toggle("active", button.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.add("hidden"));
  $(`${name}Tab`).classList.remove("hidden");
  $("pageTitle").textContent = titles[name] || "Admin";
  if (name === "invoices") loadBatches();
  if (name === "growth") renderGrowthCrm();
  if (name === "history") {
    loadBatches().then(renderInvoiceHistory);
  }
  if (name === "customers") {
    showCustomerList();
    loadCustomers();
  }
  if (name === "followups") loadFollowups();
  if (name === "leads") loadCustomers();
  if (name === "templates") renderTemplateGroups();
}

async function lookupCustomer() {
  const phone = cleanPhone($("lookupPhone").value);
  if (phone.length !== 10) {
    status("customerStatus", "Enter a 10 digit phone number.", "bad");
    return;
  }
  $("lookupPhone").value = formatPhone(phone);
  const result = await api(`/api/customers/lookup?phone=${phone}`);
  loadedCustomer = result.customer;
  if (loadedCustomer) {
    $("customerName").value = loadedCustomer.name || "";
    $("customerEmail").value = loadedCustomer.email || "";
    $("customerAddress").value = loadedCustomer.address || "";
    $("customerLocation").value = loadedCustomer.location || "";
    $("customerSource").value = loadedCustomer.source || "";
    $("customerNotes").value = loadedCustomer.notes || "";
    $("customerFollowup").value = loadedCustomer.next_follow_up_at ? loadedCustomer.next_follow_up_at.slice(0, 10) : "";
    status("customerStatus", "Customer found. History loaded.");
  } else {
    $("customerName").value = "";
    $("customerEmail").value = "";
    $("customerAddress").value = "";
    $("customerLocation").value = "";
    $("customerSource").value = "";
    $("customerNotes").value = "";
    $("customerFollowup").value = "";
    status("customerStatus", "New customer. Add their name and save a purchase.", "warn");
  }
  renderHistory(result.invoices || []);
}

async function showPhoneCustomerSuggestions() {
  const list = $("customerPhoneSuggestions");
  if (!list) return;
  const raw = $("lookupPhone").value.trim();
  const digits = cleanPhone(raw);
  if (digits.length < 3 && raw.length < 3) {
    hidePhoneCustomerSuggestions();
    return;
  }
  const result = await api(`/api/customers?search=${encodeURIComponent(raw || digits)}`, { silent: true });
  const matches = (result.customers || [])
    .filter((customer) => cleanPhone(customer.phone).includes(digits) || String(customer.name || "").toLowerCase().includes(raw.toLowerCase()))
    .slice(0, 6);
  if (!matches.length) {
    list.innerHTML = `<div class="autocomplete-empty">No matching customers</div>`;
    list.classList.remove("hidden");
    return;
  }
  list.innerHTML = matches.map((customer) => `
    <button type="button" class="autocomplete-option" onmousedown="selectPhoneCustomer('${escapeAttr(customer.phone)}')">
      <strong>${escapeHtml(customer.name || "No name yet")}</strong>
      <span>${formatPhone(customer.phone)}${customer.source ? " - " + escapeHtml(customer.source) : ""}</span>
    </button>
  `).join("");
  list.classList.remove("hidden");
}

function hidePhoneCustomerSuggestions() {
  $("customerPhoneSuggestions")?.classList.add("hidden");
}

window.selectPhoneCustomer = async (phone) => {
  $("lookupPhone").value = formatPhone(phone);
  hidePhoneCustomerSuggestions();
  await lookupCustomer();
};

function addItem() {
  const selectedProduct = getSelectedPriceProduct();
  const item = {
    category: $("category").value,
    brand: $("brand").value.trim() || selectedProduct?.product || "",
    model: $("model").value.trim(),
    quantity: Number($("quantity").value || 0),
    expiration: $("expiration").value,
    condition: $("condition").value,
    unit_cost: Number($("unitCost").value || 0),
    expected_sell_each: Number($("expectedSell").value || 0),
    notes: $("itemNotes").value.trim(),
  };
  if (!item.brand && !item.model) return status("saveStatus", "Add a brand or model.", "bad");
  if (!item.quantity) return status("saveStatus", "Quantity must be at least 1.", "bad");
  items.push(item);
  clearItem();
  renderItems();
}

function clearItem() {
  $("category").value = "Diabetic Pods";
  $("priceProductSelect").value = "";
  $("buyerPricePreview").value = "";
  $("brand").value = "";
  $("model").value = "";
  $("quantity").value = 1;
  $("expiration").value = "";
  $("condition").value = "Sealed";
  $("unitCost").value = "";
  $("expectedSell").value = "";
  $("itemNotes").value = "";
}

function clearInvoice() {
  if (!confirm("Clear current invoice items?")) return;
  items = [];
  renderItems();
}

function resetPurchaseForm() {
  loadedCustomer = null;
  items = [];
  photos = [];
  ["lookupPhone", "customerName", "customerEmail", "customerAddress", "customerLocation", "customerSource", "customerNotes", "customerFollowup", "invoiceNotes"].forEach((id) => ($(id).value = ""));
  $("purchaseDate").value = new Date().toISOString().slice(0, 10);
  $("payoutMethod").value = "Cash";
  clearItem();
  renderItems();
  renderPhotos();
  renderHistory([]);
  status("customerStatus", "");
  status("saveStatus", "");
}

function renderItems() {
  $("itemsBody").innerHTML = items.map((item, index) => `
    <tr>
      <td>${escapeHtml(item.category)}</td>
      <td>${escapeHtml(item.brand)}</td>
      <td>${escapeHtml(item.model)}</td>
      <td>${item.quantity}</td>
      <td>${escapeHtml(item.expiration)}</td>
      <td>${escapeHtml(item.condition)}</td>
      <td>${money(item.unit_cost)}</td>
      <td>${money(item.quantity * item.unit_cost)}</td>
      <td><button class="mini-btn" onclick="removeItem(${index})">Remove</button></td>
    </tr>
  `).join("") || `<tr><td colspan="9">No items added yet.</td></tr>`;
  $("invoiceTotal").textContent = money(items.reduce((sum, item) => sum + item.quantity * item.unit_cost, 0));
}

async function loadBuyerPrices() {
  const result = await api("/api/buyer-prices/mercury", { silent: true });
  mercuryPrices = result.rows || [];
  renderPriceProductOptions();
}

function renderPriceProductOptions() {
  const select = $("priceProductSelect");
  if (!select) return;
  select.innerHTML = `<option value="">Manual item / choose Mercury product</option>` + mercuryPrices.map((item) => (
    `<option value="${escapeAttr(item.id)}">${escapeHtml(cleanMercuryProductName(item.product))}</option>`
  )).join("");
}

function getSelectedPriceProduct() {
  const id = $("priceProductSelect")?.value || "";
  return mercuryPrices.find((item) => item.id === id) || null;
}

function applySelectedPriceProduct() {
  const product = getSelectedPriceProduct();
  if (!product) {
    updateBuyerPricePreview();
    return;
  }
  $("category").value = product.category || "Other";
  $("brand").value = cleanMercuryProductName(product.product) || "";
  $("model").value = "";
  updateBuyerPricePreview();
}

function updateBuyerPricePreview() {
  const product = getSelectedPriceProduct();
  const quote = product ? getMercuryPriceForItem(product, $("expiration").value, $("condition").value) : null;
  if (!product) {
    $("buyerPricePreview").value = "";
    return;
  }
  if (quote?.price !== null && quote?.price !== undefined) {
    $("expectedSell").value = quote.price;
    $("buyerPricePreview").value = `${money(quote.price)} - ${quote.label}`;
  } else {
    $("buyerPricePreview").value = quote?.raw ? `${quote.raw} - ${quote.label}` : "No matching Mercury price";
  }
}

window.removeItem = (index) => {
  items.splice(index, 1);
  renderItems();
};

async function savePurchase() {
  const phone = cleanPhone($("lookupPhone").value);
  if (phone.length !== 10) return status("saveStatus", "Customer phone is required.", "bad");
  if (!items.length) return status("saveStatus", "Add at least one item.", "bad");

  const result = await api("/api/purchases", {
    method: "POST",
    body: {
      batch_id: Number($("activeBatchSelect").value || 0) || null,
      customer: {
        name: $("customerName").value.trim(),
        phone,
        email: $("customerEmail").value.trim(),
        address: $("customerAddress").value.trim(),
        location: $("customerLocation").value.trim(),
        source: $("customerSource").value.trim(),
        notes: $("customerNotes").value.trim(),
        next_follow_up_at: $("customerFollowup").value || null,
      },
      invoice: {
        purchase_date: $("purchaseDate").value,
        payout_method: $("payoutMethod").value,
        notes: $("invoiceNotes").value.trim(),
      },
      items,
      photos,
    },
  });

  if (result?.ok) {
    status("saveStatus", `Added ${result.items_saved} item(s) to invoice #${result.batch.id}.`);
    items = [];
    photos = [];
    renderItems();
    renderPhotos();
    await Promise.all([lookupCustomer(), loadBatches(), loadCustomers(), loadFollowups()]);
    renderDashboard();
  } else {
    status("saveStatus", result?.error || "Could not save purchase.", "bad");
  }
}

async function loadBatches() {
  const filter = $("invoiceFilter")?.value || "Active";
  const [filtered, all] = await Promise.all([
    api(`/api/batches?status=${encodeURIComponent(filter)}`),
    api("/api/batches?status=All"),
  ]);
  batchesCache = filtered.batches || [];
  allBatchesCache = all.batches || [];
  renderBatchOptions();
  renderBatches();
  renderInvoiceHistory();
  renderDashboard();
}

function renderBatchOptions() {
  const active = allBatchesCache.filter((batch) => batch.status === "Active");
  $("activeBatchSelect").innerHTML = active.map((batch) => (
    `<option value="${batch.id}">#${batch.id} - ${escapeHtml(batch.label || "Open Invoice")} (${batch.purchase_count} purchase${batch.purchase_count === 1 ? "" : "s"})</option>`
  )).join("") || `<option value="">No active invoice</option>`;
}

async function createBatch() {
  const result = await api("/api/batches", {
    method: "POST",
    body: { label: $("newBatchLabel").value.trim() },
  });
  if (!result?.ok) return alert(result?.error || "Could not create invoice.");
  $("newBatchLabel").value = "";
  await loadBatches();
  $("activeBatchSelect").value = result.batch.id;
  openTab("purchase");
}

function renderBatches() {
  const container = $("invoiceList");
  if (!container) return;
  if (!batchesCache.length) {
    container.innerHTML = `<div class="empty">No invoices found for this view.</div>`;
    return;
  }
  container.innerHTML = batchesCache.map(renderBatchCard).join("");
}

function renderInvoiceHistory() {
  const container = $("invoiceHistoryList");
  if (!container) return;
  const filter = $("historyFilter")?.value || "Past";
  const historyBatches = allBatchesCache.filter((batch) => {
    if (filter === "Past") return batch.status === "Sold" || batch.status === "Shipped";
    if (filter === "All") return true;
    return batch.status === filter;
  });
  if (!historyBatches.length) {
    container.innerHTML = `<div class="empty">No invoice history found for this view.</div>`;
    return;
  }
  container.innerHTML = historyBatches.map(renderInvoiceHistoryCard).join("");
}

function renderInvoiceHistoryCard(batch) {
  const paid = Number(batch.total_paid || 0);
  const sold = Number(batch.sale_price || 0);
  const profit = sold - paid;
  const mercuryTotal = calculateMercuryInvoiceTotal(batch);
  const purchaseDetails = (batch.purchases || []).map((purchase) => {
    const items = (purchase.items || []).map((item) => {
      const itemPaid = Number(item.quantity || 0) * Number(item.unit_cost || 0);
      const expected = Number(item.quantity || 0) * Number(item.expected_sell_each || 0);
      return `
        <tr>
          <td>${Number(item.quantity || 0)}</td>
          <td>${escapeHtml([item.brand, item.model].filter(Boolean).join(" ") || item.category || "Item")}</td>
          <td>${escapeHtml(item.expiration || "N/A")}</td>
          <td>${escapeHtml(item.condition || "")}</td>
          <td>${money(item.unit_cost)}</td>
          <td>${money(itemPaid)}</td>
          <td>${money(expected)}</td>
        </tr>
      `;
    }).join("");
    return `
      <article class="history-card invoice-history-purchase">
        <div class="invoice-top">
          <div>
            <h3>${escapeHtml(purchase.customer_name || "Customer")} - ${formatPhone(purchase.customer_phone)}</h3>
            <p>${new Date(purchase.purchase_date).toLocaleDateString()} - Paid ${money(purchase.total_paid)} - ${escapeHtml(purchase.payout_method || "")}</p>
          </div>
          <button class="mini-btn" onclick="openCustomerManager('${purchase.customer_phone}')">Customer</button>
        </div>
        ${purchase.notes ? `<p class="mini"><b>Purchase notes:</b> ${escapeHtml(purchase.notes)}</p>` : ""}
        <div class="table-wrap">
          <table>
            <thead><tr><th>Qty</th><th>Item</th><th>Exp</th><th>Condition</th><th>Paid Each</th><th>Paid Total</th><th>Expected</th></tr></thead>
            <tbody>${items || `<tr><td colspan="7">No items saved.</td></tr>`}</tbody>
          </table>
        </div>
        ${renderPhotoStrip(purchase.photos || [])}
      </article>
    `;
  }).join("");
  return `
    <article class="invoice-card invoice-history-card">
      <div class="invoice-top">
        <div>
          <h3>Invoice #${batch.id} - ${escapeHtml(batch.label || "Invoice")}</h3>
          <p>${batch.purchase_count} purchase${batch.purchase_count === 1 ? "" : "s"} - Created ${formatDateTime(batch.created_at)} - Updated ${formatDateTime(batch.status_updated_at)}</p>
        </div>
        <span class="pill ${batch.status?.toLowerCase()}">${escapeHtml(batch.status || "Active")}</span>
      </div>
      <div class="history-detail-grid">
        <article class="stat"><span>Paid Out</span><strong>${money(paid)}</strong></article>
        <article class="stat"><span>Sold For</span><strong>${money(sold)}</strong></article>
        <article class="stat"><span>Profit</span><strong>${money(profit)}</strong></article>
        <article class="stat"><span>Buyer</span><strong>${escapeHtml(batch.sold_to || "Not set")}</strong></article>
      </div>
      <p class="mini">
        ${batch.sold_at ? `<b>Sold:</b> ${formatDateTime(batch.sold_at)} ` : ""}
        ${batch.shipped_at ? `<b>Shipped:</b> ${formatDateTime(batch.shipped_at)} ` : ""}
        ${batch.tracking_number ? `<b>Tracking:</b> ${escapeHtml(batch.tracking_number)} ` : ""}
      </p>
      ${batch.sale_notes ? `<p class="mini"><b>Sale notes:</b> ${escapeHtml(batch.sale_notes)}</p>` : ""}
      ${mercuryTotal ? `<p class="mini"><b>Mercury sheet estimate:</b> ${money(mercuryTotal)}</p>` : ""}
      <div class="invoice-actions">
        <strong>${money(sold || paid)}</strong>
        <div>
          <a class="mini-btn" href="/api/batches/${batch.id}/buyer-pdf" target="_blank">Buyer PDF</a>
          <a class="mini-btn" href="/api/batches/${batch.id}/buyer-pdf?prices=0" target="_blank">PDF No Prices</a>
          <button class="mini-btn" onclick="reopenInvoice(${batch.id})">Reopen</button>
        </div>
      </div>
      <section class="history">${purchaseDetails || `<div class="empty">No purchases inside this invoice.</div>`}</section>
    </article>
  `;
}

function renderDashboard() {
  const allActive = allBatchesCache.filter((batch) => batch.status === "Active");
  $("activeCount").textContent = allActive.length;
  $("soldCount").textContent = allBatchesCache.filter((batch) => batch.status === "Sold").length;
  $("shippedCount").textContent = allBatchesCache.filter((batch) => batch.status === "Shipped").length;
  $("followupCount").textContent = followupsCache.length;
  $("activeValue").textContent = money(allActive.reduce((sum, batch) => sum + Number(batch.total_paid || 0), 0));
  $("dashboardFollowups").innerHTML = followupsCache.slice(0, 4).map(renderCustomerRow).join("") || `<div class="empty">No follow ups due right now.</div>`;
  $("dashboardInvoices").innerHTML = allActive.slice(0, 5).map((batch) => renderBatchCard(batch, "dashboard")).join("") || `<div class="empty">No active invoices right now.</div>`;
  renderGrowthCrm();
}

function renderGrowthCrm() {
  if (!$("growthDueCount")) return;
  const repeatCustomers = customersCache
    .filter((customer) => Number(customer.invoice_count || 0) > 0)
    .sort((a, b) => Number(b.total_paid || 0) - Number(a.total_paid || 0));
  const sourceStats = buildSourceStats();
  const bestSource = sourceStats[0]?.source || "N/A";
  $("growthDueCount").textContent = followupsCache.length;
  $("growthRepeatCount").textContent = repeatCustomers.length;
  $("growthFacebookValue").textContent = money(sourceStats.filter((row) => /facebook|fb/i.test(row.source)).reduce((sum, row) => sum + row.totalPaid, 0));
  $("growthInstagramValue").textContent = money(sourceStats.filter((row) => /instagram|ig/i.test(row.source)).reduce((sum, row) => sum + row.totalPaid, 0));
  $("growthBestSource").textContent = bestSource;
  $("growthFollowups").innerHTML = followupsCache.slice(0, 8).map(renderGrowthFollowupRow).join("") || `<div class="empty">No follow-ups due right now.</div>`;
  renderGrowthSources(sourceStats);
  $("growthRepeatTargets").innerHTML = repeatCustomers.slice(0, 8).map(renderRepeatTargetRow).join("") || `<div class="empty">No repeat sellers yet.</div>`;
  renderTemplateGroups();
}

function buildSourceStats() {
  const groups = new Map();
  for (const customer of customersCache) {
    const source = normalizeSource(customer.source);
    const current = groups.get(source) || { source, contacts: 0, customers: 0, totalPaid: 0, due: 0 };
    current.contacts += 1;
    current.customers += Number(customer.invoice_count || 0) > 0 ? 1 : 0;
    current.totalPaid += Number(customer.total_paid || 0);
    current.due += isDue(customer.next_follow_up_at) ? 1 : 0;
    groups.set(source, current);
  }
  return Array.from(groups.values()).sort((a, b) => b.totalPaid - a.totalPaid || b.contacts - a.contacts);
}

function renderGrowthSources(rows) {
  $("growthSources").innerHTML = `
    <div class="table-wrap">
      <table class="source-table">
        <thead><tr><th>Source</th><th>Contacts</th><th>Customers</th><th>Due</th><th>Total Paid</th><th>Avg Customer</th></tr></thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${escapeHtml(row.source)}</td>
              <td>${row.contacts}</td>
              <td>${row.customers}</td>
              <td>${row.due}</td>
              <td>${money(row.totalPaid)}</td>
              <td>${money(row.customers ? row.totalPaid / row.customers : 0)}</td>
            </tr>
          `).join("") || `<tr><td colspan="6">No source data yet. Add Facebook, Instagram, referral, or group names to customers.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function renderGrowthFollowupRow(customer) {
  return `
    <article class="customer-row">
      <div>
        <h3>${escapeHtml(customer.name || "No name yet")}</h3>
        <p>${formatPhone(customer.phone)} - ${escapeHtml(normalizeSource(customer.source))}</p>
        <p class="mini"><b>Last purchase:</b> ${formatDateOnly(customer.last_purchase_date)} <b>Total paid:</b> ${money(customer.total_paid)}</p>
        ${customer.notes ? `<p class="mini">${escapeHtml(customer.notes)}</p>` : ""}
      </div>
      <div class="customer-meta">
        <button class="mini-btn" onclick="copyCustomerMessage('${customer.phone}', 'followup')">Copy Message</button>
        <button class="mini-btn" onclick="openCustomerManager('${customer.phone}')">History</button>
        <button class="mini-btn" onclick="markFollowedUp(${customer.id})">Done</button>
      </div>
    </article>
  `;
}

function renderRepeatTargetRow(customer) {
  return `
    <article class="customer-row">
      <div>
        <h3>${escapeHtml(customer.name || "No name yet")}</h3>
        <p>${formatPhone(customer.phone)} - ${escapeHtml(normalizeSource(customer.source))}</p>
        <p class="mini"><b>Purchases:</b> ${customer.invoice_count} <b>Total paid:</b> ${money(customer.total_paid)} <b>Last:</b> ${formatDateOnly(customer.last_purchase_date)}</p>
      </div>
      <div class="customer-meta">
        <button class="mini-btn" onclick="copyCustomerMessage('${customer.phone}', 'repeat')">Copy Message</button>
        <button class="mini-btn" onclick="openCustomerManager('${customer.phone}')">History</button>
        <button class="mini-btn" onclick="editCustomerProfile('${customer.phone}')">Edit</button>
      </div>
    </article>
  `;
}

function renderGrowthTemplates() {
  const templates = [
    { id: "followup", title: "28-Day Follow Up", text: "Hi {name}, this is Sell Diabetics. Just checking in to see if you have any diabetic supplies available this month. I’m buying Omnipods, Dexcom, Libre, and test strips. You can text me pictures and expiration dates anytime." },
    { id: "lead", title: "New Ad Reply", text: "Hi {name}, thanks for reaching out. I buy sealed diabetic supplies like Omnipods, Dexcom G7, Libre sensors, and test strips. Send me a picture of what you have, the expiration date, and your city, and I’ll give you a fast quote." },
    { id: "repeat", title: "Repeat Seller", text: "Hi {name}, hope you’re doing well. I’m still buying diabetic supplies and wanted to check if you have anything new available. I can usually give you a quote quickly if you send pictures and expiration dates." },
  ];
  $("growthTemplates").innerHTML = templates.map((template) => `
    <article class="template-card">
      <h3>${escapeHtml(template.title)}</h3>
      <p>${escapeHtml(template.text.replace("{name}", "there"))}</p>
      <button class="mini-btn" onclick="copyTextTemplate('${template.id}')">Copy</button>
    </article>
  `).join("");
}

function messageTemplateGroups() {
  return [
    {
      title: "New Customers",
      description: "Use these when someone is ready to sell for the first time.",
      templates: [
        { id: "new_quote", title: "Ask For Photos", text: "Hi {name}, thanks for reaching out. Please text me clear pictures of what you have, the expiration dates, and your city. I buy sealed Omnipods, Dexcom, Libre, and test strips and can give you a fast quote." },
        { id: "new_payment", title: "Payment Options", text: "Hi {name}, once I confirm the supplies and expiration dates, I can pay by cash, Zelle, Cash App, Venmo, or another agreed method. Send pictures when you get a chance and I will price everything out." },
        { id: "new_pickup", title: "Pickup Details", text: "Hi {name}, I can meet locally or arrange shipping depending on what you have. Send me your general area and pictures of the sealed boxes so I can give you the best offer." },
      ],
    },
    {
      title: "Follow Ups",
      description: "Use these for the 28-day follow-up cycle and repeat sellers.",
      templates: [
        { id: "followup", title: "28-Day Follow Up", text: "Hi {name}, this is Sell Diabetics. Just checking in to see if you have any diabetic supplies available this month. I am buying Omnipods, Dexcom, Libre, and test strips. You can text me pictures and expiration dates anytime." },
        { id: "repeat", title: "Repeat Seller", text: "Hi {name}, hope you are doing well. I am still buying diabetic supplies and wanted to check if you have anything new available. I can usually give you a quote quickly if you send pictures and expiration dates." },
        { id: "followup_soft", title: "Soft Check-In", text: "Hi {name}, just wanted to follow up and see if you had any extra sealed diabetic supplies this month. No rush, but I am available if you want a quick quote." },
      ],
    },
    {
      title: "Leads",
      description: "Use these for Facebook, Instagram, marketplace replies, and cold leads.",
      templates: [
        { id: "lead", title: "New Ad Reply", text: "Hi {name}, thanks for reaching out. I buy sealed diabetic supplies like Omnipods, Dexcom G7, Libre sensors, and test strips. Send me a picture of what you have, the expiration date, and your city, and I will give you a fast quote." },
        { id: "lead_second", title: "Second Message", text: "Hi {name}, following up from my ad. If you have sealed diabetic supplies available, send pictures of the boxes and expiration dates and I can let you know what I am paying today." },
        { id: "lead_not_ready", title: "Not Ready Yet", text: "No problem, {name}. I buy every month, so feel free to save my number. When you have sealed diabetic supplies available, just text pictures and expiration dates for a quote." },
      ],
    },
  ];
}

function renderTemplateGroups() {
  const container = $("templateGroups");
  if (!container) return;
  container.innerHTML = messageTemplateGroups().map((group) => `
    <section class="template-group">
      <div class="template-group-head">
        <h3>${escapeHtml(group.title)}</h3>
        <p>${escapeHtml(group.description)}</p>
      </div>
      <div class="template-grid">
        ${group.templates.map((template) => `
          <article class="template-card">
            <h3>${escapeHtml(template.title)}</h3>
            <p>${escapeHtml(template.text.replace("{name}", "there"))}</p>
            <button class="mini-btn" onclick="copyTextTemplate('${template.id}')">Copy</button>
          </article>
        `).join("")}
      </div>
    </section>
  `).join("");
}

function renderBatchCard(batch, context = "active") {
  const profit = Number(batch.sale_price || 0) - Number(batch.total_paid || 0);
  const mercuryTotal = calculateMercuryInvoiceTotal(batch);
  const purchasesHtml = (batch.purchases || []).map((purchase) => {
    const activeItems = activeInvoiceItems(purchase.items || []);
    const removedItems = (purchase.items || []).filter((item) => item.invoice_removed_at);
    const itemsHtml = activeItems.map((item) => renderPendingInvoiceItemRow(batch, item)).join("");
    const removedHtml = removedItems.map((item) => (
      `<div class="removed-item">${Number(item.quantity || 0)}x ${escapeHtml([item.brand, item.model].filter(Boolean).join(" ") || item.category || "Item")} removed${item.invoice_removed_reason ? ` - ${escapeHtml(item.invoice_removed_reason)}` : ""}</div>`
    )).join("");
    return `<div class="purchase-block">
      <p><b>${escapeHtml(purchase.customer_name || "Customer")}</b> - ${formatPhone(purchase.customer_phone)} - ${new Date(purchase.purchase_date).toLocaleDateString()} - ${money(purchase.total_paid)}</p>
      <div class="table-wrap pending-item-table">
        <table>
          <thead><tr><th>Qty</th><th>Item</th><th>Exp</th><th>Paid Each</th><th>Buyer Each</th><th>Profit Each</th><th>Total Profit</th><th></th></tr></thead>
          <tbody>${itemsHtml || `<tr><td colspan="8">No active items in this purchase.</td></tr>`}</tbody>
        </table>
      </div>
      ${removedHtml ? `<div class="removed-list">${removedHtml}</div>` : ""}
      ${renderPhotoStrip(purchase.photos || [])}
      ${purchase.notes ? `<p class="mini">${escapeHtml(purchase.notes)}</p>` : ""}
      <div class="actions compact-actions">
        <button class="mini-btn" onclick="editPurchaseFromInvoice(${batch.id}, ${purchase.id}, 'purchaseEditor-${context}-${batch.id}-${purchase.id}')">Edit Purchase</button>
        <button class="mini-btn" onclick="addPhotosToPurchase(${purchase.id})">Add Photos</button>
      </div>
      <div id="purchaseEditor-${context}-${batch.id}-${purchase.id}"></div>
    </div>`;
  }).join("");
  return `
    <article class="invoice-card">
      <div class="invoice-top">
        <div>
          <h3>Invoice #${batch.id} - ${escapeHtml(batch.label || "Open Invoice")}</h3>
          <p>${batch.purchase_count} purchase${batch.purchase_count === 1 ? "" : "s"} inside this invoice</p>
        </div>
        <span class="pill ${batch.status?.toLowerCase()}">${escapeHtml(batch.status || "Active")}</span>
      </div>
      <div class="purchase-list">${purchasesHtml || `<div class="empty">No purchases added yet.</div>`}</div>
      <div class="sale-box">
        <div class="form-grid three">
          <label>Sold to<input id="soldTo-${batch.id}" value="${escapeAttr(batch.sold_to || "")}" placeholder="Buyer name / company" onchange="applyBuyerPricing(${batch.id}, 'input')"></label>
          <label>Sold for<input id="salePrice-${batch.id}" type="number" min="0" step="0.01" value="${batch.sale_price || ""}" placeholder="0.00"></label>
          <label>Tracking number<input id="trackingNumber-${batch.id}" value="${escapeAttr(batch.tracking_number || "")}" placeholder="UPS / FedEx / USPS tracking"></label>
        </div>
        <div class="form-grid">
          <label>Sale notes<input id="saleNotes-${batch.id}" value="${escapeAttr(batch.sale_notes || "")}" placeholder="Marketplace, payment notes, buyer notes"></label>
        </div>
        <div class="sale-summary"><span>Paid: ${money(batch.total_paid)}</span><span>Sold: ${money(batch.sale_price)}</span><strong>Profit: ${money(profit)}</strong>${mercuryTotal ? `<span>Mercury sheet: ${money(mercuryTotal)}</span>` : ""}</div>
        ${mercuryTotal ? `<button class="mini-btn" onclick="applyBuyerPricing(${batch.id}, 'Mercury')">Use Mercury Prices</button>` : ""}
        ${batch.tracking_number ? `<p class="mini"><b>Tracking:</b> ${escapeHtml(batch.tracking_number)}</p>` : ""}
      </div>
      <div class="invoice-actions">
        <strong>${money(batch.total_paid)}</strong>
        <div>
          <button class="mini-btn" onclick="setBatchStatus(${batch.id}, 'Active')">Active</button>
          <button class="mini-btn" onclick="setBatchStatus(${batch.id}, 'Sold')">Sold</button>
          <button class="mini-btn" onclick="setBatchStatus(${batch.id}, 'Shipped')">Shipped</button>
          <a class="mini-btn" href="/api/batches/${batch.id}/buyer-pdf" target="_blank">Buyer PDF</a>
          <a class="mini-btn" href="/api/batches/${batch.id}/buyer-pdf?prices=0" target="_blank">PDF No Prices</a>
        </div>
      </div>
    </article>
  `;
}

function renderPendingInvoiceItemRow(batch, item) {
  const quantity = Number(item.quantity || 0);
  const paidEach = Number(item.unit_cost || 0);
  const buyerEach = getExpectedBuyerPrice(item);
  const profitEach = buyerEach === null ? null : buyerEach - paidEach;
  const totalProfit = profitEach === null ? null : profitEach * quantity;
  const itemName = [item.brand, item.model].filter(Boolean).join(" ") || item.category || "Item";
  return `
    <tr class="pending-item-row">
      <td>${quantity}</td>
      <td>
        <strong>${escapeHtml(itemName)}</strong>
        <span>${escapeHtml(item.condition || "Sealed")}</span>
      </td>
      <td>${escapeHtml(item.expiration || "N/A")}</td>
      <td>${money(paidEach)}</td>
      <td>${buyerEach === null ? "N/A" : money(buyerEach)}</td>
      <td class="${profitEach === null ? "" : profitEach >= 0 ? "profit-good" : "profit-bad"}">${profitEach === null ? "N/A" : money(profitEach)}</td>
      <td class="${totalProfit === null ? "" : totalProfit >= 0 ? "profit-good" : "profit-bad"}"><strong>${totalProfit === null ? "N/A" : money(totalProfit)}</strong></td>
      <td><button class="mini-btn danger" onclick="removePendingInvoiceItem(${item.id})">Remove</button></td>
    </tr>
  `;
}

function activeInvoiceItems(itemsList) {
  return (itemsList || []).filter((item) => !item.invoice_removed_at);
}

function getExpectedBuyerPrice(item) {
  const product = findMercuryProductForItem(item);
  const quote = product ? getMercuryPriceForItem(product, item.expiration, item.condition) : null;
  const mercuryPrice = quote?.price === undefined || quote?.price === null ? null : Number(quote.price);
  if (mercuryPrice !== null && !Number.isNaN(mercuryPrice)) return mercuryPrice;
  const savedPrice = Number(item.expected_sell_each || 0);
  return savedPrice > 0 ? savedPrice : null;
}

window.removePendingInvoiceItem = async (id) => {
  if (!confirm("Remove this item from the pending invoice? It will stay in the customer's purchase history.")) return false;
  const result = await api(`/api/purchase-items/${id}/invoice-removal`, {
    method: "PATCH",
    body: { remove: true, reason: "Sold locally" },
  });
  if (!result?.ok) {
    alert(result?.error || "Could not remove item from invoice.");
    return false;
  }
  await loadBatches();
  return true;
};

window.setBatchStatus = async (id, nextStatus) => {
  const result = await api(`/api/batches/${id}/status`, {
    method: "PATCH",
    body: {
      status: nextStatus,
      sold_to: $(`soldTo-${id}`).value.trim(),
      sale_price: $(`salePrice-${id}`).value,
      sale_notes: $(`saleNotes-${id}`).value.trim(),
      tracking_number: $(`trackingNumber-${id}`).value.trim(),
    },
  });
  if (result?.ok) await loadBatches();
  else alert(result?.error || "Could not update invoice.");
};

window.reopenInvoice = async (id) => {
  if (!confirm("Move this invoice back to Active?")) return;
  const result = await api(`/api/batches/${id}/status`, {
    method: "PATCH",
    body: { status: "Active" },
  });
  if (result?.ok) await loadBatches();
  else alert(result?.error || "Could not reopen invoice.");
};

window.applyBuyerPricing = (id, buyerName) => {
  const soldTo = $(`soldTo-${id}`);
  const salePrice = $(`salePrice-${id}`);
  const batch = [...batchesCache, ...allBatchesCache].find((entry) => Number(entry.id) === Number(id));
  const buyer = buyerName === "input" ? soldTo.value : buyerName;
  if (!batch || !/mercury/i.test(buyer || "")) return;
  const total = calculateMercuryInvoiceTotal(batch);
  if (!total) return;
  soldTo.value = "Mercury";
  salePrice.value = total.toFixed(2);
};

async function loadCustomers() {
  const search = $("customerSearch")?.value || "";
  const result = await api(`/api/customers?search=${encodeURIComponent(search)}`);
  customersCache = result.customers || [];
  renderCustomers();
}

async function loadFollowups() {
  const result = await api("/api/followups");
  followupsCache = result.customers || [];
  renderFollowups();
}

function renderCustomers() {
  const container = $("customerList");
  if (!container) return;
  if (!customersCache.length) {
    container.innerHTML = `<div class="empty">No customers found.</div>`;
    renderLeads();
    return;
  }
  container.innerHTML = customersCache.map(renderCustomerRow).join("");
  renderLeads();
}

function renderFollowups() {
  const container = $("followupList");
  if (!container) return;
  container.innerHTML = followupsCache.map(renderCustomerRow).join("") || `<div class="empty">No follow ups due right now.</div>`;
}

function showLoginFollowupNotice() {
  const container = $("followupNotice");
  if (!container || loginFollowupNoticeShown || !followupsCache.length) return;
  loginFollowupNoticeShown = true;
  const leadCount = followupsCache.filter((customer) => (customer.crm_status || "").toLowerCase() === "lead").length;
  const customerCount = followupsCache.length - leadCount;
  const names = followupsCache
    .slice(0, 4)
    .map((customer) => customer.name || formatPhone(customer.phone))
    .join(", ");
  const summary = [
    leadCount ? `${leadCount} lead${leadCount === 1 ? "" : "s"}` : "",
    customerCount ? `${customerCount} customer${customerCount === 1 ? "" : "s"}` : "",
  ].filter(Boolean).join(" and ");
  container.innerHTML = `
    <div>
      <h2>${followupsCache.length} follow up${followupsCache.length === 1 ? "" : "s"} due now</h2>
      <p>${escapeHtml(summary || "Contacts")} need attention today${names ? `: ${escapeHtml(names)}` : ""}.</p>
    </div>
    <div class="notice-actions">
      <button class="btn" onclick="openTab('followups')">Review Follow Ups</button>
      <button class="mini-btn" onclick="dismissFollowupNotice()">Dismiss</button>
    </div>
  `;
  container.classList.remove("hidden");
}

window.dismissFollowupNotice = () => {
  $("followupNotice")?.classList.add("hidden");
};

function renderLeads() {
  const container = $("leadList");
  if (!container) return;
  const leads = customersCache.filter((customer) => (customer.crm_status || "").toLowerCase() === "lead");
  container.innerHTML = leads.map(renderCustomerRow).join("") || `<div class="empty">No saved leads yet.</div>`;
}

function renderCustomerRow(customer) {
  return `
    <article class="customer-row">
      <div>
        <h3>${escapeHtml(customer.name || "No name yet")}</h3>
        <p>${formatPhone(customer.phone)} ${customer.email ? "- " + escapeHtml(customer.email) : ""}</p>
        ${customer.address ? `<p class="mini"><b>Address:</b> ${escapeHtml(customer.address)}</p>` : ""}
        ${customer.location ? `<p class="mini"><b>Location:</b> ${escapeHtml(customer.location)}</p>` : ""}
        ${customer.source ? `<p class="mini"><b>Found:</b> ${escapeHtml(customer.source)}</p>` : ""}
        ${customer.next_follow_up_at ? `<p class="mini"><b>Follow up:</b> ${formatDateOnly(customer.next_follow_up_at)}</p>` : ""}
        ${customer.notes ? `<p class="mini">${escapeHtml(customer.notes)}</p>` : ""}
      </div>
      <div class="customer-meta">
        <strong>${money(customer.total_paid)}</strong>
        <span>${customer.invoice_count} invoice(s)</span>
        <button class="mini-btn" onclick="editCustomerProfile('${customer.phone}')">Edit</button>
        <button class="mini-btn" onclick="openCustomerManager('${customer.phone}')">View History</button>
        <button class="mini-btn" onclick="markFollowedUp(${customer.id})">Followed Up</button>
      </div>
    </article>
  `;
}

window.loadCustomerIntoPurchase = async (phone) => {
  openTab("purchase");
  $("lookupPhone").value = formatPhone(phone);
  await lookupCustomer();
};

window.openCustomerManager = async (phone) => {
  const result = await api(`/api/customers/lookup?phone=${cleanPhone(phone)}`);
  if (!result.customer) return alert("Customer not found.");
  openTab("customers");
  showCustomerManager(result.customer, result.invoices || []);
};

window.editCustomerProfile = async (phone) => {
  const result = await api(`/api/customers/lookup?phone=${cleanPhone(phone)}`);
  if (!result.customer) return;
  openTab("customers");
  showCustomerEdit(result.customer);
};

function showCustomerList() {
  editingCustomerPhone = "";
  $("customerEditPanel").classList.add("hidden");
  $("customerManagerPanel").classList.add("hidden");
  $("customerProfilePanel").classList.remove("hidden");
  $("customerListPanel").classList.remove("hidden");
}

function showCustomerManager(customer, invoices) {
  managerPhone = cleanPhone(customer.phone);
  managerInvoicesCache = invoices || [];
  $("customerEditPanel").classList.add("hidden");
  $("customerProfilePanel").classList.add("hidden");
  $("customerListPanel").classList.add("hidden");
  $("customerManagerPanel").classList.remove("hidden");
  $("customerManager").innerHTML = renderCustomerManager(customer, invoices);
}

function showCustomerEdit(customer) {
  editingCustomerPhone = cleanPhone(customer.phone);
  $("customerManagerPanel").classList.add("hidden");
  $("customerProfilePanel").classList.add("hidden");
  $("customerListPanel").classList.add("hidden");
  $("customerEditPanel").classList.remove("hidden");
  fillEditCustomerProfile(customer);
}

function renderCustomerManager(customer, invoices) {
  const totalPaid = invoices.reduce((sum, invoice) => sum + Number(invoice.total_paid || 0), 0);
  const itemCount = invoices.reduce((sum, invoice) => sum + (invoice.items || []).reduce((itemSum, item) => itemSum + Number(item.quantity || 0), 0), 0);
  return `
    <div class="stats customer-stats">
      <article class="stat"><span>Total paid</span><strong>${money(totalPaid)}</strong></article>
      <article class="stat"><span>Purchases</span><strong>${invoices.length}</strong></article>
      <article class="stat"><span>Items bought</span><strong>${itemCount}</strong></article>
      <article class="stat"><span>Follow up</span><strong>${customer.next_follow_up_at ? formatDateOnly(customer.next_follow_up_at) : "None"}</strong></article>
      <article class="stat"><span>Source</span><strong>${escapeHtml(customer.source || "Unknown")}</strong></article>
    </div>
    <article class="history-card">
      <h3>${escapeHtml(customer.name || "No name yet")}</h3>
      <p class="mini"><b>Phone:</b> ${formatPhone(customer.phone)} ${customer.email ? `<b>Email:</b> ${escapeHtml(customer.email)}` : ""}</p>
      ${customer.address ? `<p class="mini"><b>Home address:</b> ${escapeHtml(customer.address)}</p>` : ""}
      ${customer.location ? `<p class="mini"><b>Location notes:</b> ${escapeHtml(customer.location)}</p>` : ""}
      ${customer.notes ? `<p class="mini"><b>Notes:</b> ${escapeHtml(customer.notes)}</p>` : ""}
      <div class="actions">
        <button class="mini-btn" onclick="editCustomerProfile('${customer.phone}')">Edit Customer</button>
        <button class="mini-btn" onclick="loadCustomerIntoPurchase('${customer.phone}')">New Purchase</button>
        <button class="mini-btn" onclick="markFollowedUp(${customer.id})">Followed Up</button>
      </div>
    </article>
    <section class="history">
      ${renderManagerHistory(invoices)}
    </section>
  `;
}

function renderManagerHistory(invoices) {
  if (!invoices.length) return `<div class="empty">No purchase history yet.</div>`;
  return invoices.map((invoice) => `
    <article class="history-card">
      <div class="invoice-top">
        <h3>Purchase #${invoice.id} - ${new Date(invoice.purchase_date).toLocaleDateString()} - ${money(invoice.total_paid)}</h3>
        <span class="pill ${invoice.batch_status?.toLowerCase()}">${escapeHtml(invoice.batch_status || "Active")}</span>
      </div>
      <p class="mini"><b>Invoice:</b> #${invoice.batch_id || ""} ${escapeHtml(invoice.batch_label || "")}</p>
      <p class="mini"><b>Payout:</b> ${escapeHtml(invoice.payout_method)} ${invoice.notes ? "- " + escapeHtml(invoice.notes) : ""}</p>
      <ul>${invoice.items.map((item) => `<li>${item.quantity}x ${escapeHtml(item.brand)} ${escapeHtml(item.model)} - ${escapeHtml(item.condition)} - paid ${money(item.unit_cost)} each${item.expiration ? " - exp " + escapeHtml(item.expiration) : ""}</li>`).join("")}</ul>
      ${renderPhotoStrip(invoice.photos || [])}
      <div class="actions">
        <button class="mini-btn" onclick="editPurchase(${invoice.id})">Edit Purchase</button>
        <button class="mini-btn" onclick="addPhotosToPurchase(${invoice.id})">Add Photos</button>
      </div>
      <div id="purchaseEditor-${invoice.id}"></div>
    </article>
  `).join("");
}

function findEditablePurchase(id) {
  const purchaseId = Number(id);
  return managerInvoicesCache.find((entry) => Number(entry.id) === purchaseId)
    || [...batchesCache, ...allBatchesCache]
      .flatMap((batch) => batch.purchases || [])
      .find((entry) => Number(entry.id) === purchaseId);
}

function getPurchaseEditor(id) {
  return $(editEditorByPurchase[id] || `purchaseEditor-${id}`);
}

window.editPurchaseFromInvoice = (batchId, id, editorId) => {
  const invoice = findEditablePurchase(id);
  if (!invoice) return alert("Purchase not found. Refresh invoices and try again.");
  editEditorByPurchase[id] = editorId;
  editItemsByPurchase[id] = (invoice.items || []).map((item) => ({ ...item }));
  renderPurchaseEditor(invoice);
};

window.editPurchase = (id) => {
  const invoice = findEditablePurchase(id);
  if (!invoice) return alert("Purchase not found. Refresh the customer and try again.");
  editEditorByPurchase[id] = `purchaseEditor-${id}`;
  editItemsByPurchase[id] = (invoice.items || []).map((item) => ({ ...item }));
  renderPurchaseEditor(invoice);
};

window.addEditPurchaseItem = (id) => {
  const invoice = findEditablePurchase(id);
  if (!invoice) return;
  editItemsByPurchase[id] = readEditPurchaseItems(id);
  editItemsByPurchase[id].push({
    category: "Diabetic Pods",
    brand: "",
    model: "",
    quantity: 1,
    expiration: "",
    condition: "Sealed",
    unit_cost: 0,
    expected_sell_each: 0,
    notes: "",
  });
  renderPurchaseEditor(invoice);
};

window.removeEditPurchaseItem = (id, index) => {
  const invoice = findEditablePurchase(id);
  if (!invoice) return;
  editItemsByPurchase[id] = readEditPurchaseItems(id).filter((_, itemIndex) => itemIndex !== index);
  renderPurchaseEditor(invoice);
};

window.cancelEditPurchase = (id) => {
  editItemsByPurchase[id] = [];
  const editor = getPurchaseEditor(id);
  if (editor) editor.innerHTML = "";
};

window.saveEditedPurchase = async (id) => {
  const itemsToSave = readEditPurchaseItems(id);
  if (!itemsToSave.length) return status(`editStatus-${id}`, "Add at least one item.", "bad");
  const result = await api(`/api/purchases/${id}`, {
    method: "PATCH",
    body: {
      invoice: {
        purchase_date: $(`editDate-${id}`).value,
        payout_method: $(`editPayout-${id}`).value,
        notes: $(`editNotes-${id}`).value.trim(),
      },
      items: itemsToSave,
    },
  });
  if (!result?.ok) return status(`editStatus-${id}`, result?.error || "Could not update purchase.", "bad");
  status(`editStatus-${id}`, "Purchase updated.");
  await Promise.all([loadBatches(), loadCustomers(), loadFollowups()]);
  if (managerPhone) await reloadCustomerManager();
  renderDashboard();
};

window.addPhotosToPurchase = (id) => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.multiple = true;
  input.onchange = async () => {
    const files = Array.from(input.files || []);
    const newPhotos = [];
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      const dataUrl = await compressImage(file);
      newPhotos.push({ file_name: file.name, data_url: dataUrl, notes: "" });
    }
    if (!newPhotos.length) return;
    const result = await api(`/api/purchases/${id}/photos`, {
      method: "POST",
      body: { photos: newPhotos },
    });
    if (!result?.ok) return alert(result?.error || "Could not add photos.");
    await Promise.all([loadBatches(), loadCustomers()]);
    if (managerPhone) await reloadCustomerManager();
    renderDashboard();
  };
  input.click();
};

function renderPurchaseEditor(invoice) {
  const id = invoice.id;
  const editor = getPurchaseEditor(id);
  if (!editor) return;
  const editableItems = editItemsByPurchase[id] || [];
  editor.innerHTML = `
    <div class="edit-purchase-box">
      <div class="form-grid three">
        <label>Purchase date<input id="editDate-${id}" type="date" value="${String(invoice.purchase_date || "").slice(0, 10)}"></label>
        <label>Payout method<input id="editPayout-${id}" value="${escapeAttr(invoice.payout_method || "Cash")}"></label>
        <label>Purchase notes<input id="editNotes-${id}" value="${escapeAttr(invoice.notes || "")}"></label>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Mercury Product</th><th>Category</th><th>Brand</th><th>Model</th><th>Qty</th><th>Exp</th><th>Condition</th><th>Paid Each</th><th>Expected</th><th></th></tr></thead>
          <tbody>
            ${editableItems.map((item, index) => `
              <tr data-edit-item="${index}">
                <td><select data-field="price_product" onchange="applyEditMercuryProduct(${id}, ${index})">${renderMercuryProductOptions(findMercuryProductForItem(item)?.id || "")}</select></td>
                <td><input data-field="category" value="${escapeAttr(item.category || "")}"></td>
                <td><input data-field="brand" value="${escapeAttr(item.brand || "")}"></td>
                <td><input data-field="model" value="${escapeAttr(item.model || "")}"></td>
                <td><input data-field="quantity" type="number" min="1" step="1" value="${Number(item.quantity || 1)}"></td>
                <td><input data-field="expiration" value="${escapeAttr(item.expiration || "")}" onchange="updateEditMercuryPrice(${id}, ${index})"></td>
                <td><input data-field="condition" value="${escapeAttr(item.condition || "Sealed")}" onchange="updateEditMercuryPrice(${id}, ${index})"></td>
                <td><input data-field="unit_cost" type="number" min="0" step="0.01" value="${Number(item.unit_cost || 0)}"></td>
                <td><input data-field="expected_sell_each" type="number" min="0" step="0.01" value="${Number(item.expected_sell_each || 0)}"></td>
                <td><button class="mini-btn" onclick="removeEditPurchaseItem(${id}, ${index})">Remove</button></td>
              </tr>
              <tr data-edit-item-notes="${index}">
                <td colspan="10"><input data-field="notes" value="${escapeAttr(item.notes || "")}" placeholder="Item notes"></td>
              </tr>
            `).join("") || `<tr><td colspan="10">No items yet.</td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="actions">
        <button class="mini-btn" onclick="addEditPurchaseItem(${id})">Add Item</button>
        <button class="mini-btn" onclick="saveEditedPurchase(${id})">Save Purchase</button>
        <button class="mini-btn" onclick="cancelEditPurchase(${id})">Cancel</button>
      </div>
      <div id="editStatus-${id}"></div>
    </div>
  `;
}

function renderMercuryProductOptions(selectedId = "") {
  return `<option value="">Choose Mercury match</option>` + mercuryPrices.map((product) => (
    `<option value="${escapeAttr(product.id)}"${product.id === selectedId ? " selected" : ""}>${escapeHtml(cleanMercuryProductName(product.product))}</option>`
  )).join("");
}

window.applyEditMercuryProduct = (id, index) => {
  const row = getPurchaseEditor(id)?.querySelector(`[data-edit-item="${index}"]`);
  if (!row) return;
  const productId = row.querySelector('[data-field="price_product"]')?.value || "";
  const product = mercuryPrices.find((entry) => entry.id === productId);
  if (!product) return;
  row.querySelector('[data-field="category"]').value = product.category || "Other";
  row.querySelector('[data-field="brand"]').value = cleanMercuryProductName(product.product);
  row.querySelector('[data-field="model"]').value = "";
  updateEditMercuryPrice(id, index);
};

window.updateEditMercuryPrice = (id, index) => {
  const row = getPurchaseEditor(id)?.querySelector(`[data-edit-item="${index}"]`);
  if (!row) return;
  const productId = row.querySelector('[data-field="price_product"]')?.value || "";
  const product = mercuryPrices.find((entry) => entry.id === productId);
  if (!product) return;
  const expiration = row.querySelector('[data-field="expiration"]')?.value || "";
  const condition = row.querySelector('[data-field="condition"]')?.value || "";
  const quote = getMercuryPriceForItem(product, expiration, condition);
  if (quote?.price !== null && quote?.price !== undefined) {
    row.querySelector('[data-field="expected_sell_each"]').value = quote.price;
  }
};

function readEditPurchaseItems(id) {
  const editor = getPurchaseEditor(id);
  if (!editor) return [];
  return Array.from(editor.querySelectorAll(`[data-edit-item]`)).map((row) => {
    const index = row.dataset.editItem;
    const notesRow = editor.querySelector(`[data-edit-item-notes="${index}"]`);
    const get = (field) => row.querySelector(`[data-field="${field}"]`)?.value || "";
    return {
      category: get("category"),
      brand: get("brand").trim(),
      model: get("model").trim(),
      quantity: Number(get("quantity") || 0),
      expiration: get("expiration").trim(),
      condition: get("condition").trim() || "Sealed",
      unit_cost: Number(get("unit_cost") || 0),
      expected_sell_each: Number(get("expected_sell_each") || 0),
      notes: notesRow?.querySelector('[data-field="notes"]')?.value.trim() || "",
    };
  }).filter((item) => item.quantity > 0 && (item.brand || item.model || item.category));
}

async function reloadCustomerManager() {
  if (!managerPhone) return loadCustomers();
  const result = await api(`/api/customers/lookup?phone=${managerPhone}`);
  if (!result.customer) return;
  showCustomerManager(result.customer, result.invoices || []);
  await Promise.all([loadCustomers(), loadBatches(), loadFollowups()]);
  renderDashboard();
}

function fillCustomerProfile(customer) {
  $("profilePhone").value = formatPhone(customer.phone);
  $("profileName").value = customer.name || "";
  $("profileEmail").value = customer.email || "";
  $("profileAddress").value = customer.address || "";
  $("profileLocation").value = customer.location || "";
  $("profileSource").value = customer.source || "";
  $("profileFollowup").value = customer.next_follow_up_at ? customer.next_follow_up_at.slice(0, 10) : "";
  $("profileNotes").value = customer.notes || "";
}

function fillEditCustomerProfile(customer) {
  $("customerEditSummary").innerHTML = `
    <article class="customer-row compact">
      <div>
        <h3>${escapeHtml(customer.name || "No name yet")}</h3>
        <p>${formatPhone(customer.phone)} ${customer.email ? "- " + escapeHtml(customer.email) : ""}</p>
        ${customer.next_follow_up_at ? `<p class="mini"><b>Follow up:</b> ${formatDateOnly(customer.next_follow_up_at)}</p>` : ""}
      </div>
    </article>
  `;
  $("editProfilePhone").value = formatPhone(customer.phone);
  $("editProfileName").value = customer.name || "";
  $("editProfileEmail").value = customer.email || "";
  $("editProfileAddress").value = customer.address || "";
  $("editProfileLocation").value = customer.location || "";
  $("editProfileSource").value = customer.source || "";
  $("editProfileFollowup").value = customer.next_follow_up_at ? customer.next_follow_up_at.slice(0, 10) : "";
  $("editProfileNotes").value = customer.notes || "";
  status("editProfileStatus", "");
}

function clearCustomerProfile() {
  ["profilePhone", "profileName", "profileEmail", "profileAddress", "profileLocation", "profileSource", "profileFollowup", "profileNotes"].forEach((id) => ($(id).value = ""));
  status("profileStatus", "");
}

async function saveCustomerProfile() {
  const phone = cleanPhone($("profilePhone").value);
  if (phone.length !== 10) return status("profileStatus", "Customer phone is required.", "bad");
  const result = await api("/api/customers", {
    method: "POST",
    body: {
      phone,
      name: $("profileName").value.trim(),
      email: $("profileEmail").value.trim(),
      address: $("profileAddress").value.trim(),
      location: $("profileLocation").value.trim(),
      source: $("profileSource").value.trim(),
      notes: $("profileNotes").value.trim(),
      crm_status: "Customer",
      next_follow_up_at: $("profileFollowup").value || null,
    },
  });
  if (!result?.ok) return status("profileStatus", result?.error || "Could not save customer.", "bad");
  fillCustomerProfile(result.customer);
  status("profileStatus", "Customer saved.");
  await Promise.all([loadCustomers(), loadFollowups()]);
  renderDashboard();
}

async function saveEditCustomerProfile() {
  const phone = cleanPhone($("editProfilePhone").value);
  if (phone.length !== 10) return status("editProfileStatus", "Customer phone is required.", "bad");
  const result = await api("/api/customers", {
    method: "POST",
    body: {
      phone,
      name: $("editProfileName").value.trim(),
      email: $("editProfileEmail").value.trim(),
      address: $("editProfileAddress").value.trim(),
      location: $("editProfileLocation").value.trim(),
      source: $("editProfileSource").value.trim(),
      notes: $("editProfileNotes").value.trim(),
      crm_status: "Customer",
      next_follow_up_at: $("editProfileFollowup").value || null,
    },
  });
  if (!result?.ok) return status("editProfileStatus", result?.error || "Could not save customer.", "bad");
  editingCustomerPhone = cleanPhone(result.customer.phone);
  fillEditCustomerProfile(result.customer);
  status("editProfileStatus", "Customer saved.");
  await Promise.all([loadCustomers(), loadFollowups()]);
  renderDashboard();
}

function renderHistory(invoices) {
  if (!invoices.length) {
    $("history").innerHTML = "<p>No purchase history yet.</p>";
    return;
  }
  $("history").innerHTML = invoices.map((invoice) => `
    <article class="history-card">
      <div class="invoice-top">
        <h3>#${invoice.id} - ${new Date(invoice.purchase_date).toLocaleDateString()} - ${money(invoice.total_paid)}</h3>
        <span class="pill ${invoice.batch_status?.toLowerCase()}">${escapeHtml(invoice.batch_status || "Active")}</span>
      </div>
      <p class="mini">Payout: ${escapeHtml(invoice.payout_method)} ${invoice.notes ? "- " + escapeHtml(invoice.notes) : ""}</p>
      <ul>${invoice.items.map((item) => `<li>${item.quantity}x ${escapeHtml(item.brand)} ${escapeHtml(item.model)} - ${escapeHtml(item.condition)} - ${money(item.unit_cost)} each</li>`).join("")}</ul>
      ${renderPhotoStrip(invoice.photos || [])}
    </article>
  `).join("");
}

async function saveLead() {
  const phone = cleanPhone($("leadPhone").value);
  if (phone.length !== 10) return status("leadStatus", "Lead phone is required.", "bad");
  const result = await api("/api/customers", {
    method: "POST",
    body: {
      phone,
      name: $("leadName").value.trim(),
      email: $("leadEmail").value.trim(),
      address: $("leadAddress").value.trim(),
      source: $("leadSource").value.trim(),
      notes: $("leadNotes").value.trim(),
      crm_status: "Lead",
      next_follow_up_at: $("leadFollowup").value || null,
    },
  });
  if (!result?.ok) return status("leadStatus", result?.error || "Could not save lead.", "bad");
  status("leadStatus", "Lead saved.");
  clearLead(false);
  await Promise.all([loadCustomers(), loadFollowups()]);
  renderLeads();
  renderDashboard();
}

function clearLead(clearMessage = true) {
  ["leadPhone", "leadName", "leadEmail", "leadAddress", "leadSource", "leadNotes", "leadFollowup"].forEach((id) => ($(id).value = ""));
  if (clearMessage) status("leadStatus", "");
}

window.markFollowedUp = async (id) => {
  const result = await api(`/api/customers/${id}/followup`, { method: "PATCH", body: {} });
  if (!result?.ok) return alert(result?.error || "Could not update follow up.");
  await Promise.all([loadCustomers(), loadFollowups()]);
  renderDashboard();
};

window.copyCustomerMessage = async (phone, type = "followup") => {
  const customer = customersCache.find((entry) => cleanPhone(entry.phone) === cleanPhone(phone))
    || followupsCache.find((entry) => cleanPhone(entry.phone) === cleanPhone(phone));
  const name = firstName(customer?.name);
  const text = makeCustomerMessage(type, name);
  await copyText(text);
};

window.copyTextTemplate = async (type) => {
  const template = findMessageTemplate(type);
  await copyText(template ? template.text.replace("{name}", "there") : makeCustomerMessage(type, "there"));
};

function findMessageTemplate(id) {
  return messageTemplateGroups().flatMap((group) => group.templates).find((template) => template.id === id) || null;
}

function makeCustomerMessage(type, name) {
  const who = name || "there";
  const template = findMessageTemplate(type);
  if (template) return template.text.replace("{name}", who);
  if (type === "lead") {
    return `Hi ${who}, thanks for reaching out. I buy sealed diabetic supplies like Omnipods, Dexcom G7, Libre sensors, and test strips. Send me a picture of what you have, the expiration date, and your city, and I’ll give you a fast quote.`;
  }
  if (type === "repeat") {
    return `Hi ${who}, hope you’re doing well. I’m still buying diabetic supplies and wanted to check if you have anything new available. I can usually give you a quote quickly if you send pictures and expiration dates.`;
  }
  return `Hi ${who}, this is Sell Diabetics. Just checking in to see if you have any diabetic supplies available this month. I’m buying Omnipods, Dexcom, Libre, and test strips. You can text me pictures and expiration dates anytime.`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    alert("Message copied.");
  } catch {
    prompt("Copy this message:", text);
  }
}

async function handlePhotoInput(event) {
  const files = Array.from(event.target.files || []);
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    const dataUrl = await compressImage(file);
    photos.push({ file_name: file.name, data_url: dataUrl, notes: "" });
  }
  event.target.value = "";
  renderPhotos();
}

function renderPhotos() {
  $("photoPreview").innerHTML = photos.map((photo, index) => `
    <article class="photo-thumb">
      <img src="${photo.data_url}" alt="">
      <button class="mini-btn" onclick="removePhoto(${index})">Remove</button>
    </article>
  `).join("") || `<div class="empty">No product photos added yet.</div>`;
}

function clearPhotos() {
  photos = [];
  renderPhotos();
}

window.removePhoto = (index) => {
  photos.splice(index, 1);
  renderPhotos();
};

function renderPhotoStrip(savedPhotos) {
  if (!savedPhotos.length) return "";
  return `<div class="photo-strip">${savedPhotos.map((photo) => `
    <button class="photo-view-btn" type="button" data-name="${escapeAttr(photo.file_name || "Product photo")}" onclick="openPhotoViewer(this)">
      <img src="${photo.data_url}" alt="${escapeAttr(photo.file_name || "Product photo")}">
    </button>
  `).join("")}</div>`;
}

window.openPhotoViewer = (button) => {
  const image = button.querySelector("img");
  if (!image?.src) return;
  let viewer = $("photoViewer");
  if (!viewer) {
    viewer = document.createElement("div");
    viewer.id = "photoViewer";
    viewer.className = "photo-viewer hidden";
    viewer.innerHTML = `
      <div class="photo-viewer-backdrop" onclick="closePhotoViewer()"></div>
      <div class="photo-viewer-panel">
        <button class="photo-viewer-close" onclick="closePhotoViewer()">Close</button>
        <img id="photoViewerImg" alt="">
        <p id="photoViewerName"></p>
      </div>
    `;
    document.body.appendChild(viewer);
  }
  $("photoViewerImg").src = image.src;
  $("photoViewerImg").alt = image.alt || "Product photo";
  $("photoViewerName").textContent = button.dataset.name || image.alt || "Product photo";
  viewer.classList.remove("hidden");
};

window.closePhotoViewer = () => {
  const viewer = $("photoViewer");
  if (viewer) viewer.classList.add("hidden");
};

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const maxSide = 900;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.78));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function calculateMercuryInvoiceTotal(batch) {
  if (!mercuryPrices.length) return 0;
  return (batch.purchases || []).reduce((sum, purchase) => (
    sum + activeInvoiceItems(purchase.items || []).reduce((itemSum, item) => {
      const product = findMercuryProductForItem(item);
      if (!product) return itemSum;
      const quote = getMercuryPriceForItem(product, item.expiration, item.condition);
      return itemSum + Number(item.quantity || 0) * Number(quote?.price || 0);
    }, 0)
  ), 0);
}

function findMercuryProductForItem(item) {
  const itemText = normalizeMatchText(`${item.brand || ""} ${item.model || ""}`);
  if (!itemText) return null;
  return mercuryPrices.find((product) => normalizeMatchText(product.product) === itemText)
    || mercuryPrices.find((product) => itemText.includes(normalizeMatchText(product.product)))
    || mercuryPrices.find((product) => normalizeMatchText(product.product).includes(itemText));
}

function getMercuryPriceForItem(product, expiration, condition) {
  const damaged = /damaged/i.test(condition || "");
  const prices = (product.prices || []).filter((entry) => entry.damaged === damaged && entry.price !== null);
  const fallback = prices[0] || (product.prices || []).find((entry) => entry.price !== null) || null;
  const months = monthsUntilExpiration(expiration);
  if (months === null) return fallback;
  return prices.find((entry) => months >= monthsFromTier(entry.label)) || fallback;
}

function monthsUntilExpiration(expiration) {
  if (!/^\d{4}-\d{2}$/.test(String(expiration || ""))) return null;
  const [year, month] = expiration.split("-").map(Number);
  const now = new Date();
  return (year - now.getFullYear()) * 12 + (month - (now.getMonth() + 1));
}

function monthsFromTier(label) {
  const match = String(label || "").match(/(\d+)\+?\s*MO/i);
  return match ? Number(match[1]) : 0;
}

function normalizeMatchText(value) {
  return cleanMercuryProductName(value).toLowerCase().replace(/\[[^\]]*]/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

function cleanMercuryProductName(value) {
  return String(value || "").replace(/\s*\[\s*ding\s*-\s*\$?\d+(?:\.\d+)?\s*]/gi, "").trim();
}

async function api(url, options = {}) {
  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (response.status === 401 && !options.silent) {
      $("login").classList.remove("hidden");
      $("app").classList.add("hidden");
    }
    const data = await response.json().catch(() => ({}));
    return response.ok ? data : { error: data.error || "Request failed." };
  } catch {
    return { error: "Could not reach the server." };
  }
}

function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function normalizeSource(value) {
  const text = String(value || "").trim();
  if (!text) return "Unknown";
  if (/facebook|fb|marketplace/i.test(text)) return "Facebook";
  if (/instagram|insta|ig/i.test(text)) return "Instagram";
  if (/referral|referred|friend|family/i.test(text)) return "Referral";
  return text;
}

function isDue(value) {
  if (!value) return false;
  const due = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due <= today;
}

function firstName(value) {
  return String(value || "").trim().split(/\s+/)[0] || "there";
}

function formatDateOnly(value) {
  if (!value) return "N/A";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleDateString();
}

function formatDateTime(value) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleDateString();
}

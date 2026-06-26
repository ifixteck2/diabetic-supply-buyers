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
let editItemsByPurchase = {};
let mercuryPrices = [];

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
  $("lookupPhone").addEventListener("blur", lookupCustomer);
  $("lookupPhone").addEventListener("keydown", (event) => {
    if (event.key === "Enter") lookupCustomer();
  });
  $("addItemBtn").onclick = addItem;
  $("clearItemBtn").onclick = clearItem;
  $("clearInvoiceBtn").onclick = clearInvoice;
  $("savePurchaseBtn").onclick = savePurchase;
  $("createBatchBtn").onclick = createBatch;
  $("saveLeadBtn").onclick = saveLead;
  $("clearLeadBtn").onclick = clearLead;
  $("refreshFollowupsBtn").onclick = loadFollowups;
  $("saveCustomerProfileBtn").onclick = saveCustomerProfile;
  $("clearCustomerProfileBtn").onclick = clearCustomerProfile;
  $("backToCustomersBtn").onclick = showCustomerList;
  $("photoInput").onchange = handlePhotoInput;
  $("clearPhotosBtn").onclick = clearPhotos;
  $("invoiceFilter").onchange = loadBatches;
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
}

async function refreshAll() {
  await loadBuyerPrices();
  await Promise.all([loadBatches(), loadCustomers(), loadFollowups()]);
  renderDashboard();
}

function openTab(name) {
  const titles = { dashboard: "Dashboard", leads: "Leads", followups: "Follow Ups", purchase: "New Purchase", invoices: "Active Invoices", customers: "Customers" };
  document.querySelectorAll(".tab").forEach((button) => button.classList.toggle("active", button.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.add("hidden"));
  $(`${name}Tab`).classList.remove("hidden");
  $("pageTitle").textContent = titles[name] || "Admin";
  if (name === "invoices") loadBatches();
  if (name === "customers") {
    showCustomerList();
    loadCustomers();
  }
  if (name === "followups") loadFollowups();
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

function renderDashboard() {
  const allActive = allBatchesCache.filter((batch) => batch.status === "Active");
  $("activeCount").textContent = allActive.length;
  $("soldCount").textContent = allBatchesCache.filter((batch) => batch.status === "Sold").length;
  $("shippedCount").textContent = allBatchesCache.filter((batch) => batch.status === "Shipped").length;
  $("followupCount").textContent = followupsCache.length;
  $("activeValue").textContent = money(allActive.reduce((sum, batch) => sum + Number(batch.total_paid || 0), 0));
  $("dashboardFollowups").innerHTML = followupsCache.slice(0, 4).map(renderCustomerRow).join("") || `<div class="empty">No follow ups due right now.</div>`;
  $("dashboardInvoices").innerHTML = allActive.slice(0, 5).map(renderBatchCard).join("") || `<div class="empty">No active invoices right now.</div>`;
}

function renderBatchCard(batch) {
  const profit = Number(batch.sale_price || 0) - Number(batch.total_paid || 0);
  const mercuryTotal = calculateMercuryInvoiceTotal(batch);
  const purchasesHtml = (batch.purchases || []).map((purchase) => {
    const itemsHtml = (purchase.items || []).map((item) => (
      `<li>${item.quantity}x ${escapeHtml(item.brand)} ${escapeHtml(item.model)} - ${escapeHtml(item.condition)} - ${money(item.unit_cost)} each</li>`
    )).join("");
    return `<div class="purchase-block">
      <p><b>${escapeHtml(purchase.customer_name || "Customer")}</b> - ${formatPhone(purchase.customer_phone)} - ${new Date(purchase.purchase_date).toLocaleDateString()} - ${money(purchase.total_paid)}</p>
      <ul>${itemsHtml}</ul>
      ${renderPhotoStrip(purchase.photos || [])}
      ${purchase.notes ? `<p class="mini">${escapeHtml(purchase.notes)}</p>` : ""}
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
        </div>
      </div>
    </article>
  `;
}

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
    return;
  }
  container.innerHTML = customersCache.map(renderCustomerRow).join("");
}

function renderFollowups() {
  const container = $("followupList");
  if (!container) return;
  container.innerHTML = followupsCache.map(renderCustomerRow).join("") || `<div class="empty">No follow ups due right now.</div>`;
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
        ${customer.next_follow_up_at ? `<p class="mini"><b>Follow up:</b> ${new Date(`${customer.next_follow_up_at}T00:00:00`).toLocaleDateString()}</p>` : ""}
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
  showCustomerList();
  fillCustomerProfile(result.customer);
};

function showCustomerList() {
  $("customerManagerPanel").classList.add("hidden");
  $("customerProfilePanel").classList.remove("hidden");
  $("customerListPanel").classList.remove("hidden");
}

function showCustomerManager(customer, invoices) {
  managerPhone = cleanPhone(customer.phone);
  managerInvoicesCache = invoices || [];
  $("customerProfilePanel").classList.add("hidden");
  $("customerListPanel").classList.add("hidden");
  $("customerManagerPanel").classList.remove("hidden");
  $("customerManager").innerHTML = renderCustomerManager(customer, invoices);
}

function renderCustomerManager(customer, invoices) {
  const totalPaid = invoices.reduce((sum, invoice) => sum + Number(invoice.total_paid || 0), 0);
  const itemCount = invoices.reduce((sum, invoice) => sum + (invoice.items || []).reduce((itemSum, item) => itemSum + Number(item.quantity || 0), 0), 0);
  return `
    <div class="stats customer-stats">
      <article class="stat"><span>Total paid</span><strong>${money(totalPaid)}</strong></article>
      <article class="stat"><span>Purchases</span><strong>${invoices.length}</strong></article>
      <article class="stat"><span>Items bought</span><strong>${itemCount}</strong></article>
      <article class="stat"><span>Follow up</span><strong>${customer.next_follow_up_at ? new Date(`${customer.next_follow_up_at}T00:00:00`).toLocaleDateString() : "None"}</strong></article>
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

window.editPurchase = (id) => {
  const invoice = managerInvoicesCache.find((entry) => Number(entry.id) === Number(id));
  if (!invoice) return alert("Purchase not found. Refresh the customer and try again.");
  editItemsByPurchase[id] = (invoice.items || []).map((item) => ({ ...item }));
  renderPurchaseEditor(invoice);
};

window.addEditPurchaseItem = (id) => {
  const invoice = managerInvoicesCache.find((entry) => Number(entry.id) === Number(id));
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
  const invoice = managerInvoicesCache.find((entry) => Number(entry.id) === Number(id));
  if (!invoice) return;
  editItemsByPurchase[id] = readEditPurchaseItems(id).filter((_, itemIndex) => itemIndex !== index);
  renderPurchaseEditor(invoice);
};

window.cancelEditPurchase = (id) => {
  editItemsByPurchase[id] = [];
  const editor = $(`purchaseEditor-${id}`);
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
  await reloadCustomerManager();
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
    await reloadCustomerManager();
  };
  input.click();
};

function renderPurchaseEditor(invoice) {
  const id = invoice.id;
  const editor = $(`purchaseEditor-${id}`);
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
  const row = document.querySelector(`#purchaseEditor-${id} [data-edit-item="${index}"]`);
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
  const row = document.querySelector(`#purchaseEditor-${id} [data-edit-item="${index}"]`);
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
  return Array.from(document.querySelectorAll(`#purchaseEditor-${id} [data-edit-item]`)).map((row) => {
    const index = row.dataset.editItem;
    const notesRow = document.querySelector(`#purchaseEditor-${id} [data-edit-item-notes="${index}"]`);
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
    sum + (purchase.items || []).reduce((itemSum, item) => {
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

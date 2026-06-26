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
  const item = {
    category: $("category").value,
    brand: $("brand").value.trim(),
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
          <label>Sold to<input id="soldTo-${batch.id}" value="${escapeAttr(batch.sold_to || "")}" placeholder="Buyer name / company"></label>
          <label>Sold for<input id="salePrice-${batch.id}" type="number" min="0" step="0.01" value="${batch.sale_price || ""}" placeholder="0.00"></label>
          <label>Sale notes<input id="saleNotes-${batch.id}" value="${escapeAttr(batch.sale_notes || "")}" placeholder="Tracking, marketplace, payment notes"></label>
        </div>
        <div class="sale-summary"><span>Paid: ${money(batch.total_paid)}</span><span>Sold: ${money(batch.sale_price)}</span><strong>Profit: ${money(profit)}</strong></div>
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
    },
  });
  if (result?.ok) await loadBatches();
  else alert(result?.error || "Could not update invoice.");
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
    </article>
  `).join("");
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
  return `<div class="photo-strip">${savedPhotos.map((photo) => `<img src="${photo.data_url}" alt="${escapeAttr(photo.file_name || "Product photo")}">`).join("")}</div>`;
}

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

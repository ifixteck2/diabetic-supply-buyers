const $ = (id) => document.getElementById(id);
const money = (value) => Number(value || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
const cleanPhone = (value) => String(value || "").replace(/\D/g, "").slice(-10);
const formatPhone = (value) => cleanPhone(value).replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3");
const status = (id, message, type = "ok") => {
  $(id).innerHTML = message ? `<div class="status ${type}">${message}</div>` : "";
};

let items = [];
let loadedCustomer = null;
let invoicesCache = [];
let allInvoicesCache = [];
let customersCache = [];

init();

async function init() {
  $("purchaseDate").value = new Date().toISOString().slice(0, 10);
  bindEvents();
  renderItems();

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
  $("invoiceFilter").onchange = loadInvoices;
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
  await Promise.all([loadInvoices(), loadCustomers()]);
  renderDashboard();
}

function openTab(name) {
  const titles = { dashboard: "Dashboard", purchase: "New Purchase", invoices: "Active Invoices", customers: "Customers" };
  document.querySelectorAll(".tab").forEach((button) => button.classList.toggle("active", button.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.add("hidden"));
  $(`${name}Tab`).classList.remove("hidden");
  $("pageTitle").textContent = titles[name] || "Admin";
  if (name === "invoices") loadInvoices();
  if (name === "customers") loadCustomers();
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
    $("customerNotes").value = loadedCustomer.notes || "";
    status("customerStatus", "Customer found. History loaded.");
  } else {
    $("customerName").value = "";
    $("customerEmail").value = "";
    $("customerNotes").value = "";
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
  ["lookupPhone", "customerName", "customerEmail", "customerNotes", "invoiceNotes"].forEach((id) => ($(id).value = ""));
  $("purchaseDate").value = new Date().toISOString().slice(0, 10);
  $("payoutMethod").value = "Cash";
  clearItem();
  renderItems();
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
      customer: {
        name: $("customerName").value.trim(),
        phone,
        email: $("customerEmail").value.trim(),
        notes: $("customerNotes").value.trim(),
      },
      invoice: {
        purchase_date: $("purchaseDate").value,
        payout_method: $("payoutMethod").value,
        notes: $("invoiceNotes").value.trim(),
      },
      items,
    },
  });

  if (result?.ok) {
    status("saveStatus", `Saved as Active invoice with ${result.items_saved} item(s).`);
    items = [];
    renderItems();
    await Promise.all([lookupCustomer(), loadInvoices(), loadCustomers()]);
    renderDashboard();
  } else {
    status("saveStatus", result?.error || "Could not save purchase.", "bad");
  }
}

async function loadInvoices() {
  const filter = $("invoiceFilter")?.value || "Active";
  const [filtered, all] = await Promise.all([
    api(`/api/invoices?status=${encodeURIComponent(filter)}`),
    api("/api/invoices?status=All"),
  ]);
  invoicesCache = filtered.invoices || [];
  allInvoicesCache = all.invoices || [];
  renderInvoices();
  renderDashboard();
}

function renderInvoices() {
  const container = $("invoiceList");
  if (!container) return;
  if (!invoicesCache.length) {
    container.innerHTML = `<div class="empty">No invoices found for this view.</div>`;
    return;
  }
  container.innerHTML = invoicesCache.map(renderInvoiceCard).join("");
}

function renderDashboard() {
  const allActive = allInvoicesCache.filter((invoice) => invoice.status === "Active");
  $("activeCount").textContent = allActive.length;
  $("soldCount").textContent = allInvoicesCache.filter((invoice) => invoice.status === "Sold").length;
  $("shippedCount").textContent = allInvoicesCache.filter((invoice) => invoice.status === "Shipped").length;
  $("activeValue").textContent = money(allActive.reduce((sum, invoice) => sum + Number(invoice.total_paid || 0), 0));
  $("dashboardInvoices").innerHTML = allActive.slice(0, 5).map(renderInvoiceCard).join("") || `<div class="empty">No active invoices right now.</div>`;
}

function renderInvoiceCard(invoice) {
  const itemsHtml = (invoice.items || []).map((item) => `
    <li>${item.quantity}x ${escapeHtml(item.brand)} ${escapeHtml(item.model)} - ${escapeHtml(item.condition)} - ${money(item.unit_cost)} each</li>
  `).join("");
  return `
    <article class="invoice-card">
      <div class="invoice-top">
        <div>
          <h3>#${invoice.id} - ${escapeHtml(invoice.customer_name || "Customer")}</h3>
          <p>${formatPhone(invoice.customer_phone)} - ${new Date(invoice.purchase_date).toLocaleDateString()} - ${escapeHtml(invoice.payout_method)}</p>
        </div>
        <span class="pill ${invoice.status?.toLowerCase()}">${escapeHtml(invoice.status || "Active")}</span>
      </div>
      <ul>${itemsHtml}</ul>
      ${invoice.notes ? `<p class="mini">${escapeHtml(invoice.notes)}</p>` : ""}
      <div class="invoice-actions">
        <strong>${money(invoice.total_paid)}</strong>
        <div>
          <button class="mini-btn" onclick="setInvoiceStatus(${invoice.id}, 'Active')">Active</button>
          <button class="mini-btn" onclick="setInvoiceStatus(${invoice.id}, 'Sold')">Sold</button>
          <button class="mini-btn" onclick="setInvoiceStatus(${invoice.id}, 'Shipped')">Shipped</button>
        </div>
      </div>
    </article>
  `;
}

window.setInvoiceStatus = async (id, nextStatus) => {
  const result = await api(`/api/invoices/${id}/status`, { method: "PATCH", body: { status: nextStatus } });
  if (result?.ok) await loadInvoices();
  else alert(result?.error || "Could not update invoice.");
};

async function loadCustomers() {
  const search = $("customerSearch")?.value || "";
  const result = await api(`/api/customers?search=${encodeURIComponent(search)}`);
  customersCache = result.customers || [];
  renderCustomers();
}

function renderCustomers() {
  const container = $("customerList");
  if (!container) return;
  if (!customersCache.length) {
    container.innerHTML = `<div class="empty">No customers found.</div>`;
    return;
  }
  container.innerHTML = customersCache.map((customer) => `
    <article class="customer-row">
      <div>
        <h3>${escapeHtml(customer.name || "No name yet")}</h3>
        <p>${formatPhone(customer.phone)} ${customer.email ? "- " + escapeHtml(customer.email) : ""}</p>
        ${customer.notes ? `<p class="mini">${escapeHtml(customer.notes)}</p>` : ""}
      </div>
      <div class="customer-meta">
        <strong>${money(customer.total_paid)}</strong>
        <span>${customer.invoice_count} invoice(s)</span>
        <button class="mini-btn" onclick="loadCustomerIntoPurchase('${customer.phone}')">View History</button>
      </div>
    </article>
  `).join("");
}

window.loadCustomerIntoPurchase = async (phone) => {
  openTab("purchase");
  $("lookupPhone").value = formatPhone(phone);
  await lookupCustomer();
};

function renderHistory(invoices) {
  if (!invoices.length) {
    $("history").innerHTML = "<p>No purchase history yet.</p>";
    return;
  }
  $("history").innerHTML = invoices.map((invoice) => `
    <article class="history-card">
      <div class="invoice-top">
        <h3>#${invoice.id} - ${new Date(invoice.purchase_date).toLocaleDateString()} - ${money(invoice.total_paid)}</h3>
        <span class="pill ${invoice.status?.toLowerCase()}">${escapeHtml(invoice.status || "Active")}</span>
      </div>
      <p class="mini">Payout: ${escapeHtml(invoice.payout_method)} ${invoice.notes ? "- " + escapeHtml(invoice.notes) : ""}</p>
      <ul>${invoice.items.map((item) => `<li>${item.quantity}x ${escapeHtml(item.brand)} ${escapeHtml(item.model)} - ${escapeHtml(item.condition)} - ${money(item.unit_cost)} each</li>`).join("")}</ul>
    </article>
  `).join("");
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

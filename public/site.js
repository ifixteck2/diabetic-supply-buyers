const quotePhone = "5615101236";

function initQuoteAssistant() {
  if (document.querySelector(".quote-assistant")) return;
  const isSpanish = document.documentElement.lang === "es";
  const text = isSpanish ? {
    fab: "Ayuda Para Cotizar",
    title: "Asistente Sell Diabetics",
    subtitle: "Prepare su mensaje de cotizacion",
    intro: "Diganos que tiene. Esto prepara un mensaje de texto con los detalles necesarios para una cotizacion rapida.",
    supply: "Tipo de suministro",
    qty: "Cantidad",
    qtyPh: "Ejemplo: 5",
    exp: "Vencimiento",
    expPh: "Ejemplo: 11/2027",
    condition: "Condicion",
    area: "Area de recogida",
    areaPh: "Ejemplo: Greenacres",
    send: "Enviar Mi Cotizacion",
    close: "Cerrar",
    note: "Envie fotos del frente, atras, sello, cantidad y fecha de vencimiento. No ofrecemos consejos medicos.",
    options: ["Omnipod 5 Pods", "Dexcom G7 Sensors", "Dexcom G6 Sensors", "Freestyle Libre Sensors", "Tiras Reactivas", "Medidores / Receptores", "Otros Suministros Diabeticos"],
    conditions: ["Sellado / sin abrir", "Sellado con desgaste en caja", "Caja dentada", "No estoy seguro"],
    msg: (supply, qty, exp, condition, area) => `Hola, quiero una cotizacion para suministros diabeticos.%0AArticulo: ${encodeURIComponent(supply)}%0ACantidad: ${encodeURIComponent(qty)}%0AVencimiento: ${encodeURIComponent(exp)}%0ACondicion: ${encodeURIComponent(condition)}%0AArea: ${encodeURIComponent(area)}%0APuedo enviar fotos.`
  } : {
    fab: "Quote Help",
    title: "Sell Diabetics Assistant",
    subtitle: "Get your quote message ready",
    intro: "Tell us what you have. This prepares a text message with the details needed for a fast quote.",
    supply: "Supply type",
    qty: "Quantity",
    qtyPh: "Example: 5",
    exp: "Expiration",
    expPh: "Example: 11/2027",
    condition: "Condition",
    area: "Pickup area",
    areaPh: "Example: Greenacres",
    send: "Text My Quote",
    close: "Close",
    note: "Send photos of the front, back, seal, quantity, and expiration date. We do not provide medical advice.",
    options: ["Omnipod 5 Pods", "Dexcom G7 Sensors", "Dexcom G6 Sensors", "Freestyle Libre Sensors", "Test Strips", "Meters / Receivers", "Other Diabetic Supplies"],
    conditions: ["Sealed / unopened", "Sealed with box wear", "Dented box", "Not sure"],
    msg: (supply, qty, exp, condition, area) => `Hi, I want a quote for diabetic supplies.%0AItem: ${encodeURIComponent(supply)}%0AQuantity: ${encodeURIComponent(qty)}%0AExpiration: ${encodeURIComponent(exp)}%0ACondition: ${encodeURIComponent(condition)}%0AArea: ${encodeURIComponent(area)}%0AI can send photos.`
  };
  const assistant = document.createElement("div");
  assistant.className = "quote-assistant";
  assistant.innerHTML = `
    <button class="quote-fab" type="button" aria-expanded="false">${text.fab}</button>
    <section class="quote-chat hidden" aria-label="Quote assistant">
      <div class="quote-chat-head">
        <div>
          <strong>${text.title}</strong>
          <span>${text.subtitle}</span>
        </div>
        <button class="quote-close" type="button" aria-label="Close assistant">${text.close}</button>
      </div>
      <div class="quote-chat-body">
        <p>${text.intro}</p>
        <label>${text.supply}
          <select id="qaSupply">
            ${text.options.map((option) => `<option>${option}</option>`).join("")}
          </select>
        </label>
        <div class="qa-grid">
          <label>${text.qty}<input id="qaQty" inputmode="numeric" placeholder="${text.qtyPh}"></label>
          <label>${text.exp}<input id="qaExp" placeholder="${text.expPh}"></label>
        </div>
        <label>${text.condition}
          <select id="qaCondition">
            ${text.conditions.map((option) => `<option>${option}</option>`).join("")}
          </select>
        </label>
        <label>${text.area}<input id="qaArea" placeholder="${text.areaPh}"></label>
        <a class="btn quote-send" id="qaSend" href="sms:5615101236">${text.send}</a>
        <p class="mini">${text.note}</p>
      </div>
    </section>
  `;
  document.body.appendChild(assistant);

  const fab = assistant.querySelector(".quote-fab");
  const panel = assistant.querySelector(".quote-chat");
  const close = assistant.querySelector(".quote-close");
  const inputs = assistant.querySelectorAll("input,select");
  const send = assistant.querySelector("#qaSend");

  const updateMessage = () => {
    const supply = assistant.querySelector("#qaSupply").value;
    const qty = assistant.querySelector("#qaQty").value.trim() || "not sure";
    const exp = assistant.querySelector("#qaExp").value.trim() || "not sure";
    const condition = assistant.querySelector("#qaCondition").value;
    const area = assistant.querySelector("#qaArea").value.trim() || "not provided";
    send.href = `sms:${quotePhone}?body=${text.msg(supply, qty, exp, condition, area)}`;
  };
  const toggle = (open) => {
    panel.classList.toggle("hidden", !open);
    fab.setAttribute("aria-expanded", String(open));
  };

  fab.addEventListener("click", () => toggle(panel.classList.contains("hidden")));
  close.addEventListener("click", () => toggle(false));
  inputs.forEach((input) => input.addEventListener("input", updateMessage));
  inputs.forEach((input) => input.addEventListener("change", updateMessage));
  updateMessage();
}

document.addEventListener("DOMContentLoaded", initQuoteAssistant);

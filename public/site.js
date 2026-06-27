const quotePhone = "5615101236";

function initQuoteAssistant() {
  if (document.querySelector(".quote-assistant")) return;
  const assistant = document.createElement("div");
  assistant.className = "quote-assistant";
  assistant.innerHTML = `
    <button class="quote-fab" type="button" aria-expanded="false">Quote Help</button>
    <section class="quote-chat hidden" aria-label="Quote assistant">
      <div class="quote-chat-head">
        <div>
          <strong>Sell Diabetics Assistant</strong>
          <span>Get your quote message ready</span>
        </div>
        <button class="quote-close" type="button" aria-label="Close assistant">Close</button>
      </div>
      <div class="quote-chat-body">
        <p>Tell us what you have. This prepares a text message with the details needed for a fast quote.</p>
        <label>Supply type
          <select id="qaSupply">
            <option>Omnipod 5 Pods</option>
            <option>Dexcom G7 Sensors</option>
            <option>Dexcom G6 Sensors</option>
            <option>Freestyle Libre Sensors</option>
            <option>Test Strips</option>
            <option>Meters / Receivers</option>
            <option>Other Diabetic Supplies</option>
          </select>
        </label>
        <div class="qa-grid">
          <label>Quantity<input id="qaQty" inputmode="numeric" placeholder="Example: 5"></label>
          <label>Expiration<input id="qaExp" placeholder="Example: 11/2027"></label>
        </div>
        <label>Condition
          <select id="qaCondition">
            <option>Sealed / unopened</option>
            <option>Sealed with box wear</option>
            <option>Dented box</option>
            <option>Not sure</option>
          </select>
        </label>
        <label>Pickup area<input id="qaArea" placeholder="Example: Greenacres"></label>
        <a class="btn quote-send" id="qaSend" href="sms:5615101236">Text My Quote</a>
        <p class="mini">Send photos of the front, back, seal, quantity, and expiration date. We do not provide medical advice.</p>
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
    const text = `Hi, I want a quote for diabetic supplies.%0AItem: ${encodeURIComponent(supply)}%0AQuantity: ${encodeURIComponent(qty)}%0AExpiration: ${encodeURIComponent(exp)}%0ACondition: ${encodeURIComponent(condition)}%0AArea: ${encodeURIComponent(area)}%0AI can send photos.`;
    send.href = `sms:${quotePhone}?body=${text}`;
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

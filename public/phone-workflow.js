let phoneImportPreview = [];
let phoneImportBusy = false;
// Keep in sync with the temporary duplicate-check setting in the server workflow.
const phoneDuplicateImeiChecksEnabled = false;
const phoneWorkflowBusy = new Set();
const normalizedImei = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

async function loadPhoneDashboardPeriod() {
  const result=await api('/api/phone-dashboard-settings',{silent:true});
  if (!result?.ok) {
    phoneDashboardStartDate=null;
    status('phoneDashboardPeriodStatus','Could not load the reporting period. Refresh to load your current totals.','bad');
    return;
  }
  phoneDashboardStartDate=result.start_date;
  $('phoneDashboardStartDate').value=result.start_date;
  status('phoneDashboardPeriodStatus',`Showing activity on or after ${escapeHtml(result.start_date)}. Sales use their sale date, even when the invoice was created earlier. Archived invoices stay excluded.`);
}
async function savePhoneDashboardPeriod(button) {
  button.disabled=true;
  try {
    const result=await api('/api/phone-dashboard-settings',{method:'PATCH',body:{start_date:$('phoneDashboardStartDate').value}});
    if (!result?.ok) return status('phoneDashboardPeriodStatus',escapeHtml(result?.error || 'Could not save reporting date.'),'bad');
    phoneDashboardStartDate=result.start_date;
    renderPhoneDashboard();
    status('phoneDashboardPeriodStatus',`Showing activity on or after ${escapeHtml(result.start_date)}. Sales use their sale date, even when the invoice was created earlier. Archived invoices stay excluded.`);
  } finally {button.disabled=false;}
}

function phoneDuplicateMessage(result) {
  return `${result.error}\n\n${(result.matches || []).map(row=>`${row.model || 'Phone'} — ${row.invoice_id ? `invoice #${row.invoice_id}` : 'Holding'} (${row.location})`).join('\n')}\n\nAdd this IMEI again anyway?`;
}

function phonePreviewPayload(parsed, count) {
  applyQuickImeiFallback(parsed,count);
  const selected = phoneInvoices.find(invoice=>String(invoice.id)===$('phoneInvoiceSelect').value && invoice.buyer===parsed.buyer && !invoice.archived_at && invoice.status==='Pending');
  const fallback = phoneInvoices.find(invoice=>invoice.buyer===parsed.buyer && !invoice.archived_at && invoice.status==='Pending');
  const notes = [parsed.notes,...Object.entries(parsed.deductions).filter(([,on])=>on).map(([name])=>({crackedBack:'Cracked back',crackedLens:'Cracked lens',battery:'Battery / degraded battery',repair:'Repair message',faceId:'Bad Face ID'}[name]))].filter(Boolean).join(' | ');
  return {
    buyer:parsed.buyer, invoice_id:selected?.id || fallback?.id || null,
    model:[parsed.brand==='Apple' && /^\d/.test(parsed.modelText)?`iPhone ${parsed.modelText}`:parsed.modelText,parsed.storage==='N/A'?'':parsed.storage].filter(Boolean).join(' '),
    device_type:parsed.deviceType,condition_type:parsed.conditionType,packaging:parsed.conditionType==='New'?parsed.packaging:'',grade:parsed.grade,
    quantity:parsed.quantity,cost_each:parsed.cost,imei:parsed.imei,carrier:parsed.carrier,
    placed_at:parsed.priceSource || parsed.seller || parsed.placedAt || '',notes,
    purchase_date:$('phonePurchaseDate').value || localTodayInput(),
    holding_type:$('phoneHoldingType').value || 'Holding For Sale',
    client_request_id:crypto.randomUUID()
  };
}

async function previewQuickPhones() {
  if (phoneImportBusy) return;
  if (editingPhonePurchaseId) return status('quickPhoneStatus','Finish editing the current phone or click Clear before importing.','bad');
  const entries = quickPhoneEntries();
  if (!entries.length || entries.length>100) return status('quickPhoneStatus','Enter between 1 and 100 phone lines.','bad');
  phoneImportPreview = entries.map(entry=>{
    const parsed = parseQuickPhoneLine(entry);
    return {body:phonePreviewPayload(parsed,entries.length),original:parsed.raw,selected:true,saved:false,error:'',matches:[]};
  });
  renderPhoneImportPreview();
  status('quickPhoneStatus','Review the phones below. Nothing has been saved yet.');
  await checkPhonePreviewDuplicates();
}

async function checkPhonePreviewDuplicates() {
  if (!phoneDuplicateImeiChecksEnabled) return;
  const snapshot = phoneImportPreview;
  const result = await api('/api/phone-imei-check',{method:'POST',silent:true,body:{imeis:snapshot.filter(row=>!row.saved).map(row=>row.body.imei)}});
  if (snapshot!==phoneImportPreview) return;
  for (const row of snapshot) row.matches=(result?.matches || []).find(group=>group.imei===normalizedImei(row.body.imei))?.records || [];
  renderPhoneImportPreview();
  if (!result?.ok) status('quickPhoneStatus','Could not check existing IMEIs yet. They will be checked again when you save.','bad');
}

function phonePreviewProblems(row) {
  const body=row.body, issues=[];
  if (!body.model.trim()) issues.push('Enter a model');
  if (!Number.isSafeInteger(Number(body.quantity)) || Number(body.quantity)<1) issues.push('Enter a whole quantity');
  if (body.cost_each==='' || !Number.isFinite(Number(body.cost_each)) || Number(body.cost_each)<0) issues.push('Enter a cost');
  if (!body.placed_at.trim()) issues.push('Enter the source');
  if (!/^mike$/i.test(body.placed_at.trim()) && !body.imei.trim()) issues.push('Enter IMEI / serial (optional for Mike)');
  if (phoneDuplicateImeiChecksEnabled && body.imei && Number(body.quantity)>1) issues.push('Use one phone per row when entering an IMEI');
  const normalized=normalizedImei(body.imei);
  const duplicateInPreview = normalized && phoneImportPreview.some(other=>other!==row && other.selected && normalizedImei(other.body.imei)===normalized);
  if (phoneDuplicateImeiChecksEnabled && (row.matches.length || duplicateInPreview) && !body.allow_duplicate_imei) issues.push('Duplicate IMEI: review and acknowledge below');
  return issues;
}

function renderPhoneImportPreview() {
  const host=$('quickPhonePreview');
  if (!host) return;
  if (!phoneImportPreview.length) {host.innerHTML='';return;}
  const selected=phoneImportPreview.filter(row=>row.selected && !row.saved);
  const units=selected.reduce((sum,row)=>sum+Number(row.body.quantity || 0),0);
  const cost=selected.reduce((sum,row)=>sum+Number(row.body.quantity || 0)*Number(row.body.cost_each || 0),0);
  host.innerHTML=`<div class="phone-workflow-panel"><h3>Review before adding</h3><p>${units} phones selected · Total cost ${money(cost)}</p>
    ${phoneImportPreview.map((row,i)=>{
      const b=row.body, disabled=row.saved || phoneImportBusy ? 'disabled' : '';
      const issues=phonePreviewProblems(row);
      const invoiceOptions=phoneInvoices.filter(inv=>inv.buyer===b.buyer && inv.status==='Pending' && !inv.archived_at);
      const input=(field,label,type='text')=>`<label>${label}<input aria-label="${label}, row ${i+1}" type="${type}" ${type==='number'?'min="0" step="'+(field==='quantity'?'1':'0.01')+'"':''} value="${escapeAttr(b[field] ?? '')}" ${disabled} onchange="editPhonePreview(${i},'${field}',this.value)"></label>`;
      return `<fieldset class="phone-preview-row" ${disabled}><legend><label class="phone-check"><input type="checkbox" ${row.selected?'checked':''} ${disabled} onchange="selectPhonePreview(${i},this.checked)">Phone row ${i+1}${row.saved?' — Saved':''}</label></legend>
        <div class="phone-workflow-grid">${input('model','Model / storage')}${input('quantity','Quantity','number')}${input('cost_each','Cost each','number')}${input('imei','IMEI / serial')}${input('placed_at','Source')}${input('carrier','Carrier')}${input('grade','Grade')}
        <label>Buyer<select ${disabled} onchange="editPhonePreview(${i},'buyer',this.value)">${['KT','Atlas','Holding'].map(buyer=>`<option ${buyer===b.buyer?'selected':''}>${buyer}</option>`).join('')}</select></label>
        ${b.buyer==='Holding'?`<label>Holding section<select ${disabled} onchange="editPhonePreview(${i},'holding_type',this.value)">${['Holding For Sale','Holding For Trade In'].map(value=>`<option ${b.holding_type===value?'selected':''}>${value}</option>`).join('')}</select></label>`:`<label>Invoice<select ${disabled} onchange="editPhonePreview(${i},'invoice_id',this.value)"><option value="">Use latest pending / create if needed</option>${invoiceOptions.map(inv=>`<option value="${inv.id}" ${Number(b.invoice_id)===inv.id?'selected':''}>#${inv.id} ${escapeHtml(inv.label)}</option>`).join('')}</select></label>`}</div>
        ${phoneDuplicateImeiChecksEnabled && row.matches.length?`<p class="phone-warning">Already recorded: ${row.matches.map(match=>escapeHtml(`${match.invoice_id?'Invoice #'+match.invoice_id:'Holding'} — ${match.model} (${match.location})`)).join('; ')}</p>`:''}
        ${phoneDuplicateImeiChecksEnabled && b.imei?`<label class="phone-check"><input type="checkbox" ${b.allow_duplicate_imei?'checked':''} ${disabled} onchange="editPhonePreview(${i},'allow_duplicate_imei',this.checked)">I reviewed this IMEI and intend to add it again if it already exists.</label>`:''}
        ${!row.saved && issues.length?`<p class="phone-warning">${issues.map(escapeHtml).join(' · ')}</p>`:''}${row.error?`<p class="phone-warning">${escapeHtml(row.error)}</p>`:''}
      </fieldset>`;
    }).join('')}
    <div class="actions"><button class="btn phone-btn" ${phoneImportBusy || !selected.length?'disabled':''} onclick="savePhoneImportPreview()">${phoneImportBusy?'Saving…':'Add selected phones'}</button>${phoneDuplicateImeiChecksEnabled?`<button class="btn secondary" ${phoneImportBusy?'disabled':''} onclick="checkPhonePreviewDuplicates()">Check IMEIs</button>`:''}<button class="btn secondary" ${phoneImportBusy?'disabled':''} onclick="closePhoneImportPreview()">Close preview</button></div></div>`;
}

function editPhonePreview(index,field,value) {
  const row=phoneImportPreview[index];
  if (!row || row.saved || phoneImportBusy) return;
  row.body[field]=value;
  if (field==='buyer') row.body.invoice_id=null;
  if (field==='imei') {row.matches=[];row.body.allow_duplicate_imei=false;}
  row.error='';
  renderPhoneImportPreview();
}
function selectPhonePreview(index,selected) {
  if (phoneImportBusy || phoneImportPreview[index]?.saved) return;
  phoneImportPreview[index].selected=selected;
  renderPhoneImportPreview();
}
function closePhoneImportPreview() {
  if (phoneImportBusy) return;
  phoneImportPreview=[];
  renderPhoneImportPreview();
}
async function savePhoneImportPreview() {
  if (phoneImportBusy) return;
  const selected=phoneImportPreview.filter(row=>row.selected && !row.saved);
  if (!selected.length) return;
  if (selected.some(row=>phonePreviewProblems(row).length)) return status('quickPhoneStatus','Correct the marked rows before saving.','bad');
  phoneImportBusy=true;
  renderPhoneImportPreview();
  let added=0;
  try {
    for (const row of selected) {
      const body={...row.body,quantity:Number(row.body.quantity),cost_each:Number(row.body.cost_each),invoice_id:Number(row.body.invoice_id)||null};
      const result=await api(body.buyer==='Holding'?'/api/phone-holding':'/api/phone-purchases',{method:'POST',body,silent:true});
      if (result?.ok) {row.saved=true;row.error='';added++;}
      else {row.error=result?.error || 'Save could not be confirmed. Retry this row; its save reference prevents a duplicate.';if(result?.matches)row.matches=result.matches;}
    }
    // Successful rows are removed from the input so retrying never resubmits them.
    $('quickPhoneText').value=phoneImportPreview.filter(row=>!row.saved).map(row=>row.original).join('\n');
    if (phoneImportPreview.every(row=>row.saved)) $('quickPhoneImei').value='';
    await loadPhoneInvoices();
    await loadPhoneHolding();
    const failed=selected.length-added;
    status('quickPhoneStatus',`Saved ${added} phone row${added===1?'':'s'}.${failed?` ${failed} could not be saved; review the messages below.`:''}`,failed?'bad':'ok');
  } finally {phoneImportBusy=false;renderPhoneImportPreview();}
}

function renderPhoneBulkControls(invoice) {
  if (invoice.status!=='Pending' || invoice.archived_at || invoice.sale_price!==null && invoice.sale_price!==undefined) return '';
  const choices=phoneInvoices.filter(row=>row.id!==invoice.id && row.status==='Pending' && !row.archived_at && row.sale_price==null);
  return `<div class="phone-bulk-controls"><label class="phone-check"><input type="checkbox" onchange="selectAllInvoicePhones(${invoice.id},this.checked)">Select all phones</label>
    <label>Move selected to<select id="phoneBulkTarget${invoice.id}"><option value="holding-sale">Holding for sale</option><option value="holding-trade">Holding for trade in</option>${choices.map(row=>`<option value="${row.id}">#${row.id} ${escapeHtml(row.buyer)} — ${escapeHtml(row.label)}</option>`).join('')}</select></label>
    <button class="mini-btn" id="phoneBulkButton${invoice.id}" onclick="moveSelectedInvoicePhones(${invoice.id})">Move selected</button><span id="phoneBulkCount${invoice.id}" role="status">0 selected</span></div>`;
}
function renderPhoneSelection(invoice,row) {
  if (invoice.status!=='Pending' || invoice.archived_at || invoice.sale_price!=null || row.final_sell_each!=null) return '';
  return `<input class="phone-select-box" type="checkbox" data-phone-invoice="${invoice.id}" value="${row.id}" aria-label="Select ${escapeAttr(row.model)}" onchange="updatePhoneSelectionCount(${invoice.id})"> `;
}
function updatePhoneSelectionCount(id) {
  const selected=[...document.querySelectorAll(`[data-phone-invoice="${id}"]:checked`)];
  const target=$(`phoneBulkCount${id}`);if(target)target.textContent=`${selected.length} selected`;
}
function selectAllInvoicePhones(id,checked) {
  document.querySelectorAll(`[data-phone-invoice="${id}"]`).forEach(box=>{box.checked=checked;});
  updatePhoneSelectionCount(id);
}
async function moveSelectedInvoicePhones(id) {
  if (phoneWorkflowBusy.has(`bulk-${id}`)) return;
  const ids=[...document.querySelectorAll(`[data-phone-invoice="${id}"]:checked`)].map(box=>Number(box.value));
  if (!ids.length) return status('phoneWorkflowNotice','Select the phones you want to move.','bad');
  const target=$(`phoneBulkTarget${id}`).value;
  const body={source_invoice_id:id,purchase_ids:ids,destination:target.startsWith('holding-')?'Holding':'Invoice',invoice_id:Number(target)||null,holding_type:target==='holding-trade'?'Holding For Trade In':'Holding For Sale'};
  phoneWorkflowBusy.add(`bulk-${id}`);$(`phoneBulkButton${id}`).disabled=true;
  try {
    const result=await api('/api/phone-purchases/bulk-move',{method:'POST',body});
    if(!result?.ok)return status('phoneWorkflowNotice',escapeHtml(result?.error || 'Could not move phones.'),'bad');
    await loadPhoneInvoices();await loadPhoneHolding();
    status('phoneWorkflowNotice',`Moved ${result.moved} phone rows to ${body.destination==='Holding'?body.holding_type:'invoice #'+result.invoice_id}.`);
  } finally {phoneWorkflowBusy.delete(`bulk-${id}`);if($(`phoneBulkButton${id}`))$(`phoneBulkButton${id}`).disabled=false;}
}

function phoneFinalSummary(invoice) {
  const rows=invoice.purchases || [];
  const units=rows.reduce((sum,row)=>sum+Number(row.quantity),0);
  const cost=rows.reduce((sum,row)=>sum+Math.round(Number(row.cost_each)*100)*Number(row.quantity),0)/100;
  const priced=rows.filter(row=>row.final_sell_each!==null && row.final_sell_each!==undefined);
  const total=priced.reduce((sum,row)=>sum+Math.round(Number(row.final_sell_each)*100)*Number(row.quantity),0)/100;
  const complete=rows.length>0 && priced.length===rows.length;
  return {units,cost,total,complete,profit:complete?total-cost:null,target:units*60,variance:complete?total-cost-units*60:null};
}
function renderPhoneWorkflow(invoice) {
  if (!['KT','Atlas'].includes(invoice.buyer)) return '';
  const summary=phoneFinalSummary(invoice), id=invoice.id;
  const options=(values,chosen)=>values.map(value=>`<option ${value===chosen?'selected':''}>${value}</option>`).join('');
  return `<div class="phone-workflow-panel"><details><summary>Delivery &amp; payment · ${escapeHtml(invoice.delivery_status || 'Not Shipped')} · ${escapeHtml(invoice.payment_status || 'Awaiting Payment')}</summary>
    <div class="phone-workflow-grid">
    <label>Tracking number<input id="phoneTracking${id}" maxlength="160" value="${escapeAttr(invoice.tracking_number || '')}"></label>
    <label>Delivery<select id="phoneDelivery${id}">${options(['Not Shipped','Shipped','Delivered'],invoice.delivery_status || 'Not Shipped')}</select></label>
    <label>Payment<select id="phonePayment${id}">${options(['Awaiting Payment','Paid'],invoice.payment_status || 'Awaiting Payment')}</select></label>
    <label>Payment notes<input id="phonePaymentNotes${id}" maxlength="2000" value="${escapeAttr(invoice.payment_notes || '')}"></label></div>
    <p>${invoice.delivered_at?`Delivered ${escapeHtml(new Date(invoice.delivered_at).toLocaleString())}. `:''}${invoice.paid_at?`Paid ${escapeHtml(new Date(invoice.paid_at).toLocaleString())}.`:''}</p>
    <button class="mini-btn" onclick="savePhoneDelivery(${id},this)">Save delivery &amp; payment</button>
    </details><details><summary>Final prices · ${summary.complete?`Profit ${money(summary.profit)}`:'Not all prices entered'}</summary>
    <p>Profit target: ${money(summary.target)} (${money(60)} per phone). ${summary.complete?`Profit from phone prices: ${money(summary.profit)} · Difference from target: ${money(summary.variance)}.`:'Enter the final price each. Completing all rows updates the invoice sale total.'}</p>
    ${summary.complete && invoice.sale_price!=null && Math.abs(Number(invoice.sale_price)-summary.total)>0.005?`<p class="phone-warning">The invoice sale total (${money(invoice.sale_price)}) differs from the phone prices (${money(summary.total)}). Review the amounts before saving.</p>`:''}
    <div class="table-wrap"><table class="phone-final-table"><thead><tr><th>Phone</th><th>Qty</th><th>Cost each</th><th>Final price each</th><th>Profit each</th><th>Vs. $60 target</th></tr></thead><tbody>${(invoice.purchases || []).map(row=>{
      const profit=row.final_sell_each==null?null:Number(row.final_sell_each)-Number(row.cost_each);
      return `<tr><td>${escapeHtml(row.model)}${row.imei?`<br><small>${escapeHtml(row.imei)}</small>`:''}</td><td>${Number(row.quantity)}</td><td>${money(row.cost_each)}</td><td><input aria-label="Final price each for ${escapeAttr(row.model)}" data-phone-final="${id}" data-purchase-id="${row.id}" type="number" min="0" step="0.01" value="${row.final_sell_each==null?'':Number(row.final_sell_each)}"></td><td>${profit===null?'—':money(profit)}</td><td>${profit===null?'—':money(profit-60)}</td></tr>`;
    }).join('')}</tbody></table></div><button class="mini-btn" onclick="savePhoneFinalPrices(${id},this)" ${summary.units?'':'disabled'}>Save final prices</button>
    <p>Blank prices remain unfinished. An existing invoice sale total stays unchanged until all phone prices are entered.</p></details>
    <details><summary>Invoice activity</summary><p>Changes are recorded from this update onward.</p><button class="mini-btn" onclick="loadPhoneActivity(${id})">Load activity</button><div id="phoneActivity${id}" aria-live="polite"></div></details></div>`;
}
async function savePhoneDelivery(id,button) {
  if(phoneWorkflowBusy.has(`delivery-${id}`))return;
  phoneWorkflowBusy.add(`delivery-${id}`);button.disabled=true;
  try {
    const body={tracking_number:$(`phoneTracking${id}`).value,delivery_status:$(`phoneDelivery${id}`).value,payment_status:$(`phonePayment${id}`).value,payment_notes:$(`phonePaymentNotes${id}`).value};
    const result=await api(`/api/phone-invoices/${id}/workflow`,{method:'PATCH',body});
    if(!result?.ok)return status('phoneWorkflowNotice',escapeHtml(result?.error || 'Could not save delivery details.'),'bad');
    await refreshPhoneWorkflowInvoice(id);
    status('phoneWorkflowNotice',`Invoice #${id}: ${body.delivery_status}, ${body.payment_status}.`);
  } finally {phoneWorkflowBusy.delete(`delivery-${id}`);button.disabled=false;}
}
async function savePhoneFinalPrices(id,button) {
  if(phoneWorkflowBusy.has(`final-${id}`))return;
  const prices=[...document.querySelectorAll(`[data-phone-final="${id}"]`)].map(input=>({id:Number(input.dataset.purchaseId),final_sell_each:input.value}));
  phoneWorkflowBusy.add(`final-${id}`);button.disabled=true;
  try {
    const result=await api(`/api/phone-invoices/${id}/final-prices`,{method:'PATCH',body:{prices}});
    if(!result?.ok)return status('phoneWorkflowNotice',escapeHtml(result?.error || 'Could not save final prices.'),'bad');
    await refreshPhoneWorkflowInvoice(id);
    status('phoneWorkflowNotice',result.complete?`Invoice #${id}: final prices saved. Invoice total ${money(result.total)}.`:`Invoice #${id}: partial prices saved. The invoice sale total is unchanged.`);
  } finally {phoneWorkflowBusy.delete(`final-${id}`);button.disabled=false;}
}
async function refreshPhoneWorkflowInvoice(id) {
  await loadPhoneInvoices();
  $(`pastInvoiceDetail${id}`)?.classList.remove('hidden');
}
async function loadPhoneActivity(id,before='') {
  const host=$(`phoneActivity${id}`);
  const result=await api(`/api/phone-invoices/${id}/activity${before?'?before='+encodeURIComponent(before):''}`);
  if(!result?.ok){host.textContent=result?.error || 'Could not load history.';return;}
  const names={invoice_id:'Invoice',final_sell_each:'Final price each',cost_each:'Cost each',sale_price:'Invoice sale total',invoice_removed_reason:'Removal reason',delivery_status:'Delivery',payment_status:'Payment',tracking_number:'Tracking',archived_at:'Archived',invoice_removed_at:'Removed',returned_at:'Returned'};
  const html=(result.events || []).map(event=>`<li><strong>${escapeHtml(event.action)}${event.details.model?' · '+escapeHtml(event.details.model):''}</strong><small>${escapeHtml(new Date(event.created_at).toLocaleString())}</small><ul>${Object.entries(event.details.changes || {}).map(([key,value])=>`<li>${escapeHtml(names[key] || key.replaceAll('_',' '))}: ${escapeHtml(value.before==null?'Not set':String(value.before))} → ${escapeHtml(value.after==null?'Not set':String(value.after))}</li>`).join('')}</ul></li>`).join('');
  if(!before)host.innerHTML='';
  host.querySelector('.phone-history-more')?.remove();
  host.insertAdjacentHTML('beforeend',html?`<ol class="phone-activity-list">${html}</ol>`:'<p>No recorded changes yet.</p>');
  if(result.next_before)host.insertAdjacentHTML('beforeend',`<button class="mini-btn phone-history-more" onclick="loadPhoneActivity(${id},'${Number(result.next_before)}')">Load older changes</button>`);
}

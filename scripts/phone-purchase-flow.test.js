import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function setup() {
  const elements=new Map();
  const control=id=>{
    if(!elements.has(id)) {
      const element={value:'',files:[],disabled:false,classList:{toggle(){},add(){},remove(){}}};
      let html='';
      Object.defineProperty(element,'innerHTML',{get:()=>html,set(value){html=value;if(id==='phoneInvoiceSelect')element.value=String(value).match(/<option value="([^"]*)"/)?.[1]||'';}});
      elements.set(id,element);
    }
    return elements.get(id);
  };
  const context={console,Date,Intl,document:{body:{dataset:{}},getElementById:control},window:{}};
  vm.createContext(context);
  const run=code=>vm.runInContext(code,context);
  run(fs.readFileSync(new URL('../public/phone-admin.js',import.meta.url),'utf8').replace('initPhonePortal();',''));
  control('phoneBuyer').value='KT';
  run(`phoneInvoices=[
    {id:22,buyer:'KT',label:'Other pending',status:'Pending',purchases:[]},
    {id:21,buyer:'KT',label:'My new invoice',status:'Pending',purchases:[]},
    {id:20,buyer:'KT',label:'Archived invoice',status:'Pending',archived_at:'2026-10-09',purchases:[]},
    {id:19,buyer:'Atlas',label:'Atlas invoice',status:'Pending',purchases:[]}
  ];`);
  return {control,run,context};
}

test('refresh and quick fill retain the chosen pending invoice but never an archived or other-buyer invoice',()=>{
  const {control,run}=setup();
  control('phoneInvoiceSelect').value='21';
  run('renderInvoiceSelect()');
  assert.equal(control('phoneInvoiceSelect').value,'21');
  run(`toggleConditionFields=()=>{}; renderModelOptions=()=>{}; bestQuickModel=p=>p.modelText; ensureSelectOption=()=>{}; renderPhoneStorageOptions=()=>{}; renderCarrierOptions=()=>{}; updateProjectedPrice=()=>{}; updatePurchaseFlowVisibility=()=>{};`);
  run(`applyQuickPhoneFields(parseQuickPhoneLine('18 pro 256GB $900 Mike'))`);
  assert.equal(control('phoneInvoiceSelect').value,'21');
  control('phoneInvoiceSelect').value='20';
  run('renderInvoiceSelect()');
  assert.equal(control('phoneInvoiceSelect').value,'22');
  control('phoneBuyer').value='Atlas';
  run('renderInvoiceSelect()');
  assert.equal(control('phoneInvoiceSelect').value,'19');
});

test('failed text purchases retain input and display the actual error; successful saves alone clear text',async()=>{
  const {control,run,context}=setup();
  const text='18 pro 256GB $900 Mike';
  control('quickPhoneText').value=text;
  control('quickPhoneImei').value='SERIAL-TEST';
  control('phoneInvoiceSelect').value='21';
  run(`applyQuickPhoneFields=()=>renderInvoiceSelect();
    selectedKtPurchaseDeductions=()=>[]; selectedAtlasPurchaseDeductions=()=>[]; selectedCondition=()=> 'Grade A';
    resetPhonePurchase=()=>{}; loadPhoneInvoices=async()=>renderInvoiceSelect();`);
  const requests=[];
  let fail=true;
  context.fetch=async(url,options)=>{
    requests.push({url,body:JSON.parse(options.body)});
    return {ok:!fail,text:async()=>JSON.stringify(fail?{error:'Pending invoice not found for that buyer.'}:{ok:true,invoice:{id:21,buyer:'KT'}})};
  };
  await run('parseQuickPhoneText(true)');
  assert.equal(requests[0].body.invoice_id,21);
  assert.equal(control('quickPhoneText').value,text);
  assert.equal(control('quickPhoneImei').value,'SERIAL-TEST');
  assert.match(control('quickPhoneStatus').innerHTML,/Pending invoice not found/);
  assert.doesNotMatch(control('quickPhoneStatus').innerHTML,/Added/);
  fail=false;
  await run('parseQuickPhoneText(true)');
  assert.equal(requests[1].body.invoice_id,21);
  assert.equal(control('quickPhoneText').value,'');
  assert.equal(control('quickPhoneImei').value,'');
  assert.match(control('quickPhoneStatus').innerHTML,/Added/);
  assert.equal(control('phoneInvoiceSelect').value,'21');
});

test('repeated create clicks send one request, reuse the empty invoice, and release the button on failure',async()=>{
  const {control,run,context}=setup();
  let finish;
  let calls=0;
  context.fetch=async()=>{calls++;return new Promise(resolve=>{finish=resolve;});};
  run('loadPhoneInvoices=async()=>renderInvoiceSelect()');
  const first=run('createPhoneInvoice()');
  assert.equal(control('createPhoneInvoiceBtn').disabled,true);
  run('renderInvoiceSelect()');
  assert.equal(control('createPhoneInvoiceBtn').disabled,true);
  await run('createPhoneInvoice()');
  assert.equal(calls,1);
  finish({ok:true,text:async()=>JSON.stringify({ok:true,invoice:{id:21},reused:true})});
  await first;
  assert.equal(control('phoneInvoiceSelect').value,'21');
  assert.match(control('phonePurchaseStatus').innerHTML,/Using existing empty KT invoice #21/);
  assert.equal(control('createPhoneInvoiceBtn').disabled,false);
  const retry=run('createPhoneInvoice()');
  finish({ok:false,text:async()=>JSON.stringify({error:'Try again'})});
  await retry;
  assert.equal(control('createPhoneInvoiceBtn').disabled,false);
  assert.match(control('phonePurchaseStatus').innerHTML,/Try again/);
});

test('a pending create response does not select a KT invoice after switching buyers',async()=>{
  const {control,run,context}=setup();
  let finish;
  context.fetch=async()=>new Promise(resolve=>{finish=resolve;});
  run('loadPhoneInvoices=async()=>renderInvoiceSelect()');
  const first=run('createPhoneInvoice()');
  control('phoneBuyer').value='Holding';
  finish({ok:true,text:async()=>JSON.stringify({ok:true,invoice:{id:21},reused:true})});
  await first;
  assert.equal(control('phoneInvoiceSelect').value,'');
  assert.equal(control('createPhoneInvoiceBtn').disabled,true);
});

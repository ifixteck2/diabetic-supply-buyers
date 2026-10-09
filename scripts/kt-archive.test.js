import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('KT archive preserves history and excludes archived invoices from active lists and totals',()=>{
  const elements=new Map();
  const control=id=>{if(!elements.has(id))elements.set(id,{value:'KT',innerHTML:'',disabled:false,classList:{toggle(){}}});return elements.get(id);};
  const sandbox={console,Date,Intl,document:{body:{dataset:{}},getElementById:control},window:{}};
  vm.createContext(sandbox);
  const source=fs.readFileSync(new URL('../public/phone-admin.js',import.meta.url),'utf8').replace('initPhonePortal();','');
  vm.runInContext(source,sandbox);
  const run=code=>vm.runInContext(code,sandbox);
  run(`phoneInvoices = [
    {id:1,buyer:'KT',label:'Old KT',status:'Sold',sale_price:160,archived_at:'2026-10-09',created_at:'2026-09-01',purchases:[{id:10,model:'iPhone 18 Pro',quantity:1,cost_each:100,notes:'keep <notes>'}]},
    {id:2,buyer:'KT',label:'Archived pending',status:'Pending',archived_at:'2026-10-09',created_at:'2026-09-01',purchases:[]},
    {id:3,buyer:'Atlas',label:'Atlas history',status:'Sold',sale_price:250,created_at:'2026-09-01',purchases:[{id:11,model:'iPhone 16',quantity:1,cost_each:200}]}
  ]; renderInvoiceSelect(); renderInvoiceGroup('ktPendingList','KT','Pending'); renderPastInvoices();`);
  assert.equal(run("buildCombinedPhoneStats('KT').invoices"),0);
  assert.equal(run("buildCombinedPhoneStats('KT').cost"),0);
  assert.equal(run("buildCombinedPhoneStats('Atlas').actualSale"),250);
  assert.equal(run('getPhoneMoneyEvents().length'),1);
  assert.match(control('ktPendingList').innerHTML,/No KT pending/);
  assert.doesNotMatch(control('phoneInvoiceSelect').innerHTML,/Archived pending/);
  assert.doesNotMatch(control('pastInvoicesList').innerHTML,/Old KT|Archived pending/);
  assert.match(control('pastInvoicesList').innerHTML,/Atlas history/);
  assert.match(control('ktArchiveList').innerHTML,/Old KT/);
  assert.match(control('ktArchiveList').innerHTML,/\$160.00/);
  assert.match(control('ktArchiveList').innerHTML,/keep &lt;notes&gt;/);
  assert.match(control('ktArchiveList').innerHTML,/Restore Invoice/);
  assert.equal(control('archiveAllKtBtn').disabled,true);
  run("phoneInvoices[1].archived_at=null; renderInvoiceSelect(); renderInvoiceGroup('ktPendingList','KT','Pending'); renderKtArchive();");
  assert.equal(run("buildCombinedPhoneStats('KT').invoices"),1);
  assert.match(control('phoneInvoiceSelect').innerHTML,/Archived pending/);
  assert.equal(control('archiveAllKtBtn').disabled,false);
  assert.equal(run('phoneInvoices[0].sale_price'),160);
  assert.equal(run('phoneInvoices[0].status'),'Sold');
});

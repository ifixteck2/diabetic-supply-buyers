import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function setup() {
  const context={console,Date,Intl,document:{body:{dataset:{}}},window:{}};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(new URL('../public/phone-admin.js',import.meta.url),'utf8').replace('initPhonePortal();',''),context);
  const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
  vm.runInContext(server.slice(server.indexOf('function phoneInvoiceLinesWithPrices('),server.indexOf('function moneyText(')),context);
  return context;
}

test('pending and past invoice rows renumber after deletions and quantity changes, matching the buyer PDF',()=>{
  const context=setup();
  const records=[
    {id:90,model:'iPhone 18 Pro',quantity:1,cost_each:800,invoice_item_start:1},
    {id:91,model:'iPhone 18 Pro Max',quantity:2,cost_each:900,invoice_item_start:2},
    {id:92,model:'iPhone 17',quantity:1,cost_each:500,invoice_item_start:4}
  ];
  const cases=[
    {rows:records,labels:['1','2-3','4']},
    {rows:[records[0],records[2]],labels:['1','2']},
    {rows:[records[1],records[2]],labels:['1-2','3']},
    {rows:[records[0],{...records[1],quantity:3},records[2]],labels:['1','2-4','5']},
    {rows:[records[2],{...records[0],id:93,invoice_item_start:99}],labels:['1','2']},
    {rows:[],labels:[]}
  ];
  for (const {rows,labels} of cases) {
    const original=JSON.stringify(rows);
    for(const status of ['Pending','Shipped']) {
      const invoice={id:1,buyer:'KT',label:'KT test',status,created_at:'2026-10-26T12:00:00Z',purchases:rows};
      const html=context.renderPhoneInvoiceCard(invoice);
      const rowClass=status==='Pending'?'pending-phone-row':'phone-purchase-row';
      const matches=[...html.matchAll(new RegExp(`<tr class="${rowClass}">\\s*<td>([\\s\\S]*?)</td>`,'g'))];
      assert.deepEqual(matches.map(match=>match[1].replace(/<[^>]+>/g,'').trim()),labels,`${status}: ${labels}`);
    }
    const pdf=context.phoneInvoiceLinesWithPrices(rows,{});
    const units=rows.reduce((sum,row)=>sum+row.quantity,0);
    assert.deepEqual(Array.from(pdf,row=>row.item_number),Array.from({length:units},(_,index)=>String(index+1)));
    assert.equal(JSON.stringify(rows),original,'Renumbering preserves phone IDs, costs, and stored history');
  }
});

test('renumbering preserves PDF price assignments and gift card historical references',()=>{
  const context=setup();
  const row={id:50,model:'iPhone 18 Pro',quantity:2,invoice_item_start:17};
  const pdf=context.phoneInvoiceLinesWithPrices([row],{50:[850,875]});
  assert.deepEqual(Array.from(pdf,line=>[line.item_number,line.unit_price]),[['1',850],['2',875]]);
  assert.equal(context.phoneInvoiceItemNumber(row,1),'1-2');
  assert.equal(context.phoneInvoiceItemNumber(row,1,true),'17-18');
});

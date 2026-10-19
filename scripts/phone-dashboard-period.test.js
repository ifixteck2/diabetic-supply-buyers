import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('fresh start excludes every old buyer and transaction source without changing saved history',()=>{
  const context={Date,Intl,console,document:{body:{dataset:{}}},window:{}};
  vm.createContext(context);
  const run=code=>vm.runInContext(code,context);
  run(fs.readFileSync(new URL('../public/phone-admin.js',import.meta.url),'utf8').replace('initPhonePortal();',''));
  run(`phoneDashboardStartDate='2026-10-09';
    phoneInvoices=[
      {id:1,buyer:'KT',created_at:'2026-10-01T12:00:00Z',status:'Sold',sale_price:900,purchases:[{quantity:1,cost_each:800}],local_sold:[{quantity:1,cost_each:50,local_sale_price:100}],gift_cards:[{quantity:1,cost_each:50,gift_card_value:100}]},
      {id:2,buyer:'Atlas',created_at:'2026-10-08T12:00:00Z',status:'Sold',sale_price:1000,purchases:[{quantity:1,cost_each:800}]},
      {id:3,buyer:'Apple GC',created_at:'2026-10-08T12:00:00Z',gift_cards:[{quantity:1,cost_each:500,gift_card_value:600}]},
      {id:4,buyer:'KT',created_at:'2026-10-09T05:00:00Z',sold_at:'2026-10-10T12:00:00Z',status:'Sold',sale_price:860,purchases:[{quantity:1,cost_each:800}]},
      {id:5,buyer:'KT',created_at:'2026-10-09T03:59:00Z',status:'Pending',purchases:[{quantity:1,cost_each:99}]},
      {id:6,buyer:'Atlas',created_at:'2026-10-10T12:00:00Z',status:'Pending',purchases:[{quantity:1,cost_each:200}]}
    ];
    manualPhoneReturns=[
      {id:7,buyer:'KT',created_at:'2026-10-01T12:00:00Z',quantity:1,cost_each:100,sale_price:200},
      {id:8,buyer:'KT',created_at:'2026-10-10T12:00:00Z',returned_at:'2026-10-10',quantity:1,cost_each:50,sale_price:70}
    ];`);
  assert.equal(run('buildCombinedPhoneStats().cost'),1050);
  assert.equal(run('buildCombinedPhoneStats().actualSale'),930);
  assert.equal(run('buildCombinedPhoneStats().actualProfit'),80);
  assert.equal(run('buildCombinedPhoneStats("Atlas").actualSale'),0);
  assert.equal(run('getPhoneMoneyEvents().length'),2);
  assert.equal(run('getPhoneMoneyEvents().reduce((sum,event)=>sum+event.profit,0)'),80);
  assert.equal(run('phoneInvoices.length'),6,'Records remain available');
  assert.equal(run('manualPhoneReturns.length'),2);
  run('phoneDashboardStartDate=null');
  assert.equal(run('getPhoneMoneyEvents().length'),0,'Failed settings load never falls back to old totals');
  assert.equal(run('buildCombinedPhoneStats().cost'),0);
});

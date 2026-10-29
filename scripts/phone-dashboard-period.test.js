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

test('a current Atlas sale on an older invoice appears in both profit views without reviving old or archived transactions',()=>{
  const elements=new Map();
  const control=id=>{if(!elements.has(id)) elements.set(id,{innerHTML:''});return elements.get(id);};
  const context={Date,Intl,console,document:{body:{dataset:{}},getElementById:control},window:{}};
  vm.createContext(context);
  const run=code=>vm.runInContext(code,context);
  run(fs.readFileSync(new URL('../public/phone-admin.js',import.meta.url),'utf8').replace('initPhonePortal();',''));
  run(`phoneDashboardStartDate='2026-10-09';
    phoneInvoices=[
      {id:4,buyer:'Atlas',label:'Atlas current sale',created_at:'2026-07-04T12:00:00Z',sold_at:'2026-10-29T12:00:00Z',status:'Sold',sale_price:5220,purchases:[{quantity:16,cost_each:250},{quantity:1,cost_each:280}],
        local_sold:[{quantity:1,cost_each:50,local_sale_price:100,local_sold_at:'2026-09-01T12:00:00Z'}],gift_cards:[{quantity:1,cost_each:50,gift_card_value:100,gift_card_at:'2026-09-01T12:00:00Z'}]},
      {id:29,buyer:'KT',label:'C2G #1',created_at:'2026-10-16T12:00:00Z',sold_at:'2026-10-29T12:00:00Z',status:'Sold',sale_price:19200,purchases:[{quantity:1,cost_each:18140}]},
      {id:2,buyer:'Atlas',created_at:'2026-06-13T12:00:00Z',sold_at:'2026-07-03T12:00:00Z',status_updated_at:'2026-10-29T12:00:00Z',status:'Sold',sale_price:5670,purchases:[{quantity:1,cost_each:4550}]},
      {id:20,buyer:'KT',created_at:'2026-10-14T12:00:00Z',sold_at:'2026-10-29T12:00:00Z',archived_at:'2026-10-28T12:00:00Z',status:'Sold',sale_price:8000,purchases:[{quantity:1,cost_each:7480}]}
    ];`);
  assert.equal(run('buildCombinedPhoneStats("Atlas").actualProfit'),940);
  assert.equal(run('buildCombinedPhoneStats("Atlas").cost'),4280);
  assert.equal(run('buildCombinedPhoneStats("Atlas").units'),17);
  assert.equal(run('buildCombinedPhoneStats().actualProfit'),2000);
  assert.equal(run('getPhoneMoneyEvents().length'),2);
  assert.equal(run('getPhoneMoneyEvents().reduce((sum,row)=>sum+row.profit,0)'),2000);
  assert.equal(run('getPhoneMoneyEvents().find(row=>row.buyer==="Atlas").date.toISOString()'),'2026-10-29T12:00:00.000Z');
  run('renderPhoneDashboard()');
  assert.match(control('phoneBuyerBreakdown').innerHTML,/\$940/);
  assert.match(control('phoneDashboardStats').innerHTML,/\$2,000/);
  assert.match(control('phoneMoneyStats').innerHTML,/\$2,000/);
  run(`phoneInvoices[0].sale_price=null; phoneInvoices[0].sold_at=null; phoneInvoices[0].status='Shipped'; phoneInvoices[0].shipped_at='2026-10-28T12:00:00Z';`);
  assert.equal(run('buildCombinedPhoneStats("Atlas").shippedCost'),4280);
  assert.equal(run('buildCombinedPhoneStats("Atlas").needsSaleAmount'),1);
  assert.equal(run('buildCombinedPhoneStats("Atlas").actualProfit'),0,'Shipped inventory is not realized profit');
  assert.equal(run('getPhoneMoneyEvents().length'),1);
});

test('local sales, gift cards, and manual returns use their own transaction dates and New York cutoff',()=>{
  const context={Date,Intl,console,document:{body:{dataset:{}}},window:{}};
  vm.createContext(context);
  const run=code=>vm.runInContext(code,context);
  run(fs.readFileSync(new URL('../public/phone-admin.js',import.meta.url),'utf8').replace('initPhonePortal();',''));
  run(`phoneDashboardStartDate='2026-10-09';
    phoneInvoices=[{id:1,buyer:'Atlas',created_at:'2026-07-04T12:00:00Z',status:'Pending',purchases:[],
      local_sold:[{quantity:1,cost_each:50,local_sale_price:80,created_at:'2026-07-04T12:00:00Z',local_sold_at:'2026-10-09T04:00:00Z'}],
      gift_cards:[{quantity:1,cost_each:20,gift_card_value:40,created_at:'2026-07-04T12:00:00Z',gift_card_at:'2026-10-09T04:00:00Z'},
        {quantity:1,cost_each:50,gift_card_value:100,gift_card_at:'2026-10-09T03:59:59Z'}]}];
    manualPhoneReturns=[{id:2,buyer:'Atlas',created_at:'2026-07-04T12:00:00Z',returned_at:'2026-07-04',sold_at:'2026-10-09T04:00:00Z',quantity:1,cost_each:100,sale_price:130}];`);
  assert.equal(run('buildCombinedPhoneStats().actualProfit'),80);
  assert.equal(run('getPhoneMoneyEvents().reduce((sum,row)=>sum+row.profit,0)'),80);
  assert.equal(run('getPhoneMoneyEvents().length'),3);
  run("phoneInvoices[0].archived_at='2026-10-29';");
  assert.equal(run('buildCombinedPhoneStats().actualProfit'),30);
  assert.equal(run('getPhoneMoneyEvents().length'),1);
});

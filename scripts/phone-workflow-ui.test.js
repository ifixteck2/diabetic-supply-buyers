import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';

test('phone portal preview, bulk selection, prices, activity, and fresh-start dashboard work in a browser', {skip:!process.env.PHONE_PLAYWRIGHT_MODULE}, async t=>{
  const {chromium}=await import(pathToFileURL(process.env.PHONE_PLAYWRIGHT_MODULE).href);
  const root=fileURLToPath(new URL('../public/',import.meta.url));
  const fixtures=[
    {id:40,buyer:'KT',label:'Current KT',status:'Pending',created_at:'2026-10-19T12:00:00Z',sale_price:null,delivery_status:'Not Shipped',payment_status:'Awaiting Payment',purchases:[{id:400,model:'iPhone 18 Pro 256GB',quantity:1,cost_each:800,imei:'111111111111111',final_sell_each:null}]},
    {id:41,buyer:'KT',label:'Next shipment',status:'Pending',created_at:'2026-10-19T12:00:00Z',sale_price:null,purchases:[]},
    {id:30,buyer:'Atlas',label:'Old Atlas',status:'Sold',created_at:'2026-09-01T12:00:00Z',sale_price:900,purchases:[{id:300,model:'Old phone',quantity:1,cost_each:700}]}
  ];
  const requests=[];let failedOnce=false;
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/api/')){
      let text='';for await(const chunk of req)text+=chunk;
      const body=text?JSON.parse(text):{};requests.push({path:url.pathname,method:req.method,body});
      let result={ok:true};
      if(url.pathname==='/api/phone-me')result={ok:false};
      else if(url.pathname==='/api/phone-invoices')result={invoices:fixtures};
      else if(url.pathname==='/api/phone-holding')result={items:[]};
      else if(url.pathname==='/api/phone-dashboard-settings')result={ok:true,start_date:'2026-10-09'};
      else if(url.pathname==='/api/phone-imei-check')result={ok:true,matches:[{imei:'111111111111111',records:[{model:'iPhone 18 Pro',invoice_id:40,location:'Pending'}]}]};
      else if(url.pathname==='/api/phone-purchases'){
        if(body.model.includes('Pro Max') && !failedOnce){failedOnce=true;res.statusCode=400;result={error:'Test save failure: correct and retry'};}
        else result={ok:true,invoice:{id:40,buyer:'KT'}};
      }
      else if(url.pathname.endsWith('/activity'))result={ok:true,events:[{id:1,action:'Phone added',created_at:'2026-10-19T12:00:00Z',details:{model:'iPhone 18 Pro',changes:{quantity:{before:null,after:1}}}}]};
      else if(url.pathname==='/api/phone-purchases/bulk-move')result={ok:true,moved:body.purchase_ids.length,invoice_id:body.invoice_id};
      else if(url.pathname.endsWith('/final-prices'))result={ok:true,complete:true,total:860};
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));return;
    }
    const file=path.join(root,url.pathname==='/'?'phone-admin.html':url.pathname);
    if(!file.startsWith(root) || !fs.existsSync(file)){res.statusCode=404;res.end();return;}
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const browser=await chromium.launch({executablePath:process.env.PHONE_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>dialog.dismiss());
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(async rows=>{
    phoneInvoices=rows;manualPhoneReturns=[];
    document.getElementById('phoneLogin').classList.add('hidden');document.getElementById('phoneApp').classList.remove('hidden');
    document.getElementById('phoneBuyer').value='KT';
    renderInvoiceSelect();document.getElementById('phoneInvoiceSelect').value='40';
    await loadPhoneDashboardPeriod();renderInvoiceLists();renderPhoneDashboard();
  },fixtures);
  await page.locator('[data-phone-tab="dashboard"]').click();
  assert.match(await page.locator('#phoneDashboardPeriodStatus').innerText(),/2026-10-09/);
  assert.equal(await page.evaluate(()=>buildCombinedPhoneStats('Atlas').actualSale),0,'Old Atlas totals are excluded');
  assert.equal(await page.evaluate(()=>getPhoneMoneyEvents().length),0,'Old money events are excluded');
  assert.equal(await page.evaluate(()=>buildCombinedPhoneStats('KT').cost),800);
  await page.locator('[data-phone-tab="purchase"]').click();
  await page.locator('#quickPhoneText').fill('18 pro 256GB IMEI 111111111111111 $800 Mike\n18 pro max 256GB $900 Mike');
  await page.locator('#addQuickPhoneBtn').click();
  await page.getByText('Already recorded:',{exact:false}).waitFor();
  assert.equal(requests.filter(req=>req.path==='/api/phone-purchases').length,0,'Preview never saves');
  assert.equal(await page.locator('.phone-preview-row').count(),2);
  await page.locator('.phone-preview-row').first().getByRole('checkbox',{name:/I reviewed this IMEI/}).check();
  await page.getByRole('button',{name:'Add selected phones',exact:true}).click();
  await page.getByText('Saved 1 phone row. 1 could not be saved; review the messages below.',{exact:true}).waitFor();
  const firstRequests=requests.filter(req=>req.path==='/api/phone-purchases');
  assert.equal(firstRequests.length,2);
  assert.equal(firstRequests[0].body.invoice_id,40);
  assert.equal(firstRequests[0].body.allow_duplicate_imei,true);
  assert.equal(await page.locator('.phone-preview-row').first().getByRole('textbox').first().isDisabled(),true);
  assert.match(await page.locator('#quickPhoneText').inputValue(),/pro max/i);
  assert.doesNotMatch(await page.locator('#quickPhoneText').inputValue(),/111111111111111/);
  await page.getByRole('button',{name:'Add selected phones',exact:true}).click();
  await page.getByText('Saved 1 phone row.',{exact:true}).waitFor();
  const allRequests=requests.filter(req=>req.path==='/api/phone-purchases');
  assert.equal(allRequests.length,3);
  assert.equal(allRequests[2].body.client_request_id,allRequests[1].body.client_request_id,'Failed row retains its save reference');
  assert.equal(await page.locator('#quickPhoneText').inputValue(),'');
  await page.locator('[data-phone-tab="ktPending"]').click();
  await page.locator('[data-phone-invoice="40"]').check();
  assert.equal(await page.locator('#phoneBulkCount40').innerText(),'1 selected');
  await page.locator('#phoneBulkTarget40').selectOption('41');
  await page.locator('#phoneBulkButton40').click();
  await page.getByText('Moved 1 phone rows to invoice #41.',{exact:true}).waitFor();
  assert.deepEqual(requests.find(req=>req.path==='/api/phone-purchases/bulk-move').body.purchase_ids,[400]);
  const card=page.locator('.phone-invoice-card').filter({has:page.getByRole('heading',{name:'Current KT',exact:true})});
  await card.locator('summary').filter({hasText:'Delivery & payment'}).click();
  await page.locator('#phoneDelivery40').selectOption('Delivered');
  await page.locator('#phoneTracking40').fill('1Z-TEST');
  await card.getByRole('button',{name:'Save delivery & payment',exact:true}).click();
  await page.getByText('Invoice #40: Delivered, Awaiting Payment.',{exact:true}).waitFor();
  assert.equal(requests.find(req=>req.path==='/api/phone-invoices/40/workflow').body.tracking_number,'1Z-TEST');
  await card.locator('summary').filter({hasText:'Final prices'}).click();
  await page.locator('[data-phone-final="40"]').fill('860');
  await card.getByRole('button',{name:'Save final prices',exact:true}).click();
  await page.getByText('Invoice #40: final prices saved. Invoice total $860.00.',{exact:true}).waitFor();
  await card.locator('summary').filter({hasText:'Invoice activity'}).click();
  await card.getByRole('button',{name:'Load activity',exact:true}).click();
  await page.locator('#phoneActivity40').getByText('Phone added · iPhone 18 Pro',{exact:true}).waitFor();
  const output=process.env.PHONE_UI_OUTPUT;
  if(output){fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,'phone-workflow-desktop.png'),fullPage:true});}
  await page.setViewportSize({width:390,height:844});
  await page.locator('[data-phone-tab="purchase"]').click();
  await page.locator('#quickPhoneText').fill('18 pro 256GB $800 Mike\n18 pro max 256GB $900 Mike');
  await page.locator('#addQuickPhoneBtn').click();
  await page.locator('.phone-preview-row').first().waitFor();
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);
  assert.equal(overflow,false,'Mobile preview stays within viewport');
  if(output)await page.screenshot({path:path.join(output,'phone-workflow-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);
});

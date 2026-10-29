import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));
const reference = JSON.parse(fs.readFileSync(new URL('./phone-model-reference.json', import.meta.url), 'utf8'));

test('saved models match Drive capacities, normalize aliases, and never downgrade Pro Max to Pro', () => {
  const controls = new Map();
  const control = id => {
    if (!controls.has(id)) controls.set(id, {value:'',classList:{toggle(){},add(){},remove(){}}});
    return controls.get(id);
  };
  const context = vm.createContext({console,Date,Intl,document:{body:{dataset:{}},getElementById:control},window:{}});
  const run = code => vm.runInContext(code, context);
  run(fs.readFileSync(path.join(publicRoot,'phone-model-catalog.js'),'utf8'));
  run(fs.readFileSync(path.join(publicRoot,'phone-admin.js'),'utf8').replace('initPhonePortal();',''));
  const catalog = JSON.parse(run('JSON.stringify(PHONE_MODEL_CATALOG)'));
  assert.equal(new Set(catalog.map(row=>row.model)).size,catalog.length);
  for (const row of reference.models) {
    const actual = JSON.parse(run(`JSON.stringify(phoneStorageOptions('Phone','Apple',${JSON.stringify(row.model)},[{storage:'N/A'},{storage:'999GB'}]))`));
    assert.deepEqual(actual.sort(),[...row.storages].sort(),row.model);
  }
  for (const row of catalog) {
    assert.equal(run(`canonicalPhoneModel(${JSON.stringify(row.model)})`),row.model);
    assert.equal(run(`rowBrand({model:${JSON.stringify(row.model)}})`),row.brand);
  }
  assert.equal(run(`checkerModelName({model:'SE (2020) 64GB Unlocked'})`),'iPhone SE (2nd Gen)');
  assert.equal(run(`canonicalPhoneModel('Google Pixel 10 Pro Xl')`),'Pixel 10 Pro XL');
  assert.equal(run(`canonicalPhoneModel('Z Fold 7')`),'Galaxy Z Fold 7');
  control('deviceType').value='Phone';control('phoneBrand').value='Apple';control('phoneBuyer').value='KT';
  run(`atlasPrices=[{buyer:'KT',device_type:'Phone',base_model:'iPhone 18 Pro'}]`);
  assert.equal(run(`bestQuickModel({deviceType:'Phone',brand:'Apple',modelText:'18 Pro Max'})`),'iPhone 18 Pro Max');
  assert.equal(run(`bestQuickModel({deviceType:'Phone',brand:'Apple',modelText:'17e'})`),'iPhone 17e');
});

test('manual purchases work for every catalog model without pricing, and save new iPhones to each destination', {skip:!process.env.PHONE_PLAYWRIGHT_MODULE}, async t => {
  const {chromium} = await import(pathToFileURL(process.env.PHONE_PLAYWRIGHT_MODULE).href);
  const fixtures = ['KT','Atlas'].map((buyer,i)=>({id:40+i,buyer,label:`${buyer} test`,status:'Pending',purchases:[]}));
  const requests=[];
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/api/')){
      let text='';for await(const chunk of req)text+=chunk;
      const body=text?JSON.parse(text):{};
      requests.push({path:url.pathname,method:req.method,body});
      let result={ok:true};
      if(url.pathname==='/api/phone-me')result={ok:false};
      else if(url.pathname==='/api/phone-price-sheet') {res.statusCode=503;result={error:'Price connection unavailable'};}
      else if(url.pathname==='/api/phone-invoices')result={invoices:fixtures};
      else if(url.pathname==='/api/phone-holding')result={ok:true,items:[]};
      else if(url.pathname==='/api/phone-purchases')result={ok:true,invoice:fixtures.find(row=>row.buyer===body.buyer)};
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));return;
    }
    const file=path.join(publicRoot,url.pathname==='/'?'phone-admin.html':url.pathname);
    if(!file.startsWith(publicRoot)||!fs.existsSync(file)){res.statusCode=404;res.end();return;}
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const browser=await chromium.launch({executablePath:process.env.PHONE_CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(async rows=>{
    phoneInvoices=rows;
    $('phoneLogin').classList.add('hidden');$('phoneApp').classList.remove('hidden');
    await loadAtlasPrices();renderInvoiceSelect();openPhoneTab('purchase');
  },fixtures);
  // Exercise actual change handlers against all saved models, with both conditions and every buyer.
  const failures=await page.evaluate(()=>{
    const failures=[];
    const choose=(id,value)=>{$(id).value=value;$(id).dispatchEvent(new Event('change',{bubbles:true}));};
    for(const buyer of ['KT','Atlas','Holding'])for(const row of PHONE_MODEL_CATALOG)for(const condition of ['New','Used']){
      choose('phoneBuyer',buyer);choose('phoneBrand',row.brand);choose('phoneModel',row.model);
      const capacity=[...$('phoneStorage').options].find(option=>option.value)?.value;
      choose('phoneStorage',capacity);choose('phoneCarrier','Unlocked');choose('conditionType',condition);
      choose(condition==='New'?'packaging':'grade',condition==='New'?'Sealed':'Grade A');
      if($('phoneModel').value!==row.model||!$('phoneStorage').value||$('purchaseDetailsWrap').classList.contains('hidden')) failures.push(`${buyer} ${row.model} ${condition}`);
    }
    return failures;
  });
  assert.deepEqual(failures,[]);
  for(const buyer of ['KT','Atlas','Holding'])for(const condition of ['New','Used']){
    await page.locator('[data-phone-tab="purchase"]').click();
    await page.locator('#phoneBuyer').selectOption(buyer);
    await page.locator('#phoneBrand').selectOption('Apple');
    const model=condition==='New'?'iPhone 18 Pro Max':'iPhone 18 Pro';
    await page.locator('#phoneModel').selectOption(model);
    assert.deepEqual(await page.locator('#phoneStorage option').evaluateAll(options=>options.map(option=>option.value).filter(Boolean)),['256GB','512GB','1TB','2TB']);
    await page.locator('#phoneStorage').selectOption('2TB');
    await page.locator('#phoneCarrier').selectOption('Unlocked');
    await page.locator('#conditionType').selectOption(condition);
    await page.locator(condition==='New'?'#packaging':'#grade').selectOption(condition==='New'?'Sealed':'Grade A');
    await page.locator('#phoneCost').fill('900');
    await page.locator('#phoneQuantity').fill('2');
    await page.locator('#phonePlacedAt').fill('Mike');
    assert.equal(await page.locator('#phoneProjected').inputValue(),'','Missing quotes stay empty');
    const save=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().includes(buyer==='Holding'?'/api/phone-holding':'/api/phone-purchases'));
    await page.locator('#savePhonePurchaseBtn').click();await save;
    await page.waitForFunction(()=>$('phoneBrand').value==='');
    const posted=requests.filter(row=>row.method==='POST').at(-1);
    assert.equal(posted.body.model,`${model} 2TB`);
    assert.equal(posted.body.buyer,buyer);
    assert.equal(posted.body.quantity,2);
    assert.equal(posted.body.cost_each,900);
    assert.equal(posted.body.imei,'');
    assert.equal(posted.body.invoice_id,buyer==='KT'?40:buyer==='Atlas'?41:null);
  }
  // A network error (not just an HTTP error) must also leave the saved catalog usable.
  await page.route('**/api/phone-price-sheet',route=>route.abort());
  await page.evaluate(()=>loadAtlasPrices());
  await page.locator('[data-phone-tab="purchase"]').click();
  await page.locator('#phoneBuyer').selectOption('KT');
  await page.locator('#phoneBrand').selectOption('Apple');
  await page.locator('#phoneModel').selectOption('iPhone 18 Pro Max');
  await page.locator('#phoneStorage').selectOption('2TB');
  await page.locator('#phoneCarrier').selectOption('Unlocked');
  await page.locator('#conditionType').selectOption('New');
  await page.locator('#packaging').selectOption('Sealed');
  await page.locator('#phoneCost').fill('900');
  if(process.env.PHONE_UI_OUTPUT){
    fs.mkdirSync(process.env.PHONE_UI_OUTPUT,{recursive:true});
    await page.locator('.panel').filter({has:page.getByRole('heading',{name:'Device Flow',exact:true})}).screenshot({path:path.join(process.env.PHONE_UI_OUTPUT,'phone-models-manual.png')});
  }
  assert.deepEqual(errors,[]);
});

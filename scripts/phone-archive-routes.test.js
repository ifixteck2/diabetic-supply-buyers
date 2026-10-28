import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';

test('past invoices for every buyer can be archived and restored without changing phones or final prices', {skip:!process.env.PGLITE_TEST_MODULE}, async t => {
  const {PGlite} = await import(pathToFileURL(process.env.PGLITE_TEST_MODULE).href);
  const db = new PGlite(); t.after(()=>db.close());
  const source = fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
  await db.exec(source.slice(source.indexOf('create table if not exists phone_invoices ('),source.indexOf('create table if not exists phone_manual_returns (')));
  await db.exec('alter table phone_invoices add column archived_at timestamptz;');
  const routes = new Map();
  const auth = (req,res,next)=>req.authorized ? next() : res.status(401).json({error:'Sign in.'});
  const context = {app:{post:(path,...handlers)=>routes.set(path,handlers)},pool:db,requirePhoneAuth:auth};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('app.post("/api/phone-invoices/archive-kt",'),source.indexOf('app.post("/api/phone-invoices",')),context);
  async function call(path,id,authorized=true) {
    const handlers=routes.get(path);
    const req={params:{id},authorized};
    const res={statusCode:200,status(n){this.statusCode=n;return this;},json(value){this.body=value;return this;}};
    let allowed=false; await handlers[0](req,res,()=>{allowed=true;});
    if(allowed) await handlers[1](req,res);
    return res;
  }
  for(const buyer of ['KT','Atlas','Apple GC']) {
    const row=(await db.query("insert into phone_invoices(buyer,label,status,sale_price,sale_notes) values($1,$1,'Sold',500,'Keep payment details') returning *",[buyer])).rows[0];
    await db.query('insert into phone_purchases(invoice_id,buyer,quantity,cost_each) values($1,$2,2,100)',[row.id,buyer]);
    const phones=(await db.query('select * from phone_purchases order by id')).rows;
    assert.equal((await call('/api/phone-invoices/:id/archive',row.id,false)).statusCode,401);
    assert.equal((await call('/api/phone-invoices/:id/unarchive',row.id,false)).statusCode,401);
    assert.equal((await call('/api/phone-invoices/:id/archive',row.id)).body.ok,true);
    const archived=(await db.query('select * from phone_invoices where id=$1',[row.id])).rows[0];
    assert.ok(archived.archived_at);
    assert.deepEqual({...archived,archived_at:null},row);
    await call('/api/phone-invoices/:id/archive',row.id);
    assert.deepEqual((await db.query('select archived_at from phone_invoices where id=$1',[row.id])).rows[0].archived_at,archived.archived_at,'Retries preserve original archive date');
    assert.equal((await call('/api/phone-invoices/:id/unarchive',row.id)).body.ok,true);
    assert.deepEqual((await db.query('select * from phone_invoices where id=$1',[row.id])).rows[0],row);
    assert.deepEqual((await db.query('select * from phone_purchases order by id')).rows,phones);
  }
  const pending=(await db.query("insert into phone_invoices(buyer,label) values('KT','Keep pending') returning id")).rows[0];
  assert.equal((await call('/api/phone-invoices/:id/archive',pending.id)).statusCode,409);
  assert.equal((await db.query('select archived_at from phone_invoices where id=$1',[pending.id])).rows[0].archived_at,null);
  for(const id of ['oops',0,-1]) assert.equal((await call('/api/phone-invoices/:id/archive',id)).statusCode,400);
  assert.equal((await call('/api/phone-invoices/:id/unarchive',99999)).statusCode,404);
});

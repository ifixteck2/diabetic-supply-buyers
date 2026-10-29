import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';

test('automatic invoice names share a persistent number, use New York dates, and preserve retry-safe creation', {skip:!process.env.PGLITE_TEST_MODULE}, async t=>{
  const {PGlite}=await import(pathToFileURL(process.env.PGLITE_TEST_MODULE).href);
  const db=new PGlite(); t.after(()=>db.close());
  const source=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
  await db.exec(source.slice(source.indexOf('create table if not exists phone_invoices ('),source.indexOf('create table if not exists phone_manual_returns (')));
  await db.exec(`alter table phone_invoices add column archived_at timestamptz;
    insert into phone_invoices(buyer,label,status) values('Atlas','Existing Atlas','Sold'),('KT','Existing KT','Sold');
    insert into phone_invoices(buyer,label,status,archived_at) values('KT','Old KT','Sold',now()),('Apple GC','Gift cards','Closed',null);`);
  const numberingSchema=source.slice(source.indexOf('-- Sequential phone invoice names'),source.indexOf('-- End sequential phone invoice names.'));
  await db.exec(numberingSchema);
  let now='2026-10-30T02:00:00Z'; // Still October 29 in New York.
  const client={query:(sql,args)=>db.query(sql.replace('current_timestamp',`timestamptz '${now}'`),args),release(){}};
  const context={}; vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('async function lockPhoneInvoiceCreation('),source.indexOf('async function getOrCreateWeeklyGiftCardInvoice(')),context);
  vm.runInContext(source.slice(source.indexOf('function defaultPhoneInvoiceLabel('),source.indexOf('function createPhoneInvoiceHtml(')),context);
  const transact=async(fn,rollback=false)=>{
    await db.exec('begin');
    try {const result=await fn(); await db.exec(rollback?'rollback':'commit');return result;}
    catch(error){await db.exec('rollback');throw error;}
  };
  const create=buyer=>transact(()=>context.createOrReuseEmptyPhoneInvoice(client,buyer,'',''));
  const next=async()=>(await db.query('select next_number from phone_invoice_numbering')).rows[0].next_number;
  assert.equal(await next(),3,'Archived history and gift cards do not advance the initial fresh-start number');
  const atlas=await create('Atlas');
  assert.equal(atlas.invoice.label,'Atlas 10-29-26 #3');
  assert.equal((await create('Atlas')).invoice.id,atlas.invoice.id,'Double clicks reuse the same empty invoice');
  assert.equal(await next(),4,'Retries do not consume numbers');
  const kt=await create('KT');
  assert.equal(kt.invoice.label,'KT 10-29-26 #4');
  assert.equal((await transact(()=>context.getOrCreatePendingPhoneInvoice(client,'KT'))).id,kt.invoice.id);
  await db.query('update phone_invoices set archived_at=now() where id=$1',[kt.invoice.id]);
  const automatic=await transact(()=>context.getOrCreatePendingPhoneInvoice(client,'KT'));
  assert.equal(automatic.label,'KT 10-29-26 #5','Automatic purchase creation uses the same counter');
  await db.query("insert into phone_purchases(invoice_id,buyer) values($1,'Atlas')",[atlas.invoice.id]);
  const failed=await transact(()=>context.createOrReuseEmptyPhoneInvoice(client,'Atlas','',''),true);
  assert.equal(failed.invoice.label,'Atlas 10-29-26 #6');
  assert.equal(await next(),6,'A failed transaction does not consume the number');
  assert.equal((await create('Atlas')).invoice.label,'Atlas 10-29-26 #6');
  await db.exec('update phone_invoices set archived_at=now();');
  await db.exec(numberingSchema);
  assert.equal(await next(),7,'Archiving and redeploying never reset the counter');
  now='2026-11-02T04:30:00Z'; // New York has changed back to standard time.
  assert.equal((await create('KT')).invoice.label,'KT 11-01-26 #7');
  assert.equal((await db.query("select label from phone_invoices where label='Existing Atlas'")).rows.length,1,'Existing names are unchanged');
});

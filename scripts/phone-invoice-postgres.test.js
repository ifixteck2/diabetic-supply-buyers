import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';

test('empty draft reuse and reversible KT cleanup preserve all phone and invoice history', {skip: !process.env.PGLITE_TEST_MODULE}, async t => {
  const {PGlite}=await import(pathToFileURL(process.env.PGLITE_TEST_MODULE).href);
  const db=new PGlite();
  t.after(()=>db.close());
  const source=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
  await db.exec(source.slice(source.indexOf('create table if not exists phone_invoices ('),source.indexOf('create table if not exists phone_manual_returns (')));
  await db.exec('alter table phone_invoices add column archived_at timestamptz; create table app_migrations (migration_key text primary key);');
  const context={};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('async function lockPhoneInvoiceCreation('),source.indexOf('async function getOrCreateWeeklyGiftCardInvoice(')),context);
  vm.runInContext(source.slice(source.indexOf('function defaultPhoneInvoiceLabel('),source.indexOf('function createPhoneInvoiceHtml(')),context);
  const reuse=async(buyer='KT',label='',notes='')=>{
    await db.exec('begin');
    try {
      const result=await context.createOrReuseEmptyPhoneInvoice(db,buyer,label,notes);
      await db.exec('commit');
      return result;
    } catch(error) {await db.exec('rollback');throw error;}
  };
  const first=await reuse();
  assert.equal(first.reused,false);
  assert.equal((await reuse()).invoice.id,first.invoice.id,'Retries reuse the same empty invoice');
  assert.equal((await reuse()).reused,true);
  await db.query("insert into phone_purchases (invoice_id,buyer,invoice_removed_at) values ($1,'KT',now())",[first.invoice.id]);
  const second=await reuse();
  assert.notEqual(second.invoice.id,first.invoice.id,'Removed phone history makes an invoice ineligible for reuse');
  const atlas=await reuse('Atlas');
  assert.notEqual(atlas.invoice.id,second.invoice.id);
  const named=await reuse('KT','Shipment A');
  assert.equal((await reuse('KT','Shipment A')).invoice.id,named.invoice.id);
  assert.notEqual((await reuse('KT','Shipment B')).invoice.id,named.invoice.id,'Distinct names remain separate');
  await db.query('update phone_invoices set archived_at=now() where id=$1',[second.invoice.id]);
  assert.notEqual((await reuse()).invoice.id,second.invoice.id,'Archived drafts are never reused');

  const add=async(fields={})=>{
    const record={buyer:'KT',label:'KT Phone Invoice 2026-10-16',...fields};
    return (await db.query(`insert into phone_invoices (${Object.keys(record).join(',')}) values (${Object.keys(record).map((_,i)=>'$'+(i+1)).join(',')}) returning id`,Object.values(record))).rows[0].id;
  };
  const protectedIds=[first.invoice.id,atlas.invoice.id,named.invoice.id];
  for(const fields of [
    {notes:'Shipment instructions'}, {sale_notes:'Payment discussion'}, {sale_price:0},
    {status:'Shipped'}, {status:'Closed'}, {status:'Sold'}, {shipped_at:new Date()},
    {sold_at:new Date()}, {closed_at:new Date()}, {label:'Custom draft'}, {buyer:'Atlas'}
  ]) protectedIds.push(await add(fields));
  const giftCard=await add();
  await db.query("insert into phone_purchases (invoice_id,buyer,gift_card_closeout_invoice_id) values ($1,'KT',$2)",[first.invoice.id,giftCard]);
  protectedIds.push(giftCard);
  const populated=await add();
  await db.query("insert into phone_purchases (invoice_id,buyer) values ($1,'KT')",[populated]);
  protectedIds.push(populated);
  const extra=await add();
  const latest=await add();
  const before=(await db.query('select * from phone_purchases order by id')).rows;
  const cleanup=source.slice(source.indexOf('-- One-time, reversible cleanup'),source.indexOf("update invoices set status = 'Active'"));
  await db.exec(cleanup);
  const invoices=(await db.query('select * from phone_invoices')).rows;
  for(const id of protectedIds) assert.equal(invoices.find(row=>row.id===id).archived_at,null,`Protected invoice ${id} stays active`);
  assert.ok(invoices.find(row=>row.id===extra).archived_at,'Extra empty draft archived');
  assert.equal(invoices.find(row=>row.id===extra).status,'Pending','Archiving does not close or ship');
  assert.equal(invoices.find(row=>row.id===latest).archived_at,null,'Latest empty draft retained');
  assert.deepEqual((await db.query('select * from phone_purchases order by id')).rows,before);
  await db.query('update phone_invoices set archived_at=null where id=$1',[extra]);
  await db.exec(cleanup);
  assert.equal((await db.query('select archived_at from phone_invoices where id=$1',[extra])).rows[0].archived_at,null,'A restored invoice stays restored on subsequent deploys');
});

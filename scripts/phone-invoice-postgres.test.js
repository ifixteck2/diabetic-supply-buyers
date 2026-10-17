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
  const cleanup=source.slice(source.indexOf('-- One-time, reversible cleanup'),source.indexOf('-- Remove existing empty KT invoices'));
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

test('requested empty KT cleanup removes drafts from every list, backs them up, and preserves records with history', {skip: !process.env.PGLITE_TEST_MODULE}, async t => {
  const {PGlite}=await import(pathToFileURL(process.env.PGLITE_TEST_MODULE).href);
  const db=new PGlite();
  t.after(()=>db.close());
  const source=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
  await db.exec(source.slice(source.indexOf('create table if not exists phone_invoices ('),source.indexOf('create table if not exists phone_manual_returns (')));
  await db.exec('alter table phone_invoices add column archived_at timestamptz; create table app_migrations (migration_key text primary key);');
  const add=async(fields={})=>{
    const record={buyer:'KT',label:'Empty draft',...fields};
    return (await db.query(`insert into phone_invoices (${Object.keys(record).join(',')}) values (${Object.keys(record).map((_,i)=>'$'+(i+1)).join(',')}) returning *`,Object.values(record))).rows[0];
  };
  const empty=[];
  for(const fields of [{}, {archived_at:new Date()}, {status:'Closed'}, {label:'Custom empty',notes:'Keep a recovery copy'}]) empty.push(await add(fields));
  const protectedInvoices=[];
  for(const fields of [{buyer:'Atlas'}, {buyer:'Apple GC'}, {sale_price:0}, {sale_price:500}, {sale_notes:'Paid in cash'}]) protectedInvoices.push(await add(fields));
  const phones=await add();
  const removedPhones=await add();
  const returnedPhones=await add();
  const giftCards=await add();
  protectedInvoices.push(phones,removedPhones,returnedPhones,giftCards);
  await db.query("insert into phone_purchases (invoice_id,buyer) values ($1,'KT')",[phones.id]);
  await db.query("insert into phone_purchases (invoice_id,buyer,invoice_removed_at) values ($1,'KT',now())",[removedPhones.id]);
  await db.query("insert into phone_purchases (invoice_id,buyer,returned_at,gift_card_closeout_invoice_id) values ($1,'KT',now(),$2)",[returnedPhones.id,giftCards.id]);
  const phoneHistory=(await db.query('select * from phone_purchases order by id')).rows;
  const cleanup=source.slice(source.indexOf('-- Remove existing empty KT invoices'),source.indexOf("update invoices set status = 'Active'"));
  await db.exec(cleanup);
  const remaining=(await db.query('select * from phone_invoices order by id')).rows;
  assert.deepEqual(remaining,protectedInvoices);
  const backups=(await db.query('select invoice_id,invoice_data from removed_empty_phone_invoices order by invoice_id')).rows;
  assert.deepEqual(backups.map(row=>row.invoice_id),empty.map(row=>row.id));
  for(const row of backups) {
    const original=empty.find(invoice=>invoice.id===row.invoice_id);
    assert.equal(row.invoice_data.label,original.label);
    assert.equal(row.invoice_data.notes,original.notes);
    assert.equal(row.invoice_data.status,original.status);
  }
  assert.deepEqual((await db.query('select * from phone_purchases order by id')).rows,phoneHistory);
  // Seed imports must not recreate invoices that the user removed.
  const seedStart=source.indexOf('async function seedGoogleDrivePhoneInvoices(');
  const queryStart=source.indexOf('`select id from phone_invoices',seedStart)+1;
  const seedQuery=source.slice(queryStart,source.indexOf('`',queryStart));
  assert.equal((await db.query(seedQuery,['KT','Custom empty'])).rows[0].id,empty[3].id);
  const fresh=await add({label:'New draft after cleanup'});
  await db.exec(cleanup);
  assert.equal((await db.query('select count(*)::int as count from phone_invoices where id=$1',[fresh.id])).rows[0].count,1,'Later deployments do not remove newly created drafts');
  assert.equal((await db.query('select count(*)::int as count from removed_empty_phone_invoices')).rows[0].count,empty.length);
});

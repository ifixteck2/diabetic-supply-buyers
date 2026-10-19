import crypto from 'node:crypto';
// Additive phone-portal features; existing invoices and prices are not rewritten.
export const phoneWorkflowSchema = `
create table if not exists phone_dashboard_settings (
  id boolean primary key default true check (id), start_date date not null
);
insert into phone_dashboard_settings(id,start_date)
select true, coalesce((min(archived_at) at time zone 'America/New_York')::date, (now() at time zone 'America/New_York')::date)
from phone_invoices where buyer='KT' and archived_at is not null
on conflict do nothing;
alter table phone_invoices add column if not exists tracking_number text not null default '';
alter table phone_invoices add column if not exists delivery_status text not null default 'Not Shipped';
alter table phone_invoices add column if not exists payment_status text not null default 'Awaiting Payment';
alter table phone_invoices add column if not exists delivered_at timestamptz;
alter table phone_invoices add column if not exists paid_at timestamptz;
alter table phone_invoices add column if not exists payment_notes text not null default '';
alter table phone_purchases add column if not exists final_sell_each numeric(12,2);
alter table phone_purchases add column if not exists client_request_id text;
alter table phone_holding_purchases add column if not exists client_request_id text;
alter table phone_purchases add column if not exists client_request_fingerprint text;
alter table phone_holding_purchases add column if not exists client_request_fingerprint text;
create unique index if not exists phone_purchases_request_idx on phone_purchases(client_request_id);
create unique index if not exists phone_holding_request_idx on phone_holding_purchases(client_request_id);
with applied as (
  insert into app_migrations (migration_key) values ('phone_delivery_status_20261017')
  on conflict do nothing returning migration_key
)
update phone_invoices set delivery_status = 'Shipped'
where exists (select 1 from applied) and (status = 'Shipped' or shipped_at is not null);

create table if not exists phone_invoice_activity (
  id bigserial primary key, invoice_id integer not null, purchase_id integer,
  action text not null, details jsonb not null default '{}', created_at timestamptz not null default now()
);
create index if not exists phone_invoice_activity_invoice_idx on phone_invoice_activity(invoice_id, id desc);
create or replace function record_phone_invoice_activity() returns trigger language plpgsql as $$
declare before_row jsonb; after_row jsonb; changes jsonb; verb text; target integer; purchase integer;
begin
  before_row := case when TG_OP = 'INSERT' then '{}'::jsonb else to_jsonb(OLD) end;
  after_row := case when TG_OP = 'DELETE' then '{}'::jsonb else to_jsonb(NEW) end;
  -- Never copy photos, PDFs, or receipts into the activity log.
  select coalesce(jsonb_object_agg(k, jsonb_build_object('before',before_row->k,'after',after_row->k)), '{}') into changes
  from jsonb_object_keys(before_row || after_row) k
  where before_row->k is distinct from after_row->k
    and k in ('invoice_id','model','imei','quantity','cost_each','final_sell_each','status','sale_price',
      'sale_notes','notes','label','archived_at','invoice_removed_at','invoice_removed_reason',
      'returned_at','return_status','gift_card_value','gift_card_at','local_sale_price','local_sold_at',
      'tracking_number','delivery_status','payment_status','payment_notes','delivered_at','paid_at');
  if TG_OP = 'UPDATE' and changes = '{}'::jsonb then return NEW; end if;
  if TG_TABLE_NAME = 'phone_invoices' then
    target := coalesce((after_row->>'id')::int,(before_row->>'id')::int);
    verb := case TG_OP when 'INSERT' then 'Invoice created' when 'DELETE' then 'Invoice deleted' else 'Invoice updated' end;
  else
    purchase := coalesce((after_row->>'id')::int,(before_row->>'id')::int);
    target := coalesce((after_row->>'invoice_id')::int,(before_row->>'invoice_id')::int);
    verb := case TG_OP when 'INSERT' then 'Phone added' when 'DELETE' then 'Phone deleted' else 'Phone updated' end;
    if TG_OP = 'UPDATE' then
      if before_row->>'invoice_id' is distinct from after_row->>'invoice_id' then
        verb := 'Phone moved';
        insert into phone_invoice_activity(invoice_id,purchase_id,action,details)
          values ((before_row->>'invoice_id')::int,purchase,verb,jsonb_build_object('model',coalesce(after_row->>'model',before_row->>'model'),'changes',changes));
      elsif before_row->>'invoice_removed_at' is null and after_row->>'invoice_removed_at' is not null then
        verb := 'Phone removed';
      elsif before_row->>'returned_at' is null and after_row->>'returned_at' is not null then
        verb := 'Phone returned';
      end if;
    end if;
  end if;
  insert into phone_invoice_activity(invoice_id,purchase_id,action,details)
    values (target,purchase,verb,jsonb_build_object('model',coalesce(after_row->>'model',before_row->>'model'),'changes',changes));
  if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
end $$;
drop trigger if exists phone_invoice_activity_trigger on phone_invoices;
create trigger phone_invoice_activity_trigger after insert or update or delete on phone_invoices
  for each row execute function record_phone_invoice_activity();
drop trigger if exists phone_purchase_activity_trigger on phone_purchases;
create trigger phone_purchase_activity_trigger after insert or update or delete on phone_purchases
  for each row execute function record_phone_invoice_activity();
`;

function fail(message, status = 400, extra = {}) {
  throw Object.assign(new Error(message), { status, ...extra });
}
function positiveId(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) fail('Choose a valid record.');
  return n;
}
function amount(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 9999999999.99 || Math.abs(n * 100 - Math.round(n * 100)) > 0.0001) fail('Enter an amount with no more than two decimal places.');
  return Math.round(n * 100) / 100;
}
export function normalizePhoneImei(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
export async function getPhoneSaveRetry(db, input, table) {
  if (!input.client_request_id) return null;
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(input.client_request_id)) fail('Invalid save reference. Refresh the preview.');
  if (!['phone_purchases','phone_holding_purchases'].includes(table)) throw new Error('Invalid phone table');
  await db.query('select pg_advisory_xact_lock(hashtext($1))',[`phone-save:${input.client_request_id}`]);
  const existing = (await db.query(`select * from ${table} where client_request_id=$1`,[input.client_request_id])).rows[0];
  if (existing?.client_request_fingerprint && existing.client_request_fingerprint !== phoneRequestFingerprint(input)) fail('This phone was already saved with different details. Refresh your invoice and edit the saved phone instead.',409);
  return existing || null;
}
export function phoneRequestFingerprint(input) {
  const fields=['buyer','invoice_id','purchase_date','device_type','condition_type','packaging','grade','model','carrier','quantity','cost_each','imei','placed_at','notes','holding_type'];
  return crypto.createHash('sha256').update(JSON.stringify(fields.map(field=>input[field] ?? null))).digest('hex');
}
export async function findPhoneImeiDuplicates(db, imei, excludePurchaseId = 0) {
  const normalized = normalizePhoneImei(imei);
  if (!normalized) return [];
  const result = await db.query(`
    select pp.id, pp.model, pp.imei, pi.id as invoice_id, pi.label, pi.buyer,
      case when pi.archived_at is not null then 'Archived' when pp.invoice_removed_at is not null then 'Previous phone record' else pi.status end as location
    from phone_purchases pp join phone_invoices pi on pi.id = pp.invoice_id
    where regexp_replace(upper(pp.imei), '[^A-Z0-9]', '', 'g') = $1 and pp.id <> $2
    union all
    select id, model, imei, null as invoice_id, holding_type as label, 'Holding' as buyer, status as location
    from phone_holding_purchases where regexp_replace(upper(imei), '[^A-Z0-9]', '', 'g') = $1
    limit 30`, [normalized, excludePurchaseId]);
  return result.rows;
}
export async function checkPhoneImei(db, input, excludePurchaseId = 0) {
  const imei = normalizePhoneImei(input.imei);
  if (!imei) return;
  await db.query('select pg_advisory_xact_lock(hashtext($1))', [`phone-imei:${imei}`]);
  const matches = await findPhoneImeiDuplicates(db, imei, excludePurchaseId);
  if (matches.length && input.allow_duplicate_imei !== true) {
    fail('This IMEI / serial already exists. Review the matching records before adding it again.', 409, { code: 'DUPLICATE_IMEI', matches });
  }
}
export function phoneWorkflowError(error) {
  return { error: error.status ? error.message : 'Could not save this change. Please try again.', ...(error.code === 'DUPLICATE_IMEI' ? {code:error.code,matches:error.matches} : {}) };
}

export function registerPhoneWorkflow(app, pool, auth, helpers) {
  const route = (method, path, handler) => app[method](path, auth, async (req, res) => {
    let client;
    try {
      client = await pool.connect();
      await client.query('begin');
      const result = await handler(client, req);
      await client.query('commit');
      res.json({ok:true,...result});
    } catch (error) {
      if (client) await client.query('rollback');
      if (!error.status) console.error('Phone workflow:',error);
      res.status(error.status || 500).json(phoneWorkflowError(error));
    } finally { client?.release(); }
  });
  route('get','/api/phone-dashboard-settings',async(db)=>{
    const result=await db.query("select to_char(start_date,'YYYY-MM-DD') as start_date from phone_dashboard_settings where id=true");
    return {start_date:result.rows[0].start_date};
  });
  route('patch','/api/phone-dashboard-settings',async(db,req)=>{
    const date=String(req.body?.start_date || '');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date+'T12:00:00Z')) || new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date) fail('Choose a valid reporting start date.');
    await db.query('update phone_dashboard_settings set start_date=$1::date where id=true',[date]);
    return {start_date:date};
  });
  route('post','/api/phone-imei-check',async(db,req)=>{
    const values = req.body?.imeis;
    if (!Array.isArray(values) || values.length > 100) fail('Check at most 100 phones at a time.');
    const matches = [];
    for (const value of [...new Set(values.map(normalizePhoneImei).filter(Boolean))]) {
      const rows = await findPhoneImeiDuplicates(db,value);
      if (rows.length) matches.push({imei:value,records:rows});
    }
    return {matches};
  });
  route('get','/api/phone-invoices/:id/activity',async(db,req)=>{
    const id = positiveId(req.params.id);
    const before = req.query?.before ? positiveId(req.query.before) : null;
    const rows = await db.query('select * from phone_invoice_activity where invoice_id=$1 and ($2::bigint is null or id<$2) order by id desc limit 101',[id,before]);
    return {events:rows.rows.slice(0,100),next_before:rows.rows.length>100 ? rows.rows[99].id : null};
  });
  route('patch','/api/phone-invoices/:id/workflow',async(db,req)=>{
    const id = positiveId(req.params.id);
    const input = req.body || {};
    const current = (await db.query('select * from phone_invoices where id=$1 and archived_at is null for update',[id])).rows[0];
    if (!current) fail('Active invoice not found.',404);
    const delivery = input.delivery_status ?? current.delivery_status;
    const payment = input.payment_status ?? current.payment_status;
    if (!['Not Shipped','Shipped','Delivered'].includes(delivery)) fail('Choose a delivery status.');
    if (!['Awaiting Payment','Paid'].includes(payment)) fail('Choose a payment status.');
    if (payment === 'Paid' && current.sale_price === null) fail('Enter the final sale amount before marking Paid.');
    const tracking = String(input.tracking_number ?? current.tracking_number).trim();
    const notes = String(input.payment_notes ?? current.payment_notes).trim();
    if (tracking.length > 160 || notes.length > 2000) fail('Tracking or payment notes are too long.');
    const result = await db.query(`update phone_invoices set tracking_number=$2,delivery_status=$3,payment_status=$4,payment_notes=$5,
      delivered_at=case when $3='Delivered' then coalesce(delivered_at,now()) else null end,
      paid_at=case when $4='Paid' then coalesce(paid_at,now()) else null end,
      shipped_at=case when $3<>'Not Shipped' then coalesce(shipped_at,now()) else null end,
      status=case when status='Pending' and $3<>'Not Shipped' then 'Shipped' when status='Shipped' and $3='Not Shipped' then 'Pending' else status end,
      status_updated_at=now() where id=$1 returning *`,[id,tracking,delivery,payment,notes]);
    return {invoice:result.rows[0]};
  });
  route('patch','/api/phone-invoices/:id/final-prices',async(db,req)=>{
    const id = positiveId(req.params.id);
    const entries = req.body?.prices;
    if (!Array.isArray(entries) || !entries.length || entries.length > 500) fail('Enter final prices for the invoice phones.');
    const values = entries.map(row=>({id:positiveId(row.id),price:amount(row.final_sell_each)}));
    if (new Set(values.map(row=>row.id)).size!==values.length) fail('A phone appears more than once.');
    const invoice = (await db.query('select * from phone_invoices where id=$1 and archived_at is null for update',[id])).rows[0];
    if (!invoice) fail('Active invoice not found.',404);
    const rows = (await db.query('select * from phone_purchases where invoice_id=$1 and invoice_removed_at is null and returned_at is null order by id for update',[id])).rows;
    if (rows.length!==values.length || rows.some(row=>!values.some(value=>value.id===row.id))) fail('The invoice phones changed. Refresh and review the prices again.',409);
    let cents = 0;
    for (const value of values) {
      const purchase = rows.find(row=>row.id===value.id);
      await db.query('update phone_purchases set final_sell_each=$2 where id=$1',[value.id,value.price]);
      if(value.price!==null) cents += Math.round(value.price*100)*purchase.quantity;
    }
    const complete = values.every(row=>row.price!==null);
    if (complete) {
      const total = amount(cents/100);
      await db.query('update phone_invoices set sale_price=$2,sold_at=coalesce(sold_at,now()),status_updated_at=now() where id=$1',[id,total]);
    }
    return {complete,total:complete ? cents/100 : null};
  });
  route('post','/api/phone-purchases/bulk-move',async(db,req)=>{
    const sourceId = positiveId(req.body?.source_invoice_id);
    const ids = req.body?.purchase_ids;
    if (!Array.isArray(ids) || !ids.length || ids.length>100) fail('Select between 1 and 100 phone rows.');
    const purchaseIds = ids.map(positiveId);
    if (new Set(purchaseIds).size!==purchaseIds.length) fail('A phone was selected twice.');
    const holding = req.body.destination === 'Holding';
    const targetId = holding ? null : positiveId(req.body.invoice_id);
    if (targetId===sourceId) fail('Choose a different invoice.');
    const holdingType = req.body.holding_type || 'Holding For Sale';
    if (holding && !['Holding For Sale','Holding For Trade In'].includes(holdingType)) fail('Choose a Holding section.');
    const invoices = (await db.query('select * from phone_invoices where id=any($1::int[]) order by id for update',[[sourceId,...(targetId?[targetId]:[])]] )).rows;
    const source = invoices.find(row=>row.id===sourceId);
    const target = invoices.find(row=>row.id===targetId);
    const editable = row=>row && row.status==='Pending' && !row.archived_at && row.sale_price===null;
    if (!editable(source) || (!holding && !editable(target))) fail('Moves require pending invoices without a final sale amount. Refresh and try again.',409);
    const rows = (await db.query('select * from phone_purchases where id=any($1::int[]) order by id for update',[purchaseIds])).rows;
    if (rows.length!==purchaseIds.length || rows.some(row=>row.invoice_id!==sourceId || row.invoice_removed_at || row.returned_at || row.final_sell_each!==null)) fail('A selected phone is no longer available to move. Refresh and try again.',409);
    const priceRows = holding ? [] : await (target.buyer==='KT'?helpers.getKtPrices():helpers.getAtlasPrices());
    for (const row of rows) {
      if (holding) {
        await db.query(`insert into phone_holding_purchases
          (purchase_date,device_type,condition_type,packaging,grade,model,carrier,quantity,cost_each,imei,placed_at,photo_file_name,photo_data_url,notes,holding_type)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [row.purchase_date,row.device_type,row.condition_type,row.packaging,row.grade,row.model,row.carrier,row.quantity,row.cost_each,row.imei,row.placed_at,row.photo_file_name,row.photo_data_url,[row.notes,`Moved from invoice #${sourceId}`].filter(Boolean).join(' | '),holdingType]);
        await db.query('update phone_purchases set invoice_removed_at=now(),invoice_removed_reason=$2 where id=$1',[row.id,holdingType]);
      } else {
        const projected = helpers.findPhonePrice({...row,buyer:target.buyer},priceRows,target.buyer) || Number(row.projected_sell_each || 0);
        const start = await helpers.nextPhoneInvoiceItemStart(db,targetId);
        await db.query('update phone_purchases set invoice_id=$2,buyer=$3,projected_sell_each=$4,invoice_added_at=now(),invoice_item_start=$5 where id=$1',[row.id,targetId,target.buyer,projected,start]);
      }
    }
    return {moved:rows.length,invoice_id:targetId};
  });
}

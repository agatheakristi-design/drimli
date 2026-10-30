import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
const exec = promisify(execFile);
const socket = process.env.DRIMLI_ACCOUNTANT_PG_SOCKET;

test('two PostgreSQL connections cannot reserve the same monthly delivery', { skip: !socket }, async () => {
  // This integration test deliberately refuses TCP hosts or Supabase endpoints.
  assert.match(socket, /^\/private\/tmp\/drimli-accountant-pg\.[a-zA-Z0-9]+$/);
  const args = ['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-h',socket,'-p','55439','-d','postgres'];
  const sql = async query => (await exec('/opt/homebrew/opt/postgresql@17/bin/psql', [...args,'-c',query])).stdout.trim();
  const provider = randomUUID(); let delivery;
  try {
    await sql(`insert into auth.users(id) values ('${provider}'); insert into public.profiles(provider_id,accountant_email) values ('${provider}','concurrency@example.test'); insert into public.client_invoices(provider_id,issued_at) values ('${provider}','2026-09-12T12:00:00Z'); select public.queue_accountant_month('2026-09-01');`);
    delivery = await sql(`select id from public.accountant_monthly_deliveries where provider_id='${provider}';`);
    assert.match(delivery, /^[a-f0-9-]{36}$/);
    const results = await Promise.all([sql(`select (public.claim_accountant_delivery('${delivery}',false)).id;`),sql(`select (public.claim_accountant_delivery('${delivery}',false)).id;`)]);
    assert.equal(results.filter(Boolean).length,1);
    assert.equal(await sql(`select attempts from public.accountant_monthly_deliveries where id='${delivery}';`),'1');
    assert.equal(await sql(`select status from public.accountant_monthly_deliveries where id='${delivery}';`),'preparing');
    // A crashed ninth preparation can be recovered by two workers, but claimed once.
    await sql(`update public.accountant_monthly_deliveries set attempts=9,lease_until=now()-interval '1 minute' where id='${delivery}';`);
    const recovered = await Promise.all([sql(`select (public.claim_accountant_delivery('${delivery}',false)).id;`),sql(`select (public.claim_accountant_delivery('${delivery}',false)).id;`)]);
    assert.equal(recovered.filter(Boolean).length,1);
    assert.equal(await sql(`select attempts from public.accountant_monthly_deliveries where id='${delivery}';`),'10');
    // Active tenth attempt is never exhausted by a concurrent recovery.
    await Promise.all([sql('select public.recover_accountant_deliveries();'),sql('select public.recover_accountant_deliveries();')]);
    assert.equal(await sql(`select status from public.accountant_monthly_deliveries where id='${delivery}';`),'preparing');
    await sql(`update public.accountant_monthly_deliveries set lease_until=now()-interval '1 minute' where id='${delivery}';`);
    assert.equal(await sql(`select (public.claim_accountant_delivery('${delivery}',false)).id;`),'');
    assert.equal(await sql(`select status from public.accountant_monthly_deliveries where id='${delivery}';`),'exhausted');
    // A possibly sent email is preserved for reconciliation, never made pending.
    await sql(`update public.accountant_monthly_deliveries set status='sending',attempts=9,mail_payload='{"to":"concurrency@example.test"}',lease_token=gen_random_uuid(),lease_until=now()-interval '1 minute' where id='${delivery}';`);
    const uncertain = await Promise.all([sql(`select (public.claim_accountant_delivery('${delivery}',false)).id;`),sql(`select (public.claim_accountant_delivery('${delivery}',false)).id;`)]);
    assert.deepEqual(uncertain,['','']);
    assert.equal(await sql(`select status from public.accountant_monthly_deliveries where id='${delivery}';`),'uncertain');
  } finally {
    await sql(`delete from public.accountant_monthly_deliveries where provider_id='${provider}'; delete from public.client_invoices where provider_id='${provider}'; delete from public.profiles where provider_id='${provider}'; delete from auth.users where id='${provider}';`);
  }
});

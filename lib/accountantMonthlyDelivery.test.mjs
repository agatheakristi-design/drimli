import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
function compile(file, mocks = {}, env = {}, runtime = {}) {
  const loaded = { exports: {} };
  const js = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInThisContext(`(function(module,exports,require,process,fetch){${js}\n})`)(loaded, loaded.exports, name => name in mocks ? mocks[name] : require(name), { env }, runtime.fetch || fetch);
  return loaded.exports;
}
class ExportError extends Error { constructor(message, status, missing) { super(message); this.status = status; this.missing = missing; } }
const email = compile('./accountantMonthlyEmail.ts');
const id = '11111111-1111-4111-8111-111111111111';
const provider = '22222222-2222-4222-8222-222222222222';
const lease = '33333333-3333-4333-8333-333333333333';
function fixture(options = {}) {
  const job = { attempts: 1, lease_until: '2099-01-01T00:00:00Z', id, provider_id: provider, period_month: '2026-10-01', recipient: 'comptable@example.test', status: 'preparing', lease_token: lease, mail_payload: null, archive_path: null, archive_expires_at: '2099-01-01T00:00:00Z', link_expires_at: '2099-01-01T00:00:00Z', exported_count: 0, missing_documents: [], ...options.job };
  const clients = []; const fetches = []; const deferred = []; const reservations = []; let claimedOnce = false;
  const transitions = []; const uploads = []; const sends = []; const archiveReads = []; const renewals = []; const signatures = []; const queries = []; const removals = [];
  const admin = {
    auth: { getUser: async token => ({ data: { user: token === 'valid' ? { id: options.user || provider } : null }, error: null }) },
    rpc: async (name, args) => {
      if (name === 'queue_accountant_month') { reservations.push(args); return { data: 1, error: null }; }
      if (name === 'recover_accountant_deliveries') {
        if (options.recoveryFailure) return {data:null,error:'recovery unavailable'};
        if (['preparing','sending'].includes(job.status) && Date.parse(job.lease_until) < Date.now()) {
          job.status = job.mail_payload || job.status === 'sending' ? 'uncertain' : job.attempts >= 10 ? 'exhausted' : 'pending';
          job.lease_until=null; job.lease_token=null;
        }
        if (job.attempts >= 10 && !job.mail_payload && !job.lease_until && ['pending','failed','blocked','empty','skipped'].includes(job.status)) job.status='exhausted';
        return {data:job.status==='pending' && job.attempts<10 ? 1 : 0,error:null};
      }
      if (name === 'claim_accountant_delivery') {
        if (claimedOnce || job.attempts >= 10 || ['sent','uncertain','exhausted','purging','purged'].includes(job.status)) return { data: null, error: null };
        claimedOnce = true; return { data: structuredClone(job), error: null };
      }
      if (name === 'claim_accountant_archive_cleanup') return { data: Date.parse(job.archive_expires_at) < Date.now() && (!['preparing','sending'].includes(job.status) || Date.parse(job.lease_until) < Date.now()), error: null };
      if (name === 'purge_accountant_delivery_archive') { job.status = 'purged'; return { data: true, error: null }; }
      if (name === 'reconcile_accountant_delivery') { reservations.push(args); return { data: true, error: null }; }

      if (name === 'transition_accountant_delivery') {
        if (args.p_lease !== job.lease_token) return { data: null, error: 'lease' };
        transitions.push({ action: args.p_action, data: structuredClone(args.p_data) });
        if (options.confirmationFailure && args.p_action === 'sent') return { data: null, error: 'db down' };
        if (options.recipientChanged && args.p_action === 'sending') return { data: null, error: 'recipient changed' };
        if (args.p_action === 'prepared') Object.assign(job, args.p_data);
        if (args.p_action === 'sending') { job.status = 'sending'; job.mail_payload = args.p_data.payload; }
        if (args.p_action === 'sent') job.status = 'sent';
        if (['failed','uncertain','blocked','empty'].includes(args.p_action)) { job.status = args.p_action !== 'uncertain' && job.attempts >= 10 ? 'exhausted' : args.p_action; if (args.p_action === 'failed') job.mail_payload = null; }
        return { data: structuredClone(job), error: null };
      }
      if (name === 'renew_accountant_delivery_link') {
        renewals.push(args);
        return args.p_provider === job.provider_id && args.p_id === job.id && !options.recipientChanged ? { data: '2099-01-01T00:00:00Z', error: null } : { data: null, error: 'ownership' };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
    from(table) {
      queries.push(table); const predicates = []; let attemptsBelow = Infinity;
      const query = {
        select() { return query; }, eq(key, value) { predicates.push([key, value]); return query; }, in() { return query; }, order() { return query; }, lt(key, value) { if(key==='attempts') attemptsBelow=value; return query; }, neq() { return query; }, not() { return query; }, or() { return query; }, limit() { return query; },
        maybeSingle: async () => {
          if (table === 'profiles') return { data: { accountant_email: options.recipientChanged ? '' : job.recipient }, error: null };
          const hash = predicates.find(([key]) => key === 'link_token_hash')?.[1];
          return { data: !hash || hash === core.hashAccountantToken('a'.repeat(64)) ? structuredClone(job) : null, error: null };
        },
        then: (resolve, reject) => Promise.resolve({ data: predicates.some(([key, value]) => key === 'provider_id' && value !== job.provider_id) ? [] : [structuredClone(job)], count: job.attempts < attemptsBelow ? options.pendingCount || 0 : 0, error: null }).then(resolve, reject),
      };
      return query;
    },
    storage: {
      getBucket: async () => ({ data: { public: Boolean(options.publicBucket) }, error: null }),
      from: bucket => ({
        list: async () => ({data: (options.archiveFiles || [lease+'.zip']).map(name=>({name})), error:null}),
        remove: async paths => { removals.push(...paths); return {error:null}; },
        upload: async (path, buffer, metadata) => { uploads.push({ bucket, path, buffer, metadata }); return { error: options.uploadFailure ? 'offline' : null }; },
        createSignedUrl: async (path, seconds) => { signatures.push({ bucket, path, seconds }); const exp = options.signedExpiry ?? Math.floor(Date.now()/1000)+seconds; const jwt = 'header.'+Buffer.from(JSON.stringify({exp})).toString('base64url')+'.signature'; return { data: { signedUrl: options.invalidSignedUrl || 'https://storage.test/private.zip?token='+jwt }, error: null }; },
      }),
    },
  };
  const core = compile('./accountantMonthlyDelivery.ts', {
    '@/lib/clientDocumentArchive': { ExportError, buildClientDocumentArchive: async (_admin, args) => { archiveReads.push(args); if (options.archiveError) throw options.archiveError; return { zip: Buffer.from('ZIP existing PDFs'), exported: 2, missing: options.missing || [] }; } },
    '@/lib/accountantMonthlyEmail': email,
  });
  const sender = async (payload, key) => { sends.push({ payload: structuredClone(payload), key }); if (options.sendThrow) throw new Error('lost response'); return options.sendResult || { data: { id: 'email-accepted' }, error: null }; };
  const env = { ACCOUNTANT_MONTHLY_ENABLED: options.disabled ? '' : 'true', NEXT_PUBLIC_APP_URL: 'https://www.drimli.test', RESEND_FROM: 'DRIMLI <compta@drimli.test>', CRON_SECRET: 'test-cron' };
  const http = compile('./accountantMonthlyHttp.ts', {
    '@supabase/supabase-js': { createClient: (_url,_key,config) => {clients.push(config); return admin;} },
    'next/server': { after: callback => deferred.push(callback), NextResponse: { json: (body, args) => new Response(JSON.stringify(body), { ...args, headers: { ...args?.headers, 'Content-Type': 'application/json' } }) } },
    '@/lib/accountantMonthlySchedule': { ...compile('./accountantMonthlySchedule.ts'), isAccountantMonthlyWindow: () => Boolean(options.due) },
    '@/lib/accountantMonthlyDelivery': core,
    '@/lib/email': { sendAccountantMonthlyDocuments: sender, getAccountantMonthlyEmail: async () => ({ data: options.proof || null, error: options.proof ? null : 'not found' }) },
  }, env, {fetch:async (url,init)=>{fetches.push({url,init});return new Response(null,{status:options.continuationFailure?503:202});}});
  return { job, admin, clients, fetches, core, http, deferred, reservations, removals, purge: () => core.purgeExpiredAccountantArchives(admin), sends, uploads, transitions, archiveReads, renewals, signatures, queries, run: (overrides = {}) => core.processAccountantDelivery(admin, structuredClone(job), { from: env.RESEND_FROM, baseUrl: env.NEXT_PUBLIC_APP_URL, signal: new AbortController().signal, send: sender, ...overrides }) };
}
const bearerRequest = (token = 'a'.repeat(64), extra = '') => new Request(`https://drimli.test/api/accountant-documents/download?token=${token}${extra}`);
const ownerRequest = (body, user = 'valid') => new Request('https://drimli.test/api/dashboard/client-documents/accountant-links', { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${user}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });

test('prepares the common archive then sends one email only to accountant_email', async () => {
  const f = fixture({ missing: ['AVR missing'] }); assert.equal((await f.run()).status, 'sent');
  assert.equal(f.sends.length, 1); assert.equal(f.sends[0].payload.to, 'comptable@example.test'); assert.equal(f.sends[0].key, `accountant-monthly/${id}`);
  assert.match(f.sends[0].payload.subject, /d’octobre 2026/); assert.match(f.sends[0].payload.text, /Documents-manquants.txt/);
  assert.equal(f.archiveReads[0].providerId, provider); assert.equal(f.archiveReads[0].month, '10'); assert.equal(f.archiveReads[0].type, 'all');
  assert.equal(f.uploads[0].bucket, 'invoices'); assert.equal(f.uploads[0].metadata.upsert, false);
  assert.deepEqual(f.transitions.map(x => x.action), ['prepared','sending','sent']);
});
test('public buckets fail closed and never receive an archive or email', async () => {
  const f = fixture({ publicBucket: true }); assert.equal((await f.run()).status, 'failed'); assert.equal(f.uploads.length, 0); assert.equal(f.sends.length, 0);
});
test('no documents, all PDFs unavailable and volume limits never send an empty archive', async () => {
  for (const [error, status] of [[new ExportError('none',404),'empty'],[new ExportError('missing',404,['missing']),'blocked'],[new ExportError('too large',413),'blocked']]) {
    const f = fixture({ archiveError: error }); assert.equal((await f.run()).status, status); assert.equal(f.sends.length, 0); assert.equal(f.uploads.length, 0);
  }
});
test('upload failures and recipient changes stop before the sender', async () => {
  for (const options of [{ uploadFailure: true }, { recipientChanged: true }]) { const f = fixture(options); assert.equal((await f.run()).status, 'failed'); assert.equal(f.sends.length, 0); }
});
test('explicit Resend rejection permits a controlled retry, ambiguous results do not reset payload', async () => {
  const rejected = fixture({ sendResult: { data: null, error: { statusCode: 429 } } }); assert.equal((await rejected.run()).status, 'failed'); assert.equal(rejected.job.mail_payload, null);
  for (const options of [{ sendThrow: true }, { sendResult: { data: null, error: { statusCode: 500 } } }, { sendResult: { data: null, error: { statusCode: 409 } } }]) {
    const f = fixture(options); assert.equal((await f.run()).status, 'uncertain'); assert.ok(f.job.mail_payload); assert.equal(f.transitions.at(-1).action, 'uncertain');
  }
});
test('uncertain retries reuse the exact persisted payload and idempotency key without rebuilding', async () => {
  const payload = email.accountantMonthlyMail({ from:'DRIMLI <compta@drimli.test>',to:'comptable@example.test',period:'2026-10',link:'https://drimli.test/original',missing:0 });
  const f = fixture({ job: { mail_payload: payload, archive_path: `providers/${provider}/accountant-monthly/${id}/${lease}.zip` } });
  assert.equal((await f.run()).status, 'sent'); assert.deepEqual(f.sends[0].payload, payload); assert.equal(f.archiveReads.length, 0); assert.equal(f.uploads.length, 0);
});
test('lost database confirmation after acceptance is recorded as uncertain without another send', async () => {
  const f = fixture({ confirmationFailure: true }); assert.equal((await f.run()).status, 'uncertain'); assert.equal(f.sends.length, 1); assert.ok(f.job.mail_payload);
});
test('invalid tokens cannot read a delivery or sign storage access', async () => {
  const f = fixture(); assert.equal((await f.http.accountantDownload(bearerRequest('bad'))).status, 404); assert.equal(f.queries.length, 0);
  assert.equal((await f.http.accountantDownload(bearerRequest('b'.repeat(64)))).status, 404); assert.equal(f.signatures.length, 0);
});
test('valid token signs only its stored owned path and ignores caller-supplied locations', async () => {
  const path = `providers/${provider}/accountant-monthly/${id}/${lease}.zip`;
  const f = fixture({ job: { status: 'sent', archive_path: path } }); const response = await f.http.accountantDownload(bearerRequest(undefined, '&provider_id=other&path=secret.pdf'));
  assert.equal(response.status, 302); assert.match(response.headers.get('cache-control'), /no-store/); assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.deepEqual(f.signatures, [{ bucket: 'invoices', path, seconds: 300 }]);
});
test('expired links explain secure recovery without signing or sending email', async () => {
  const f = fixture({ job: { status:'sent',link_expires_at:'2020-01-01T00:00:00Z' } }); const response = await f.http.accountantDownload(bearerRequest());
  assert.equal(response.status, 410); assert.match(await response.text(), /professionnel/); assert.equal(f.signatures.length, 0); assert.equal(f.sends.length, 0);
});
test('removed accountant addresses and paths outside this delivery are denied', async () => {
  for (const options of [{ recipientChanged:true },{ job:{archive_path:'providers/other/secret.zip'} }]) {
    const f=fixture({ ...options,job:{status:'sent',archive_path:`providers/${provider}/accountant-monthly/${id}/${lease}.zip`,...options.job} });
    assert.equal((await f.http.accountantDownload(bearerRequest())).status,404); assert.equal(f.signatures.length,0);
  }
});
test('renewal authenticates the professional and never sends a second monthly email', async () => {
  const f=fixture({job:{status:'sent'}}); assert.equal((await f.http.accountantLinks(ownerRequest({id},'bad'))).status,401);
  const response=await f.http.accountantLinks(ownerRequest({id,provider_id:'other'})); assert.equal(response.status,200);
  assert.equal(f.renewals[0].p_provider,provider); assert.equal(f.sends.length,0); assert.match((await response.json()).url,/token=[a-f0-9]{64}/);
  const other=fixture({user:'other',job:{status:'sent'}}); assert.equal((await other.http.accountantLinks(ownerRequest({id}))).status,409);
  assert.deepEqual((await (await other.http.accountantLinks(ownerRequest())).json()).deliveries,[]);
});
test('all entry points remain inert by default and cron requires its server secret', async () => {
  const f=fixture({disabled:true}); const cron=new Request('https://drimli.test/api/cron/accountant-monthly',{headers:{Authorization:'Bearer test-cron'}});
  assert.equal((await f.http.accountantCron(new Request(cron.url))).status,401);
  assert.equal((await (await f.http.accountantCron(cron)).json()).enabled,false);
  assert.equal((await f.http.accountantLinks(ownerRequest())).status,503); assert.equal((await f.http.accountantDownload(bearerRequest())).status,503);
  assert.equal(f.queries.length,0); assert.equal(f.sends.length,0);
});
test('an uncertain earlier submission is never reset by a later preparation failure or rejection', async () => {
  const payload = email.accountantMonthlyMail({from:'DRIMLI <compta@drimli.test>',to:'comptable@example.test',period:'2026-10',link:'https://drimli.test/original',missing:0});
  for (const options of [{publicBucket:true},{sendResult:{data:null,error:{statusCode:429}}}]) {
    const f=fixture({...options,job:{mail_payload:payload}}); assert.equal((await f.run()).status,'uncertain'); assert.ok(f.job.mail_payload); assert.equal(f.transitions.at(-1).action,'uncertain');
  }
});
const cronRequest = body => new Request('https://www.drimli.test/api/cron/accountant-monthly', { method: body ? 'POST' : 'GET', headers: {Authorization:'Bearer test-cron','Content-Type':'application/json'}, ...(body ? {body:JSON.stringify(body)} : {}) });
test('automatic job queues only inside the Paris window, then accepted jobs are not resent', async () => {
  const outside=fixture(); assert.equal((await (await outside.http.accountantCron(cronRequest())).json()).skipped,'outside_paris_monthly_window'); assert.equal(outside.reservations.length,0);
  const f=fixture({due:true}); assert.equal((await f.http.accountantCron(cronRequest())).status,200); assert.equal(f.sends.length,1); assert.equal(f.reservations.length,1);
  assert.equal((await f.http.accountantCron(cronRequest({action:'retry',id}))).status,200); assert.equal(f.sends.length,1);
});
test('pending work schedules a bounded continuation without executing external requests during tests', async () => {
  const f=fixture({due:true,pendingCount:3}); const response=await f.http.accountantCron(cronRequest());
  assert.equal(response.status,202); assert.equal((await response.json()).pending,3); assert.equal(f.deferred.length,1); assert.equal(f.sends.length,1);
});
test('continuation acknowledges first, and executes its batch only after response', async () => {
  const f=fixture(); const response=await f.http.accountantContinuation(cronRequest({})); assert.equal(response.status,202); assert.equal(f.sends.length,0); assert.equal(f.deferred.length,1);
  await f.deferred[0](); assert.equal(f.sends.length,1);
});
test('reconciliation requires an exact Resend proof of this persisted email and never resends', async () => {
  const payload=email.accountantMonthlyMail({from:'DRIMLI <compta@drimli.test>',to:'comptable@example.test',period:'2026-10',link:'https://www.drimli.test/exact-job-token',missing:0});
  const resendId='44444444-4444-4444-8444-444444444444';
  const f=fixture({job:{status:'uncertain',mail_payload:payload},proof:{...payload,id:resendId,to:[payload.to]}});
  assert.equal((await f.http.accountantCron(cronRequest({action:'reconcile',id,resendId}))).status,200); assert.equal(f.sends.length,0); assert.equal(f.reservations.at(-1).p_resend_id,resendId);
  const wrong=fixture({job:{status:'uncertain',mail_payload:payload},proof:{...payload,id:resendId,to:['other@example.test']}});
  assert.equal((await wrong.http.accountantCron(cronRequest({action:'reconcile',id,resendId}))).status,409); assert.equal(wrong.reservations.length,0); assert.equal(wrong.sends.length,0);
});
test('archive cleanup removes only reserved technical ZIP copies, never source documents', async () => {
  const f=fixture({job:{status:'sent',archive_expires_at:'2020-01-01T00:00:00Z'}}); assert.equal(await f.purge(),1);
  assert.deepEqual(f.removals,[`providers/${provider}/accountant-monthly/${id}/${lease}.zip`]); assert.equal(f.job.status,'purged'); assert.equal(f.sends.length,0);
  const active=fixture(); assert.equal(await active.purge(),0); assert.equal(active.removals.length,0);
  const unsafe=fixture({job:{status:'sent',archive_expires_at:'2020-01-01T00:00:00Z'},archiveFiles:['../../source.pdf']}); await assert.rejects(unsafe.purge(),/unexpected archive path/); assert.equal(unsafe.removals.length,0);
});


test('exhausted attempts cannot create an endless continuation or resend', async () => {
  const f=fixture({pendingCount:1,job:{status:'preparing',attempts:10,lease_until:'2020-01-01T00:00:00Z'}});
  const response=await f.http.accountantCron(cronRequest({action:'continue'}));
  assert.equal(response.status,200); assert.equal((await response.json()).pending,0);
  assert.equal(f.deferred.length,0); assert.equal(f.sends.length,0);
  await f.admin.rpc('recover_accountant_deliveries'); assert.equal(f.job.status,'exhausted');
  await f.http.accountantCron(cronRequest({action:'retry',id})); assert.equal(f.sends.length,0);
});
test('a tenth certain failure reports the terminal state',async()=>{
  const f=fixture({job:{attempts:10},sendResult:{data:null,error:{statusCode:429}}});
  assert.equal((await f.run()).status,'exhausted'); assert.equal(f.job.mail_payload,null);
});
test('preparation cancellation still records its result using the separate journal client',async()=>{
  const f=fixture(); const controller=new AbortController(); controller.abort();
  const response=await f.run({signal:controller.signal});
  assert.equal(response.status,'failed'); assert.equal(f.sends.length,0);
  assert.equal(f.transitions.at(-1).action,'failed');
});
test('insufficient finalization budget refuses submission and records a failure',async()=>{
  const f=fixture(); assert.equal((await f.run({deadlineAt:Date.now()+1000})).status,'failed');
  assert.equal(f.sends.length,0); assert.equal(f.transitions.at(-1).action,'failed');
});
test('worker uses separate preparation and journal transports',async()=>{
  const f=fixture(); await f.http.accountantCron(cronRequest({action:'continue'}));
  assert.equal(f.clients.length,2);
  const first=new AbortController(); first.abort();
  await f.clients[1].global.fetch('https://local.test',{signal:first.signal});
  await f.clients[0].global.fetch('https://local.test');
  assert.equal(f.fetches[0].init.signal.aborted,true);
  assert.equal(f.fetches[1].init.signal.aborted,false);
});
test('daily maintenance wakes interrupted preparation but never uncertain submissions',async()=>{
  const f=fixture({job:{lease_until:'2020-01-01T00:00:00Z'}});
  assert.equal((await f.http.accountantCleanup(cronRequest())).status,200);
  assert.equal(f.job.status,'pending'); assert.equal(f.deferred.length,1); assert.equal(f.sends.length,0);
  const uncertain=fixture({job:{status:'sending',mail_payload:{to:'comptable@example.test'},lease_until:'2020-01-01T00:00:00Z'}});
  await uncertain.http.accountantCleanup(cronRequest());
  assert.equal(uncertain.job.status,'uncertain'); assert.equal(uncertain.deferred.length,0); assert.equal(uncertain.sends.length,0);
});
test('failed recovery never dispatches work or purges documents',async()=>{
  const f=fixture({recoveryFailure:true}); assert.equal((await f.http.accountantCleanup(cronRequest())).status,503);
  assert.equal(f.deferred.length,0); assert.equal(f.removals.length,0); assert.equal(f.sends.length,0);
});
test('expired workers can be purged, active workers and PDF sources cannot',async()=>{
  for(const status of ['preparing','sending']){
    const f=fixture({job:{status,lease_until:'2020-01-01T00:00:00Z',archive_expires_at:'2020-01-01T00:00:00Z'}});
    assert.equal(await f.purge(),1); assert.equal(f.removals.length,1); assert.match(f.removals[0],/accountant-monthly\/.*\.zip$/);
    const active=fixture({job:{status}}); assert.equal(await active.purge(),0); assert.equal(active.removals.length,0);
  }
});
test('storage grants never exceed link or archive expiration',async()=>{
  for(const field of ['link_expires_at','archive_expires_at']){
    const expiry=Date.now()+10000;
    const f=fixture({job:{status:'sent',archive_path:`providers/${provider}/accountant-monthly/${id}/${lease}.zip`,[field]:new Date(expiry).toISOString()}});
    assert.equal((await f.http.accountantDownload(bearerRequest())).status,302);
    assert.ok(f.signatures[0].seconds>0 && f.signatures[0].seconds<=9);
  }
});
test('overlong or unrecognizable server grants fail closed',async()=>{
  for(const options of [{signedExpiry:Math.floor(Date.now()/1000)+3600},{invalidSignedUrl:'https://storage.test/private.zip'}]){
    const f=fixture({...options,job:{status:'sent',archive_path:`providers/${provider}/accountant-monthly/${id}/${lease}.zip`,link_expires_at:new Date(Date.now()+10000).toISOString()}});
    const response=await f.http.accountantDownload(bearerRequest()); assert.equal(response.status,503); assert.equal(response.headers.get('location'),null);
  }
});
test('subsecond remaining lifetime does not create a Storage grant',async()=>{
  const f=fixture({job:{status:'sent',archive_path:`providers/${provider}/accountant-monthly/${id}/${lease}.zip`,link_expires_at:new Date(Date.now()+500).toISOString()}});
  assert.equal((await f.http.accountantDownload(bearerRequest())).status,410); assert.equal(f.signatures.length,0);
});

test('concurrent continuations never submit the same reserved dossier twice',async()=>{
  const f=fixture();
  const responses=await Promise.all([f.http.accountantCron(cronRequest({action:'continue'})),f.http.accountantCron(cronRequest({action:'continue'}))]);
  assert.ok(responses.every(response=>response.status===200)); assert.equal(f.sends.length,1);
  assert.equal(f.transitions.filter(t=>t.action==='sending').length,1);
});

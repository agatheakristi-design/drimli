import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';
function load(path, dependencies, env = {}) {
  const loaded = { exports: {} };
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const js = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
  vm.runInNewContext(js, {module:loaded,exports:loaded.exports,require:name=>dependencies[name],process:{env},URL,AbortSignal,Buffer,console,crypto:webcrypto});
  return loaded.exports;
}
function harness({sendFails=false, finishFails=false, prepared=false, missingAdmin=false, kind="reply"}={}) {
  const sends=[], finishes=[], preparations=[];
  let queued=true;
  const frozen={from:'Drimli <support@example.invalid>',to:'user@example.invalid',subject:'Frozen',text:'Frozen body'};
  const email=load('lib/email.ts',{resend:{Resend:class {emails={send:async (payload, options)=>{
    sends.push({payload,options});
    if(sendFails) throw new Error('timeout after acceptance');
    return {data:{id:'email-1'},error:null};
  }};}}},{RESEND_API_KEY:'fixture',RESEND_FROM:'Drimli <support@example.invalid>',NEXT_PUBLIC_APP_URL:'https://drimli.example.invalid'});
  const admin={rpc:async(name,args)=>{
    if(name==='claim_help_notification'){
      if(!queued) return {data:[],error:null};
      queued=false;
      return {data:[{id:'event-1',kind,source_id:'reply-1',request_id:'request-1',lease_token:'lease-1',payload:prepared?frozen:null}],error:null};
    }
    if(name==='prepare_help_notification'){preparations.push(args);return {data:args.p_payload,error:null};}
    if(name==='finish_help_notification'){finishes.push(args);return {data:!finishFails,error:finishFails?{}:null};}
    throw new Error(name);
  },from:()=>({select:()=>({eq:()=>({single:async()=>({data:{owner_id:'owner-1',subject:'Sensitive subject',message:'Private message'},error:null})})})}),auth:{admin:{getUserById:async()=>({data:{user:{email:missingAdmin?null:'user@example.invalid'}},error:null})}}};
  const worker=load('lib/helpNotifications.ts',{'@/lib/email':email},{DRIMLI_HELP_ADMIN_EMAIL:'admin@example.invalid'});
  return {...worker,email,admin,sends,finishes,preparations};
}
test('reply notification contains no private message and links to authenticated help',async()=>{
  const h=harness();await h.processHelpNotification(h.admin);
  assert.equal(h.sends.length,1);
  assert.match(h.sends[0].payload.text,/https:\/\/drimli.example.invalid\/dashboard\?aide=1/);
  assert.doesNotMatch(h.sends[0].payload.text,/Sensitive subject|Private message/);
  assert.equal(h.sends[0].options.idempotencyKey,'help-notification/event-1');
  assert.equal(h.finishes[0].p_email_id,'email-1');
  await h.processHelpNotification(h.admin);assert.equal(h.sends.length,1);
});
test('admin email includes source identifiers and raw text without HTML interpretation',()=>{
  const h=harness();const payload=h.email.buildHelpNotificationEmail({kind:'request',recipient:'admin@example.invalid',requestId:'request-1',ownerId:'owner-1',ownerEmail:'user@example.invalid',subject:'Subject <b>',message:'Message <script>',sourceId:'request-1'});
  for(const value of ['request-1','owner-1','user@example.invalid','Subject <b>','Message <script>']) assert.ok(payload.text.includes(value));
  assert.equal(payload.html,undefined);
  assert.equal(payload.to,'admin@example.invalid');
});
test('send error remains pending, no false sent result',async()=>{
  const h=harness({sendFails:true});const result=await h.processHelpNotification(h.admin);
  assert.equal(result.sent,false);assert.equal(h.finishes[0].p_email_id,null);
  assert.equal(h.finishes[0].p_error,'send_or_configuration_failed');
});
test('persisted payload is reused verbatim for retry',async()=>{
  const h=harness({prepared:true});await h.processHelpNotification(h.admin);
  assert.equal(h.sends[0].payload.text,'Frozen body');
  assert.equal(h.sends[0].options.idempotencyKey,'help-notification/event-1');
});
test('missing user email does not send and schedules retry without starting the idempotency window',async()=>{
  const h=harness({missingAdmin:true});await h.processHelpNotification(h.admin);
  assert.equal(h.sends.length,0);assert.equal(h.preparations.length,0);
  assert.equal(h.finishes[0].p_email_id,null);
});
test('lost database acknowledgment is reported for lease recovery',async()=>{
  const h=harness({finishFails:true});await assert.rejects(()=>h.processHelpNotification(h.admin),/result not saved/);
  assert.equal(h.sends.length,1);
});

test('request notification goes only to configured administration address',async()=>{
  const h=harness({kind:'request'});await h.processHelpNotification(h.admin);
  assert.equal(h.sends[0].payload.to,'admin@example.invalid');
  assert.match(h.sends[0].payload.text,/Sensitive subject/);
  assert.match(h.sends[0].payload.text,/Private message/);
  assert.match(h.sends[0].payload.text,/owner-1/);
});
test('cron rejects missing or incorrect secret before accessing any service',async()=>{
  const dependencies={
    'node:crypto':{timingSafeEqual:()=>false},
    'next/server':{NextResponse:{json:(body,options)=>({body,...options})}},
    '@supabase/supabase-js':{createClient:()=>{throw new Error('Must not access database');}},
  };
  for(const env of [{},{DRIMLI_HELP_CRON_SECRET:'expected'}]) {
    const route=load('app/api/admin/help-notifications/retry/route.ts',dependencies,env);
    const response=await route.POST({headers:{get:()=>null}});
    assert.equal(response.status,401);
  }
});


test('help worker preserves a bounded network budget below the Vercel function limit', () => {
  const source = readFileSync(new URL('../app/api/admin/help-notifications/retry/route.ts', import.meta.url), 'utf8');
  const duration = Number(source.match(/maxDuration = (\d+)/)[1]) * 1000;
  const dbTimeout = Number(source.match(/signal: AbortSignal.timeout\(([\d_]+)\)/)[1].replaceAll('_', ''));
  const emailSource = readFileSync(new URL('./email.ts', import.meta.url), 'utf8').split('export async function sendHelpNotificationEmail')[1];
  const emailTimeout = Number(emailSource.match(/AbortSignal.timeout\(([\d_]+)\)/)[1].replaceAll('_', ''));
  assert.ok(6 * dbTimeout + emailTimeout <= duration - 20_000);
});

test('help links reject insecure or credential-bearing application URLs', () => {
  for (const base of ['http://example.invalid', 'https://login:secret@example.invalid']) {
    const email = load('lib/email.ts', { resend: { Resend: class {} } }, {
      RESEND_API_KEY: 'fixture', RESEND_FROM: 'Drimli <support@example.invalid>', NEXT_PUBLIC_APP_URL: base,
    });
    assert.throws(() => email.buildHelpNotificationEmail({ kind: 'reply', recipient: 'user@example.invalid',
      requestId: 'request', ownerId: 'owner', ownerEmail: 'user@example.invalid', subject: 'Subject', message: 'Text', sourceId: 'reply' }), /Invalid application URL/);
  }
});

test('installed Resend SDK forwards the help timeout and idempotency key without network access', async () => {
  const { Resend } = await import('resend');
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify({ id: 'mock-email' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const email = load('lib/email.ts', { resend: { Resend } }, { RESEND_API_KEY: 'fixture', RESEND_FROM: 'sender@example.invalid' });
    assert.equal(await email.sendHelpNotificationEmail({ from: 'sender@example.invalid', to: 'recipient@example.invalid', subject: 'Test', text: 'Mock only' }, 'sdk-test'), 'mock-email');
    assert.ok(captured.options.signal instanceof AbortSignal);
    assert.equal(captured.options.headers.get('Idempotency-Key'), 'help-notification/sdk-test');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('new requests target their own notification, with concurrent and repeated triggers claimed once', async () => {
  const h = harness({kind:'request'});
  let state = 'pending', queued = false;
  const admin = {...h.admin, from(table) {
    if (table !== 'help_notifications') return h.admin.from(table);
    return {
      upsert: async (value, options) => { assert.equal(value.source_id, 'new-request'); assert.equal(options.ignoreDuplicates, true); queued = true; return {error:null}; },
      update(value) {
        const filters = {};
        const query = {
          eq(key,v) {filters[key]=v;return query;}, is(key,v){filters[key]=v;return query;}, select(){return query;},
          async maybeSingle() {
            assert.equal(filters.source_id, 'new-request');assert.equal(filters.state,'pending');assert.equal(filters.attempts,0);assert.equal(filters.first_send_at,null);
            if (state !== 'pending') return {data:null,error:null};
            state = value.state;
            return {data:{id:'event-1',kind:'request',source_id:'new-request',request_id:'new-request',lease_token:value.lease_token,payload:null},error:null};
          },
        };return query;
      },
    };
  }};
  const results = await Promise.all([h.processHelpRequestNotification(admin,'new-request'),h.processHelpRequestNotification(admin,'new-request')]);
  assert.ok(queued);assert.equal(results.filter(r=>r.processed===1).length,1);assert.equal(h.sends.length,1);
  await h.processHelpRequestNotification(admin,'new-request');assert.equal(h.sends.length,1);
});

function requestRoute({signedIn=true, insertFails=false, emailFails=false}={}) {
  const callbacks=[], inserts=[], sent=[];
  const client={auth:{getUser:async()=>({data:{user:signedIn?{id:'owner-a'}:null},error:null})},from:()=>({insert(body){inserts.push(body);return {select:()=>({single:async()=>({data:insertFails?null:{id:'new-request',...body,created_at:'2026-11-06T10:00Z'},error:insertFails?{}:null})})};}})};
  let creations=0;
  const route=load('app/api/dashboard/help-requests/route.ts',{
    'next/server':{after:fn=>callbacks.push(fn),NextResponse:{json:(body,options)=>({body,...options})}},
    '@supabase/supabase-js':{createClient:()=>{creations++;return client;}},
    '@/lib/helpNotifications':{processHelpRequestNotification:async(_,id)=>{sent.push(id);if(emailFails)throw Error('mock mail failure');return {processed:1,sent:true};}},
  },{NEXT_PUBLIC_SUPABASE_URL:'https://example.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture',SUPABASE_SERVICE_ROLE_KEY:'server-only-fixture'});
  const request=(body={},auth=true)=>({headers:{get:name=>name==='authorization'&&auth?'Bearer test-user-token':null},json:async()=>body});
  return {route,callbacks,inserts,sent,request,get creations(){return creations;}};
}
test('request endpoint rejects unauthenticated and malformed requests without writes or mail',async()=>{
  const h=requestRoute();assert.equal((await h.route.POST(h.request({},false))).status,401);assert.equal(h.creations,0);
  assert.equal((await h.route.POST(h.request({subject:' ',message:'message'}))).status,400);assert.equal(h.inserts.length,0);
  const denied=requestRoute({signedIn:false});assert.equal((await denied.route.POST(denied.request({subject:'s',message:'m'}))).status,401);assert.equal(denied.inserts.length,0);
});
test('request is acknowledged before notification; forged owners and recipients are ignored, email failure preserves success',async()=>{
  const h=requestRoute({emailFails:true});
  const response=await h.route.POST(h.request({subject:' Sujet ',message:' Texte ',owner_id:'another-user',to:'attacker@example.invalid'}));
  assert.equal(response.status,201);assert.deepEqual(JSON.parse(JSON.stringify(h.inserts)),[{subject:'Sujet',message:'Texte'}]);
  assert.equal(h.sent.length,0);assert.equal(h.callbacks.length,1);
  await h.callbacks[0]();assert.equal(response.status,201);assert.equal(h.sent[0],'new-request');
});
test('failed request insertion never starts an email',async()=>{
  const h=requestRoute({insertFails:true});const response=await h.route.POST(h.request({subject:'s',message:'m'}));
  assert.equal(response.status,503);assert.equal(h.callbacks.length,0);assert.equal(h.sent.length,0);
});

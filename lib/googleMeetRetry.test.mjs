import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as crypto from 'node:crypto';
function load(file, imports, globals = {}) {
  const loaded = {exports:{}};
  const code = ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
  vm.runInNewContext(code,{module:loaded,exports:loaded.exports,require(name){assert.ok(name in imports,name);return imports[name];},process:{env:{GOOGLE_CLIENT_ID:'fake',GOOGLE_CLIENT_SECRET:'fake',GOOGLE_REDIRECT_URI:'fake',NEXT_PUBLIC_SUPABASE_URL:'fake',SUPABASE_SERVICE_ROLE_KEY:'fake',STRIPE_SECRET_KEY:'fake',STRIPE_WEBHOOK_SECRET:'fake'}},console:{log(){},error(){},warn(){}},AbortSignal,Date,setTimeout,...globals});
  return loaded.exports;
}
const googleFailure = status => ({response:{status}});
function harness({gets = [], inserts = [], oauth = [], deadline = 12000, pending = false, mismatch = false} = {}) {
  let clock = 1000;
  class Clock extends Date {static now(){return clock;}}
  const calls = {get:[],insert:[],oauth:0,wait:[]};
  const event = {id:'deterministic',hangoutLink:'https://meet.google.com/abc-defg-hij',organizer:{email:mismatch?'other@example.invalid':'professional@example.invalid'}};
  const integration = {account_email:'professional@example.invalid',refresh_token:'fake',access_token:'fake',scope:'scope'};
  const admin = {from(){const q={select(){return q;},eq(){return q;},abortSignal(){return q;},async maybeSingle(){return{data:integration,error:null};}};return q;}};
  async function consume(list, fallback) {const next=list.length?list.shift():fallback;if(next?.response||next?.code)throw next;return{data:next};}
  const calendar = {events:{async get(params,opts){calls.get.push(params);assert.equal(opts.retry,false);assert.ok(opts.timeout<=2000);return consume(gets,event);},async insert(params,opts){calls.insert.push(params);assert.equal(opts.retry,false);return consume(inserts,pending?{...event,hangoutLink:null,conferenceData:{createRequest:{status:{statusCode:'pending'}}}}:event);}}};
  const api = load('lib/googleCalendar.ts',{'node:crypto':crypto,'@supabase/supabase-js':{createClient:()=>admin},'@/lib/googleOAuthScopes':{hasGoogleCalendarScope:()=>true},googleapis:{google:{auth:{OAuth2:class{constructor(options){assert.equal(options.transporterOptions.retry,false);}credentials={access_token:'fake'};setCredentials(){}async getAccessToken(){calls.oauth++;const error=oauth.shift();if(error)throw error;return{token:'fake'};}}},calendar:()=>calendar}}},{Date:Clock,setTimeout(fn,ms){clock+=ms;calls.wait.push(ms);fn();}});
  return {calls,event,run:()=>api.createGoogleMeetAppointment({appointmentId:'appointment-fixture',providerId:'provider-fixture',title:'Rendez-vous Drimli',start:'2030-01-02T10:00Z',end:'2030-01-02T11:00Z',deadlineMs:clock+deadline})};
}
test('existing event is retrieved without inserting another meeting',async()=>{const h=harness();assert.equal((await h.run()).hangoutLink,h.event.hangoutLink);assert.equal(h.calls.insert.length,0);});
test('missing event is created once using existing stable identifiers',async()=>{const h=harness({gets:[googleFailure(404)]});await h.run();assert.equal(h.calls.insert.length,1);assert.equal(h.calls.insert[0].requestBody.id,h.calls.get[0].eventId);assert.equal(h.calls.insert[0].requestBody.conferenceData.createRequest.requestId,'meet-appointment-fixture');});
test('temporary lookup failures are retried at most three times',async()=>{const h=harness({gets:[googleFailure(503),googleFailure(503),googleFailure(503)]});await assert.rejects(h.run());assert.equal(h.calls.get.length,3);assert.equal(h.calls.insert.length,0);});
test('temporary failure recovers without duplicate event',async()=>{const h=harness({gets:[googleFailure(503),googleFailure(404)]});await h.run();assert.equal(h.calls.get.length,2);assert.equal(h.calls.insert.length,1);});
for(const code of [401,403])test(`authorization ${code} does not retry or insert`,async()=>{const h=harness({gets:[googleFailure(code)]});await assert.rejects(h.run());assert.equal(h.calls.get.length,1);assert.equal(h.calls.insert.length,0);});
test('revoked OAuth is not retried',async()=>{const h=harness({oauth:[googleFailure(400)]});await assert.rejects(h.run());assert.equal(h.calls.oauth,1);assert.equal(h.calls.get.length,0);});
test('temporary OAuth failure is retried without duplicate event',async()=>{const h=harness({oauth:[googleFailure(503)]});await h.run();assert.equal(h.calls.oauth,2);assert.equal(h.calls.insert.length,0);});
test('lost insert response retrieves the accepted event instead of inserting again',async()=>{const h=harness({gets:[googleFailure(404)],inserts:[{code:'ETIMEDOUT'}]});await h.run();assert.equal(h.calls.insert.length,1);assert.equal(h.calls.get.length,2);});
test('ambiguous insert followed by repeated 404 never inserts a second time',async()=>{const h=harness({gets:[googleFailure(404),googleFailure(404),googleFailure(404)],inserts:[{code:'ECONNRESET'}]});await assert.rejects(h.run());assert.equal(h.calls.insert.length,1);assert.equal(h.calls.get.length,3);});
test('409 reads the same event without another insert',async()=>{const h=harness({gets:[googleFailure(404)],inserts:[googleFailure(409)]});await h.run();assert.equal(h.calls.insert.length,1);assert.equal(h.calls.get.length,2);});
test('expired webhook budget makes no OAuth or Google call',async()=>{const h=harness({deadline:0});await assert.rejects(h.run());assert.equal(h.calls.oauth,0);assert.equal(h.calls.get.length,0);});
test('conference polling stops within its time budget',async()=>{const pending={id:'deterministic',hangoutLink:null,conferenceData:{createRequest:{status:{statusCode:'pending'}}}};const h=harness({gets:[googleFailure(404),...Array(10).fill(pending)],pending:true,deadline:1000});await assert.rejects(h.run());assert.ok(h.calls.wait.reduce((a,b)=>a+b,0)<1000);assert.equal(h.calls.insert.length,1);});
test('organizer mismatch fails without creating a replacement',async()=>{const h=harness({mismatch:true});await assert.rejects(h.run());assert.equal(h.calls.insert.length,0);});

function webhookHarness({failMeet = false, failIncident = false, pause = null} = {}) {
  const calls={meet:0,payments:0,invoices:0,markers:[],meetWritten:false};
  let state=null, invoice=null;
  const appt={id:'11111111-1111-4111-8111-111111111111',provider_id:'provider-fixture',product_id:'product-fixture',status:'pending',client_email:'client@example.invalid',client_name:'Client fictif',start_datetime:'2030-01-02T10:00Z',end_datetime:'2030-01-02T11:00Z',join_token:'opaque-fixture',confirmation_email_sent_at:'2026-01-01',cancellation_policy:'non_refundable'};
  const eventRow={};
  const admin={async rpc(name){
    if(name==='claim_stripe_webhook_event'){if(state)return{data:false};state='processing';return{data:true};}
    if(name==='create_paid_client_invoice'){calls.invoices++;invoice={id:'invoice-fixture',file_path:'archived.pdf'};return{data:invoice};}
    throw Error(name);
  },from(table){let patch=null,upsert=false;
    const result=()=>{
      if(table==='stripe_webhook_events')return{data:{processing_status:state}};
      if(table==='billing_checkout_snapshots')return{data:{amount_total:10000,currency:'EUR',application_fee_amount:500,vat_regime:'franchise_base'}};
      if(table==='appointments')return{data:{...appt}};
      if(table==='client_invoices')return{data:invoice};
      if(table==='profiles')return{data:{full_name:'Professionnel fictif'}};
      if(table==='products')return{data:{title:'Séance fictive'}};
      if(table==='drimli_payments')return{data:{id:'payment-fixture',application_fee_amount:500}};
      throw Error(table);
    };
    const apply=()=>{
      if(patch&&table==='stripe_webhook_events'){
        calls.markers.push({...patch});
        if(failIncident&&patch.last_error?.includes('GOOGLE_MEET_INCIDENT'))return{error:{message:'synthetic storage failure'}};
        Object.assign(eventRow,patch);if(patch.processing_status)state=patch.processing_status;
      }
      if(patch&&table==='appointments'){Object.assign(appt,patch);if(patch.video_join_url)calls.meetWritten=true;}
      if(upsert&&table==='drimli_payments')calls.payments++;
      return{error:null};
    };
    const q={select(){return q;},eq(){return q;},abortSignal(){return q;},update(value){patch=value;return q;},upsert(){upsert=true;return q;},async single(){apply();return result();},async maybeSingle(){apply();return result();},then(resolve,reject){return Promise.resolve(apply()).then(resolve,reject);}};
    return q;
  }};
  class MeetError extends Error {stage='calendar_insert';}
  const api=load('app/api/stripe/webhook/route.ts',{
    '@/lib/facturx':{},'node:crypto':crypto,'next/server':{NextResponse:{json:(data,opts)=>({data,status:opts?.status||200})}},'@supabase/supabase-js':{createClient:()=>admin},
    stripe:class{webhooks={constructEvent:()=>({id:'evt_fixture',type:'checkout.session.completed',data:{object:{id:'cs_fixture',payment_status:'paid',payment_intent:'pi_fixture',amount_total:10000,currency:'eur',metadata:{appointment_id:appt.id}}}})};paymentIntents={retrieve:async()=>({application_fee_amount:500,created:1,latest_charge:{created:1,application_fee:{id:'fee_fixture'}}})};},
    '@/lib/professionalAppointmentAlerts':{notifyProfessionalAppointment:async()=>{}},'@/lib/email':{sendAppointmentConfirmationEmail:async()=>{throw Error('No email during tests');}},
    '@/lib/googleCalendar':{GoogleMeetError:MeetError,async createGoogleMeetAppointment(){calls.meet++;assert.equal(calls.payments,1);assert.equal(calls.invoices,1);assert.ok(eventRow.last_error.includes('pending'));if(pause)await pause;if(failMeet)throw new MeetError('sensitive message must not be stored');return{eventId:'stable-event',hangoutLink:'https://meet.google.com/abc-defg-hij'};}},
    '@/lib/video/appointmentPortal':{},'@/lib/billing':{calculateTaxBreakdown:()=>({})},'@/lib/clientCreditNotes':{},'@/lib/drimliCommissionLedger':{recordCollectedCommission:async()=>{}},
  });
  return{calls,eventRow,run:()=>api.POST({headers:new Headers({'stripe-signature':'fake'}),text:async()=>''})};
}
test('failed Meet persists a safe administrative incident while the paid webhook completes',async()=>{
  const h=webhookHarness({failMeet:true});assert.equal((await h.run()).status,200);
  assert.equal(h.eventRow.processing_status,'completed');const incident=JSON.parse(h.eventRow.last_error);
  assert.equal(incident.code,'GOOGLE_MEET_INCIDENT');assert.equal(incident.stage,'calendar_insert');assert.equal(incident.state,'failed');
  assert.ok(!h.eventRow.last_error.includes('sensitive'));assert.ok(!h.eventRow.last_error.includes('@'));
  await h.run();assert.equal(h.calls.meet,1);assert.equal(h.calls.payments,1);assert.equal(h.calls.invoices,1);
});
test('successful Meet clears the pending marker and replay performs no new effects',async()=>{
  const h=webhookHarness();assert.equal((await h.run()).status,200);assert.equal(h.eventRow.last_error,null);assert.equal(h.calls.meetWritten,true);
  assert.equal((await h.run()).data.idempotent,true);assert.equal(h.calls.meet,1);assert.equal(h.calls.payments,1);assert.equal(h.calls.invoices,1);
});
test('concurrent deliveries of the same Stripe event cannot create two meetings or accounting records',async()=>{
  let release;const pause=new Promise(resolve=>{release=resolve;});const h=webhookHarness({pause});const first=h.run();
  for(let i=0;i<100&&!h.calls.meet;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.calls.meet,1);
  assert.equal((await h.run()).status,409);release();assert.equal((await first).status,200);
  assert.equal(h.calls.meet,1);assert.equal(h.calls.payments,1);assert.equal(h.calls.invoices,1);
});
test('incident storage failure is not silently acknowledged and no Google call occurs',async()=>{
  const h=webhookHarness({failIncident:true});assert.equal((await h.run()).status,500);assert.equal(h.calls.meet,0);
});

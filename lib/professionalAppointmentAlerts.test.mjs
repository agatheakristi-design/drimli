import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const move1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const move2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const payload = kind => ({kind, recipient:'pro@example.invalid', client_name:'Client <Test>', provider_name:'Pro Test',
  service_title:'Consultation', start:'2099-01-02T10:00:00Z', end:'2099-01-02T11:00:00Z',
  ...(kind==='rescheduled'?{old_start:'2099-01-01T10:00:00Z',old_end:'2099-01-01T11:00:00Z'}:{}), email_state:'pending'});
function load(path, dependencies, globals = {}) {
  const loaded = { exports: {} };
  const source = readFileSync(new URL(`../${path}`, import.meta.url),'utf8');
  const js = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(js,{module:loaded,exports:loaded.exports,require:name=>{
    if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`);
    return dependencies[name];
  },process:{env:{RESEND_API_KEY:'fixture',NEXT_PUBLIC_APP_URL:'https://example.invalid'}},URL,console,...globals});
  return loaded.exports;
}
function emailHarness({ fail = false, failFinish = false } = {}) {
  const events = new Map(), sent = [], logs = [];
  const email = load('lib/email.ts',{resend:{Resend:class {emails={send:async (message,options)=>{
    sent.push({message,options});
    if (fail) throw new Error('ambiguous timeout');
    return {data:{id:`email-${sent.length}`},error:null};
  }};}}});
  const admin = {rpc:async (name,args)=>{
    const key=`${args.p_kind}/${args.p_event_id}`;
    if(name==='record_client_cancellation_alert'){
      const cancelKey=`cancelled/${args.p_id}`;
      if(!events.has(cancelKey)) events.set(cancelKey,{...payload('cancelled'),actor:'client',refund_id:args.p_refund_id});
      return {error:null};
    }
    const event=events.get(key);
    if(name==='claim_professional_appointment_email') {
      if(!event || event.email_state!=='pending') return {data:null,error:null};
      event.email_state='claimed';
      return {data:{...event},error:null};
    }
    if(name==='finish_professional_appointment_email'){
      if(failFinish)return {error:{}};
      event.email_state=args.p_state; event.email_id=args.p_email_id;
      return {error:null};
    }
    throw new Error(name);
  }};
  const notifications=load('lib/professionalAppointmentAlerts.ts',{'@/lib/email':email},{console:{error:(...args)=>logs.push(args)}});
  return {events,sent,logs,admin,...notifications};
}

test('confirmation and concurrent/later webhook replay: one pro email, one durable event',async()=>{
  const h=emailHarness();h.events.set(`confirmed/${id}`,payload('confirmed'));
  await Promise.all(Array.from({length:8},()=>h.notifyProfessionalAppointment(h.admin,'confirmed',id)));
  await h.notifyProfessionalAppointment(h.admin,'confirmed',id);
  assert.equal(h.sent.length,1);assert.equal(h.events.size,1);
  assert.equal(h.events.get(`confirmed/${id}`).email_state,'sent');
  assert.equal(h.sent[0].message.subject,'Nouveau rendez-vous confirmé');
  assert.match(h.sent[0].message.text,/Client <Test>.*\nPrestation : Consultation/);
  assert.match(h.sent[0].message.text,/Date et heure :/);
  assert.match(h.sent[0].message.text,/https:\/\/example.invalid\/dashboard\/calendrier/);
  assert.match(h.sent[0].message.html,/Client &lt;Test&gt;/);
  assert.equal(h.sent[0].options.idempotencyKey,`professional-appointment/confirmed/${id}`);
});

test('two client reschedules: separate identities, emails with old/new slots',async()=>{
  const h=emailHarness();
  for(const eventId of [move1,move2]) {
    h.events.set(`rescheduled/${eventId}`,payload('rescheduled'));
    await h.notifyProfessionalAppointment(h.admin,'rescheduled',eventId);
    await h.notifyProfessionalAppointment(h.admin,'rescheduled',eventId);
  }
  assert.equal(h.events.size,2); assert.equal(h.sent.length,2);
  assert.notEqual(h.sent[0].options.idempotencyKey,h.sent[1].options.idempotencyKey);
  assert.equal(h.sent[0].message.subject,'Rendez-vous replanifié par le client');
  assert.match(h.sent[0].message.text,/Ancien créneau :.*1 janvier 2099/);
  assert.match(h.sent[0].message.text,/Nouveau créneau :.*2 janvier 2099/);
  assert.doesNotMatch(h.sent[0].message.subject,/Nouveau rendez-vous/);
});

test('client cancellation: one email and event with explicit origin and cancelled slot',async()=>{
  const h=emailHarness();
  await Promise.all([1,2,3].map(()=>h.notifyClientCancellation(h.admin,id,'provider','re_fixture')));
  assert.equal(h.events.size,1);assert.equal(h.sent.length,1);
  assert.equal(h.events.get(`cancelled/${id}`).actor,'client');
  assert.equal(h.sent[0].message.subject,'Rendez-vous annulé par le client');
  assert.match(h.sent[0].message.text,/Rendez-vous annulé :.*2 janvier 2099/);
});

for(const options of [{fail:true},{failFinish:true}]) test(`uncertain sends remain claimed and are never automatically duplicated: ${JSON.stringify(options)}`,async()=>{
  const h=emailHarness(options);h.events.set(`confirmed/${id}`,payload('confirmed'));
  await h.notifyProfessionalAppointment(h.admin,'confirmed',id);
  await h.notifyProfessionalAppointment(h.admin,'confirmed',id);
  assert.equal(h.sent.length,1);assert.equal(h.logs.length,1);
});

test('missing recipient is recorded without sending or invalidating the business event',async()=>{
  const h=emailHarness();h.events.set(`confirmed/${id}`,{...payload('confirmed'),recipient:null});
  await h.notifyProfessionalAppointment(h.admin,'confirmed',id);
  assert.equal(h.sent.length,0);assert.equal(h.events.get(`confirmed/${id}`).email_state,'failed');
});

function badgeHarness({path='/dashboard',initial=1,arriveDuringAck=false}={}) {
  let state=0, effect, interval, cleanup, first=true;
  const events=Array.from({length:initial},(_,i)=>({event_id:`event-${i}`,kind:'confirmed'}));
  const requests=[];
  const Component=load('app/dashboard/components/AppointmentAlertBadge.tsx',{
    react:{useState:()=>[state,value=>{state=value;}],useEffect:fn=>{if(first)effect=fn;}},
    'react/jsx-runtime':{jsx:(type,props)=>({type,props})},
    'next/navigation':{usePathname:()=>path},
    '@/lib/supabaseClient':{supabase:{auth:{getSession:async()=>({data:{session:{access_token:'fixture'}}})}}},
    './dashboard.module.css':{},
  },{window:{setInterval:(fn,ms)=>{assert.equal(ms,30000);interval=fn;return 1;},clearInterval(){},addEventListener(){},removeEventListener(){}},
    fetch:async (_url,options)=>{
      if(options.method==='POST'){
        const refs=JSON.parse(options.body).events;requests.push(refs);
        if(arriveDuringAck)events.push({event_id:'new-event',kind:'rescheduled'});
        for(const ref of refs){const i=events.findIndex(e=>e.event_id===ref.event_id&&e.kind===ref.kind);if(i>=0)events.splice(i,1);}
        return {ok:true};
      }
      return {ok:true,json:async()=>({events:events.map(e=>({...e}))})};
    },
  }).default;
  Component(); first=false;cleanup=effect();
  return {events,requests,render:()=>Component(),poll:()=>interval(),cleanup:()=>cleanup()};
}
const flush=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));};
for(const count of [0,1,9,10])test(`badge displays ${count} unread events`,async()=>{
  const h=badgeHarness({initial:count});await flush();
  assert.equal(h.render()?.props.children??null,count===0?null:count>9?'9+':count);
  assert.equal(h.requests.length,0);h.cleanup();
});
test('calendar entry acknowledges fetched events and clears badge',async()=>{
  const h=badgeHarness({path:'/dashboard/calendrier',initial:3});await flush();
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].length,3);assert.equal(h.render(),null);h.cleanup();
});
test('event arriving during/after acknowledgement stays unread, even while calendar remains open',async()=>{
  const h=badgeHarness({path:'/dashboard/calendrier',initial:2,arriveDuringAck:true});await flush();
  assert.equal(h.render().props.children,1);
  h.events.push({event_id:'later-event',kind:'cancelled'});h.poll();await flush();
  assert.equal(h.requests.length,1);assert.equal(h.render().props.children,2);h.cleanup();
});

test('authenticated endpoint scopes GET/POST to the session, never a supplied provider',async()=>{
  const calls=[];
  const admin={auth:{getUser:async()=>({data:{user:{id:'actual-provider'}},error:null})},rpc:async(name,args)=>{
    calls.push({name,args});
    return name==='professional_appointment_alerts'?{data:[{event_id:id,kind:'confirmed',payload:{recipient:'private@example.invalid'}},{event_id:move1,kind:'rescheduled',payload:{seen_at:'done'}}]}:{error:null};
  }};
  const route=load('app/api/dashboard/appointment-alerts/route.ts',{
    '@supabase/supabase-js':{createClient:()=>admin},
    'next/server':{NextResponse:{json:(body,options={})=>({body,status:options.status??200,headers:options.headers})}},
  });
  const headers=new Headers({authorization:'Bearer fixture'});
  const response=await route.GET({headers});assert.equal(response.body.events.length,1);
  assert.doesNotMatch(JSON.stringify(response.body),/private@example.invalid/);
  await route.POST({headers,json:async()=>({providerId:'attacker',events:[{event_id:id,kind:'confirmed'}]})});
  assert.equal(calls[1].args.p_provider_id,'actual-provider');
  assert.equal((await route.GET({headers:new Headers()})).status,401);
  assert.equal((await route.POST({headers,json:async()=>({events:[{event_id:'bad',kind:'confirmed'}]})})).status,400);
});

test('real payment webhook sends only after paid confirmation, replay after downstream failure cannot duplicate',async()=>{
  const h=emailHarness();
  let paid=false;
  const appointment={id,provider_id:'provider',product_id:'product',status:'pending',client_email:'client@example.invalid'};
  const admin={rpc:async(name,args)=> name==='claim_stripe_webhook_event'?{data:true,error:null}:h.admin.rpc(name,args),
    from(table){
      let update;
      const query={
        select(){return query;},eq(){return query;},update(value){update=value;return query;},upsert(){return query;},
        async maybeSingle(){
          if(table==='billing_checkout_snapshots') return {data:{amount_total:1000,currency:'EUR',application_fee_amount:100}};
          if(table==='appointments') return {data:{...appointment}};
          throw new Error(table);
        },
        async single(){
          // Deliberately fail later bookkeeping to exercise a legitimate replay.
          if(table==='drimli_payments') return {data:null,error:new Error('synthetic later failure')};
          throw new Error(table);
        },
        then(resolve,reject){return Promise.resolve().then(()=>{
          if(table==='appointments'&&update){
            if(appointment.status==='pending'&&update.status==='confirmed')h.events.set(`confirmed/${id}`,payload('confirmed'));
            Object.assign(appointment,update);
          }
          return {error:null};
        }).then(resolve,reject);},
      };return query;
    },
  };
  const route=load('app/api/stripe/webhook/route.ts',{
    stripe:class{webhooks={constructEvent:()=>({id:'evt_fixture',type:'checkout.session.completed',data:{object:{
      id:'cs_fixture',payment_status:paid?'paid':'unpaid',payment_intent:'pi_fixture',amount_total:1000,currency:'eur',metadata:{appointment_id:id},
    }}})};paymentIntents={retrieve:async()=>({application_fee_amount:100,created:1})};},
    'node:crypto':{},'next/server':{NextResponse:{json:(body,options={})=>({body,status:options.status??200})}},
    '@supabase/supabase-js':{createClient:()=>admin},
    '@/lib/professionalAppointmentAlerts':h,
    '@/lib/email':{},'@/lib/googleCalendar':{GoogleMeetError:class extends Error {}},'@/lib/video/appointmentPortal':{},
    '@/lib/billing':{},'@/lib/clientCreditNotes':{},'@/lib/drimliCommissionLedger':{},
  },{process:{env:{STRIPE_SECRET_KEY:'fixture',STRIPE_WEBHOOK_SECRET:'fixture',NEXT_PUBLIC_SUPABASE_URL:'fixture',SUPABASE_SERVICE_ROLE_KEY:'fixture'}},console:{error(){},warn(){}}});
  const request={headers:new Headers({'stripe-signature':'fixture'}),text:async()=>''};
  await route.POST(request);assert.equal(h.sent.length,0);assert.equal(h.events.size,0);
  paid=true;
  assert.equal((await route.POST(request)).status,500);
  assert.equal(h.sent.length,1);assert.equal(appointment.status,'confirmed');
  assert.equal((await route.POST(request)).status,500);
  assert.equal(h.sent.length,1);assert.equal(h.events.size,1);
});

for (const actor of ['client','professional']) test(`refund keeps financial flow and records explicit client origin only for ${actor}`,async()=>{
  const calls=[],refundRequests=[];
  const payment={id:'payment',provider_id:'provider',amount_paid:1000,refunded_amount:0,stripe_payment_intent_id:'pi_fixture',currency:'EUR'};
  const admin={rpc:async(name,args)=>{calls.push({name,args});return {data:true,error:null};},from(table){
    let updated=false;
    const query={select(){return query;},eq(){return query;},update(){updated=true;calls.push({name:`update:${table}`});return query;},upsert(){return query;},
      async maybeSingle(){return {data:updated?{id:'payment'}:payment,error:null};},
      async single(){return {data:{id:'stored-refund'},error:null};},
      then(resolve,reject){return Promise.resolve({error:null}).then(resolve,reject);},
    };return query;
  }};
  const stripe={refunds:{list:async()=>({data:[]}),create:async(args,options)=>{refundRequests.push({args,options});return {id:'re_fixture',status:'succeeded',amount:1000,created:1};}},
    paymentIntents:{retrieve:async()=>({latest_charge:null})}};
  const service=load('lib/appointmentRefund.ts',{
    '@/lib/billing':{refundDestinationChargePolicy:amount=>({amount,reverse_transfer:true})},
    '@/lib/clientCreditNotes':{ensureClientCreditNote:async()=>{}},
    '@/lib/drimliCommissionLedger':{},
  });
  const result=await service.refundAppointmentInFull({admin,stripe,appointmentId:id,providerId:'provider',cancelledBy:actor});
  assert.equal(result.refunded,true);assert.equal(refundRequests.length,1);
  assert.equal(refundRequests[0].args.amount,1000);
  assert.equal(refundRequests[0].options.idempotencyKey,'appointment-refund/payment/0/1000');
  assert.ok(calls.some(c=>c.name==='begin_drimli_payment_refund'));
  assert.ok(calls.some(c=>c.name==='complete_drimli_payment_refund'));
  assert.equal(calls.some(c=>c.name==='complete_client_cancellation_with_alert'),actor==='client');
  assert.equal(calls.some(c=>c.name==='update:appointments'),actor==='professional');
});

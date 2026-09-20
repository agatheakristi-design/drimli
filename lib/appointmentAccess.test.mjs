import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

// Exercise the actual server handlers with synthetic appointments and mocked
// storage/external effects. Real PostgreSQL RLS is tested separately in SQL.
function harness() {
  const appointment = { id: 'fixture', provider_id: 'provider-a', product_id: 'service-a',
    client_email: 'client@example.invalid', status: 'confirmed',
    start_datetime: new Date(Date.now()+72*3600000).toISOString(),
    end_datetime: new Date(Date.now()+73*3600000).toISOString(),
    video_provider: 'google_meet', video_join_url: 'https://meet.google.com/aaa-bbbb-ccc', video_room_status: 'open' };
  const effects = [];
  const admin = { from(table) {
    const filters = {};
    const query = {
      select() { return query; }, eq(k,v) { filters[k]=v; return query; },
      async maybeSingle() {
        if (table==='appointments') return { data: filters.join_token==='valid-fixture' ? appointment : null };
        if (table==='billing_checkout_snapshots') return {data:{cancellation_policy:'moderate'}};
        if (table==='profiles') return {data:{full_name:'Synthetic professional'}};
        if (table==='products') return {data:{title:'Synthetic service'}};
        return {data:null};
      },
    }; return query;
  }};
  class ActionError extends Error { constructor(message,status=409) {super(message);this.status=status;} }
  const newStart = new Date(Date.now()+96*3600000).toISOString();
  const newEnd = new Date(Date.parse(newStart)+3600000).toISOString();
  const cache = new Map();
  function load(path) {
    if(cache.has(path)) return cache.get(path);
    const source=readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
    const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX}}).outputText;
    const loaded={exports:{}};
    const require=(name)=> {
      if(name==='@supabase/supabase-js') return {createClient(_url,key){assert.equal(key,'fixture-server-key');return admin;}};
      if(name==='next/server') return {NextResponse:{json:(data,opts={})=>({status:opts.status??200,data}),redirect:(url,status=307)=>({status,url:String(url),headers:new Headers()})}};
      if(name==='stripe') return class Stripe {};
      if(name==='react/jsx-runtime') return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
      if(name==='@/lib/appointmentRefund') return {AppointmentRefundError:ActionError,async refundAppointmentInFull(p){assert.equal(p.appointmentId,'fixture');effects.push('cancel');return {refunded:true,refundId:'synthetic-refund'};}};
      if(name==='@/lib/appointmentReschedule') return {AppointmentRescheduleError:ActionError,async reschedulePaidAppointment(p){assert.equal(p.appointment.id,'fixture');effects.push('move');return {start_datetime:newStart,end_datetime:newEnd};}};
      if(name==='@/lib/email') return {sendAppointmentCancelledEmail:async()=>{},sendAppointmentRescheduledEmail:async()=>{}};
      if(name==='@/lib/video/appointmentPortal') return {buildAppointmentPortalUrl:t=>`https://example.invalid/rendez-vous/${t}`};
      if(name==='@/lib/clientAppointmentPolicy') return load('lib/clientAppointmentPolicy.ts');
      if(name==='@/lib/clientRescheduleSlots') return {filterClientRescheduleSlots:p=>p.slots};
      if(name==='@/lib/video/meetUrl') return load('lib/video/meetUrl.ts');
      if(name==='@/lib/video/joinWindow'||name==='./joinWindow') return load('lib/video/joinWindow.ts');
      if(name.endsWith('.css')) return {};
      if(name.includes('Logo')||name.startsWith('./')) return ()=>null;
      throw new Error(`Unexpected dependency ${name}`);
    };
    vm.runInNewContext(js,{module:loaded,exports:loaded.exports,require,URL,URLSearchParams,Headers,Date,console,
      process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-server-key',STRIPE_SECRET_KEY:'fixture'}},
      fetch:async()=>({ok:true,json:async()=>[{start:newStart,end:newEnd}]})});
    cache.set(path,loaded.exports);return loaded.exports;
  }
  return {load,appointment,effects,newStart};
}
const context=token=>({params:Promise.resolve({token})});
test('portal resolves a valid token and rejects an invalid token',async()=>{
  const h=harness(); const page=h.load('app/rendez-vous/[token]/page.tsx').default;
  const valid=await page(context('valid-fixture')); const invalid=await page(context('invalid-fixture'));
  assert.match(JSON.stringify(valid),/Synthetic professional/);
  assert.match(JSON.stringify(invalid),/invalide ou a expiré/);
  assert.doesNotMatch(JSON.stringify(invalid),/Synthetic professional|meet.google.com/);
});
test('client cancellation and rescheduling require the exact valid token',async()=>{
  const h=harness();
  const cancel=h.load('app/api/rendez-vous/[token]/cancel/route.ts').POST;
  const move=h.load('app/api/rendez-vous/[token]/reschedule/route.ts').POST;
  const request={url:'https://example.invalid/api/reschedule',json:async()=>({start:h.newStart})};
  assert.equal((await cancel(request,context('invalid-fixture'))).status,404);
  assert.equal((await move(request,context('invalid-fixture'))).status,404);
  assert.deepEqual(h.effects,[]);
  assert.equal((await cancel(request,context('valid-fixture'))).status,200);
  assert.equal((await move(request,context('valid-fixture'))).status,200);
  assert.deepEqual(h.effects,['cancel','move']);
});
test('Meet access requires a valid token, open room and authorized time window',async()=>{
  const h=harness(); h.appointment.start_datetime=new Date(Date.now()-60000).toISOString();
  h.appointment.end_datetime=new Date(Date.now()+3600000).toISOString();
  const join=h.load('app/api/rendez-vous/[token]/join/route.ts').GET;
  const request={url:'https://example.invalid/join'};
  assert.equal((await join(request,context('invalid-fixture'))).status,303);
  assert.equal((await join(request,context('valid-fixture'))).url,h.appointment.video_join_url);
  h.appointment.video_room_status='closed';
  assert.equal((await join(request,context('valid-fixture'))).status,303);
});

import assert from 'node:assert/strict';
import {readFileSync}from'node:fs';
import vm from'node:vm';
import test from'node:test';
import ts from'typescript';
function load(path,imports,extra={}){const loaded={exports:{}};vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../${path}`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,{module:loaded,exports:loaded.exports,require:n=>imports[n],process:{env:{}},Date,AbortSignal,console,...extra});return loaded.exports;}
const targetStart='2026-12-15T12:00:00Z',targetEnd='2026-12-15T13:00:00Z';
function harness({mode='ok',coherent=false,eventOverrides={},scope=true}={}){
 let appointment={id:'appointment',provider_id:'provider',status:'confirmed',start_datetime:targetStart,end_datetime:targetEnd,video_provider:'google_meet',video_room_id:'same-event',video_join_url:'https://meet.google.com/abc-defg-hij'};
 let event={id:'same-event',status:'confirmed',etag:'etag-1',organizer:{email:'provider@example.invalid'},hangoutLink:appointment.video_join_url,conferenceData:{conferenceId:'same-meet'},start:{dateTime:coherent?targetStart:'2026-12-10T12:00:00Z'},end:{dateTime:coherent?targetEnd:'2026-12-10T13:00:00Z'},...eventOverrides};
 const calls={get:0,patch:[],writes:[],notifications:[],rpc:0};let auditVersion=1;let audit={id:'move',new_start_datetime:targetStart,new_end_datetime:targetEnd,actor:'client'};
 const admin={from(table){const predicates={};const q={select(){return q},eq(k,v){predicates[k]=v;return q},abortSignal(){return q},order(){return q},limit(){return q},update(v){calls.writes.push({table,v});return q},async maybeSingle(){
  if(table==='appointments')return{data:predicates.provider_id===appointment.provider_id?structuredClone(appointment):null,error:null};
  if(table==='integrations')return{data:{account_email:'provider@example.invalid',access_token:'fixture',refresh_token:'fixture-refresh',scope:scope?'calendar':'',expires_at:null},error:null};
  if(table==='appointment_reschedule_audit')return{data:predicates.provider_id==='provider'?audit:null,error:null};throw Error(table);
 },then(resolve,reject){return Promise.resolve({error:null,...(table==='appointment_reschedule_audit'?{count:auditVersion}:{})}).then(resolve,reject)}};return q;}};
 const google={auth:{OAuth2:class{credentials={access_token:'fixture'};setCredentials(){}async getAccessToken(){if(mode==='revoked')throw Error('revoked');}}},calendar:()=>({events:{async get(){calls.get++;if(mode==='missing')throw{code:404};if(mode==='temporary'&&calls.get===1)throw{code:503};if(mode==='verify-timeout'&&calls.get===2)throw{code:'ETIMEDOUT'};
  if(mode==='stale'&&calls.get===1){appointment={...appointment,start_datetime:'2026-12-16T12:00:00Z',end_datetime:'2026-12-16T13:00:00Z'};event={...event,start:{dateTime:appointment.start_datetime},end:{dateTime:appointment.end_datetime},etag:'newer'};}
  if(mode==='aba'&&calls.get===1){const original=structuredClone(event);auditVersion+=2;event={...event,etag:'other-worker',start:{dateTime:'2026-12-16T12:00:00Z'},end:{dateTime:'2026-12-16T13:00:00Z'}};return{data:original};}
  return{data:structuredClone(event)};
 },async patch(params,options){calls.patch.push({params,options});assert.equal(params.eventId,'same-event');assert.equal(options.headers['If-Match'],event.etag);
  assert.deepEqual(Object.keys(params.requestBody).sort(),['end','start']);
  if(mode==='conflict'&&calls.patch.length===1){appointment={...appointment,start_datetime:'2026-12-16T12:00:00Z',end_datetime:'2026-12-16T13:00:00Z'};event={...event,etag:'newer',start:{dateTime:appointment.start_datetime},end:{dateTime:appointment.end_datetime}};throw{code:412};}
  if(mode!=='ignored-patch')event={...event,...params.requestBody,etag:'etag-'+(calls.patch.length+1)};
  if(mode==='lost-patch-response'&&calls.patch.length===1)throw{code:'ETIMEDOUT'};
  return{data:structuredClone(event)};
 },insert(){throw Error('Creating a second event is forbidden');}}})};
 const exports=load('lib/googleCalendarReschedule.ts',{googleapis:{google},'@/lib/googleOAuthScopes':{hasGoogleCalendarScope:v=>v==='calendar'},'@/lib/professionalAppointmentAlerts':{notifyProfessionalAppointment:async(...args)=>calls.notifications.push(args)}});
 return{...exports,admin,calls,params:{admin,appointmentId:'appointment',providerId:'provider',repair:true},get event(){return event},set audit(value){audit=value}};
}
test('updates only dates of the existing event, preserves Meet, and verifies with GET before acknowledging',async()=>{
 const h=harness();const result=await h.synchronizeAppointmentCalendar(h.params);assert.equal(result.coherent,true);assert.equal(h.calls.patch.length,1);assert.equal(h.calls.get,2);assert.equal(h.event.hangoutLink,'https://meet.google.com/abc-defg-hij');assert.equal(h.event.conferenceData.conferenceId,'same-meet');assert.equal(h.calls.writes.length,0);
});
test('an uncertain PATCH or verification response is recovered by GET without another update',async()=>{
 for(const mode of ['lost-patch-response','verify-timeout']){const h=harness({mode});assert.equal((await h.synchronizeAppointmentCalendar(h.params)).coherent,true);assert.equal(h.calls.patch.length,1);}
});
test('an already synchronized or replayed operation needs no extra PATCH',async()=>{
 const h=harness({coherent:true});await h.synchronizeAppointmentCalendar(h.params);await h.synchronizeAppointmentCalendar(h.params);assert.equal(h.calls.patch.length,0);
});
test('a missing event, revoked permission, wrong owner or changed Meet never creates or replaces a meeting',async()=>{
 for(const options of [{mode:'missing'},{mode:'revoked'},{scope:false},{eventOverrides:{organizer:{email:'other@example.invalid'}}},{eventOverrides:{hangoutLink:'https://meet.google.com/other-link'}},{eventOverrides:{status:'cancelled'}}]){
  const h=harness(options);await assert.rejects(()=>h.synchronizeAppointmentCalendar(h.params));assert.equal(h.calls.patch.length,0);
 }
});
test('temporary errors retry bounded reads, but ignored date changes are never acknowledged as success',async()=>{
 const temporary=harness({mode:'temporary'});assert.equal((await temporary.synchronizeAppointmentCalendar(temporary.params)).coherent,true);
 const ignored=harness({mode:'ignored-patch'});await assert.rejects(()=>ignored.synchronizeAppointmentCalendar(ignored.params),/synchronisation/);assert.equal(ignored.calls.patch.length,3);
});
test('stale and conflicting workers cannot overwrite a newer move that is already synchronized',async()=>{
 for(const mode of ['stale','conflict']){const h=harness({mode});await assert.rejects(()=>h.synchronizeAppointmentCalendar(h.params));assert.equal(h.event.start.dateTime,'2026-12-16T12:00:00Z');assert.ok(h.calls.patch.length<=1);}
});
test('status verification is read-only and reports disagreement instead of patching',async()=>{
 const h=harness();assert.equal((await h.synchronizeAppointmentCalendar({...h.params,repair:false})).coherent,false);assert.equal(h.calls.patch.length,0);
});
test('recovery uses the durable existing audit without writing dates, payments or another audit',async()=>{
 const h=harness();await h.resumeAppointmentMove(h.admin,'appointment','provider');assert.equal(h.calls.writes.length,0);assert.equal(h.calls.notifications.length,1);assert.equal(h.calls.notifications[0][2],'move');
 const missing=harness();missing.audit=null;await assert.rejects(()=>missing.resumeAppointmentMove(missing.admin,'appointment','provider'));assert.equal(missing.calls.patch.length,0);
 const foreign=harness();await assert.rejects(()=>foreign.resumeAppointmentMove(foreign.admin,'appointment','other-provider'));assert.equal(foreign.calls.patch.length,0);
});
test('if synchronization fails after SQL commit, the move service retains the audit and returns pending, never success',async()=>{
 const audit=[];let calls=0;
 const admin={from(){const q={select(){return q},eq(){return q},in(){return q},neq(){return q},lt(){return q},gt(){return q},limit:async()=>({data:[],error:null})};return q;},rpc:async()=>{calls++;audit.push({old:'old-date',new:targetStart});return{data:{id:'appointment',start_datetime:targetStart,end_datetime:targetEnd,reschedule_event_id:'move'},error:null};}};
 const service=load('lib/appointmentReschedule.ts',{'@/lib/googleCalendarReschedule':{synchronizeAppointmentCalendar:async()=>{throw Error('interruption or Google failure');}}},{console:{error(){}}});
 await assert.rejects(()=>service.reschedulePaidAppointment({admin,appointment:{id:'appointment',provider_id:'provider',status:'confirmed',start_datetime:'2026-12-10T12:00:00Z',end_datetime:'2026-12-10T13:00:00Z'},newStartIso:targetStart,now:new Date('2026-11-09T10:00:00Z')}),e=>e.status===503&&e.code==='CALENDAR_SYNC_PENDING');assert.equal(calls,1);assert.equal(audit.length,1);
});

function recoveryRoute(kind,{authenticated=true,found=true}={}){
 const calls=[];let creates=0;
 const admin={auth:{getUser:async()=>({data:{user:authenticated?{id:'actual-provider'}:null},error:null})},from(){const q={select(){return q},eq(key,value){calls.push({key,value});return q},maybeSingle:async()=>({data:found?{id:'owned-appointment',provider_id:'actual-provider',status:'confirmed',cancellation_policy:'moderate'}:null,error:null})};return q;}};
 const imports={'next/server':{NextResponse:{json:(body,options)=>({body,...options})}},'@supabase/supabase-js':{createClient:()=>{creates++;return admin}},'@/lib/googleCalendarReschedule':{resumeAppointmentMove:async(_,appointmentId,providerId)=>{calls.push({appointmentId,providerId});return{id:appointmentId,start_datetime:targetStart,end_datetime:targetEnd}}},'@/lib/clientAppointmentPolicy':{clientAppointmentPermissions:()=>({canReschedule:false,canCancel:false})}};
 const path=kind==='client'?'app/api/rendez-vous/[token]/calendar-sync/route.ts':'app/api/appointments/[id]/calendar-sync/route.ts';
 const route=load(path,imports);
 return{route,calls,get creates(){return creates}};
}
test('professional recovery requires authentication and uses the actual user, ignoring forged body ownership or dates',async()=>{
 const denied=recoveryRoute('professional');assert.equal((await denied.route.POST({headers:{get:()=>null}},{params:Promise.resolve({id:'appointment'})})).status,401);assert.equal(denied.creates,0);
 const invalid=recoveryRoute('professional',{authenticated:false});assert.equal((await invalid.route.POST({headers:{get:()=> 'Bearer invalid'}},{params:Promise.resolve({id:'appointment'})})).status,401);assert.equal(invalid.calls.length,0);
 const h=recoveryRoute('professional');const response=await h.route.POST({headers:{get:()=> 'Bearer valid'},json:async()=>({provider_id:'victim',start:'2099-01-01'})},{params:Promise.resolve({id:'owned-appointment'})});
 assert.equal(response.status,undefined);assert.equal(response.body.synchronized,true);assert.deepEqual(h.calls,[{appointmentId:'owned-appointment',providerId:'actual-provider'}]);
});
test('client recovery resolves the appointment only through the opaque token, not supplied IDs or dates',async()=>{
 const invalid=recoveryRoute('client',{found:false});assert.equal((await invalid.route.POST({}, {params:Promise.resolve({token:'invalid'})})).status,404);assert.ok(!invalid.calls.some(c=>'appointmentId'in c));
 const h=recoveryRoute('client');const response=await h.route.POST({json:async()=>({appointmentId:'victim',start:'2099-01-01'})},{params:Promise.resolve({token:'opaque-token'})});
 assert.equal(response.body.appointment.start_datetime,targetStart);assert.ok(h.calls.some(c=>c.key==='join_token'&&c.value==='opaque-token'));assert.ok(h.calls.some(c=>c.appointmentId==='owned-appointment'&&c.providerId==='actual-provider'));
});

test('an intervening A to B to A move cannot produce a false coherent result from an old Google read',async()=>{
 const h=harness({mode:'aba',coherent:true});await assert.rejects(()=>h.synchronizeAppointmentCalendar(h.params));assert.equal(h.calls.patch.length,0);assert.equal(h.event.etag,'other-worker');
});

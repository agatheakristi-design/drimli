import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const now='2026-11-09T10:00:00.000Z';
const Clock=class extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return Date.parse(now);}};
function moduleFrom(source,dependencies={}) {
 const loaded={exports:{}};
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
 vm.runInNewContext(js,{module:loaded,exports:loaded.exports,require:name=>dependencies[name],process:{env:{RESEND_API_KEY:'fixture',RESEND_FROM:'Drimli <sender@example.invalid>',NEXT_PUBLIC_APP_URL:'https://www.drimli.io'}},Date:Clock,URL,AbortSignal,console});
 return loaded.exports;
}
const policy=moduleFrom(readFileSync(new URL('./clientAppointmentPolicy.ts',import.meta.url),'utf8'));
function harness(source=readFileSync(new URL('./email.ts',import.meta.url),'utf8'),sendError=false) {
 const sends=[];
 const exports=moduleFrom(source,{resend:{Resend:class{emails={send:async(payload,options)=>{sends.push({payload,options});return sendError?{data:null,error:{message:'mock failure'}}:{data:{id:'mock-email'},error:null};}};}},'@/lib/clientAppointmentPolicy':policy});
 return{exports,sends};
}
const payload={appointmentId:'fixture',to:'client@example.invalid',patientName:'Florence',providerName:'Camille Martin',serviceTitle:'Consultation',startDateTimeIso:'2026-11-12T18:00:00.000Z',endDateTimeIso:'2026-11-12T19:00:00.000Z',appointmentJoinUrl:'https://www.drimli.io/rendez-vous/synthetic_token',cancellationPolicy:'moderate',appointmentStatus:'confirmed',managementAvailable:true};
test('paid confirmation contains the exact copy, complete name, Paris times, real logo and black CTA',async()=>{
 const h=harness();await h.exports.sendAppointmentConfirmationEmail(payload);const {html,text}=h.sends[0].payload;
 for(const value of ['Votre réservation est effectuée. Votre paiement a bien été effectué.','Réservation validée','Camille Martin','Consultation','19:00 – 20:00','Accéder à ma visio']){assert.ok(html.includes(value));assert.ok(text.includes(value));}
 assert.match(html,/https:\/\/www\.drimli\.io\/drimli-logo\.png/);assert.match(html,/background:#1d1d1f;color:#ffffff/);
 assert.equal(h.sends[0].options.idempotencyKey,'appointment-confirmation/fixture');
});
test('management links only lead to the existing secured client portal, never a mutating endpoint',async()=>{
 const h=harness();await h.exports.sendAppointmentConfirmationEmail(payload);const {html}=h.sends[0].payload;
 assert.ok(html.includes('Modifier mon rendez-vous'));assert.ok(html.includes('Annuler mon RDV'));
 const links=[...html.matchAll(/href="([^"]+)"/g)].map(x=>x[1]);assert.deepEqual(links,[payload.appointmentJoinUrl,payload.appointmentJoinUrl+'?action=reschedule',payload.appointmentJoinUrl]);
 assert.doesNotMatch(html,/meet\.google\.com|\/api\/rendez-vous\//);
});
test('non-refundable and legacy policies expose modification but never cancellation',async()=>{
 for(const cancellationPolicy of ['non_refundable','flexible']){
  const h=harness();await h.exports.sendAppointmentConfirmationEmail({...payload,cancellationPolicy});const {html,text}=h.sends[0].payload;
  assert.ok(html.includes('Modifier mon rendez-vous'));assert.ok(!html.includes('Annuler mon RDV'));assert.ok(!text.includes('Annuler mon RDV'));
 }
});
test('both management links disappear at the exact 48 hour deadline and afterwards',async()=>{
 for(const startDateTimeIso of ['2026-11-11T10:00:00.000Z','2026-11-10T10:00:00.000Z','2026-11-08T10:00:00.000Z']){
  const h=harness();await h.exports.sendAppointmentConfirmationEmail({...payload,startDateTimeIso});const {html,text}=h.sends[0].payload;
  for(const label of ['Modifier mon rendez-vous','Annuler mon RDV']){assert.ok(!html.includes(label));assert.ok(!text.includes(label));}
 }
});
test('unavailable management, missing policy or non-confirmed status never exposes an action',async()=>{
 for(const changes of [{managementAvailable:false},{managementAvailable:undefined},{cancellationPolicy:undefined},{appointmentStatus:'cancelled_by_client'},{appointmentStatus:undefined}]){
  const h=harness();await h.exports.sendAppointmentConfirmationEmail({...payload,...changes});assert.ok(!h.sends[0].payload.html.includes('class="email-action"'));
 }
});
test('HTML escapes user supplied names and descriptions',async()=>{
 const h=harness();await h.exports.sendAppointmentConfirmationEmail({...payload,patientName:'<script>alert(1)</script>',providerName:'Camille & Martin',serviceTitle:'<img src=x onerror=alert(1)>'});const {html}=h.sends[0].payload;
 assert.ok(html.includes('Camille &amp; Martin'));assert.ok(html.includes('&lt;script&gt;'));assert.doesNotMatch(html,/<script>|<img src=x/);
});
test('direct Google Meet, unsafe URLs and API links are rejected before email delivery',async()=>{
 for(const appointmentJoinUrl of ['https://meet.google.com/abc-defg-hij','javascript:alert(1)','https://www.drimli.io/api/rendez-vous/token/cancel','https://user:password@www.drimli.io/rendez-vous/token','https://www.drimli.io/rendez-vous/token?redirect=https://example.invalid']){
  const h=harness();await assert.rejects(()=>h.exports.sendAppointmentConfirmationEmail({...payload,appointmentJoinUrl}));assert.equal(h.sends.length,0);
 }
});
test('a send failure remains an error without changing the existing idempotency key',async()=>{
 const h=harness(undefined,true);await assert.rejects(()=>h.exports.sendAppointmentConfirmationEmail(payload),/mock failure/);assert.equal(h.sends[0].options.idempotencyKey,'appointment-confirmation/fixture');
});

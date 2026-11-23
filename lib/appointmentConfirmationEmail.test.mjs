import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const now='2026-11-09T10:00:00.000Z';
const Clock=class extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return Date.parse(now);}};
function moduleFrom(source,dependencies={},from='Drimli <sender@example.invalid>') {
 const loaded={exports:{}};
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
 vm.runInNewContext(js,{module:loaded,exports:loaded.exports,require:name=>dependencies[name],process:{env:{RESEND_API_KEY:'fixture',RESEND_FROM:from,NEXT_PUBLIC_APP_URL:'https://www.drimli.io'}},Date:Clock,URL,AbortSignal,console});
 return loaded.exports;
}
const policy=moduleFrom(readFileSync(new URL('./clientAppointmentPolicy.ts',import.meta.url),'utf8'));
function harness(source=readFileSync(new URL('./email.ts',import.meta.url),'utf8'),sendError=false,from='Drimli <sender@example.invalid>') {
 const sends=[];
 const exports=moduleFrom(source,{resend:{Resend:class{emails={send:async(payload,options)=>{sends.push({payload,options});return sendError?{data:null,error:{message:'mock failure'}}:{data:{id:'mock-email'},error:null};}};}},'@/lib/clientAppointmentPolicy':policy},from);
 return{exports,sends};
}
const payload={appointmentId:'fixture',to:'client@example.invalid',patientName:'Florence',providerName:'Camille Martin',serviceTitle:'Consultation',startDateTimeIso:'2026-11-12T18:00:00.000Z',endDateTimeIso:'2026-11-12T19:00:00.000Z',appointmentJoinUrl:'https://www.drimli.io/rendez-vous/synthetic_token',cancellationPolicy:'moderate',appointmentStatus:'confirmed',managementAvailable:true};
test('paid confirmation contains the exact copy, complete name, Paris times, real logo and black CTA',async()=>{
 const h=harness();await h.exports.sendAppointmentConfirmationEmail(payload);const {html,text}=h.sends[0].payload;
 for(const value of ['Votre rendez-vous avec Camille Martin est confirmé.','Réservation validée','Camille Martin','Consultation','19:00 – 20:00','Rejoindre la visio']){assert.ok(html.includes(value));assert.ok(text.includes(value));}
 assert.match(html,/https:\/\/www\.drimli\.io\/drimli-logo\.png/);assert.match(html,/background:#1d1d1f;color:#ffffff/);
 assert.equal(h.sends[0].options.idempotencyKey,'appointment-confirmation/fixture');
});
test('management links only lead to the existing secured client portal, never a mutating endpoint',async()=>{
 const h=harness();await h.exports.sendAppointmentConfirmationEmail(payload);const {html}=h.sends[0].payload;
 assert.ok(html.includes('Modifier mon rendez-vous'));assert.ok(html.includes('Annuler mon RDV'));
 const links=[...html.matchAll(/href="([^"]+)"/g)].map(x=>x[1]);assert.deepEqual(links,[payload.appointmentJoinUrl,payload.appointmentJoinUrl+'?action=reschedule',payload.appointmentJoinUrl+'?action=cancel']);
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

test('client email uses the requested copy, first name, pictograms and never an obsolete CTA',async()=>{
 const h=harness();await h.exports.sendAppointmentConfirmationEmail({...payload,patientName:'Florence Martin'});
 assert.equal(h.sends.length,1);assert.equal(h.sends[0].payload.to,payload.to);
 const {html,text}=h.sends[0].payload;
 assert.ok(html.includes('Bonjour Florence,'));assert.ok(!html.includes('Bonjour Florence Martin,'));
 assert.ok(html.includes('Réservation validée'));assert.ok(text.includes('Rejoindre la visio'));
 assert.doesNotMatch(html,/Rendez-vous confirmé|Rejondre la visio|Accéder à ma visio|Votre réservation est effectuée/);
 assert.ok(!html.includes('>Professionnel</td>'));
 for(const icon of ['calendar','clock','video','arrow']){
  assert.ok(html.includes(`/email-icons/${icon}.png`));
  const asset=readFileSync(new URL(`../public/email-icons/${icon}.png`,import.meta.url));
  assert.equal(asset.subarray(1,4).toString(),'PNG');
 }
});

test('client confirmation sets real From and Subject and a padded hidden Paris preheader',async()=>{
 for(const from of ['sender@example.invalid','Old Brand <sender@example.invalid>']){
  const h=harness(undefined,false,from);await h.exports.sendAppointmentConfirmationEmail(payload);
  const message=h.sends[0].payload;
  assert.equal(message.from,'Drimli <sender@example.invalid>');
  assert.equal(message.subject,'Rendez-vous avec Camille Martin');
  const preview=message.html.match(/<div aria-hidden="true" style="display:none!important;[^>]+>(.*?)<\/div>/s);
  assert.ok(preview);assert.ok(preview[1].startsWith('Votre rendez-vous du jeudi 12 novembre 2026 à 19:00'));
  assert.ok(preview[1].includes('&#847;&zwnj;&nbsp;'.repeat(100)));
  assert.ok(message.html.indexOf(preview[0])<message.html.indexOf('drimli-logo.png'));
 }
});
test('client preheader uses the appointment Paris date and summer time, not the send date',async()=>{
 const h=harness();await h.exports.sendAppointmentConfirmationEmail({...payload,startDateTimeIso:'2030-07-15T22:30:00Z',endDateTimeIso:'2030-07-15T23:30:00Z'});
 assert.ok(h.sends[0].payload.html.includes('Votre rendez-vous du mardi 16 juillet 2030 à 00:30'));
});

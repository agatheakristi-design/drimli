import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function load(path,dependencies,globals={}) {
 const loaded={exports:{}};
 const source=readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{module:loaded,exports:loaded.exports,require:n=>dependencies[n],process:{env:{RESEND_API_KEY:'fixture',RESEND_FROM:'Drimli <sender@example.invalid>',NEXT_PUBLIC_APP_URL:'https://www.drimli.io'}},URL,URLSearchParams,Date,AbortSignal,...globals});
 return loaded.exports;
}
const payload={kind:'confirmed',recipient:'professional@example.invalid',provider_name:'Camille Martin',client_name:'Florence Dupont',service_title:'Consultation',start:'2026-11-12T18:00:00.000Z',end:'2026-11-12T19:00:00.000Z'};
function email(){const sent=[];const exports=load('lib/email.ts',{resend:{Resend:class{emails={send:async(value,options)=>{sent.push({value,options});return{data:{id:'mock-email'},error:null};}};}}});return{exports,sent};}
test('professional paid confirmation uses exact copy, client full name and a targeted calendar link',async()=>{
 const h=email();await h.exports.sendProfessionalAppointmentEmail(payload,id);const {html,text}=h.sent[0].value;
 for(const value of ['Hello Camille,','Un nouveau rendez-vous a été confirmé sur votre page Drimli.','Rendez-vous confirmé','Florence Dupont','Consultation','19:00 – 20:00','Voir le rendez-vous']){assert.ok(html.includes(value));assert.ok(text.includes(value));}
 const links=[...html.matchAll(/href="([^"]+)"/g)].map(x=>x[1]);assert.deepEqual(links,[`https://www.drimli.io/dashboard/calendrier?appointment=${id}`]);
 assert.doesNotMatch(html,/Modifier|Annuler|meet\.google\.com|\/rendez-vous\//);
 assert.equal(h.sent[0].options.idempotencyKey,`professional-appointment/confirmed/${id}`);
});
test('professional and client confirmations share the same presentation rules',async()=>{
 const h=email();await h.exports.sendProfessionalAppointmentEmail(payload,id);const professional=h.sent[0].value.html;
 const css=['max-width:640px','padding:40px 32px','font-size:20px;font-weight:700','margin:34px 0;text-align:center;color:#16a34a;font-size:23px','padding:16px 24px;background:#1d1d1f;color:#ffffff','border-radius:10px;font-size:18px;font-weight:700'];
 for(const rule of css)assert.ok(professional.includes(rule));
 assert.match(professional,/drimli-logo\.png/);assert.match(professional,/max-width:480px/);
});
test('professional confirmation escapes supplied names and refuses invalid appointment identifiers',async()=>{
 const h=email();await h.exports.sendProfessionalAppointmentEmail({...payload,client_name:'<script>alert(1)</script>',provider_name:'Camille <Test>'},id);
 assert.match(h.sent[0].value.html,/&lt;script&gt;/);assert.doesNotMatch(h.sent[0].value.html,/<script>/);
 for(const bad of ['https://example.invalid','../other','abc?redirect=https://example.invalid'])await assert.rejects(()=>h.exports.sendProfessionalAppointmentEmail(payload,bad));
 assert.equal(h.sent.length,1);
});
const jsx={'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}};
function authHarness({path='/dashboard/calendrier',search='',connected=false}={}) {
 const navigations=[],effects=[];let index=0;
 const react={useEffect:fn=>effects.push(fn),useState:initial=>[index++===0?'professional@example.invalid':index===2?'fixture-password':initial,()=>{}]};
 const dependencies={react,...jsx,'next/navigation':{useRouter:()=>({replace:url=>navigations.push(url)}),usePathname:()=>path},'@/lib/supabaseClient':{supabase:{auth:{getSession:async()=>({data:{session:connected?{access_token:'fixture'}:null}}),getUser:async()=>({data:{user:connected?{id:'provider'}:null}}),signInWithPassword:async()=>({error:null})}}},'next/link':{__esModule:true,default:'Link'},'@/app/components/ui/Container':{__esModule:true,default:'Container'},'@/app/components/ui/Card':{__esModule:true,default:'Card'},'@/app/components/ui/Button':{__esModule:true,default:'Button'},'./auth.module.css':{__esModule:true,default:{}}};
 return{navigations,effects,load:source=>load(source,dependencies,{window:{location:{search}},fetch:async()=>({ok:true,json:async()=>({accountReady:true})})})};
}
const nodes=tree=>[tree,...(Array.isArray(tree?.props?.children)?tree.props.children.flat(Infinity):[tree?.props?.children]).filter(x=>x&&typeof x==='object').flatMap(nodes)];
test('dashboard gate preserves only a valid calendar appointment when sending an unauthenticated user to login',async()=>{
 for(const [search,expected]of [[`?appointment=${id}`,`/login?appointment=${id}`],['?appointment=https://example.invalid','/login'],['?next=//example.invalid','/login']]){
  const h=authHarness({search});h.load('app/components/DashboardGate.tsx').default({children:null});h.effects[0]();await new Promise(setImmediate);assert.equal(h.navigations[0],expected);
 }
 const ordinary=authHarness({path:'/dashboard',search:`?appointment=${id}`});ordinary.load('app/components/DashboardGate.tsx').default({children:null});ordinary.effects[0]();await new Promise(setImmediate);assert.equal(ordinary.navigations[0],'/login');
});
test('password login returns to the targeted calendar; ordinary and malicious destinations retain the old homepage flow',async()=>{
 for(const [search,expected]of [[`?appointment=${id}`,`/dashboard/calendrier?appointment=${id}`],['','/'],['?appointment=//example.invalid','/'],['?next=https://example.invalid','/']]){
  const h=authHarness({search});const tree=h.load('app/login/page.tsx').default();const button=nodes(tree).find(n=>n.type==='Button'&&n.props.onClick);assert.ok(button);await button.props.onClick();assert.equal(h.navigations[0],expected);
 }
});
test('an already authenticated visitor to login is also returned to the same targeted appointment',async()=>{
 const h=authHarness({search:`?appointment=${id}`,connected:true});h.load('app/login/page.tsx').default();h.effects[0]();await new Promise(setImmediate);assert.equal(h.navigations[0],`/dashboard/calendrier?appointment=${id}`);
});

test('professional confirmation sets actual envelope fields, padded preview and existing icons',async()=>{
 const sent=[];const api=load('lib/email.ts',{resend:{Resend:class{emails={send:async value=>{sent.push(value);return{data:{id:'mock'},error:null}}}}}},{process:{env:{RESEND_API_KEY:'fixture',RESEND_FROM:'Old Brand <sender@example.invalid>',NEXT_PUBLIC_APP_URL:'https://www.drimli.io'}}});
 await api.sendProfessionalAppointmentEmail(payload,id);assert.equal(sent.length,1);
 const message=sent[0];assert.equal(message.from,'Drimli <sender@example.invalid>');
 assert.equal(message.subject,'Nouveau rendez-vous • Florence Dupont');
 const preview=message.html.match(/<div aria-hidden="true" style="display:none!important;[^>]+>(.*?)<\/div>/s);
 assert.ok(preview);assert.ok(preview[1].startsWith('Hello Camille, un nouveau rendez-vous a été confirmé sur votre page Drimli.'));
 assert.ok(preview[1].includes('&#847;&zwnj;&nbsp;'.repeat(100)));
 for(const icon of ['calendar','clock','arrow'])assert.ok(message.html.includes(`/email-icons/${icon}.png`));
 assert.ok(message.html.includes('Hello Camille,'));assert.ok(message.html.includes('Rendez-vous confirmé'));
});
test('reschedule and cancellation emails retain their existing sender and subject',async()=>{
 const sent=[];const api=load('lib/email.ts',{resend:{Resend:class{emails={send:async value=>{sent.push(value);return{data:{id:'mock'},error:null}}}}}},{process:{env:{RESEND_API_KEY:'fixture',RESEND_FROM:'Existing Brand <sender@example.invalid>',NEXT_PUBLIC_APP_URL:'https://www.drimli.io'}}});
 for(const kind of ['rescheduled','cancelled'])await api.sendProfessionalAppointmentEmail({...payload,kind},id);
 assert.equal(sent[0].subject,'Rendez-vous replanifié par le client');assert.equal(sent[1].subject,'Rendez-vous annulé par le client');
 for(const message of sent){assert.equal(message.from,'Existing Brand <sender@example.invalid>');assert.ok(!message.html.includes('mso-hide:all'));}
});

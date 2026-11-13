import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const Clock=class extends Date{constructor(...args){super(...(args.length?args:['2026-11-09T10:00:00.000Z']));}};
function load(path,imports,globals={}){
 const loaded={exports:{}};
 const source=readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{module:loaded,exports:loaded.exports,require:n=>imports[n],Date:Clock,Intl,URL,URLSearchParams,AbortController,process:{env:{}},...globals});
 return loaded.exports;
}
const jsx={'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}};
const nodes=tree=>[tree,...(Array.isArray(tree?.props?.children)?tree.props.children.flat(Infinity):[tree?.props?.children]).filter(x=>x&&typeof x==='object').flatMap(nodes)];
function management(overrides={}){
 const state=[],effects=[],requests=[];let cursor=0;
 const react={useState(initial){const i=cursor++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return[state[i],value=>{state[i]=typeof value==='function'?value(state[i]):value;}];},useMemo:fn=>fn(),useEffect:fn=>effects.push(fn)};
 const props={token:'synthetic-token',serviceTitle:'Synthetic service',initialStart:'2026-11-12T23:30:00Z',initialEnd:'2026-11-13T00:30:00Z',initialPermissions:{canReschedule:true,canCancel:true},initiallyRescheduling:true,...overrides};
 const component=load('app/rendez-vous/[token]/AppointmentManagement.tsx',{react,...jsx,'./page.module.css':{__esModule:true,default:{}}},{window:{location:{pathname:'/rendez-vous/synthetic-token',replace(){}}},fetch:async(url,options)=>{requests.push({url,options});return{ok:true,json:async()=>url.endsWith('/calendar-sync')?{appointment:{start_datetime:props.initialStart,end_datetime:props.initialEnd},permissions:props.initialPermissions}:[]};}}).default;
 return{render(){cursor=0;effects.length=0;return component(props);},effects,requests};
}
test('direct modification entry opens the existing date picker on the appointment date in Paris, without submitting anything',async()=>{
 const h=management(),tree=h.render();const input=nodes(tree).find(n=>n.type==='input'&&n.props.type==='date');assert.ok(input);assert.equal(input.props.value,'2026-11-13');assert.equal(input.props.min,'2026-11-09');
 h.effects[0]();await new Promise(setImmediate);assert.equal(h.requests.length,1);assert.match(h.requests[0].url,/\/reschedule\?date=2026-11-13$/);assert.equal(h.requests[0].options.method,undefined);
});
test('a direct-entry hint cannot open the picker or load slots when rescheduling permission is absent',()=>{
 const h=management({initialPermissions:{canReschedule:false,canCancel:false}}),tree=h.render();assert.ok(!nodes(tree).some(n=>n.type==='input'&&n.props.type==='date'));h.effects[0]();assert.equal(h.requests.length,0);
});
test('ordinary portal access exposes neither management link nor automatic request',()=>{
 const h=management({initiallyRescheduling:false}),tree=h.render();
 assert.ok(!nodes(tree).some(n=>n.type==='input'&&n.props.type==='date'));
 assert.ok(!JSON.stringify(tree).includes('Déplacer mon rendez-vous'));
 assert.ok(!JSON.stringify(tree).includes('Annuler mon rendez-vous'));
 h.effects[0]();assert.equal(h.requests.length,0);
});
test('the email cancellation entry only submits after explicit confirmation',async()=>{
 const h=management({initiallyRescheduling:false,initiallyCancelling:true}),tree=h.render();
 assert.ok(JSON.stringify(tree).includes('Voulez-vous vraiment annuler votre rendez-vous ?'));
 h.effects[0]();assert.equal(h.requests.length,0);
 const keep=nodes(tree).find(n=>n.type==='button'&&n.props.children==='Conserver mon rendez-vous');
 keep.props.onClick();assert.equal(h.requests.length,0);
 assert.ok(!JSON.stringify(h.render()).includes('Confirmer l'));
 const confirmHarness=management({initiallyRescheduling:false,initiallyCancelling:true});
 const confirm=nodes(confirmHarness.render()).find(n=>n.type==='button'&&n.props.children==="Confirmer l'annulation");
 await confirm.props.onClick();assert.equal(confirmHarness.requests.length,1);
 assert.equal(confirmHarness.requests[0].options.method,'POST');
 assert.equal(confirmHarness.requests[0].options.body,JSON.stringify({confirmed:true}));
});
test('a cancellation hint cannot bypass policy permissions',()=>{
 const h=management({initiallyRescheduling:false,initiallyCancelling:true,initialPermissions:{canReschedule:true,canCancel:false}});
 assert.ok(!JSON.stringify(h.render()).includes('Confirmer l'));assert.equal(h.requests.length,0);
});
const policy=load('lib/clientAppointmentPolicy.ts',{});
async function portal({action='reschedule',status='confirmed',start='2026-11-12T18:00:00Z',validToken=true,syncPending=false,syncFailure=false,renderTree=false,token='opaque-token'}={}){
 const appointment={id:'synthetic',provider_id:'provider',product_id:'product',status,start_datetime:start,end_datetime:'2026-11-13T19:00:00Z',video_room_status:'closed'};
 const admin={from(table){const q={select(){return q;},eq(key,value){if(table==='appointments'){assert.equal(key,'join_token');assert.equal(value,token);}return q;},maybeSingle:async()=>({data:table==='appointments'?(validToken?appointment:null):table==='profiles'?{full_name:'Provider'}:table==='products'?{title:'Service'}:{cancellation_policy:'moderate'},error:null})};return q;}};
 const component=load('app/rendez-vous/[token]/page.tsx',{...jsx,'@supabase/supabase-js':{createClient:()=>admin},'@/app/components/ui/Logo':{__esModule:true,default:'Logo'},'@/lib/video/joinWindow':{getJoinWindowState:()=> 'early'},'@/lib/video/meetUrl':{isGoogleMeetUrl:()=>false},'./PortalRefresh':{__esModule:true,default:'Refresh'},'./AppointmentManagement':{__esModule:true,default:'Management'},'@/lib/clientAppointmentPolicy':policy,'@/lib/googleCalendarReschedule':{latestAppointmentMove:async()=>syncPending||syncFailure?{id:'existing-audit'}:null,synchronizeAppointmentCalendar:async()=>{if(syncFailure)throw Error('Google unavailable');return{coherent:!syncPending}}},'./page.module.css':{__esModule:true,default:{}}}).default;
 const tree=await component({params:Promise.resolve({token}),searchParams:Promise.resolve({action})});return renderTree ? tree : nodes(tree).find(n=>n.type==='Management')?.props;
}
test('the server only enables direct opening after validating the token, confirmed status and existing 48-hour permission',async()=>{
 assert.equal((await portal()).initiallyRescheduling,true);
 assert.equal((await portal({start:'2026-11-11T10:00:00Z'})).initiallyRescheduling,false);
 assert.equal(await portal({validToken:false}),undefined);assert.equal(await portal({status:'cancelled_by_client'}),undefined);
});
test('absent, unknown or repeated action values do not change the ordinary portal opening',async()=>{
 for(const action of [null,'cancel','unknown',['reschedule','reschedule']])assert.equal((await portal({action})).initiallyRescheduling,false);
});

test('pending synchronization hides the move form and recovery never posts a new date',async()=>{
 const h=management({initialSyncPending:true}),tree=h.render();assert.ok(!nodes(tree).some(n=>n.type==='input'&&n.props.type==='date'));
 const retry=nodes(tree).find(n=>n.type==='button'&&n.props.children==='Réessayer la synchronisation');assert.ok(retry);await retry.props.onClick();
 assert.equal(h.requests.length,1);assert.equal(h.requests[0].url,'/api/rendez-vous/synthetic-token/calendar-sync');assert.equal(h.requests[0].options.method,'POST');assert.equal(h.requests[0].options.body,undefined);
 assert.ok(!JSON.stringify(h.render()).includes('Le déplacement n’est pas confirmé'));
});

test('after an interrupted move the portal derives pending status from the durable audit and actual Google state',async()=>{
 for(const options of [{syncPending:true},{syncFailure:true}]){
  const props=await portal(options);assert.equal(props.initialSyncPending,true);assert.equal(props.initiallyRescheduling,false);
 }
});

test('management entry has its own title, while the ordinary portal retains video status',async()=>{
 const move=JSON.stringify(await portal({renderTree:true}));
 assert.ok(move.includes('Modifier mon rendez-vous'));assert.ok(!move.includes('visioconférence est en cours'));
 const ordinary=JSON.stringify(await portal({action:null,renderTree:true}));assert.ok(ordinary.includes('visioconférence est en cours'));
 assert.equal((await portal({action:'cancel'})).initiallyCancelling,true);
 assert.equal((await portal({action:'cancel',start:'2026-11-11T10:00:00Z'})).initiallyCancelling,false);
});

test('the real email HTML links carry the exact opaque token and open the correct secured form',async()=>{
 const token='f'.repeat(43),emails=[];
 const api=load('lib/email.ts',{'@/lib/clientAppointmentPolicy':policy,resend:{Resend:class{emails={send:async(payload)=>{emails.push(payload);return{data:{id:'mock'},error:null}}}}}},{process:{env:{RESEND_API_KEY:'fixture',RESEND_FROM:'sender@example.invalid'}}});
 await api.sendAppointmentConfirmationEmail({appointmentId:'fixture',to:'client@example.invalid',patientName:'Client fictif',providerName:'Pro fictif',serviceTitle:'Séance',startDateTimeIso:'2026-11-12T18:00:00Z',endDateTimeIso:'2026-11-12T19:00:00Z',appointmentJoinUrl:`https://www.drimli.io/rendez-vous/${token}`,cancellationPolicy:'moderate',appointmentStatus:'confirmed',managementAvailable:true});
 assert.equal(emails.length,1);
 const urls=[...emails[0].html.matchAll(/href="([^"]+)"/g)].map(m=>new URL(m[1].replaceAll('&amp;','&')));
 assert.equal(urls.length,3);
 for(const [i,action] of [null,'reschedule','cancel'].entries()){
  const url=urls[i];assert.equal(url.origin,'https://www.drimli.io');assert.equal(url.pathname,`/rendez-vous/${token}`);assert.equal(url.searchParams.get('action'),action);
  const props=await portal({token,action});assert.equal(props.token,token);
  assert.equal(props.initiallyRescheduling,action==='reschedule');assert.equal(props.initiallyCancelling,action==='cancel');
  const h=management({...props,initialStart:props.initialStart,initialEnd:props.initialEnd});h.render();h.effects[0]();
  assert.ok(!h.requests.some(r=>r.options?.method==='POST'));
 }
});
test('expired action links explain that the action is forbidden rather than leaving an empty form',async()=>{
 for(const [action,message]of [['cancel','Ce rendez-vous ne peut plus être annulé depuis ce lien.'],['reschedule','Ce rendez-vous ne peut plus être déplacé depuis ce lien.']]){
  const tree=await portal({action,start:'2026-11-11T10:00:00Z',renderTree:true});
  assert.ok(JSON.stringify(tree).includes(message));
 }
});

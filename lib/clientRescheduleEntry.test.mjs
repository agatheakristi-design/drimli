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
test('ordinary portal access keeps the picker closed and manual opening resets the date to the current appointment',()=>{
 const h=management({initiallyRescheduling:false});let tree=h.render();assert.ok(!nodes(tree).some(n=>n.type==='input'&&n.props.type==='date'));
 const move=tree=>nodes(tree).find(n=>n.type==='button'&&n.props.children==='Déplacer mon rendez-vous');move(tree).props.onClick();tree=h.render();const input=nodes(tree).find(n=>n.type==='input'&&n.props.type==='date');assert.equal(input.props.value,'2026-11-13');input.props.onChange({target:{value:'2026-12-01'}});
 tree=h.render();move(tree).props.onClick();tree=h.render();move(tree).props.onClick();tree=h.render();assert.equal(nodes(tree).find(n=>n.type==='input'&&n.props.type==='date').props.value,'2026-11-13');
});
const policy=load('lib/clientAppointmentPolicy.ts',{});
async function portal({action='reschedule',status='confirmed',start='2026-11-12T18:00:00Z',validToken=true,syncPending=false,syncFailure=false}={}){
 const appointment={id:'synthetic',provider_id:'provider',product_id:'product',status,start_datetime:start,end_datetime:'2026-11-13T19:00:00Z',video_room_status:'closed'};
 const admin={from(table){const q={select(){return q;},eq(key,value){if(table==='appointments'){assert.equal(key,'join_token');assert.equal(value,'opaque-token');}return q;},maybeSingle:async()=>({data:table==='appointments'?(validToken?appointment:null):table==='profiles'?{full_name:'Provider'}:table==='products'?{title:'Service'}:{cancellation_policy:'moderate'},error:null})};return q;}};
 const component=load('app/rendez-vous/[token]/page.tsx',{...jsx,'@supabase/supabase-js':{createClient:()=>admin},'@/app/components/ui/Logo':{__esModule:true,default:'Logo'},'@/lib/video/joinWindow':{getJoinWindowState:()=> 'early'},'@/lib/video/meetUrl':{isGoogleMeetUrl:()=>false},'./PortalRefresh':{__esModule:true,default:'Refresh'},'./AppointmentManagement':{__esModule:true,default:'Management'},'@/lib/clientAppointmentPolicy':policy,'@/lib/googleCalendarReschedule':{latestAppointmentMove:async()=>syncPending||syncFailure?{id:'existing-audit'}:null,synchronizeAppointmentCalendar:async()=>{if(syncFailure)throw Error('Google unavailable');return{coherent:!syncPending}}},'./page.module.css':{__esModule:true,default:{}}}).default;
 const tree=await component({params:Promise.resolve({token:'opaque-token'}),searchParams:Promise.resolve({action})});return nodes(tree).find(n=>n.type==='Management')?.props;
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

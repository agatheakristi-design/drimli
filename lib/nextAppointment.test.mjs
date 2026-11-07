import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
function harness({user='provider-a',rows=[],failure=false}={}) {
  let queries=0;
  const source=readFileSync(new URL('../app/api/dashboard/next-appointment/route.ts',import.meta.url),'utf8');
  const filters=[],orders=[];let maximum=0;
  const query={select(){return query;},eq(key,value){filters.push(r=>r[key]===value);return query;},gt(key,value){filters.push(r=>r[key]>value);return query;},order(key,{ascending}){orders.push({key,ascending});return query;},limit(n){maximum=n;return query;},maybeSingle:async()=>{
    queries++;
    const matches=rows.filter(r=>filters.every(f=>f(r))).sort((a,b)=>{for(const {key,ascending}of orders){if(a[key]!==b[key])return (a[key]<b[key]?-1:1)*(ascending?1:-1);}return 0;}).slice(0,maximum);
    return{data:failure?null:matches[0]?{id:matches[0].id}:null,error:failure?{}:null};
  }};
  const admin={auth:{getUser:async()=>({data:{user:user?{id:user}:null},error:null})},from(name){assert.equal(name,'appointments');return query;}};
  const imports={'next/server':{NextResponse:{json:(body,options)=>({body,...options})}},'@supabase/supabase-js':{createClient:()=>admin}};
  const loaded={exports:{}};
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{module:loaded,exports:loaded.exports,require:name=>imports[name],process:{env:{}},Date,AbortSignal});
  return {GET:loaded.exports.GET,request:auth=>({headers:{get:()=>auth?'Bearer fixture':null},url:'https://example.invalid/api/dashboard/next-appointment?provider_id=provider-b'}),get queries(){return queries;}};
}
const future=minutes=>new Date(Date.now()+minutes*60_000).toISOString();
const row=(id,minutes,provider_id='provider-a',status='confirmed')=>({id,start_datetime:future(minutes),provider_id,status});
test('only the earliest future confirmed appointment of the authenticated provider is returned',async()=>{
  const h=harness({rows:[row('foreign-earliest',1,'provider-b'),row('cancelled',2,'provider-a','cancelled_by_client'),row('cancelled-professional',3,'provider-a','cancelled_by_provider'),row('pending',4,'provider-a','pending'),row('past',-1),row('later',60),row('next',15)]});
  const response=await h.GET(h.request(true));assert.equal(response.body.appointment.id,'next');assert.equal(response.headers['Cache-Control'],'private, no-store');
});
test('an empty or foreign-only calendar returns no appointment',async()=>{
  for(const rows of [[],[row('foreign',10,'provider-b')],[row('past',-5)]]){
    const h=harness({rows});const result=await h.GET(h.request(true));assert.equal(result.body.appointment,null);
  }
});
test('missing or invalid authentication never queries appointment data',async()=>{
  for(const [user,token]of [['provider-a',false],[null,true]]){
    const h=harness({user});const result=await h.GET(h.request(token));assert.equal(result.status,401);assert.equal(h.queries,0);
  }
});
test('database failure returns no appointment identifier',async()=>{
  const h=harness({failure:true,rows:[row('private',10)]});const result=await h.GET(h.request(true));assert.equal(result.status,503);assert.equal(result.body.appointment,undefined);
});

function loadCalendar(dependencies) {
  const source=readFileSync(new URL('../app/components/calendar/Calendar.tsx',import.meta.url),'utf8');
  const loaded={exports:{}};
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{module:loaded,exports:loaded.exports,require:name=>dependencies[name],Date,Intl,Map,Set,URLSearchParams,window:{location:{search:dependencies.search}}});
  return loaded.exports.default;
}
async function calendarScenario(target,rows) {
  const state=[],effects=new Map();let cursor=0,dirty=true,tree;
  const pending=[];
  const react={useState(initial){const index=cursor++;if(!(index in state))state[index]=typeof initial==='function'?initial():initial;return[state[index],next=>{state[index]=typeof next==='function'?next(state[index]):next;dirty=true;}];},useRef(initial){const index=cursor++;if(!(index in state))state[index]={current:initial};return state[index];},useMemo(fn){cursor++;return fn();},useEffect(fn,deps){const index=cursor++,old=effects.get(index);if(!old||deps.some((d,i)=>d!==old.deps[i])){old?.cleanup?.();const next={deps};effects.set(index,next);pending.push(()=>{next.cleanup=fn();});}}};
  const from=table=>{
    const predicates=[];
    const list=()=>table==='appointments'?rows.filter(r=>predicates.every(p=>p(r))):[];
    const q={select(){return q;},eq(k,v){predicates.push(r=>r[k]===v);return q;},lt(k,v){predicates.push(r=>r[k]<v);return q;},gt(k,v){predicates.push(r=>r[k]>v);return q;},in(){return q;},order(){return q;},maybeSingle:async()=>({data:table==='profiles'?{availability:null}:list()[0]??null,error:null}),then(resolve,reject){return Promise.resolve({data:list(),error:null}).then(resolve,reject);}};return q;
  };
  const dependencies={search:'?appointment='+target,react,'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},'@/lib/supabaseClient':{supabase:{auth:{getSession:async()=>({data:{session:{user:{id:'provider-a'}}}})},from}},'./Toolbar':{__esModule:true,default:'Toolbar'},'./WeekGrid':{__esModule:true,default:'WeekGrid'},'./CalendarPanel':{__esModule:true,default:'CalendarPanel'},'./calendar.module.css':{__esModule:true,default:{}},'./utils':{addDays:(date,n)=>new Date(date.getTime()+n*86400000),dateToYMD:date=>date.toISOString().slice(0,10),parisDateTimeToIso:day=>day+'T00:00:00.000Z',getCalendarHourRange:()=>({startHour:8,endHour:20})}};
  const Calendar=loadCalendar(dependencies);
  for(let round=0;round<12;round++){
    if(dirty){dirty=false;cursor=0;tree=Calendar();while(pending.length)pending.shift()();}
    await new Promise(setImmediate);
  }
  const walk=node=>[node,...(Array.isArray(node?.props?.children)?node.props.children:[node?.props?.children]).filter(x=>x&&typeof x==='object').flatMap(walk)];
  return {panel:walk(tree).find(n=>n.type==='CalendarPanel').props,week:walk(tree).find(n=>n.type==='WeekGrid').props.weekStart};
}
test('calendar deep link selects the correct future week and opens the existing appointment panel',async()=>{
  const start=future(28*24*60),end=new Date(new Date(start).getTime()+3600000).toISOString();
  const result=await calendarScenario('owned',[{id:'owned',provider_id:'provider-a',status:'confirmed',start_datetime:start,end_datetime:end,product_id:null,client_name:'Synthetic client',client_email:null,client_phone:null,video_provider:null,video_join_url:null,video_room_status:'closed'}]);
  assert.equal(result.panel.open,true);assert.equal(result.panel.mode,'appointment');assert.equal(result.panel.appointment.id,'owned');
  assert.ok(result.week.getTime()<=new Date(start).getTime());assert.ok(result.week.getTime()+7*86400000>new Date(start).getTime());
});
test('calendar deep links never open foreign or cancelled appointments',async()=>{
  const start=future(24*60),end=future(25*60);
  for(const [provider_id,status]of [['provider-b','confirmed'],['provider-a','cancelled_by_client']]){
    const result=await calendarScenario('denied',[{id:'denied',provider_id,status,start_datetime:start,end_datetime:end}]);
    assert.equal(result.panel.open,false);assert.equal(result.panel.appointment,null);
  }
});

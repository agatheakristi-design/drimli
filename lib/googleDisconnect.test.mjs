import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { googleConnectionError } from './googleOAuthDiagnostics.ts';

function compile(path, imports, globals={}) {
  const source=readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const loaded={exports:{}};
  vm.runInNewContext(js,{module:loaded,exports:loaded.exports,require:name=>{
    if (!(name in imports)) throw new Error(`Unexpected import ${name}`);
    return imports[name];
  },URLSearchParams,AbortSignal,process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture'}},...globals});
  return loaded.exports;
}
function server(options={}) {
  const rows=[{provider_id:'A',provider:'google',refresh_token:'refresh-A',access_token:'access-A',account_email:'a@example.invalid',scope:'https://www.googleapis.com/auth/calendar.events.owned'},
    {provider_id:'B',provider:'google',refresh_token:'refresh-B'}, {provider_id:'A',provider:'zoom',access_token:'zoom-A'}];
  const calls=[];
  const admin={auth:{getUser:async bearer=>({data:{user:bearer==='session-A'?{id:'A'}:null}})},from(table){
    assert.equal(table,'integrations'); const filters={}; let deleting=false;
    const result=()=>({data:rows.find(r=>Object.entries(filters).every(([k,v])=>r[k]===v))??null});
    const query={select(){return query;},delete(){deleting=true;return query;},eq(k,v){filters[k]=v;return query;},maybeSingle:async()=>result(),
      then(resolve){assert.ok(deleting);assert.deepEqual(filters,{provider_id:'A',provider:'google'});
        if(options.deleteFailure)return resolve({error:{message:'private diagnostic'}});
        const i=rows.findIndex(r=>Object.entries(filters).every(([k,v])=>r[k]===v)); if(i>=0)rows.splice(i,1);
        return resolve({error:null});}}; return query;
  }};
  const imports={'next/server':{NextResponse:{json:(data,opts)=>({data,status:opts?.status??200})}},'@supabase/supabase-js':{createClient:()=>admin}};
  const POST=compile('app/api/google/disconnect/route.ts',imports,{fetch:async(url,opts)=>{
    calls.push({url,opts}); if(options.networkFailure)throw new Error('secret request');return {ok:!options.remoteFailure};
  }}).POST;
  const status=compile('app/api/google/status/route.ts',{...imports,'@/lib/googleOAuthScopes':{hasGoogleCalendarScope:s=>s?.split(/\s+/).includes('https://www.googleapis.com/auth/calendar.events.owned')}}).GET;
  const request=(bearer='session-A')=>({headers:new Headers(bearer?{Authorization:`Bearer ${bearer}`}:{})});
  return {rows,calls,POST,status,request};
}
test('unauthenticated and invalid sessions cannot disconnect',async()=>{
  const h=server(); for(const bearer of ['', 'invalid'])assert.equal((await h.POST(h.request(bearer))).status,401);
  assert.equal(h.rows.length,3);assert.equal(h.calls.length,0);
});
test('disconnect deletes only authenticated professional Google row and revokes refresh token',async()=>{
  const h=server();const req=h.request();req.json=async()=>({provider_id:'B'});
  const response=await h.POST(req);assert.equal(response.status,200);assert.equal(response.data.connected,false);
  assert.deepEqual(h.rows.map(r=>`${r.provider_id}/${r.provider}`),['B/google','A/zoom']);
  assert.equal(h.calls[0].url,'https://oauth2.googleapis.com/revoke');
  assert.equal(h.calls[0].opts.body.get('token'),'refresh-A');
  assert.equal(h.calls[0].opts.method,'POST');assert.ok(h.calls[0].opts.signal);
  assert.doesNotMatch(JSON.stringify(response),/refresh-A|access-A/);
  assert.equal((await h.status(h.request())).data.connected,false);
  assert.equal((await h.POST(h.request())).status,200); // idempotent
});
for(const mode of ['remoteFailure','networkFailure'])test(`${mode}: local credentials still removed`,async()=>{
  const h=server({[mode]:true});const response=await h.POST(h.request());
  assert.equal(response.data.remoteRevocation,'unconfirmed');assert.equal(h.rows.length,2);
});
test('access token fallback and local database failure are handled honestly',async()=>{
  const h=server({deleteFailure:true});h.rows[0].refresh_token=null;
  assert.equal((await h.POST(h.request())).status,500);assert.equal(h.rows.length,3);
  assert.equal(h.calls[0].opts.body.get('token'),'access-A');
});
test('DRIMLI sign-out does not disconnect Google; new session can read connection',async()=>{
  const h=server();assert.equal((await h.status(h.request())).data.connected,true);
  const logout=readFileSync(new URL('../app/components/LogoutButton.tsx',import.meta.url),'utf8');
  assert.match(logout,/supabase.auth.signOut\(\)/);assert.doesNotMatch(logout,/google|integrations|revoke/);
  assert.equal((await h.status(h.request(''))).status,401);
  assert.equal((await h.status(h.request())).data.connected,true);assert.equal(h.calls.length,0);
});
test('task disconnect immediately updates status and restores normal connection action',async()=>{
  const states=[];let index=0;const effects=[];const completions=[];const requests=[];
  const component=compile('app/dashboard/components/GoogleMeetOnboarding.tsx',{
    react:{useState(initial){const i=index++;if(!(i in states))states[i]=initial;return [states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v;}];},useEffect:fn=>effects.push(fn)},
    'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},
    '@/lib/googleOAuthDiagnostics':{googleConnectionError},
    'lucide-react':{Check:'check',ChevronRight:'chevron',Plus:'plus'},
    '@/lib/supabaseClient':{supabase:{auth:{getSession:async()=>({data:{session:{access_token:'session-A'}}})}}},
    './dashboard.module.css':{googleBoosterTextLink:'googleBoosterTextLink'},
  },{fetch:async url=>{requests.push(url);return {ok:true,json:async()=>url.endsWith('/status')?{connected:true,email:'a@example.invalid'}:url.endsWith('/disconnect')?{connected:false,remoteRevocation:'complete'}:{url:'https://accounts.google.com/fixture'}};},window:{location:{search:'?google=error',assign:url=>requests.push(url)}}}).default;
  const render=()=>{index=0;return component({onCompletionChange:v=>completions.push(v)});};
  const nodes=tree=>[tree,...(Array.isArray(tree?.props?.children)?tree.props.children:[tree?.props?.children]).filter(x=>x&&typeof x==='object').flatMap(nodes)];
  render();effects[0]();await new Promise(resolve=>setImmediate(resolve));
  assert.ok(nodes(render()).some(n=>n.props?.children===googleConnectionError('?google=error')));
  nodes(render()).find(n=>n.props?.['aria-expanded']!==undefined).props.onClick();
  const disconnect=nodes(render()).find(n=>n.props?.children==='Déconnecter');
  assert.equal(disconnect.props.className,'googleBoosterTextLink');
  await disconnect.props.onClick();assert.equal(completions.at(-1),false);
  const connect=nodes(render()).find(n=>n.type==='button'&&n.props?.children==='Connecter Google Meet');
  assert.ok(connect);await connect.props.onClick();assert.ok(requests.includes('/api/google/connect'));
});

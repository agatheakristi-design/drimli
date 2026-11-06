import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const nodes=tree=>[tree,...(Array.isArray(tree?.props?.children)?tree.props.children.flat(Infinity):[tree?.props?.children]).filter(x=>x&&typeof x==='object').flatMap(nodes)];
function harness(){
 const hooks=[],effects=[];let index=0,insertCount=0,resolveInsert;
 const document={activeElement:{focus(){document.restored='opener';}}};
 const chain={select(){return chain;},order(){return chain;},limit:async()=>({data:[],error:null}),insert(value){insertCount++;chain.inserted=value;return chain;},single:()=>new Promise(resolve=>{resolveInsert=resolve;})};
 const react={useRef(value){const i=index++;if(!(i in hooks))hooks[i]={current:value};return hooks[i];},useState(value){const i=index++;if(!(i in hooks))hooks[i]=value;return[hooks[i],next=>{hooks[i]=typeof next==='function'?next(hooks[i]):next;}];},useEffect(fn){effects.push(fn);}};
 const imports={react,'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},'lucide-react':{X:'X'},'@/lib/supabaseClient':{supabase:{from:()=>chain,auth:{getSession:async()=>({data:{session:{access_token:'fixture-token'}}})}}},'@/app/components/ui/Button':'Button','@/app/components/ui/Input':'Input','@/app/components/ui/Textarea':'Textarea','./dashboard.module.css':{__esModule:true,default:new Proxy({},{get:(_,key)=>key})}};
 const source=readFileSync(new URL('../app/dashboard/components/HelpPanel.tsx',import.meta.url),'utf8');
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 const loaded={exports:{}};
 vm.runInNewContext(js,{module:loaded,exports:loaded.exports,require:name=>{assert.ok(name in imports,name);return imports[name];},document,Date,fetch:async(url,options)=>{
 assert.equal(url,'/api/dashboard/help-requests');assert.equal(options.headers.Authorization,'Bearer fixture-token');
 insertCount++;chain.inserted=JSON.parse(options.body);
 const result=await new Promise(resolve=>{resolveInsert=resolve;});
 return{ok:!result.error,json:async()=>({request:result.data})};
 }});
 function render(){index=0;effects.length=0;return loaded.exports.default({onClose(){}});}
 function filled(){let tree=render();nodes(tree).find(n=>n.type==='Button').props.onClick();tree=render();nodes(tree).find(n=>n.props?.id==='help-subject').props.onChange({target:{value:'Sujet fictif'}});nodes(tree).find(n=>n.props?.id==='help-message').props.onChange({target:{value:'Message fictif conservé'}});return render();}
 return{render,filled,effects,document,chain,get insertCount(){return insertCount;},finish:result=>resolveInsert(result)};
}
test('help restores the original trigger even when React autofocus runs before the modal effect',()=>{
 const h=harness(),tree=h.render();let shown=0;tree.props.ref.current={showModal(){shown++;}};
 h.document.activeElement={focus(){h.document.restored='search';}};
 const cleanup=h.effects[0]();assert.equal(shown,1);cleanup();assert.equal(h.document.restored,'opener');
});
test('help rejects rapid duplicate submits and clears fields only after confirmed local insertion',async()=>{
 const h=harness(),tree=h.filled(),submit=nodes(tree).find(n=>n.type==='form').props.onSubmit;
 const first=submit({preventDefault(){}});await submit({preventDefault(){}});await Promise.resolve();assert.equal(h.insertCount,1);
 assert.equal(h.chain.inserted.subject,'Sujet fictif');assert.equal(h.chain.inserted.message,'Message fictif conservé');
 h.finish({data:{id:'fixture',subject:'Sujet fictif',message:'Message fictif conservé',created_at:'2026-11-05T12:00Z'},error:null});await first;
 assert.ok(JSON.stringify(h.render()).includes('Message envoyé.'));
});
test('help preserves the subject and message after an unconfirmed insert',async()=>{
 const h=harness(),tree=h.filled(),submit=nodes(tree).find(n=>n.type==='form').props.onSubmit;
 const pending=submit({preventDefault(){}});await new Promise(setImmediate);h.finish({data:null,error:{message:'synthetic failure'}});await pending;
 const rendered=h.render();assert.equal(nodes(rendered).find(n=>n.props?.id==='help-subject').props.value,'Sujet fictif');assert.equal(nodes(rendered).find(n=>n.props?.id==='help-message').props.value,'Message fictif conservé');assert.ok(JSON.stringify(rendered).includes('Envoi non confirmé.'));
});

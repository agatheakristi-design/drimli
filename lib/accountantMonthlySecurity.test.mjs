import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');

test('retired monthly route is inert even with an old valid secret or concurrent calls', async () => {
  const source = read('app/api/billing/monthly/route.ts');
  const loaded = { exports: {} };
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInThisContext(`(function(module,exports,require){${js}\n})`)(loaded, loaded.exports, name => {
    assert.equal(name, 'next/server', 'retired route must not load Storage, Resend or credentials');
    return {NextResponse:{json:(body,args)=>new Response(JSON.stringify(body),args)}};
  });
  const responses=await Promise.all(Array.from({length:3},()=>loaded.exports.POST(new Request('https://local.test/api/billing/monthly',{method:'POST',headers:{Authorization:'Bearer old-secret'}}))));
  assert.deepEqual(responses.map(r=>r.status),[410,410,410]);
  for(const response of responses) assert.match(response.headers.get('cache-control'),/no-store/);
});

test('privacy migration removes table-level and column-level exposure, with an effective privilege assertion',()=>{
  const sql=read('supabase/migrations/20261029120000_protect_accountant_email.sql');
  assert.match(sql,/revoke select on public\.profiles from public, anon, authenticated/i);
  assert.match(sql,/revoke select \(accountant_email\) on public\.profiles from public, anon, authenticated/i);
  assert.match(sql,/attname <> 'accountant_email'/);
  assert.match(sql,/grant select \(%s\) on public\.profiles to anon, authenticated/);
  assert.match(sql,/has_column_privilege\('anon'/); assert.match(sql,/has_column_privilege\('authenticated'/);
  assert.doesNotMatch(sql,/grant select on public\.profiles to (?:anon|authenticated)/i);
  assert.doesNotMatch(sql,/drop policy|delete from|update public\.profiles/i);
});

test('public professional and booking pages request only retained profile columns',()=>{
  for(const file of ['app/[slug]/page.tsx','app/reserver/[serviceId]/page.tsx']){
    const source=read(file); const selections=[...source.matchAll(/\.from\("profiles"\)\s*\.select\(\s*"([^"]+)"/g)];
    assert.ok(selections.length, file);
    for(const [,columns] of selections){assert.ok(!columns.includes('*'));assert.ok(!columns.includes('accountant_email'));}
  }
});

test('recovery SQL excludes active workers and submitted emails from the automatic queue',()=>{
  const sql=read('supabase/migrations/20261025120000_accountant_monthly_deliveries.sql');
  const recovery=sql.split('create function public.recover_accountant_deliveries()')[1].split('end $$;')[0];
  assert.match(recovery,/lease_until < clock_timestamp\(\)/); assert.match(recovery,/for update skip locked/);
  assert.match(recovery,/mail_payload is not null or d.status = 'sending' then 'uncertain'/);
  assert.match(recovery,/d.attempts >= 10 then 'exhausted'/);
  assert.match(recovery,/status = 'pending' and attempts < 10/);
  assert.match(sql,/revoke all on function public.recover_accountant_deliveries\(\)/);
  assert.match(sql,/grant execute on function public.recover_accountant_deliveries\(\)/);
});

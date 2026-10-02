import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
function load(path) {
 const loaded = { exports: {} };
 vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { module: loaded, exports: loaded.exports });
 return loaded.exports;
}
const { isProfessionalSeoEligible: eligible, buildProfessionalSitemap: build } = load('./professionalSitemap.ts');
const profile = { id: '01', provider_id: 'pro', published: true, slug: 'ancienne-url-2', first_name: 'Élodie', last_name: 'Noël', profession: 'Graphiste' };
const service = { id: '01', provider_id: 'pro', active: true, title: 'Séance', duration_minutes: 60 };
test('eligible profile, zero price and absent price', () => {
 assert.equal(eligible(profile, [service]), true);
 assert.equal(eligible(profile, [{ ...service, price_cents: 0 }]), true);
});
for (const [name, patch] of Object.entries({ unpublished: { published: false }, missingSlug: { slug: null }, invalidSlug: { slug: 'Élodie/noel' }, reservedSlug: { slug: 'dashboard' }, reservedPage: { slug: 'page' }, missingFirst: { first_name: '  ' }, missingLast: { last_name: null }, missingProfession: { profession: '' } })) {
 test(name, () => assert.equal(eligible({ ...profile, ...patch }, [service]), false));
}
for (const [name, patch] of Object.entries({ inactive: { active: false }, emptyTitle: { title: '\t ' }, nullDuration: { duration_minutes: null }, zeroDuration: { duration_minutes: 0 }, negativeDuration: { duration_minutes: -1 }, wrongProvider: { provider_id: 'other' } })) {
 test(name, () => assert.equal(eligible(profile, [{ ...service, ...patch }]), false));
}
test('no service and one eligible among several', () => {
 assert.equal(eligible(profile, []), false);
 assert.equal(eligible(profile, [{ ...service, active: false }, service]), true);
});
function client({ failTable, failAfter = 0, cap = 1 } = {}) {
 const calls = [];
 const tables = { profiles: [profile, { ...profile, id: '02', provider_id: 'other', slug: 'autre-url' }], products: [{ ...service, active: false }, { ...service, id: '02' }, { ...service, id: '03', provider_id: 'other' }] };
 return { calls, from(table) {
  let flag, cursor = '', limit;
  const q = { select(fields) { assert.doesNotMatch(fields, /price|email|stripe|availability/); return q; }, eq(key) { flag = key; return q; }, order(key) { assert.equal(key, 'id'); return q; }, limit(n) { limit = n; return q; }, gt(key, value) { assert.equal(key, 'id'); cursor = value; return q; }, then(resolve) {
   const count = calls.filter(c => c === table).length; calls.push(table);
   resolve(table === failTable && count >= failAfter ? { data: null, error: { message: 'private backend error' } } : { data: tables[table].filter(row => row[flag] && row.id > cursor).slice(0, Math.min(cap, limit)), error: null });
  } }; return q;
 } };
}
test('pagination of both tables, slug-only URLs, no lastmod', async () => {
 const c = client(); const result = JSON.parse(JSON.stringify(await build(c)));
 assert.deepEqual(result, [{ url: 'https://www.drimli.io/ancienne-url-2' }, { url: 'https://www.drimli.io/autre-url' }]);
 assert.equal(c.calls.filter(t => t === 'profiles').length, 3);
 assert.equal(c.calls.filter(t => t === 'products').length, 3);
});
for (const table of ['profiles', 'products']) for (const after of [0, 1]) {
 test(`${table} failure on page ${after + 1} rejects, never returns empty or partial sitemap`, async () => {
  await assert.rejects(build(client({ failTable: table, failAfter: after })), /Unable to read/);
 });
}
test('robots permits public crawling and declares canonical sitemap', () => {
 assert.deepEqual(JSON.parse(JSON.stringify(load('../app/robots.ts').default())), { rules: { userAgent: '*', allow: '/' }, sitemap: 'https://www.drimli.io/sitemap.xml' });
});

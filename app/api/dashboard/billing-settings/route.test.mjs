import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const valid = { full_name: 'Professionnel', address: '1 rue Exemple', postal_code: '75001', city: 'Paris', country: 'FR', siret: '12345678901234', vat_regime: 'franchise_base', vat_number: '', vat_rate: '', cancellation_policy: 'non_refundable' };
function fixture({ email = 'comptable@example.fr', authenticated = true, failure = false } = {}) {
  const writes = []; const filters = [];
  const profile = { ...valid, billing_full_name: valid.full_name, accountant_email: email, billing_information_validated_at: '2026-10-01T00:00:00Z' };
  const admin = {
    auth: { getUser: async () => ({ data: { user: authenticated ? { id: 'professional-a' } : null } }) },
    from(table) {
      assert.equal(table, 'profiles'); let patch;
      const query = {
        select(fields) { assert.match(fields, /accountant_email/); return query; },
        update(value) { patch = value; return query; },
        eq(key, value) { filters.push([key, value]); return query; },
        maybeSingle: async () => ({ data: profile, error: null }),
        then(resolve, reject) { if (patch) writes.push(patch); return Promise.resolve({ error: failure ? { message: 'Save failed' } : null }).then(resolve, reject); },
      };
      return query;
    },
  };
  const loaded = { exports: {} };
  const source = readFileSync(new URL('./route.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInThisContext(`(function(module,exports,require,process){${js}\n})`)(loaded, loaded.exports, name => {
    if (name === '@supabase/supabase-js') return { createClient: () => admin };
    if (name === 'next/server') return { NextResponse: { json: (body, options) => new Response(JSON.stringify(body), { ...options, headers: { 'Content-Type': 'application/json' } }) } };
    if (name === 'stripe') return class {};
    if (name === '@/lib/stripeConnect') return { resolveStripeAccountId: () => ({ accountId: null, conflict: false }) };
    if (name === '@/lib/payoutPolicy') return { REFUNDABLE_POLICY: 'moderate', isSelectablePolicy: value => ['non_refundable', 'moderate'].includes(value) };
    if (name === '@/lib/stripePayouts') return { setConnectedAccountPayoutMode: () => { throw new Error('Unexpected Stripe write'); } };
    throw new Error(`Unexpected dependency or email sender: ${name}`);
  }, { env: {} });
  const put = body => loaded.exports.PUT(new Request('https://drimli.test/api/dashboard/billing-settings', { method: 'PUT', headers: { Authorization: 'Bearer valid', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  return { get: () => loaded.exports.GET(new Request('https://drimli.test/api/dashboard/billing-settings')), put, writes, filters };
}

test('prefills the stored accountant email, and presents null as an empty optional field', async () => {
  for (const email of ['comptable@example.fr', null]) {
    const f = fixture({ email }); const response = await f.get(); assert.equal(response.status, 200);
    assert.equal((await response.json()).values.accountant_email, email || ''); assert.equal(f.writes.length, 0);
  }
});
test('saves a trimmed replacement only for the authenticated professional', async () => {
  const f = fixture(); assert.equal((await f.put({ ...valid, accountant_email: '  nouveau+compta@example.fr  ', provider_id: 'professional-b' })).status, 200);
  assert.equal(f.writes[0].accountant_email, 'nouveau+compta@example.fr');
  assert.ok(f.filters.every(([key, value]) => key === 'provider_id' && value === 'professional-a'));
  for (const key of ['cancellation_policy', 'siret', 'vat_regime']) assert.equal(f.writes[0][key], valid[key]);
});
test('clearing the field stores NULL, with no email or monthly-route dependency', async () => {
  for (const value of ['', '   ', null]) { const f = fixture(); assert.equal((await f.put({ ...valid, accountant_email: value })).status, 200); assert.equal(f.writes[0].accountant_email, null); }
});
test('older requests omitting the optional field preserve the stored address', async () => {
  const f = fixture(); assert.equal((await f.put(valid)).status, 200); assert.equal(Object.hasOwn(f.writes[0], 'accountant_email'), false);
});
test('invalid and oversized addresses are rejected before any write', async () => {
  for (const value of ['invalid', 'a@@example.fr', 'a b@example.fr', 'a@example', 'a@example.fr\nBcc:other@example.fr', 'a'.repeat(250) + '@example.fr', 123]) {
    const f = fixture(); const response = await f.put({ ...valid, accountant_email: value }); assert.equal(response.status, 400); assert.match((await response.json()).error, /e-mail valide/); assert.equal(f.writes.length, 0);
  }
});
test('existing authentication and save-error responses are preserved', async () => {
  const denied = fixture({ authenticated: false }); assert.equal((await denied.get()).status, 401); assert.equal((await denied.put(valid)).status, 401); assert.equal(denied.writes.length, 0);
  const failure = fixture({ failure: true }); const response = await failure.put({ ...valid, accountant_email: 'comptable@example.fr' }); assert.equal(response.status, 400); assert.equal((await response.json()).error, 'Save failed');
});

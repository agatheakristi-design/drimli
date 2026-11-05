import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const scope = 'https://www.googleapis.com/auth/calendar.events.owned';
const message = 'Connectez Google Meet avant de configurer les paiements.';
const jsx = (type, props) => ({ type, props });
const nodes = tree => [tree, ...(Array.isArray(tree?.props?.children) ? tree.props.children.flat(Infinity) : [tree?.props?.children]).filter(x => x && typeof x === 'object').flatMap(nodes)];
const styles = { __esModule: true, default: new Proxy({}, { get: (_, k) => k }) };
function compile(file, imports, globals = {}) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(js, { module: loaded, exports: loaded.exports, require: name => {
    if (!(name in imports)) throw new Error(`Unexpected import ${name}`);
    return imports[name];
  }, process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture', SUPABASE_SERVICE_ROLE_KEY: 'fixture', STRIPE_SECRET_KEY: 'fixture', GOOGLE_CLIENT_ID: 'fixture', GOOGLE_CLIENT_SECRET: 'fixture', GOOGLE_REDIRECT_URI: 'https://fixture.invalid/callback' } }, Date, URL, ...globals });
  return loaded.exports;
}
function harness({ missing = false, refresh = true, granted = true, effectiveGranted = true, googleFailure = null, dbFailure = false, existingAccount = true, ready = true } = {}) {
  const calls = { stripe: [], writes: [], google: [], integrationFilters: [] };
  const integration = missing ? null : { account_email: 'a@example.invalid', access_token: 'fixture-access', refresh_token: refresh ? 'fixture-refresh' : null, scope: granted ? scope : 'openid email', expires_at: '2020-01-01T00:00:00Z' };
  const profile = { provider_id: 'A', stripe_account_id: existingAccount ? 'acct_A' : null, stripe_connect_account_id: null, email: 'a@example.invalid' };
  const account = { id: 'acct_A', ready };
  const admin = { auth: { getUser: async token => ({ data: { user: token === 'session-A' ? { id: 'A', email: 'a@example.invalid' } : null }, error: null }) }, from(table) {
    const filters = {}; let write = false;
    const query = {
      select() { return query; }, eq(k, v) { filters[k] = v; return query; },
      update(patch) { write = true; calls.writes.push({ table, patch: JSON.parse(JSON.stringify(patch)) }); return query; },
      insert(patch) { write = true; calls.writes.push({ table, patch: JSON.parse(JSON.stringify(patch)) }); return query; },
      async maybeSingle() { if (table === 'integrations') { calls.integrationFilters.push(filters); return { data: integration, error: dbFailure ? { message: 'private' } : null }; } return { data: profile, error: null }; },
      async single() { return query.maybeSingle(); },
      then(resolve) { assert.ok(write); assert.ok(!filters.provider_id || filters.provider_id === 'A'); return Promise.resolve({ error: null }).then(resolve); },
    }; return query;
  } };
  const google = { auth: { OAuth2: class { constructor(options) { assert.equal(options.transporterOptions.timeout, 3000); } setCredentials(credentials) { assert.equal(credentials.refresh_token, 'fixture-refresh'); } async getAccessToken() { return { token: 'fixture-access' }; } async getTokenInfo() { return { scopes: effectiveGranted ? [scope] : ['https://www.googleapis.com/auth/calendar.events.readonly'] }; } } }, calendar: () => ({ events: { list: async (params, options) => { calls.google.push({ params, options }); if (googleFailure) throw googleFailure; return { data: { kind: 'calendar#events' } }; } } }) };
  const shared = { hasGoogleCalendarScope: value => (value ?? '').split(/\s+/).includes(scope), GOOGLE_MEET_REQUIRED_MESSAGE: message };
  const readiness = compile('lib/googleMeetReadiness.ts', { googleapis: { google }, '@/lib/googleOAuthScopes': shared });
  const stripe = { accounts: { retrieve: async id => { calls.stripe.push(['retrieve', id]); return account; }, create: async () => { calls.stripe.push(['create']); return account; } }, accountSessions: { create: async input => { calls.stripe.push(['session', input.account]); return { client_secret: 'test-only' }; } }, accountLinks: { create: async input => { calls.stripe.push(['link', input.account]); return { url: 'https://stripe.invalid/onboarding' }; } } };
  const stripeConnect = { resolveStripeAccountId: p => ({ accountId: p.stripe_account_id, needsCanonicalBackfill: false, conflict: false }), stripeAccountState: a => ({ ready: a.ready }), requestTransfersCapability: async (_s, a) => { calls.stripe.push(['capability', a.id]); return a; } };
  const imports = { '@/lib/googleMeetReadiness': readiness, '@/lib/googleOAuthScopes': shared, 'next/server': { NextResponse: { json: (data, opts) => ({ data, status: opts?.status ?? 200 }) } }, '@supabase/supabase-js': { createClient: (_url, _key, options) => options?.global?.headers?.Authorization ? { ...admin, auth: { getUser: () => admin.auth.getUser(options.global.headers.Authorization.replace(/^Bearer\s+/, '')) } } : admin }, stripe: class { constructor() { return stripe; } }, '@/lib/stripe': { stripe }, '@/lib/stripeConnect': stripeConnect, 'next/headers': { cookies: async () => ({ get: () => ({ value: 'session-A' }) }) } };
  const request = token => ({ headers: new Headers({ Authorization: `Bearer ${token}` }), url: 'https://fixture.invalid/api', json: async () => ({ provider_id: 'B' }) });
  return { calls, admin, readiness, imports, request, profile };
}

test('preserves every task and its texts, places Meet before Stripe and excludes reviews from progress', () => {
  const { tasks } = compile('app/dashboard/components/tasks.ts', {});
  assert.deepEqual(Array.from(tasks, t => t.label), ['Premier service créé', 'Ajouter des services', 'Ajouter une photo', 'Écrire une description', 'Connecter Google Meet', 'Connecter les paiements', 'Facturation', 'Booster mes avis Google']);
  assert.equal(tasks.filter(t => t.countInProgress !== false).length, 6);
  assert.equal(tasks.find(t => t.label === 'Ajouter des services').countInProgress, false);
  assert.equal(tasks.find(t => t.label === 'Booster mes avis Google').countInProgress, false);
  const descriptions = ['Votre première offre est publiée.', 'Proposez davantage de prestations.', 'Rendez votre page plus personnelle.', 'Présentez votre activité et votre expertise.', 'Ajoutez la visioconférence à vos rendez-vous.', 'Activez la réception des paiements.', 'Générez automatiquement vos factures.', 'Affichez votre note et générez des avis clients'];
  assert.deepEqual(Array.from(tasks, t => t.description), descriptions);
});

for (const [name, options, reason] of [
  ['absent connection', { missing: true }, 'not_connected'],
  ['missing refresh token', { refresh: false }, 'refresh_token_missing'],
  ['missing Calendar scope', { granted: false }, 'calendar_scope_missing'],
  ['stale stored scope with read-only effective permissions', { effectiveGranted: false }, 'calendar_scope_missing'],
  ['database failure', { dbFailure: true }, 'google_unavailable'],
  ['revoked credentials', { googleFailure: { response: { status: 400, data: { error: 'invalid_grant' } } } }, 'google_authorization'],
  ['permission denied', { googleFailure: { response: { status: 403 } } }, 'google_authorization'],
  ['Google outage', { googleFailure: { response: { status: 503 } } }, 'google_unavailable'],
  ['network timeout', { googleFailure: { code: 'ETIMEDOUT' } }, 'google_unavailable'],
]) {
  test(`readiness rejects ${name}`, async () => {
    const h = harness(options); const result = await h.readiness.getGoogleMeetReadiness(h.admin, 'A');
    assert.equal(result.connected, false); assert.equal(result.reason, reason); assert.equal(h.calls.writes.length, 0);
    assert.deepEqual(h.calls.integrationFilters, [{ provider_id: 'A', provider: 'google' }]);
  });
}

test('readiness requires a real Google read, uses minimal fields and never creates a meeting', async () => {
  const h = harness(); const result = await h.readiness.getGoogleMeetReadiness(h.admin, 'A');
  assert.equal(result.connected, true); assert.equal(result.reason, null); assert.equal(h.calls.google.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.google[0])), { params: { calendarId: 'primary', maxResults: 1, fields: 'kind' }, options: { timeout: 3000, retry: false } });
  assert.equal(h.calls.writes.length, 0);
});

const routes = ['activate', 'account-session', 'onboarding-link'];
for (const route of routes) {
  for (const [state, options] of [['missing', { missing: true }], ['scope missing', { granted: false }], ['effective scope missing', { effectiveGranted: false }], ['revoked', { googleFailure: { response: { status: 401 } } }]]) {
    test(`${route} rejects direct API calls with ${state} Google before any Stripe call or write`, async () => {
      const h = harness(options); const { POST } = compile(`app/api/drimpay/${route}/route.ts`, h.imports);
      const result = await POST(h.request('session-A'));
      assert.equal(result.status, 409); assert.equal(result.data.code, 'GOOGLE_MEET_REQUIRED');
      assert.equal(h.calls.stripe.length, 0); assert.equal(h.calls.writes.length, 0);
      assert.equal(h.calls.integrationFilters[0].provider_id, 'A');
    });
  }
  for (const ready of [false, true]) {
    test(`${route} keeps the existing Stripe account when Google is valid (Stripe ready=${ready})`, async () => {
      const h = harness({ ready }); const { POST } = compile(`app/api/drimpay/${route}/route.ts`, h.imports);
      const result = await POST(h.request('session-A'));
      assert.equal(result.status, 200); assert.ok(h.calls.stripe.length > 0);
      assert.equal(h.calls.stripe.filter(c => c[0] === 'create').length, 0);
      assert.equal(h.profile.stripe_account_id, 'acct_A');
    });
  }
}

test('the Google status endpoint reuses the operational check for the authenticated provider', async () => {
  const h = harness({ googleFailure: { response: { status: 403 } } }); const { GET } = compile('app/api/google/status/route.ts', h.imports);
  assert.equal((await GET(h.request('invalid'))).status, 401); assert.equal(h.calls.google.length, 0);
  const result = await GET(h.request('session-A')); assert.equal(result.status, 200); assert.equal(result.data.connected, false); assert.equal(result.data.reason, 'google_authorization');
});

test('dashboard Stripe unlocks on Google completion and closes again on disconnect without changing its text', () => {
  const tasks = compile('app/dashboard/components/tasks.ts', {}).tasks;
  const states = []; let index = 0;
  const { default: TaskList } = compile('app/dashboard/components/TaskList.tsx', {
    react: { useState(v) { const i = index++; if (!(i in states)) states[i] = v; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; }, useRef: () => ({ current: null }), useEffect() {}, useCallback: fn => fn },
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'lucide-react': Object.fromEntries(['Camera', 'Check', 'ChevronRight', 'CreditCard', 'FileText', 'Plus', 'Receipt'].map(n => [n, 'i'])),
    'next/link': 'a', '@/lib/supabaseClient': { supabase: {} }, '@/lib/googleOAuthScopes': { GOOGLE_MEET_REQUIRED_MESSAGE: message }, './tasks': { tasks }, './dashboard.module.css': styles,
    ...Object.fromEntries(['DrimpayOnboarding', 'GoogleMeetOnboarding', 'GoogleReviewsOnboarding', 'BillingSettingsOnboarding', 'ServicesManager'].map(n => [`./${n}`, n])),
  });
  function render() { index = 0; return TaskList({ onCompletedTasksChange() {} }); }
  function payment(tree) { return nodes(tree).find(n => n.type === 'button' && nodes(n).some(c => c.props?.children === 'Terminer la configuration des paiements')); }
  const lockMessage = tree => nodes(tree).find(n => n.type === 'p' && n.props.children === message);
  let tree = render(); assert.equal(payment(tree).props['aria-disabled'], true);
  assert.equal(lockMessage(tree), undefined);
  payment(tree).props.onClick();
  tree = render(); assert.ok(lockMessage(tree));
  assert.ok(!nodes(tree).some(n => n.type === 'DrimpayOnboarding'));
  nodes(tree).find(n => n.type === 'GoogleMeetOnboarding').props.onCompletionChange(true);
  tree = render(); assert.equal(payment(tree).props['aria-disabled'], false); assert.equal(lockMessage(tree), undefined); payment(tree).props.onClick();
  tree = render(); assert.ok(nodes(tree).some(n => n.type === 'DrimpayOnboarding'));
  nodes(tree).find(n => n.type === 'GoogleMeetOnboarding').props.onCompletionChange(false);
  tree = render(); assert.equal(payment(tree).props['aria-disabled'], true); assert.ok(!nodes(tree).some(n => n.type === 'DrimpayOnboarding'));
  assert.equal(lockMessage(tree), undefined);
  payment(tree).props.onClick();
  tree = render(); assert.ok(lockMessage(tree));
});

test('the shared onboarding component used by /paiements does not initialize Stripe until Google passes', async () => {
  const states = [], effects = []; let index = 0; let connected = false;
  const { default: Component } = compile('app/dashboard/components/DrimpayOnboarding.tsx', {
    react: { Component: class {}, useState(v) { const i = index++; if (!(i in states)) states[i] = v; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; }, useCallback: fn => fn, useEffect: fn => effects.push(fn) },
    'react/jsx-runtime': { jsx, jsxs: jsx }, '@stripe/react-connect-js': {}, '@stripe/connect-js/pure': { loadConnectAndInitialize() { throw Error('Stripe initialized too early'); } },
    '@/lib/supabaseClient': { supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'fixture' } } }) } } },
    '@/lib/googleOAuthScopes': { GOOGLE_MEET_REQUIRED_MESSAGE: message }, '@/app/components/ui/Button': 'button', './dashboard.module.css': styles,
  }, { fetch: async () => ({ ok: true, json: async () => ({ connected }) }) });
  function render() { index = 0; return Component({}); }
  async function check() { effects.length = 0; render(); effects.shift()(); for (let i = 0; i < 12; i++) await Promise.resolve(); return render(); }
  let tree = await check(); assert.ok(nodes(tree).some(n => n.props?.children === message));
  connected = true; tree = await check(); assert.ok(nodes(tree).some(n => typeof n.type === 'function' && n.type.name === 'EmbeddedStripeOnboarding'));
});

for (const route of ['activate', 'account-session']) {
  test(`${route} can still create a Stripe account after valid Google configuration`, async () => {
    const h = harness({ existingAccount: false }); const { POST } = compile(`app/api/drimpay/${route}/route.ts`, h.imports);
    const result = await POST(h.request('session-A'));
    assert.equal(result.status, 200); assert.equal(h.calls.stripe.filter(c => c[0] === 'create').length, 1);
    assert.ok(h.calls.writes.some(w => w.table === 'profiles' && w.patch.stripe_account_id === 'acct_A'));
  });
}

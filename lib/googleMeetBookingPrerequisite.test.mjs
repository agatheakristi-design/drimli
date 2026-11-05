import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as crypto from 'node:crypto';
import * as billingCountries from './billingCountries.mjs';

const provider = '11111111-1111-4111-8111-111111111111';
const productId = '22222222-2222-4222-8222-222222222222';
const scope = 'https://www.googleapis.com/auth/calendar.events.owned';
function compile(file, imports, globals = {}) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(js, { module: loaded, exports: loaded.exports, require(name) { assert.ok(name in imports, `Unexpected import ${name}`); return imports[name]; }, Date, URL, Intl, console,
    process: { env: Object.fromEntries(['STRIPE_SECRET_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'].map(k => [k, 'fixture'])) }, ...globals });
  return loaded.exports;
}
function harness(state = 'valid', options = {}) {
  const calls = { google: [], stripe: [], writes: [], providers: [] };
  const day = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const start = `${day}T10:00:00.000Z`, end = `${day}T11:00:00.000Z`;
  const product = { id: productId, provider_id: provider, active: true, duration_minutes: 60, price_cents: 10000, title: 'Séance fictive' };
  const appt = { id: 'appointment-fixture', provider_id: provider, product_id: productId, status: options.status || 'pending', start_datetime: start, end_datetime: end, client_name: 'Client fictif', client_email: 'client@example.invalid', client_phone: '+33612345678', cancellation_policy: 'non_refundable' };
  const availability = { timezone: 'UTC', week: Object.fromEntries(['sun','mon','tue','wed','thu','fri','sat'].map(k => [k, [{ start: '10:00', end: '12:00' }]])) };
  const profile = { availability, cancellation_policy: 'non_refundable', stripe_account_id: 'acct_fixture', billing_full_name: 'Entreprise fictive', address: 'Adresse fictive', city: 'Paris', country: 'FR', siret: 'fixture', vat_regime: 'franchise_base' };
  const admin = { from(table) {
    const filters = {}; let write = null;
    const result = () => {
      if (table === 'integrations') {
        calls.providers.push(filters.provider_id);
        return { data: state === 'missing' ? null : { refresh_token: 'fake', access_token: 'fake', scope: state === 'scope' ? 'openid' : scope }, error: null };
      }
      return { data: write ? { id: 'new-appointment' } : table === 'products' ? (options.mismatch ? { ...product, provider_id: 'other' } : product) : table === 'profiles' ? profile : appt, error: null };
    };
    const q = { select() { return q; }, eq(k,v) { filters[k]=v; return q; }, in() { return q; }, lt() { return q; }, gt() { return q; }, limit() { return q; },
      insert(value) { write = value; calls.writes.push({table, value: JSON.parse(JSON.stringify(value))}); return q; },
      update() { throw Error('Existing records must not be modified'); },
      async maybeSingle() { return result(); },
      then(resolve) { return Promise.resolve({ data: write ? null : [], error: null }).then(resolve); } };
    return q;
  } };
  const google = { auth: { OAuth2: class { constructor(config) { assert.equal(config.transporterOptions.timeout, 3000); assert.equal(config.transporterOptions.retry, false); } setCredentials() {} async getAccessToken() { return { token: 'fake' }; } async getTokenInfo() { return { scopes: [scope] }; } } },
    calendar: () => ({ events: { async list(_params, opts) { calls.google.push('read'); assert.equal(opts.timeout, 3000); if (state === 'revoked') throw { response: { status: 401 } }; if (state === 'outage') throw { response: { status: 503 } }; if (state === 'timeout') throw { code: 'ETIMEDOUT' }; return { data: { kind: 'calendar#events' } }; }, insert() { throw Error('No meeting before payment'); } } }) };
  const readiness = compile('lib/googleMeetReadiness.ts', { googleapis: { google }, '@/lib/googleOAuthScopes': { hasGoogleCalendarScope: value => (value || '').split(/\s+/).includes(scope) } });
  const stripe = { accounts: { async retrieve(id) { calls.stripe.push('retrieve'); return { id }; } }, checkout: { sessions: { async create(input) { calls.stripe.push(input); return { id: 'cs_fixture', url: 'https://stripe.invalid/checkout' }; } } } };
  const imports = { '@/lib/googleMeetReadiness': readiness, 'next/server': { NextResponse: { json: (data, opts) => ({ data, status: opts?.status || 200 }) } }, '@supabase/supabase-js': { createClient: () => admin }, stripe: class { constructor() { return stripe; } }, 'node:crypto': crypto,
    '@/lib/bookingCustomer': compile('lib/bookingCustomer.ts', { './billingCountries.mjs': billingCountries, 'libphonenumber-js/max': { parsePhoneNumberFromString: () => ({ isValid: () => true, number: '+33612345678' }) } }),
    '@/lib/booking/slotCutoff': compile('lib/booking/slotCutoff.ts', {}),
    '@/lib/googleCalendarBusy': { getGoogleCalendarBusy: async () => [], GoogleCalendarBusyError: class extends Error {} },
    '@/lib/payoutPolicy': { refundDeadlineHours: () => 0, isWithinRefundableHoldLimit: () => true },
    '@/lib/stripeConnect': { resolveStripeAccountId: () => ({ accountId: 'acct_fixture' }), stripeAccountState: () => ({ ready: true }) },
    '@/lib/billing': { calculateDrimliFee: amount => Math.round(amount * 0.05) },
    '@/lib/stripePayouts': { setConnectedAccountPayoutMode: () => { throw Error('No payout change'); } },
  };
  const request = { url: `https://fixture.invalid/api/slots?providerId=${provider}&serviceId=${productId}&date=${day}`, json: async () => ({ providerId: provider, productId, start, end, client_name: 'Client fictif', clientEmail: 'client@example.invalid', clientPhone: '+33612345678', appointmentId: appt.id, provider_id: 'spoofed' }) };
  return { imports, calls, request, readiness };
}
for (const [route, method] of [['slots','GET'], ['appointments/create','POST'], ['stripe/checkout','POST']]) {
  for (const state of ['missing','scope','revoked','outage','timeout']) {
    test(`${route}: ${state} blocks direct request before reservation, payment or snapshot`, async () => {
      const h = harness(state);
      const result = await compile(`app/api/${route}/route.ts`, h.imports)[method](h.request);
      assert.equal(result.status, 409);
      assert.equal(result.data.code, 'GOOGLE_MEET_UNAVAILABLE');
      assert.equal(result.data.error, h.readiness.GOOGLE_MEET_BOOKING_UNAVAILABLE_MESSAGE);
      assert.deepEqual(h.calls.writes, []); assert.deepEqual(h.calls.stripe, []);
      assert.deepEqual(h.calls.providers, [provider]);
      assert.ok(!JSON.stringify(result.data).includes('example.invalid'));
    });
  }
  test(`${route}: operational Google preserves successful existing path without meeting creation`, async () => {
    const h = harness();
    const result = await compile(`app/api/${route}/route.ts`, h.imports)[method](h.request);
    assert.equal(result.status, 200); assert.deepEqual(h.calls.providers, [provider]);
    if (route === 'slots') { assert.equal(result.data.length, 2); assert.deepEqual(h.calls.writes, []); }
    if (route === 'appointments/create') { assert.equal(result.data.id, 'new-appointment'); assert.equal(h.calls.writes.length, 1); assert.equal(h.calls.writes[0].value.status, 'pending'); assert.deepEqual(h.calls.stripe, []); }
    if (route === 'stripe/checkout') { assert.equal(result.data.url, 'https://stripe.invalid/checkout'); assert.equal(h.calls.stripe.length, 2); assert.equal(h.calls.stripe[1].payment_intent_data.application_fee_amount, 500); assert.equal(h.calls.writes.length, 1); assert.equal(h.calls.writes[0].table, 'billing_checkout_snapshots'); }
  });
}
test('mismatched product cannot check or reserve for another provider', async () => {
  for (const [route, method] of [['slots','GET'],['appointments/create','POST']]) {
    const h = harness('valid', { mismatch: true });
    const result = await compile(`app/api/${route}/route.ts`, h.imports)[method](h.request);
    assert.equal(result.status, 400); assert.deepEqual(h.calls.providers, []); assert.deepEqual(h.calls.writes, []);
  }
});
test('already confirmed appointments cannot create another Checkout session', async () => {
  const h = harness('valid', { status: 'confirmed' });
  const result = await compile('app/api/stripe/checkout/route.ts', h.imports).POST(h.request);
  assert.equal(result.status, 400); assert.deepEqual(h.calls.stripe, []); assert.deepEqual(h.calls.writes, []);
});

for (const operational of [false, true]) {
  test(`public calendar displays ${operational ? 'slots and existing reservation navigation' : 'unavailability without a selectable slot'}`, async () => {
    const states = [], effects = [], navigation = []; let index = 0;
    const jsx = (type, props) => ({ type, props });
    const nodes = tree => [tree, ...(Array.isArray(tree?.props?.children) ? tree.props.children.flat(Infinity) : [tree?.props?.children]).filter(x => x && typeof x === 'object').flatMap(nodes)];
    const message = 'La réservation est temporairement indisponible. Veuillez réessayer plus tard.';
    const { default: Calendar } = compile('app/components/public/ServiceBookingCalendar.tsx', {
      react: { useState(value) { const i = index++; if (!(i in states)) states[i] = value; return [states[i], next => { states[i] = typeof next === 'function' ? next(states[i]) : next; }]; }, useMemo: fn => fn(), useEffect: fn => effects.push(fn) },
      'react/jsx-runtime': { jsx, jsxs: jsx }, 'lucide-react': { ChevronLeft: 'i', ChevronRight: 'i' }, 'next/navigation': { useRouter: () => ({ push: url => navigation.push(url) }) }, '@/app/components/ui/Button': 'Button', './ServiceBookingCalendar.module.css': { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) },
    }, { AbortController, DOMException, URLSearchParams, fetch: async () => ({ ok: operational, json: async () => operational ? [{ start: '2030-01-02T12:00:00Z', end: '2030-01-02T13:00:00Z' }] : { code: 'GOOGLE_MEET_UNAVAILABLE', error: message } }) });
    const render = () => { index = 0; return Calendar({ providerId: provider, serviceId: productId }); };
    render(); effects.at(-1)(); await new Promise(resolve => setImmediate(resolve));
    let tree = render();
    if (!operational) {
      assert.ok(nodes(tree).some(n => n.type === 'p' && n.props.children === message));
      assert.ok(!nodes(tree).some(n => n.props?.className?.split(' ').includes('slot')));
      assert.deepEqual(navigation, []);
    } else {
      const slot = nodes(tree).find(n => n.type === 'button' && n.props.className?.split(' ').includes('slot'));
      assert.ok(slot); slot.props.onClick(); tree = render();
      const reserve = nodes(tree).find(n => n.type === 'Button' && n.props.children === 'Réserver ce créneau');
      assert.ok(reserve); assert.equal(reserve.props.disabled, false); reserve.props.onClick();
      assert.ok(navigation[0].startsWith('/reserver/')); assert.ok(navigation[0].includes(productId));
    }
  });
}

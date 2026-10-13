import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(path, mocks = {}, globals = {}) {
  const loaded = { exports: {} };
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const injected = { module: loaded, exports: loaded.exports, require: (id) => id in mocks ? mocks[id] : require(id), console, URLSearchParams, AbortSignal, ...globals };
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInThisContext(`(function(${Object.keys(injected).join(',')}) {${compiled}\n})`)(...Object.values(injected));
  return loaded.exports;
}
const customer = load('./bookingCustomer.ts');
const { validateContact, validateBusinessCustomer, businessSnapshot, emptyBusinessCustomer } = customer;
const business = { ...emptyBusinessCustomer, businessName: 'Société Démonstration', siren: '356000000', siret: '35600000000048', address: '1 rue Exemple', postalCode: '75001', city: 'Paris', confirmed: true };
for (const [email, valid] of [['', false], ['prenom', false], ['prenom@', false], ['prenom@exemple', false], ['prenom@.fr', false], ['prenom@exemple..fr', false], ['prenom@exemple.fr', true], [' prenom+resa@exemple.fr ', true]]) {
  test(`email ${JSON.stringify(email)} => ${valid}`, () => assert.equal(validateContact(email, '06 12 34 56 78').valid, valid));
}
for (const [phone, valid] of [['', false], ['0612', false], ['06 abc 34 56 78', false], ['1111111111', false], ['06 12 34 56 78', true], ['+33 6 12 34 56 78', true], ['+44 20 7946 0018', true], ['0044 20 7946 0018', true], ['+1 202 555 0123', true]]) {
  test(`phone ${JSON.stringify(phone)} => ${valid}`, () => assert.equal(validateContact('test@example.fr', phone).valid, valid));
}
test('normalized email and phone, no existence claim', () => {
  const contact = validateContact(' test@example.fr ', '06 12 34 56 78');
  assert.equal(contact.email, 'test@example.fr'); assert.equal(contact.phone, '+33612345678');
});
test('B2C accepts absent business fields; B2B requires confirmation', () => {
  assert.equal(validateBusinessCustomer(null).error, null);
  assert.equal(validateBusinessCustomer(business).error, null);
  assert.ok(validateBusinessCustomer({ ...business, confirmed: false }).error);
});
test('foreign company without French identifiers', () => {
  assert.equal(validateBusinessCustomer({ ...business, country: 'GB', siren: '', siret: '', postalCode: 'SW1A 1AA' }).error, null);
});
test('mandatory company identity/address and consistent identifiers', () => {
  for (const patch of [{ businessName: '' }, { address: '' }, { city: '' }, { country: 'QQ' }, { siren: '123' }, { siret: '12345678912345' }, { postalCode: '' }]) assert.ok(validateBusinessCustomer({ ...business, ...patch }).error);
  assert.equal(validateBusinessCustomer({ ...business, siren: '' }).data.siren, business.siren);
});
test('allowlist, no unexpected persisted keys or HTML, no invented VAT', () => {
  const result = validateBusinessCustomer({ ...business, extra: 'private', amount: 1 });
  assert.equal(result.data.extra, undefined); assert.equal(result.data.amount, undefined);
  assert.equal(result.data.vatNumber, '');
  assert.ok(validateBusinessCustomer({ ...business, businessName: '<script>x</script>' }).error);
  const snapshot = businessSnapshot(result.data); result.data.businessName = 'Changed';
  assert.equal(snapshot.customer_business_name, business.businessName);
});
const establishment = (siret) => ({ siret, adresse: '1 rue Exemple', code_postal: '75001', libelle_commune: 'Paris', etat_administratif: 'A' });
const payload = { results: [{ siren: business.siren, nom_raison_sociale: business.businessName, nombre_etablissements: 2, siege: establishment(business.siret), matching_etablissements: [establishment('35600000000055')] }], total_pages: 2 };
const company = load('./companySearch.ts', { './bookingCustomer': customer });
test('name search exposes distinct establishments; SIRET chooses exact establishment, not HQ', () => {
  assert.equal(company.parseCompanyResults(payload, 'Société')[0].establishments.length, 2);
  const found = company.parseCompanyResults(payload, '35600000000055')[0].establishments;
  assert.equal(found.length, 1); assert.equal(found[0].siret, '35600000000055'); assert.equal(found[0].confirmed, false); assert.equal(found[0].vatNumber, '');
});
test('empty results and invalid API payload', () => {
  assert.equal(company.parseCompanyResults({ results: [] }, 'absent').length, 0);
  assert.throws(() => company.parseCompanyResults({}, 'absent'));
});
test('official search request and pagination, unavailable API rejects', async () => {
  let url;
  const api = load('./companySearch.ts', { './bookingCustomer': customer }, { fetch: async (value) => { url = value; return { ok: true, json: async () => payload }; } });
  await api.searchCompanies('356 000 000 00055', 1, 2, new AbortController().signal);
  const parsed = new URL(url); assert.equal(parsed.origin, 'https://recherche-entreprises.api.gouv.fr'); assert.equal(parsed.searchParams.get('q'), '35600000000055'); assert.equal(parsed.searchParams.get('page_etablissements'), '2');
  const failed = load('./companySearch.ts', { './bookingCustomer': customer }, { fetch: async () => ({ ok: false }) });
  await assert.rejects(failed.searchCompanies('test', 1, 1, new AbortController().signal));
});

const provider = '11111111-1111-4111-8111-111111111111';
const product = '22222222-2222-4222-8222-222222222222';
const requestBody = { providerId: provider, productId: product, start: '2027-01-10T10:00Z', end: '2027-01-10T11:00Z', first_name: 'Client', last_name: 'Test', clientEmail: ' test@example.fr ', clientPhone: '06 12 34 56 78' };
function database(rows, writes) {
  return { from(table) {
    let inserted;
    const chain = { select() { return chain; }, eq() { return chain; }, in() { return chain; }, lt() { return chain; }, gt() { return chain; }, limit() { return chain; },
      insert(value) { inserted = value; writes.push({ table, value }); return chain; },
      maybeSingle: async () => ({ data: inserted ? { id: 'appointment' } : rows[table], error: null }),
      then(resolve) { return Promise.resolve({ data: rows[table] ?? [], error: null }).then(resolve); } };
    return chain;
  } };
}
const response = { NextResponse: { json: (body, init) => ({ body, status: init.status }) } };
const env = { NEXT_PUBLIC_SUPABASE_URL: 'mock', SUPABASE_SERVICE_ROLE_KEY: 'mock', STRIPE_SECRET_KEY: 'mock' };
const policy = { refundDeadlineHours: () => 0, isWithinRefundableHoldLimit: () => true };
async function create(body) {
  const writes = [];
  const db = database({ products: { provider_id: provider, active: true, duration_minutes: 60 }, profiles: { cancellation_policy: 'non_refundable' } }, writes);
  const route = load('../app/api/appointments/create/route.ts', {
    '@/lib/bookingCustomer': customer, 'next/server': response, '@supabase/supabase-js': { createClient: () => db },
    '@/lib/googleCalendarBusy': { getGoogleCalendarBusy: async () => [], GoogleCalendarBusyError: Error },
    '@/lib/booking/slotCutoff': { dateInTimeZone: () => '2027-01-10', providerTimeZone: () => 'Europe/Paris', isSlotStartAllowed: () => true }, '@/lib/payoutPolicy': policy,
  }, { process: { env } });
  return { result: await route.POST({ json: async () => body }), writes };
}
test('server refuses invalid contact or unconfirmed B2B before any insert', async () => {
  for (const patch of [{ clientEmail: '' }, { clientEmail: 'missing-at' }, { clientEmail: 'bad@domain' }, { clientPhone: '' }, { clientPhone: '0612' }, { clientPhone: 'letters' }, { businessCustomer: { ...business, confirmed: false } }]) {
    const { result, writes } = await create({ ...requestBody, ...patch });
    assert.equal(result.status, 400); assert.equal(writes.length, 0);
  }
});
for (const b2b of [false, true]) test(`creation and checkout ${b2b ? 'B2B' : 'B2C'} with mocked services`, async () => {
  const { result, writes } = await create({ ...requestBody, businessCustomer: b2b ? business : null });
  assert.equal(result.status, 200);
  const appointment = writes[0].value;
  assert.equal(appointment.client_email, 'test@example.fr'); assert.equal(appointment.client_phone, '+33612345678');
  assert.equal(Boolean(appointment.customer_billing), b2b);
  const checkoutWrites = []; let stripeCalls = 0;
  const db = database({ appointments: { ...appointment, id: 'appointment' }, products: { title: 'Prestation', price_cents: 10000, duration_minutes: 60 }, profiles: { billing_full_name: 'Prestataire', address: '1 rue Exemple', city: 'Paris', country: 'FR', siret: '12345678912345', vat_regime: 'franchise_base' } }, checkoutWrites);
  class Stripe { accounts = { retrieve: async () => ({ id: 'acct_mock' }) }; checkout = { sessions: { create: async () => { stripeCalls++; return { id: 'cs_mock', url: 'https://mock.invalid' }; } } }; }
  const route = load('../app/api/stripe/checkout/route.ts', {
    '@/lib/bookingCustomer': customer, 'next/server': response, '@supabase/supabase-js': { createClient: () => db }, stripe: { default: Stripe },
    '@/lib/stripeConnect': { resolveStripeAccountId: () => ({ accountId: 'acct_mock' }), stripeAccountState: () => ({ ready: true }) },
    '@/lib/billing': { calculateDrimliFee: (n) => n * .05 }, '@/lib/payoutPolicy': policy, '@/lib/stripePayouts': {},
  }, { process: { env } });
  const checkout = await route.POST({ json: async () => ({ appointmentId: 'appointment' }) });
  assert.equal(checkout.status, 200); assert.equal(stripeCalls, 1);
  const snapshot = checkoutWrites.find((w) => w.table === 'billing_checkout_snapshots').value;
  assert.equal(snapshot.customer_type, b2b ? 'business' : 'individual');
  assert.equal(snapshot.customer_business_name, b2b ? business.businessName : null);
  assert.equal(snapshot.customer_siret, b2b ? business.siret : null);
  assert.equal(snapshot.amount_total, 10000); assert.equal(snapshot.application_fee_amount, 500);
  if (b2b) { appointment.customer_billing.businessName = 'Changed afterwards'; assert.equal(snapshot.customer_business_name, business.businessName); }
});

test('invoice recipient uses B2B identity safely; B2C HTML remains exactly unchanged', async () => {
  const { execFileSync } = await import('node:child_process');
  const current = readFileSync(new URL('../app/api/stripe/webhook/route.ts', import.meta.url), 'utf8');
  const previous = execFileSync('git', ['show', 'HEAD:app/api/stripe/webhook/route.ts'], { encoding: 'utf8' });
  async function render(source, params) {
    const parsed = ts.createSourceFile('route.ts', source, ts.ScriptTarget.Latest, true);
    const functions = parsed.statements.filter((node) => ts.isFunctionDeclaration(node) && ['generatePatientInvoicePdf', 'escapeHtml'].includes(node.name?.text)).map((node) => node.getText(parsed)).join('\n');
    let html;
    const compiled = ts.transpileModule(`${functions}\nexports.render = generatePatientInvoicePdf;`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports = {};
    const mocks = {
      '@sparticuz/chromium': { default: { args: [], executablePath: async () => 'mock' } },
      'playwright-core': { chromium: { launch: async () => ({ newPage: async () => ({ setContent: async (value) => { html = value; }, pdf: async () => Buffer.from('mock') }), close: async () => {} }) } },
    };
    vm.runInThisContext(`(function(exports,require,process,Buffer) {${compiled}\n})`)(exports, (id) => mocks[id], { env: {} }, Buffer);
    await exports.render(params);
    return html;
  }
  const params = { invoiceNumber: 'FAC-2027-1', providerName: 'Prestataire', providerAddress: '1 rue Test', providerCity: 'Paris', providerCountry: 'FR', providerSiret: '12345678912345', providerVatRate: 0, clientName: 'Client Test', clientEmail: 'test@example.fr', serviceTitle: 'Prestation', totalExcludingTax: 10000, vatAmount: 0, totalIncludingTax: 10000, currency: 'EUR', issuedAtIso: '2027-01-10T10:00Z', serviceDateIso: '2027-01-10T10:00Z' };
  assert.equal(await render(current, params), await render(previous, params));
  const html = await render(current, { ...params, clientBusiness: { name: 'Société <Test>', address: '1 rue Entreprise', postalCode: '75001', city: 'Paris', country: 'FR', siren: business.siren, siret: business.siret, vatNumber: 'TVA-EXEMPLE' } });
  for (const text of ['Société &lt;Test&gt;', 'SIREN : 356000000', 'SIRET : 35600000000048', '1 rue Entreprise', '75001 Paris', 'TVA-EXEMPLE']) assert.ok(html.includes(text));
  assert.ok(!html.includes('Société <Test>'));
});

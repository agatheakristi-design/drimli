import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const ownId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
function calendarUtils() {
  const loaded = { exports: {} };
  const source = readFileSync(new URL('../../../components/calendar/utils.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInThisContext(`(function(module,exports,require){${compiled}\n})`)(loaded, loaded.exports, () => ({ DAY_KEYS: [] }));
  return loaded.exports;
}
function fixture() {
  return {
    client_invoices: [
      { id: ownId, provider_id: 'alice', appointment_id: 'appointment-a', invoice_number: 'FAC-A', issued_at: '2026-10-01T12:00:00Z', customer_name: 'Client A', total_including_tax: 10000, currency: 'EUR', storage_bucket: 'invoices', file_path: 'providers/alice/a.pdf' },
      { id: otherId, provider_id: 'bob', appointment_id: 'appointment-b', invoice_number: 'FAC-SECRET', issued_at: '2026-10-03T12:00:00Z', customer_name: 'Client B', total_including_tax: 20000, currency: 'EUR', storage_bucket: 'invoices', file_path: 'providers/bob/b.pdf' },
    ],
    client_credit_notes: [{ id: ownId, provider_id: 'alice', invoice_id: ownId, refund_id: 'refund-a', credit_note_number: 'AVR-A', issued_at: '2026-10-02T12:00:00Z', customer_snapshot: { name: 'Client A' }, total_including_tax: 5000, currency: 'EUR', storage_bucket: null, file_path: null }],
    drimli_payments: [{ id: 'payment-a', provider_id: 'alice', appointment_id: 'appointment-a' }, { id: 'payment-b', provider_id: 'bob', appointment_id: 'appointment-b' }],
    drimli_refunds: [
      { id: 'refund-a', payment_id: 'payment-a', amount: 5000, currency: 'EUR', status: 'succeeded' },
      { id: 'refund-pending', payment_id: 'payment-a', amount: 1000, currency: 'EUR', status: 'pending' },
      { id: 'refund-failed', payment_id: 'payment-a', amount: 500, currency: 'EUR', status: 'failed' },
      { id: 'refund-secret', payment_id: 'payment-b', amount: 20000, currency: 'EUR', status: 'succeeded' },
    ],
  };
}
function load(file, { rows = fixture(), user = 'alice', failure = '' } = {}) {
  const calls = []; const signatures = [];
  const admin = {
    auth: { getUser: async token => ({ data: { user: token === 'valid' && user ? { id: user } : null }, error: null }) },
    from(table) {
      assert.ok(table in rows, `Unexpected table ${table}`);
      const filters = []; const orders = []; let range = null; let single = false;
      const query = {
        select() { return query; },
        eq(key, value) { filters.push(row => row[key] === value); calls.push([table, key, value]); return query; },
        in(key, values) { filters.push(row => values.includes(row[key])); return query; },
        gte(key, value) { filters.push(row => row[key] >= value); return query; },
        lt(key, value) { filters.push(row => row[key] < value); return query; },
        or(value) { calls.push([table, 'or', value]); return query; },
        order(key, { ascending }) { orders.push([key, ascending]); return query; },
        range(start, end) { range = [start, end]; return query; },
        maybeSingle() { single = true; return query; },
        then(resolve, reject) {
          let data = rows[table].filter(row => filters.every(filter => filter(row)));
          data.sort((a, b) => { for (const [key, ascending] of orders) { const compare = String(a[key]).localeCompare(String(b[key])); if (compare) return ascending ? compare : -compare; } return 0; });
          if (range) data = data.slice(range[0], range[1] + 1);
          return Promise.resolve({ data: failure === table ? null : single ? data[0] || null : data, error: failure === table ? { message: 'db failure' } : null }).then(resolve, reject);
        },
      };
      return query;
    },
    storage: { from: bucket => ({ createSignedUrl: async (path, seconds) => { signatures.push({ bucket, path, seconds }); return { data: { signedUrl: 'https://storage.test/archived.pdf' }, error: null }; } }) },
  };
  const loaded = { exports: {} };
  const compiled = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInThisContext(`(function(module,exports,require,process){${compiled}\n})`)(loaded, loaded.exports, id => {
    if (id === '@supabase/supabase-js') return { createClient: () => admin };
    if (id === '@/app/components/calendar/utils') return calendarUtils();
    if (id === 'next/server') return { NextResponse: { json: (body, options) => new Response(JSON.stringify(body), { ...options, headers: { ...options?.headers, 'Content-Type': 'application/json' } }) } };
    throw new Error(`Unexpected dependency ${id}`);
  }, { env: {} });
  return { get: loaded.exports.GET, calls, signatures };
}
const request = (query = '', token = 'valid') => new Request(`https://drimli.test/api/documents?${query}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

test('both endpoints reject unauthenticated access before reading data', async () => {
  for (const file of ['./route.ts', './download/route.ts']) {
    const api = load(file);
    assert.equal((await api.get(request('', ''))).status, 401);
    assert.equal(api.calls.length, 0);
    assert.equal(api.signatures.length, 0);
  }
});
test('list isolates owners, sorts both types and never signs PDFs', async () => {
  const api = load('./route.ts');
  const response = await api.get(request('provider_id=bob'));
  assert.match(response.headers.get('cache-control'), /no-store/);
  const body = await response.json();
  assert.deepEqual(body.documents.map(row => row.number), ['AVR-A', 'FAC-A']);
  assert.equal(body.documents[0].downloadable, false);
  assert.deepEqual(body.documents[1].refunds.map(row => row.status), ['succeeded', 'pending', 'failed']);
  assert.equal(body.documents[0].refunds.length, 1);
  assert.equal(JSON.stringify(body).includes('SECRET'), false);
  assert.equal(JSON.stringify(body).includes('file_path'), false);
  assert.equal(api.signatures.length, 0);
  for (const table of ['client_invoices', 'client_credit_notes', 'drimli_payments']) assert.ok(api.calls.some(call => call[0] === table && call[1] === 'provider_id' && call[2] === 'alice'));
});
test('another professional gets only their own documents', async () => {
  const api = load('./route.ts', { user: 'bob' });
  const body = await (await api.get(request())).json();
  assert.deepEqual(body.documents.map(row => row.number), ['FAC-SECRET']);
  assert.equal(body.documents[0].refunds.length, 1);
});
test('download rejects another owner for either document type, without signing', async () => {
  for (const type of ['invoice', 'credit_note']) {
    const api = load('./download/route.ts', { user: 'bob' });
    assert.equal((await api.get(request(`id=${ownId}&type=${type}&provider_id=alice&file_path=providers/alice/a.pdf`))).status, 404);
    assert.equal(api.signatures.length, 0);
  }
});
test('download signs only stored metadata belonging to authenticated owner', async () => {
  for (const type of ['invoice', 'credit_note']) {
    const rows = fixture(); rows.client_credit_notes[0].storage_bucket = 'invoices'; rows.client_credit_notes[0].file_path = 'providers/alice/note.pdf';
    const api = load('./download/route.ts', { rows });
    assert.equal((await api.get(request(`id=${ownId}&type=${type}&file_path=providers/bob/b.pdf`))).status, 200);
    assert.deepEqual(api.signatures, [{ bucket: 'invoices', path: type === 'invoice' ? 'providers/alice/a.pdf' : 'providers/alice/note.pdf', seconds: 300 }]);
  }
});
test('missing archived PDF remains listed and cannot be downloaded', async () => {
  const api = load('./download/route.ts');
  assert.equal((await api.get(request(`id=${ownId}&type=credit_note`))).status, 404);
  assert.equal(api.signatures.length, 0);
});
test('invalid filters, dates and offsets fail closed', async () => {
  for (const query of ['type=commission', 'from=2026-02-30', 'from=2026-10-03&to=2026-10-01', 'invoiceOffset=-1', 'noteOffset=1.2']) assert.equal((await load('./route.ts').get(request(query))).status, 400);
});
test('type and date filters apply before pagination', async () => {
  const api = load('./route.ts');
  assert.deepEqual((await (await api.get(request('type=invoice&from=2026-10-02'))).json()).documents, []);
  assert.deepEqual((await (await api.get(request('type=credit_note&to=2026-10-02'))).json()).documents.map(row => row.number), ['AVR-A']);
});
test('merged pagination returns every document once including equal dates', async () => {
  const rows = fixture();
  rows.client_invoices = Array.from({ length: 35 }, (_, index) => ({ ...rows.client_invoices[0], id: String(index).padStart(3, '0'), invoice_number: `FAC-${index}` }));
  rows.client_credit_notes = Array.from({ length: 26 }, (_, index) => ({ ...rows.client_credit_notes[0], id: String(index).padStart(3, '0'), credit_note_number: `AVR-${index}`, issued_at: rows.client_invoices[0].issued_at }));
  const api = load('./route.ts', { rows });
  const seen = []; let cursor = {}; let pages = 0;
  do {
    const body = await (await api.get(request(new URLSearchParams(cursor)))).json();
    seen.push(...body.documents.map(row => row.number)); cursor = body.next; pages++;
  } while (cursor && pages < 10);
  assert.equal(seen.length, 61); assert.equal(new Set(seen).size, 61); assert.equal(pages, 4);
});
test('database errors do not silently turn into an empty list or sign a document', async () => {
  assert.equal((await load('./route.ts', { failure: 'client_credit_notes' }).get(request())).status, 500);
  const api = load('./download/route.ts', { failure: 'client_invoices' });
  assert.equal((await api.get(request(`id=${ownId}&type=invoice`))).status, 500);
  assert.equal(api.signatures.length, 0);
});
test('period uses the same Paris calendar dates as the displayed documents', async () => {
  const rows = fixture();
  rows.client_invoices[0].issued_at = '2026-10-01T22:30:00Z'; // 2 October in Paris
  const api = load('./route.ts', { rows });
  assert.equal((await (await api.get(request('type=invoice&from=2026-10-02&to=2026-10-02'))).json()).documents.length, 1);
  assert.equal((await (await api.get(request('type=invoice&to=2026-10-01'))).json()).documents.length, 0);
});
test('search quotes special characters and preserves the owner constraint', async () => {
  const api = load('./route.ts');
  const term = 'Client",provider_id.eq.bob,%_';
  assert.equal((await api.get(request(new URLSearchParams({ search: term })))).status, 200);
  const expressions = api.calls.filter(call => call[1] === 'or');
  assert.equal(expressions.length, 2);
  assert.ok(expressions.every(call => call[2].includes(JSON.stringify('%Client",provider\\_id.eq.bob,\\%\\_%'))));
  assert.ok(api.calls.some(call => call[0] === 'client_invoices' && call[1] === 'provider_id' && call[2] === 'alice'));
});
test('invalid download IDs and document types cannot choose arbitrary tables', async () => {
  for (const query of [`id=${ownId}&type=commission`, 'id=bad&type=invoice']) {
    const api = load('./download/route.ts');
    assert.equal((await api.get(request(query))).status, 400);
    assert.equal(api.calls.length, 0);
    assert.equal(api.signatures.length, 0);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { inflateRawSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const pdfA = Buffer.from('%PDF-1.7\nArchived invoice A\n%%EOF');
const pdfB = Buffer.from('%PDF-1.7\nArchived credit note A\n%%EOF');
function invoice(overrides = {}) {
  return { id: 'invoice-a', provider_id: 'alice', invoice_number: 'FAC-2026-001', issued_at: '2026-03-10T12:00:00Z', storage_bucket: 'invoices', file_path: 'providers/alice/a.pdf', ...overrides };
}
function note(overrides = {}) {
  return { id: 'note-a', provider_id: 'alice', credit_note_number: 'AVR-2026-001', issued_at: '2026-03-11T12:00:00Z', storage_bucket: 'invoices', file_path: 'providers/alice/note.pdf', ...overrides };
}
function load({ user = 'alice', invoices = [invoice(), invoice({ id: 'secret', provider_id: 'bob', invoice_number: 'SECRET', file_path: 'providers/bob/secret.pdf' })], notes = [note()], files = {}, dbError = false } = {}) {
  const rows = { client_invoices: invoices, client_credit_notes: notes };
  const reads = []; const downloads = [];
  const admin = {
    auth: { getUser: async token => ({ data: { user: user && token === 'valid' ? { id: user } : null }, error: null }) },
    from(table) {
      assert.ok(table in rows, 'Only client document tables may be queried');
      const filters = []; const orders = []; let range = [0, 999];
      const query = {
        select() { return query; },
        eq(key, value) { reads.push({ table, key, value }); filters.push(row => row[key] === value); return query; },
        gte(key, value) { filters.push(row => Date.parse(row[key]) >= Date.parse(value)); return query; },
        lt(key, value) { filters.push(row => Date.parse(row[key]) < Date.parse(value)); return query; },
        order(key, options) { orders.push([key, options.ascending]); return query; },
        range(start, end) { range = [start, end]; return query; },
        then(resolve, reject) {
          const data = rows[table].filter(row => filters.every(filter => filter(row))).sort((a, b) => {
            for (const [key, ascending] of orders) { const comparison = String(a[key]).localeCompare(String(b[key])); if (comparison) return ascending ? comparison : -comparison; }
            return 0;
          }).slice(range[0], range[1] + 1);
          return Promise.resolve({ data, error: dbError ? { message: 'db failed' } : null }).then(resolve, reject);
        },
      };
      return query;
    },
    storage: { from: bucket => ({ download: async path => {
      downloads.push({ bucket, path });
      const value = Object.hasOwn(files, path) ? files[path] : path.endsWith('/note.pdf') ? pdfB : pdfA;
      if (value === null) return { data: null, error: { statusCode: '404', message: 'Object not found' } };
      if (value instanceof Error) return { data: null, error: { statusCode: '503', message: value.message } };
      return { data: new Blob([value]), error: null };
    } }) },
  };
  function compile(file, mocks) {
    const loaded = { exports: {} };
    const js = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    vm.runInThisContext(`(function(module,exports,require,process){${js}\n})`)(loaded, loaded.exports, id => id in mocks ? mocks[id] : require(id), { env: {} });
    return loaded.exports;
  }
  const utils = compile('../../../../components/calendar/utils.ts', { './types': { DAY_KEYS: [] } });
  const archive = compile('../../../../../lib/clientDocumentArchive.ts', { '@/app/components/calendar/utils': utils });
  const route = compile('./route.ts', {
    '@/lib/clientDocumentArchive': archive,
    '@supabase/supabase-js': { createClient: () => admin },
    '@/app/components/calendar/utils': utils,
    'next/server': { NextResponse: { json: (body, options) => new Response(JSON.stringify(body), { ...options, headers: { ...options?.headers, 'Content-Type': 'application/json' } }) } },
  });
  return { get: route.GET, reads, downloads };
}
function request(query = 'year=2026&month=03', token = 'valid', signal) {
  return new Request(`https://drimli.test/api/export?${query}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal });
}
// Read the ZIP central directory, then inflate each actual entry (no new dependency).
async function unzip(response) {
  const zip = Buffer.from(await response.arrayBuffer());
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--;
  assert.ok(end >= 0, 'ZIP end record');
  const files = new Map(); let cursor = zip.readUInt32LE(end + 16);
  for (let index = 0; index < zip.readUInt16LE(end + 10); index++) {
    assert.equal(zip.readUInt32LE(cursor), 0x02014b50);
    const method = zip.readUInt16LE(cursor + 10); const size = zip.readUInt32LE(cursor + 20);
    const nameLength = zip.readUInt16LE(cursor + 28); const extra = zip.readUInt16LE(cursor + 30); const comment = zip.readUInt16LE(cursor + 32);
    const local = zip.readUInt32LE(cursor + 42); const name = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    const offset = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(offset, offset + size);
    files.set(name, method === 8 ? inflateRawSync(data) : data);
    cursor += 46 + nameLength + extra + comment;
  }
  return files;
}

test('rejects unauthenticated export before any document or storage access', async () => {
  const api = load(); const response = await api.get(request('', ''));
  assert.equal(response.status, 401); assert.equal(api.reads.length, 0); assert.equal(api.downloads.length, 0);
});
test('exports only the authenticated owner, preserving both PDF byte sequences', async () => {
  const api = load(); const response = await api.get(request('year=2026&month=03&provider_id=bob&path=providers/bob/secret.pdf'));
  assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /no-store/);
  assert.match(response.headers.get('content-disposition'), /DRIMLI_documents_2026-03_factures-avoirs.zip/);
  const files = await unzip(response);
  assert.deepEqual(files.get('Factures/FAC-2026-001.pdf'), pdfA);
  assert.deepEqual(files.get('Avoirs/AVR-2026-001.pdf'), pdfB);
  assert.ok(files.has('Factures/')); assert.ok(files.has('Avoirs/'));
  assert.ok([...files.keys()].every(name => !name.includes('SECRET')));
  assert.ok(api.downloads.every(row => row.path.startsWith('providers/alice/')));
  assert.equal(api.reads.filter(row => row.key === 'provider_id' && row.value === 'alice').length, 2);
});
test('a second professional receives only their own archive', async () => {
  const api = load({ user: 'bob' }); const files = await unzip(await api.get(request()));
  assert.ok(files.has('Factures/SECRET.pdf')); assert.equal(files.has('Factures/FAC-2026-001.pdf'), false); assert.equal(files.has('Avoirs/AVR-2026-001.pdf'), false);
  assert.equal(api.downloads.length, 1);
});
test('month boundaries follow Europe/Paris including the daylight-saving change', async () => {
  const invoices = [invoice({ id: 'start', invoice_number: 'START', issued_at: '2026-02-28T23:00:00Z' }), invoice({ id: 'end', invoice_number: 'END', issued_at: '2026-03-31T21:59:59Z' }), invoice({ id: 'before', invoice_number: 'BEFORE', issued_at: '2026-02-28T22:59:59Z' }), invoice({ id: 'after', invoice_number: 'AFTER', issued_at: '2026-03-31T22:00:00Z' })];
  const files = await unzip(await load({ invoices, notes: [] }).get(request()));
  assert.ok(files.has('Factures/START.pdf')); assert.ok(files.has('Factures/END.pdf')); assert.equal(files.has('Factures/BEFORE.pdf'), false); assert.equal(files.has('Factures/AFTER.pdf'), false);
});
test('whole-year export and type restriction include January and December only', async () => {
  const invoices = [invoice({ invoice_number: 'JAN', issued_at: '2025-12-31T23:00:00Z' }), invoice({ id: 'dec', invoice_number: 'DEC', issued_at: '2026-12-31T22:59:59Z' }), invoice({ id: 'after', invoice_number: 'AFTER', issued_at: '2026-12-31T23:00:00Z' })];
  const response = await load({ invoices }).get(request('year=2026&month=all&type=invoice'));
  assert.match(response.headers.get('content-disposition'), /2026_factures.zip/);
  const files = await unzip(response); assert.ok(files.has('Factures/JAN.pdf')); assert.ok(files.has('Factures/DEC.pdf')); assert.equal(files.has('Factures/AFTER.pdf'), false); assert.equal(files.has('Avoirs/AVR-2026-001.pdf'), false);
  const notes = await unzip(await load().get(request('year=2026&type=credit_note'))); assert.ok(notes.has('Avoirs/AVR-2026-001.pdf')); assert.equal(notes.has('Factures/FAC-2026-001.pdf'), false);
});
test('reads all backend pages independently of the visible list pagination', async () => {
  const invoices = Array.from({ length: 121 }, (_, index) => invoice({ id: String(index), invoice_number: `FAC-${index}` }));
  const response = await load({ invoices, notes: [] }).get(request('year=2026&month=03&invoiceOffset=100&search=ignored'));
  assert.equal(response.headers.get('x-documents-exported'), '121'); const files = await unzip(response);
  assert.equal([...files.keys()].filter(name => name.endsWith('.pdf')).length, 121);
});
test('missing metadata and missing storage files are reported while other PDFs export', async () => {
  const invoices = [invoice(), invoice({ id: 'missing-meta', invoice_number: 'MISSING-META', file_path: null }), invoice({ id: 'missing-file', invoice_number: 'MISSING-FILE', file_path: 'providers/alice/missing.pdf' })];
  const response = await load({ invoices, files: { 'providers/alice/missing.pdf': null } }).get(request());
  assert.equal(response.status, 200); assert.equal(response.headers.get('x-documents-missing'), '2');
  const files = await unzip(response); const report = files.get('Documents-manquants.txt').toString();
  assert.match(report, /MISSING-META/); assert.match(report, /MISSING-FILE/); assert.deepEqual(files.get('Factures/FAC-2026-001.pdf'), pdfA);
});
test('empty periods and selections with only missing PDFs return a useful message, not an empty ZIP', async () => {
  const empty = await load({ invoices: [], notes: [] }).get(request()); assert.equal(empty.status, 404); assert.match((await empty.json()).error, /Aucun document/);
  const missing = await load({ invoices: [invoice({ file_path: null })], notes: [] }).get(request()); assert.equal(missing.status, 404); const body = await missing.json(); assert.match(body.error, /Aucun PDF/); assert.equal(body.missing.length, 1);
});
test('filenames resist traversal and collisions, including case-insensitive collisions', async () => {
  const invoices = ['A/B', 'A_B', 'a_b', '../escape'].map((number, index) => invoice({ id: String(index), invoice_number: number }));
  const files = await unzip(await load({ invoices, notes: [] }).get(request()));
  const names = [...files.keys()].filter(name => name.endsWith('.pdf'));
  assert.equal(names.length, 4); assert.equal(new Set(names.map(name => name.toLowerCase())).size, 4);
  assert.ok(names.every(name => name.startsWith('Factures/') && name.split('/').length === 2 && !name.includes('../')));
});
test('rejects invalid periods and types before accessing documents', async () => {
  for (const query of ['year=1999', 'year=2026&month=13', 'year=2026&type=commission', 'year=20xx']) {
    const api = load(); assert.equal((await api.get(request(query))).status, 400); assert.equal(api.reads.length, 0);
  }
});
test('document count and byte limits reject the full export without truncating it', async () => {
  const invoices = Array.from({ length: 201 }, (_, index) => invoice({ id: String(index) }));
  const count = load({ invoices, notes: [] }); assert.equal((await count.get(request())).status, 413); assert.equal(count.downloads.length, 0);
  const oversized = await load({ invoices: [invoice()], notes: [], files: { 'providers/alice/a.pdf': Buffer.alloc(20_000_001) } }).get(request()); assert.equal(oversized.status, 413);
  const largeZip = await load({ invoices: [invoice()], notes: [], files: { 'providers/alice/a.pdf': randomBytes(4_100_000) } }).get(request()); assert.equal(largeZip.status, 413); assert.match((await largeZip.json()).error, /période plus courte/);
});
test('temporary storage or database errors are not misreported as missing PDFs', async () => {
  const storage = await load({ files: { 'providers/alice/a.pdf': new Error('temporarily unavailable') } }).get(request()); assert.equal(storage.status, 502);
  const db = await load({ dbError: true }).get(request()); assert.equal(db.status, 500);
});
test('canceled requests stop without producing an archive', async () => {
  const controller = new AbortController(); controller.abort(); const api = load();
  assert.equal((await api.get(request('year=2026', 'valid', controller.signal))).status, 504); assert.equal(api.downloads.length, 0);
});

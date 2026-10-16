import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

const root = process.env.DRIMLI_FACTURX_TEST_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const ts = require('typescript');
const { chromium } = require('playwright-core');
const { enrichFacturx, facturxModel, withFacturx } = await import(pathToFileURL(path.join(root, 'lib/facturx.ts')));
const { extract, check } = await import(pathToFileURL(path.join(root, 'node_modules/@stafyniaksacha/facturx/dist/index.mjs')));
const { createHash } = require('node:crypto');
const output = mkdtempSync(path.join(tmpdir(), 'drimli-facturx-tests-'));
console.log(`Factur-X fixtures and validation reports: ${output}`);

const baselines = new Map();
function load(source, extra = '', mocks = {}) {
  const compiled = ts.transpileModule(source + '\n' + extra, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: false } }).outputText;
  const loaded = { exports: {} };
  const localRequire = id => {
    if (id in mocks) return mocks[id];
    if (id === '@/lib/facturx') return { withFacturx: async (pdf, d) => { baselines.set(`${d.kind}:${d.number}:${d.buyer.name}`, pdf); return withFacturx(pdf, d); } };
    if (id === '@sparticuz/chromium') return { default: { args: [], executablePath: async () => chromium.executablePath() } };
    return require(id);
  };
  vm.runInThisContext(`(function(module,exports,require,process,Buffer){${compiled}\n})`)(loaded, loaded.exports, localRequire, process, Buffer);
  return loaded.exports;
}
const documentsSource = readFileSync(path.join(root, 'lib/billingDocuments.ts'), 'utf8');
const billing = load(documentsSource);
const originalBilling = load(execFileSync('git', ['show', 'HEAD:lib/billingDocuments.ts'], { cwd: root, encoding: 'utf8' }));
const webhook = readFileSync(path.join(root, 'app/api/stripe/webhook/route.ts'), 'utf8');
const parsed = ts.createSourceFile('route.ts', webhook, ts.ScriptTarget.Latest, true);
const renderFunctions = parsed.statements.filter(n => ts.isFunctionDeclaration(n) && ['generatePatientInvoicePdf', 'escapeHtml'].includes(n.name?.text)).map(n => n.getText(parsed)).join('\n');
const begin = webhook.indexOf('    if (!clientInvoice.file_path) {');
const end = webhook.indexOf('    const paidApplicationFee', begin);
assert.ok(begin > 0 && end > begin);
const patientWorkflow = load(`import { withFacturx } from '@/lib/facturx';\nimport { createHash } from 'node:crypto';\n${renderFunctions}\nconst monthKeyFromIso = (s:string) => s.slice(0,7);`, `exports.run = async (clientInvoice:any, supabaseAdmin:any) => { const appt = {provider_id:'test-provider',id:'test-appointment'}; const session = {id:'test-session'}; ${webhook.slice(begin, end)} };`);
const commission = load(readFileSync(path.join(root, 'lib/drimliCommissionBilling.ts'), 'utf8'));
const party = { name: 'Émetteur & TEST <pro>', address: '1 rue du Test', postalCode: '75001', city: 'Paris', country: 'FR', vatNumber: 'FR19892166588', siret: '' };
const document = { kind: 'credit_note', number: 'TEST-AVR-2026-001', originalInvoiceNumber: 'TEST-FAC-2026-001', issuedAt: '2026-10-14T12:00:00Z', serviceDate: '2026-10-15T12:00:00Z', issuer: party, customer: { name: 'Client TEST', country: 'FR' }, service: { title: 'Session TEST', durationMinutes: 30 }, totals: { excludingTax: 5000, vatRate: .2, vatAmount: 1000, includingTax: 6000, currency: 'EUR' } };
const model = { kind: 'invoice', number: 'TEST-FAC-2026-001', issuedAt: document.issuedAt, serviceDate: document.serviceDate, seller: party, buyer: document.customer, title: 'Session TEST', excludingTax: 5000, vatAmount: 1000, includingTax: 6000, vatRate: .2, currency: 'EUR', settled: true };

function adminMock(originalInvoice) {
  const state = { uploads: [], updates: [] };
  const chain = { eq: () => chain, is: () => chain, select: () => chain, single: async () => ({ data: originalInvoice, error: null }), then: resolve => resolve({ error: null }) };
  return { state, storage: { from: bucket => ({ upload: async (file, pdf, options) => { state.uploads.push({ bucket, file, pdf, options }); return { error: null }; } }) }, from: table => ({ update: payload => { state.updates.push({ table, payload }); return chain; }, upsert: async () => ({ error: null }), select: () => chain }) };
}

async function verify(name, pdf, { number, type, seller, buyer, reference, paid = true }) {
  const extracted = await extract({ pdf });
  assert.equal(extracted.filename, 'factur-x.xml');
  const validation = await check({ xml: extracted.xml, level: 'en16931', schematron: true });
  assert.equal(validation.valid, true, JSON.stringify(validation));
  assert.equal(validation.schematronValid, true);
  const escaped = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  for (const text of [`<ram:ID>${number}</ram:ID>`, `<ram:TypeCode>${type}</ram:TypeCode>`, '<ram:GrandTotalAmount>60.00</ram:GrandTotalAmount>', '<ram:TaxBasisTotalAmount>50.00</ram:TaxBasisTotalAmount>', '<ram:CalculatedAmount>10.00</ram:CalculatedAmount>', escaped(seller), escaped(buyer)]) assert.ok(extracted.xml.includes(text), text);
  if (reference) assert.ok(extracted.xml.includes(`<ram:IssuerAssignedID>${reference}</ram:IssuerAssignedID>`));
  assert.ok(extracted.xml.includes(`<ram:DuePayableAmount>${paid ? '0.00' : '60.00'}</ram:DuePayableAmount>`));
  writeFileSync(path.join(output, `${name}.pdf`), pdf);
  writeFileSync(path.join(output, `${name}.xml`), extracted.xml);
  const baseline = baselines.get(`${type === '381' ? 'credit_note' : 'invoice'}:${number}:${buyer}`);
  if (baseline) writeFileSync(path.join(output, `classic-${name}.pdf`), baseline);
  const validator = process.env.VERAPDF;
  if (validator) {
    const report = execFileSync(validator, ['--format', 'xml', '--flavour', '3b', path.join(output, `${name}.pdf`)], { encoding: 'utf8', maxBuffer: 5_000_000 });
    writeFileSync(path.join(output, `${name}-verapdf.xml`), report);
    assert.match(report, /isCompliant="true"/);
    assert.doesNotMatch(report, /isCompliant="false"/);
  } else console.log(`veraPDF NOT EXECUTED for ${name}; set VERAPDF to enable`);
  return extracted.xml;
}

test('B2B: actual webhook PDF, snapshot mapping, storage path and final hash', async () => {
  const row = { invoice_number: model.number, issued_at: model.issuedAt, service_date: model.serviceDate, issuer_full_name: party.name, issuer_address: party.address, issuer_postal_code: party.postalCode, issuer_city: party.city, issuer_country: party.country, issuer_siret: '', issuer_vat_number: party.vatNumber, customer_type: 'business', customer_business_name: 'Entreprise TEST', customer_name: 'Contact TEST', customer_address: '2 rue Test', customer_postal_code: '75002', customer_city: 'Paris', customer_country: 'FR', service_title: model.title, total_excluding_tax: 5000, vat_amount: 1000, total_including_tax: 6000, vat_rate: .2, currency: 'EUR' };
  const original = structuredClone(row);
  const admin = adminMock();
  await patientWorkflow.run(row, admin);
  assert.deepEqual(row, original);
  const upload = admin.state.uploads[0];
  assert.equal(upload.file, 'providers/test-provider/invoices/2026-10/patient_invoice_test-session.pdf');
  assert.equal(admin.state.updates[0].payload.content_hash, createHash('sha256').update(upload.pdf).digest('hex'));
  await verify('b2b', upload.pdf, { number: model.number, type: '380', seller: party.name, buyer: 'Entreprise TEST' });
  const before = admin.state.uploads.length;
  await patientWorkflow.run({ ...row, file_path: upload.file }, admin);
  assert.equal(admin.state.uploads.length, before, 'archived PDF must not be regenerated');
});

test('B2C: country explicitly present, no invented business identifiers', async () => {
  const pdf = await billing.generateBillingDocumentPdf({ ...document, kind: 'invoice', number: model.number, originalInvoiceNumber: null });
  const xml = await verify('b2c', pdf, { number: model.number, type: '380', seller: party.name, buyer: 'Client TEST' });
  const buyer = xml.split('<ram:BuyerTradeParty>')[1].split('</ram:BuyerTradeParty>')[0];
  assert.doesNotMatch(buyer, /SpecifiedLegalOrganization|SpecifiedTaxRegistration/);
});

test('client credit note: type 381, positive credit and original invoice reference', async () => {
  const pdf = await billing.generateBillingDocumentPdf(document);
  await verify('credit-note', pdf, { number: document.number, type: '381', seller: party.name, buyer: 'Client TEST', reference: document.originalInvoiceNumber, paid: false });
});

test('unsupported tax, missing country, missing reference, mismatched totals: exact original bytes', async () => {
  const classic = await originalBilling.generateBillingDocumentPdf(document);
  writeFileSync(path.join(output, 'classic-credit-note.pdf'), classic);
  const cases = [
    { ...model, vatRate: 0, vatAmount: 0, includingTax: 5000 },
    { ...model, buyer: { name: 'Client TEST' } },
    { ...model, seller: { ...party, vatNumber: null } },
    { ...model, kind: 'credit_note', originalInvoiceNumber: null },
    { ...model, includingTax: 6001 },
    { ...model, serviceDate: null },
  ];
  for (const d of cases) { const result = await enrichFacturx(classic, d); assert.equal(result.status, 'unsupported'); assert.strictEqual(result.pdf, classic); }
  const failed = await enrichFacturx(Buffer.from('invalid PDF'), model);
  assert.equal(failed.status, 'failed'); assert.equal(failed.pdf.toString(), 'invalid PDF');
  const previousCwd = process.cwd();
  try { process.chdir(output); const missingIcc = await enrichFacturx(classic, model); assert.equal(missingIcc.status, 'failed'); assert.strictEqual(missingIcc.pdf, classic); }
  finally { process.chdir(previousCwd); }
});

test('commission invoice and credit: correct issuer, existing archival behavior; strict unsupported date', async () => {
  const invoice = { id: 'test-invoice', provider_id: 'test-provider', invoice_number: 'TEST-COM-2026-001', period_month: '2026-10-01', issued_at: model.issuedAt, issuer_snapshot: commission.DRIMLI_BILLING_IDENTITY, customer_snapshot: { businessName: 'Professionnel TEST', fullName: 'Contact TEST', address: party.address, postalCode: party.postalCode, city: party.city, country: 'FR' }, description: 'Commission TEST', total_excluding_tax: 5000, vat_amount: 1000, total_including_tax: 6000, currency: 'EUR', file_path: null };
  const admin = adminMock(invoice);
  const original = structuredClone(invoice);
  await commission.ensureDrimliInvoicePdf(admin, invoice);
  assert.deepEqual(invoice, original);
  const note = { ...invoice, id: 'test-credit', invoice_id: invoice.id, credit_note_number: 'TEST-COM-AVR-2026-001', reason: 'Remboursement TEST' };
  await commission.ensureDrimliCreditNotePdf(admin, note);
  assert.equal(admin.state.uploads.length, 2);
  for (const [i, upload] of admin.state.uploads.entries()) {
    assert.equal(upload.options.upsert, false);
    writeFileSync(path.join(output, `commission-${i}-classic.pdf`), upload.pdf);
    await assert.rejects(extract({ pdf: upload.pdf }));
    assert.equal(admin.state.updates[i].payload.content_hash, createHash('sha256').update(upload.pdf).digest('hex'));
  }
  await commission.ensureDrimliInvoicePdf(admin, { ...invoice, file_path: 'existing.pdf' });
  assert.equal(admin.state.uploads.length, 2);
});

test('snapshot sums are copied in cents, including refund rounding; dates use Paris', () => {
  const m = facturxModel({ ...model, issuedAt: '2026-10-14T23:30:00Z', excludingTax: 83, vatAmount: 17, includingTax: 100 });
  assert.equal(m.exchangedDocument.issueDateTime.dateTimeString, '20261015');
  assert.equal(m.supplyChainTradeTransaction.applicableHeaderTradeSettlement.specifiedTradeSettlementHeaderMonetarySummation.grandTotalAmount.value, 1);
});

test('existing download route: authorized signed URL, invalid/missing token denied', async () => {
  const token = 'test-only-opaque-token';
  let signed = 0;
  const db = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { storage_bucket: 'invoices', file_path: 'providers/test-provider/invoices/2026-10/patient_invoice_test-session.pdf', client_download_token_hash: createHash('sha256').update(token).digest('hex') } }) }) }) }),
    storage: { from: bucket => ({ createSignedUrl: async (file, ttl) => { assert.equal(bucket, 'invoices'); assert.ok(file.endsWith('.pdf')); assert.equal(ttl, 600); signed++; return { data: { signedUrl: 'https://example.invalid/test-signed-pdf' } }; } }) },
  };
  // The route's environment guard is retained; supply test values only to its VM.
  const source = readFileSync(path.join(root, 'app/api/invoices/patient/download/route.ts'), 'utf8').replace('const v = process.env[name];', 'const v = "test-only";');
  const route = load(source, '', {
    '@supabase/supabase-js': { createClient: () => db },
    'next/server': { NextResponse: { json: (data, init) => Response.json(data, init), redirect: (url, init) => new Response(null, { ...init, headers: { location: url } }) } },
  });
  const good = await route.GET(new Request(`https://example.invalid/?session_id=test-session&token=${token}`));
  assert.equal(good.status, 302); assert.equal(good.headers.get('location'), 'https://example.invalid/test-signed-pdf');
  for (const query of ['token=wrong', '']) assert.equal((await route.GET(new Request(`https://example.invalid/?session_id=test-session&${query}`))).status, 403);
  assert.equal(signed, 1);
});

const franchiseMention = 'TVA non applicable, art. 293 B du CGI';
const franchise = {
  ...model, vatRegime: 'franchise_base', exemptionMention: franchiseMention,
  seller: { ...party, name: 'LA POSTE (fixture)', siret: '35600000000048', vatNumber: null },
  vatRate: 0, vatAmount: 0, excludingTax: 5000, includingTax: 5000,
};

test('293 B: E, French reason, real SIREN from snapshot SIRET; VAT ID used if already present', () => {
  const m = facturxModel(franchise).supplyChainTradeTransaction;
  const seller = m.applicableHeaderTradeAgreement.sellerTradeParty;
  assert.deepEqual(seller.specifiedLegalOrganization.id, { value: '356000000', schemeID: '0002' });
  assert.deepEqual(seller.specifiedTaxRegistration, [{ id: { value: '356000000', schemeID: 'FC' } }]);
  const tax = m.applicableHeaderTradeSettlement.applicableTradeTax[0];
  assert.equal(tax.categoryCode.value, 'E');
  assert.equal(tax.exemptionReasonCode.value, 'VATEX-FR-FRANCHISE');
  assert.equal(tax.exemptionReason.value, franchiseMention);
  assert.equal(tax.calculatedAmount.value, 0);
  const knownVat = facturxModel({ ...franchise, seller: { ...franchise.seller, vatNumber: party.vatNumber } });
  assert.deepEqual(knownVat.supplyChainTradeTransaction.applicableHeaderTradeAgreement.sellerTradeParty.specifiedTaxRegistration,
    [{ id: { value: party.vatNumber, schemeID: 'VA' } }]);
});

test('293 B: missing/invalid identity or inconsistent declaration keeps exact classic PDF', async () => {
  const classic = Buffer.from('original classic PDF bytes');
  for (const d of [
    { ...franchise, seller: { ...franchise.seller, siret: null } },
    { ...franchise, seller: { ...franchise.seller, siret: '00000000000000' } },
    { ...franchise, seller: { ...franchise.seller, siret: '12345678912345' } },
    { ...franchise, seller: { ...franchise.seller, country: 'BE' } },
    { ...franchise, vatRegime: 'standard' },
    { ...franchise, exemptionMention: 'TVA exonérée, art. 261 du CGI' },
    { ...franchise, exemptionMention: null },
    { ...franchise, vatAmount: 1 },
    { ...franchise, includingTax: 5001 },
  ]) {
    const result = await enrichFacturx(classic, d);
    assert.equal(result.status, 'unsupported');
    assert.strictEqual(result.pdf, classic);
  }
  const historicalNote = facturxModel({ ...franchise, vatRegime: undefined, kind: 'credit_note', originalInvoiceNumber: model.number });
  assert.equal(historicalNote.exchangedDocument.typeCode.value, '381');
});

async function verifyFranchise(name, pdf, type, number) {
  const { xml, filename } = await extract({ pdf });
  assert.equal(filename, 'factur-x.xml');
  const validation = await check({ xml, level: 'en16931', schematron: true });
  assert.equal(validation.valid, true, JSON.stringify(validation));
  assert.equal(validation.schematronValid, true);
  for (const text of [`<ram:ID>${number}</ram:ID>`, `<ram:TypeCode>${type}</ram:TypeCode>`,
    '<ram:CategoryCode>E</ram:CategoryCode>', 'VATEX-FR-FRANCHISE', franchiseMention,
    '<ram:ID schemeID="FC">356000000</ram:ID>', '<ram:TaxTotalAmount currencyID="EUR">0.00</ram:TaxTotalAmount>',
    '<ram:GrandTotalAmount>50.00</ram:GrandTotalAmount>']) assert.ok(xml.includes(text), text);
  const seller = xml.split('<ram:SellerTradeParty>')[1].split('</ram:SellerTradeParty>')[0];
  assert.doesNotMatch(seller, /schemeID="VA"/);
  writeFileSync(path.join(output, `${name}.pdf`), pdf);
  writeFileSync(path.join(output, `${name}.xml`), xml);
  if (process.env.VERAPDF) {
    const report = execFileSync(process.env.VERAPDF, ['--format', 'xml', '--flavour', '3b', path.join(output, `${name}.pdf`)], { encoding: 'utf8', maxBuffer: 5_000_000 });
    writeFileSync(path.join(output, `${name}-verapdf.xml`), report);
    assert.match(report, /isCompliant="true"/);
    assert.doesNotMatch(report, /isCompliant="false"/);
  } else console.log(`veraPDF NOT EXECUTED for ${name}; set VERAPDF to enable`);
  return xml;
}

test('293 B: actual webhook invoice uses archived regime, mention and SIRET without changing amounts', async () => {
  const row = { invoice_number: 'TEST-FR-FAC-001', issued_at: model.issuedAt, service_date: model.serviceDate,
    issuer_full_name: franchise.seller.name, issuer_address: party.address, issuer_postal_code: party.postalCode,
    issuer_city: party.city, issuer_country: 'FR', issuer_siret: franchise.seller.siret, issuer_vat_number: null,
    customer_type: 'business', customer_business_name: 'Entreprise TEST', customer_name: 'Contact TEST', customer_country: 'FR', customer_address: '2 rue Test', customer_postal_code: '75002', customer_city: 'Paris',
    service_title: model.title, total_excluding_tax: 5000, vat_amount: 0, total_including_tax: 5000, vat_rate: 0,
    vat_regime: 'franchise_base', vat_exemption_mention: franchiseMention, currency: 'EUR' };
  const before = structuredClone(row);
  const admin = adminMock();
  await patientWorkflow.run(row, admin);
  assert.deepEqual(row, before);
  const pdf = admin.state.uploads[0].pdf;
  await verifyFranchise('franchise-invoice', pdf, '380', row.invoice_number);
  assert.equal(admin.state.updates[0].payload.content_hash, createHash('sha256').update(pdf).digest('hex'));
  writeFileSync(path.join(output, 'classic-franchise-invoice.pdf'), baselines.get(`invoice:${row.invoice_number}:Entreprise TEST`));
});

test('293 B: actual client credit-note renderer uses retained exact mention and original reference', async () => {
  const d = { ...document, number: 'TEST-FR-AVR-001', issuer: franchise.seller,
    totals: { ...document.totals, vatRate: 0, vatAmount: 0, includingTax: 5000, exemptionMention: franchiseMention } };
  const before = structuredClone(d);
  const pdf = await billing.generateBillingDocumentPdf(d);
  assert.deepEqual(d, before);
  const xml = await verifyFranchise('franchise-credit-note', pdf, '381', d.number);
  assert.ok(xml.includes(`<ram:IssuerAssignedID>${d.originalInvoiceNumber}</ram:IssuerAssignedID>`));
  writeFileSync(path.join(output, 'classic-franchise-credit-note.pdf'), baselines.get(`credit_note:${d.number}:Client TEST`));
});

test('B2C Australian reservation snapshot: actual invoice pipeline preserves country and has no tax/business IDs for buyer', async () => {
  const row = { invoice_number: 'TEST-AU-001', issued_at: model.issuedAt, service_date: model.serviceDate,
    issuer_full_name: party.name, issuer_address: party.address, issuer_postal_code: party.postalCode, issuer_city: party.city, issuer_country: 'FR', issuer_siret: '', issuer_vat_number: party.vatNumber,
    customer_type: 'individual', customer_name: 'Client AU TEST', customer_country: 'AU', service_title: model.title,
    total_excluding_tax: 5000, vat_amount: 1000, total_including_tax: 6000, vat_rate: .2, currency: 'EUR' };
  const before = structuredClone(row), admin = adminMock();
  await patientWorkflow.run(row, admin);
  assert.deepEqual(row, before);
  const xml = await verify('b2c-country-au', admin.state.uploads[0].pdf, { number: row.invoice_number, type: '380', seller: party.name, buyer: row.customer_name });
  const buyer = xml.split('<ram:BuyerTradeParty>')[1].split('</ram:BuyerTradeParty>')[0];
  assert.ok(buyer.includes('<ram:CountryID>AU</ram:CountryID>')); assert.doesNotMatch(buyer, /SpecifiedLegalOrganization|SpecifiedTaxRegistration/);
});

test('commission rule: 100 EUR transaction is 5 EUR TTC = 4.17 HT + 0.83 VAT; monthly-period XML diagnostic stays classic', async () => {
  const { calculateDrimliFee } = load(readFileSync(path.join(root, 'lib/billing.ts'), 'utf8'));
  assert.equal(calculateDrimliFee(10000), 500);
  assert.deepEqual(commission.drimliVatBreakdown(500), { totalExcludingTax: 417, vatAmount: 83, totalIncludingTax: 500 });
  assert.equal(10000 - calculateDrimliFee(10000), 9500);
  const invoice = { id: 'test-rule-invoice', provider_id: 'test-provider', invoice_number: 'TEST-COM-001', period_month: '2026-10-01', issued_at: model.issuedAt,
    issuer_snapshot: commission.DRIMLI_BILLING_IDENTITY, customer_snapshot: { businessName: 'Professionnel TEST', fullName: 'Contact TEST', address: party.address, postalCode: party.postalCode, city: party.city, country: 'FR' }, description: 'Commissions DRIMLI – octobre 2026',
    total_excluding_tax: 417, vat_amount: 83, total_including_tax: 500, currency: 'EUR', file_path: null };
  const before = structuredClone(invoice), admin = adminMock(invoice);
  await commission.ensureDrimliInvoicePdf(admin, invoice);
  assert.deepEqual(invoice, before);
  const pdf = admin.state.uploads[0].pdf;
  writeFileSync(path.join(output, 'commission-rule-classic.pdf'), pdf);
  await assert.rejects(extract({ pdf }));
  // Test the alternative period representation without inserting a fictitious
  // payment/delivery date into the candidate XML. Nothing is embedded/archived.
  const candidate = facturxModel({ ...model, number: invoice.invoice_number,
    seller: { ...invoice.issuer_snapshot, name: invoice.issuer_snapshot.legalName }, buyer: { name: 'Professionnel TEST', country: 'FR' },
    excludingTax: 417, vatAmount: 83, includingTax: 500 });
  candidate.supplyChainTradeTransaction.applicableHeaderTradeDelivery = {};
  candidate.supplyChainTradeTransaction.applicableHeaderTradeSettlement.billingSpecifiedPeriod = {
    startDateTime: { dateTimeString: '20261001', format: '102' }, endDateTime: { dateTimeString: '20261031', format: '102' },
  };
  const { invoiceToXml } = await import(pathToFileURL(path.join(root, 'node_modules/@stafyniaksacha/facturx/dist/index.mjs')));
  const serialized = await invoiceToXml(candidate);
  let xml; try { xml = serialized.toString(); } finally { serialized.dispose(); }
  assert.doesNotMatch(xml, /ActualDeliverySupplyChainEvent/);
  for (const amount of ['<ram:TaxBasisTotalAmount>4.17</ram:TaxBasisTotalAmount>', '<ram:CalculatedAmount>0.83</ram:CalculatedAmount>', '<ram:GrandTotalAmount>5.00</ram:GrandTotalAmount>', '<udt:DateTimeString format="102">20261031</udt:DateTimeString>']) assert.ok(xml.includes(amount));
  const validation = await check({ xml, level: 'en16931', schematron: true });
  assert.equal(validation.errors.length, 0, JSON.stringify(validation));
  assert.equal(validation.valid, false);
  assert.ok(validation.schematronErrors.length > 0);
  assert.ok(validation.schematronErrors.every(e => e.id === 'PEPPOL-EN16931-R008' && e.flag === 'warning' && e.location.includes('ApplicableHeaderTradeDelivery')));
  writeFileSync(path.join(output, 'commission-period-candidate.xml'), xml);
  writeFileSync(path.join(output, 'commission-period-validation.json'), JSON.stringify(validation, null, 2));
});

test('reservation country control: France is selected by default and another ISO country can be chosen', async () => {
  const source = readFileSync(path.join(root, 'app/reserver/[serviceId]/page.tsx'), 'utf8');
  const parsed = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let select, initial;
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(parsed) === 'select'
      && node.openingElement.attributes.properties.some(p => ts.isJsxAttribute(p) && p.name.getText(parsed) === 'id' && p.initializer?.text === 'client-country')) select = node;
    if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && node.name.elements[0]?.getText(parsed) === 'clientCountry') initial = node.initializer.arguments[0].getText(parsed);
    ts.forEachChild(node, visit);
  }
  visit(parsed); assert.ok(select && initial);
  const src = `const React=require('react'); const {billingCountryChoices}=require(${JSON.stringify(path.join(root, 'lib/billingCountries.mjs'))}); const styles={field:'field'}; exports.Control=function(){const [clientCountry,setClientCountry]=React.useState(${initial});return ${select.parent.getText(parsed)};};`;
  const compiled = ts.transpileModule(src, { fileName: 'country-control.tsx', compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInThisContext(`(function(exports,require){${compiled}\n})`)(exports, require);
  const html = require('react-dom/server').renderToStaticMarkup(require('react').createElement(exports.Control));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath() });
  try {
    const page = await browser.newPage({ viewport: { width: 600, height: 120 } });
    await page.setContent(html);
    const country = page.getByLabel('Pays', { exact: true });
    assert.equal(await country.inputValue(), 'FR');
    assert.equal(await country.locator('option:checked').textContent(), 'France');
    assert.equal(await country.locator('option').count(), 249);
    await page.screenshot({ path: path.join(output, 'b2c-country-control.png') });
    await country.selectOption('AU'); assert.equal(await country.inputValue(), 'AU');
  } finally { await browser.close(); }
});

const commissionInvoice = {
  id: 'test-period-invoice', provider_id: 'test-provider', invoice_number: 'TEST-COM-P-001',
  period_month: '2026-10-01', issued_at: '2026-11-03T12:00:00Z',
  issuer_snapshot: commission.DRIMLI_BILLING_IDENTITY,
  customer_snapshot: { businessName: 'Professionnel TEST', fullName: 'Contact TEST', address: party.address, postalCode: party.postalCode, city: party.city, country: 'FR', siret: '35600000000048' },
  description: 'Commissions DRIMLI – octobre 2026', total_excluding_tax: 417,
  vat_amount: 83, total_including_tax: 500, currency: 'EUR', file_path: null,
};

async function verifyCommissionPeriod(name, invoice, expectedStart, expectedEnd) {
  const before = structuredClone(invoice), admin = adminMock(invoice);
  await commission.ensureDrimliInvoicePdf(admin, invoice);
  assert.deepEqual(invoice, before);
  const upload = admin.state.uploads[0];
  assert.equal(upload.options.upsert, false);
  assert.equal(upload.file, `providers/test-provider/drimli-invoices/${invoice.period_month.slice(0,7)}/${invoice.invoice_number}.pdf`);
  assert.equal(admin.state.updates[0].payload.content_hash, createHash('sha256').update(upload.pdf).digest('hex'));
  const { xml, filename } = await extract({ pdf: upload.pdf });
  assert.equal(filename, 'factur-x.xml');
  const validation = await check({ xml, level: 'en16931', schematron: true });
  assert.equal(validation.valid, true, JSON.stringify(validation));
  assert.equal(validation.schematronValid, true);
  assert.deepEqual(validation.errors, []); assert.deepEqual(validation.schematronErrors, []);
  const delivery = xml.split('<ram:ApplicableHeaderTradeDelivery>')[1].split('</ram:ApplicableHeaderTradeDelivery>')[0];
  assert.equal(delivery, '<ram:ShipToTradeParty><ram:Name>Professionnel TEST</ram:Name></ram:ShipToTradeParty>');
  assert.doesNotMatch(xml, /ActualDeliverySupplyChainEvent|DespatchAdviceReferencedDocument|ReceivingAdviceReferencedDocument/);
  const period = xml.split('<ram:BillingSpecifiedPeriod>')[1].split('</ram:BillingSpecifiedPeriod>')[0];
  assert.ok(period.includes(`<udt:DateTimeString format="102">${expectedStart}</udt:DateTimeString>`));
  assert.ok(period.includes(`<udt:DateTimeString format="102">${expectedEnd}</udt:DateTimeString>`));
  for (const amount of ['<ram:TaxBasisTotalAmount>4.17</ram:TaxBasisTotalAmount>', '<ram:CalculatedAmount>0.83</ram:CalculatedAmount>', '<ram:GrandTotalAmount>5.00</ram:GrandTotalAmount>', '<ram:TotalPrepaidAmount>5.00</ram:TotalPrepaidAmount>', '<ram:DuePayableAmount>0.00</ram:DuePayableAmount>']) assert.ok(xml.includes(amount));
  assert.ok(xml.includes('<ram:Name>LEWIS PARKER</ram:Name>'));
  assert.ok(xml.includes(`<ram:ID>${invoice.invoice_number}</ram:ID>`));
  writeFileSync(path.join(output, `${name}.pdf`), upload.pdf);
  writeFileSync(path.join(output, `${name}.xml`), xml);
  writeFileSync(path.join(output, `classic-${name}.pdf`), baselines.get(`invoice:${invoice.invoice_number}:Professionnel TEST`));
  if (process.env.VERAPDF) {
    const report = execFileSync(process.env.VERAPDF, ['--format', 'xml', '--flavour', '3b', path.join(output, `${name}.pdf`)], { encoding: 'utf8', maxBuffer: 5_000_000 });
    writeFileSync(path.join(output, `${name}-verapdf.xml`), report);
    assert.match(report, /isCompliant="true"/); assert.doesNotMatch(report, /isCompliant="false"/);
  } else console.log(`veraPDF NOT EXECUTED for ${name}; set VERAPDF to enable`);
  await commission.ensureDrimliInvoicePdf(admin, { ...invoice, file_path: upload.file });
  assert.equal(admin.state.uploads.length, 1, 'existing archived invoice must remain unchanged');
}

test('commission period: actual PDF pipeline, recorded service recipient, no invented date; XSD/Schematron/extraction/PDF-A', async () => {
  await verifyCommissionPeriod('commission-period-october', commissionInvoice, '20261001', '20261031');
});

test('commission period: leap February and December use the recorded month, never issue/payment date', async () => {
  await verifyCommissionPeriod('commission-period-leap', { ...commissionInvoice, invoice_number: 'TEST-COM-P-002', period_month: '2028-02-01', issued_at: '2028-03-03T12:00:00Z', description: 'Commissions DRIMLI – février 2028' }, '20280201', '20280229');
  await verifyCommissionPeriod('commission-period-december', { ...commissionInvoice, invoice_number: 'TEST-COM-P-003', period_month: '2026-12-01', issued_at: '2027-01-03T12:00:00Z', description: 'Commissions DRIMLI – décembre 2026' }, '20261201', '20261231');
});

test('period and beneficiary must both be explicit; invalid period and unidentifiable recipient keep exact classic PDF', async () => {
  const classic = Buffer.from('classic PDF, unchanged');
  for (const patch of [
    { servicePeriod: { start: '2026-10-01', end: '2026-10-31' } },
    { servicePeriod: { start: '2026-10-01', end: '2026-09-30' }, serviceRecipientName: 'Professionnel TEST' },
    { servicePeriod: { start: '2026-02-01', end: '2026-02-30' }, serviceRecipientName: 'Professionnel TEST' },
    { servicePeriod: { start: '2026-10-01', end: '2026-10-31' }, serviceRecipientName: '   ' },
  ]) {
    const result = await enrichFacturx(classic, { ...model, serviceDate: null, ...patch });
    assert.equal(result.status, 'unsupported'); assert.strictEqual(result.pdf, classic);
  }
  for (const siret of ['00000000000000', 42]) {
    const admin = adminMock();
    await commission.ensureDrimliInvoicePdf(admin, { ...commissionInvoice, customer_snapshot: { ...commissionInvoice.customer_snapshot, siret } });
    const upload = admin.state.uploads[0];
    await assert.rejects(extract({ pdf: upload.pdf }));
    assert.deepEqual(upload.pdf, baselines.get(`invoice:${commissionInvoice.invoice_number}:Professionnel TEST`));
  }
});

test('CII structure: period belongs in settlement; omitted delivery fails XSD, empty delivery fails R008', async () => {
  const { invoiceToXml } = await import(pathToFileURL(path.join(root, 'node_modules/@stafyniaksacha/facturx/dist/index.mjs')));
  const doc = await invoiceToXml(facturxModel({ ...model, serviceDate: null, servicePeriod: { start: '2026-10-01', end: '2026-10-31' }, serviceRecipientName: 'Professionnel TEST' }));
  let xml; try { xml = doc.toString(); } finally { doc.dispose(); }
  assert.equal((await check({ xml, level: 'en16931', schematron: true })).valid, true);
  const delivery = /<ram:ApplicableHeaderTradeDelivery>[\s\S]*?<\/ram:ApplicableHeaderTradeDelivery>/;
  const omitted = await check({ xml: xml.replace(delivery, ''), level: 'en16931', schematron: true });
  assert.ok(omitted.errors.length > 0); assert.equal(omitted.valid, false);
  const empty = await check({ xml: xml.replace(delivery, '<ram:ApplicableHeaderTradeDelivery/>'), level: 'en16931', schematron: true });
  assert.deepEqual(empty.errors, []); assert.equal(empty.valid, false);
  assert.ok(empty.schematronErrors.some(e => e.id === 'PEPPOL-EN16931-R008'));
  const period = xml.match(/<ram:BillingSpecifiedPeriod>[\s\S]*?<\/ram:BillingSpecifiedPeriod>/)[0];
  const wrong = xml.replace(period, '').replace(delivery, `<ram:ApplicableHeaderTradeDelivery>${period}</ram:ApplicableHeaderTradeDelivery>`);
  const misplaced = await check({ xml: wrong, level: 'en16931', schematron: true });
  assert.ok(misplaced.errors.length > 0); assert.equal(misplaced.valid, false);
});

const commissionCredit = {
  id: 'test-period-credit', provider_id: 'test-provider', invoice_id: commissionInvoice.id,
  credit_note_number: 'TEST-COM-AVR-P-001', issued_at: '2027-01-07T12:00:00Z',
  reason: 'Restitution partielle de commission DRIMLI', total_excluding_tax: 83,
  vat_amount: 17, total_including_tax: 100, currency: 'EUR', file_path: null,
};

test('commission credit: original monthly period, recipient, type 381, positive partial credit; strict XML and PDF/A', async () => {
  let selected;
  const admin = adminMock(commissionInvoice), originalFrom = admin.from;
  admin.from = table => {
    const query = originalFrom(table), originalSelect = query.select;
    query.select = columns => { selected = columns; return originalSelect(columns); };
    return query;
  };
  const before = structuredClone(commissionCredit), original = structuredClone(commissionInvoice);
  await commission.ensureDrimliCreditNotePdf(admin, commissionCredit);
  assert.match(selected, /period_month/);
  assert.deepEqual(commissionCredit, before); assert.deepEqual(commissionInvoice, original);
  const upload = admin.state.uploads[0];
  assert.equal(upload.file, 'providers/test-provider/drimli-credit-notes/2027-01/TEST-COM-AVR-P-001.pdf');
  assert.equal(upload.options.upsert, false);
  assert.equal(admin.state.updates[0].table, 'drimli_commission_credit_notes');
  assert.equal(admin.state.updates[0].payload.content_hash, createHash('sha256').update(upload.pdf).digest('hex'));
  const { xml, filename } = await extract({ pdf: upload.pdf });
  assert.equal(filename, 'factur-x.xml');
  const validation = await check({ xml, level: 'en16931', schematron: true });
  assert.equal(validation.valid, true, JSON.stringify(validation)); assert.equal(validation.schematronValid, true);
  assert.deepEqual(validation.errors, []); assert.deepEqual(validation.schematronErrors, []);
  assert.match(xml, /<ram:TypeCode>381<\/ram:TypeCode>/);
  assert.ok(xml.includes(`<ram:ID>${commissionCredit.credit_note_number}</ram:ID>`));
  assert.ok(xml.includes(`<ram:IssuerAssignedID>${commissionInvoice.invoice_number}</ram:IssuerAssignedID>`));
  assert.match(xml, /<ram:ShipToTradeParty><ram:Name>Professionnel TEST<\/ram:Name><\/ram:ShipToTradeParty>/);
  const period = xml.split('<ram:BillingSpecifiedPeriod>')[1].split('</ram:BillingSpecifiedPeriod>')[0];
  assert.match(period, />20261001<\/udt:DateTimeString>/); assert.match(period, />20261031<\/udt:DateTimeString>/);
  assert.doesNotMatch(xml, /ActualDeliverySupplyChainEvent/);
  for (const amount of ['<ram:TaxBasisTotalAmount>0.83</ram:TaxBasisTotalAmount>', '<ram:CalculatedAmount>0.17</ram:CalculatedAmount>', '<ram:GrandTotalAmount>1.00</ram:GrandTotalAmount>', '<ram:DuePayableAmount>1.00</ram:DuePayableAmount>']) assert.ok(xml.includes(amount), amount);
  writeFileSync(path.join(output, 'commission-credit-period.pdf'), upload.pdf);
  writeFileSync(path.join(output, 'commission-credit-period.xml'), xml);
  writeFileSync(path.join(output, 'classic-commission-credit-period.pdf'), baselines.get(`credit_note:${commissionCredit.credit_note_number}:Professionnel TEST`));
  if (process.env.VERAPDF) {
    const report = execFileSync(process.env.VERAPDF, ['--format', 'xml', '--flavour', '3b', path.join(output, 'commission-credit-period.pdf')], { encoding: 'utf8', maxBuffer: 5_000_000 });
    writeFileSync(path.join(output, 'commission-credit-period-verapdf.xml'), report);
    assert.match(report, /isCompliant="true"/); assert.doesNotMatch(report, /isCompliant="false"/);
  } else console.log('veraPDF NOT EXECUTED for commission credit; set VERAPDF to enable');
  const archived = { ...commissionCredit, file_path: upload.file };
  const untouchedAdmin = { from: () => assert.fail('archived credit must not query or upload') };
  assert.strictEqual(await commission.ensureDrimliCreditNotePdf(untouchedAdmin, archived), archived);
});

test('commission credit: incomplete original snapshots or period preserve exact classic PDF', async () => {
  for (const patch of [
    { period_month: undefined }, { period_month: '2026-13-01' },
    { customer_snapshot: { ...commissionInvoice.customer_snapshot, siret: null } },
    { customer_snapshot: { ...commissionInvoice.customer_snapshot, businessName: '', fullName: '' } },
    { customer_snapshot: { ...commissionInvoice.customer_snapshot, country: null } },
    { invoice_number: '' },
  ]) {
    const invoice = { ...commissionInvoice, ...patch }, admin = adminMock(invoice);
    await commission.ensureDrimliCreditNotePdf(admin, commissionCredit);
    const pdf = admin.state.uploads[0].pdf;
    assert.deepEqual(pdf, baselines.get(`credit_note:${commissionCredit.credit_note_number}:${invoice.customer_snapshot.businessName || invoice.customer_snapshot.fullName || 'Professionnel'}`));
    await assert.rejects(extract({ pdf }));
  }
});

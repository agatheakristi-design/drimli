import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('./professionalSeo.ts', import.meta.url), 'utf8');
const loaded = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
  { module: loaded, exports: loaded.exports });
const { professionalMetadata: metadata, templateIndex, representativeService, descriptionTemplates } = loaded.exports;
const profile = { provider_id: '11111111-1111-4111-8111-111111111111', slug: 'ancienne-adresse-2', first_name: 'Éléonore', last_name: 'François', full_name: 'Raison sociale différente', profession: 'Hypnothérapeute' };
const service = { id: 'a', active: true, title: 'Séance individuelle', created_at: '2026-01-01T00:00:00Z', duration_minutes: 60, price_cents: 8050 };

test('identity, accents, canonical and OG use the recorded slug, not billing name', () => {
 const result = metadata(profile, [service]);
 assert.equal(result.title, 'Éléonore François – Hypnothérapeute | Drimli');
 assert.equal(result.alternates.canonical, 'https://www.drimli.io/ancienne-adresse-2');
 assert.equal(result.openGraph.url, result.alternates.canonical);
 assert.equal(result.openGraph.title, 'Éléonore François – Hypnothérapeute');
 assert.equal(result.openGraph.description, result.description);
 assert.ok(!result.description.includes('Raison sociale'));
 assert.equal(result.robots, undefined);
 assert.equal(result.openGraph.images, undefined);
});

test('oldest active service, stable id tie-break, no mutation of displayed order', () => {
 const rows = [{ ...service, id: 'new', created_at: '2026-08-01' }, { ...service, id: 'z' }, service, { ...service, id: 'inactive', active: false, created_at: '2020-01-01' }];
 const before = JSON.stringify(rows);
 assert.equal(representativeService(rows).id, 'a');
 assert.equal(JSON.stringify(rows), before);
 assert.equal(metadata(profile, rows).description, metadata(profile, [service]).description);
 assert.equal(representativeService([{ ...service, created_at: null }, { ...service, id: 'dated' }]).id, 'dated');
});

const ids = new Map();
for (let n = 0; ids.size < 20 && n < 10000; n++) {
 const id = `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
 ids.set(templateIndex(id), id);
}
assert.equal(ids.size, 20);
for (let i = 0; i < 20; i++) {
 test(`template ${i + 1}: complete data, deterministic calls and partial data`, () => {
  const p = { ...profile, provider_id: ids.get(i) };
  const expected = descriptionTemplates[i].replaceAll('{PRENOM}', 'Éléonore').replaceAll('{NOM}', 'François').replaceAll('{METIER}', 'Hypnothérapeute').replaceAll('{PRESTATION}', 'Séance individuelle').replaceAll('{DUREE}', '60 min').replaceAll('{PRIX}', '80,5');
  assert.equal(metadata(p, [service]).description, expected);
  assert.equal(metadata(p, [service]).description, metadata(p, [service]).description);
  assert.equal(templateIndex(p.provider_id.toUpperCase()), i);
  for (const patch of [{ price_cents: null }, { duration_minutes: null }, { price_cents: null, duration_minutes: null }, { title: null }, { price_cents: 0 }]) {
   const description = metadata(p, [{ ...service, ...patch }]).description;
   assert.doesNotMatch(description, /null|undefined|\{\w+\}|NaN/);
   if (patch.price_cents === 0 && descriptionTemplates[i].includes('{PRIX}')) assert.match(description, /0 €/);
  }
 });
}

test('universal fallback, missing profession, partial identity and no services', () => {
 const needsService = { ...profile, provider_id: ids.get(0) };
 assert.equal(metadata(needsService, []).description, 'Prenez rendez-vous en ligne avec Éléonore François, Hypnothérapeute. Consultez ses disponibilités et réservez votre créneau sur Drimli.');
 const partial = { ...needsService, profession: null, first_name: null, full_name: 'Nom historique' };
 assert.equal(metadata(partial, []).title, 'Nom historique | Drimli');
 assert.equal(metadata(partial, []).description, 'Prenez rendez-vous en ligne avec Nom historique. Consultez ses disponibilités et réservez votre créneau sur Drimli.');
 assert.doesNotMatch(metadata({ ...partial, full_name: null, last_name: null }, []).description, /null|undefined|avec \./);
});

test('available details preserved in fallback without a price or duration', () => {
 const p = { ...profile, provider_id: ids.get(0) };
 assert.match(metadata(p, [{ ...service, price_cents: null }]).description, /Séance individuelle de 60 min\./);
 assert.match(metadata(p, [{ ...service, duration_minutes: null }]).description, /Séance individuelle à 80,5 €\./);
 assert.match(metadata(p, [{ ...service, duration_minutes: null, price_cents: null }]).description, /Séance individuelle\./);
});

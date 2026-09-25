import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const nodes = tree => [tree, ...(Array.isArray(tree?.props?.children) ? tree.props.children.flat(Infinity) : [tree?.props?.children]).filter(x => x && typeof x === 'object').flatMap(nodes)];
const jsx = (type, props) => ({ type, props });
function compile(file, imports) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(js, { module: loaded, exports: loaded.exports, require: name => {
    if (!(name in imports)) throw new Error(`Unexpected import ${name}`);
    return imports[name];
  }, process: { env: {} } });
  return loaded.exports.default;
}
export function profileFixture({ authenticated = true, failSave = false } = {}) {
  const row = { provider_id: 'A', profession: 'Sophrologue', description: 'Description existante', slug: 'adresse-stable', published: true };
  const writes = [], reads = [], states = [], effects = [];
  let index = 0;
  const client = { auth: { getUser: async () => ({ data: { user: authenticated ? { id: 'A' } : null } }), getSession: async () => ({ data: { session: null } }) }, from(table) {
    let patch, field, value;
    const query = {
      select(columns) { reads.push({ table, columns }); return query; },
      update(data) { patch = data; return query; },
      eq(k, v) { field = k; value = v; return query; },
      maybeSingle: async () => ({ data: { ...row } }),
      then(resolve) {
        writes.push({ table, patch: JSON.parse(JSON.stringify(patch)), field, value });
        if (!failSave && authenticated && field === 'provider_id' && value === 'A') Object.assign(row, patch);
        return Promise.resolve({ error: failSave ? { message: 'Échec simulé' } : null }).then(resolve);
      },
    }; return query;
  } };
  const imports = {
    react: { useState(initial) { const i = index++; if (!(i in states)) states[i] = initial; return [states[i], v => { states[i] = typeof v === 'function' ? v(states[i]) : v; }]; }, useEffect: fn => effects.push(fn), useCallback: fn => fn, useRef: () => ({ current: null }) },
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'lucide-react': { Check: 'i', ChevronRight: 'i', Plus: 'i' },
    'next/link': 'a', '@/lib/supabaseClient': { supabase: client },
    './tasks': { tasks: [{ label: 'Écrire une description', description: 'Présentez votre activité', done: false }] },
    './dashboard.module.css': { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) },
  };
  for (const name of ['DrimpayOnboarding', 'GoogleMeetOnboarding', 'GoogleReviewsOnboarding', 'BillingSettingsOnboarding', 'ServicesManager']) imports[`./${name}`] = () => null;
  const Component = compile('app/dashboard/components/TaskList.tsx', imports);
  const render = () => { index = 0; return Component({ onCompletedTasksChange() {} }); };
  const find = predicate => nodes(render()).find(predicate);
  const field = id => find(n => n.props?.id === id);
  const button = text => find(n => n.type === 'button' && n.props?.children === text);
  const toggle = () => find(n => n.props?.className === 'taskRowHeader').props.onClick();
  return { row, writes, reads, client, render, field, button, toggle, async load() { render(); effects[0](); await new Promise(resolve => setImmediate(resolve)); } };
}

test('loads both saved fields, saves them together only for the current user, preserves slug, and renders them publicly', async () => {
  const f = profileFixture(); await f.load(); f.toggle();
  assert.equal(f.field('dashboard-profession').props.value, 'Sophrologue');
  assert.equal(f.field('dashboard-description').props.value, 'Description existante');
  f.field('dashboard-profession').props.onChange({ target: { value: '  Coach  ' } });
  f.field('dashboard-description').props.onChange({ target: { value: 'Nouvelle description' } });
  await f.button('Enregistrer').props.onClick();
  assert.equal(f.writes.length, 1);
  assert.deepEqual(Object.keys(f.writes[0].patch).sort(), ['description', 'profession', 'updated_at']);
  assert.equal(f.writes[0].field, 'provider_id'); assert.equal(f.writes[0].value, 'A');
  assert.equal(f.row.slug, 'adresse-stable');
  f.toggle(); assert.equal(f.field('dashboard-profession').props.value, 'Coach');
  const Page = compile('app/[slug]/page.tsx', {
    '@supabase/supabase-js': { createClient: () => ({ from(table) { const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: table === 'profiles' ? f.row : null }), order: async () => ({ data: [] }) }; return query; } }) },
    'react/jsx-runtime': { jsx, jsxs: jsx }, './page.module.css': {},
    '@/app/components/public/PublicFlowShell': 'main', '@/app/components/public/ExpandableServiceList': 'services', '@/app/components/public/PublicPageViewTracker': 'tracker',
  });
  const publicNodes = nodes(await Page({ params: Promise.resolve({ slug: f.row.slug }) }));
  assert.ok(publicNodes.some(n => n.props?.children === 'Coach'));
  assert.ok(publicNodes.some(n => n.props?.children === 'Nouvelle description'));
});

test('cancel restores both saved values without writes', async () => {
  const f = profileFixture(); await f.load(); f.toggle();
  for (const id of ['dashboard-profession', 'dashboard-description']) f.field(id).props.onChange({ target: { value: 'Brouillon' } });
  f.button('Annuler').props.onClick(); f.toggle();
  assert.equal(f.field('dashboard-profession').props.value, 'Sophrologue');
  assert.equal(f.field('dashboard-description').props.value, 'Description existante');
  assert.equal(f.writes.length, 0);
});

test('unauthenticated saving and empty profession do not write', async () => {
  for (const authenticated of [false, true]) {
    const f = profileFixture({ authenticated }); await f.load(); f.toggle();
    f.field('dashboard-profession').props.onChange({ target: { value: ' ' } });
    await f.button('Enregistrer').props.onClick(); assert.equal(f.writes.length, 0);
  }
});

test('failed save does not replace saved values', async () => {
  const f = profileFixture({ failSave: true }); await f.load(); f.toggle();
  f.field('dashboard-profession').props.onChange({ target: { value: 'Coach' } });
  await f.button('Enregistrer').props.onClick(); f.button('Annuler').props.onClick(); f.toggle();
  assert.equal(f.field('dashboard-profession').props.value, 'Sophrologue');
});

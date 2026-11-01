import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const nodes = tree => [tree, ...(Array.isArray(tree?.props?.children) ? tree.props.children.flat(Infinity) : [tree?.props?.children]).filter(x => x && typeof x === 'object').flatMap(nodes)];
const jsx = (type, props) => ({ type, props });
function compile(file, imports, globals = {}) {
  const js = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(js, { module: loaded, exports: loaded.exports, require: name => {
    if (!(name in imports)) throw new Error(`Unexpected import ${name}`);
    return imports[name];
  }, ...globals });
  return loaded.exports.default;
}
const styles = { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
function fixture({ db, authenticated = 'A', failSave = false, missingRow = false } = {}) {
  db ??= { A: { first_name: 'Alice', last_name: 'Durand', full_name: 'Alice Durand', billing_full_name: 'Identité légale', business_name: 'Entreprise', slug: 'adresse-stable', profession: 'Coach' }, B: { first_name: 'Autre', last_name: 'Compte' }, documents: [{ issuer_full_name: 'Identité légale', pdf_path: 'archive.pdf' }] };
  let user = authenticated, index = 0;
  const states = [], effects = [], writes = [], reads = [], saved = [];
  const client = { auth: { getUser: async () => ({ data: { user: user ? { id: user } : null }, error: null }) }, from(table) {
    let patch, id;
    const query = {
      select(columns) { reads.push({ table, columns }); return query; },
      eq(field, value) { assert.equal(field, 'provider_id'); id = value; return query; },
      update(value) { patch = JSON.parse(JSON.stringify(value)); return query; },
      async maybeSingle() {
        if (!patch) return { data: db[id] ? { ...db[id] } : null, error: null };
        writes.push({ table, id, patch });
        if (failSave) return { error: { message: 'write failed' }, data: null };
        if (missingRow || id !== user || !db[id]) return { data: null, error: null };
        Object.assign(db[id], patch); return { data: { provider_id: id }, error: null };
      },
    }; return query;
  } };
  const Component = compile('app/dashboard/components/ProfileNameForm.tsx', {
    react: { useState(initial) { const i = index++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; }, useEffect: fn => effects.push(fn) },
    'react/jsx-runtime': { jsx, jsxs: jsx }, '@/lib/supabaseClient': { supabase: client }, '@/app/components/calendar/calendar.module.css': styles, '@/app/components/ui/Button': 'button',
  });
  function render() { index = 0; return Component({ onSaved: name => saved.push(name) }); }
  async function load() { render(); effects.shift()(); for (let i = 0; i < 10; i++) await Promise.resolve(); return render(); }
  function change(field, value) { const inputs = nodes(render()).filter(n => n.type === 'input'); inputs[field].props.onChange({ target: { value } }); }
  async function save() { await render().props.onSubmit({ preventDefault() {} }); }
  return { db, writes, reads, saved, load, render, change, save, setUser: value => { user = value; } };
}

test('preloads the existing first and last name, without a profession field', async () => {
  const f = fixture(); const tree = await f.load(); const inputs = nodes(tree).filter(n => n.type === 'input');
  assert.deepEqual(inputs.map(n => n.props.value), ['Alice', 'Durand']);
  assert.deepEqual(f.reads, [{ table: 'profiles', columns: 'first_name, last_name' }]);
});

test('saves exactly three name fields for the authenticated owner and persists on remount', async () => {
  const f = fixture(); await f.load(); const before = structuredClone(f.db);
  f.change(0, '  Anne Marie  '); f.change(1, '  Le Gall  '); await f.save();
  assert.deepEqual(f.writes, [{ table: 'profiles', id: 'A', patch: { first_name: 'Anne Marie', last_name: 'Le Gall', full_name: 'Anne Marie Le Gall' } }]);
  assert.deepEqual(f.saved, ['Anne Marie Le Gall']);
  assert.deepEqual(f.db.B, before.B); assert.deepEqual(f.db.documents, before.documents);
  for (const key of ['billing_full_name', 'business_name', 'slug', 'profession']) assert.equal(f.db.A[key], before.A[key]);
  const reloaded = fixture({ db: f.db }); const inputs = nodes(await reloaded.load()).filter(n => n.type === 'input');
  assert.deepEqual(inputs.map(n => n.props.value), ['Anne Marie', 'Le Gall']);
});

test('rejects blank names without writing', async () => {
  const f = fixture(); await f.load(); f.change(0, '   '); await f.save();
  assert.equal(f.writes.length, 0); assert.equal(f.saved.length, 0);
  assert.match(JSON.stringify(f.render()), /Le prénom et le nom sont obligatoires/);
});

test('refuses to save after a change of authenticated account', async () => {
  const f = fixture(); await f.load(); f.setUser('B'); await f.save();
  assert.equal(f.writes.length, 0); assert.equal(f.saved.length, 0);
  assert.match(JSON.stringify(f.render()), /Votre session a changé/);
});

test('an expired session cannot load or save a profile', async () => {
  const f = fixture({ authenticated: null }); await f.load(); await f.save();
  assert.equal(f.reads.length, 0); assert.equal(f.writes.length, 0);
  assert.match(JSON.stringify(f.render()), /Session expirée/);
});

for (const scenario of [{ failSave: true }, { missingRow: true }]) {
  test(`does not announce success on an error or zero updated rows: ${JSON.stringify(scenario)}`, async () => {
    const f = fixture(scenario); await f.load(); f.change(0, 'Nouveau'); await f.save();
    assert.equal(f.saved.length, 0); assert.equal(f.db.A.first_name, 'Alice');
    assert.match(JSON.stringify(f.render()), /Impossible d’enregistrer/);
  });
}

test('the saved name immediately updates the layout identity used by the sidebar and home', () => {
  const states = [], effects = []; let index = 0;
  const context = { Provider: 'IdentityProvider' };
  const Layout = compile('app/dashboard/layout.tsx', {
    react: { useState(value) { const i = index++; if (!(i in states)) states[i] = value; return [states[i], v => { states[i] = v; }]; }, useEffect: fn => effects.push(fn) },
    'react/jsx-runtime': { jsx, jsxs: jsx }, '@/lib/supabaseClient': { supabase: {} }, '@/app/components/DashboardGate': 'Gate',
    './components/Sidebar': 'Sidebar', './components/DrimliInvoicesPanel': 'AccountPanel', './components/DashboardIdentityContext': { DashboardIdentityContext: context }, './components/dashboard.module.css': styles,
  });
  function render() { index = 0; return Layout({ children: null }); }
  nodes(render()).find(n => n.type === 'AccountPanel').props.onProfileSaved('Anne Le Gall');
  const tree = render();
  assert.equal(nodes(tree).find(n => n.type === 'Sidebar').props.fullName, 'Anne Le Gall');
  const value = nodes(tree).find(n => n.type === 'IdentityProvider').props.value;
  assert.equal(value, 'Anne Le Gall');
  const Home = compile('app/dashboard/page.tsx', {
    react: { useContext: c => { assert.equal(c, context); return value; }, useState: v => [v, () => {}], useEffect: () => {} },
    'react/jsx-runtime': { jsx, jsxs: jsx }, '@/lib/supabaseClient': { supabase: {} },
    './components/DashboardIdentityContext': { DashboardIdentityContext: context }, './components/dashboard.module.css': styles,
    ...Object.fromEntries(['TopBar', 'WelcomeCard', 'ProgressCard', 'PublicLinkCard', 'TaskList', 'StatsPanel'].map(x => [`./components/${x}`, x])), './components/tasks': { tasks: [] },
  });
  assert.equal(nodes(Home()).find(n => n.type === 'WelcomeCard').props.fullName, value);
});

test('the sidebar derives the initials from the updated name and keeps all navigation entries', () => {
  const Sidebar = compile('app/dashboard/components/Sidebar.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'next/link': 'a', './AppointmentAlertBadge': 'Badge', 'next/navigation': { usePathname: () => '/dashboard' },
    'lucide-react': { CalendarDays: 'i', FileText: 'i', Home: 'i' }, '@/app/components/LogoutButton': 'Logout', '@/app/components/ui/Logo': 'Logo', './dashboard.module.css': styles,
  });
  const tree = Sidebar({ fullName: 'Anne Le Gall', email: 'demo@example.test', onOpenDrimliInvoices() {} });
  assert.equal(nodes(tree).find(n => n.props?.className === 'accountAvatar').props.children, 'AL');
  assert.deepEqual(nodes(tree).filter(n => n.type === 'a').map(n => n.props.href), ['/dashboard', '/dashboard', '/dashboard/calendrier', '/dashboard/factures']);
});

test('the account panel retains its existing invoice and credit-note download links', async () => {
  const states = [], effects = [], requests = []; let index = 0;
  const Panel = compile('app/dashboard/components/DrimliInvoicesPanel.tsx', {
    react: { useState(v) { const i = index++; if (!(i in states)) states[i] = v; return [states[i], value => { states[i] = value; }]; }, useEffect: fn => effects.push(fn), useCallback: fn => fn },
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'lucide-react': { X: 'i' },
    '@/lib/supabaseClient': { supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'test-only' } } }) } } },
    './ProfileNameForm': 'NameForm', './dashboard.module.css': styles, '@/app/components/calendar/calendar.module.css': styles, '@/app/components/ui/Accordion': 'Accordion',
  }, {
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({ documents: [{ id: 'invoice', periodMonth: '2026-10-01', totalIncludingTax: 500, currency: 'EUR', downloadUrl: '/existing-invoice', creditNotes: [{ id: 'credit', downloadUrl: '/existing-credit' }] }] }) };
    },
    document: { addEventListener() {}, removeEventListener() {} },
  });
  function render() { index = 0; return Panel({ open: true, onClose() {}, onProfileSaved() {} }); }
  render(); effects.shift()();
  for (let i = 0; i < 12; i++) await Promise.resolve();
  const tree = render();
  assert.equal(requests.length, 1); assert.equal(requests[0].url, '/api/dashboard/drimli-invoices');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer test-only');
  const accordion = nodes(tree).find(n => n.type === 'Accordion');
  assert.equal(accordion.props.defaultOpen, undefined);
  const contents = accordion.props.items.flatMap(item => nodes(item.children));
  assert.deepEqual(Array.from(contents.filter(n => n.type === 'a'), n => n.props.href), ['/existing-invoice', '/existing-credit']);
  assert.ok(contents.some(n => n.type === 'NameForm'));
  assert.deepEqual(Array.from(accordion.props.items, item => item.title), ['Mon profil', 'Votre contribution Drimli']);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const jsx = (type, props) => ({ type, props });
const nodes = tree => [tree, ...(Array.isArray(tree?.props?.children) ? tree.props.children.flat(Infinity) : [tree?.props?.children]).filter(x => x && typeof x === 'object').flatMap(nodes)];
function load(file, imports = {}) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(js, { module: loaded, exports: loaded.exports, process: { env: { RESEND_API_KEY: 'fixture' } }, require(name) {
    if (name in imports) return imports[name];
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
    throw new Error(`Unexpected import ${name}`);
  } });
  return loaded.exports;
}

for (const name of ['Florence Dhuy', 'Florence De Launay', 'Florence de Launay', 'florence de Launay']) {
  test(`preserves stored name and initials: ${name}`, async () => {
    const Sidebar = load('app/dashboard/components/Sidebar.tsx', {
      'next/link': 'a', 'next/navigation': { usePathname: () => '/dashboard' },
      'lucide-react': { Home: 'i', CalendarDays: 'i' },
      '@/app/components/LogoutButton': 'logout', '@/app/components/ui/Logo': 'logo',
    }).default;
    const sidebar = nodes(Sidebar({ fullName: name, email: 'fixture@example.invalid', onOpenDrimliInvoices() {} }));
    assert.ok(sidebar.some(n => n.type === 'strong' && n.props.children === name));
    assert.equal(sidebar.find(n => n.props?.className === 'accountAvatar').props.children, name.split(' ').slice(0, 2).map(p => p[0]).join(''));
    const Welcome = load('app/dashboard/components/WelcomeCard.tsx').default;
    assert.equal(nodes(Welcome({ fullName: name })).find(n => n.type === 'h1').props.children, `${name.split(' ')[0]}.`);
    const rows = {
      profiles: { full_name: name, published: true, provider_id: 'A' },
      appointments: { id: 'fixture', status: 'confirmed', start_datetime: '2026-10-01T10:00:00Z', end_datetime: '2026-10-01T11:00:00Z', provider_id: 'A', product_id: 'service', video_room_status: 'locked' },
      products: { title: 'Consultation' }, billing_checkout_snapshots: { cancellation_policy: 'non_refundable' },
    };
    const db = { createClient: () => ({ from(table) { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: rows[table] ?? null }), order: async () => ({ data: [] }) }; return q; } }) };
    const Page = load('app/[slug]/page.tsx', {
      '@supabase/supabase-js': db, '@/app/components/public/PublicFlowShell': 'main',
      '@/app/components/public/ExpandableServiceList': 'services', '@/app/components/public/PublicPageViewTracker': 'tracker',
    }).default;
    assert.equal(nodes(await Page({ params: Promise.resolve({ slug: 'unchanged' }) })).find(n => n.type === 'h1').props.children, name);
    const Portal = load('app/rendez-vous/[token]/page.tsx', {
      '@supabase/supabase-js': db, '@/app/components/ui/Logo': 'logo',
      '@/lib/video/joinWindow': { getJoinWindowState: () => 'early' }, '@/lib/video/meetUrl': { isGoogleMeetUrl: () => false },
      './PortalRefresh': 'refresh', './AppointmentManagement': 'management', '@/lib/clientAppointmentPolicy': { clientAppointmentPermissions: () => ({}) },
    }).default;
    const portal = nodes(await Portal({ params: Promise.resolve({ token: 'fixture' }) }));
    assert.ok(portal.some(n => n.type === 'strong' && n.props.children === name));
    assert.equal(portal.find(n => n.props?.className === 'avatarFallback').props.children, name[0]);
    const sent = [];
    const email = load('lib/email.ts', { resend: { Resend: class { emails = { send: async value => { sent.push(value); return { data: { id: 'fixture' }, error: null }; } }; } } });
    const payload = { appointmentId: 'fixture', to: 'fixture@example.invalid', providerName: name, serviceTitle: 'Consultation', startDateTimeIso: '2026-10-01T10:00:00Z', endDateTimeIso: '2026-10-01T11:00:00Z', appointmentJoinUrl: 'https://example.invalid' };
    await email.sendAppointmentConfirmationEmail(payload);
    await email.sendAppointmentRescheduledEmail(payload);
    await email.sendAppointmentCancelledEmail(payload);
    for (const message of sent) {
      assert.ok(message.subject.includes(name)); assert.ok(message.text.includes(name)); assert.ok(message.html.includes(name));
    }
  });
}

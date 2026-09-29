import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

// Run the real components and handlers with in-memory storage and browser effects.
// No production credentials, requests or mutations are used.
function harness({ failure = false, session = true, room = 'closed' } = {}) {
  const appointment = {
    id: 'fixture', provider_id: 'provider', product_id: 'service', status: 'confirmed',
    start_datetime: new Date(Date.now() - 60_000).toISOString(),
    end_datetime: new Date(Date.now() + 3600_000).toISOString(),
    video_provider: 'google_meet', video_join_url: 'https://meet.google.com/aaa-bbbb-ccc',
    video_room_status: room,
  };
  const events = [], hooks = [], cache = new Map();
  let cursor = 0, effectMode = false, refreshes = 0, interval;
  const admin = {
    auth: { getUser: async () => ({ data: { user: { id: 'provider' } } }) },
    from(table) {
      const filters = {};
      let update;
      const query = {
        select() { return query; },
        eq(key, value) { filters[key] = value; return query; },
        update(value) { update = value; return query; },
        async maybeSingle() {
          if (table === 'appointments') {
            if (filters.join_token && filters.join_token !== 'fixture-token') return { data: null };
            if (update) {
              if (failure) return { data: null, error: {} };
              Object.assign(appointment, update);
              events.push('write');
            }
            return { data: { ...appointment } };
          }
          if (table === 'profiles') return { data: { full_name: 'Florence Test' } };
          if (table === 'products') return { data: { title: 'Consultation' } };
          if (table === 'billing_checkout_snapshots') return { data: { cancellation_policy: 'moderate' } };
          return { data: null };
        },
      };
      return query;
    },
  };
  const browser = {
    location: { assign(url) { events.push(['navigate', url]); } },
    setTimeout() { return 1; }, clearTimeout() {},
    setInterval(fn, ms) { interval = { fn, ms }; return 2; }, clearInterval() {},
  };
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    const js = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    const loaded = { exports: {} };
    function require(name) {
      if (name === 'react') return {
        useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = initial; return [hooks[i], value => { hooks[i] = value; }]; },
        useRef(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = { current: initial }; return hooks[i]; },
        useEffect(fn) { if (effectMode) fn(); },
      };
      if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      if (name === 'next/navigation') return { useRouter: () => ({ refresh() { refreshes++; } }) };
      if (name === 'next/server') return { NextResponse: {
        json: (data, options = {}) => ({ status: options.status ?? 200, data }),
        redirect: (url, status) => ({ status, url: String(url), headers: new Headers() }),
      } };
      if (name === '@supabase/supabase-js') return { createClient: () => admin };
      if (name === '@/lib/supabaseClient') return { supabase: { auth: { getSession: async () => ({ data: { session: session ? { access_token: 'fixture' } : null } }) } } };
      if (name === '@/lib/clientAppointmentPolicy') return load('lib/clientAppointmentPolicy.ts');
      if (name === '@/lib/video/meetUrl') return load('lib/video/meetUrl.ts');
      if (name === '@/lib/video/joinWindow' || name === './joinWindow') return load('lib/video/joinWindow.ts');
      if (name.endsWith('.css')) return {};
      if (name.includes('Button')) return 'button';
      if (name.includes('Logo') || name.startsWith('./')) return name;
      throw new Error(`Unexpected dependency: ${name}`);
    }
    vm.runInNewContext(js, {
      module: loaded, exports: loaded.exports, require, window: browser, Date, URL, Headers,
      process: { env: {} },
      fetch: async (url, options) => {
        assert.match(url, /\/video-room$/);
        assert.equal(options.method, 'PATCH');
        events.push('request');
        const response = await load('app/api/appointments/[id]/video-room/route.ts').PATCH(
          { headers: new Headers(options.headers), json: async () => JSON.parse(options.body) },
          { params: Promise.resolve({ id: 'fixture' }) },
        );
        return { ok: response.status === 200, json: async () => response.data };
      },
    });
    cache.set(path, loaded.exports);
    return loaded.exports;
  }
  const context = { params: Promise.resolve({ token: 'fixture-token' }) };
  const portal = () => load('app/rendez-vous/[token]/page.tsx').default(context);
  function render() {
    cursor = 0;
    return load('app/components/calendar/AppointmentDetails.tsx').default({ appointment: {
      id: appointment.id, videoRoomStatus: appointment.video_room_status,
      videoJoinUrl: appointment.video_join_url, status: 'confirmed',
      start_datetime: appointment.start_datetime, end_datetime: appointment.end_datetime,
    } });
  }
  function find(node, predicate) {
    if (!node || typeof node !== 'object') return null;
    if (predicate(node)) return node;
    for (const child of [node.props?.children].flat(Infinity)) {
      const match = find(child, predicate);
      if (match) return match;
    }
    return null;
  }
  const click = () => find(render(), node => node.props?.children === 'Rejoindre la visio').props.onClick();
  return { appointment, events, portal, render, click, find,
    async join() { return load('app/api/rendez-vous/[token]/join/route.ts').GET({ url: 'https://example.invalid/join' }, context); },
    poll() {
      effectMode = true;
      load('app/rendez-vous/[token]/PortalRefresh.tsx').default({ state: 'open', roomStatus: 'closed', opensAt: Date.now() - 60_000, closesAt: Date.now() + 3600_000 });
      effectMode = false;
      assert.equal(interval.ms, 5000);
      interval.fn();
      assert.equal(refreshes, 1);
      return portal();
    },
  };
}

test('client before pro: waits, pro opens access before Meet, polling reveals named link', async () => {
  const h = harness();
  assert.match(JSON.stringify(await h.portal()), /En attente/);
  assert.equal((await h.join()).status, 303);
  await h.click();
  assert.deepEqual(h.events, ['request', 'write', ['navigate', h.appointment.video_join_url]]);
  const page = await h.poll();
  const link = h.find(page, node => node.type === 'a' && node.props.href.includes('/join'));
  assert.equal(link.props.children.join(''), 'Rejoindre Florence Test');
  assert.equal((await h.join()).url, h.appointment.video_join_url);
});

test('client after pro: named join link is immediately available', async () => {
  const h = harness();
  await h.click();
  const page = await h.portal();
  assert.doesNotMatch(JSON.stringify(page), /En attente/);
  assert.ok(h.find(page, node => node.type === 'a' && node.props.children.join('') === 'Rejoindre Florence Test'));
});

test('external Meet navigation cannot open DRIMLI access without its action', async () => {
  const h = harness();
  // The client portal and join handler cannot change the closed room.
  await h.portal();
  assert.equal((await h.join()).status, 303);
  assert.equal(h.appointment.video_room_status, 'closed');
  assert.deepEqual(h.events, []);
});

for (const options of [{ failure: true }, { session: false }]) {
  test(`opening failure stays in DRIMLI with explicit message: ${JSON.stringify(options)}`, async () => {
    const h = harness(options);
    await h.click();
    assert.match(JSON.stringify(h.render()), /Impossible d’ouvrir l’accès client.*Google Meet n’a pas été ouvert/);
    assert.equal(h.appointment.video_room_status, 'closed');
    assert.ok(!h.events.some(event => Array.isArray(event)));
    assert.equal((await h.join()).status, 303);
  });
}

test('rapid repeated clicks cause one request, one write and one navigation', async () => {
  const h = harness();
  await Promise.all([h.click(), h.click()]);
  assert.deepEqual(h.events, ['request', 'write', ['navigate', h.appointment.video_join_url]]);
});

test('already open room joins without another write', async () => {
  const h = harness({ room: 'open' });
  await h.click();
  assert.deepEqual(h.events, [['navigate', h.appointment.video_join_url]]);
});

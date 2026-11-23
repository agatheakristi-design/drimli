import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

function signature(pathname, params = {}, withinPublicFlow = false) {
  const loaded = { exports: {} };
  const imports = {
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'next/navigation': { usePathname: () => pathname, useParams: () => params },
    'next/link': { __esModule: true, default: 'Link' },
    './Logo': { __esModule: true, default: 'ExistingLogo' },
    './PoweredByDrimli.module.css': { __esModule: true, default: {} },
  };
  const code = ts.transpileModule(readFileSync(new URL('../app/components/ui/PoweredByDrimli.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { module: loaded, exports: loaded.exports, require: name => imports[name] });
  return loaded.exports.default({ withinPublicFlow });
}

test('dashboard and all its sections never display a signature, even when embedded', () => {
  for (const path of ['/dashboard', '/dashboard/', '/dashboard/factures', '/dashboard/calendrier', '/dashboard/services', '/dashboard/disponibilites', '/dashboard/rendez-vous', '/dashboard/another/section']) {
    assert.equal(signature(path), null);
    assert.equal(signature(path, {}, true), null);
  }
});

test('all other page families get a home link and the existing logo', () => {
  for (const path of ['/', '/login', '/signup', '/forgot-password', '/reset-password', '/creer-mot-de-passe', '/auth/callback', '/onboarding', '/paiements', '/paiement/succes', '/paiement/annule', '/rendez-vous/synthetic-token', '/privacy', '/terms', '/dashboard-example']) {
    const result = signature(path);
    assert.equal(result.type, 'footer');
    assert.equal(result.props.children.props.href, '/');
    assert.equal(result.props.children.props.children[0].props.children, 'Powered by');
    assert.equal(result.props.children.props.children[1].type, 'ExistingLogo');
  }
});

test('public profiles and booking shells have exactly one signature, inside their existing background', () => {
  for (const [path, params] of [['/camille', { slug: 'camille' }], ['/reserver/service-fixture', { serviceId: 'service-fixture' }]]) {
    assert.equal(signature(path, params), null);
    assert.equal(signature(path, params, true).type, 'footer');
  }
});

test('unknown pathname cannot flash a signature over the dashboard', () => {
  assert.equal(signature(null), null);
});

test('legacy signatures are removed and the shared signature stays in document flow', () => {
  const shell = readFileSync(new URL('../app/components/public/PublicFlowShell.tsx', import.meta.url), 'utf8');
  const payment = readFileSync(new URL('../app/paiement/succes/page.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../app/components/ui/PoweredByDrimli.module.css', import.meta.url), 'utf8');
  assert.match(shell, /<PoweredByDrimli withinPublicFlow \/>/);
  assert.doesNotMatch(shell + payment, /Powered by/);
  assert.doesNotMatch(payment, /signatureVisible|styles\.signature/);
  assert.doesNotMatch(css, /position:\s*(fixed|absolute)|background:|border:/);
});

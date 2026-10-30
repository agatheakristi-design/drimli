import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const loaded = { exports: {} };
const source = readFileSync(new URL('./accountantMonthlySchedule.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
vm.runInThisContext(`(function(module,exports){${js}\n})`)(loaded, loaded.exports);
const { previousAccountantMonth, isAccountantMonthlyWindow } = loaded.exports;

test('previous month follows the Paris date, including January rollover', () => {
  assert.equal(previousAccountantMonth(new Date('2026-11-05T07:00:00Z')), '2026-10');
  assert.equal(previousAccountantMonth(new Date('2026-01-05T07:00:00Z')), '2025-12');
  assert.equal(previousAccountantMonth(new Date('2026-03-31T22:30:00Z')), '2026-03');
  assert.equal(previousAccountantMonth(new Date('2026-12-31T23:30:00Z')), '2026-12');
});
test('winter selects 07 UTC and summer selects 06 UTC for the 08 Paris window', () => {
  assert.equal(isAccountantMonthlyWindow(new Date('2026-11-05T07:00:00Z')), true);
  assert.equal(isAccountantMonthlyWindow(new Date('2026-11-05T06:59:59Z')), false);
  assert.equal(isAccountantMonthlyWindow(new Date('2026-07-05T06:00:00Z')), true);
  assert.equal(isAccountantMonthlyWindow(new Date('2026-07-05T07:00:00Z')), false);
});
test('spring and autumn clock changes are reflected in the next run', () => {
  assert.equal(isAccountantMonthlyWindow(new Date('2026-04-05T06:30:00Z')), true);
  assert.equal(isAccountantMonthlyWindow(new Date('2026-10-05T06:30:00Z')), true);
  assert.equal(isAccountantMonthlyWindow(new Date('2026-11-05T07:30:00Z')), true);
});
test('only the fifth day within the Paris 08 hour is eligible', () => {
  for (const instant of ['2026-11-04T07:00:00Z', '2026-11-06T07:00:00Z', '2026-11-05T08:00:00Z']) assert.equal(isAccountantMonthlyWindow(new Date(instant)), false);
  assert.equal(isAccountantMonthlyWindow(new Date('2026-11-05T07:59:59Z')), true);
});

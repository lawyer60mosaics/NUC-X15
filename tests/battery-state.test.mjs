import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/vue/batteryState.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
vm.runInNewContext(code, { exports });
const { batteryReadback } = exports;

test('battery status distinguishes SDK mode, DLL threshold and conflicts', () => {
  assert.equal(batteryReadback('BestBattery', 60, 80).choice, 'best');
  assert.equal(batteryReadback('BestBattery', 60, 80).consistent, null);
  assert.equal(batteryReadback('Custom', 60, 60).consistent, true);
  assert.equal(batteryReadback('Custom', 60, 75).consistent, false);
  assert.equal(batteryReadback('AcMode', 80, 100).consistent, true);
  assert.equal(batteryReadback('AcMode', 100, 60).consistent, false);
  assert.equal(batteryReadback(null, null, 60).choice, null);
  assert.equal(batteryReadback('Custom', null, 60).consistent, null);
});

test('battery mutations require mode readback and synchronise two controllers', () => {
  const hardware = readFileSync(new URL('../src/vue/useHardware.ts', import.meta.url), 'utf8');
  const backend = readFileSync(new URL('../src-tauri/src/plug/vendor.rs', import.meta.url), 'utf8');
  assert.match(hardware, /call\('apply_vendor_battery', \{ mode, level \}\)/);
  assert.match(hardware, /call\('apply_author_battery_limit', \{ level \}\)/);
  assert.match(hardware, /state\.serviceData\?\.battery\?\.mode !== mode/);
  assert.match(backend, /vendor_battery_confirmed\(&data, normalized_mode, level\)/);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function loadRecentColors() {
  const source = readFileSync(new URL('../src/vue/recentColors.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const data = new Map();
  const exports = {};
  vm.runInNewContext(code, { exports, localStorage: {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  } });
  return { ...exports, data };
}

test('recent colors persist only valid values, deduplicate, and stay bounded', () => {
  const { readRecentColors, rememberColor, data } = loadRecentColors();
  let colors = readRecentColors();
  colors = rememberColor(colors, 'keyboard', { r: 255, g: 1, b: 0 });
  colors = rememberColor(colors, 'keyboard', { r: 255, g: 1, b: 0 });
  assert.equal(colors.keyboard.length, 1);
  colors = rememberColor(colors, 'lightbar', { r: 101, g: 0, b: 0 });
  assert.equal(colors.lightbar.length, 0);
  for (let i = 0; i < 12; i++) colors = rememberColor(colors, 'keyboard', { r: i, g: 0, b: 0 });
  assert.equal(colors.keyboard.length, 8);
  assert.equal(readRecentColors().keyboard.length, 8);
  data.set('studio-recent-colors-v1', '{invalid');
  assert.equal(readRecentColors().keyboard.length, 0);
});

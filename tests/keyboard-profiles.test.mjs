import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keyboardProfileStorageKey, parseKeyboardProfiles, validKeyPalette, validKeyboardProfile, writeKeyboardProfiles } from '../src/vue/keyboardProfiles.ts';
import { keyboardUsRows } from '../src/vue/keymapUs.ts';

const sample = {
  id: 'profile-1', name: '工作', effect: 'Monocolor', direction: 'None', speed: 0,
  color: { r: 255, g: 64, b: 0 }, brightnessAc: 60, brightnessDc: 30, idleAc: 3, idleDc: 2,
};

test('keyboard profiles reject malformed hardware values and hostile storage data', () => {
  assert.equal(validKeyboardProfile(sample), true);
  assert.equal(validKeyboardProfile({ ...sample, brightnessDc: 101 }), false);
  assert.equal(validKeyboardProfile({ ...sample, effect: 'ArbitrarySdkCall' }), false);
  assert.deepEqual(parseKeyboardProfiles('{broken'), []);
  assert.deepEqual(parseKeyboardProfiles(JSON.stringify([{ ...sample, speed: 99 }, sample])), [sample]);
});

test('keyboard profiles persist a bounded validated local list', () => {
  const data = new Map();
  globalThis.window = { localStorage: { setItem: (key, value) => data.set(key, value) } };
  writeKeyboardProfiles([sample]);
  assert.equal(data.get(keyboardProfileStorageKey), JSON.stringify([sample]));
  assert.throws(() => writeKeyboardProfiles(Array.from({ length: 21 }, () => sample)), /超过 20/);
  assert.throws(() => writeKeyboardProfiles([{ ...sample, idleAc: -1 }]), /不合法/);
  delete globalThis.window;
});

test('custom keyboard profiles retain all 126 LED colors and reject incomplete palettes', () => {
  const keyColors = Array.from({ length: 126 }, (_, index) => ({ r: index, g: 255 - index, b: 40 }));
  const profile = { ...sample, effect: 'UserMode', keyColors };
  assert.equal(validKeyPalette(keyColors), true);
  assert.equal(validKeyboardProfile(profile), true);
  assert.deepEqual(parseKeyboardProfiles(JSON.stringify([profile])), [profile]);
  assert.equal(validKeyboardProfile({ ...profile, keyColors: keyColors.slice(1) }), false);
  assert.equal(validKeyboardProfile({ ...profile, keyColors: keyColors.map((color, index) => index === 125 ? { ...color, r: 300 } : color) }), false);
  assert.equal(validKeyboardProfile({ ...sample, keyColors }), false);
});

test('original US keyboard map covers 85 physical keys without duplicate LED slots', () => {
  const keys = keyboardUsRows.flat();
  const indices = keys.flatMap((key) => key.indices);
  assert.equal(keys.length, 85);
  assert.equal(indices.length, 88);
  assert.equal(new Set(indices).size, indices.length);
  assert.ok(indices.every((index) => Number.isInteger(index) && index >= 0 && index < 126));
  assert.deepEqual(keys.find((key) => key.id === 'ENTER')?.indices, [76, 77]);
  assert.deepEqual(keys.find((key) => key.id === 'SHIFT_LEFT')?.indices, [84, 85, 86]);
});

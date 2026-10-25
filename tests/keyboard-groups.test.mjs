import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keyboardGroupSlots, parseKeyboardGroups, validKeyboardGroup, writeKeyboardGroups } from '../src/vue/keyboardGroups.ts';

const group = { id: 'work', name: '工作键', keyIds: ['ENTER', 'SHIFT_LEFT', 'A'] };

test('keyboard groups store only mapped unique physical keys', () => {
  assert.equal(validKeyboardGroup(group), true);
  assert.deepEqual(keyboardGroupSlots(group.keyIds), [65, 76, 77, 84, 85, 86]);
  assert.equal(validKeyboardGroup({ ...group, keyIds: ['A', 'A'] }), false);
  assert.equal(validKeyboardGroup({ ...group, keyIds: ['UNKNOWN'] }), false);
  assert.deepEqual(parseKeyboardGroups(JSON.stringify([group, { ...group, id: 'bad', keyIds: ['UNKNOWN'] }])), [group]);
});

test('keyboard groups reject duplicate IDs and persist a bounded list', () => {
  const saved = new Map();
  globalThis.localStorage = { setItem: (key, value) => saved.set(key, value) };
  writeKeyboardGroups([group]);
  assert.match(saved.get('nuctool.keyboard-groups.v1'), /"SHIFT_LEFT"/);
  assert.throws(() => writeKeyboardGroups([group, group]), /键组数据无效/);
  assert.throws(() => writeKeyboardGroups(Array.from({ length: 21 }, (_, id) => ({ ...group, id: String(id) }))), /键组数据无效/);
  delete globalThis.localStorage;
});

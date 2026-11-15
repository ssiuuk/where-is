import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchItems } from './search.ts';
import type { Item } from './types.ts';

const item = (name: string, note = '', where = '', updated = ''): Item & { where: string } => ({
  id: name, household: 'h', name, note, photo: '', place: '', moved_by: '', moved_at: '', updated, collectionId: 'c', where,
});
const items = [
  item('Passport', 'both of them', 'Bedroom › Drawer', '2026-01-03'),
  item('Spare car key', '', 'Kitchen › Bowl', '2026-01-02'),
  item('Christmas lights', 'tangled', 'Loft › Box 3', '2026-01-01'),
  item('Café receipt', '', 'Desk'),
];
const where = (i: Item) => (i as Item & { where: string }).where;
const names = (q: string) => searchItems(items, q, where).map((i) => i.name);

test('empty query lists newest first', () => {
  assert.deepEqual(names(''), ['Passport', 'Spare car key', 'Christmas lights', 'Café receipt']);
});

test('every word must match somewhere', () => {
  assert.deepEqual(names('key kitchen'), ['Spare car key']);
  assert.deepEqual(names('key loft'), []);
});

test('matches notes and places', () => {
  assert.deepEqual(names('tangled'), ['Christmas lights']);
  assert.deepEqual(names('drawer'), ['Passport']);
});

test('name matches beat place matches', () => {
  const list = [item('Box cutter', '', 'Garage'), item('Tape', '', 'Box 1')];
  assert.deepEqual(searchItems(list, 'box', where).map((i) => i.name), ['Box cutter', 'Tape']);
});

test('ignores case and accents', () => {
  assert.deepEqual(names('CAFE'), ['Café receipt']);
});

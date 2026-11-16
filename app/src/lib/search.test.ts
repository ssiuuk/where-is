import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchedAlias, searchItems, withTag } from './search.ts';
import type { Item } from './types.ts';

const item = (name: string, note = '', where = '', updated = '', tags: string[] = [], aliases: string[] = []): Item & { where: string } => ({
  id: name, household: 'h', name, note, tags, aliases, photo: '', place: '', moved_by: '', moved_at: '', updated, collectionId: 'c', where,
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

test('finds items by another name', () => {
  const list = [item('Vacuum cleaner', '', 'Hall cupboard', '', [], ['Hoover', 'Dyson']), item('Hose', '', 'Garden')];
  assert.deepEqual(searchItems(list, 'hoover', where).map((i) => i.name), ['Vacuum cleaner']);
  assert.deepEqual(searchItems(list, 'ho', where).map((i) => i.name), ['Hose', 'Vacuum cleaner']);
  assert.equal(matchedAlias(list[0], 'hoover'), 'Hoover');
  assert.equal(matchedAlias(list[0], 'vacuum'), '');
});

test('finds items by tag, and # only matches tags', () => {
  const list = [
    item('Drill', '', 'Garage', '', ['tools', 'diy']),
    item('Toolbox manual', '', 'Study'),
    item('Wreath', '', 'Loft', '', ['christmas']),
  ];
  assert.deepEqual(searchItems(list, 'tool', where).map((i) => i.name), ['Toolbox manual', 'Drill']);
  assert.deepEqual(searchItems(list, '#tool', where).map((i) => i.name), ['Drill']);
  assert.deepEqual(searchItems(list, '#christmas loft', where).map((i) => i.name), ['Wreath']);
  assert.deepEqual(withTag(list, 'diy').map((i) => i.name), ['Drill']);
  assert.equal(withTag(list, '').length, 3);
});

test('copes with items saved before tags existed', () => {
  const old = { ...item('Passport'), tags: undefined, aliases: undefined } as unknown as Item;
  assert.deepEqual(searchItems([old], 'pass', () => '').length, 1);
});

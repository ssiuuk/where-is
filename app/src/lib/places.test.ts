import { test } from 'node:test';
import assert from 'node:assert/strict';
import { descendants, parsePlaceInput, placeLabel, placeMap, placeTree, resolvePlaceInput } from './places.ts';
import type { Place } from './types.ts';

const p = (id: string, name: string, parent = ''): Place => ({ id, household: 'h', name, note: '', parent, updated: '' });
const places = [
  p('garage', 'Garage'),
  p('shelf10', 'Shelf 10', 'garage'),
  p('shelf2', 'Shelf 2', 'garage'),
  p('box', 'Blue box', 'shelf2'),
  p('kitchen', 'kitchen'),
  p('orphan', 'Attic box', 'deleted-parent'),
];

test('placeLabel walks up to the top', () => {
  assert.equal(placeLabel(placeMap(places), 'box'), 'Garage › Shelf 2 › Blue box');
  assert.equal(placeLabel(placeMap(places), 'missing'), '');
});

test('placeLabel survives a loop', () => {
  const loop = [p('a', 'A', 'b'), p('b', 'B', 'a')];
  assert.equal(placeLabel(placeMap(loop), 'a'), 'B › A');
});

test('descendants finds every level', () => {
  assert.deepEqual([...descendants(places, 'garage')].sort(), ['box', 'shelf10', 'shelf2']);
  assert.equal(descendants(places, 'kitchen').size, 0);
});

test('placeTree orders naturally and nests', () => {
  const rows = placeTree(places).map((r) => `${'-'.repeat(r.depth)}${r.place.name}`);
  assert.deepEqual(rows, ['Attic box', 'Garage', '-Shelf 2', '--Blue box', '-Shelf 10', 'kitchen']);
});

test('parsePlaceInput splits on > › and /', () => {
  assert.deepEqual(parsePlaceInput(' Garage >  Shelf 3 / Blue   box '), ['Garage', 'Shelf 3', 'Blue box']);
  assert.deepEqual(parsePlaceInput('Garage › '), ['Garage']);
  assert.deepEqual(parsePlaceInput('   '), []);
});

test('resolvePlaceInput reuses existing places, ignoring case', () => {
  assert.deepEqual(resolvePlaceInput(places, ['garage', 'shelf 2', 'Red box']), { parentId: 'shelf2', toCreate: ['Red box'] });
  assert.deepEqual(resolvePlaceInput(places, ['Garage', 'Shelf 2']), { parentId: 'shelf2', toCreate: [] });
  assert.deepEqual(resolvePlaceInput(places, ['Loft', 'Box']), { parentId: '', toCreate: ['Loft', 'Box'] });
  assert.deepEqual(resolvePlaceInput(places, ['Blue box'], 'shelf2'), { parentId: 'box', toCreate: [] });
});

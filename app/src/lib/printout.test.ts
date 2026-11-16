import assert from 'node:assert/strict';
import { test } from 'node:test';

import { inventoryHtml } from './printout.ts';
import type { Item, Place } from './types.ts';

const place = (id: string, name: string, parent = ''): Place => ({ id, household: 'h', name, note: '', parent, updated: '' });
const item = (id: string, name: string, p: string, note = ''): Item => ({
  id, household: 'h', name, note, photo: '', place: p, moved_by: '', moved_at: '', updated: '', collectionId: '', tags: [], aliases: [],
});

test('items are grouped under their place paths, in tree order', () => {
  const places = [place('g', 'Garage'), place('s', 'Shelf 3', 'g'), place('l', 'Loft')];
  const items = [item('1', 'Saw', 's', 'sharp'), item('2', 'Drill', 's'), item('3', 'Odd sock', '')];
  const html = inventoryHtml('Home', places, items, { notes: true, emptyPlaces: false, pageBreaks: false });
  const shelf = html.indexOf('Garage › Shelf 3');
  assert.ok(shelf > 0);
  assert.ok(html.indexOf('Drill') > shelf && html.indexOf('Drill') < html.indexOf('Saw'), 'sorted by name under the place');
  assert.ok(html.includes('sharp'));
  assert.ok(!html.includes('>Loft<'), 'empty places left out');
  assert.ok(html.indexOf('Not in a place yet') > html.indexOf('Saw'));
});

test('options: empty places, no notes, page breaks', () => {
  const places = [place('g', 'Garage'), place('l', 'Loft')];
  const html = inventoryHtml('Home', places, [item('1', 'Saw', 'g', 'sharp')], { notes: false, emptyPlaces: true, pageBreaks: true });
  assert.ok(html.includes('Loft'));
  assert.ok(!html.includes('sharp'));
  assert.ok(html.includes('class="d0 break"'));
});

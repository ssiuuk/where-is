import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as s from './phonestore.ts';

// a clock that hands out predictable ids and times
function clock(start = 0) {
  let n = start;
  return () => {
    n++;
    return { now: `2026-11-16 10:00:${String(n).padStart(2, '0')}.000Z`, id: () => `id${String(n++).padStart(13, '0')}` };
  };
}

function setup() {
  const tick = clock();
  let d = s.emptyPhoneData();
  let garage, shelf, drill;
  [d, garage] = s.addPlace(d, { name: ' Garage ', parent: '' }, tick());
  [d, shelf] = s.addPlace(d, { name: 'Shelf 3', parent: garage.id }, tick());
  [d, drill] = s.addItem(d, { name: 'Drill', place: garage.id, tags: ['Tools', 'tools', '#power'], aliases: ['driver'] }, tick());
  return { d, tick, garage, shelf, drill };
}

test('ids look like the server’s so they upload unchanged', () => {
  assert.match(s.newId(), /^[a-z0-9]{15}$/);
});

test('adding tidies names and tags and records the first move', () => {
  const { d, garage, drill } = setup();
  assert.equal(garage.name, 'Garage');
  assert.deepEqual(drill.tags, ['tools', 'power']);
  assert.equal(drill.moved_by, s.PHONE_USER);
  const h = s.history(d, drill.id);
  assert.equal(h.length, 1);
  assert.equal(h[0].to_name, 'Garage');
  assert.equal(h[0].from_place, '');
});

test('the same checks as the server', () => {
  const { d, garage, shelf } = setup();
  assert.throws(() => s.addItem(d, { name: '  ', place: '' }), /Type a name/);
  assert.throws(() => s.addItem(d, { name: 'x', place: 'nowhere' }), /doesn't exist/);
  assert.throws(() => s.addItem(d, { name: 'x', place: '', tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }), /Up to 20/);
  assert.throws(() => s.updatePlace(d, garage.id, { parent: shelf.id }), /inside it/);
  assert.throws(() => s.updatePlace(d, garage.id, { parent: garage.id }), /inside itself/);
  assert.throws(() => s.deletePlace(d, garage.id), /place\(s\) inside/);
  assert.throws(() => s.deletePlace(s.deletePlace(d, shelf.id), garage.id), /item\(s\) in it/);
});

test('moving keeps history, newest first; editing other fields does not add a move', () => {
  const { d: d0, tick, shelf, drill } = setup();
  let [d] = s.updateItem(d0, drill.id, { note: 'blue case' }, tick());
  assert.equal(s.history(d, drill.id).length, 1);
  d = s.moveItems(d, [drill.id], shelf.id, tick());
  const h = s.history(d, drill.id);
  assert.equal(h.length, 2);
  assert.equal(h[0].to_name, 'Garage › Shelf 3');
  assert.equal(h[0].from_name, 'Garage');
  assert.equal(d.items[0].place, shelf.id);
  assert.throws(() => s.moveItems(d, [drill.id, 'gone'], ''), /Nothing was moved/);
});

test('deleting an item removes its history', () => {
  const { d, drill } = setup();
  const after = s.deleteItem(d, drill.id);
  assert.equal(after.items.length, 0);
  assert.equal(after.moves.length, 0);
});

test('history per item is capped', () => {
  let { d, tick, garage, shelf, drill } = setup();
  for (let i = 0; i < 60; i++) d = s.moveItems(d, [drill.id], i % 2 ? garage.id : shelf.id, tick());
  assert.equal(d.moves.filter((m) => m.item === drill.id).length, 50);
});

test('a backup round-trips and refuses other files', () => {
  const { d, drill } = setup();
  const withPhoto = { ...d, items: d.items.map((i) => ({ ...i, photo: `${drill.id}_abc123.jpg` })) };
  const b = s.makeBackup('Home', withPhoto, { [`${drill.id}_abc123.jpg`]: 'AAAA', '../evil.jpg': 'BBBB' });
  const back = s.parseBackup(JSON.stringify(b));
  assert.equal(back.name, 'Home');
  assert.deepEqual(back.data, withPhoto);
  assert.deepEqual(Object.keys(back.photos), [`${drill.id}_abc123.jpg`]);
  assert.throws(() => s.parseBackup('{"hello":1}'), /isn't a Where Is backup/);
  assert.throws(() => s.parseBackup('not json'), /isn't a Where Is backup/);
  assert.throws(() => s.parseBackup(JSON.stringify({ ...b, version: 2 })), /newer version/);
  // a photo the file doesn't carry is dropped rather than shown broken
  const noPhotos = s.parseBackup(JSON.stringify({ ...b, photos: {} }));
  assert.equal(noPhotos.data.items[0].photo, '');
});

test('the upload carries what the server needs and nothing else', () => {
  const { d, drill } = setup();
  const body = s.uploadBody(d);
  assert.equal(body.places.length, 2);
  assert.deepEqual(Object.keys(body.items[0]).sort(), ['aliases', 'id', 'moved_at', 'name', 'note', 'place', 'tags']);
  assert.equal(body.moves[0].item, drill.id);
});

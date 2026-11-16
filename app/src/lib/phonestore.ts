// "This phone only": the household kept on the phone, with no server. These
// are the rules the server applies (server/whereis.go, server/itemnames.go),
// done here on a plain object so the phone behaves the same way. The screens
// reach it through PhoneDataProvider (phonedata.tsx), which saves the result.

import { namesProblem, tidyAliases, tidyTags } from './names.ts';
import { placeLabel, placeMap } from './places.ts';
import type { Item, Move, Place } from './types.ts';

/** The household id and the one member when there is no server. */
export const PHONE_HOUSEHOLD = 'phone';
export const PHONE_USER = 'phone';

export type PhoneData = { places: Place[]; items: Item[]; moves: Move[] };
export const emptyPhoneData = (): PhoneData => ({ places: [], items: [], moves: [] });

/** History kept per item: the screen shows the last 20. */
const MOVES_PER_ITEM = 50;

/** A new id in the server's format (15 of a-z0-9), so it can be uploaded as it is. */
export function newId(random: () => number = Math.random): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 15; i++) id += chars[Math.floor(random() * chars.length)];
  return id;
}

/** A time in the server's format, like "2026-11-16 13:29:00.123Z". */
export const stamp = (d: Date = new Date()) => d.toISOString().replace('T', ' ');

function checkText(value: string, max: number, what: string, required: boolean): string {
  const v = value.trim();
  if (required && !v) throw new Error(`Type a ${what}.`);
  if ([...v].length > max) throw new Error(`Keep the ${what} to ${max} characters or fewer.`);
  return v;
}

function checkNames(tags: readonly string[] | undefined, aliases: readonly string[] | undefined) {
  const t = tags ? tidyTags(tags) : undefined;
  const a = aliases ? tidyAliases(aliases) : undefined;
  const problem = (t && namesProblem(t, 'tag')) || (a && namesProblem(a, 'alias'));
  if (problem) throw new Error(problem);
  return { tags: t, aliases: a };
}

function checkPlaceExists(d: PhoneData, id: string) {
  if (id && !d.places.some((p) => p.id === id)) throw new Error("That place doesn't exist any more.");
}

/** Walks up from the new parent: reaching the place itself would make a loop. */
function checkParent(d: PhoneData, id: string, parent: string) {
  if (!parent) return;
  if (parent === id) throw new Error("A place can't be inside itself.");
  const map = placeMap(d.places);
  const seen = new Set<string>();
  for (let p = parent; p; p = map.get(p)?.parent ?? '') {
    if (!map.has(p)) throw new Error("That place doesn't exist any more.");
    if (p === id) throw new Error("A place can't go inside one of the places inside it.");
    if (seen.has(p)) throw new Error('Those places are already nested in a loop.');
    seen.add(p);
  }
}

function withMove(d: PhoneData, item: Item, from: string, to: string, at: string, id: string): Move[] {
  const map = placeMap(d.places);
  const move: Move = {
    id,
    item: item.id,
    from_place: from,
    to_place: to,
    from_name: from ? placeLabel(map, from) : '',
    to_name: to ? placeLabel(map, to) : '',
    by: PHONE_USER,
    created: at,
  };
  const mine = d.moves.filter((m) => m.item === item.id);
  // drop this item's oldest moves beyond the limit
  const drop = new Set(
    mine
      .sort((a, b) => b.created.localeCompare(a.created))
      .slice(MOVES_PER_ITEM - 1)
      .map((m) => m.id),
  );
  return [move, ...d.moves.filter((m) => !drop.has(m.id))];
}

export type Clock = { now: string; id: () => string };
const realClock = (): Clock => ({ now: stamp(), id: () => newId() });

export function addPlace(d: PhoneData, input: { name: string; parent: string; note?: string }, clock = realClock()): [PhoneData, Place] {
  const name = checkText(input.name, 100, 'place name', true);
  const note = checkText(input.note ?? '', 1000, 'note', false);
  checkPlaceExists(d, input.parent);
  const place: Place = { id: clock.id(), household: PHONE_HOUSEHOLD, name, note, parent: input.parent, updated: clock.now, label_at: '', nfc_at: '' };
  return [{ ...d, places: [...d.places, place] }, place];
}

export function updatePlace(
  d: PhoneData,
  id: string,
  patch: Partial<Pick<Place, 'name' | 'note' | 'parent' | 'label_at' | 'nfc_at'>>,
  clock = realClock(),
): [PhoneData, Place] {
  const old = d.places.find((p) => p.id === id);
  if (!old) throw new Error("That place doesn't exist any more.");
  const next: Place = { ...old, ...patch, updated: clock.now };
  if (patch.name !== undefined) next.name = checkText(patch.name, 100, 'place name', true);
  if (patch.note !== undefined) next.note = checkText(patch.note, 1000, 'note', false);
  if (patch.parent !== undefined) checkParent(d, id, patch.parent);
  return [{ ...d, places: d.places.map((p) => (p.id === id ? next : p)) }, next];
}

export function deletePlace(d: PhoneData, id: string): PhoneData {
  const inside = d.places.filter((p) => p.parent === id).length;
  if (inside) throw new Error(`Move or delete the ${inside} place(s) inside it first.`);
  const items = d.items.filter((i) => i.place === id).length;
  if (items) throw new Error(`Move the ${items} item(s) in it somewhere else first.`);
  return { ...d, places: d.places.filter((p) => p.id !== id) };
}

export type ItemInput = { id?: string; name: string; note?: string; tags?: string[]; aliases?: string[]; place: string; photo?: string };

export function addItem(d: PhoneData, input: ItemInput, clock = realClock()): [PhoneData, Item] {
  const name = checkText(input.name, 120, 'name', true);
  const note = checkText(input.note ?? '', 2000, 'note', false);
  const { tags = [], aliases = [] } = checkNames(input.tags ?? [], input.aliases ?? []);
  checkPlaceExists(d, input.place);
  const item: Item = {
    id: input.id || clock.id(),
    household: PHONE_HOUSEHOLD,
    name,
    note,
    tags,
    aliases,
    photo: input.photo ?? '',
    place: input.place,
    moved_by: input.place ? PHONE_USER : '',
    moved_at: input.place ? clock.now : '',
    updated: clock.now,
    collectionId: '',
  };
  const moves = input.place ? withMove(d, item, '', input.place, clock.now, clock.id()) : d.moves;
  return [{ ...d, items: [item, ...d.items], moves }, item];
}

export function updateItem(
  d: PhoneData,
  id: string,
  patch: Partial<Pick<Item, 'name' | 'note' | 'place' | 'tags' | 'aliases' | 'photo'>>,
  clock = realClock(),
): [PhoneData, Item] {
  const old = d.items.find((i) => i.id === id);
  if (!old) throw new Error('That item was deleted.');
  const next: Item = { ...old, updated: clock.now };
  if (patch.name !== undefined) next.name = checkText(patch.name, 120, 'name', true);
  if (patch.note !== undefined) next.note = checkText(patch.note, 2000, 'note', false);
  const names = checkNames(patch.tags, patch.aliases);
  if (names.tags) next.tags = names.tags;
  if (names.aliases) next.aliases = names.aliases;
  if (patch.photo !== undefined) next.photo = patch.photo;
  let moves = d.moves;
  if (patch.place !== undefined && patch.place !== old.place) {
    checkPlaceExists(d, patch.place);
    next.place = patch.place;
    next.moved_by = PHONE_USER;
    next.moved_at = clock.now;
    moves = withMove(d, next, old.place, patch.place, clock.now, clock.id());
  }
  return [{ ...d, items: [next, ...d.items.filter((i) => i.id !== id)], moves }, next];
}

/** Moves several items at once, all or nothing, like the server's bulk move. */
export function moveItems(d: PhoneData, ids: string[], place: string, clock = realClock()): PhoneData {
  checkPlaceExists(d, place);
  for (const id of ids) if (!d.items.some((i) => i.id === id)) throw new Error('One of those items was deleted. Nothing was moved.');
  let next = d;
  for (const id of new Set(ids)) [next] = updateItem(next, id, { place }, clock);
  return next;
}

export function deleteItem(d: PhoneData, id: string): PhoneData {
  return { ...d, items: d.items.filter((i) => i.id !== id), moves: d.moves.filter((m) => m.item !== id) };
}

export function history(d: PhoneData, itemId: string): Move[] {
  return d.moves
    .filter((m) => m.item === itemId)
    .sort((a, b) => b.created.localeCompare(a.created))
    .slice(0, 20);
}

/** Turns stored or restored JSON into PhoneData, dropping anything malformed. */
export function asPhoneData(v: unknown): PhoneData {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((r) => r && typeof r === 'object' && typeof r.id === 'string') : []);
  const str = (x: unknown) => (typeof x === 'string' ? x : '');
  const strs = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);
  return {
    places: list(o.places).map((p) => ({
      id: p.id, household: PHONE_HOUSEHOLD, name: str(p.name), note: str(p.note), parent: str(p.parent),
      updated: str(p.updated), label_at: str(p.label_at), nfc_at: str(p.nfc_at),
    })),
    items: list(o.items).map((i) => ({
      id: i.id, household: PHONE_HOUSEHOLD, name: str(i.name), note: str(i.note), tags: strs(i.tags), aliases: strs(i.aliases),
      photo: str(i.photo), place: str(i.place), moved_by: i.moved_at ? PHONE_USER : '', moved_at: str(i.moved_at),
      updated: str(i.updated), collectionId: '',
    })),
    moves: list(o.moves).map((m) => ({
      id: m.id, item: str(m.item), from_place: str(m.from_place), to_place: str(m.to_place),
      from_name: str(m.from_name), to_name: str(m.to_name), by: PHONE_USER, created: str(m.created),
    })),
  };
}

export const isEmpty = (d: PhoneData) => !d.places.length && !d.items.length;

// ---------------------------------------------------------------------
// backup file

export const BACKUP_KIND = 'where-is-phone-backup';

export type Backup = {
  kind: typeof BACKUP_KIND;
  version: 1;
  saved: string;
  name: string;
  data: PhoneData;
  /** photo file name to its contents, base64 */
  photos: Record<string, string>;
};

export function makeBackup(name: string, data: PhoneData, photos: Record<string, string>, now = new Date()): Backup {
  return { kind: BACKUP_KIND, version: 1, saved: stamp(now), name, data, photos };
}

/** Reads a backup file, or throws a message for the person. */
export function parseBackup(text: string): Backup {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new Error("That file isn't a Where Is backup.");
  }
  const o = v as Partial<Backup> | null;
  if (!o || o.kind !== BACKUP_KIND) throw new Error("That file isn't a Where Is backup.");
  if (o.version !== 1) throw new Error('That backup is from a newer version of the app. Update the app first.');
  const photos: Record<string, string> = {};
  for (const [k, val] of Object.entries(o.photos ?? {})) {
    // photo names are ours ("<id>.jpg"): refuse anything that could be a path
    if (typeof val === 'string' && /^[a-z0-9_]+\.(jpg|jpeg|png|webp|heic)$/.test(k)) photos[k] = val;
  }
  const data = asPhoneData(o.data);
  // a photo missing from the file is dropped rather than shown broken
  data.items = data.items.map((i) => (i.photo && !photos[i.photo] ? { ...i, photo: '' } : i));
  return { kind: BACKUP_KIND, version: 1, saved: typeof o.saved === 'string' ? o.saved : '', name: typeof o.name === 'string' ? o.name : '', data, photos };
}

// ---------------------------------------------------------------------
// moving to a server

/** What POST /api/whereis/import-phone takes: everything but the photos. */
export function uploadBody(d: PhoneData) {
  return {
    places: d.places.map(({ id, name, note, parent, label_at, nfc_at }) => ({ id, name, note, parent, label_at: label_at ?? '', nfc_at: nfc_at ?? '' })),
    items: d.items.map(({ id, name, note, tags, aliases, place, moved_at }) => ({ id, name, note, tags, aliases, place, moved_at })),
    moves: d.moves.map(({ id, item, from_place, to_place, from_name, to_name, created }) => ({ id, item, from_place, to_place, from_name, to_name, created })),
  };
}

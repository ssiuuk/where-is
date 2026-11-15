import type { Place } from './types.ts';

export type PlaceMap = Map<string, Place>;

export function placeMap(places: Place[]): PlaceMap {
  return new Map(places.map((p) => [p.id, p]));
}

/** Names from the top-level place down to this one, e.g. ["Garage", "Shelf 3"]. */
export function placePath(map: PlaceMap, id: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  let cur = map.get(id);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    names.unshift(cur.name);
    cur = cur.parent ? map.get(cur.parent) : undefined;
  }
  return names;
}

export const PATH_SEPARATOR = ' › ';

export function placeLabel(map: PlaceMap, id: string): string {
  return placePath(map, id).join(PATH_SEPARATOR);
}

/** The ids of every place inside this one, at any depth (not including itself). */
export function descendants(places: Place[], id: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const p of places) {
    if (!p.parent) continue;
    const list = children.get(p.parent) ?? [];
    list.push(p.id);
    children.set(p.parent, list);
  }
  const out = new Set<string>();
  const stack = [...(children.get(id) ?? [])];
  while (stack.length) {
    const next = stack.pop()!;
    if (out.has(next)) continue;
    out.add(next);
    stack.push(...(children.get(next) ?? []));
  }
  return out;
}

export type TreeRow = { place: Place; depth: number };

/** Places in display order: each place followed by what's inside it, alphabetical. */
export function placeTree(places: Place[]): TreeRow[] {
  const byParent = new Map<string, Place[]>();
  const ids = new Set(places.map((p) => p.id));
  for (const p of places) {
    // a place whose parent was deleted shows at the top level
    const key = p.parent && ids.has(p.parent) ? p.parent : '';
    const list = byParent.get(key) ?? [];
    list.push(p);
    byParent.set(key, list);
  }
  for (const list of byParent.values()) list.sort((a, b) => compareNames(a.name, b.name));

  const rows: TreeRow[] = [];
  const seen = new Set<string>();
  const walk = (parent: string, depth: number) => {
    for (const p of byParent.get(parent) ?? []) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      rows.push({ place: p, depth });
      walk(p.id, depth + 1);
    }
  };
  walk('', 0);
  return rows;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
export function compareNames(a: string, b: string): number {
  return collator.compare(a, b);
}

/**
 * Splits what someone typed into the place picker into nested names:
 * "Garage > Shelf 3" or "Garage / Shelf 3" → ["Garage", "Shelf 3"].
 */
export function parsePlaceInput(text: string): string[] {
  return text
    .split(/\s*(?:>|›|\/)\s*/)
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
}

/**
 * Works out which of the typed names already exist. Returns the deepest
 * existing place and the names still to create inside it, in order.
 */
export function resolvePlaceInput(
  places: Place[],
  names: string[],
  insideId = '',
): { parentId: string; toCreate: string[] } {
  let parentId = insideId;
  for (let i = 0; i < names.length; i++) {
    const match = places.find(
      (p) => (p.parent || '') === parentId && compareNames(p.name, names[i]) === 0,
    );
    if (!match) return { parentId, toCreate: names.slice(i) };
    parentId = match.id;
  }
  return { parentId, toCreate: [] };
}

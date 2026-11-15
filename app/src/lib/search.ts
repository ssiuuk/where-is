import type { Item } from './types.ts';

export function normalize(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export type SearchHit = { item: Item; score: number };

/**
 * Finds items whose name, note or place contains every word typed.
 * Name matches rank first, then words at the start of the name.
 * With an empty query, returns everything, most recently changed first.
 */
export function searchItems(items: Item[], query: string, placeText: (item: Item) => string): Item[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) {
    return [...items].sort((a, b) => (b.updated > a.updated ? 1 : b.updated < a.updated ? -1 : 0));
  }
  const hits: SearchHit[] = [];
  for (const item of items) {
    const name = normalize(item.name);
    const rest = normalize(item.note + ' ' + placeText(item));
    let score = 0;
    let ok = true;
    for (const w of words) {
      if (name.startsWith(w)) score += 4;
      else if (name.split(/\s+/).some((part) => part.startsWith(w))) score += 3;
      else if (name.includes(w)) score += 2;
      else if (rest.includes(w)) score += 1;
      else {
        ok = false;
        break;
      }
    }
    if (ok) hits.push({ item, score });
  }
  hits.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
  return hits.map((h) => h.item);
}

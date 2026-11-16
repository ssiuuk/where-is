import type { Item } from './types.ts';

export function normalize(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export type SearchHit = { item: Item; score: number };

function nameScore(name: string, w: string, start: number): number {
  if (name.startsWith(w)) return start;
  if (name.split(/\s+/).some((part) => part.startsWith(w))) return 3;
  if (name.includes(w)) return 2;
  return 0;
}

/**
 * Finds items where every word typed is in the name, another name (alias),
 * a tag, the note or the place. Name matches rank first, then aliases, then
 * tags, then notes and places. A word starting with # only matches tags.
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
    const aliases = (item.aliases ?? []).map(normalize);
    const tags = (item.tags ?? []).map(normalize);
    const rest = normalize(item.note + ' ' + placeText(item));
    let score = 0;
    let ok = true;
    for (const word of words) {
      let s = 0;
      if (word.startsWith('#')) {
        const t = word.replace(/^#+/, '');
        s = !t ? 1 : tags.includes(t) ? 2 : tags.some((x) => x.startsWith(t)) ? 1 : 0;
      } else {
        s = nameScore(name, word, 4);
        for (const a of aliases) s = Math.max(s, nameScore(a, word, 3));
        if (!s && tags.some((x) => x.startsWith(word))) s = 2;
        if (!s && (tags.some((x) => x.includes(word)) || rest.includes(word))) s = 1;
      }
      if (!s) {
        ok = false;
        break;
      }
      score += s;
    }
    if (ok) hits.push({ item, score });
  }
  hits.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
  return hits.map((h) => h.item);
}

/** Items carrying a tag; every item when no tag is chosen. */
export function withTag(items: Item[], tag: string): Item[] {
  return tag ? items.filter((i) => (i.tags ?? []).includes(tag)) : items;
}

/** The other name a search matched, to show beside the item ("also called Hoover"). */
export function matchedAlias(item: Item, query: string): string {
  const words = normalize(query).split(/\s+/).filter((w) => w && !w.startsWith('#'));
  if (!words.length) return '';
  const name = normalize(item.name);
  if (words.every((w) => name.includes(w))) return '';
  return (item.aliases ?? []).find((a) => words.some((w) => normalize(a).includes(w))) ?? '';
}

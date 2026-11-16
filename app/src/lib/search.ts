import type { Item } from './types.ts';

export function normalize(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export type SearchHit = { item: Item; score: number };

// Each kind of match scores in its own band, so any name match beats any
// alias match, which beats any tag match, which beats a note or place match.
const NAME = 10;
const ALIAS = 6;
const TAG = 3;
const OTHER = 1;

/** 0 for no match; otherwise band + 2 at the start, + 1 at a word start, + 0 inside. */
function nameScore(name: string, w: string, band: number): number {
  if (name.startsWith(w)) return band + 2;
  if (name.split(/\s+/).some((part) => part.startsWith(w))) return band + 1;
  if (name.includes(w)) return band;
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
        s = !t ? OTHER : tags.includes(t) ? TAG + 2 : tags.some((x) => x.startsWith(t)) ? TAG + 1 : 0;
      } else {
        s = nameScore(name, word, NAME);
        if (!s) s = Math.max(0, ...aliases.map((a) => nameScore(a, word, ALIAS)));
        if (!s) s = Math.max(0, ...tags.map((x) => nameScore(x, word, TAG)));
        if (!s && rest.includes(word)) s = OTHER;
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

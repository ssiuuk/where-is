import { escapeHtml } from './labels.ts';
import { placeLabel, placeMap, placeTree } from './places.ts';
import type { Item, Place } from './types.ts';

export type PrintoutOptions = {
  notes: boolean;
  /** list places with nothing directly in them too */
  emptyPlaces: boolean;
  /** start each top-level place (room) on a new page */
  pageBreaks: boolean;
};

/**
 * A printable list of where everything is: every place in tree order, with
 * its full path as a heading and the items in it underneath, then the items
 * with no place.
 */
export function inventoryHtml(title: string, places: Place[], items: Item[], opts: PrintoutOptions, printedAt = new Date()): string {
  const map = placeMap(places);
  const byPlace = new Map<string, Item[]>();
  for (const i of items) {
    const key = i.place && map.has(i.place) ? i.place : '';
    const list = byPlace.get(key) ?? [];
    list.push(i);
    byPlace.set(key, list);
  }
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  for (const list of byPlace.values()) list.sort((a, b) => collator.compare(a.name, b.name));

  const itemList = (list: Item[]) =>
    `<ul${list.length > 8 ? ' class="many"' : ''}>${list
      .map((i) => `<li><span class="name">${escapeHtml(i.name)}</span>${opts.notes && i.note ? ` <span class="note">${escapeHtml(i.note)}</span>` : ''}</li>`)
      .join('')}</ul>`;

  let body = '';
  let first = true;
  for (const { place, depth } of placeTree(places)) {
    const list = byPlace.get(place.id) ?? [];
    if (!list.length && !opts.emptyPlaces) continue;
    const brk = opts.pageBreaks && depth === 0 && !first ? ' break' : '';
    first = false;
    body += `<section class="d${Math.min(depth, 3)}${brk}"><h2>${escapeHtml(placeLabel(map, place.id))}<span class="count">${list.length || ''}</span></h2>${
      opts.notes && place.note ? `<p class="note">${escapeHtml(place.note)}</p>` : ''
    }${list.length ? itemList(list) : '<p class="empty">Nothing here</p>'}</section>`;
  }
  const loose = byPlace.get('') ?? [];
  if (loose.length) {
    body += `<section class="d0${opts.pageBreaks && !first ? ' break' : ''}"><h2>Not in a place yet<span class="count">${loose.length}</span></h2>${itemList(loose)}</section>`;
  }
  const date = printedAt.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}: where everything is</title><style>
@page { margin: 1.5cm; }
body { font-family: -apple-system, Roboto, Arial, sans-serif; color: #111; font-size: 11pt; margin: 0; }
header { border-bottom: 2px solid #111; margin-bottom: 12px; padding-bottom: 6px; }
h1 { font-size: 18pt; margin: 0; }
.meta { color: #555; font-size: 9pt; }
section { break-inside: avoid-page; margin: 10px 0 6px; }
section.break { break-before: page; page-break-before: always; }
h2 { font-size: 11pt; margin: 0 0 3px; display: flex; justify-content: space-between; gap: 8px; border-bottom: 1px solid #ccc; }
section.d0 h2 { font-size: 13pt; border-bottom-color: #111; }
.count { color: #777; font-weight: 400; font-size: 9pt; }
ul { margin: 0; padding-left: 18px; }
ul.many { columns: 2; column-gap: 24px; }
li { break-inside: avoid; margin: 1px 0; }
.note { color: #555; font-size: 9pt; }
p.note { margin: 0 0 3px; }
.empty { color: #999; font-size: 9pt; margin: 0; }
</style></head><body><header><h1>${escapeHtml(title)}: where everything is</h1><div class="meta">${items.length} items in ${places.length} places · printed ${escapeHtml(date)}</div></header>${body}</body></html>`;
}

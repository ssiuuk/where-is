// Tags group items ("tools", "christmas"); aliases are other names the family
// uses for the same thing ("hoover" for the vacuum). The server applies the
// same clean-up and limits (server/itemnames.go).

export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 40;
export const MAX_ALIASES = 20;
export const MAX_ALIAS_LENGTH = 120;

/** Cleans a list: trims and collapses spaces, drops empties and repeats (ignoring case). */
export function tidyNames(list: readonly string[], lower = false): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    let s = raw.split(/\s+/).filter(Boolean).join(' ');
    if (lower) s = s.toLowerCase();
    const key = s.toLowerCase();
    if (!s || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

export const tidyTags = (list: readonly string[]) => tidyNames(list.map((t) => t.replace(/^#+/, '')), true);
export const tidyAliases = (list: readonly string[]) => tidyNames(list);

/** Splits typed text on commas into entries (a half-typed entry counts too). */
export function splitNames(text: string): string[] {
  return text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
}

/** Why a list can't be saved, or "" when it's fine. */
export function namesProblem(list: readonly string[], kind: 'tag' | 'alias'): string {
  const [max, maxLen] = kind === 'tag' ? [MAX_TAGS, MAX_TAG_LENGTH] : [MAX_ALIASES, MAX_ALIAS_LENGTH];
  const noun = kind === 'tag' ? 'tags' : 'other names';
  if (list.length > max) return `Up to ${max} ${noun} per item.`;
  const long = list.find((s) => [...s].length > maxLen);
  if (long) return `“${long.slice(0, 20)}…” is too long. Keep ${noun} to ${maxLen} characters.`;
  return '';
}

/** Turns whatever the server or an old offline copy holds into a list of strings. */
export function asNames(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
}

/** Every tag in use, most used first, then A to Z. */
export function tagCounts(items: readonly { tags: readonly string[] }[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const i of items) for (const t of i.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Tags worth offering while someone types: in use, not chosen yet, matching the typed start. */
export function suggestTags(all: readonly string[], chosen: readonly string[], typed: string, max = 8): string[] {
  const t = typed.trim().replace(/^#+/, '').toLowerCase();
  const taken = new Set(chosen);
  const starts = all.filter((x) => !taken.has(x) && x.startsWith(t));
  const within = t ? all.filter((x) => !taken.has(x) && !x.startsWith(t) && x.includes(t)) : [];
  return [...starts, ...within].slice(0, max);
}

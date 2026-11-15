export type TagTarget = { kind: 'p' | 'i'; id: string };

const ID = /^[a-z0-9]{15}$/;

/**
 * Reads what a QR code or NFC sticker points at. Accepts
 * https://<server>/p/<id>, whereis://p/<id>, and the same for /i/ (items).
 */
export function parseTagUrl(text: string): TagTarget | null {
  const m = text.trim().match(/^(?:https?:\/\/[^/\s]+\/|whereis:\/\/\/?)(p|i)\/([a-z0-9]+)\/?(?:[?#].*)?$/);
  if (!m || !ID.test(m[2])) return null;
  return { kind: m[1] as 'p' | 'i', id: m[2] };
}

export function tagUrl(serverUrl: string, kind: 'p' | 'i', id: string): string {
  return `${serverUrl.replace(/\/+$/, '')}/${kind}/${id}`;
}

/**
 * Tidies a server address typed by hand: adds https:// when no scheme is
 * given and drops trailing slashes. Returns "" for something unusable.
 */
export function normalizeServerUrl(input: string): string {
  let s = input.trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    if (!u.hostname) return '';
    return (u.protocol + '//' + u.host + u.pathname).replace(/\/+$/, '');
  } catch {
    return '';
  }
}

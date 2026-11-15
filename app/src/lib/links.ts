export type TagTarget = { kind: 'p' | 'i'; id: string };

const ID = /^[a-z0-9]{15}$/;

/**
 * Reads what a QR code or NFC sticker points at: `whereis://p/<id>`, or a
 * web link on this server, `<serverUrl>/p/<id>` (and the same with /i/ for
 * items). Web links to any other server are refused, since their ids mean
 * nothing here. The scheme may differ (http or https: a label printed while
 * testing over plain http still works), but host, port and path must match.
 */
export function parseTagUrl(text: string, serverUrl: string): TagTarget | null {
  const t = text.trim();
  const app = t.match(/^whereis:\/\/\/?(p|i)\/([a-z0-9]+)\/?(?:[?#].*)?$/);
  if (app) return target(app[1], app[2]);

  let url: URL;
  let base: URL;
  try {
    url = new URL(t);
    base = new URL(serverUrl);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
  if (url.host.toLowerCase() !== base.host.toLowerCase()) return null;
  const prefix = base.pathname.replace(/\/+$/, '');
  if (!url.pathname.startsWith(prefix + '/')) return null;
  const m = url.pathname.slice(prefix.length).match(/^\/(p|i)\/([a-z0-9]+)\/?$/);
  return m ? target(m[1], m[2]) : null;
}

function target(kind: string, id: string): TagTarget | null {
  return ID.test(id) ? { kind: kind as 'p' | 'i', id } : null;
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

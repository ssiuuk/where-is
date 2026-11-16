import QRCode from 'qrcode';

/** A QR code as an SVG string, one path, black on white. */
export function qrSvg(text: string, size = 160): string {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = modules.size;
  const quiet = 2;
  let d = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (modules.get(y, x)) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }
  }
  const box = n + quiet * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${box} ${box}" shape-rendering="crispEdges"><rect width="${box}" height="${box}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

export type LabelInput = { url: string; name: string; path: string };

/** A printable page of labels: a grid that flows onto as many sheets as needed. */
export function labelSheetHtml(labels: LabelInput[], size: 'small' | 'large' = 'small'): string {
  const qr = size === 'large' ? 170 : 110;
  const width = size === 'large' ? '6.2cm' : '4.4cm';
  const cells = labels
    .map(
      (l) => `<div class="label">${qrSvg(l.url, qr)}<div class="tape">${escapeHtml(l.name)}</div>${
        l.path ? `<div class="path">${escapeHtml(l.path)}</div>` : ''
      }</div>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Where Is labels</title><style>
@page { margin: 1cm; }
body { font-family: -apple-system, Roboto, Arial, sans-serif; margin: 0; }
.sheet { display: flex; flex-wrap: wrap; gap: 0.3cm; }
.label { width: ${width}; box-sizing: border-box; border: 1px dashed #bbb; padding: 0.25cm; display: flex; flex-direction: column; align-items: center; gap: 4px; break-inside: avoid; page-break-inside: avoid; }
.tape { background: #F6D64A; color: #1D1A0E; font-family: monospace; font-weight: 700; text-transform: uppercase; padding: 2px 6px; font-size: 12px; text-align: center; max-width: 100%; overflow-wrap: anywhere; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.path { color: #444; font-size: 10px; text-align: center; overflow-wrap: anywhere; }
</style></head><body><div class="sheet">${cells}</div></body></html>`;
}

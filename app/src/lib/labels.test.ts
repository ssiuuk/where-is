import assert from 'node:assert/strict';
import { test } from 'node:test';

import QRCode from 'qrcode';

import { escapeHtml, labelSheetHtml, qrSvg, QUIET_ZONE } from './labels.ts';

test('qr code is an svg with a path', () => {
  const svg = qrSvg('https://whereis.example.com/p/abcdefghijklmno');
  assert.match(svg, /^<svg [^>]*viewBox="0 0 \d+ \d+"/);
  assert.match(svg, /<path d="M/);
});

test('label sheet escapes names', () => {
  const html = labelSheetHtml([{ url: 'https://x/p/1', name: '<Box> & "tools"', path: 'Garage' }]);
  assert.ok(html.includes('&lt;Box&gt; &amp; &quot;tools&quot;'));
  assert.ok(!html.includes('<Box>'));
  assert.equal(escapeHtml("it's"), 'it&#39;s');
});

test('qr code keeps a quiet zone of at least 4 modules', () => {
  const text = 'https://whereis.example.com/p/abcdefghijklmno';
  const n = QRCode.create(text, { errorCorrectionLevel: 'M' }).modules.size;
  const svg = qrSvg(text);
  assert.ok(QUIET_ZONE >= 4);
  assert.match(svg, new RegExp(`viewBox="0 0 ${n + 2 * QUIET_ZONE} ${n + 2 * QUIET_ZONE}"`));
  // every dark module sits inside the margin
  const cells = [...svg.matchAll(/M(\d+) (\d+)h1/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.ok(cells.length > 0);
  for (const [x, y] of cells) {
    assert.ok(x >= QUIET_ZONE && y >= QUIET_ZONE && x < n + QUIET_ZONE && y < n + QUIET_ZONE, `module at ${x},${y} is in the quiet zone`);
  }
});

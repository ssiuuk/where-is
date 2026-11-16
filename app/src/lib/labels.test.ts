import assert from 'node:assert/strict';
import { test } from 'node:test';

import { escapeHtml, labelSheetHtml, qrSvg } from './labels.ts';

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

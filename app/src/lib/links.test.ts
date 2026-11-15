import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeServerUrl, parseTagUrl, tagUrl } from './links.ts';

const id = 'abcdefghij12345';

test('parses label links', () => {
  assert.deepEqual(parseTagUrl(`https://whereis.example.com/p/${id}`), { kind: 'p', id });
  assert.deepEqual(parseTagUrl(`https://whereis.example.com:8443/i/${id}/`), { kind: 'i', id });
  assert.deepEqual(parseTagUrl(`whereis://p/${id}`), { kind: 'p', id });
  assert.deepEqual(parseTagUrl(`whereis:///p/${id}?x=1`), { kind: 'p', id });
});

test('rejects other text', () => {
  assert.equal(parseTagUrl('hello'), null);
  assert.equal(parseTagUrl(`https://example.com/x/${id}`), null);
  assert.equal(parseTagUrl('https://example.com/p/short'), null);
  assert.equal(parseTagUrl(`https://example.com/p/${id}/more`), null);
});

test('builds label links', () => {
  assert.equal(tagUrl('https://whereis.example.com/', 'p', id), `https://whereis.example.com/p/${id}`);
});

test('tidies server addresses', () => {
  assert.equal(normalizeServerUrl(' whereis.example.com/ '), 'https://whereis.example.com');
  assert.equal(normalizeServerUrl('http://192.168.1.10:8090'), 'http://192.168.1.10:8090');
  assert.equal(normalizeServerUrl(''), '');
  assert.equal(normalizeServerUrl('https://'), '');
});

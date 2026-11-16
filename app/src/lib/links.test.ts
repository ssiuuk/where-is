import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeServerUrl, parseTagUrl, tagUrl } from './links.ts';

const id = 'abcdefghij12345';

const server = 'https://whereis.example.com';

test('parses labels from this server', () => {
  assert.deepEqual(parseTagUrl(`https://whereis.example.com/p/${id}`, server), { kind: 'p', id });
  assert.deepEqual(parseTagUrl(` https://WhereIs.Example.com/i/${id}/ `, server), { kind: 'i', id });
  assert.deepEqual(parseTagUrl(`https://whereis.example.com/p/${id}?utm=x#top`, server), { kind: 'p', id });
  assert.deepEqual(parseTagUrl(`https://whereis.example.com/p/${id}`, server + '/'), { kind: 'p', id });
});

test('app links work whatever the server', () => {
  assert.deepEqual(parseTagUrl(`whereis://p/${id}`, server), { kind: 'p', id });
  assert.deepEqual(parseTagUrl(`whereis:///p/${id}?x=1`, server), { kind: 'p', id });
});

test('http and https labels of the same server both work', () => {
  assert.deepEqual(parseTagUrl(`http://whereis.example.com/p/${id}`, server), { kind: 'p', id });
  assert.deepEqual(parseTagUrl(`https://10.0.0.5:8090/p/${id}`, 'http://10.0.0.5:8090'), { kind: 'p', id });
});

test('refuses labels from other servers', () => {
  assert.equal(parseTagUrl(`https://another-server.example.com/i/${id}`, server), null);
  assert.equal(parseTagUrl(`https://whereis.example.com.evil.test/p/${id}`, server), null);
  assert.equal(parseTagUrl(`https://whereis.example.com:8443/p/${id}`, server), null);
  assert.equal(parseTagUrl(`https://user@whereis.example.com/p/${id}`, server), null);
  assert.equal(parseTagUrl(`ftp://whereis.example.com/p/${id}`, server), null);
});

test('servers under a path', () => {
  const sub = 'https://home.example.com/whereis';
  assert.deepEqual(parseTagUrl(`https://home.example.com/whereis/p/${id}`, sub), { kind: 'p', id });
  assert.equal(parseTagUrl(`https://home.example.com/p/${id}`, sub), null);
  assert.equal(parseTagUrl(`https://home.example.com/whereisnt/p/${id}`, sub), null);
});

test('rejects other text', () => {
  assert.equal(parseTagUrl('hello', server), null);
  assert.equal(parseTagUrl(`https://whereis.example.com/x/${id}`, server), null);
  assert.equal(parseTagUrl('https://whereis.example.com/p/short', server), null);
  assert.equal(parseTagUrl(`https://whereis.example.com/p/${id}/more`, server), null);
  assert.equal(parseTagUrl(`https://whereis.example.com/p/${id}`, 'not a url'), null);
});

test('builds label links', () => {
  assert.equal(tagUrl('https://whereis.example.com/', 'p', id), `https://whereis.example.com/p/${id}`);
});

test('labels made with no server use the app link, which still reads after moving to a server', () => {
  assert.equal(tagUrl('', 'p', id), `whereis://p/${id}`);
  assert.deepEqual(parseTagUrl(tagUrl('', 'i', id), ''), { kind: 'i', id });
  assert.deepEqual(parseTagUrl(tagUrl('', 'p', id), 'https://whereis.example.com'), { kind: 'p', id });
});

test('tidies server addresses', () => {
  assert.equal(normalizeServerUrl(' whereis.example.com/ '), 'https://whereis.example.com');
  assert.equal(normalizeServerUrl('http://192.168.1.10:8090'), 'http://192.168.1.10:8090');
  assert.equal(normalizeServerUrl(''), '');
  assert.equal(normalizeServerUrl('https://'), '');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asNames, namesProblem, splitNames, suggestTags, tagCounts, tidyAliases, tidyTags } from './names.ts';

test('tags are tidied to lower case without repeats', () => {
  assert.deepEqual(tidyTags([' Tools', 'tools', '#DIY', '', 'power   tools']), ['tools', 'diy', 'power tools']);
});

test('aliases keep their case but drop repeats', () => {
  assert.deepEqual(tidyAliases(['Hoover', 'hoover ', ' Vacuum  cleaner']), ['Hoover', 'Vacuum cleaner']);
});

test('typed text splits on commas', () => {
  assert.deepEqual(splitNames('tools, garden,, '), ['tools', 'garden']);
});

test('limits match the server', () => {
  assert.equal(namesProblem(['a'.repeat(40)], 'tag'), '');
  assert.match(namesProblem(['a'.repeat(41)], 'tag'), /too long/);
  assert.match(namesProblem(Array.from({ length: 21 }, (_, i) => `n${i}`), 'alias'), /Up to 20/);
});

test('old offline copies without tags read as empty lists', () => {
  assert.deepEqual(asNames(undefined), []);
  assert.deepEqual(asNames(''), []);
  assert.deepEqual(asNames(['a', 2, 'b']), ['a', 'b']);
});

test('tags are counted and suggested', () => {
  const counts = tagCounts([{ tags: ['tools', 'garden'] }, { tags: ['tools'] }, { tags: ['christmas'] }]);
  assert.deepEqual(counts.map((c) => c.tag), ['tools', 'christmas', 'garden']);
  const all = counts.map((c) => c.tag);
  assert.deepEqual(suggestTags(all, ['tools'], ''), ['christmas', 'garden']);
  assert.deepEqual(suggestTags(all, [], 'GAR'), ['garden']);
  assert.deepEqual(suggestTags(all, [], 'ist'), ['christmas']);
});

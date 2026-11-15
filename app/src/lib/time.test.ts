import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timeAgo } from './time.ts';

const now = new Date('2026-11-15T12:00:00Z');
test('relative times', () => {
  assert.equal(timeAgo('2026-11-15 11:59:30.000Z', now), 'just now');
  assert.equal(timeAgo('2026-11-15 11:55:00.000Z', now), '5 min ago');
  assert.equal(timeAgo('2026-11-15 09:00:00.000Z', now), '3 h ago');
  assert.equal(timeAgo('2026-11-14 10:00:00.000Z', now), 'yesterday');
  assert.equal(timeAgo('2026-11-10 10:00:00.000Z', now), '5 days ago');
  assert.equal(timeAgo('', now), '');
});

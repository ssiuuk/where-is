import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncStatusText } from './sync.ts';

const now = new Date('2026-11-16T12:00:00Z');
const savedAt = '2026-11-16T11:55:00.000Z';

test('says it is syncing while a sync runs', () => {
  assert.equal(syncStatusText({ syncing: true, status: 'offline', savedAt }, now), 'Syncing with the server…');
});

test('online shows when the last full sync was', () => {
  const t = syncStatusText({ syncing: false, status: 'live', savedAt }, now);
  assert.match(t, /^Connected to the server\. Last full sync 5 min ago \(.+\)\.$/);
});

test('offline points at the saved copy', () => {
  assert.match(syncStatusText({ syncing: false, status: 'offline', savedAt }, now), /^Can't reach the server\. This device is showing its saved copy from 5 min ago/);
  assert.equal(syncStatusText({ syncing: false, status: 'offline', savedAt: '' }, now), "Can't reach the server, and this device has no saved copy yet.");
});

test('still loading', () => {
  assert.equal(syncStatusText({ syncing: false, status: 'loading', savedAt: '' }, now), 'Checking the server…');
});

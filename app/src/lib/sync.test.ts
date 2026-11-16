import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latestOnly, syncStatusText } from './sync.ts';

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

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('an older fetch that finishes last cannot overwrite a newer one', async () => {
  const gate = latestOnly();
  const shown: string[] = [];
  const a = deferred<string>();
  const b = deferred<string>();
  const pa = gate.run(() => a.promise, (v) => void shown.push(v));
  const pb = gate.run(() => b.promise, (v) => void shown.push(v));
  b.resolve('new');
  assert.equal(await pb, true);
  a.resolve('old');
  assert.equal(await pa, false);
  assert.deepEqual(shown, ['new']);
  await gate.settle(pa); // the manual sync that started A succeeds through B
});

test('a manual sync fails if the newer fetch that replaced it failed', async () => {
  const gate = latestOnly();
  const shown: string[] = [];
  const errors: unknown[] = [];
  const a = deferred<string>();
  const b = deferred<string>();
  const manual = gate.run(() => a.promise, (v) => void shown.push(v), (e) => errors.push(e));
  gate.run(() => b.promise, (v) => void shown.push(v), (e) => errors.push(e));
  b.reject(new Error('offline'));
  a.resolve('fresh');
  await assert.rejects(gate.settle(manual), /offline/);
  assert.deepEqual(shown, []); // the offline copy stays
  assert.equal(errors.length, 1); // only the newest fetch marks the app offline
});

test('server unavailable keeps what is shown and reports the error', async () => {
  const gate = latestOnly();
  let applied = false;
  const p = gate.run(() => Promise.reject(Object.assign(new Error("can't reach"), { status: 0 })), () => void (applied = true));
  await assert.rejects(gate.settle(p), /can't reach/);
  assert.equal(applied, false);
});

test('a failure while applying the data fails the sync', async () => {
  const gate = latestOnly();
  const p = gate.run(() => Promise.resolve('x'), async () => {
    throw new Error('disk full');
  });
  await assert.rejects(gate.settle(p), /disk full/);
});

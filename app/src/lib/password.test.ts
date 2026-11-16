import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changePasswordAndSignIn, PasswordChangedError } from './password.ts';

function steps(opts: { updateFails?: boolean; signInFails?: boolean }) {
  const log: string[] = [];
  return {
    log,
    update: async () => {
      log.push('update');
      if (opts.updateFails) throw Object.assign(new Error('bad'), { status: 400 });
    },
    signIn: async () => {
      log.push('signIn');
      if (opts.signInFails) throw new Error('network');
    },
    signOut: () => log.push('signOut'),
  };
}

test('changes the password and signs back in', async () => {
  const s = steps({});
  await changePasswordAndSignIn(s);
  assert.deepEqual(s.log, ['update', 'signIn']);
});

test('a failed update changes nothing and passes its error on', async () => {
  const s = steps({ updateFails: true });
  await assert.rejects(changePasswordAndSignIn(s), (e: Error & { status?: number }) => e.status === 400 && !(e instanceof PasswordChangedError));
  assert.deepEqual(s.log, ['update']);
});

test('changed but not signed back in: signs out and says the password changed', async () => {
  const s = steps({ signInFails: true });
  await assert.rejects(changePasswordAndSignIn(s), PasswordChangedError);
  assert.deepEqual(s.log, ['update', 'signIn', 'signOut']);
});

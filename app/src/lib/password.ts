/** The new password was saved, but signing back in with it failed. */
export class PasswordChangedError extends Error {
  constructor() {
    super('Your password was changed, but signing back in failed. Sign in with your new password.');
    this.name = 'PasswordChangedError';
  }
}

export type PasswordSteps = {
  /** Saves the new password. Fails when the current one is wrong. */
  update(): Promise<void>;
  /** Signs back in with the new password (the change signs out every device). */
  signIn(): Promise<void>;
  /** Clears this device's sign-in. */
  signOut(): void;
};

/**
 * Changes the password and signs straight back in. Three outcomes:
 * - the update fails: its error is thrown and nothing changed;
 * - both succeed: resolves;
 * - the update succeeds but signing in fails: this device is signed out
 *   and a PasswordChangedError is thrown, so the person knows the new
 *   password is already in place.
 */
export async function changePasswordAndSignIn(steps: PasswordSteps): Promise<void> {
  await steps.update();
  try {
    await steps.signIn();
  } catch {
    steps.signOut();
    throw new PasswordChangedError();
  }
}

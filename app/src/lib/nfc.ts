import NfcManager, { Ndef, NfcTech } from 'react-native-nfc-manager';
import { Platform } from 'react-native';

let started: Promise<boolean> | null = null;

/** True when this phone has NFC (it may still be switched off). */
export function nfcSupported(): Promise<boolean> {
  if (!started) {
    started = NfcManager.isSupported()
      .then(async (ok) => {
        if (ok) await NfcManager.start();
        return ok;
      })
      .catch(() => false);
  }
  return started;
}

export async function nfcEnabled(): Promise<boolean> {
  try {
    return await NfcManager.isEnabled();
  } catch {
    return false;
  }
}

export function openNfcSettings() {
  NfcManager.goToNfcSetting().catch(() => {});
}

/**
 * Waits for a sticker and writes the link to it. On Android the sticker also
 * gets an Android Application Record, so tapping it opens Where Is even when
 * the link would otherwise go to the browser.
 */
export async function writeTag(url: string): Promise<void> {
  if (!(await nfcSupported())) throw new Error("This phone doesn't have NFC.");
  try {
    await NfcManager.requestTechnology(NfcTech.Ndef, { alertMessage: 'Hold your phone near the sticker' });
    const records = [Ndef.uriRecord(url)];
    if (Platform.OS === 'android') records.push(Ndef.androidApplicationRecord('com.ssiuuk.whereis'));
    const bytes = Ndef.encodeMessage(records);
    if (!bytes) throw new Error("Couldn't prepare the sticker data.");
    await NfcManager.ndefHandler.writeNdefMessage(bytes);
  } finally {
    await NfcManager.cancelTechnologyRequest().catch(() => {});
  }
}

/** Stops waiting for a sticker (used when the person cancels). */
export function cancelNfc() {
  NfcManager.cancelTechnologyRequest().catch(() => {});
}

/** Waits for a sticker and returns the first link on it, or "" if it has none. */
export async function readTag(): Promise<string> {
  if (!(await nfcSupported())) throw new Error("This phone doesn't have NFC.");
  try {
    await NfcManager.requestTechnology(NfcTech.Ndef, { alertMessage: 'Hold your phone near the sticker' });
    const tag = await NfcManager.getTag();
    for (const record of tag?.ndefMessage ?? []) {
      try {
        const text = Ndef.uri.decodePayload(Uint8Array.from(record.payload));
        if (text) return text;
      } catch {
        // not a link record
      }
    }
    return '';
  } finally {
    await NfcManager.cancelTechnologyRequest().catch(() => {});
  }
}

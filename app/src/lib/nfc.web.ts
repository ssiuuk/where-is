// Browsers can't read or write NFC stickers, so the web app reports no NFC.
export const nfcSupported = async () => false;
export const nfcEnabled = async () => false;
export function openNfcSettings() {}
export async function writeTag(_url: string): Promise<void> {
  throw new Error('NFC stickers can only be written from the phone app.');
}
export function cancelNfc() {}
export async function readTag(): Promise<string> {
  throw new Error('NFC stickers can only be read from the phone app.');
}

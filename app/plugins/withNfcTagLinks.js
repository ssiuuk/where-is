// Lets a tap on a Where Is NFC sticker open the app, whatever server the
// household uses. The stickers hold https://<server>/p/<id> (or /i/<id>),
// or whereis://p/<id> when there is no server, plus an Android Application
// Record, and React Native passes the link to the
// router like any other deep link.
const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

function ndefFilter(pathPrefix) {
  return {
    action: [{ $: { 'android:name': 'android.nfc.action.NDEF_DISCOVERED' } }],
    category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
    data: [{ $: { 'android:scheme': 'https', 'android:host': '*', 'android:pathPrefix': pathPrefix } }],
  };
}

module.exports = function withNfcTagLinks(config) {
  return withAndroidManifest(config, (cfg) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(cfg.modResults);
    activity['intent-filter'] = activity['intent-filter'] || [];
    const has = (prefix) =>
      activity['intent-filter'].some((f) =>
        (f.data || []).some((d) => d.$['android:pathPrefix'] === prefix && d.$['android:host'] === '*'),
      );
    for (const prefix of ['/p/', '/i/']) {
      if (!has(prefix)) activity['intent-filter'].push(ndefFilter(prefix));
    }
    // stickers written with no server (this phone only) hold whereis://p/<id>
    const hasApp = activity['intent-filter'].some(
      (f) =>
        (f.action || []).some((x) => x.$['android:name'] === 'android.nfc.action.NDEF_DISCOVERED') &&
        (f.data || []).some((d) => d.$['android:scheme'] === 'whereis'),
    );
    if (!hasApp) {
      activity['intent-filter'].push({
        action: [{ $: { 'android:name': 'android.nfc.action.NDEF_DISCOVERED' } }],
        category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
        data: [{ $: { 'android:scheme': 'whereis' } }],
      });
    }
    return cfg;
  });
};

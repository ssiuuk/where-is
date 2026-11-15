import { Platform, Text, View } from 'react-native';

import { space, useColors, radius } from './theme';
import { Button } from './ui';

/**
 * In a phone browser on Android, offers to open this place or item in the
 * installed app (labels scanned with the phone's own camera land here).
 */
export function OpenInApp({ kind, id }: { kind: 'p' | 'i'; id: string }) {
  const c = useColors();
  if (Platform.OS !== 'web' || typeof navigator === 'undefined' || !/Android/i.test(navigator.userAgent)) return null;
  const open = () => {
    window.location.href = `intent://${kind}/${id}#Intent;scheme=whereis;package=com.ssiuuk.whereis;end`;
  };
  return (
    <View style={{ backgroundColor: c.accentSoft, borderRadius: radius.md, padding: space.md, gap: space.sm }}>
      <Text style={{ color: c.text }}>Have the Where Is app? Open this there to use NFC and the scanner.</Text>
      <Button kind="secondary" icon="open-in-app" title="Open in the app" onPress={open} />
    </View>
  );
}

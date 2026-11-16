import * as Sharing from 'expo-sharing';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ComponentRef, useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, Share, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { captureRef } from 'react-native-view-shot';

import { font, radius, space, useColors } from '@/components/theme';
import { Body, Button, Empty, ErrorText, Heading, Notice } from '@/components/ui';
import { useData } from '@/lib/data';
import { tagUrl } from '@/lib/links';
import { cancelNfc, nfcEnabled, nfcSupported, openNfcSettings, writeTag } from '@/lib/nfc';
import { useSession } from '@/lib/session';

export default function Label() {
  const c = useColors();
  const { kind, id } = useLocalSearchParams<{ kind: 'p' | 'i'; id: string }>();
  const { serverUrl } = useSession();
  const data = useData();
  const labelRef = useRef<ComponentRef<typeof View>>(null);
  const [nfc, setNfc] = useState<'none' | 'off' | 'ready' | 'writing' | 'done'>('none');
  const [error, setError] = useState('');

  useEffect(() => {
    nfcSupported().then(async (ok) => setNfc(!ok ? 'none' : (await nfcEnabled()) ? 'ready' : 'off'));
    return cancelNfc;
  }, []);

  const place = kind === 'p' ? data.places.find((p) => p.id === id) : undefined;
  const item = kind === 'i' ? data.items.find((i) => i.id === id) : undefined;
  const name = place?.name ?? item?.name;
  if (!name || !id || (kind !== 'p' && kind !== 'i')) {
    return <Empty icon="tag-off-outline" title="Nothing to label" />;
  }
  const url = tagUrl(serverUrl, kind, id);
  const path = place ? data.label(place.parent) : data.label(item?.place ?? '');

  const shareImage = async () => {
    setError('');
    try {
      if (Platform.OS === 'web') {
        // browsers download the image instead of opening a share sheet
        const dataUri = await captureRef(labelRef, { format: 'png', quality: 1, result: 'data-uri' });
        const a = document.createElement('a');
        a.href = dataUri;
        a.download = `where-is-${name.replace(/[^\w-]+/g, '-').toLowerCase()}.png`;
        a.click();
      } else {
        const uri = await captureRef(labelRef, { format: 'png', quality: 1, result: 'tmpfile' });
        await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: `Label for ${name}` });
      }
      if (place) data.markLabeled([place.id], 'label');
    } catch (e) {
      setError(`Couldn't make the image: ${(e as Error).message}`);
    }
  };

  const write = async () => {
    setNfc('writing');
    setError('');
    try {
      await writeTag(url);
      setNfc('done');
      if (place) data.markLabeled([place.id], 'nfc');
    } catch (e) {
      const msg = (e as Error)?.message ?? '';
      setNfc('ready');
      if (!/cancel/i.test(msg)) setError(msg || "Couldn't write the sticker. Hold the phone still against it and try again.");
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
      <Stack.Screen options={{ title: `Label: ${name}` }} />
      <View style={{ alignItems: 'center' }}>
        {/* the part saved as an image: white background so it prints anywhere */}
        <View
          ref={labelRef}
          collapsable={false}
          style={{ backgroundColor: '#fff', padding: 20, borderRadius: radius.md, alignItems: 'center', gap: 10, width: 260 }}
        >
          <QRCode value={url} size={200} backgroundColor="#fff" color="#000" ecl="M" />
          <View style={{ backgroundColor: '#F6D64A', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 3, maxWidth: 220 }}>
            <Text style={{ fontFamily: 'monospace', fontWeight: '700', fontSize: 16, color: '#1D1A0E', textTransform: 'uppercase', textAlign: 'center' }}>
              {name}
            </Text>
          </View>
          {path ? <Text style={{ color: '#444', fontSize: 12, textAlign: 'center' }}>{path}</Text> : null}
        </View>
      </View>

      <Heading>QR label</Heading>
      <Body muted>Save or send the image to print it, then stick it on the {kind === 'p' ? 'shelf, drawer or box' : 'item'}.</Body>
      <Button
        icon={Platform.OS === 'web' ? 'download-outline' : 'share-variant-outline'}
        title={Platform.OS === 'web' ? 'Download label image' : 'Save or share label image'}
        onPress={shareImage}
      />

      <Heading>NFC sticker</Heading>
      {nfc === 'none' ? (
        <Body muted>
          {Platform.OS === 'web'
            ? 'Write NFC stickers from the phone app.'
            : "This phone doesn't have NFC. Use the QR label instead."}
        </Body>
      ) : nfc === 'off' ? (
        <Button kind="secondary" icon="nfc-search-variant" title="Turn on NFC" onPress={openNfcSettings} />
      ) : (
        <>
          <Body muted>Use a blank NTAG213/215/216 sticker. Tapping it later opens this {kind === 'p' ? 'place' : 'item'}.</Body>
          {nfc === 'done' ? <Notice icon="check-circle-outline">Sticker written. Try tapping it.</Notice> : null}
          <Button
            kind="secondary"
            icon="nfc-variant"
            title={nfc === 'writing' ? 'Hold the phone against the sticker…' : nfc === 'done' ? 'Write another sticker' : 'Write NFC sticker'}
            busy={nfc === 'writing'}
            onPress={write}
          />
          {nfc === 'writing' ? <Button kind="plain" title="Cancel" onPress={cancelNfc} /> : null}
        </>
      )}
      <ErrorText>{error}</ErrorText>

      <Heading>Link</Heading>
      <Text selectable style={{ color: c.muted, fontSize: font.small }}>{url}</Text>
      {Platform.OS !== 'web' ? <Button kind="plain" title="Share link" onPress={() => Share.share({ message: url })} /> : null}
    </ScrollView>
  );
}

import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Text, View } from 'react-native';

import { font, radius, space, useColors } from '@/components/theme';
import { Body, Button, ErrorText, Notice } from '@/components/ui';
import { errorMessage } from '@/lib/client';
import { useData } from '@/lib/data';
import { useMember } from '@/lib/session';
import { parseTagUrl, TagTarget } from '@/lib/links';
import { cancelNfc, nfcEnabled, nfcSupported, openNfcSettings, readTag } from '@/lib/nfc';

/**
 * Scan a label with the camera or an NFC sticker.
 * A place opens that place; an item is "picked up", and the next place
 * scanned is where it's recorded as put.
 */
export default function Scan() {
  const c = useColors();
  const data = useData();
  const { pb } = useMember();
  const [perm, requestPerm] = useCameraPermissions();
  const [focused, setFocused] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [nfc, setNfc] = useState<'none' | 'off' | 'ready' | 'reading'>('none');
  const handling = useRef(false);
  const carrying = data.items.find((i) => i.id === data.carrying);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => {
        setFocused(false);
        cancelNfc();
      };
    }, []),
  );

  useEffect(() => {
    nfcSupported().then(async (ok) => setNfc(!ok ? 'none' : (await nfcEnabled()) ? 'ready' : 'off'));
  }, []);

  const handle = useCallback(
    async (target: TagTarget | null) => {
      setError('');
      if (!target) {
        setError("That isn't a label from your Where Is server.");
        return;
      }
      if (target.kind === 'i') {
        const item = data.items.find((i) => i.id === target.id);
        if (!item) {
          setError('That label is for an item that isn’t in your household.');
          return;
        }
        data.setCarrying(item.id);
        setMessage(`Picked up ${item.name}. Now scan where you're putting it.`);
        return;
      }
      const place = data.places.find((p) => p.id === target.id);
      if (!place) {
        setError('That label is for a place that isn’t in your household.');
        return;
      }
      if (carrying) {
        try {
          await data.moveItems([carrying.id], place.id);
          data.setCarrying('');
          setMessage(`${carrying.name} is now in ${data.label(place.id)}.`);
        } catch (e) {
          setError(errorMessage(e));
        }
        return;
      }
      router.replace(`/p/${place.id}`);
    },
    [data, carrying],
  );

  const onCode = async (text: string) => {
    if (handling.current) return;
    handling.current = true;
    try {
      await handle(parseTagUrl(text, pb.baseURL));
    } finally {
      // ignore the same code for a moment so one scan isn't read twice
      setTimeout(() => (handling.current = false), 1500);
    }
  };

  const readNfc = async () => {
    setNfc('reading');
    setError('');
    try {
      const url = await readTag();
      await handle(url ? parseTagUrl(url, pb.baseURL) : null);
    } catch (e) {
      const msg = (e as Error)?.message ?? '';
      if (!/cancel/i.test(msg)) setError(msg ? errorMessage(e) : "Couldn't read the sticker. Hold the phone still and try again.");
    } finally {
      setNfc('ready');
    }
  };

  return (
    <View style={{ flex: 1, padding: space.lg, gap: space.md }}>
      {carrying ? (
        <Notice icon="hand-back-right-outline">{`Carrying ${carrying.name}. Scan the place you're putting it.`}</Notice>
      ) : (
        <Body muted>Scan a shelf or box to see what's in it, or scan an item's label and then the place you put it.</Body>
      )}

      <View style={{ flex: 1, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#000' }}>
        {!perm ? null : perm.granted ? (
          focused ? (
            <CameraView
              style={{ flex: 1 }}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={(r) => onCode(r.data)}
            />
          ) : null
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg, gap: space.md }}>
            <Text style={{ color: '#fff', fontSize: font.body, textAlign: 'center' }}>
              Where Is needs the camera to read QR labels.
            </Text>
            <Button title={perm.canAskAgain ? 'Allow camera' : 'Open settings to allow the camera'} onPress={requestPerm} />
          </View>
        )}
      </View>

      {message ? <Notice icon="check-circle-outline">{message}</Notice> : null}
      <ErrorText>{error}</ErrorText>

      {nfc === 'ready' || nfc === 'reading' ? (
        Platform.OS === 'android' ? (
          <Body muted>
            {nfc === 'reading' ? 'Hold the phone against the sticker…' : 'NFC sticker? Just hold the phone against it, even without opening this screen.'}
          </Body>
        ) : (
          <Button kind="secondary" icon="nfc" title="Read an NFC sticker" onPress={readNfc} busy={nfc === 'reading'} />
        )
      ) : nfc === 'off' ? (
        <Button kind="secondary" icon="nfc-search-variant" title="Turn on NFC to use stickers" onPress={openNfcSettings} />
      ) : null}
      {carrying ? <Button kind="plain" title={`Stop carrying ${carrying.name}`} onPress={() => data.setCarrying('')} /> : null}
    </View>
  );
}

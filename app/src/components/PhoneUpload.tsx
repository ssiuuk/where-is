import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';

import { errorMessage } from '@/lib/client';
import { useData } from '@/lib/data';
import { phoneSummary, uploadPhoneData } from '@/lib/phoneupload';
import { useSession } from '@/lib/session';

import { space } from './theme';
import { Body, Button, Card, ErrorText, Heading, Notice } from './ui';

/**
 * Shown once signed in to a server while things made with "this phone only"
 * are still on the phone: offers to upload them into this household.
 */
export function PhoneUpload() {
  const { pb, household, phoneOnly } = useSession();
  const data = useData();
  const [summary, setSummary] = useState<{ items: number; places: number } | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  useEffect(() => {
    if (Platform.OS === 'web' || phoneOnly) return;
    phoneSummary().then(setSummary);
  }, [phoneOnly]);

  if (done) return <Notice icon="check-circle-outline">{done}</Notice>;
  if (!summary || !pb || !household || phoneOnly) return null;

  const upload = async () => {
    setError('');
    setBusy('Starting…');
    try {
      const r = await uploadPhoneData(pb, setBusy);
      await data.reload();
      if (r.photosFailed) {
        setError(`${r.photosFailed} photo${r.photosFailed === 1 ? '' : 's'} didn't upload. Try again to send the rest; nothing will be doubled.`);
        setSummary(await phoneSummary());
      } else {
        setDone(`Uploaded ${r.items} items and ${r.places} places${r.photos ? ` with ${r.photos} photos` : ''}. Labels and stickers you made keep working.`);
        setSummary(null);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy('');
    }
  };

  return (
    <Card>
      <Heading>From this phone</Heading>
      <Body>
        {`${summary.items} items and ${summary.places} places are saved on this phone only. Upload them to ${household.name || 'this household'} so everyone can see them?`}
      </Body>
      <Body muted>They keep their history. Places with the same name as one already here aren't merged; use Merge duplicates afterwards if needed.</Body>
      <ErrorText>{error}</ErrorText>
      {busy ? <Body muted>{busy}</Body> : null}
      <View style={{ gap: space.sm }}>
        <Button icon="cloud-upload-outline" title="Upload" busy={!!busy} onPress={upload} />
        {!busy ? <Button kind="plain" title="Not now" onPress={() => setSummary(null)} /> : null}
      </View>
    </Card>
  );
}

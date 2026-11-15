import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { PhotoField } from '@/components/PhotoField';
import { PlacePicker } from '@/components/PlacePicker';
import { space } from '@/components/theme';
import { Body, Button, ErrorText, Field, Heading, Notice, Tape } from '@/components/ui';
import { errorMessage } from '@/lib/client';
import { Photo, useData } from '@/lib/data';

export default function NewItem() {
  const params = useLocalSearchParams<{ name?: string; place?: string }>();
  const { addItem, label } = useData();
  const [name, setName] = useState(params.name ?? '');
  const [note, setNote] = useState('');
  const [place, setPlace] = useState(params.place ?? '');
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState<'' | 'done' | 'more'>('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const save = async (then: 'done' | 'more') => {
    if (!name.trim()) {
      setError('Give it a name, like “Passport” or “Spare bike lights”.');
      return;
    }
    setBusy(then);
    setError('');
    try {
      const item = await addItem({ name, note, place, photo });
      if (then === 'done') {
        router.back();
      } else {
        // keep the place: people usually add several things from one shelf
        setSaved(`Saved ${item.name}.`);
        setName('');
        setNote('');
        setPhoto(null);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy('');
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }} keyboardShouldPersistTaps="handled">
      {saved ? <Notice icon="check-circle-outline">{`${saved} Add the next thing in the same place.`}</Notice> : null}
      <Field label="What is it?" value={name} onChangeText={setName} autoFocus={!params.name} placeholder="e.g. Passport" />
      <Heading>Where is it?</Heading>
      <Tape text={label(place)} empty="No place yet" onPress={() => setPicking(true)} />
      <Button kind="secondary" icon="map-marker-outline" title={place ? 'Change place' : 'Choose place'} onPress={() => setPicking(true)} />
      <Field label="Note (optional)" value={note} onChangeText={setNote} multiline placeholder="e.g. in the blue folder, both passports" />
      <Heading>Photo (optional)</Heading>
      <PhotoField shown={photo?.uri ?? ''} onPick={setPhoto} onRemove={() => setPhoto(null)} onError={setError} />
      <ErrorText>{error}</ErrorText>
      <View style={{ gap: space.sm, marginTop: space.sm }}>
        <Button title="Save" icon="check" onPress={() => save('done')} busy={busy === 'done'} disabled={!!busy} />
        <Button kind="secondary" title="Save and add another" onPress={() => save('more')} busy={busy === 'more'} disabled={!!busy} />
      </View>
      {!place ? <Body muted>You can save without a place and set it later.</Body> : null}
      <PlacePicker
        visible={picking}
        title="Where is it?"
        current={place}
        noneLabel="Not sure yet"
        onPick={(id) => {
          setPlace(id);
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
      />
    </ScrollView>
  );
}

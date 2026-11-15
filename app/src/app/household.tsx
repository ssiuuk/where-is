import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { space } from '@/components/theme';
import { Body, Button, Card, ErrorText, Field, Heading } from '@/components/ui';
import { errorMessage } from '@/lib/client';
import { useSession } from '@/lib/session';

export default function HouseholdSetup() {
  const s = useSession();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<'' | 'join' | 'create'>('');
  const [error, setError] = useState('');

  const run = async (which: 'join' | 'create') => {
    setBusy(which);
    setError('');
    try {
      if (which === 'join') await s.joinHousehold(code);
      else await s.createHousehold(name);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy('');
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
      <Body>
        Everyone in a household shares one list of places and things. Join the one your family already has, or start a new one.
      </Body>
      <ErrorText>{error}</ErrorText>
      <Card>
        <Heading>Join with an invite code</Heading>
        <Body muted>Find the code in Settings on a phone that's already in the household.</Body>
        <Field
          value={code}
          onChangeText={setCode}
          placeholder="ABCD-2345"
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={() => run('join')}
        />
        <Button title="Join household" onPress={() => run('join')} busy={busy === 'join'} disabled={!!busy || !code.trim()} />
      </Card>
      <Card>
        <Heading>Start a new household</Heading>
        <Field value={name} onChangeText={setName} placeholder="e.g. The Smiths" />
        <Button kind="secondary" title="Create household" onPress={() => run('create')} busy={busy === 'create'} disabled={!!busy || !name.trim()} />
      </Card>
      <View>
        <Button kind="plain" title={`Sign out${s.user?.email ? ` (${s.user.email})` : ''}`} onPress={s.signOut} />
      </View>
    </ScrollView>
  );
}

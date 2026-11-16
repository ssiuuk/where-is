import Constants from 'expo-constants';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { ScrollView, Text } from 'react-native';

import { NavRow } from '@/components/admin';
import { errorMessage } from '@/lib/client';
import { useData } from '@/lib/data';
import { pickBackup, restoreBackup, writeBackup } from '@/lib/phonefiles';
import type { Backup } from '@/lib/phonestore';
import { useMember } from '@/lib/session';
import { timeAgo } from '@/lib/time';

import { font, space, useColors } from './theme';
import { Body, Button, Card, ConfirmRow, ErrorText, Field, Heading, Notice } from './ui';

/** Settings when there is no server: everything is on this phone. */
export function PhoneSettings() {
  const c = useColors();
  const s = useMember();
  const data = useData();
  const [name, setName] = useState(s.household.name);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [restore, setRestore] = useState<Backup | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const act = async (what: string, fn: () => Promise<unknown>) => {
    setBusy(what);
    setError('');
    setDone('');
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy('');
    }
  };

  const saveBackup = () =>
    act('backup', async () => {
      const f = await writeBackup(s.household.name);
      if (!(await Sharing.isAvailableAsync())) throw new Error("This phone can't share files.");
      await Sharing.shareAsync(f.uri, { mimeType: 'application/json', dialogTitle: 'Save the Where Is backup' });
    });

  const chooseBackup = () =>
    act('pick', async () => {
      const b = await pickBackup();
      if (b) setRestore(b);
    });

  const doRestore = (b: Backup) =>
    act('restore', async () => {
      await restoreBackup(b);
      if (b.name) await s.renameHousehold(b.name);
      setName(b.name || s.household.name);
      await data.reload();
      setRestore(null);
      setDone(`Restored ${b.data.items.length} items and ${b.data.places.length} places.`);
    });

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }} keyboardShouldPersistTaps="handled">
      <ErrorText>{error}</ErrorText>
      {done ? <Notice icon="check-circle-outline">{done}</Notice> : null}

      <Card>
        <Heading>On this phone only</Heading>
        <Body muted>
          {`${data.items.length} items and ${data.places.length} places are kept on this phone, with no server. Nobody else can see them, and uninstalling the app or losing the phone loses them, so save a backup now and then.`}
        </Body>
        <Field value={name} onChangeText={setName} label="Name" accessibilityLabel="Name for your things" />
        {name.trim() && name.trim() !== s.household.name ? (
          <Button title="Save name" busy={busy === 'name'} onPress={() => act('name', () => s.renameHousehold(name))} />
        ) : null}
      </Card>

      <Card>
        <Heading>Backup</Heading>
        <Body muted>One file with everything, photos included. Keep it in Google Drive, email it to yourself, or put it on a computer.</Body>
        <Button icon="content-save-outline" title="Save a backup file" busy={busy === 'backup'} onPress={saveBackup} />
        {restore ? (
          <ConfirmRow
            ask={`Replace what's on this phone with the backup from ${timeAgo(restore.saved) || 'an unknown date'} (${restore.data.items.length} items, ${restore.data.places.length} places)? What's here now is lost.`}
            busy={busy === 'restore'}
            onCancel={() => setRestore(null)}
            onConfirm={() => doRestore(restore)}
          />
        ) : (
          <Button kind="secondary" icon="file-restore-outline" title="Restore from a backup file" busy={busy === 'pick'} onPress={chooseBackup} />
        )}
      </Card>

      <Card>
        <Heading>Print</Heading>
        <NavRow icon="printer-outline" title="Print where everything is" subtitle="A full list of items, organised by place" href="/admin/printout" />
        <NavRow icon="qrcode" title="Labels" subtitle="Print many QR labels; see places without one" href="/admin/labels" />
      </Card>

      <Card>
        <Heading>Share with your family</Heading>
        <Body muted>
          Sharing needs a Where Is server. Connect to one and sign in, and the app offers to upload everything from this phone, with its history and photos. Labels and stickers you've already made keep working.
        </Body>
        {confirmLeave ? (
          <ConfirmRow
            ask="Go to the server sign-in? Your things stay on this phone until you upload them, and you can come back to phone-only from the sign-in screen."
            onCancel={() => setConfirmLeave(false)}
            onConfirm={() => s.stopPhoneOnly()}
          />
        ) : (
          <Button kind="secondary" icon="server-network" title="Move to a server" onPress={() => setConfirmLeave(true)} />
        )}
      </Card>

      <Text style={{ color: c.muted, fontSize: font.small, textAlign: 'center' }}>{`On this phone only · app ${Constants.expoConfig?.version ?? ''}`}</Text>
    </ScrollView>
  );
}

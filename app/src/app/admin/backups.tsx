import { useEffect, useState } from 'react';
import { Platform, ScrollView } from 'react-native';

import { ConfirmBox, Loading, Row, Segmented, SmallButton, useAction, useAdminApi, useConfirm, useLoad } from '@/components/admin';
import { space } from '@/components/theme';
import { Body, Button, Card, ErrorText, Field, Heading, Notice } from '@/components/ui';
import { formatBytes, openDownload, pickFile } from '@/lib/admin';

type Every = 'off' | 'daily' | 'weekly';
const cronToEvery = (cron: string): Every => (!cron ? 'off' : cron.trim().endsWith('* * 0') ? 'weekly' : 'daily');

export default function Backups() {
  const { pb, api } = useAdminApi();
  const list = useLoad(() => api.backups(), [api]);
  const a = useAction();
  const confirm = useConfirm();
  const [every, setEvery] = useState<Every>('off');
  const [keep, setKeep] = useState('7');
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    if (list.data) {
      setEvery(cronToEvery(list.data.cron));
      setKeep(String(list.data.keep || 7));
    }
  }, [list.data]);

  if (restarting) {
    return (
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
        <Notice icon="restore">The server is restoring the backup and restarting. Everyone is signed out; sign in again in a minute.</Notice>
      </ScrollView>
    );
  }
  if (!list.data) return list.error ? <ErrorText>{list.error}</ErrorText> : <Loading />;
  const { backups } = list.data;

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }} keyboardShouldPersistTaps="handled">
      <Body muted>
        A backup is one .zip with the whole database and every photo. They're kept on the server in pb_data/backups; download them to keep a copy somewhere else.
      </Body>
      <ErrorText>{a.error}</ErrorText>
      {a.done ? <Notice icon="check-circle-outline">{a.done}</Notice> : null}
      <Button
        icon="database-export-outline"
        title="Back up now"
        busy={a.busy === 'now'}
        onPress={async () => {
          if (await a.run('now', () => api.backupNow(), 'Backup made.')) await list.reload();
        }}
      />
      {Platform.OS === 'web' ? (
        <Button
          kind="secondary"
          icon="upload-outline"
          title="Upload a backup"
          busy={a.busy === 'upload'}
          onPress={async () => {
            const f = await pickFile('.zip,application/zip');
            if (f && (await a.run('upload', () => api.uploadBackup(f), `${f.name} uploaded. Restore it from the list.`))) await list.reload();
          }}
        />
      ) : (
        <Body muted>To upload a backup from your computer, open the server in a browser.</Body>
      )}

      <Card>
        <Heading>{`On the server (${backups.length})`}</Heading>
        {backups.length === 0 ? <Body muted>No backups yet.</Body> : null}
        {backups.map((b) => (
          <Row key={b.name} title={b.name} subtitle={`${formatBytes(b.size)} · ${new Date(b.modified).toLocaleString()}`}>
            {confirm.ask?.key.endsWith(b.name) ? (
              <ConfirmBox text={confirm.ask.text} yes={confirm.ask.yes} busy={!!a.busy} onNo={confirm.clear} onYes={confirm.ask.run} />
            ) : (
              <>
                <SmallButton title="Download" busy={a.busy === 'dl' + b.name} onPress={() => a.run('dl' + b.name, () => openDownload(pb, `backup/${encodeURIComponent(b.name)}`))} />
                <SmallButton
                  title="Restore"
                  danger
                  onPress={() =>
                    confirm.setAsk({
                      key: 'restore' + b.name,
                      text: `Replace everything on the server with ${b.name}? Anything added since is lost (make a backup first if unsure). The server restarts and everyone signs in again.`,
                      yes: 'Restore',
                      run: async () => {
                        if (await a.run('restore', () => api.restoreBackup(b.name))) setRestarting(true);
                        confirm.clear();
                      },
                    })
                  }
                />
                <SmallButton
                  title="Delete"
                  danger
                  onPress={() =>
                    confirm.setAsk({
                      key: 'del' + b.name,
                      text: `Delete ${b.name}? This can't be undone.`,
                      yes: 'Delete',
                      run: async () => {
                        if (await a.run('del' + b.name, () => api.deleteBackup(b.name))) await list.reload();
                        confirm.clear();
                      },
                    })
                  }
                />
              </>
            )}
          </Row>
        ))}
      </Card>

      <Card>
        <Heading>Automatic backups</Heading>
        <Segmented
          options={[
            { value: 'off', label: 'Off' },
            { value: 'daily', label: 'Daily' },
            { value: 'weekly', label: 'Weekly' },
          ]}
          value={every}
          onChange={setEvery}
        />
        {every !== 'off' ? (
          <Field label="Keep the newest" value={keep} onChangeText={(t) => setKeep(t.replace(/\D/g, ''))} keyboardType="number-pad" hint="Older automatic backups are deleted. Runs at 03:00 server time." />
        ) : null}
        <Button
          kind="secondary"
          title="Save schedule"
          busy={a.busy === 'schedule'}
          onPress={() => a.run('schedule', () => api.scheduleBackups(every, Number(keep) || 7), every === 'off' ? 'Automatic backups are off.' : `Automatic ${every} backups are on.`)}
        />
      </Card>
    </ScrollView>
  );
}

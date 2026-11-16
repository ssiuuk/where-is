import { useState } from 'react';
import { Platform, ScrollView } from 'react-native';

import { Segmented, useAction, useAdminApi } from '@/components/admin';
import { space } from '@/components/theme';
import { Body, Button, Card, ErrorText, Field, Heading, Notice } from '@/components/ui';
import { ImportResult, openDownload, pickFile } from '@/lib/admin';
import { useData } from '@/lib/data';

const examples = {
  items: 'name,place,note\nDrill,Garage > Shelf 3,Cordless\nPassports,Study > Desk drawer,',
  places: 'place,note\nGarage > Shelf 3,\nLoft > Box 2,Christmas things',
};

export default function ImportExport() {
  const { pb, api } = useAdminApi();
  const data = useData();
  const a = useAction();
  const [kind, setKind] = useState<'items' | 'places'>('items');
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<ImportResult | null>(null);

  const summary = (r: ImportResult) =>
    `${r.items} item${r.items === 1 ? '' : 's'} and ${r.places} new place${r.places === 1 ? '' : 's'}` +
    (r.skipped ? `, ${r.skipped} row${r.skipped === 1 ? '' : 's'} skipped (empty, or already there)` : '');

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }} keyboardShouldPersistTaps="handled">
      <ErrorText>{a.error}</ErrorText>
      {a.done ? <Notice icon="check-circle-outline">{a.done}</Notice> : null}
      <Card>
        <Heading>Export</Heading>
        <Body muted>Download everything as CSV files that open in Excel, Numbers or Google Sheets.</Body>
        <Button kind="secondary" icon="download-outline" title="Items (CSV)" busy={a.busy === 'items.csv'} onPress={() => a.run('items.csv', () => openDownload(pb, 'export/items.csv'))} />
        <Button kind="secondary" icon="download-outline" title="Places (CSV)" busy={a.busy === 'places.csv'} onPress={() => a.run('places.csv', () => openDownload(pb, 'export/places.csv'))} />
      </Card>

      <Card>
        <Heading>Import</Heading>
        <Segmented
          options={[
            { value: 'items', label: 'Items' },
            { value: 'places', label: 'Places' },
          ]}
          value={kind}
          onChange={(k) => {
            setKind(k);
            setPreview(null);
          }}
        />
        <Body muted>
          {kind === 'items'
            ? 'Columns: name, place and note (only name is needed). Write places as Garage > Shelf 3; missing places are created. An item already in the same place with the same name is skipped, so importing twice is safe.'
            : 'Columns: place and note. Write places as Garage > Shelf 3; each level is created if missing.'}
        </Body>
        {Platform.OS === 'web' ? (
          <Button
            kind="secondary"
            icon="file-upload-outline"
            title="Choose a CSV file"
            onPress={async () => {
              const f = await pickFile('.csv,text/csv,text/plain');
              if (f) {
                setCsv(await f.text());
                setPreview(null);
              }
            }}
          />
        ) : null}
        <Field
          label={Platform.OS === 'web' ? 'Or paste the CSV here' : 'Paste the CSV here'}
          value={csv}
          onChangeText={(t) => {
            setCsv(t);
            setPreview(null);
          }}
          multiline
          placeholder={examples[kind]}
          autoCapitalize="none"
          autoCorrect={false}
          style={{ minHeight: 140, fontFamily: 'monospace', fontSize: 13 }}
        />
        {preview ? <Notice>{`This will add ${summary(preview)}.`}</Notice> : null}
        {preview ? (
          <Button
            title="Import"
            busy={a.busy === 'import'}
            onPress={async () => {
              const out: { result?: ImportResult } = {};
              const ok = await a.run('import', async () => {
                out.result = await api.importCsv(kind, csv, false);
              });
              if (ok && out.result) {
                a.setDone(`Imported ${summary(out.result)}.`);
                setCsv('');
                setPreview(null);
                await data.reload();
              }
            }}
          />
        ) : (
          <Button
            kind="secondary"
            title="Check first"
            disabled={!csv.trim()}
            busy={a.busy === 'check'}
            onPress={() => a.run('check', async () => setPreview(await api.importCsv(kind, csv, true)))}
          />
        )}
      </Card>
    </ScrollView>
  );
}

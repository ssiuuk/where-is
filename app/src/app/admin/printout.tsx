import { useState } from 'react';
import { ScrollView } from 'react-native';

import { ToggleRow, useAction } from '@/components/admin';
import { space } from '@/components/theme';
import { Body, Button, Card, ErrorText } from '@/components/ui';
import { printHtml } from '@/lib/admin';
import { useData } from '@/lib/data';
import { inventoryHtml, PrintoutOptions } from '@/lib/printout';
import { useSession } from '@/lib/session';

export default function Printout() {
  const { household } = useSession();
  const data = useData();
  const a = useAction();
  const [opts, setOpts] = useState<PrintoutOptions>({ notes: true, emptyPlaces: false, pageBreaks: false });
  const set = (k: keyof PrintoutOptions) => (v: boolean) => setOpts((o) => ({ ...o, [k]: v }));
  const loose = data.items.filter((i) => !i.place).length;

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
      <Body muted>
        {`A list of where all ${data.items.length} items are, organised by place: every place with its full path, the items in it underneath${
          loose ? `, then the ${loose} item${loose === 1 ? '' : 's'} with no place` : ''
        }. Print it, or save it as a PDF from the print dialog.`}
      </Body>
      <Card>
        <ToggleRow title="Include notes" value={opts.notes} onChange={set('notes')} />
        <ToggleRow title="Include empty places" subtitle="Places with nothing directly in them" value={opts.emptyPlaces} onChange={set('emptyPlaces')} />
        <ToggleRow title="New page for each room" subtitle="Each top-level place starts a new page" value={opts.pageBreaks} onChange={set('pageBreaks')} />
      </Card>
      <ErrorText>{a.error}</ErrorText>
      <Button
        icon="printer-outline"
        title="Print"
        busy={a.busy === 'print'}
        disabled={!data.items.length && !data.places.length}
        onPress={() => a.run('print', () => printHtml(inventoryHtml(household?.name || 'Where Is', data.places, data.items, opts)))}
      />
    </ScrollView>
  );
}

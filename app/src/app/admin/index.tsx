import { ScrollView } from 'react-native';

import { NavRow, useAction } from '@/components/admin';
import { space } from '@/components/theme';
import { Body, Button, Card, Empty, ErrorText, Heading, Notice } from '@/components/ui';
import { adminApi } from '@/lib/admin';
import { useSession } from '@/lib/session';

export default function AdminHome() {
  const s = useSession();
  const { roles } = s;
  const a = useAction();

  if (!roles.family && !roles.site && !roles.siteNeedsVerify) {
    return (
      <Empty icon="shield-lock-outline" title="No admin tools for you">
        The person who created the household is its family admin. Site admins are listed in the server's settings.
      </Empty>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
      {roles.siteNeedsVerify && s.pb && s.user ? (
        <Card>
          <Heading>Site admin</Heading>
          <Notice icon="email-check-outline">
            Your email is listed as a site admin, but it isn't confirmed yet. Confirm it to get the server tools (or sign in with Google using
            the same address).
          </Notice>
          <ErrorText>{a.error}</ErrorText>
          {a.done ? <Body muted>{a.done}</Body> : null}
          <Button
            kind="secondary"
            title="Send confirmation email"
            busy={a.busy === 'verify'}
            onPress={() =>
              a.run(
                'verify',
                async () => {
                  const r = await adminApi(s.pb!).verifyEmail();
                  if (r.verified) await s.refresh();
                },
                `Sent to ${s.user!.email}. Open the link in the email (look in spam too), then tap "I've confirmed it".`,
              )
            }
          />
          <Button kind="plain" title="I've confirmed it" onPress={() => s.refresh()} />
        </Card>
      ) : null}

      {roles.family && s.household ? (
        <Card>
          <Heading>{`Family admin · ${s.household.name}`}</Heading>
          <NavRow icon="account-group-outline" title="Members and invites" subtitle="Invite codes, remove someone, hand over admin" href="/admin/members" />
          <NavRow icon="file-delimited-outline" title="Import and export" subtitle="CSV files of items and places" href="/admin/data" />
          <NavRow icon="call-merge" title="Merge duplicates" subtitle="Items or places entered twice" href="/admin/duplicates" />
          <NavRow icon="delete-restore" title="Recycle bin" subtitle="Bring back deleted items and places" href="/admin/trash" />
          <NavRow icon="printer-outline" title="Print where everything is" subtitle="A full list of items, organised by place" href="/admin/printout" />
          <NavRow icon="qrcode" title="Labels" subtitle="Print many QR labels; see places without one" href="/admin/labels" />
          <NavRow icon="history" title="Activity" subtitle="Who added, moved or deleted what" href="/admin/activity" />
          <NavRow icon="chart-box-outline" title="Stats" subtitle="Counts, photo storage, forgotten items" href="/admin/stats" />
        </Card>
      ) : null}

      {roles.site ? (
        <Card>
          <Heading>Site admin · whole server</Heading>
          <NavRow icon="account-multiple-outline" title="Accounts" subtitle="Everyone on the server: turn off, delete, reset password" href="/admin/accounts" />
          <NavRow icon="cog-outline" title="Server settings" subtitle="Sign-up, email, Google sign-in" href="/admin/server" />
          <NavRow icon="database-arrow-down-outline" title="Backups" subtitle="Download, restore, schedule" href="/admin/backups" />
        </Card>
      ) : null}
    </ScrollView>
  );
}

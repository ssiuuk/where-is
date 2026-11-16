import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useColors } from '@/components/theme';
import { DataProvider } from '@/lib/data';
import { PhoneDataProvider } from '@/lib/phonedata';
import { SessionProvider, useSession } from '@/lib/session';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <Navigator />
      </SessionProvider>
    </SafeAreaProvider>
  );
}

function Navigator() {
  const c = useColors();
  const { ready, pb, user, household, phoneOnly } = useSession();

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg }}>
        <ActivityIndicator color={c.accent} size="large" />
      </View>
    );
  }

  const stage = phoneOnly ? 'app' : !pb || !user ? 'welcome' : !household ? 'household' : 'app';

  const stack = (
    <>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: c.bg },
          headerTintColor: c.accent,
          headerTitleStyle: { color: c.text, fontWeight: '700' },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: c.bg },
        }}
      >
        <Stack.Protected guard={stage === 'app'}>
          <Stack.Screen name="index" options={{ title: household?.name || 'Where Is' }} />
          <Stack.Screen name="places" options={{ title: 'Places' }} />
          <Stack.Screen name="p/[id]" options={{ title: '' }} />
          <Stack.Screen name="i/[id]" options={{ title: '' }} />
          <Stack.Screen name="new-item" options={{ title: 'Add item', presentation: 'modal' }} />
          <Stack.Screen name="scan" options={{ title: 'Scan a label' }} />
          <Stack.Screen name="label" options={{ title: 'Label' }} />
          <Stack.Screen name="settings" options={{ title: 'Settings' }} />
          {/* family admin: the household's tools (the server checks the role too) */}
          <Stack.Screen name="admin/members" options={{ title: 'Members and invites' }} />
          <Stack.Screen name="admin/data" options={{ title: 'Import and export' }} />
          <Stack.Screen name="admin/duplicates" options={{ title: 'Merge duplicates' }} />
          <Stack.Screen name="admin/trash" options={{ title: 'Recycle bin' }} />
          <Stack.Screen name="admin/printout" options={{ title: 'Print where everything is' }} />
          <Stack.Screen name="admin/labels" options={{ title: 'Labels' }} />
          <Stack.Screen name="admin/activity" options={{ title: 'Activity' }} />
          <Stack.Screen name="admin/stats" options={{ title: 'Stats' }} />
        </Stack.Protected>
        {/* site admin tools work with or without a household */}
        <Stack.Protected guard={stage !== 'welcome' && !phoneOnly}>
          <Stack.Screen name="admin/index" options={{ title: 'Admin' }} />
          <Stack.Screen name="admin/accounts" options={{ title: 'Accounts' }} />
          <Stack.Screen name="admin/server" options={{ title: 'Server settings' }} />
          <Stack.Screen name="admin/backups" options={{ title: 'Backups' }} />
        </Stack.Protected>
        <Stack.Protected guard={stage === 'household'}>
          <Stack.Screen name="household" options={{ title: 'Your household' }} />
        </Stack.Protected>
        <Stack.Protected guard={stage === 'welcome'}>
          <Stack.Screen name="welcome" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
    </>
  );

  if (phoneOnly) return <PhoneDataProvider>{stack}</PhoneDataProvider>;
  return stage === 'app' && pb && household ? (
    <DataProvider key={household.id} pb={pb} household={household.id}>
      {stack}
    </DataProvider>
  ) : (
    stack
  );
}

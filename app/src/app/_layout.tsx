import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useColors } from '@/components/theme';
import { DataProvider } from '@/lib/data';
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
  const { ready, pb, user, household } = useSession();

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg }}>
        <ActivityIndicator color={c.accent} size="large" />
      </View>
    );
  }

  const stage = !pb || !user ? 'welcome' : !household ? 'household' : 'app';

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

  return stage === 'app' && pb && household ? (
    <DataProvider key={household.id} pb={pb} household={household.id}>
      {stack}
    </DataProvider>
  ) : (
    stack
  );
}

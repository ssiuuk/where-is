import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { font, space, useColors } from '@/components/theme';
import { Body, Button, ErrorText, Field, Icon } from '@/components/ui';
import { errorMessage } from '@/lib/client';
import { useSession } from '@/lib/session';

export default function Welcome() {
  const c = useColors();
  const s = useSession();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: space.sm, marginTop: space.xl }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Icon name="map-marker-question-outline" size={34} color={c.accent} />
              <Text style={{ color: c.text, fontSize: 32, fontWeight: '800' }}>Where Is</Text>
            </View>
            <Body muted>Remember where your family put things, and find them again.</Body>
          </View>
          {s.pb ? <SignIn /> : <ChooseServer />}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ChooseServer() {
  const c = useColors();
  const { connectServer, startPhoneOnly } = useSession();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    setBusy(true);
    setError('');
    try {
      await connectServer(url);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: space.md }}>
      <Field
        label="Server address"
        value={url}
        onChangeText={setUrl}
        placeholder="whereis.example.com"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        returnKeyType="go"
        onSubmitEditing={go}
        hint="The address of your household's Where Is server."
      />
      <ErrorText>{error}</ErrorText>
      <Button title="Continue" onPress={go} busy={busy} disabled={!url.trim()} />
      {Platform.OS !== 'web' ? (
        <View style={{ gap: space.sm, marginTop: space.lg }}>
          <Text style={{ color: c.muted, textAlign: 'center' }}>No server?</Text>
          <Button kind="secondary" icon="cellphone" title="Use on this phone only" onPress={() => startPhoneOnly().catch((e) => setError(errorMessage(e)))} />
          <Body muted>
            Everything stays on this phone, with no account. Family sharing needs a server; you can move everything to one later.
          </Body>
        </View>
      ) : null}
    </View>
  );
}

function SignIn() {
  const c = useColors();
  const s = useSession();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'' | 'password' | 'google'>('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [google, setGoogle] = useState(false);
  // null until the server says whether sign-up is open
  const [signup, setSignup] = useState<boolean | null>(null);

  useEffect(() => {
    s.googleAvailable().then(setGoogle);
    s.signupOpen().then((open) => {
      setSignup(open);
      if (!open) setMode('in');
    });
  }, [s]);

  const submit = async () => {
    setBusy('password');
    setError('');
    try {
      if (mode === 'in') await s.signIn(email, password);
      else await s.signUp(name, email, password);
    } catch (e) {
      const status = (e as { status?: number }).status;
      setError(mode === 'in' && status === 400 ? 'That email and password don’t match an account.' : errorMessage(e));
    } finally {
      setBusy('');
    }
  };

  const withGoogle = async () => {
    setBusy('google');
    setError('');
    try {
      await s.signInWithGoogle();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy('');
    }
  };

  return (
    <View style={{ gap: space.md }}>
      <Text style={{ color: c.muted, fontSize: font.small }}>Server: {s.serverUrl}</Text>
      {google ? (
        <>
          <Button title="Continue with Google" kind="secondary" icon="google" onPress={withGoogle} busy={busy === 'google'} disabled={!!busy} />
          <Text style={{ color: c.muted, textAlign: 'center' }}>or with email</Text>
        </>
      ) : null}
      {mode === 'up' ? <Field label="Your name" value={name} onChangeText={setName} autoComplete="name" /> : null}
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
      />
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
        hint={mode === 'up' ? 'At least 8 characters.' : undefined}
        returnKeyType="go"
        onSubmitEditing={submit}
      />
      <ErrorText>{error}</ErrorText>
      {notice || s.notice ? <Text style={{ color: c.muted }}>{notice || s.notice}</Text> : null}
      <Button
        title={mode === 'in' ? 'Sign in' : 'Create account'}
        onPress={submit}
        busy={busy === 'password'}
        disabled={!!busy || !email.trim() || !password || (mode === 'up' && !name.trim())}
      />
      {signup === null ? null : signup ? (
        <Button
          kind="plain"
          title={mode === 'in' ? 'New here? Create an account' : 'Already have an account? Sign in'}
          onPress={() => {
            setMode(mode === 'in' ? 'up' : 'in');
            setError('');
          }}
        />
      ) : (
        <Text style={{ color: c.muted, textAlign: 'center' }}>New accounts are turned off on this server. Ask whoever runs it to add you.</Text>
      )}
      {mode === 'in' ? (
        <Button
          kind="plain"
          title="Forgot password?"
          onPress={async () => {
            setError('');
            setNotice('');
            if (!email.trim()) {
              setError('Type your email above first.');
              return;
            }
            try {
              await s.requestPasswordReset(email);
              setNotice(`If ${email.trim()} has an account, a link to set a new password is on its way. If nothing arrives, ask whoever runs the server.`);
            } catch (e) {
              setError(errorMessage(e));
            }
          }}
        />
      ) : null}
      {Platform.OS !== 'web' ? <Button kind="plain" title="Use a different server" onPress={() => s.forgetServer()} /> : null}
    </View>
  );
}

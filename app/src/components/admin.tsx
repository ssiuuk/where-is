import { Href, router } from 'expo-router';
import { DependencyList, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Switch, Text, View } from 'react-native';

import { adminApi } from '@/lib/admin';
import { errorMessage } from '@/lib/client';
import { useSession } from '@/lib/session';

import { font, radius, space, useColors } from './theme';
import { Icon, IconName } from './ui';

/** The admin API for the signed-in account. */
export function useAdminApi() {
  const { pb } = useSession();
  if (!pb) throw new Error('useAdminApi needs a server');
  return useMemo(() => ({ pb, api: adminApi(pb) }), [pb]);
}

/** Loads something on open, with a reload for after changes. */
export function useLoad<T>(load: () => Promise<T>, deps: DependencyList) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fn = useCallback(load, deps);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fn());
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [fn]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, setData, error, loading, reload };
}

/** Runs one action at a time, remembering which is busy and the last error. */
export function useAction() {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const run = useCallback(async (key: string, fn: () => Promise<unknown>, doneText = '') => {
    setBusy(key);
    setError('');
    setDone('');
    try {
      await fn();
      setDone(doneText);
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy('');
    }
  }, []);
  return { busy, error, done, run, setError, setDone };
}

export function Loading() {
  const c = useColors();
  return (
    <View style={{ padding: space.xl, alignItems: 'center' }}>
      <ActivityIndicator color={c.accent} />
    </View>
  );
}

export function NavRow({ icon, title, subtitle, href }: { icon: IconName; title: string; subtitle?: string; href: Href }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(href)}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, opacity: pressed ? 0.6 : 1 })}
    >
      <Icon name={icon} color={c.accent} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.text, fontSize: font.body, fontWeight: '600' }}>{title}</Text>
        {subtitle ? <Text style={{ color: c.muted, fontSize: font.small }}>{subtitle}</Text> : null}
      </View>
      <Icon name="chevron-right" color={c.muted} />
    </Pressable>
  );
}

export function ToggleRow({
  title,
  subtitle,
  value,
  onChange,
  disabled,
}: {
  title: string;
  subtitle?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.text, fontSize: font.body }}>{title}</Text>
        {subtitle ? <Text style={{ color: c.muted, fontSize: font.small }}>{subtitle}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: c.accent, false: c.border }}
        accessibilityLabel={title}
      />
    </View>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', borderRadius: radius.md, backgroundColor: c.accentSoft, padding: 3 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={{ flex: 1, paddingVertical: 8, borderRadius: radius.sm, backgroundColor: on ? c.card : 'transparent', alignItems: 'center' }}
          >
            <Text style={{ color: on ? c.text : c.muted, fontWeight: on ? '700' : '500', fontSize: font.small }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A row in an admin list: a title, a muted line under it, and controls below. */
export function Row({ title, subtitle, badge, children }: { title: string; subtitle?: string; badge?: string; children?: ReactNode }) {
  const c = useColors();
  return (
    <View style={{ gap: space.xs, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: c.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
        <Text style={{ color: c.text, fontSize: font.body, fontWeight: '600', flexShrink: 1 }}>{title}</Text>
        {badge ? (
          <View style={{ backgroundColor: c.accentSoft, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 1 }}>
            <Text style={{ color: c.accent, fontSize: 12, fontWeight: '700' }}>{badge}</Text>
          </View>
        ) : null}
      </View>
      {subtitle ? <Text style={{ color: c.muted, fontSize: font.small }}>{subtitle}</Text> : null}
      {children ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs }}>{children}</View> : null}
    </View>
  );
}

/** A small text button for rows of actions. */
export function SmallButton({ title, onPress, danger, busy, disabled }: { title: string; onPress: () => void; danger?: boolean; busy?: boolean; disabled?: boolean }) {
  const c = useColors();
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={off ? undefined : onPress}
      style={({ pressed }) => ({
        paddingHorizontal: space.md,
        paddingVertical: 6,
        borderRadius: radius.sm,
        backgroundColor: danger ? c.dangerSoft : c.accentSoft,
        opacity: off ? 0.5 : pressed ? 0.7 : 1,
        flexDirection: 'row',
        gap: 6,
        alignItems: 'center',
      })}
    >
      {busy ? <ActivityIndicator size="small" color={danger ? c.danger : c.accent} /> : null}
      <Text style={{ color: danger ? c.danger : c.accent, fontWeight: '600', fontSize: font.small }}>{title}</Text>
    </Pressable>
  );
}

export function Stat({ label, value }: { label: string; value: string | number }) {
  const c = useColors();
  return (
    <View style={{ flexGrow: 1, flexBasis: '45%', backgroundColor: c.card, borderColor: c.border, borderWidth: 1, borderRadius: radius.md, padding: space.md }}>
      <Text style={{ color: c.text, fontSize: font.big, fontWeight: '700' }}>{value}</Text>
      <Text style={{ color: c.muted, fontSize: font.small }}>{label}</Text>
    </View>
  );
}

/** A row's pending yes/no question, shown in place of its buttons. */
export function useConfirm() {
  const [ask, setAsk] = useState<{ key: string; text: string; yes: string; run: () => void } | null>(null);
  return { ask, setAsk, clear: () => setAsk(null) };
}

export function ConfirmBox({ text, yes, onYes, onNo, busy }: { text: string; yes: string; onYes: () => void; onNo: () => void; busy?: boolean }) {
  const c = useColors();
  return (
    <View style={{ gap: space.sm, backgroundColor: c.dangerSoft, padding: space.md, borderRadius: radius.md, width: '100%' }}>
      <Text style={{ color: c.danger, fontSize: font.body }}>{text}</Text>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <SmallButton title={yes} danger onPress={onYes} busy={busy} />
        <SmallButton title="Cancel" onPress={onNo} />
      </View>
    </View>
  );
}

import { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { font, radius, space, useColors } from './theme';

export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export function Icon({ name, size = 22, color }: { name: IconName; size?: number; color?: string }) {
  const c = useColors();
  return <MaterialCommunityIcons name={name} size={size} color={color ?? c.text} />;
}

type ButtonProps = {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger' | 'plain';
  icon?: IconName;
  busy?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Button({ title, onPress, kind = 'primary', icon, busy, disabled, style }: ButtonProps) {
  const c = useColors();
  const bg = kind === 'primary' ? c.accent : kind === 'danger' ? c.dangerSoft : kind === 'secondary' ? c.accentSoft : 'transparent';
  const fg = kind === 'primary' ? c.accentText : kind === 'danger' ? c.danger : c.accent;
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: off ? 0.5 : pressed ? 0.8 : 1 },
        kind === 'plain' && { paddingHorizontal: space.sm },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} size={20} color={fg} /> : null}
      <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>
    </Pressable>
  );
}

export function IconButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.6 : 1 })}
    >
      <Icon name={icon} color={c.accent} size={24} />
    </Pressable>
  );
}

export function Field({ label, hint, ...props }: TextInputProps & { label?: string; hint?: string }) {
  const c = useColors();
  return (
    <View style={{ gap: space.xs }}>
      {label ? <Text style={[styles.label, { color: c.muted }]}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={c.muted}
        {...props}
        style={[
          styles.input,
          { backgroundColor: c.card, borderColor: c.border, color: c.text },
          props.multiline && { minHeight: 80, textAlignVertical: 'top' },
          props.style,
        ]}
      />
      {hint ? <Text style={{ color: c.muted, fontSize: font.small }}>{hint}</Text> : null}
    </View>
  );
}

/** A place name printed like a strip of label-maker tape. */
export function Tape({ text, onPress, empty = 'Place not set' }: { text: string; onPress?: () => void; empty?: string }) {
  const c = useColors();
  const body = (
    <View style={[styles.tape, { backgroundColor: text ? c.tape : c.border }]}>
      <Text numberOfLines={2} style={[styles.tapeText, { color: text ? c.tapeText : c.muted }]}>
        {text || empty}
      </Text>
    </View>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress}>
      {body}
    </Pressable>
  ) : (
    body
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }, style]}>{children}</View>;
}

export function Heading({ children }: { children: ReactNode }) {
  const c = useColors();
  return <Text style={[styles.heading, { color: c.muted }]}>{children}</Text>;
}

export function Body({ children, muted, style }: { children: ReactNode; muted?: boolean; style?: StyleProp<any> }) {
  const c = useColors();
  return <Text style={[{ color: muted ? c.muted : c.text, fontSize: font.body, lineHeight: 22 }, style]}>{children}</Text>;
}

export function ErrorText({ children }: { children: ReactNode }) {
  const c = useColors();
  if (!children) return null;
  return (
    <View style={{ backgroundColor: c.dangerSoft, padding: space.md, borderRadius: radius.md }}>
      <Text style={{ color: c.danger, fontSize: font.body }}>{children}</Text>
    </View>
  );
}

export function Notice({ children, icon = 'information-outline' }: { children: ReactNode; icon?: IconName }) {
  const c = useColors();
  return (
    <View style={[styles.notice, { backgroundColor: c.warnSoft }]}>
      <Icon name={icon} size={18} color={c.text} />
      <Text style={{ color: c.text, flex: 1, fontSize: font.small }}>{children}</Text>
    </View>
  );
}

export function Empty({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  const c = useColors();
  return (
    <View style={{ alignItems: 'center', padding: space.xl, gap: space.sm }}>
      <Icon name={icon} size={44} color={c.muted} />
      <Text style={{ color: c.text, fontSize: font.title, fontWeight: '600', textAlign: 'center' }}>{title}</Text>
      {children ? <Text style={{ color: c.muted, fontSize: font.body, textAlign: 'center', lineHeight: 22 }}>{children}</Text> : null}
    </View>
  );
}

/** Two-step delete: the first press asks, the second does it. */
export function ConfirmRow({ ask, onConfirm, onCancel, busy }: { ask: string; onConfirm: () => void; onCancel: () => void; busy?: boolean }) {
  const c = useColors();
  return (
    <View style={{ gap: space.sm, backgroundColor: c.dangerSoft, padding: space.md, borderRadius: radius.md }}>
      <Text style={{ color: c.danger, fontSize: font.body }}>{ask}</Text>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Button title="Delete" kind="danger" icon="delete-outline" onPress={onConfirm} busy={busy} style={{ flex: 1, backgroundColor: c.card }} />
        <Button title="Keep" kind="secondary" onPress={onCancel} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  buttonText: { fontSize: font.body, fontWeight: '600' },
  label: { fontSize: font.small, fontWeight: '600', letterSpacing: 0.3 },
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 12, fontSize: font.body },
  tape: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 3, maxWidth: '100%' },
  tapeText: { fontFamily: 'monospace', fontSize: 13, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: space.lg, gap: space.md },
  heading: { fontSize: font.small, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: space.md },
  notice: { flexDirection: 'row', gap: space.sm, padding: space.md, borderRadius: radius.md, alignItems: 'center' },
});

import { Image } from 'react-native';
import { Pressable, Text, View } from 'react-native';

import { useData } from '@/lib/data';
import { timeAgo } from '@/lib/time';
import type { Item } from '@/lib/types';
import { font, radius, space, useColors } from './theme';
import { Icon, Tape } from './ui';

export function ItemRow({
  item,
  onPress,
  right,
  alias,
}: {
  item: Item;
  onPress: () => void;
  right?: React.ReactNode;
  /** the other name a search matched, shown under the name */
  alias?: string;
}) {
  const c = useColors();
  const { label, photoUrl, memberName } = useData();
  const photo = photoUrl(item, '200x200');
  const who = memberName(item.moved_by);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        gap: space.md,
        padding: space.md,
        backgroundColor: pressed ? c.accentSoft : c.card,
        borderBottomWidth: 1,
        borderColor: c.border,
        alignItems: 'center',
      })}
    >
      {photo ? (
        <Image source={{ uri: photo }} style={{ width: 52, height: 52, borderRadius: radius.sm, backgroundColor: c.border }} />
      ) : (
        <View style={{ width: 52, height: 52, borderRadius: radius.sm, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="package-variant-closed" color={c.accent} />
        </View>
      )}
      <View style={{ flex: 1, gap: 4, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: c.text, fontSize: font.body, fontWeight: '600' }}>
          {item.name}
        </Text>
        {alias ? (
          <Text numberOfLines={1} style={{ color: c.muted, fontSize: 12 }}>
            {`Also called ${alias}`}
          </Text>
        ) : null}
        <Tape text={label(item.place)} />
        {item.tags?.length ? (
          <Text numberOfLines={1} style={{ color: c.accent, fontSize: 12, fontWeight: '600' }}>
            {item.tags.map((t) => `#${t}`).join('  ')}
          </Text>
        ) : null}
        {item.moved_at ? (
          <Text numberOfLines={1} style={{ color: c.muted, fontSize: 12 }}>
            {`Put there ${timeAgo(item.moved_at)}${who ? ` by ${who}` : ''}`}
          </Text>
        ) : null}
      </View>
      {right}
    </Pressable>
  );
}

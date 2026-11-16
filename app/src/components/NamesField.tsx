import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useData } from '@/lib/data';
import { namesProblem, splitNames, suggestTags, tidyAliases, tidyTags } from '@/lib/names';
import { font, space, useColors } from './theme';
import { Field, Icon, IconName } from './ui';

/** A small rounded label: a tag, another name, or a suggestion to add. */
export function Chip({
  text,
  onPress,
  icon,
  selected,
  accessibilityLabel,
}: {
  text: string;
  onPress?: () => void;
  icon?: IconName;
  selected?: boolean;
  accessibilityLabel?: string;
}) {
  const c = useColors();
  const fg = selected ? c.accentText : c.accent;
  const body = (pressed: boolean) => (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingLeft: space.md,
        paddingRight: icon ? space.sm : space.md,
        minHeight: 32,
        borderRadius: 16,
        backgroundColor: selected ? c.accent : c.accentSoft,
        opacity: pressed ? 0.7 : 1,
      }}
    >
      <Text numberOfLines={1} style={{ color: fg, fontSize: font.small, fontWeight: '600', maxWidth: 220 }}>
        {text}
      </Text>
      {icon ? <Icon name={icon} size={16} color={fg} /> : null}
    </View>
  );
  if (!onPress) return body(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? text}
      accessibilityState={{ selected: !!selected }}
      hitSlop={4}
      onPress={onPress}
    >
      {({ pressed }) => body(pressed)}
    </Pressable>
  );
}

/**
 * Edits a list of short names (tags or other names). Entries are added with
 * the return key or a comma, and removed by tapping them. Whatever is still
 * in the box counts too: callers save `[...values, ...splitNames(text)]`.
 */
export function NamesField({
  label,
  hint,
  placeholder,
  values,
  onChange,
  text,
  onChangeText,
  tidy,
  suggestions = [],
  prefix = '',
}: {
  label: string;
  hint?: string;
  placeholder?: string;
  values: string[];
  onChange: (values: string[]) => void;
  text: string;
  onChangeText: (text: string) => void;
  tidy: (list: string[]) => string[];
  suggestions?: string[];
  prefix?: string;
}) {
  const c = useColors();
  const add = (more: string[]) => onChange(tidy([...values, ...more]));
  return (
    <View style={{ gap: space.sm }}>
      <Field
        label={label}
        hint={hint}
        placeholder={placeholder}
        value={text}
        autoCapitalize={prefix ? 'none' : 'sentences'}
        autoCorrect={false}
        returnKeyType="done"
        submitBehavior="submit"
        onChangeText={(t) => {
          // a comma finishes an entry, so several can be typed in a row
          if (/[,\n]/.test(t)) {
            const parts = t.split(/[,\n]/);
            const rest = parts.pop() ?? '';
            add(splitNames(parts.join(',')));
            onChangeText(rest.trimStart());
          } else {
            onChangeText(t);
          }
        }}
        onSubmitEditing={() => {
          add(splitNames(text));
          onChangeText('');
        }}
      />
      {values.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {values.map((v) => (
            <Chip
              key={v}
              text={prefix + v}
              icon="close"
              selected
              accessibilityLabel={`Remove ${v}`}
              onPress={() => onChange(values.filter((x) => x !== v))}
            />
          ))}
        </View>
      ) : null}
      {suggestions.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' }}>
          <Text style={{ color: c.muted, fontSize: font.small }}>Add:</Text>
          {suggestions.map((s) => (
            <Chip
              key={s}
              text={prefix + s}
              icon="plus"
              accessibilityLabel={`Add ${s}`}
              onPress={() => {
                add([s]);
                onChangeText('');
              }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** The tags and other names being edited on the add and edit item screens. */
export function useItemNames(initial: { tags: string[]; aliases: string[] } = { tags: [], aliases: [] }) {
  const [tags, setTags] = useState(initial.tags);
  const [tagText, setTagText] = useState('');
  const [aliases, setAliases] = useState(initial.aliases);
  const [aliasText, setAliasText] = useState('');
  return {
    tags, setTags, tagText, setTagText, aliases, setAliases, aliasText, setAliasText,
    /** what to save, including anything still typed in the boxes, or the reason it can't be saved */
    result(): { tags: string[]; aliases: string[]; problem: string } {
      const t = tidyTags([...tags, ...splitNames(tagText)]);
      const a = tidyAliases([...aliases, ...splitNames(aliasText)]);
      return { tags: t, aliases: a, problem: namesProblem(a, 'alias') || namesProblem(t, 'tag') };
    },
    /** empties the boxes; keepTags leaves the chosen tags for the next item */
    reset(keepTags: boolean) {
      if (!keepTags) setTags([]);
      setTagText('');
      setAliases([]);
      setAliasText('');
    },
  };
}

export function ItemNamesFields({ names }: { names: ReturnType<typeof useItemNames> }) {
  const { tags: inUse } = useData();
  const suggestions = suggestTags(
    inUse.map((t) => t.tag),
    names.tags,
    names.tagText,
    names.tagText.trim() ? 6 : 10,
  );
  return (
    <>
      <NamesField
        label="Also called (optional)"
        hint="Other names people use for it, so search finds it either way."
        placeholder="e.g. Hoover, the Dyson"
        values={names.aliases}
        onChange={names.setAliases}
        text={names.aliasText}
        onChangeText={names.setAliasText}
        tidy={tidyAliases}
      />
      <NamesField
        label="Tags (optional)"
        hint={inUse.length ? undefined : 'Group things, like tools, christmas or camping. Separate tags with commas.'}
        placeholder="e.g. tools, camping"
        values={names.tags}
        onChange={names.setTags}
        text={names.tagText}
        onChangeText={names.setTagText}
        tidy={tidyTags}
        suggestions={suggestions}
        prefix="#"
      />
    </>
  );
}

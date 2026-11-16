import { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { errorMessage } from "@/lib/client";
import { useData } from "@/lib/data";
import {
  descendants,
  parsePlaceInput,
  PATH_SEPARATOR,
  placeTree,
  resolvePlaceInput,
} from "@/lib/places";
import { normalize } from "@/lib/search";
import { font, space, useColors } from "./theme";
import { Button, ErrorText, Field, Icon, IconButton } from "./ui";

type Props = {
  visible: boolean;
  title: string;
  /** The place currently chosen, highlighted in the list. */
  current?: string;
  /** Hide this place and everything inside it (when choosing where a place goes). */
  exclude?: string;
  /** Offer "Top level" / "Not sure yet" as a choice, returned as "". */
  noneLabel?: string;
  onPick: (placeId: string) => void;
  onClose: () => void;
};

export function PlacePicker({
  visible,
  title,
  current,
  exclude,
  noneLabel,
  onPick,
  onClose,
}: Props) {
  const c = useColors();
  const { places, label, ensurePlace } = useData();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // adding a place by name: null = not adding, '' = at the top level, an id = inside that place
  const [addingIn, setAddingIn] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  const rows = useMemo(() => {
    const hidden = exclude
      ? new Set([exclude, ...descendants(places, exclude)])
      : new Set<string>();
    const tree = placeTree(places).filter((r) => !hidden.has(r.place.id));
    const words = normalize(query).split(/\s+/).filter(Boolean);
    if (!words.length)
      return tree.map((r) => ({
        id: r.place.id,
        depth: r.depth,
        text: r.place.name,
      }));
    // search across the whole path, so "garage shelf" finds Garage › Shelf 3
    return tree
      .map((r) => ({ id: r.place.id, depth: 0, text: label(r.place.id) }))
      .filter((r) => words.every((w) => normalize(r.text).includes(w)));
  }, [places, query, exclude, label]);

  const typed = parsePlaceInput(query);
  const plan = typed.length ? resolvePlaceInput(places, typed) : null;
  const canCreate = !!plan && plan.toCreate.length > 0;

  const reset = () => {
    setQuery("");
    setError("");
    setAddingIn(null);
    setNewName("");
  };
  const close = () => {
    reset();
    onClose();
  };
  const pick = (id: string) => {
    reset();
    onPick(id);
  };
  const startAdding = (parent: string) => {
    setAddingIn(parent);
    setNewName("");
    setError("");
  };
  const addNamed = async () => {
    if (addingIn === null || !newName.trim()) return;
    setBusy(true);
    setError("");
    try {
      pick(await ensurePlace(newName, addingIn || undefined));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const create = async () => {
    setBusy(true);
    setError("");
    try {
      pick(await ensurePlace(query));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            padding: space.md,
            gap: space.sm,
          }}
        >
          <IconButton icon="close" label="Close" onPress={close} />
          <Text
            style={{
              color: c.text,
              fontSize: font.title,
              fontWeight: "700",
              flex: 1,
            }}
          >
            {title}
          </Text>
        </View>
        {addingIn !== null ? (
          <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
            <Field
              label={
                addingIn ? `New place inside ${label(addingIn)}` : "New place"
              }
              value={newName}
              onChangeText={setNewName}
              placeholder={addingIn ? "e.g. Top drawer" : "e.g. Garage"}
              hint="Type Shelf 2 > Blue box to add both."
              autoFocus
              returnKeyType="done"
              onSubmitEditing={addNamed}
            />
            <ErrorText>{error}</ErrorText>
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <Button
                title="Add place"
                icon="plus"
                busy={busy}
                disabled={!newName.trim()}
                onPress={addNamed}
                style={{ flex: 1 }}
              />
              <Button
                title="Back"
                kind="secondary"
                onPress={() => setAddingIn(null)}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        ) : (
          <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
            <Field
              value={query}
              onChangeText={setQuery}
              placeholder="Search or type a new place"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() =>
                canCreate ? create() : rows[0] && pick(rows[0].id)
              }
              hint={
                places.length
                  ? undefined
                  : "Tip: type Garage > Shelf 3 to create both at once."
              }
            />
            {canCreate ? (
              <Button
                kind="secondary"
                icon="plus"
                busy={busy}
                title={`Add ${typed.join(PATH_SEPARATOR)}`}
                onPress={create}
              />
            ) : null}
            {!query ? (
              <Button
                kind="secondary"
                icon="plus"
                title="New place"
                onPress={() => startAdding("")}
              />
            ) : null}
            <ErrorText>{error}</ErrorText>
          </View>
        )}
        {addingIn !== null ? null : (
          <FlatList
            keyboardShouldPersistTaps="handled"
            style={{ marginTop: space.sm }}
            data={rows}
            keyExtractor={(r) => r.id}
            ListHeaderComponent={
              noneLabel && !query ? (
                <Row
                  text={noneLabel}
                  depth={0}
                  selected={!current}
                  onPress={() => pick("")}
                  icon="help-circle-outline"
                />
              ) : undefined
            }
            renderItem={({ item }) => (
              <Row
                text={item.text}
                depth={item.depth}
                selected={item.id === current}
                onPress={() => pick(item.id)}
                onAddInside={() => startAdding(item.id)}
                addLabel={`Add a place inside ${label(item.id)}`}
              />
            )}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

function Row({
  text,
  depth,
  selected,
  onPress,
  icon,
  onAddInside,
  addLabel,
}: {
  text: string;
  depth: number;
  selected: boolean;
  onPress: () => void;
  icon?: "help-circle-outline";
  onAddInside?: () => void;
  addLabel?: string;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        paddingVertical: 14,
        paddingRight: space.lg,
        paddingLeft: space.lg + depth * 20,
        backgroundColor: pressed || selected ? c.accentSoft : "transparent",
      })}
    >
      <Icon
        name={
          icon ?? (depth ? "subdirectory-arrow-right" : "map-marker-outline")
        }
        size={18}
        color={c.muted}
      />
      <Text style={{ color: c.text, fontSize: font.body, flex: 1 }}>
        {text}
      </Text>
      {selected ? <Icon name="check" size={20} color={c.accent} /> : null}
      {onAddInside ? (
        <IconButton
          icon="plus-box-outline"
          label={addLabel ?? "Add a place inside"}
          onPress={onAddInside}
        />
      ) : null}
    </Pressable>
  );
}

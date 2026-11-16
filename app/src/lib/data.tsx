import AsyncStorage from '@react-native-async-storage/async-storage';
import PocketBase, { RecordModel, RecordSubscription } from 'pocketbase';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { asNames, tagCounts } from './names';
import { parsePlaceInput, PlaceMap, placeLabel, placeMap, resolvePlaceInput } from './places';
import type { Item, Member, Move, Place } from './types';

export type Photo = { uri: string; mimeType?: string };

type Status = 'loading' | 'live' | 'offline' | 'phone';

export type Data = {
  status: Status;
  savedAt: string;
  places: Place[];
  items: Item[];
  members: Member[];
  map: PlaceMap;
  label(placeId: string): string;
  memberName(id: string): string;
  photoUrl(item: Item, thumb?: '200x200' | '800x0'): string;
  reload(): Promise<void>;
  /** every tag in use in the household, most used first */
  tags: { tag: string; count: number }[];
  addItem(input: { name: string; note?: string; tags?: string[]; aliases?: string[]; place: string; photo?: Photo | null }): Promise<Item>;
  updateItem(id: string, patch: Partial<Pick<Item, 'name' | 'note' | 'place' | 'tags' | 'aliases'>>, photo?: Photo | null): Promise<Item>;
  moveItems(ids: string[], placeId: string): Promise<void>;
  deleteItem(id: string): Promise<void>;
  addPlace(name: string, parent: string): Promise<Place>;
  /** Finds or creates the places typed as "Garage > Shelf 3", returning the deepest one's id. */
  ensurePlace(text: string, insideId?: string): Promise<string>;
  updatePlace(id: string, patch: Partial<Pick<Place, 'name' | 'note' | 'parent' | 'label_at' | 'nfc_at'>>): Promise<Place>;
  /** Notes that labels were printed (or stickers written) for these places, so the admin can see which still need one. */
  markLabeled(ids: string[], how: 'label' | 'nfc'): Promise<void>;
  deletePlace(id: string): Promise<void>;
  history(itemId: string): Promise<Move[]>;
  /** The item someone picked up (scanned or chose "Move with a label") and is about to put somewhere. */
  carrying: string;
  setCarrying(itemId: string): void;
};

export const DataContext = createContext<Data | null>(null);

export function useData(): Data {
  const d = useContext(DataContext);
  if (!d) throw new Error('useData outside DataProvider');
  return d;
}

function pick<T>(r: RecordModel, keys: (keyof T)[]): T {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k as string] = r[k as string] ?? '';
  return out as T;
}
const toPlace = (r: RecordModel) => pick<Place>(r, ['id', 'household', 'name', 'note', 'parent', 'updated', 'label_at', 'nfc_at']);
const toItem = (r: RecordModel): Item => ({
  ...pick<Item>(r, ['id', 'household', 'name', 'note', 'photo', 'place', 'moved_by', 'moved_at', 'updated', 'collectionId']),
  // null on items saved before tags existed, and missing from older offline copies
  tags: asNames(r.tags),
  aliases: asNames(r.aliases),
});
const toMember = (r: RecordModel) => pick<Member>(r, ['id', 'name', 'email', 'avatar', 'collectionId']);

function upsert<T extends { id: string }>(list: T[], rec: T): T[] {
  const i = list.findIndex((x) => x.id === rec.id);
  if (i < 0) return [rec, ...list];
  const copy = list.slice();
  copy[i] = rec;
  return copy;
}

type Cache = { places: Place[]; items: Item[]; members: Member[]; savedAt: string };

type Fields = Record<string, string | string[]>;

export async function photoForm(fields: Fields, photo: Photo): Promise<FormData> {
  const form = new FormData();
  // lists go as JSON text, which the server reads back as a list
  for (const [k, v] of Object.entries(fields)) form.append(k, typeof v === 'string' ? v : JSON.stringify(v));
  const type = photo.mimeType || 'image/jpeg';
  const ext = type.split('/')[1] || 'jpg';
  if (Platform.OS === 'web') {
    // in a browser the picked photo is a blob: or data: URL
    const blob = await (await fetch(photo.uri)).blob();
    form.append('photo', blob, `photo.${ext}`);
  } else {
    // React Native's FormData takes a file as {uri, name, type}
    form.append('photo', { uri: photo.uri, name: `photo.${ext}`, type } as unknown as Blob);
  }
  return form;
}

export function DataProvider({ pb, household, children }: { pb: PocketBase; household: string; children: ReactNode }) {
  const cacheKey = `whereis.cache.${pb.baseURL}.${household}`;
  const [status, setStatus] = useState<Status>('loading');
  const [savedAt, setSavedAt] = useState('');
  const [places, setPlaces] = useState<Place[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [carrying, setCarrying] = useState('');
  const loaded = useRef(false);
  // photos are protected files: their URLs need a short-lived file token
  const [fileToken, setFileToken] = useState('');
  const fileTokenAt = useRef(0);

  // show what we had last time straight away
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(cacheKey)
      .then((raw) => {
        if (cancelled || !raw || loaded.current) return;
        const c = JSON.parse(raw) as Cache;
        setPlaces(c.places);
        setItems(c.items.map((i) => toItem(i as unknown as RecordModel)));
        setMembers(c.members);
        setSavedAt(c.savedAt);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [cacheKey]);

  const reload = useCallback(async () => {
    try {
      const filter = pb.filter('household = {:h}', { h: household });
      const [p, i, m] = await Promise.all([
        pb.collection('places').getFullList({ filter, batch: 500 }),
        pb.collection('items').getFullList({ filter, sort: '-updated', batch: 500 }),
        pb.collection('users').getFullList({ filter }),
      ]);
      const next: Cache = { places: p.map(toPlace), items: i.map(toItem), members: m.map(toMember), savedAt: new Date().toISOString() };
      loaded.current = true;
      setPlaces(next.places);
      setItems(next.items);
      setMembers(next.members);
      setSavedAt(next.savedAt);
      setStatus('live');
      AsyncStorage.setItem(cacheKey, JSON.stringify(next)).catch(() => {});
    } catch {
      setStatus('offline');
    }
  }, [pb, household, cacheKey]);

  // live updates from the rest of the family
  useEffect(() => {
    reload();
    const onPlace = (e: RecordSubscription<RecordModel>) => {
      if (e.record.household !== household) return;
      setPlaces((list) => (e.action === 'delete' ? list.filter((x) => x.id !== e.record.id) : upsert(list, toPlace(e.record))));
    };
    const onItem = (e: RecordSubscription<RecordModel>) => {
      if (e.record.household !== household) return;
      setItems((list) => (e.action === 'delete' ? list.filter((x) => x.id !== e.record.id) : upsert(list, toItem(e.record))));
    };
    // someone joins, renames themselves or changes their picture
    const onMember = (e: RecordSubscription<RecordModel>) => {
      if (e.action === 'delete' || e.record.household !== household) {
        setMembers((list) => list.filter((x) => x.id !== e.record.id));
      } else {
        setMembers((list) => upsert(list, toMember(e.record)));
      }
    };
    const subs = [
      pb.collection('places').subscribe('*', onPlace),
      pb.collection('items').subscribe('*', onItem),
      pb.collection('users').subscribe('*', onMember),
    ];
    const appState = AppState.addEventListener('change', (s) => {
      if (s === 'active') reload();
    });
    return () => {
      appState.remove();
      for (const s of subs) s.then((unsub) => unsub()).catch(() => {});
    };
  }, [pb, household, reload]);

  // keep the offline copy in step with live changes
  useEffect(() => {
    if (!loaded.current) return;
    const t = setTimeout(() => {
      AsyncStorage.setItem(cacheKey, JSON.stringify({ places, items, members, savedAt } satisfies Cache)).catch(() => {});
    }, 1000);
    return () => clearTimeout(t);
  }, [places, items, members, savedAt, cacheKey]);

  const map = useMemo(() => placeMap(places), [places]);
  const tags = useMemo(() => tagCounts(items), [items]);
  const label = useCallback((id: string) => (id ? placeLabel(map, id) : ''), [map]);
  const memberName = useCallback(
    (id: string) => {
      const m = members.find((x) => x.id === id);
      return m ? m.name || m.email || 'Someone' : '';
    },
    [members],
  );
  // the server's file tokens last an hour; get a new one well before that
  const renewFileToken = useCallback(async () => {
    if (Date.now() - fileTokenAt.current < 45 * 60_000) return;
    try {
      const token = await pb.files.getToken();
      fileTokenAt.current = Date.now();
      setFileToken(token);
    } catch {
      // offline: photos show again once the server can be reached
    }
  }, [pb]);
  useEffect(() => {
    renewFileToken();
    const timer = setInterval(renewFileToken, 5 * 60_000);
    const appState = AppState.addEventListener('change', (s) => {
      if (s === 'active') renewFileToken();
    });
    return () => {
      clearInterval(timer);
      appState.remove();
    };
  }, [renewFileToken]);

  const photoUrl = useCallback(
    (item: Item, thumb?: '200x200' | '800x0') => {
      if (!item.photo || !fileToken) return '';
      const record = { id: item.id, collectionId: item.collectionId, collectionName: 'items' };
      return pb.files.getURL(record, item.photo, { token: fileToken, ...(thumb ? { thumb } : {}) });
    },
    [pb, fileToken],
  );

  const addItem = useCallback<Data['addItem']>(
    async ({ name, note = '', tags = [], aliases = [], place, photo }) => {
      const fields = { household, name: name.trim(), note: note.trim(), tags, aliases, place };
      const rec = photo
        ? await pb.collection('items').create(await photoForm(fields, photo))
        : await pb.collection('items').create(fields);
      const item = toItem(rec);
      setItems((list) => upsert(list, item));
      return item;
    },
    [pb, household],
  );

  const updateItem = useCallback<Data['updateItem']>(
    async (id, patch, photo) => {
      const fields: Fields = {};
      for (const [k, v] of Object.entries(patch)) fields[k] = Array.isArray(v) ? v : typeof v === 'string' ? v.trim() : '';
      let rec: RecordModel;
      if (photo) rec = await pb.collection('items').update(id, await photoForm(fields, photo));
      else if (photo === null) rec = await pb.collection('items').update(id, { ...fields, photo: null });
      else rec = await pb.collection('items').update(id, fields);
      const item = toItem(rec);
      setItems((list) => upsert(list, item));
      return item;
    },
    [pb],
  );

  const moveItems = useCallback<Data['moveItems']>(
    async (ids, placeId) => {
      // one server call: either every item moves (with its history) or none does
      const results = await pb.send<RecordModel[]>('/api/whereis/move', {
        method: 'POST',
        body: { items: ids, place: placeId },
      });
      setItems((list) => results.reduce((acc, r) => upsert(acc, toItem(r)), list));
    },
    [pb],
  );

  const deleteItem = useCallback<Data['deleteItem']>(
    async (id) => {
      await pb.collection('items').delete(id);
      setItems((list) => list.filter((x) => x.id !== id));
    },
    [pb],
  );

  const addPlace = useCallback<Data['addPlace']>(
    async (name, parent) => {
      const rec = await pb.collection('places').create({ household, name: name.trim(), parent });
      const place = toPlace(rec);
      setPlaces((list) => upsert(list, place));
      return place;
    },
    [pb, household],
  );

  const ensurePlace = useCallback<Data['ensurePlace']>(
    async (text, insideId = '') => {
      const names = parsePlaceInput(text);
      if (!names.length) throw new Error('Type a place name.');
      let { parentId, toCreate } = resolvePlaceInput(places, names, insideId);
      for (const name of toCreate) {
        parentId = (await addPlace(name, parentId)).id;
      }
      return parentId;
    },
    [places, addPlace],
  );

  const updatePlace = useCallback<Data['updatePlace']>(
    async (id, patch) => {
      const rec = await pb.collection('places').update(id, patch);
      const place = toPlace(rec);
      setPlaces((list) => upsert(list, place));
      return place;
    },
    [pb],
  );

  const deletePlace = useCallback<Data['deletePlace']>(
    async (id) => {
      await pb.collection('places').delete(id);
      setPlaces((list) => list.filter((x) => x.id !== id));
    },
    [pb],
  );

  const markLabeled = useCallback<Data['markLabeled']>(
    async (ids, how) => {
      const now = new Date().toISOString().replace('T', ' ');
      const field = how === 'nfc' ? 'nfc_at' : 'label_at';
      // one at a time is fine: a sheet of labels is tens of places, not thousands
      for (const id of ids) {
        try {
          await updatePlace(id, { [field]: now });
        } catch {
          // a place deleted meanwhile, or offline: the label itself still works
        }
      }
    },
    [updatePlace],
  );

  const history = useCallback<Data['history']>(
    async (itemId) => {
      const list = await pb.collection('moves').getList(1, 20, {
        filter: pb.filter('item = {:id}', { id: itemId }),
        sort: '-created',
      });
      return list.items.map((r) => pick<Move>(r, ['id', 'item', 'from_place', 'to_place', 'from_name', 'to_name', 'by', 'created']));
    },
    [pb],
  );

  const value = useMemo<Data>(
    () => ({
      status, savedAt, places, items, members, map, tags, label, memberName, photoUrl, reload,
      addItem, updateItem, moveItems, deleteItem, addPlace, ensurePlace, updatePlace, deletePlace, markLabeled, history,
      carrying, setCarrying,
    }),
    [status, savedAt, places, items, members, map, tags, label, memberName, photoUrl, reload,
      addItem, updateItem, moveItems, deleteItem, addPlace, ensurePlace, updatePlace, deletePlace, markLabeled, history, carrying],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

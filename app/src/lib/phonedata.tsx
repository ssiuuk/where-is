import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Data, DataContext } from './data';
import { tagCounts } from './names';
import { deletePhoto, keepPhoto, loadPhoneData, photoFileUri, savePhoneData } from './phonefiles';
import * as store from './phonestore';
import { parsePlaceInput, placeLabel, placeMap, resolvePlaceInput } from './places';

/**
 * The same data the screens get from a server (see DataProvider), kept on
 * this phone instead. Every change is saved to the phone before it shows.
 */
export function PhoneDataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<store.PhoneData>(store.emptyPhoneData);
  const [status, setStatus] = useState<'loading' | 'phone'>('loading');
  const [savedAt, setSavedAt] = useState('');
  const [carrying, setCarrying] = useState('');
  // the latest data, for changes made one after another before a re-render
  const current = useRef(data);
  // saves happen one at a time, in order
  const queue = useRef<Promise<void>>(Promise.resolve());

  const reload = useCallback(async () => {
    try {
      const d = await loadPhoneData();
      current.current = d;
      setData(d);
    } finally {
      setStatus('phone');
    }
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);

  /** Applies a change, saves it, and only then shows it. */
  const commit = useCallback(async <T,>(change: (d: store.PhoneData) => [store.PhoneData, T]): Promise<T> => {
    const run = queue.current.then(async () => {
      const [next, result] = change(current.current);
      await savePhoneData(next);
      current.current = next;
      setData(next);
      setSavedAt(store.stamp());
      return result;
    });
    queue.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }, []);

  const map = useMemo(() => placeMap(data.places), [data.places]);
  const tags = useMemo(() => tagCounts(data.items), [data.items]);
  const label = useCallback((id: string) => (id ? placeLabel(map, id) : ''), [map]);
  const memberName = useCallback(() => '', []);
  const photoUrl = useCallback<Data['photoUrl']>((item) => photoFileUri(item.photo), []);

  const addItem = useCallback<Data['addItem']>(
    async ({ photo, ...input }) => {
      // the photo is copied in first, under the id the item will get
      const id = store.newId();
      const name = photo ? await keepPhoto(photo.uri, id) : '';
      try {
        return await commit((d) => store.addItem(d, { ...input, id, photo: name }));
      } catch (e) {
        deletePhoto(name);
        throw e;
      }
    },
    [commit],
  );

  const updateItem = useCallback<Data['updateItem']>(
    async (id, patch, photo) => {
      const old = current.current.items.find((i) => i.id === id)?.photo ?? '';
      const name = photo ? await keepPhoto(photo.uri, id) : photo === null ? '' : undefined;
      try {
        const item = await commit((d) => store.updateItem(d, id, name === undefined ? patch : { ...patch, photo: name }));
        if (name !== undefined && old && old !== name) deletePhoto(old);
        return item;
      } catch (e) {
        if (name) deletePhoto(name);
        throw e;
      }
    },
    [commit],
  );

  const moveItems = useCallback<Data['moveItems']>((ids, place) => commit((d) => [store.moveItems(d, ids, place), undefined]), [commit]);

  const deleteItem = useCallback<Data['deleteItem']>(
    async (id) => {
      const photo = current.current.items.find((i) => i.id === id)?.photo ?? '';
      await commit((d) => [store.deleteItem(d, id), undefined]);
      deletePhoto(photo);
    },
    [commit],
  );

  const addPlace = useCallback<Data['addPlace']>((name, parent) => commit((d) => store.addPlace(d, { name, parent })), [commit]);

  const ensurePlace = useCallback<Data['ensurePlace']>(
    async (text, insideId = '') => {
      const names = parsePlaceInput(text);
      if (!names.length) throw new Error('Type a place name.');
      let { parentId, toCreate } = resolvePlaceInput(current.current.places, names, insideId);
      for (const name of toCreate) parentId = (await addPlace(name, parentId)).id;
      return parentId;
    },
    [addPlace],
  );

  const updatePlace = useCallback<Data['updatePlace']>((id, patch) => commit((d) => store.updatePlace(d, id, patch)), [commit]);
  const deletePlace = useCallback<Data['deletePlace']>((id) => commit((d) => [store.deletePlace(d, id), undefined]), [commit]);

  const markLabeled = useCallback<Data['markLabeled']>(
    async (ids, how) => {
      const at = store.stamp();
      const field = how === 'nfc' ? 'nfc_at' : 'label_at';
      await commit((d) => {
        let next = d;
        for (const id of ids) if (next.places.some((p) => p.id === id)) [next] = store.updatePlace(next, id, { [field]: at });
        return [next, undefined];
      });
    },
    [commit],
  );

  const history = useCallback<Data['history']>(async (itemId) => store.history(current.current, itemId), []);

  const value = useMemo<Data>(
    () => ({
      status, savedAt, places: data.places, items: data.items, members: [], map, tags, label, memberName, photoUrl, reload,
      addItem, updateItem, moveItems, deleteItem, addPlace, ensurePlace, updatePlace, deletePlace, markLabeled, history,
      carrying, setCarrying,
    }),
    [status, savedAt, data, map, tags, label, memberName, photoUrl, reload,
      addItem, updateItem, moveItems, deleteItem, addPlace, ensurePlace, updatePlace, deletePlace, markLabeled, history, carrying],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

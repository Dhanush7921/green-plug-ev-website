import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, get } from './api';

/** Loads JSON from the API; reload() refetches. */
export function useApi<T = any>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const n = ++seq.current;
    setLoading(true);
    try {
      const r = await get<T>(path);
      if (n === seq.current) {
        setData(r);
        setError(null);
      }
    } catch (e) {
      if (n === seq.current) setError(e as ApiError);
    } finally {
      if (n === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => {
    load();
  }, [load]);
  return { data, error, loading, reload: load, setData };
}

/**
 * Form state that survives navigation and SWITCH MODE: drafts are kept in sessionStorage per key
 * until the form is submitted (clear()).
 */
export function useDraft<T extends object>(key: string, initial: T) {
  const storageKey = `gpev-draft:${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      return raw ? { ...initial, ...JSON.parse(raw) } : initial;
    } catch {
      return initial;
    }
  });
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      /* storage full or unavailable */
    }
  }, [value, dirty, storageKey]);
  const update = useCallback((patch: Partial<T>) => {
    setDirty(true);
    setValue((v) => ({ ...v, ...patch }));
  }, []);
  const clear = useCallback(() => {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
    setDirty(false);
  }, [storageKey]);
  const hasDraft = (() => {
    try {
      return !!sessionStorage.getItem(storageKey);
    } catch {
      return false;
    }
  })();
  return { value, update, setValue, clear, dirty, hasDraft };
}

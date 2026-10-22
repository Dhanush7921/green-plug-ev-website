// Media-query and user-preference helpers shared by the cursor, motion and 3D code.
import { useSyncExternalStore } from 'react';

const REDUCED = '(prefers-reduced-motion: reduce)';
const FINE = '(hover: hover) and (pointer: fine)';
const EFFECTS_KEY = 'gpev-effects';

function mq(query: string) {
  return typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query) : null;
}

export const prefersReducedMotion = () => !!mq(REDUCED)?.matches;
export const hasFinePointer = () => !!mq(FINE)?.matches;

function useMedia(query: string) {
  return useSyncExternalStore(
    (cb) => {
      const m = mq(query);
      m?.addEventListener('change', cb);
      return () => m?.removeEventListener('change', cb);
    },
    () => !!mq(query)?.matches,
    () => false,
  );
}

export const useReducedMotion = () => useMedia(REDUCED);
export const useFinePointer = () => useMedia(FINE);

// "Pointer effects" switch in the footer: lets anyone fall back to the normal cursor.
const listeners = new Set<() => void>();
function readEffects(): boolean {
  try {
    return localStorage.getItem(EFFECTS_KEY) !== 'off';
  } catch {
    return true;
  }
}
let effectsOn = typeof window !== 'undefined' ? readEffects() : true;

export function setPointerEffects(on: boolean) {
  effectsOn = on;
  try {
    localStorage.setItem(EFFECTS_KEY, on ? 'on' : 'off');
  } catch {
    /* storage unavailable: keep the in-memory value */
  }
  listeners.forEach((l) => l());
}

export function usePointerEffects() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => effectsOn,
    () => true,
  );
}

/** True when the rich desktop pointer system should run. */
export function useRichPointer() {
  const fine = useFinePointer();
  const reduced = useReducedMotion();
  const on = usePointerEffects();
  return fine && !reduced && on;
}

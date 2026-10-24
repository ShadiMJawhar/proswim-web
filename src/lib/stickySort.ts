// Grid sort that survives refreshes, saves and coming back from a form: the
// chosen column + direction are remembered per grid in the browser (like the
// legacy pages kept the sort in the session), and restored when the grid opens.

import { useEffect, useState } from 'react';

type Saved = { k?: unknown; asc?: unknown } | null;

function read(storageKey: string): Saved {
  try { return JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Saved; } catch { return null; }
}

/** Drop-in for `useState(sortKey)` + `useState(sortAsc)`:
 *  `const [sortKey, setSortKey, sortAsc, setSortAsc] = useStickySort('students', 'name');` */
export function useStickySort<K>(gridKey: string, defaultKey: K, defaultAsc = true) {
  const storageKey = `sort.${gridKey}`;
  const [sortKey, setSortKey] = useState<K>(() => {
    const s = read(storageKey);
    return s && typeof s.k === 'string' ? (s.k as unknown as K) : defaultKey;
  });
  const [sortAsc, setSortAsc] = useState<boolean>(() => {
    const s = read(storageKey);
    return s && typeof s.asc === 'boolean' ? s.asc : defaultAsc;
  });
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify({ k: sortKey, asc: sortAsc })); } catch { /* private mode: sort just isn't remembered */ }
  }, [storageKey, sortKey, sortAsc]);
  return [sortKey, setSortKey, sortAsc, setSortAsc] as const;
}

/** A per-route grid id (the page path without record ids or the deploy base). */
export function routeGridKey(): string {
  return window.location.pathname.replace(/^\/V27_WEB/i, '').replace(/\/\d+(?=\/|$)/g, '/:id') || '/';
}

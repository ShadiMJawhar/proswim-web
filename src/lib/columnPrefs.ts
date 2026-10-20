// Per-user grid column choice, stored in the database (tbl_Portal_UserPrefs
// through /api/portal/prefs/{key}) so it follows the user across browsers.
//
// Only the columns the user actually toggled are stored ({ key: shown }), so
// a column added to a page later still appears with its default visibility.

import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../api/portalApi';

export type ColumnChoice = Record<string, boolean>;

/** Turns any page id (endpoint, title) into a valid prefs key. */
export function columnPrefKey(id: string): string {
  const slug = id.replace(/^\/?api\/portal\//, '').replace(/[^A-Za-z0-9_.:-]+/g, '.').replace(/\.+/g, '.').replace(/^\.|\.$/g, '');
  return ('cols.' + slug).slice(0, 100);
}

export function useColumnPrefs(prefKey: string) {
  const [choice, setChoice] = useState<ColumnChoice>({});
  const [loaded, setLoaded] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    apiRequest<{ value: unknown }>(`/api/portal/prefs/${encodeURIComponent(prefKey)}`)
      .then((d) => {
        if (!alive) return;
        const v = d?.value;
        const next: ColumnChoice = {};
        if (v && typeof v === 'object' && !Array.isArray(v))
          for (const [k, b] of Object.entries(v as Record<string, unknown>)) if (typeof b === 'boolean') next[k] = b;
        setChoice(next);
      })
      .catch(() => { /* no saved choice: defaults */ })
      .finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [prefKey]);

  function persist(next: ColumnChoice) {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const value = Object.keys(next).length ? next : null; // null deletes = back to defaults
      apiRequest(`/api/portal/prefs/${encodeURIComponent(prefKey)}`, { method: 'PUT', body: JSON.stringify({ value }) })
        .catch(() => { /* best effort; the choice still applies for this visit */ });
    }, 400);
  }

  function update(next: ColumnChoice) { setChoice(next); persist(next); }

  return {
    loaded,
    choice,
    /** Effective visibility: the user's choice, else the column's default. */
    isShown: (key: string, byDefault: boolean) => (key in choice ? choice[key] : byDefault),
    set: (key: string, shown: boolean) => update({ ...choice, [key]: shown }),
    setMany: (keys: string[], shown: boolean) => update({ ...choice, ...Object.fromEntries(keys.map((k) => [k, shown])) }),
    reset: () => update({}),
  };
}

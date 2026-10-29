// Per-user text/icon size for the schedules ("A−  125%  A+"). The chosen
// size is saved to the user's account (tbl_Portal_UserPrefs via
// /api/portal/prefs/zoom.<page>) and mirrored in localStorage so the page
// opens at the right size before the server answers. Applied as `--zs` on a
// `.text-zoom` wrapper (see index.css): fonts and icons scale, widths don't,
// so a wide schedule keeps its columns and never starts to scroll sideways.

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { apiRequest } from '../api/portalApi';

const STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6, 1.8, 2];

function readLocal(key: string): number {
  try {
    const v = Number(localStorage.getItem(key));
    return STEPS.includes(v) ? v : 1;
  } catch { return 1; }
}

export function useZoomPref(page: string) {
  const prefKey = `zoom.${page}`;
  const [zoom, setZoomState] = useState<number>(() => readLocal(prefKey));
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    apiRequest<{ value: unknown }>(`/api/portal/prefs/${encodeURIComponent(prefKey)}`)
      .then((d) => {
        if (!alive) return;
        const v = Number(d?.value);
        const z = STEPS.includes(v) ? v : 1;
        setZoomState(z);
        try { localStorage.setItem(prefKey, String(z)); } catch { /* ignore */ }
      })
      .catch(() => { /* keep the local copy */ });
    return () => { alive = false; };
  }, [prefKey]);

  function set(z: number) {
    setZoomState(z);
    try { localStorage.setItem(prefKey, String(z)); } catch { /* ignore */ }
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      apiRequest(`/api/portal/prefs/${encodeURIComponent(prefKey)}`, {
        method: 'PUT',
        body: JSON.stringify({ value: z === 1 ? null : z }),   // null deletes = default size
      }).catch(() => { /* best effort; the size still applies for this visit */ });
    }, 400);
  }

  const i = STEPS.indexOf(zoom);
  return {
    zoom,
    /** Put on the grid wrapper together with className "text-zoom". */
    style: { '--zs': zoom } as CSSProperties,
    set,
    canInc: i < STEPS.length - 1,
    canDec: i > 0,
    inc: () => { if (i < STEPS.length - 1) set(STEPS[i + 1]); },
    dec: () => { if (i > 0) set(STEPS[i - 1]); },
    reset: () => set(1),
  };
}

export function ZoomControl({ pref }: { pref: ReturnType<typeof useZoomPref> }) {
  const btn = 'rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50 hover:text-[#1e5c97] disabled:opacity-40 disabled:cursor-not-allowed';
  return (
    <div className="flex items-center gap-1" title="Text and icon size of the schedule (saved to your account)">
      <button type="button" onClick={pref.dec} disabled={!pref.canDec} title="Smaller" className={btn}>
        <ZoomOut className="size-4" />
      </button>
      <button type="button" onClick={pref.reset} title="Reset to 100%"
        className="min-w-12 text-center text-xs font-semibold text-slate-600 hover:text-[#1e5c97]">
        {Math.round(pref.zoom * 100)}%
      </button>
      <button type="button" onClick={pref.inc} disabled={!pref.canInc} title="Bigger" className={btn}>
        <ZoomIn className="size-4" />
      </button>
    </div>
  );
}

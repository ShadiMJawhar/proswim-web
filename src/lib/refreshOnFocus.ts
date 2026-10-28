// Re-run `reload` when the tab becomes visible or focused again. The schedules
// open records in their own tabs (like the legacy popups, which refreshed the
// opener on save); when the user comes back to the schedule tab it refreshes
// itself, throttled so a focus + visibility pair fires once.

import { useEffect, useRef } from 'react';

export function useRefreshOnFocus(reload: () => void, minMs = 1500): void {
  const last = useRef(Date.now());
  const fn = useRef(reload);
  fn.current = reload;
  useEffect(() => {
    const on = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - last.current < minMs) return;
      last.current = now;
      fn.current();
    };
    document.addEventListener('visibilitychange', on);
    window.addEventListener('focus', on);
    return () => {
      document.removeEventListener('visibilitychange', on);
      window.removeEventListener('focus', on);
    };
  }, [minMs]);
}

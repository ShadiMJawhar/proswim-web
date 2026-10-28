// Returning to a list "as the user left it". List filters live in the URL
// (ModuleListPage mirrors them; custom pages use useUrlParam), so going BACK
// in history restores them, whereas navigating to the bare list route would
// reload it with the defaults.

import { useNavigate, type NavigateFunction } from 'react-router-dom';

// react-router stamps an `idx` into history.state; 0 = the first in-app entry,
// so anything higher means there is an in-app page to go back to.
export function canGoBack(): boolean {
  return typeof window !== 'undefined' && ((window.history.state?.idx ?? 0) > 0);
}

/** Spread on a <Link> that should open in its own tab (legacy popups): the
 *  list or schedule underneath stays as the user left it, and rel=opener lets
 *  the new tab close itself to come back (closeOrGo / SmartBack "Close"). */
export const NEW_TAB = { target: '_blank', rel: 'opener' } as const;

/** True when this tab was opened from another tab of the app (the schedules
 *  open every link with target=_blank rel=opener, like the legacy popups) and
 *  nothing else has been visited in it yet, so closing it is "going back". */
export function isPopupTab(): boolean {
  return typeof window !== 'undefined' && !!window.opener && !canGoBack();
}

/** Back to where the user came from: the previous in-app page, else close the
 *  tab when it was opened from another tab, else `fallback`. */
export function closeOrGo(navigate: NavigateFunction, fallback: string): void {
  if (canGoBack()) { navigate(-1); return; }
  if (isPopupTab()) {
    window.close();
    // Browsers only close a tab whose history is a single page; if this one
    // is still open, fall back to the natural parent.
    window.setTimeout(() => { if (!window.closed) navigate(fallback); }, 250);
    return;
  }
  navigate(fallback);
}

/** After save/cancel: go back to the list the user came from (criteria intact),
 *  close the tab when it was opened from the schedule, or go to `fallback`
 *  when the page was opened directly (no in-app history). */
export function useBackTo(fallback: string): () => void {
  const navigate = useNavigate();
  return () => closeOrGo(navigate, fallback);
}

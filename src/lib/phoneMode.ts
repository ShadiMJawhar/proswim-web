// How phone numbers behave everywhere in the portal: open a WhatsApp chat or
// copy the number on click. One per-user setting (tbl_Portal_UserPrefs via
// /api/portal/prefs/phone.mode, "whatsapp" = default = no row) shared by all
// the PhoneText instances through a tiny external store, so a page with 200
// numbers makes one request, and the toggle updates every number at once.
// A localStorage copy makes the first paint right before the server answers.

import { useSyncExternalStore } from 'react';
import { apiRequest } from '../api/portalApi';

export type PhoneMode = 'whatsapp' | 'copy';

const KEY = 'phone.mode';
let mode: PhoneMode = readLocal();
let fetched = false;
const listeners = new Set<() => void>();

function readLocal(): PhoneMode {
  try { return localStorage.getItem(KEY) === 'copy' ? 'copy' : 'whatsapp'; } catch { return 'whatsapp'; }
}
function writeLocal(m: PhoneMode) {
  try { localStorage.setItem(KEY, m); } catch { /* ignore */ }
}
function emit() { for (const l of listeners) l(); }

function fetchOnce() {
  if (fetched) return;
  fetched = true;
  apiRequest<{ value: unknown }>(`/api/portal/prefs/${KEY}`)
    .then((d) => {
      const m: PhoneMode = d?.value === 'copy' ? 'copy' : 'whatsapp';
      writeLocal(m);
      if (m !== mode) { mode = m; emit(); }
    })
    .catch(() => { fetched = false; });   // try again on the next subscriber
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  fetchOnce();
  return () => { listeners.delete(cb); };
}

export function usePhoneMode(): PhoneMode {
  return useSyncExternalStore(subscribe, () => mode, () => 'whatsapp');
}

export function setPhoneMode(m: PhoneMode): void {
  if (m === mode) return;
  mode = m;
  writeLocal(m);
  emit();
  apiRequest(`/api/portal/prefs/${KEY}`, { method: 'PUT', body: JSON.stringify({ value: m === 'whatsapp' ? null : m }) })
    .catch(() => { /* best effort; the choice still applies for this visit */ });
}

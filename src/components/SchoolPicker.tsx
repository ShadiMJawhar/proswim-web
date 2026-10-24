// School picker for StudentSchool: a text box that filters the school master
// list (GET /api/portal/schools) as you type and only accepts a name from it.
// Users with saving rights (not guests) also get "Add new school: <name>" at
// the bottom, which adds the typed name (POST /api/portal/schools) and selects
// it without leaving the form, after the capitals rule, the junk guard and a
// "Did you mean …?" near-duplicate check (src/lib/schoolNames.ts).
// While the list is empty (tbl_Schools not set up yet) it is plain free text.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronsUpDown, Loader2, Plus, AlertCircle } from 'lucide-react';
import { ApiError, apiRequest, getStoredUser } from '../api/portalApi';
import { toast } from './Toast';
import {
  type School, JUNK_MESSAGE, capitalizeSchoolName, cleanName, filterSchools, findExactSchool,
  findSimilarSchool, isJunkSchoolName, loadSchools, rememberSchool,
} from '../lib/schoolNames';

const MAX_SHOWN = 80;

interface Props {
  value: string;
  onChange: (name: string) => void;
  disabled?: boolean;
  /** Input classes, so the picker matches the host form. */
  className?: string;
  /** Free-text fallback suggestions (the legacy datalist) while there is no list. */
  suggestions?: string[];
}

export function SchoolPicker({ value, onChange, disabled, className, suggestions }: Props) {
  const baseId = useId();
  const [schools, setSchools] = useState<School[] | null>(null); // null = loading
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [typed, setTyped] = useState(false);
  const [navigated, setNavigated] = useState(false);
  const [hi, setHi] = useState(0);
  const [similar, setSimilar] = useState<{ name: string; match: School } | null>(null);
  const [msg, setMsg] = useState('');
  const [adding, setAdding] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const mouseFocus = useRef(false);
  const closeLatest = useRef<() => void>(() => {});

  const user = getStoredUser();
  const canAdd = user?.canSave !== false && (user?.userType || '').toLowerCase() !== 'guest';

  useEffect(() => {
    let alive = true;
    loadSchools().then((l) => { if (alive) setSchools(l); }).catch(() => { if (alive) setSchools([]); });
    return () => { alive = false; };
  }, []);

  const list = useMemo(() => schools ?? [], [schools]);
  // Typed text that names a school exactly; before typing, the current school
  // (shown first so the list opens on it).
  const lead = findExactSchool(typed ? q : value, list);
  const matches = useMemo(() => {
    const m = filterSchools(typed ? q : '', list);
    return lead ? [lead, ...m.filter((s) => s !== lead)] : m;
  }, [typed, q, list, lead]);
  const shown = matches.slice(0, MAX_SHOWN);
  const newName = capitalizeSchoolName(q);
  const showAdd = canAdd && typed && newName !== '' && !lead && schools !== null;
  const optionCount = shown.length + (showAdd ? 1 : 0);
  // Highlighted row: none when the list just opened on an empty value.
  const active = typed || navigated || lead ? Math.min(hi, optionCount - 1) : -1;

  function openList() {
    setQ(value); setTyped(false); setNavigated(false); setHi(0); setSimilar(null); setMsg(''); setOpen(true);
  }

  function reset() {
    setOpen(false); setTyped(false); setNavigated(false); setSimilar(null); setMsg(''); setHi(0);
  }

  // Leaving the box: keep an exact match, allow clearing, otherwise revert.
  function commitAndClose() {
    if (typed) {
      if (!cleanName(q)) { if (value) onChange(''); }
      else if (lead && lead.schoolName !== value) onChange(lead.schoolName);
    }
    reset();
  }

  // Close on a click / tap outside (clicks inside the panel keep focus in the input).
  useEffect(() => { closeLatest.current = commitAndClose; });
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) closeLatest.current();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // ── Fallback: no list yet → the old free-text box with suggestions ─────────
  if (schools !== null && schools.length === 0) {
    const listId = suggestions?.length ? `${baseId}-dl` : undefined;
    return (
      <>
        <input value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={className} list={listId} />
        {listId && (
          <datalist id={listId}>
            {suggestions!.map((s, i) => <option key={`${i}-${s}`} value={s} />)}
          </datalist>
        )}
      </>
    );
  }

  function pick(s: School) {
    if (s.schoolName !== value) onChange(s.schoolName);
    reset();
  }

  function startAdd() {
    if (adding) return;
    setMsg('');
    const name = capitalizeSchoolName(q);
    const ex = findExactSchool(name, list);
    if (ex) { pick(ex); return; }
    if (isJunkSchoolName(name)) { setMsg(JUNK_MESSAGE); return; }
    const sim = findSimilarSchool(name, list);
    if (sim) { setSimilar({ name, match: sim }); return; }
    void add(name);
  }

  async function add(name: string) {
    setAdding(true);
    setMsg('');
    try {
      const s = await apiRequest<School>('/api/portal/schools', { method: 'POST', body: JSON.stringify({ name }) });
      rememberSchool(s);
      setSchools((cur) => [...(cur ?? []), s].sort((a, b) => a.schoolName.localeCompare(b.schoolName)));
      toast.success(`School "${s.schoolName}" added to the list.`);
      pick(s);
    } catch (e) {
      // Someone added it meanwhile: refresh and select it when it is active.
      if (e instanceof ApiError && e.status === 409) {
        try {
          const fresh = await loadSchools(true);
          setSchools(fresh);
          const ex = findExactSchool(name, fresh);
          if (ex) { pick(ex); return; }
        } catch { /* fall through to the message */ }
      }
      setSimilar(null);
      setMsg(e instanceof Error ? e.message : 'Could not add the school.');
    } finally {
      setAdding(false);
    }
  }

  function choose(i: number) {
    if (i < shown.length) pick(shown[i]);
    else if (showAdd) startAdd();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { openList(); return; }
      if (!optionCount || similar) return;
      const down = e.key === 'ArrowDown';
      const next = active < 0 ? (down ? 0 : optionCount - 1) : (active + (down ? 1 : -1) + optionCount) % optionCount;
      setHi(next);
      setNavigated(true);
      requestAnimationFrame(() => document.getElementById(`${baseId}-opt-${next}`)?.scrollIntoView({ block: 'nearest' }));
    } else if (e.key === 'Enter') {
      if (!open) return;
      e.preventDefault();
      if (similar || adding) return;
      // Nothing typed or chosen yet: Enter just closes (never picks row 1 by accident).
      if (!typed && !navigated) { reset(); return; }
      if (active >= 0) choose(active);
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); reset(); }
    } else if (e.key === 'Tab') {
      if (open) commitAndClose();
    }
  }

  const offList = !open && value !== '' && schools !== null && !findExactSchool(value, list);

  return (
    <div className="relative" ref={boxRef}>
      <div className="relative">
        <input
          role="combobox"
          aria-expanded={open}
          aria-controls={`${baseId}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && !similar && active >= 0 ? `${baseId}-opt-${active}` : undefined}
          value={open ? q : value}
          placeholder={schools === null ? 'Loading schools…' : 'Type to search the school list…'}
          onMouseDown={(e) => { mouseFocus.current = document.activeElement !== e.currentTarget; }}
          // A click that focused the box keeps the select-all from onFocus.
          onMouseUp={(e) => { if (mouseFocus.current) { e.preventDefault(); mouseFocus.current = false; } }}
          onFocus={(e) => { openList(); e.currentTarget.select(); }}
          onClick={() => { if (!open) openList(); }}
          onChange={(e) => { setQ(e.target.value); setTyped(true); setOpen(true); setHi(0); setSimilar(null); setMsg(''); }}
          onKeyDown={onKeyDown}
          disabled={disabled}
          className={className}
          style={{ paddingRight: '2rem' }}
          autoComplete="off"
          spellCheck={false}
        />
        <ChevronsUpDown className="size-4 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
      </div>
      {offList && (
        <p className="mt-1 text-[11px] text-amber-700">Not on the active school list. Pick one from the list if you change it.</p>
      )}

      {open && !disabled && (
        <div
          // Keep focus in the input while clicking inside the panel.
          onMouseDown={(e) => e.preventDefault()}
          className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg text-sm"
        >
          {similar ? (
            <div className="p-3 space-y-2">
              <p className="text-slate-700">
                Did you mean <b className="text-slate-900">{similar.match.schoolName}</b>?
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => pick(similar.match)}
                  className="rounded-lg bg-[#1e5c97] text-white text-xs font-semibold px-3 py-1.5 hover:bg-[#174a7c]"
                >
                  Use {similar.match.schoolName}
                </button>
                <button
                  type="button"
                  onClick={() => void add(similar.name)}
                  disabled={adding}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 text-slate-700 text-xs font-semibold px-3 py-1.5 hover:bg-slate-50 disabled:opacity-60"
                >
                  {adding && <Loader2 className="size-3.5 animate-spin" />}
                  Add &quot;{similar.name}&quot; as new anyway
                </button>
              </div>
            </div>
          ) : (
            <div id={`${baseId}-list`} role="listbox" className="max-h-64 overflow-y-auto py-1">
              {schools === null && (
                <p className="px-3 py-2 text-slate-400 flex items-center gap-2">
                  <Loader2 className="size-3.5 animate-spin" /> Loading schools…
                </p>
              )}
              {shown.map((s, i) => (
                <div
                  key={s.schoolId}
                  id={`${baseId}-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onClick={() => pick(s)}
                  onMouseEnter={() => setHi(i)}
                  className={`px-3 py-1.5 cursor-pointer ${i === active ? 'bg-slate-100' : ''} ${s.schoolName === value ? 'font-semibold text-[#1e5c97]' : 'text-slate-700'}`}
                >
                  {s.schoolName}
                </div>
              ))}
              {schools !== null && !shown.length && !showAdd && (
                <p className="px-3 py-2 text-slate-400">No school matches.</p>
              )}
              {matches.length > MAX_SHOWN && (
                <p className="px-3 py-1.5 text-[11px] text-slate-400">
                  Showing {MAX_SHOWN} of {matches.length}, keep typing to narrow the list.
                </p>
              )}
              {showAdd && (
                <div
                  id={`${baseId}-opt-${shown.length}`}
                  role="option"
                  aria-selected={active === shown.length}
                  onClick={startAdd}
                  onMouseEnter={() => setHi(shown.length)}
                  className={`px-3 py-2 border-t border-slate-100 cursor-pointer flex items-center gap-2 text-[#1e5c97] ${active === shown.length ? 'bg-slate-100' : ''}`}
                >
                  {adding ? <Loader2 className="size-4 animate-spin shrink-0" /> : <Plus className="size-4 shrink-0" />}
                  <span>Add new school: <b>{newName}</b></span>
                </div>
              )}
            </div>
          )}
          {msg && (
            <p className="flex items-start gap-1.5 px-3 py-2 border-t border-slate-100 text-xs text-red-600">
              <AlertCircle className="size-3.5 shrink-0 mt-px" /> {msg}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

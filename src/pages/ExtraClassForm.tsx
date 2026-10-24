// Extra class / membership form (legacy ExtraClasssIndividual.aspx): the pack
// fields, and on an existing pack its sessions — "Add Session" (generate over
// the ticked weekdays), the attendance grid with "Save Attendace", and
// "Renew Pack" (a new pack prefilled with the same location / student / type).

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Loader2, AlertCircle, Save, Search, CalendarPlus, RefreshCw, ArrowUp, ArrowDown, ArrowUpDown,
} from 'lucide-react';
import { apiRequest, getStoredUser } from '../api/portalApi';
import { DateInput } from '../components/DateInput';
import { PageHero } from '../components/PageHero';
import { SmartBack } from '../components/SmartBack';
import { toast } from '../components/Toast';
import { canGoBack } from '../lib/history';
import { toDate } from '../lib/dates';

import { useStickySort } from '../lib/stickySort';
type Row = Record<string, unknown>;
type Option = { value: number; label: string };
type Picker = { id: number; label: string };

type SessionRow = {
  ExtraClassSessionId: number;
  ExtraClassSessionDate: string;   // yyyy-mm-dd
  ExtraClassSessionTime: string;
  ExtraClassSessionAttended: boolean;
  ExtraClassSessionState: string;
  ExtraClassSessionRemarks: string;
};

// Legacy ddlType (same order; AquaBaby selected by default).
const TYPES = ['AquaBaby', 'AquaGym', 'AquaMermaid', 'MemberShipPasses', 'MemberShip', 'Others'];
// Legacy txtStatus: blank, Active (default), …
const STATUSES = [
  { value: '', label: '' },
  { value: 'Active', label: 'Active' },
  { value: 'ClosedNeedPayment', label: 'Closed Need Payment' },
  { value: 'Closed', label: 'Closed' },
  { value: 'MovedtoGroup', label: 'MovedtoGroup' },
  { value: 'Freeze', label: 'Freeze' },
  { value: 'Cancelled', label: 'Cancelled' },
];
// Legacy ddlCurrency: blank first, so a new pack must pick one ("Missing Currency").
const CURRENCIES = ['', 'LBP', 'USD'];
// Legacy time drop-downs: 04:30 … 22:45 in 15-minute steps.
const TIMES: string[] = [];
for (let m = 4 * 60 + 30; m <= 22 * 60 + 45; m += 15)
  TIMES.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
// JS getDay() numbering (Sun = 0), Monday first like the legacy check boxes.
const WEEKDAYS = [
  { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, { value: 3, label: 'Wed' }, { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' }, { value: 0, label: 'Sun' },
];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Legacy txtState items other than "Regular". The Generate check counts the grid
// rows whose drop-down reads "Regular": a blank / unknown state shows as Regular.
const NON_REGULAR = new Set([
  'Cancelled By ProSwim', 'Cancelled Prev. By Student', 'Cancelled on same Day', 'Merged w/o Pack',
  'Freeze Package', 'Cancelled Package', 'Reduced Package', 'Transfer Package', 'Makeup',
]);

const inputCls =
  'w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e5c97]/40 disabled:bg-slate-50 disabled:text-slate-500';
const cellCls =
  'rounded border border-slate-200 bg-white px-1.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[#1e5c97]/40 disabled:bg-slate-100 disabled:text-slate-400';
const cardCls = 'bg-white rounded-2xl border border-slate-100 shadow-sm p-5';
const btnCls =
  'inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#1e5c97] hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed';
const labelCls = 'block text-xs font-semibold text-slate-500 mb-1';

const s = (v: unknown) => (v == null ? '' : String(v));
const n = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0);
const pad = (x: number) => String(x).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateOnly = (v: unknown) => { const d = toDate(v); return d ? iso(d) : ''; };
const isDigits = (v: string) => /^\d+$/.test(v.trim());

function toSessionRow(r: Row): SessionRow {
  return {
    ExtraClassSessionId: n(r.ExtraClassSessionId),
    ExtraClassSessionDate: dateOnly(r.ExtraClassSessionDate),
    ExtraClassSessionTime: s(r.ExtraClassSessionTime),
    ExtraClassSessionAttended: r.ExtraClassSessionAttended === true,
    ExtraClassSessionState: s(r.ExtraClassSessionState),
    ExtraClassSessionRemarks: s(r.ExtraClassSessionRemarks),
  };
}

async function studentName(id: number): Promise<string> {
  if (!id) return '';
  try {
    const r = await apiRequest<Row>(`/api/portal/students/${id}`);
    return s(r.StudentFullName ?? r.studentFullName) || `Student #${id}`;
  } catch {
    return `Student #${id}`;
  }
}

export function ExtraClassForm() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const user = getStoredUser();
  const userType = (user?.userType ?? '').toLowerCase();
  const canSave = user?.canSave !== false && userType !== 'guest';
  const isNew = !id || id === 'new';
  const classId = isNew ? 0 : Number(id);
  const lockLocation = userType === 'user';
  // Legacy query string (Renew Pack link): LocationID / StudentID / ClassType.
  const qp = (k: string) => params.get(k) ?? params.get(k.charAt(0).toUpperCase() + k.slice(1)) ?? '';

  const [locations, setLocations] = useState<Option[]>([]);
  // form (numbers kept as text, like the legacy text boxes + "Num" validators)
  // ?locationIds= comes from the list's "Add New" (a single ticked location).
  const [locationId, setLocationId] = useState(
    () => n(qp('locationId')) || n(params.get('locationIds')) || (user?.primaryLocationId ?? 0),
  );
  const [type, setType] = useState(() => (TYPES.includes(qp('classType')) ? qp('classType') : 'AquaBaby'));
  const [studentId, setStudentId] = useState(() => n(qp('studentId')));
  const [studentLabel, setStudentLabel] = useState('');
  const [startDate, setStartDate] = useState(iso(new Date()));
  const [sessions, setSessions] = useState('1');
  const [cost, setCost] = useState('0');
  const [currency, setCurrency] = useState('');
  const [status, setStatus] = useState('Active');
  const [validMonths, setValidMonths] = useState('1');
  const [description, setDescription] = useState('');
  const [deleted, setDeleted] = useState(false);
  const [savedStatus, setSavedStatus] = useState('');

  // student type-ahead (legacy ddlStudents = the location's students)
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Picker[]>([]);
  const [picking, setPicking] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // sessions
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [savingRows, setSavingRows] = useState(false);
  const [sortKey, setSortKey, sortAsc, setSortAsc] = useStickySort<'ExtraClassSessionAttended' | 'ExtraClassSessionDate'>('extra-class-sessions', 'ExtraClassSessionAttended');
  const [genOpen, setGenOpen] = useState(false);
  const [genDate, setGenDate] = useState('');
  const [genTime1, setGenTime1] = useState('15:30');
  const [genTime2, setGenTime2] = useState('');
  const [genDays, setGenDays] = useState<number[]>([]);
  const [genCount, setGenCount] = useState('');
  const [generating, setGenerating] = useState(false);

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apiRequest<{ locations: Option[] }>('/api/portal/modules/lookups')
      .then((lk) => setLocations(lk.locations ?? []))
      .catch(() => {});
  }, []);

  // New pack from "Renew Pack" (?studentId=): show the student's name.
  useEffect(() => {
    if (isNew && studentId) studentName(studentId).then(setStudentLabel);
  }, [isNew]); // eslint-disable-line react-hooks/exhaustive-deps

  function applyRecord(r: Row) {
    setLocationId(n(r.ExtraClassLocationId));
    setStudentId(n(r.ExtraClassStudentID));
    setStudentLabel(s(r.StudentFullname));
    setType(s(r.ExtraClassType));
    setCurrency(s(r.ExtraClassCurrency));
    setStartDate(dateOnly(r.ExtraClassStartDate));
    setCost(s(r.ExtraClassCost));
    setSessions(s(r.ExtraClassNumberOfSessions));
    setValidMonths(s(r.ExtraClassValidityMonths));
    setDescription(s(r.ExtraClassDescription));
    setDeleted(r.ExtraClassDeleted === true);
    // The legacy page never loaded the status back (so every edit re-saved
    // "Active"); the portal shows and keeps the stored status.
    setStatus(s(r.ExtraClassStatus));
    setSavedStatus(s(r.ExtraClassStatus));
  }

  function loadRecord() {
    return apiRequest<Row>(`/api/portal/edit/extra-class/${classId}`).then(applyRecord);
  }

  function loadSessions() {
    if (!classId) return;
    setRowsLoading(true);
    apiRequest<Row[]>(`/api/portal/edit/extra-class/${classId}/sessions`)
      .then((r) => setRows(r.map(toSessionRow)))
      .catch(() => setRows([]))
      .finally(() => setRowsLoading(false));
  }

  useEffect(() => {
    if (isNew) return;
    setLoading(true);
    loadRecord()
      .then(loadSessions)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the extra class.'))
      .finally(() => setLoading(false));
  }, [classId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced student search, scoped to the chosen location.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!picking || q.trim().length < 2) { setResults([]); return; }
    timer.current = setTimeout(() => {
      apiRequest<Picker[]>(`/api/portal/edit/extra-class/student-search?q=${encodeURIComponent(q.trim())}&locationId=${locationId}`)
        .then(setResults)
        .catch(() => setResults([]));
    }, 250);
  }, [q, picking, locationId]);

  // ── Save Changes ─────────────────────────────────────────────────────────
  async function save() {
    setError('');
    // Legacy BtnSaveChanges alerts, then the "Num" validators.
    const problem =
      studentId <= 0 ? 'Missing Info'
      : !currency ? 'Missing Currency'
      : !startDate ? 'Start Date is required.'
      : !isDigits(sessions) ? 'Sessions: numbers only.'
      : !isDigits(cost) ? 'Cost: numbers only.'
      : !isDigits(validMonths) ? 'Valid Period: numbers only.'
      : null;
    if (problem) { setError(problem); toast.error(problem); return; }
    setSaving(true);
    const payload = {
      ExtraClassLocationId: locationId,
      ExtraClassStudentID: studentId,
      ExtraClassStartDate: startDate,
      ExtraClassType: type,
      ExtraClassCost: Number(cost),
      ExtraClassNumberOfSessions: Number(sessions),
      ExtraClassValidityMonths: Number(validMonths),
      ExtraClassDescription: description,
      ExtraClassStatus: status,
      ExtraClassCurrency: currency,
      ExtraClassDeleted: deleted,
    };
    try {
      if (isNew) await apiRequest('/api/portal/edit/extra-class', { method: 'POST', body: JSON.stringify(payload) });
      else await apiRequest(`/api/portal/edit/extra-class/${classId}`, { method: 'PUT', body: JSON.stringify(payload) });
      toast.success(isNew ? 'Extra class created.' : 'Extra class saved.');
      // Legacy closes the pop-up and refreshes the list that opened it.
      if (canGoBack()) navigate(-1); else navigate('/extra-classes');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed.';
      setError(msg); toast.error(msg);
      setSaving(false);
    }
  }

  // ── Add Session (generate) ───────────────────────────────────────────────
  async function generate() {
    if (genDays.length === 0) { toast.error('Please select at least one day of the week'); return; }
    if (!genDate) { toast.error('Date is required (dd/mm/yyyy).'); return; }
    if (!isDigits(genCount)) { toast.error('Sessions #: numbers only.'); return; }
    // Legacy: Regular rows + new ones may not exceed the pack's Sessions box.
    const regular = rows.filter((r) => !NON_REGULAR.has(r.ExtraClassSessionState)).length;
    if (isDigits(sessions) && regular + Number(genCount) > Number(sessions)) {
      toast.error('Number of sessions is different than missed ones, Please Correct');
      return;
    }
    setGenerating(true);
    try {
      const r = await apiRequest<{ generated: number }>(`/api/portal/edit/extra-class/${classId}/generate-sessions`, {
        method: 'POST',
        body: JSON.stringify({
          startDate: genDate, time1: genTime1, time2: genTime2, weekdays: genDays,
          count: Number(genCount), numberOfSessions: isDigits(sessions) ? Number(sessions) : undefined,
        }),
      });
      toast.success(`Sessions Generated Successfully [New Sessions Generated : ${r.generated}]`);
      setGenDate('');
      setGenOpen(false);
      loadSessions();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not generate sessions.');
    } finally {
      setGenerating(false);
    }
  }

  // ── Save Attendace ───────────────────────────────────────────────────────
  function setRow<K extends keyof SessionRow>(sid: number, key: K, value: SessionRow[K]) {
    setRows((old) => old.map((r) => (r.ExtraClassSessionId === sid ? { ...r, [key]: value } : r)));
  }

  async function saveAttendance() {
    if (rows.some((r) => !r.ExtraClassSessionDate)) { toast.error('Every session needs a date, please correct.'); return; }
    setSavingRows(true);
    try {
      // Legacy: remarks lower-cased; state "Regular" when attended, else blank
      // (the API applies both; the Status drop-down was never saved).
      await apiRequest(`/api/portal/edit/extra-class/${classId}/sessions`, {
        method: 'PUT',
        body: JSON.stringify({
          sessions: rows.map((r) => ({
            ExtraClassSessionId: r.ExtraClassSessionId,
            ExtraClassSessionDate: r.ExtraClassSessionDate,
            ExtraClassSessionTime: r.ExtraClassSessionTime,
            ExtraClassSessionRemarks: r.ExtraClassSessionRemarks.toLowerCase(),
            ExtraClassSessionAttended: r.ExtraClassSessionAttended,
          })),
        }),
      });
      toast.success('Attendance saved.');
      // Legacy DoWork(): reload the pack (the save can close it) and the grid.
      loadRecord().catch(() => {});
      loadSessions();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save attendance.');
    } finally {
      setSavingRows(false);
    }
  }

  // Legacy grid sort: Att ascending (open sessions first); Date / Att headers sort.
  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      const cmp = sortKey === 'ExtraClassSessionAttended'
        ? Number(a.ExtraClassSessionAttended) - Number(b.ExtraClassSessionAttended)
          || a.ExtraClassSessionDate.localeCompare(b.ExtraClassSessionDate)
        : a.ExtraClassSessionDate.localeCompare(b.ExtraClassSessionDate);
      return sortAsc ? cmp : -cmp;
    });
    return arr;
  }, [rows, sortKey, sortAsc]);

  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) setSortAsc((x) => !x);
    else { setSortKey(key); setSortAsc(true); }
  }
  const sortIcon = (key: typeof sortKey) =>
    sortKey === key ? (sortAsc ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />) : <ArrowUpDown className="size-3 opacity-40" />;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="size-8 text-[#1e5c97] animate-spin" />
      </div>
    );
  }

  const statusOptions = status && !STATUSES.some((o) => o.value === status) ? [...STATUSES, { value: status, label: status }] : STATUSES;
  const typeOptions = type && !TYPES.includes(type) ? [...TYPES, type] : TYPES;
  const fixedOnEdit = 'Not changed by an edit (the legacy update keeps the value set at creation)';

  return (
    <div className="p-6 md:p-8 max-w-5xl">
      <PageHero
        compact
        title={isNew ? 'New Extra Class' : studentLabel || 'Extra Class'}
        subtitle={isNew ? 'Add an extra class / membership' : `${type} · #${classId}${savedStatus ? ` · ${savedStatus}` : ''}`}
        slide={1}
      />

      <SmartBack label="Back" fallback="/extra-classes" />

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl p-3 mb-4">
          <AlertCircle className="size-4 text-red-500 shrink-0" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}
      {!canSave && (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 mb-4">
          <p className="text-sm text-amber-700">Your account has view-only access, saving is disabled.</p>
        </div>
      )}

      {/* Pack fields, in the legacy two-column order. */}
      <div className={cardCls}>
        <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-4">Please fill in the following information</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Location</label>
            <select
              value={locationId}
              onChange={(e) => { setLocationId(Number(e.target.value)); setStudentId(0); setStudentLabel(''); }}
              disabled={lockLocation || !isNew}
              title={!isNew ? fixedOnEdit : lockLocation ? 'Your account is bound to its location' : undefined}
              className={inputCls}
            >
              <option value={0}>Not Selected</option>
              {locations.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Type</label>
            <select value={type} onChange={(e) => setType(e.target.value)} className={inputCls}>
              {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div className="relative">
            <label className={labelCls}>Student {studentId ? <span className="font-normal text-slate-400">· #{studentId}</span> : null}</label>
            {!isNew ? (
              <input value={studentLabel} disabled title={fixedOnEdit} className={inputCls} />
            ) : (
              <>
                <div className="relative">
                  <Search className="size-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    value={picking ? q : studentLabel}
                    onFocus={() => { setPicking(true); setQ(''); }}
                    onBlur={() => setTimeout(() => setPicking(false), 200)}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Not Selected (type to search this location's students)"
                    className={`${inputCls} pl-8`}
                  />
                </div>
                {picking && results.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg">
                    {results.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { setStudentId(r.id); setStudentLabel(r.label); setPicking(false); }}
                        className="block w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          <div>
            <label className={labelCls}>Start Date</label>
            <DateInput value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} />
          </div>

          <div>
            <label className={labelCls}>Sessions</label>
            <input value={sessions} onChange={(e) => setSessions(e.target.value)} inputMode="numeric" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Cost</label>
            <input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="numeric" className={inputCls} />
          </div>

          <div>
            <label className={labelCls}>Currency</label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              disabled={!isNew}
              title={isNew ? undefined : 'Currency is set when the pack is created'}
              className={inputCls}
            >
              {CURRENCIES.map((c) => <option key={c || '-'} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="hidden md:block" />

          <div>
            <label className={labelCls}>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
              {statusOptions.map((o) => <option key={o.value || '-'} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Valid Period <span className="font-normal text-slate-400">· months</span></label>
            <input value={validMonths} onChange={(e) => setValidMonths(e.target.value)} inputMode="numeric" className={inputCls} />
          </div>

          <div>
            <label className={labelCls}>Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={150} rows={2} className={inputCls} />
          </div>
          {/* Legacy chkDeleted: hidden on a new pack. */}
          {!isNew && (
            <label className="flex items-center gap-2 text-sm text-slate-700 select-none self-end py-1.5" title={fixedOnEdit}>
              <input type="checkbox" checked={deleted} disabled className="accent-[#1e5c97]" />
              Deleted
            </label>
          )}
        </div>
      </div>

      {canSave && (
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            onClick={save}
            disabled={saving}
            className="btn-grad flex items-center gap-2 rounded-xl text-sm font-semibold px-6 py-2.5 disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save Changes
          </button>
        </div>
      )}

      {/* ── Sessions (existing pack only) ─────────────────────────────────── */}
      {!isNew && (
        <div className={`${cardCls} mt-6`}>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mr-auto">Sessions · {rows.length}</p>
            {canSave && (
              <button onClick={() => setGenOpen((o) => !o)} className={btnCls}>
                <CalendarPlus className="size-3.5" /> {genOpen ? 'Hide Session' : 'Add Session'}
              </button>
            )}
            {canSave && rows.length > 0 && (
              <button
                onClick={saveAttendance}
                disabled={savingRows}
                className="btn-grad inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold px-3 py-1.5 disabled:opacity-50"
              >
                {savingRows ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save Attendance
              </button>
            )}
            {canSave && (
              <button
                onClick={() => navigate(`/extra-classes/new?${new URLSearchParams({
                  locationId: String(locationId), studentId: String(studentId), classType: type,
                })}`)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-100 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-200"
              >
                <RefreshCw className="size-3.5" /> Renew Pack
              </button>
            )}
          </div>

          {genOpen && canSave && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 mb-4">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div>
                  <label className={labelCls}>Date</label>
                  <DateInput value={genDate} onChange={(e) => setGenDate(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Time · Day1</label>
                  <select value={genTime1} onChange={(e) => setGenTime1(e.target.value)} className={inputCls}>
                    {TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Time · Day2</label>
                  <select
                    value={genTime2}
                    onChange={(e) => setGenTime2(e.target.value)}
                    title="Used for every second session when exactly two weekdays are ticked"
                    className={inputCls}
                  >
                    <option value="" />
                    {TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Sessions #</label>
                  <input value={genCount} onChange={(e) => setGenCount(e.target.value)} inputMode="numeric" className={inputCls} />
                </div>
                <div className="flex items-end">
                  <button
                    onClick={generate}
                    disabled={generating}
                    className="btn-grad inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold px-3 py-2 disabled:opacity-50"
                  >
                    {generating ? <Loader2 className="size-3.5 animate-spin" /> : <CalendarPlus className="size-3.5" />} Generate
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 mt-3">
                <span className="text-xs font-semibold text-slate-500">Days of Week</span>
                {WEEKDAYS.map((d) => (
                  <label key={d.value} className="flex items-center gap-1 text-xs text-slate-600 select-none">
                    <input
                      type="checkbox"
                      checked={genDays.includes(d.value)}
                      onChange={(e) => setGenDays((cur) => (e.target.checked ? [...cur, d.value] : cur.filter((v) => v !== d.value)))}
                      className="accent-[#1e5c97]"
                    />
                    {d.label}
                  </label>
                ))}
              </div>
            </div>
          )}

          {rowsLoading ? (
            <div className="flex items-center justify-center h-24"><Loader2 className="size-6 text-[#1e5c97] animate-spin" /></div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-400">No sessions yet.</p>
          ) : (
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-xs whitespace-nowrap">
                <thead>
                  <tr className="text-left text-[11px] text-slate-400 uppercase tracking-wider border-b border-slate-100">
                    <th className="px-2 py-2 font-semibold">
                      <button type="button" onClick={() => toggleSort('ExtraClassSessionDate')} className="inline-flex items-center gap-1 hover:text-slate-600">
                        Date {sortIcon('ExtraClassSessionDate')}
                      </button>
                    </th>
                    <th className="px-2 py-2 font-semibold">Time</th>
                    <th className="px-2 py-2 font-semibold text-center">
                      <button type="button" onClick={() => toggleSort('ExtraClassSessionAttended')} className="inline-flex items-center gap-1 hover:text-slate-600">
                        Att {sortIcon('ExtraClassSessionAttended')}
                      </button>
                    </th>
                    <th className="px-2 py-2 font-semibold">Status</th>
                    <th className="px-2 py-2 font-semibold">Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => {
                    const d = toDate(r.ExtraClassSessionDate);
                    return (
                      <tr
                        key={r.ExtraClassSessionId}
                        className="border-b border-slate-50 last:border-0"
                        style={{ backgroundColor: r.ExtraClassSessionAttended ? 'rgb(0,204,102)' : undefined }}
                      >
                        <td className="px-2 py-1">
                          <div className="flex items-center gap-1.5">
                            <span className="w-7 text-slate-500">{d ? DOW[d.getDay()] : ''}</span>
                            <DateInput
                              value={r.ExtraClassSessionDate}
                              disabled={!canSave}
                              onChange={(e) => setRow(r.ExtraClassSessionId, 'ExtraClassSessionDate', e.target.value)}
                              className={`${cellCls} w-28`}
                            />
                          </div>
                        </td>
                        <td className="px-2 py-1">
                          <select
                            value={r.ExtraClassSessionTime}
                            disabled={!canSave}
                            onChange={(e) => setRow(r.ExtraClassSessionId, 'ExtraClassSessionTime', e.target.value)}
                            className={cellCls}
                          >
                            <option value="" />
                            {TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
                            {r.ExtraClassSessionTime && !TIMES.includes(r.ExtraClassSessionTime) && (
                              <option value={r.ExtraClassSessionTime}>{r.ExtraClassSessionTime}</option>
                            )}
                          </select>
                        </td>
                        <td className="px-2 py-1 text-center">
                          <input
                            type="checkbox"
                            checked={r.ExtraClassSessionAttended}
                            disabled={!canSave}
                            onChange={(e) => setRow(r.ExtraClassSessionId, 'ExtraClassSessionAttended', e.target.checked)}
                            className="accent-[#1e5c97]"
                          />
                        </td>
                        {/* Stored state, read-only: the legacy Status drop-down here was
                            never saved (Save sets Regular when attended, else blank). */}
                        <td className="px-2 py-1 text-slate-700">{r.ExtraClassSessionState || '-'}</td>
                        <td className="px-2 py-1">
                          <input
                            value={r.ExtraClassSessionRemarks}
                            disabled={!canSave}
                            onChange={(e) => setRow(r.ExtraClassSessionId, 'ExtraClassSessionRemarks', e.target.value)}
                            className={`${cellCls} w-48`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

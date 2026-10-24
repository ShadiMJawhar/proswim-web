// Attendance reports, 1:1 ports of RptAttendanceSummary.aspx and
// RptAttendanceDetails.aspx in the portal UI.
//
// Faithful legacy behaviours kept on purpose:
// - The summary does NOT load on open; you press Search (the legacy cascades
//   never call LoadData). Day / Class / Status / Active / Stopped changes do
//   reload it, as their legacy postbacks did. The details page DOES
//   auto-load, exactly like the original.
// - Header stats use the legacy integer-truncated percentages against
//   Sum(Total); when Sum(Total) is 0 the percentage segments disappear.
// - Stopped registrations render red (#E6C8C8) with line-through.
// - Cascades: location → semester (defaults to the current one, sets the date
//   range) → coach → class (also filtered by day).

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Loader2, AlertCircle, Search, Download, ClipboardCheck, ChevronLeft, ChevronRight,
  ArrowUpDown, ArrowUp, ArrowDown, User,
} from 'lucide-react';
import { apiRequest, getStoredUser } from '../api/portalApi';
import { useUrlState } from '../lib/urlState';
import { DateInput } from '../components/DateInput';
import { PageHero } from '../components/PageHero';

import { useStickySort, routeGridKey } from '../lib/stickySort';
type Row = Record<string, unknown>;
type Option = { value: number; label: string };

// The attendance summary/details procs return columns with inconsistent SQL
// casing (e.g. `attendancestatus`, `MakeupInfo`, `SemesterId`); resolve reads
// case-insensitively so a casing drift never silently blanks a column.
function pick(r: Row, k: string): unknown {
  if (r[k] !== undefined) return r[k];
  const lower = k.toLowerCase();
  for (const kk in r) if (kk.toLowerCase() === lower) return r[kk];
  return undefined;
}
const num = (r: Row, k: string) => Number(pick(r, k) ?? 0);
const str = (r: Row, k: string) => { const v = pick(r, k); return v == null ? '' : String(v); };
const inputCls = 'rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e5c97]/40';

const DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const STATUSES = ['', 'Normal', 'Makeup', 'Late'];

const dmy = (v: unknown) => {
  if (!v) return '-';
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? String(v) : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};
const toDateInput = (v: unknown): string => {
  if (!v) return '';
  const d = new Date(String(v));
  if (isNaN(d.getTime()) || d.getFullYear() < 1901) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Shared client-side sort + page machinery (legacy sorted/paged the cached table).
function useGrid(rows: Row[], pageSize: number) {
  const [sortKey, setSortKey, sortAsc, setSortAsc] = useStickySort<string>(routeGridKey(), '');
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const arr = [...rows];
    arr.sort((a, b) => {
      const va = a[sortKey], vb = b[sortKey];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va).localeCompare(String(vb), undefined, { sensitivity: 'base', numeric: true });
      return sortAsc ? cmp : -cmp;
    });
    return arr;
  }, [rows, sortKey, sortAsc]);

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageRows = sorted.slice(page * pageSize, (page + 1) * pageSize);

  function toggleSort(key: string) {
    if (sortKey === key) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(true); }
    setPage(0);
  }
  return { sorted, pageRows, pages, page, setPage, sortKey, sortAsc, toggleSort };
}

function SortHeader({ label, k, grid }: { label: string; k: string; grid: ReturnType<typeof useGrid> }) {
  return (
    <th className="text-left">
      <button type="button" onClick={() => grid.toggleSort(k)} className="flex items-center gap-1 hover:text-slate-600">
        {label}
        {grid.sortKey === k
          ? grid.sortAsc ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />
          : <ArrowUpDown className="size-3 opacity-30" />}
      </button>
    </th>
  );
}

function Pager({ grid, total }: { grid: ReturnType<typeof useGrid>; total: number }) {
  if (grid.pages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 p-3 text-sm text-slate-500">
      <span>{total.toLocaleString()} rows · page {grid.page + 1} / {grid.pages}</span>
      <button onClick={() => grid.setPage(Math.max(0, grid.page - 1))} disabled={grid.page === 0}
        className="rounded border border-slate-200 p-1 disabled:opacity-30"><ChevronLeft className="size-4" /></button>
      <button onClick={() => grid.setPage(Math.min(grid.pages - 1, grid.page + 1))} disabled={grid.page >= grid.pages - 1}
        className="rounded border border-slate-200 p-1 disabled:opacity-30"><ChevronRight className="size-4" /></button>
    </div>
  );
}

function exportCsv(rows: Row[], columns: [string, string][], name: string) {
  const header = columns.map(([, label]) => label).join(',');
  const lines = rows.map((r) =>
    columns.map(([key]) => `"${String(r[key] ?? '').replace(/"/g, '""')}"`).join(','));
  const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const d = new Date();
  a.download = `${d.getFullYear()}_${name}_${String(d.getMonth() + 1).padStart(2, '0')}_${String(d.getDate()).padStart(2, '0')}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// Stopped-row styling: legacy #E6C8C8 + line-through.
const stoppedCls = (r: Row) =>
  String(r.registrationstudentstopped ?? r.RegistrationStudentStopped ?? '').toLowerCase().includes('true')
  || r.registrationstudentstopped === true
    ? 'bg-[#E6C8C8] line-through'
    : '';

// ─────────────────────────────────────────────────────────────────────────────
// Attendance Summary (RptAttendanceSummary.aspx)
// ─────────────────────────────────────────────────────────────────────────────

export function AttendanceSummaryPage() {
  const user = getStoredUser();
  const locationLocked = (user?.userType || '').toLowerCase() === 'user' && !!user?.primaryLocationId;
  const [params] = useSearchParams();

  const [locations, setLocations] = useState<Option[]>([]);
  const [semesters, setSemesters] = useState<Option[]>([]);
  const [coaches, setCoaches] = useState<Option[]>([]);
  const [classes, setClasses] = useState<Option[]>([]);

  // These filters live in the URL so leaving the report and coming back keeps
  // them. Semester and the date range stay local: the location cascade below
  // re-defaults them on load (legacy behaviour), so restoring them would only
  // be overwritten.
  const [locationId, setLocationId] = useUrlState('locationId', user?.primaryLocationId ?? 0);
  const [semesterId, setSemesterId] = useState(0);
  const [coachId, setCoachId] = useUrlState('coachId', 0);
  const [classId, setClassId] = useUrlState('classId', 0);
  const [day, setDay] = useUrlState('day', '');
  const [status, setStatus] = useUrlState('status', '');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useUrlState('search', params.get('search') ?? '');
  const [showActive, setShowActive] = useUrlState('showActive', true);
  const [showStopped, setShowStopped] = useUrlState('showStopped', true);

  const [rows, setRows] = useState<Row[] | null>(null); // null = never searched (legacy: empty on load)
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const grid = useGrid(rows ?? [], 25);

  // Location list once; semester + coach lists cascade off the location.
  useEffect(() => {
    apiRequest<{ locations: Option[] }>('/api/portal/modules/lookups')
      .then((lk) => setLocations(lk.locations ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    apiRequest<{ coaches: Option[] }>(`/api/portal/modules/lookups?locationId=${locationId}`)
      .then((lk) => setCoaches(lk.coaches ?? []))
      .catch(() => setCoaches([]));
    apiRequest<{ semesters: Row[]; currentSemesterId: number }>(`/api/portal/schedule/semesters?locationId=${locationId}`)
      .then((r) => {
        const opts = (r.semesters ?? [])
          .map((row) => ({ value: Number(row.SemesterId ?? row.SemesterID ?? 0), label: str(row, 'SemesterName') }))
          .filter((o) => o.value > 0);
        setSemesters(opts);
        const current = r.currentSemesterId || opts[0]?.value || 0;
        setSemesterId(current);
        // Default the date range to the chosen semester's start/end (legacy).
        const row = (r.semesters ?? []).find((s2) => Number(s2.SemesterId ?? s2.SemesterID ?? 0) === current);
        if (row) {
          setDateFrom(toDateInput(row.SemesterStart));
          setDateTo(toDateInput(row.SemesterEnd));
        }
      })
      .catch(() => {});
  }, [locationId]);

  // Semester change re-defaults the dates (legacy ddlSemester_SelectedIndexChanged).
  const semRows = useRef<Row[]>([]);
  useEffect(() => {
    apiRequest<{ semesters: Row[] }>(`/api/portal/schedule/semesters?locationId=${locationId}`)
      .then((r) => { semRows.current = r.semesters ?? []; })
      .catch(() => {});
  }, [locationId]);
  function changeSemester(id: number) {
    setSemesterId(id);
    const row = semRows.current.find((s2) => Number(s2.SemesterId ?? s2.SemesterID ?? 0) === id);
    if (row) {
      const from = toDateInput(row.SemesterStart);
      const to = toDateInput(row.SemesterEnd);
      if (from) setDateFrom(from);
      if (to) setDateTo(to);
    }
  }

  // Class list follows semester + coach + day.
  useEffect(() => {
    if (!semesterId) { setClasses([]); return; }
    apiRequest<Option[]>(`/api/portal/reports/classes?semesterId=${semesterId}&coachId=${coachId}&day=${day}`)
      .then(setClasses)
      .catch(() => setClasses([]));
  }, [semesterId, coachId, day]);

  function load() {
    if (!semesterId) { setError('Pick a semester first.'); return; }
    setLoading(true);
    setError('');
    const q = new URLSearchParams({ semesterId: String(semesterId) });
    if (coachId) q.set('coachId', String(coachId));
    if (classId) q.set('classId', String(classId));
    if (day) q.set('day', day);
    if (status) q.set('status', status);
    if (dateFrom) q.set('dateFrom', dateFrom);
    if (dateTo) q.set('dateTo', dateTo);
    if (search.trim()) q.set('searchFor', search.trim());
    q.set('showActive', String(showActive));
    q.set('showStopped', String(showStopped));
    apiRequest<Row[]>(`/api/portal/reports/attendance-summary?${q}`)
      .then((data) => { setRows(data); grid.setPage(0); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the report.'))
      .finally(() => setLoading(false));
  }

  // Legacy postbacks that DO run LoadData: Day, Class and Status changes and
  // the Active / Stopped checkboxes (the location/semester/coach cascades and
  // the dates don't). Skipped on mount, the report still opens empty.
  const filtersMounted = useRef(false);
  useEffect(() => {
    if (!filtersMounted.current) { filtersMounted.current = true; return; }
    if (semesterId) load();
  }, [day, classId, status, showActive, showStopped]); // eslint-disable-line react-hooks/exhaustive-deps

  // Header stats, legacy format with integer-truncated percentages.
  const stats = useMemo(() => {
    if (!rows) return null;
    const sum = (k: string) => rows.reduce((s2, r) => s2 + num(r, k), 0);
    const total = sum('Total');
    const parts = [`${rows.length} Records`];
    if (rows.length > 0) {
      parts.push(`Total Attendance: ${total.toLocaleString()}`);
      if (total > 0) {
        const pct = (v: number) => Math.trunc((v * 100) / total);
        parts.push(`Attended: ${sum('Attended').toLocaleString()} [${pct(sum('Attended'))}%]`);
        parts.push(`Absents: ${sum('Absents').toLocaleString()} [${pct(sum('Absents'))}%]`);
        parts.push(`Make ups: ${sum('Makeup').toLocaleString()} [${pct(sum('Makeup'))}%]`);
      }
    }
    return parts.join('  ·  ');
  }, [rows]);

  const CSV_COLS: [string, string][] = [
    ['StudentFullName', 'Student Name'], ['StudentPhoneNumber1', 'Phone'], ['CoachFullName', 'Coach'],
    ['Total', 'Total'], ['Attended', 'Attended'], ['Makeup', 'Makeup'], ['Absents', 'Absents'],
    ['RegistrationRemarks', 'Remarks'], ['RegistrationStudentStoppedReason', 'StoppedReason'],
  ];

  return (
    <div className="p-6 md:p-8">
      <PageHero title="Attendance Summary" subtitle="Per-student attendance totals for a semester" slide={2} />

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-soft p-4 mb-4">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <select value={locationId} onChange={(e) => setLocationId(Number(e.target.value))}
            disabled={locationLocked} className={`${inputCls} disabled:bg-slate-50`}>
            <option value={0}>All locations</option>
            {locations.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
          <select value={semesterId} onChange={(e) => changeSemester(Number(e.target.value))} className={inputCls}>
            <option value={0}>Semester…</option>
            {semesters.map((s2) => <option key={s2.value} value={s2.value}>{s2.label}</option>)}
          </select>
          <select value={coachId} onChange={(e) => setCoachId(Number(e.target.value))} className={inputCls}>
            <option value={0}>All coaches</option>
            {coaches.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <select value={classId} onChange={(e) => setClassId(Number(e.target.value))} className={`${inputCls} max-w-52`}>
            <option value={0}>All classes</option>
            {classes.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <select value={day} onChange={(e) => { setDay(e.target.value); setClassId(0); }} className={inputCls}>
            {DAYS.map((d) => <option key={d} value={d}>{d || 'Any day'}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
            {STATUSES.map((s2) => <option key={s2} value={s2}>{s2 || 'Any status'}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateInput value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setDay(''); }} className={inputCls} />
          <span className="text-slate-400 text-sm">to</span>
          <DateInput value={dateTo} onChange={(e) => { setDateTo(e.target.value); setDay(''); }} className={inputCls} />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load()} placeholder="Search student…" className={`${inputCls} w-44`} />
          <label className="flex items-center gap-1.5 text-sm text-slate-600 select-none">
            <input type="checkbox" checked={showActive} onChange={(e) => setShowActive(e.target.checked)} className="accent-[#1e5c97]" /> Active
          </label>
          <label className="flex items-center gap-1.5 text-sm text-slate-600 select-none">
            <input type="checkbox" checked={showStopped} onChange={(e) => setShowStopped(e.target.checked)} className="accent-[#1e5c97]" /> Stopped
          </label>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1.5 rounded-lg bg-[#1e5c97] hover:bg-[#17497a] text-white text-sm font-semibold px-5 py-1.5 disabled:opacity-50">
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Search
          </button>
          {rows && rows.length > 0 && (
            <button onClick={() => exportCsv(grid.sorted, CSV_COLS, 'AttendanceSummary')}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 text-slate-600 text-sm font-semibold px-4 py-1.5 hover:border-[#1e5c97]/40">
              <Download className="size-4" /> Export
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl p-3 mb-4">
          <AlertCircle className="size-4 text-red-500 shrink-0" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {stats && <p className="text-base font-bold text-[#1e5c97] mb-3">{stats}</p>}

      {!rows && !loading && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-soft p-8 text-center">
          <ClipboardCheck className="size-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500">Choose your filters and press Search to run the report.</p>
        </div>
      )}

      {rows && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-soft overflow-x-auto">
          <table className="tbl w-full text-base whitespace-nowrap [&_td]:py-3 [&_th]:py-3 [&_td]:px-3 [&_th]:px-3">
            <thead>
              <tr>
                <SortHeader label="Student Name" k="StudentFullName" grid={grid} />
                <SortHeader label="Phone" k="StudentPhoneNumber1" grid={grid} />
                <SortHeader label="Coach" k="CoachFullName" grid={grid} />
                <SortHeader label="Total" k="Total" grid={grid} />
                <SortHeader label="Attended" k="Attended" grid={grid} />
                <SortHeader label="Makeup" k="Makeup" grid={grid} />
                <SortHeader label="Absents" k="Absents" grid={grid} />
                <SortHeader label="Remarks" k="RegistrationRemarks" grid={grid} />
                <SortHeader label="Stopped Reason" k="RegistrationStudentStoppedReason" grid={grid} />
                <th /><th />
              </tr>
            </thead>
            <tbody>
              {grid.pageRows.length === 0 && (
                <tr><td colSpan={11} className="text-center text-slate-400 py-6">No records found.</td></tr>
              )}
              {grid.pageRows.map((r, i) => (
                <tr key={i} className={stoppedCls(r)}>
                  <td className="font-semibold">{str(r, 'StudentFullName')}</td>
                  <td>{str(r, 'StudentPhoneNumber1')}</td>
                  <td>{str(r, 'CoachFullName')}</td>
                  <td className="text-center">{num(r, 'Total')}</td>
                  <td className="text-center text-emerald-700 font-semibold">{num(r, 'Attended')}</td>
                  <td className="text-center text-amber-700">{num(r, 'Makeup')}</td>
                  <td className="text-center text-red-600 font-semibold">{num(r, 'Absents')}</td>
                  <td className="max-w-48 truncate" title={str(r, 'RegistrationRemarks')}>{str(r, 'RegistrationRemarks')}</td>
                  <td className="max-w-48 truncate" title={str(r, 'RegistrationStudentStoppedReason')}>{str(r, 'RegistrationStudentStoppedReason')}</td>
                  <td>
                    <Link to={`/students?searchFor=${encodeURIComponent(str(r, 'StudentFullName'))}`}
                      className="inline-flex items-center gap-1 text-sm font-bold text-[#1e5c97] hover:underline">
                      <User className="size-4" /> Profile
                    </Link>
                  </td>
                  <td>
                    <Link to={`/attendance-details?search=${encodeURIComponent(str(r, 'StudentFullName'))}`}
                      className="inline-flex items-center gap-1 text-sm font-bold text-[#1e5c97] hover:underline">
                      <ClipboardCheck className="size-4" /> Attendance
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager grid={grid} total={rows.length} />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Attendance Details (RptAttendanceDetails.aspx), per-session drill-down
// ─────────────────────────────────────────────────────────────────────────────

// Legacy rolling default: Jan–Mar → 01/10 of last year; Apr → 01/01; May+ →
// first of (month − 3). End = 01/01 of next year.
function rollingDefaultFrom(): string {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth() + 1;
  if (m <= 3) return `${y - 1}-10-01`;
  if (m === 4) return `${y}-01-01`;
  return `${y}-${String(m - 3).padStart(2, '0')}-01`;
}

export function AttendanceDetailsPage() {
  const user = getStoredUser();
  const locationLocked = (user?.userType || '').toLowerCase() === 'user' && !!user?.primaryLocationId;
  const [params] = useSearchParams();

  const [locations, setLocations] = useState<Option[]>([]);
  const [semesters, setSemesters] = useState<Option[]>([]);
  const [coaches, setCoaches] = useState<Option[]>([]);
  const [classes, setClasses] = useState<Option[]>([]);

  // Neutral filters live in the URL so coming back keeps them. `search`,
  // `dateFrom`/`dateTo` deliberately stay local: their presence in the URL is
  // what marks a deep link (auto-load + all semesters), so persisting them
  // would change that behaviour on every revisit.
  const [locationId, setLocationId] = useUrlState('locationId', user?.primaryLocationId ?? 0);
  const [semesterSel, setSemesterSel] = useState<Set<number>>(new Set());
  const allSemesters = params.has('allSemesters');
  const [coachId, setCoachId] = useUrlState('coachId', 0);
  const [classId, setClassId] = useUrlState('classId', 0);
  const [day, setDay] = useUrlState('day', '');
  const [status, setStatus] = useUrlState('status', '');
  const [dateFrom, setDateFrom] = useState(params.get('dateFrom') ?? rollingDefaultFrom());
  const [dateTo, setDateTo] = useState(params.get('dateTo') ?? `${new Date().getFullYear() + 1}-01-01`);
  const [search, setSearch] = useState(params.get('search') ?? '');

  const [rows, setRows] = useState<Row[] | null>(null); // null = not searched yet
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const grid = useGrid(rows ?? [], 100);
  const firstLoad = useRef(true);
  // Deep links (a student's Attendance button, report shortcuts) auto-load;
  // opening the page plain from the menu waits for Search, like the summary.
  const deepLink = !!params.get('search') || params.has('allSemesters') || !!params.get('dateFrom');

  useEffect(() => {
    apiRequest<{ locations: Option[] }>('/api/portal/modules/lookups')
      .then((lk) => setLocations(lk.locations ?? []))
      .catch(() => {});
  }, []);

  // Location → semesters (upcoming/current checked by default, unless a search
  // deep-link or ?allSemesters= wants everything) + coaches.
  useEffect(() => {
    apiRequest<{ coaches: Option[] }>(`/api/portal/modules/lookups?locationId=${locationId}`)
      .then((lk) => setCoaches(lk.coaches ?? []))
      .catch(() => setCoaches([]));
    apiRequest<{ semesters: Row[]; currentSemesterId: number }>(`/api/portal/schedule/semesters?locationId=${locationId}`)
      .then((r) => {
        const opts = (r.semesters ?? [])
          .map((row) => ({ value: Number(row.SemesterId ?? row.SemesterID ?? 0), label: str(row, 'SemesterName') }))
          .filter((o) => o.value > 0);
        setSemesters(opts);
        // A student deep-link ("Attendance" from the summary) wants the full
        // history: leave all semesters unchecked (= no semester restriction).
        const wantAll = allSemesters || !!params.get('search');
        setSemesterSel(wantAll ? new Set() : new Set(r.currentSemesterId ? [r.currentSemesterId] : []));
      })
      .catch(() => {});
  }, [locationId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const first = semesterSel.values().next().value ?? 0;
    if (!first) { setClasses([]); return; }
    apiRequest<Option[]>(`/api/portal/reports/classes?semesterId=${first}&coachId=${coachId}&day=${day}`)
      .then(setClasses)
      .catch(() => setClasses([]));
  }, [semesterSel, coachId, day]);

  function load(searchOverride?: string) {
    setLoading(true);
    setError('');
    const effectiveSearch = searchOverride ?? search;
    const q = new URLSearchParams();
    if (semesterSel.size > 0) q.set('semesterIds', [...semesterSel].join(','));
    if (locationId) q.set('locationIds', String(locationId));
    if (coachId) q.set('coachId', String(coachId));
    if (classId) q.set('classId', String(classId));
    if (day) q.set('day', day);
    if (status) q.set('status', status);
    if (dateFrom) q.set('dateFrom', dateFrom);
    if (dateTo) q.set('dateTo', dateTo);
    if (effectiveSearch.trim()) q.set('searchFor', effectiveSearch.trim());
    apiRequest<Row[]>(`/api/portal/reports/attendance-details?${q}`)
      .then((data) => { setRows(data); grid.setPage(0); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the report.'))
      .finally(() => setLoading(false));
  }

  // Deep-linked visits auto-load once the semester default resolves; a plain
  // open from the menu shows the filters and waits for Search.
  useEffect(() => {
    if (!firstLoad.current || !deepLink) return;
    if (semesters.length === 0 && locationId) return; // wait for the cascade
    firstLoad.current = false;
    load();
  }, [semesterSel]); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    if (!rows) return null;
    const attended = rows.filter((r) => r.AttendanceStudentAttended === true).length;
    const missed = rows.filter((r) => r.AttendanceStudentAttended === false).length;
    const makeups = rows.filter((r) => str(r, 'AttendanceStatus').toLowerCase() === 'makeup').length;
    const parts = [`${rows.length} Records`];
    if (rows.length > 0) parts.push(`Attended: ${attended}`, `Missed: ${missed}`, `Make ups: ${makeups}`);
    return parts.join('  ·  ');
  }, [rows]);

  const CSV_COLS: [string, string][] = [
    ['StudentFullName', 'Name'], ['StudentPhoneNumber1', 'Phone'], ['SessionDate', 'Date'],
    ['ClassName', 'Class'], ['AttendanceStatus', 'Status'], ['AttendanceRemarks', 'Remarks'],
    ['AttendanceStudentAttended', 'Attended'], ['MakeUpInfo', 'Makeuped'],
  ];

  return (
    <div className="p-6 md:p-8">
      <PageHero title="Attendance Details" subtitle="Session-by-session attendance records" slide={3} />

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-soft p-4 mb-4">
        <div className="flex flex-wrap items-start gap-2 mb-3">
          <select value={locationId} onChange={(e) => setLocationId(Number(e.target.value))}
            disabled={locationLocked} className={`${inputCls} disabled:bg-slate-50`}>
            <option value={0}>All locations</option>
            {locations.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
          {/* Multi-semester (legacy RadComboBox with checkboxes) */}
          <div className="rounded-lg border border-slate-200 px-2.5 py-1.5 max-h-24 overflow-y-auto min-w-52">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">
              Semesters {semesterSel.size === 0 && '(all)'}
            </p>
            {semesters.map((s2) => (
              <label key={s2.value} className="flex items-center gap-1.5 text-xs text-slate-700 select-none py-0.5">
                <input type="checkbox" checked={semesterSel.has(s2.value)}
                  onChange={(e) => setSemesterSel((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(s2.value); else next.delete(s2.value);
                    return next;
                  })}
                  className="accent-[#1e5c97]" />
                {s2.label}
              </label>
            ))}
          </div>
          <select value={coachId} onChange={(e) => setCoachId(Number(e.target.value))} className={inputCls}>
            <option value={0}>All coaches</option>
            {coaches.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <select value={classId} onChange={(e) => setClassId(Number(e.target.value))} className={`${inputCls} max-w-52`}>
            <option value={0}>All classes</option>
            {classes.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <select value={day} onChange={(e) => { setDay(e.target.value); setClassId(0); }} className={inputCls}>
            {DAYS.map((d) => <option key={d} value={d}>{d || 'Any day'}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
            {STATUSES.map((s2) => <option key={s2} value={s2}>{s2 || 'Any status'}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateInput value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setDay(''); }} className={inputCls} />
          <span className="text-slate-400 text-sm">to</span>
          <DateInput value={dateTo} onChange={(e) => { setDateTo(e.target.value); setDay(''); }} className={inputCls} />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load()} placeholder="Search student…" className={`${inputCls} w-44`} />
          <button onClick={() => load()} disabled={loading}
            className="flex items-center gap-1.5 rounded-lg bg-[#1e5c97] hover:bg-[#17497a] text-white text-sm font-semibold px-5 py-1.5 disabled:opacity-50">
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Search
          </button>
          {rows && rows.length > 0 && (
            <button onClick={() => exportCsv(grid.sorted, CSV_COLS, 'AttendanceDetails')}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 text-slate-600 text-sm font-semibold px-4 py-1.5 hover:border-[#1e5c97]/40">
              <Download className="size-4" /> Export
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl p-3 mb-4">
          <AlertCircle className="size-4 text-red-500 shrink-0" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {search.trim() !== '' && (
        <div className="flex items-center gap-2 mb-3">
          <span className="inline-flex items-center gap-2 rounded-full bg-[#e8f0f8] border border-[#1e5c97]/20 text-[#1e5c97] text-sm font-bold px-4 py-1.5">
            <User className="size-4" /> Showing: {search}
            <button
              onClick={() => { setSearch(''); load(''); }}
              title="Clear and show all students"
              className="hover:text-red-600"
            >
              ×
            </button>
          </span>
        </div>
      )}

      {stats && <p className="text-base font-bold text-[#1e5c97] mb-3">{stats}</p>}

      {loading ? (
        <div className="flex items-center justify-center h-40"><Loader2 className="size-8 text-[#1e5c97] animate-spin" /></div>
      ) : !rows ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-soft p-8 text-center">
          <ClipboardCheck className="size-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500">Choose your filters and press Search to run the report.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-soft overflow-x-auto">
          <table className="tbl w-full text-base whitespace-nowrap [&_td]:py-3 [&_th]:py-3 [&_td]:px-3 [&_th]:px-3">
            <thead>
              <tr>
                <SortHeader label="Name" k="StudentFullName" grid={grid} />
                <SortHeader label="Phone" k="StudentPhoneNumber1" grid={grid} />
                <SortHeader label="Date" k="SessionDate" grid={grid} />
                <SortHeader label="Class" k="ClassName" grid={grid} />
                <SortHeader label="Status" k="AttendanceStatus" grid={grid} />
                <SortHeader label="Remarks" k="AttendanceRemarks" grid={grid} />
                <SortHeader label="Attended" k="AttendanceStudentAttended" grid={grid} />
                <SortHeader label="Makeuped" k="MakeUpInfo" grid={grid} />
              </tr>
            </thead>
            <tbody>
              {grid.pageRows.length === 0 && (
                <tr><td colSpan={8} className="text-center text-slate-400 py-6">No records found.</td></tr>
              )}
              {grid.pageRows.map((r, i) => (
                <tr key={i} className={stoppedCls(r)}>
                  <td className="font-semibold">{str(r, 'StudentFullName')}</td>
                  <td>{str(r, 'StudentPhoneNumber1')}</td>
                  <td>{dmy(r.SessionDate)}</td>
                  <td>{str(r, 'ClassName')}</td>
                  <td>{str(r, 'AttendanceStatus')}</td>
                  <td className="max-w-56 truncate" title={str(r, 'AttendanceRemarks')}>{str(r, 'AttendanceRemarks')}</td>
                  <td className="text-center">
                    {r.AttendanceStudentAttended === true
                      ? <span className="text-emerald-700 font-bold">Yes</span>
                      : <span className="text-red-600 font-bold">No</span>}
                  </td>
                  <td>{str(r, 'MakeUpInfo')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager grid={grid} total={rows.length} />
        </div>
      )}
    </div>
  );
}

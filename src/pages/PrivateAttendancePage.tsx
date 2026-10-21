// Private daily-attendance grid (PrivatePackagesDailyAttendance.aspx). Pick a
// date range (+ locations / criteria), mark each private session's attendance,
// overtime, state, remarks and make-up (date/time/coach/location), then save
// all rows at once. Filters live in the URL; the schedule deep-links here with
// ?date=&locationId= and other pages with ?criteria=.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Loader2, Save, Search, AlertCircle, Printer, Download, ChevronDown,
  ArrowUp, ArrowDown, ArrowUpDown,
} from 'lucide-react';
import { apiRequest, getStoredUser } from '../api/portalApi';
import { DateInput } from '../components/DateInput';
import { PageHero } from '../components/PageHero';
import { toast } from '../components/Toast';
import { toDate } from '../lib/dates';

type Opt = { value: number; label: string };

interface Row {
  PrivateSessionId: number;
  PackageId: number;
  LocationIcon: string;
  CoachFullName: string;
  StudentFullName: string;
  PrivateSessionDate: string;      // ISO as returned by the proc
  PrivateSessionTime: string;
  PrivateSessionStatus: string;    // Normal / Intensive ("Type" column)
  PrivateSessionAttended: boolean;
  PrivateSessionOverTime: boolean;
  PrivateSessionState: string;
  PrivateSessionRemarks: string;
  PrivateSessionMkupDate: string;  // yyyy-mm-dd or ''
  PrivateSessionMkupTime: string;
  PrivateSessionMkupCoachID: number;
  CoachMkup: string;               // make-up coach name (sort/export only)
  PrivateSessionLocationID: number;
  PackageNamewInfo: string;
  PackageStatus: string;
}

// Legacy txtState drop-down: only these five can be picked here. Package-level
// states ("Freeze Package", "Transfer Package", …) are set elsewhere; a row
// carrying one keeps it as an extra option so saving doesn't overwrite it.
const STATES = ['Regular', 'Cancelled By ProSwim', 'Cancelled Prev. By Student', 'Cancelled on same Day', 'Makeup'];

const CRITERIA = [
  { value: '', label: 'All Sessions' },
  { value: 'AttendedonThisTime', label: 'Attended on this time' },
  { value: 'GivenOnTime', label: 'Given On Time' },
  { value: 'MissedandMakeuped', label: 'Changed' },
  { value: 'Cancelled', label: 'Cancelled' },
  { value: 'UnIdentified', label: 'UnIdentified' },
  { value: 'Makeups', label: 'Makeups' },
];

const pad = (n: number) => String(n).padStart(2, '0');

// Legacy ddlMkupTime: blank + 04:30 … 22:45 in 15-minute steps.
const MKUP_TIMES: string[] = [''];
for (let m = 4 * 60 + 30; m <= 22 * 60 + 45; m += 15) MKUP_TIMES.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function fmtISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
// Legacy: Now.AddDays(DayOfWeek.Monday - Now.DayOfWeek); on a Sunday that is the coming Monday.
function mondayOfWeek(base: Date): Date {
  return addDays(base, 1 - base.getDay());
}
function toDateInput(v: unknown): string {
  const d = toDate(v);
  return d ? fmtISO(d) : '';
}
/** "ddd dd/MM/yy", the legacy grid's DataFormatString for the Date column. */
function fmtDDD(v: unknown): string {
  const d = toDate(v);
  return d ? `${DOW[d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)}` : '';
}
function hourOf(t: string): number {
  const m = /^(\d{1,2}):/.exec(t || '');
  return m ? Number(m[1]) : -1;
}
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function mapRow(r: Record<string, unknown>): Row {
  const s = (k: string) => String(r[k] ?? '');
  return {
    PrivateSessionId: Number(r.PrivateSessionId),
    PackageId: Number(r.PackageId ?? 0),
    LocationIcon: s('LocationIcon'),
    CoachFullName: s('CoachFullName'),
    StudentFullName: s('StudentFullName'),
    PrivateSessionDate: s('PrivateSessionDate'),
    PrivateSessionTime: s('PrivateSessionTime'),
    PrivateSessionStatus: s('PrivateSessionStatus'),
    PrivateSessionAttended: r.PrivateSessionAttended === true,
    PrivateSessionOverTime: r.PrivateSessionOverTime === true,
    PrivateSessionState: s('PrivateSessionState') || 'Regular',
    PrivateSessionRemarks: s('PrivateSessionRemarks'),
    PrivateSessionMkupDate: toDateInput(r.PrivateSessionMkupDate),
    PrivateSessionMkupTime: s('PrivateSessionMkupTime'),
    PrivateSessionMkupCoachID: Number(r.PrivateSessionMkupCoachID ?? 0),
    CoachMkup: s('CoachMkup'),
    PrivateSessionLocationID: Number(r.PrivateSessionLocationID ?? 0),
    PackageNamewInfo: s('PackageNamewInfo'),
    PackageStatus: s('PackageStatus'),
  };
}

// Header cells in legacy order; `key` is the sort/export column.
const COLS: { key: keyof Row; label: string; center?: boolean }[] = [
  { key: 'LocationIcon', label: 'Loc', center: true },
  { key: 'CoachFullName', label: 'Coach' },
  { key: 'StudentFullName', label: 'Student' },
  { key: 'PrivateSessionDate', label: 'Date' },
  { key: 'PrivateSessionTime', label: 'Time' },
  { key: 'PrivateSessionStatus', label: 'Type' },
  { key: 'PrivateSessionAttended', label: 'Att', center: true },
  { key: 'PrivateSessionOverTime', label: 'OT', center: true },
  { key: 'PrivateSessionState', label: 'Status' },
  { key: 'PrivateSessionRemarks', label: 'Remarks' },
  { key: 'PrivateSessionMkupDate', label: 'MkupDate' },
  { key: 'PrivateSessionMkupTime', label: 'MkupTime' },
  { key: 'CoachMkup', label: 'MkupCoach' },
  { key: 'PrivateSessionLocationID', label: 'Loc' },
  { key: 'PackageNamewInfo', label: 'Package' },
  { key: 'PackageStatus', label: 'PStatus' },
];

type Filters = { dateFrom: string; dateTo: string; locationIds: string; criteria: string; onlyActive: boolean };

export function PrivateAttendancePage() {
  const user = getStoredUser();
  const userType = (user?.userType || '').toLowerCase();
  const canSave = userType !== 'guest' && user?.canSave !== false;
  // Legacy PopulateDataSources: ddlLocations_MS.Enabled = false for every
  // 'user' account (pinned to the own location, or "all" when it has none).
  const locationLocked = userType === 'user';
  const [params, setParams] = useSearchParams();

  // Filters live in the URL. Legacy query-string aliases are honoured as
  // defaults and pinned into the canonical keys on mount:
  //   ?date=        one day (the schedule's day headers)
  //   ?locationId=  a single location
  //   ?criteria=    a criteria deep link also unticks "Only Active" (Page_Load)
  //   ?year=&month= the whole month (ReportsByPrivate drill-down)
  //   ?startDate= / ?endDate=  override the range (applied last in Page_Load)
  const monday = mondayOfWeek(new Date());
  const deepDate = params.get('date') || '';
  const qYear = Number(params.get('year')), qMonth = Number(params.get('month'));
  const hasMonth = qYear > 0 && qMonth >= 1 && qMonth <= 12;
  const monthFrom = hasMonth ? fmtISO(new Date(qYear, qMonth - 1, 1)) : '';
  const monthTo = hasMonth ? fmtISO(new Date(qYear, qMonth, 0)) : '';
  const dateFrom = params.get('dateFrom') ?? (toDateInput(params.get('startDate')) || monthFrom || deepDate || fmtISO(monday));
  const dateTo = params.get('dateTo') ?? (toDateInput(params.get('endDate')) || monthTo || deepDate || fmtISO(addDays(monday, 5)));
  const locationIds = locationLocked
    ? (user?.primaryLocationId ? String(user.primaryLocationId) : '')
    : params.get('locationIds') ?? params.get('locationId') ?? (user?.primaryLocationId ? String(user.primaryLocationId) : '');
  const criteria = params.get('criteria') ?? '';
  const onlyActive = params.has('onlyActive') ? params.get('onlyActive') === 'true' : !params.has('criteria');
  const current: Filters = { dateFrom, dateTo, locationIds, criteria, onlyActive };

  // One navigation for all keys (react-router's functional setter reads the
  // render-time params, so sequential single-key sets would clobber each other).
  const patch = (obj: Partial<Record<keyof Filters, string | boolean>>) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(obj)) next.set(k, String(v));
      return next;
    }, { replace: true });

  const [rows, setRows] = useState<Row[]>([]);
  const [coaches, setCoaches] = useState<Opt[]>([]);
  const [locations, setLocations] = useState<Opt[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [sortKey, setSortKey] = useState<keyof Row>('PrivateSessionTime');
  const [sortAsc, setSortAsc] = useState(true);
  const [locOpen, setLocOpen] = useState(false);
  const locBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Legacy binds every coach (Coach_Select()) and every location per row.
    apiRequest<{
      locations: { locationId: number; locationNickName: string | null }[];
      coaches: { coachId: number; coachFullName: string | null }[];
    }>('/api/portal/students/lookups')
      .then((lk) => {
        setLocations((lk.locations ?? []).map((l) => ({ value: l.locationId, label: l.locationNickName ?? `#${l.locationId}` })));
        setCoaches((lk.coaches ?? []).map((c) => ({ value: c.coachId, label: c.coachFullName ?? `#${c.coachId}` })));
      })
      .catch(() => {});
  }, []);

  function load(f: Filters = current) {
    setLoading(true);
    setError('');
    setDirty(false);
    const q = new URLSearchParams({ dateFrom: f.dateFrom, dateTo: f.dateTo, criteria: f.criteria, onlyActive: String(f.onlyActive) });
    if (f.locationIds) q.set('locationIds', f.locationIds);
    apiRequest<Record<string, unknown>[]>(`/api/portal/modules/private-attendance?${q}`)
      .then((data) => setRows(data.map(mapRow)))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load sessions.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    patch({ dateFrom, dateTo, locationIds, criteria, onlyActive });
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Close the location picker on an outside click.
  useEffect(() => {
    if (!locOpen) return;
    const h = (e: MouseEvent) => {
      if (locBox.current && !locBox.current.contains(e.target as Node)) setLocOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [locOpen]);

  // Legacy AutoPostBack: every filter reloads the grid on change. The location
  // combo (RadComboBox with check boxes) posts back once it closes, so reload
  // when the picker closes with a different selection than it opened with.
  const latest = useRef(current);
  latest.current = current;
  const locAtOpen = useRef<string | null>(null);
  useEffect(() => {
    if (locOpen) { locAtOpen.current = latest.current.locationIds; return; }
    if (locAtOpen.current !== null && locAtOpen.current !== latest.current.locationIds) load(latest.current);
    locAtOpen.current = null;
  }, [locOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  function applyFilter(obj: Partial<Filters>) {
    patch(obj);
    // A cleared date is not applied until a full date is typed again.
    if (obj.dateFrom === '' || obj.dateTo === '') return;
    load({ ...current, ...obj });
  }

  const selectedLocs = locationIds.split(',').map(Number).filter((n) => n > 0);
  function toggleLoc(id: number) {
    const next = selectedLocs.includes(id) ? selectedLocs.filter((x) => x !== id) : [...selectedLocs, id];
    patch({ locationIds: next.join(',') });
  }
  const locLabel =
    selectedLocs.length === 0 ? 'All locations'
    : selectedLocs.length === 1 ? (locations.find((l) => l.value === selectedLocs[0])?.label ?? '1 location')
    : `${selectedLocs.length} locations`;

  // ── grid state ────────────────────────────────────────────────────────────
  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      const va = a[sortKey], vb = b[sortKey];
      const cmp =
        typeof va === 'number' && typeof vb === 'number' ? va - vb
        : typeof va === 'boolean' && typeof vb === 'boolean' ? Number(va) - Number(vb)
        : String(va ?? '').localeCompare(String(vb ?? ''), undefined, { numeric: true, sensitivity: 'base' });
      return sortAsc ? cmp : -cmp;
    });
    return arr;
  }, [rows, sortKey, sortAsc]);

  function toggleSort(key: keyof Row) {
    if (sortKey === key) setSortAsc((x) => !x);
    else { setSortKey(key); setSortAsc(true); }
  }

  function set<K extends keyof Row>(id: number, key: K, value: Row[K]) {
    setRows((old) => old.map((r) => (r.PrivateSessionId === id ? { ...r, [key]: value } : r)));
    setDirty(true);
  }

  // Legacy txtState_Change: "Cancelled Prev. By Student" can't be chosen for a
  // session dated today or later (session date >= now - 6h) → alert + Regular.
  function changeState(r: Row, value: string) {
    if (value === 'Cancelled Prev. By Student') {
      const d = toDate(r.PrivateSessionDate);
      if (d && d.getTime() >= Date.now() - 6 * 3600 * 1000) {
        window.alert('Date of Session is same as Current Date, Can not choose this Status, Please Correct');
        set(r.PrivateSessionId, 'PrivateSessionState', 'Regular');
        return;
      }
    }
    set(r.PrivateSessionId, 'PrivateSessionState', value);
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      // Legacy BtnSaveAttendance: attended ⇒ "Regular", remarks lower-cased
      // (the API enforces both as well, plus the 6-hour rule above).
      const sessions = rows.map((r) => ({
        ...r,
        PrivateSessionState: r.PrivateSessionAttended ? 'Regular' : r.PrivateSessionState,
        PrivateSessionRemarks: r.PrivateSessionRemarks.toLowerCase(),
      }));
      await apiRequest('/api/portal/edit/private-attendance', { method: 'PUT', body: JSON.stringify({ sessions }) });
      toast.success('Attendance saved.');
      load();
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Save failed.';
      setError(m);
      toast.error(m);
    } finally {
      setSaving(false);
    }
  }

  // Legacy BtnPrint: Date / Time / Type / Attendance / Status / Remarks report.
  function print() {
    const body = sorted.map((r) => `<tr>
      <td align=center>${esc(fmtDDD(r.PrivateSessionDate))}</td>
      <td align=center>${esc(r.PrivateSessionTime)}</td>
      <td align=center>${esc(r.PrivateSessionStatus)}</td>
      <td align=center>${r.PrivateSessionAttended ? 'Attended' : 'Absent'}</td>
      <td align=center>${esc(r.PrivateSessionState)}</td>
      <td align=center>${esc(r.PrivateSessionRemarks)}</td>
    </tr>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Private Package</title>
      <style>body{font-family:Arial,sans-serif;font-size:12px}table{border-collapse:collapse}td{padding:3px 6px}</style></head><body>
      <table cellspacing=3 cellpadding=3 width="100%">
        <tr><td colspan=2><h2>Private Package</h2></td><td colspan=2 align="right">Swimming Classes</td></tr>
        <tr><td colspan=4><br/></td></tr>
        <tr><td colspan=4 align=center><table width="90%" border=1 style="border-style:solid;">
          <tr style="background-color:#dddddd">
            <td align=center><b>Date</b></td><td align=center><b>Time</b></td><td align=center><b>Type</b></td>
            <td align=center><b>Attendance</b></td><td align=center><b>Status</b></td><td align=center><b>Remarks</b></td>
          </tr>${body}</table></td></tr>
      </table>
      <script>window.onload = function () { window.print(); };</script></body></html>`;
    const w = window.open('', '_blank');
    if (!w) { toast.error('The browser blocked the print window.'); return; }
    w.document.write(html);
    w.document.close();
  }

  // Legacy BtnExport: the full result table, including the hidden
  // Att/OT/State/Remarks/Mkup* bound columns.
  function exportCsv() {
    const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = [...COLS.map((c) => c.label), 'PackageId'].join(',');
    const lines = sorted.map((r) => [
      ...COLS.map((c) => {
        const v = r[c.key];
        if (c.key === 'PrivateSessionDate') return cell(fmtDDD(v));
        if (c.key === 'PrivateSessionLocationID') return cell(locations.find((l) => l.value === v)?.label ?? v);
        if (c.key === 'CoachMkup') return cell(coaches.find((x) => x.value === r.PrivateSessionMkupCoachID)?.label ?? v);
        return cell(v);
      }),
      cell(r.PackageId),
    ].join(','));
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `private-sessions_${dateFrom}_${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // Legacy GVResult_RowDataBound: attended rows green; the row whose time (or
  // make-up time, when the make-up date is the page's _SpecificDate = ?date=
  // or today) is in the current hour bold. Legacy matched the hour as a
  // substring of the time text (hour 5 also hit 15:xx and xx:15); the exact
  // hour is compared here.
  const now = new Date();
  const specificISO = deepDate ? deepDate.slice(0, 10) : fmtISO(now);
  function rowStyle(r: Row): React.CSSProperties {
    const bold = r.PrivateSessionMkupDate
      ? r.PrivateSessionMkupDate === specificISO && hourOf(r.PrivateSessionMkupTime) === now.getHours()
      : hourOf(r.PrivateSessionTime) === now.getHours();
    return {
      backgroundColor: r.PrivateSessionAttended ? 'rgb(0,204,102)' : undefined,
      fontWeight: bold ? 700 : undefined,
    };
  }

  const inputCls =
    'rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[#1e5c97]/40 disabled:bg-slate-50 disabled:text-slate-400';
  const btnCls =
    'flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#1e5c97] hover:bg-slate-50 transition-colors';

  return (
    <div className="p-6">
      <PageHero
        title="Private Daily Attendance"
        subtitle={loading ? 'Loading…' : `${rows.length} Sessions`}
        right={
          <div className="flex items-center gap-2">
            {rows.length > 0 && (
              <button type="button" onClick={print} className={btnCls}>
                <Printer className="size-3.5" /> Print
              </button>
            )}
            {user?.canExport && rows.length > 0 && (
              <button type="button" onClick={exportCsv} className={btnCls}>
                <Download className="size-3.5" /> Export
              </button>
            )}
            {canSave && rows.length > 0 && (
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="btn-grad flex items-center gap-1.5 rounded-lg text-xs font-semibold px-3 py-1.5 disabled:opacity-60"
              >
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                Save Attendance{dirty && <span className="ml-1 text-amber-200">•</span>}
              </button>
            )}
          </div>
        }
      />

      <form
        onSubmit={(e) => { e.preventDefault(); load(); }}
        className="bg-white rounded-2xl border border-slate-100 shadow-sm p-3 mb-4 flex flex-wrap items-center gap-2"
      >
        {/* Multi-location picker (legacy RadComboBox with check boxes). */}
        <div ref={locBox} className="relative">
          <button
            type="button"
            disabled={locationLocked}
            onClick={() => setLocOpen((o) => !o)}
            className={`${inputCls} flex items-center gap-1 py-1.5 min-w-36 text-left`}
          >
            <span className="flex-1 truncate">{locLabel}</span>
            <ChevronDown className="size-3.5 text-slate-400" />
          </button>
          {locOpen && (
            <div className="absolute z-20 mt-1 w-52 max-h-64 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg p-1">
              <button
                type="button"
                onClick={() => patch({ locationIds: '' })}
                className="w-full text-left px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 rounded"
              >
                All locations
              </button>
              {locations.map((l) => (
                <label key={l.value} className="flex items-center gap-2 px-2 py-1 text-xs hover:bg-slate-50 rounded cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={selectedLocs.includes(l.value)}
                    onChange={() => toggleLoc(l.value)}
                    className="accent-[#1e5c97]"
                  />
                  {l.label}
                </label>
              ))}
            </div>
          )}
        </div>
        <label className="flex items-center gap-1 text-xs text-slate-500">
          From
          <DateInput value={dateFrom} onChange={(e) => applyFilter({ dateFrom: e.target.value })} className={inputCls} />
        </label>
        <label className="flex items-center gap-1 text-xs text-slate-500">
          To
          <DateInput value={dateTo} onChange={(e) => applyFilter({ dateTo: e.target.value })} className={inputCls} />
        </label>
        <select value={criteria} onChange={(e) => applyFilter({ criteria: e.target.value })} className={inputCls}>
          {CRITERIA.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <label className="flex items-center gap-1 text-xs text-slate-500 select-none px-1">
          <input type="checkbox" checked={onlyActive} onChange={(e) => applyFilter({ onlyActive: e.target.checked })} className="accent-[#1e5c97]" />
          Show Only Active Packs
        </label>
        <button type="submit" className="btn-grad ml-auto rounded-lg text-xs font-semibold px-4 py-1.5">
          <Search className="size-3.5 inline -mt-0.5 mr-1" /> Search
        </button>
      </form>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl p-3 mb-3">
          <AlertCircle className="size-4 text-red-500 shrink-0" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="size-8 text-[#1e5c97] animate-spin" />
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-soft overflow-x-auto">
          <table className="w-full text-xs whitespace-nowrap">
            <thead>
              <tr className="text-left text-[11px] text-slate-400 uppercase tracking-wider border-b border-slate-100">
                {COLS.map((c) => (
                  <th key={c.key} className={`px-2 py-3 font-semibold ${c.center ? 'text-center' : ''}`}>
                    <button
                      type="button"
                      onClick={() => toggleSort(c.key)}
                      className={`inline-flex items-center gap-1 hover:text-slate-600 ${c.center ? 'justify-center' : ''}`}
                    >
                      {c.label}
                      {sortKey === c.key
                        ? (sortAsc ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)
                        : <ArrowUpDown className="size-3 opacity-40" />}
                    </button>
                  </th>
                ))}
                <th className="px-2 py-3 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const states = STATES.includes(r.PrivateSessionState) ? STATES : [...STATES, r.PrivateSessionState];
                return (
                  <tr key={r.PrivateSessionId} className="border-b border-slate-50 last:border-0" style={rowStyle(r)}>
                    <td className="px-2 py-1.5 text-center text-slate-600">{r.LocationIcon}</td>
                    <td className="px-2 py-1.5 text-slate-600">{r.CoachFullName}</td>
                    <td className="px-2 py-1.5 font-semibold text-slate-700">{r.StudentFullName}</td>
                    <td className="px-2 py-1.5 text-slate-600">{fmtDDD(r.PrivateSessionDate)}</td>
                    <td className="px-2 py-1.5 text-slate-600">{r.PrivateSessionTime}</td>
                    <td className="px-2 py-1.5 text-slate-600">{r.PrivateSessionStatus}</td>
                    <td className="px-2 py-1.5 text-center">
                      <input type="checkbox" disabled={!canSave} checked={r.PrivateSessionAttended}
                        onChange={(e) => set(r.PrivateSessionId, 'PrivateSessionAttended', e.target.checked)}
                        className="accent-[#1e5c97]" />
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <input type="checkbox" disabled={!canSave} checked={r.PrivateSessionOverTime}
                        onChange={(e) => set(r.PrivateSessionId, 'PrivateSessionOverTime', e.target.checked)}
                        className="accent-[#1e5c97]" />
                    </td>
                    <td className="px-2 py-1.5">
                      <select disabled={!canSave} value={r.PrivateSessionState}
                        onChange={(e) => changeState(r, e.target.value)}
                        className={`${inputCls} w-36`}>
                        {states.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="text" disabled={!canSave} value={r.PrivateSessionRemarks}
                        onChange={(e) => set(r.PrivateSessionId, 'PrivateSessionRemarks', e.target.value)}
                        className={`${inputCls} w-36`} />
                    </td>
                    <td className="px-2 py-1.5">
                      <DateInput disabled={!canSave} value={r.PrivateSessionMkupDate}
                        onChange={(e) => set(r.PrivateSessionId, 'PrivateSessionMkupDate', e.target.value)}
                        className={`${inputCls} w-28`} />
                    </td>
                    <td className="px-2 py-1.5">
                      <select disabled={!canSave} value={r.PrivateSessionMkupTime}
                        onChange={(e) => set(r.PrivateSessionId, 'PrivateSessionMkupTime', e.target.value)}
                        className={inputCls}>
                        {MKUP_TIMES.map((t) => <option key={t || '-'} value={t}>{t}</option>)}
                        {/* A stored time outside the 15-minute list stays visible (and is saved back as is). */}
                        {!MKUP_TIMES.includes(r.PrivateSessionMkupTime) && (
                          <option value={r.PrivateSessionMkupTime}>{r.PrivateSessionMkupTime}</option>
                        )}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <select disabled={!canSave} value={r.PrivateSessionMkupCoachID}
                        onChange={(e) => set(r.PrivateSessionId, 'PrivateSessionMkupCoachID', Number(e.target.value))}
                        className={`${inputCls} w-28`}>
                        <option value={0}>Not Selected</option>
                        {coaches.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                        {/* Legacy binds every coach (Coach_Select()); the lookup lists active ones,
                            so an inactive make-up coach is added from the row's CoachMkup name. */}
                        {r.PrivateSessionMkupCoachID > 0 && !coaches.some((c) => c.value === r.PrivateSessionMkupCoachID) && (
                          <option value={r.PrivateSessionMkupCoachID}>{r.CoachMkup || `#${r.PrivateSessionMkupCoachID}`}</option>
                        )}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <select disabled={!canSave} value={r.PrivateSessionLocationID}
                        onChange={(e) => set(r.PrivateSessionId, 'PrivateSessionLocationID', Number(e.target.value))}
                        className={`${inputCls} w-24`}>
                        <option value={0}>Not Selected</option>
                        {locations.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                        {r.PrivateSessionLocationID > 0 && !locations.some((l) => l.value === r.PrivateSessionLocationID) && (
                          <option value={r.PrivateSessionLocationID}>#{r.PrivateSessionLocationID}</option>
                        )}
                      </select>
                    </td>
                    <td className="px-2 py-1.5 text-slate-500">{r.PackageNamewInfo}</td>
                    <td className="px-2 py-1.5 text-slate-500">{r.PackageStatus}</td>
                    <td className="px-2 py-1.5">
                      {/* Legacy opened the package in a popup, keeping unsaved attendance edits. */}
                      <Link to={`/privates/${r.PackageId}`} target="_blank" rel="noopener" className="font-bold text-[#1e5c97] hover:underline">Pck</Link>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={COLS.length + 1} className="px-4 py-10 text-center text-slate-400">No sessions for this range.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

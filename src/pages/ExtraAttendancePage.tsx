// Extra-class / membership daily attendance (legacy ExtraClassDailyAttendance.aspx,
// menu "ExSessions" and "M-Sessions" = ?Memberships=True). Locations / class
// types / date range / "Show Only Active Packs" (all AutoPostBack), then tick
// attendance + remarks per session and "Save Attendace". Filters live in the
// URL so leaving (Edit, Add Payment) and coming back keeps them.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Loader2, Save, Search, AlertCircle, ChevronDown, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { apiRequest, getStoredUser } from '../api/portalApi';
import { DateInput } from '../components/DateInput';
import { PageHero } from '../components/PageHero';
import { toast } from '../components/Toast';
import { toDate } from '../lib/dates';

import { useStickySort, routeGridKey } from '../lib/stickySort';
type Opt = { value: string; label: string };

interface Row {
  ExtraClassSessionId: number;
  ExtraClassId: number;
  LocationIcon: string;
  ExtraClassType: string;
  StudentFullName: string;
  ExtraClassSessionDate: string;
  ExtraClassSessionTime: string;
  ExtraClassSessionState: string;
  ExtraClassSessionAttended: boolean;
  ExtraClassSessionRemarks: string;
  ExtraClassStartDate: string;
  ExtraClassNumberOfSessions: number;
  SessionsLeft: number;
  ExtraClassCost: number;
  DuePayment: number;
  Phone: string;
}

const TYPES = ['AquaBaby', 'AquaGym', 'AquaMermaid', 'MemberShipPasses', 'MemberShip', 'Others'];
const MEMBERSHIP_TYPES = ['MemberShipPasses', 'MemberShip'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (x: number) => String(x).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, k: number) => { const x = new Date(d); x.setDate(x.getDate() + k); return x; };
/** "ddd dd/MM/yyyy", the legacy Date column format. */
const fmtDDD = (v: unknown) => { const d = toDate(v); return d ? `${DOW[d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}` : ''; };
const fmtDMY = (v: unknown) => { const d = toDate(v); return d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}` : ''; };
const money = (v: number) => (Number.isFinite(v) ? Math.trunc(v).toLocaleString() : '');

function mapRow(r: Record<string, unknown>): Row {
  const s = (k: string) => String(r[k] ?? '');
  const n = (k: string) => Number(r[k] ?? 0) || 0;
  return {
    ExtraClassSessionId: n('ExtraClassSessionId'),
    ExtraClassId: n('ExtraClassId'),
    LocationIcon: s('LocationIcon'),
    ExtraClassType: s('ExtraClassType'),
    StudentFullName: s('StudentFullName'),
    ExtraClassSessionDate: s('ExtraClassSessionDate'),
    ExtraClassSessionTime: s('ExtraClassSessionTime'),
    ExtraClassSessionState: s('ExtraClassSessionState'),
    ExtraClassSessionAttended: r.ExtraClassSessionAttended === true,
    ExtraClassSessionRemarks: s('ExtraClassSessionRemarks'),
    ExtraClassStartDate: s('ExtraClassStartDate'),
    ExtraClassNumberOfSessions: n('ExtraClassNumberOfSessions'),
    SessionsLeft: n('SessionsLeft'),
    ExtraClassCost: n('ExtraClassCost'),
    DuePayment: n('DuePayment'),
    Phone: s('Phone'),
  };
}

// Header cells in legacy order (sortable bound columns). The legacy grid has a
// second "Type" header for the session state; it is labelled "State" here.
const COLS: { key: keyof Row; label: string; center?: boolean }[] = [
  { key: 'LocationIcon', label: 'Loc', center: true },
  { key: 'ExtraClassType', label: 'Type' },
  { key: 'StudentFullName', label: 'Student' },
  { key: 'ExtraClassSessionDate', label: 'Date' },
  { key: 'ExtraClassSessionTime', label: 'Time' },
  { key: 'ExtraClassSessionState', label: 'State' },
  { key: 'ExtraClassSessionAttended', label: 'Att', center: true },
  { key: 'ExtraClassSessionRemarks', label: 'Remarks' },
  { key: 'ExtraClassStartDate', label: 'Start Date' },
  { key: 'ExtraClassNumberOfSessions', label: 'Sessions', center: true },
  { key: 'SessionsLeft', label: 'Left', center: true },
  { key: 'ExtraClassCost', label: 'Amount' },
  { key: 'DuePayment', label: 'Due' },
  { key: 'Phone', label: 'Phone' },
];

/** Check-box drop-down with "Check all" (legacy RadComboBox CheckBoxes). */
function MultiPick({ label, options, value, disabled, onChange }: {
  label: string; options: Opt[]; value: string; disabled?: boolean; onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const picked = new Set(value.split(',').map((x) => x.trim()).filter(Boolean));
  const all = options.length > 0 && options.every((o) => picked.has(o.value));
  const text = picked.size === 0 ? label
    : picked.size === 1 ? options.find((o) => picked.has(o.value))?.label ?? label
    : all ? `${label}: All` : `${label}: ${picked.size}`;
  const emit = (set: Set<string>) => onChange(options.filter((o) => set.has(o.value)).map((o) => o.value).join(','));
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600 flex items-center gap-1 min-w-36 text-left disabled:bg-slate-50 disabled:text-slate-400"
      >
        <span className="flex-1 truncate">{text}</span>
        <ChevronDown className="size-3.5 text-slate-400" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-52 max-h-64 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg p-1 text-xs">
          <label className="flex items-center gap-2 px-2 py-1 font-semibold text-slate-700 border-b border-slate-100 mb-1 select-none">
            <input type="checkbox" checked={all} onChange={(e) => emit(new Set(e.target.checked ? options.map((o) => o.value) : []))} className="accent-[#1e5c97]" />
            Check all
          </label>
          {options.map((o) => (
            <label key={o.value} className="flex items-center gap-2 px-2 py-1 hover:bg-slate-50 rounded cursor-pointer select-none">
              <input
                type="checkbox"
                checked={picked.has(o.value)}
                onChange={() => { const next = new Set(picked); if (next.has(o.value)) next.delete(o.value); else next.add(o.value); emit(next); }}
                className="accent-[#1e5c97]"
              />
              {o.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function ExtraAttendancePage({ memberships = false }: { memberships?: boolean }) {
  const user = getStoredUser();
  const userType = (user?.userType || '').toLowerCase();
  const canSave = userType !== 'guest' && user?.canSave !== false;
  const canOpen = userType !== 'guest';
  const locationLocked = userType === 'user';
  const [params, setParams] = useSearchParams();

  // Legacy defaults: From = the 1st of (today − 3 days)'s month, To = today + 5;
  // locations = the user's own; every type ticked (membership types only on
  // M-Sessions); "Show Only Active Packs" ticked. ?date= / ?locationId= aliases.
  const now = new Date();
  const back3 = addDays(now, -3);
  const deepDate = params.get('date') || '';
  const dateFrom = params.get('dateFrom') ?? (deepDate || iso(new Date(back3.getFullYear(), back3.getMonth(), 1)));
  const dateTo = params.get('dateTo') ?? (deepDate || iso(addDays(now, 5)));
  const ownLoc = user?.primaryLocationId ? String(user.primaryLocationId) : '';
  const locationIds = locationLocked
    ? ownLoc
    : params.get('locationIds') ?? params.get('locationId') ?? ownLoc;
  const types = params.get('types') ?? (memberships ? MEMBERSHIP_TYPES : TYPES).join(',');
  // Legacy Page_Load: a ?Criteria= deep link unticks "Show Only Active Packs".
  const onlyActive = params.has('onlyActive') ? params.get('onlyActive') === 'true' : !params.has('criteria');

  const patch = (obj: Record<string, string | boolean>) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(obj)) next.set(k, String(v));
      return next;
    }, { replace: true });

  const [rows, setRows] = useState<Row[]>([]);
  const [locations, setLocations] = useState<Opt[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [sortKey, setSortKey, sortAsc, setSortAsc] = useStickySort<keyof Row>(routeGridKey(), 'ExtraClassSessionTime');

  useEffect(() => {
    apiRequest<{ locations: { value: number; label: string }[] }>('/api/portal/modules/lookups')
      .then((lk) => setLocations((lk.locations ?? []).map((l) => ({ value: String(l.value), label: l.label }))))
      .catch(() => {});
  }, []);

  function load() {
    setLoading(true);
    setError('');
    setDirty(false);
    const q = new URLSearchParams({ onlyActive: String(onlyActive) });
    if (dateFrom) q.set('dateFrom', dateFrom);
    if (dateTo) q.set('dateTo', dateTo);
    if (locationIds) q.set('locationIds', locationIds);
    if (types) q.set('classType', types);
    apiRequest<Record<string, unknown>[]>(`/api/portal/modules/extra-attendance?${q}`)
      .then((data) => setRows(data.map(mapRow)))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load sessions.'))
      .finally(() => setLoading(false));
  }

  // Every legacy filter is AutoPostBack: reload whenever one changes (and on open).
  useEffect(() => { load(); }, [dateFrom, dateTo, locationIds, types, onlyActive]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setRows((old) => old.map((r) => (r.ExtraClassSessionId === id ? { ...r, [key]: value } : r)));
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      // Legacy BtnSaveAttendance: remarks lower-cased, state "Regular" when
      // attended else blank (applied by the API too).
      const sessions = rows.map((r) => ({
        ExtraClassSessionId: r.ExtraClassSessionId,
        ExtraClassSessionAttended: r.ExtraClassSessionAttended,
        ExtraClassSessionRemarks: r.ExtraClassSessionRemarks.toLowerCase(),
      }));
      await apiRequest('/api/portal/edit/extra-attendance', { method: 'PUT', body: JSON.stringify({ sessions }) });
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

  const inputCls =
    'rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[#1e5c97]/40 disabled:bg-slate-50 disabled:text-slate-400';

  return (
    <div className="p-6">
      <PageHero
        title={memberships ? 'Membership Attendance' : 'Extra Class Attendance'}
        subtitle={loading ? 'Loading…' : `${rows.length} Sessions`}
        right={
          canSave && rows.length > 0 ? (
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="btn-grad flex items-center gap-1.5 rounded-lg text-xs font-semibold px-3 py-1.5 disabled:opacity-60"
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              Save Attendance{dirty && <span className="ml-1 text-amber-200">•</span>}
            </button>
          ) : undefined
        }
      />

      <form
        onSubmit={(e) => { e.preventDefault(); load(); }}
        className="bg-white rounded-2xl border border-slate-100 shadow-sm p-3 mb-4 flex flex-wrap items-center gap-2"
      >
        <MultiPick
          label="Location"
          options={locations}
          value={locationIds}
          disabled={locationLocked}
          onChange={(v) => patch({ locationIds: v })}
        />
        <MultiPick
          label="Class Types"
          options={TYPES.map((t) => ({ value: t, label: t }))}
          value={types}
          onChange={(v) => patch({ types: v })}
        />
        <label className="flex items-center gap-1 text-xs text-slate-500">
          From
          <DateInput value={dateFrom} onChange={(e) => patch({ dateFrom: e.target.value })} className={inputCls} />
        </label>
        <label className="flex items-center gap-1 text-xs text-slate-500">
          To
          <DateInput value={dateTo} onChange={(e) => patch({ dateTo: e.target.value })} className={inputCls} />
        </label>
        <label className="flex items-center gap-1 text-xs text-slate-500 select-none px-1">
          <input type="checkbox" checked={onlyActive} onChange={(e) => patch({ onlyActive: e.target.checked })} className="accent-[#1e5c97]" />
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
                    <button type="button" onClick={() => toggleSort(c.key)} className="inline-flex items-center gap-1 hover:text-slate-600">
                      {c.label}
                      {sortKey === c.key
                        ? (sortAsc ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)
                        : <ArrowUpDown className="size-3 opacity-40" />}
                    </button>
                  </th>
                ))}
                <th className="px-2 py-3" />
                <th className="px-2 py-3" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr
                  key={r.ExtraClassSessionId}
                  className="border-b border-slate-50 last:border-0"
                  // Legacy RowDataBound: attended rows green.
                  style={{ backgroundColor: r.ExtraClassSessionAttended ? 'rgb(0,204,102)' : undefined }}
                >
                  <td className="px-2 py-1.5 text-center text-slate-600">{r.LocationIcon}</td>
                  <td className="px-2 py-1.5 text-slate-600">{r.ExtraClassType}</td>
                  <td className="px-2 py-1.5 font-semibold text-slate-700">{r.StudentFullName}</td>
                  <td className="px-2 py-1.5 text-slate-600">{fmtDDD(r.ExtraClassSessionDate)}</td>
                  <td className="px-2 py-1.5 text-slate-600">{r.ExtraClassSessionTime}</td>
                  {/* Stored state, read-only: the legacy Status drop-down was never saved. */}
                  <td className="px-2 py-1.5 text-slate-600">{r.ExtraClassSessionState}</td>
                  <td className="px-2 py-1.5 text-center">
                    <input
                      type="checkbox"
                      disabled={!canSave}
                      checked={r.ExtraClassSessionAttended}
                      onChange={(e) => set(r.ExtraClassSessionId, 'ExtraClassSessionAttended', e.target.checked)}
                      className="accent-[#1e5c97]"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="text"
                      disabled={!canSave}
                      value={r.ExtraClassSessionRemarks}
                      onChange={(e) => set(r.ExtraClassSessionId, 'ExtraClassSessionRemarks', e.target.value)}
                      className={`${inputCls} w-36`}
                    />
                  </td>
                  <td className="px-2 py-1.5 text-slate-600">{fmtDMY(r.ExtraClassStartDate)}</td>
                  <td className="px-2 py-1.5 text-center text-slate-600">{r.ExtraClassNumberOfSessions}</td>
                  <td className="px-2 py-1.5 text-center text-slate-600">{r.SessionsLeft}</td>
                  <td className="px-2 py-1.5 text-slate-600">{money(r.ExtraClassCost)}</td>
                  <td className="px-2 py-1.5 text-slate-600">{money(r.DuePayment)}</td>
                  <td className="px-2 py-1.5 text-slate-600">{r.Phone}</td>
                  <td className="px-2 py-1.5">
                    {canOpen && (
                      <Link to={`/extra-classes/${r.ExtraClassId}`} className="font-bold text-[#1e5c97] hover:underline">Edit</Link>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {canSave && (
                      <Link to={`/pr-payments/new?packageId=${r.ExtraClassId}`} className="font-bold text-emerald-800 hover:underline">
                        Add Payment
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={COLS.length + 2} className="px-4 py-10 text-center text-slate-400">No sessions for this range.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

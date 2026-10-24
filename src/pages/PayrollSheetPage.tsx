// Payroll sheet, port of TimeSheetPayroll.aspx. All money math happens in the
// stored procedures (rates × hours, salary %, net); this grid shows the
// computed columns, lets the SiteMaster edit hour counts / bonus / penalty /
// loans, toggle Paid / NoWork, and re-run the HR recalculation.
// NOTE: P_TimeSheet_Payroll_RefreshFromHR resets every unpaid row's counts to
// the supervisor counts, so it must NOT run after a save (that silently undid
// edits); it only runs from the explicit, confirmed "Re-Calculate from HR".
//
// Each discipline (Private, Team, …) is a 3-part section like the legacy grid:
// Rate (hourly rate from HR, read-only) × Cnt (editable hours) = Total. The
// user picks which columns to show from the "Columns" menu; the choice is
// saved per user in the DB (tbl_Portal_UserPrefs via /api/portal/prefs) so it
// sticks across devices and sessions.
//
// Two ways to work: the overview grid (location filter + full column totals),
// and a per-coach payroll card (click a coach) to review and edit one coach at
// a time in a clean layout.

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useUrlParam } from '../lib/urlState';
import { createPortal } from 'react-dom';
import { useParams, Link } from 'react-router-dom';
import { Loader2, AlertCircle, RefreshCw, Save, Download, X, Check, History, UserCog, ChevronRight, SquarePen, Columns3, RotateCcw } from 'lucide-react';
import { apiRequest, getStoredUser } from '../api/portalApi';
import { PageHero } from '../components/PageHero';
import { PickerPanel } from '../components/PickerPanel';
import { SmartBack } from '../components/SmartBack';
import { toast } from '../components/Toast';

type Row = Record<string, unknown>;
type Cur = 'USD' | 'LBP';

const num = (r: Row, k: string) => Number(r[k] ?? 0);
const str = (r: Row, k: string) => (r[k] == null ? '' : String(r[k]));
const money = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 0 });
// Salary-side currency (salary, bonus, penalty, loans, net) vs hourly-side
// currency (per-discipline rates & totals) — the legacy grid labels them separately.
const curOf = (r: Row): Cur => (str(r, 'PayrollSalaryCurrency') === 'LBP' ? 'LBP' : 'USD');
const hrCurOf = (r: Row): Cur => (str(r, 'PayrollHrlyCurrency') === 'LBP' ? 'LBP' : 'USD');
const sym = (c: Cur) => (c === 'USD' ? '$' : 'LL');
// Timesheet label from the "To" (end) date's month — falls back to the stored title.
const tsLabel = (r: Row): string => {
  const d = str(r, 'TimesheetEndDate');
  const t = d ? new Date(d) : null;
  if (t && !isNaN(t.getTime())) return `${t.getFullYear()}/${t.getMonth() + 1}`;
  return str(r, 'TimesheetTitle');
};
// The proc returns the payroll table's own column, spelled TimeSheetID (capital S).
const tsIdOf = (r: Row): number => num(r, 'TimeSheetID') || num(r, 'TimesheetID');
const tsTime = (r: Row): number => {
  const d = str(r, 'TimesheetEndDate');
  const t = d ? new Date(d).getTime() : NaN;
  if (!isNaN(t)) return t;
  const y = num(r, 'TimesheetYr'), m = num(r, 'TimesheetMonth');
  return y ? y * 12 + m : tsIdOf(r);
};

// One payroll section per discipline. In tbl_TimeSheet_Payroll the "…Hr"
// column is the HOURLY RATE (from the coach's HR record), "…HrCnt" is the hours
// counted for pay, and the proc returns "…Total" = rate × count.
type Discipline = { key: string; label: string; rate: string; cnt: string; total: string };
const DISCIPLINES: Discipline[] = [
  { key: 'Private', label: 'Private', rate: 'PayrollPrivateHr', cnt: 'PayrollPrivateHrCnt', total: 'PayrollPrivateTotal' },
  { key: 'Team', label: 'Team', rate: 'PayrollTeamHr', cnt: 'PayrollTeamHrCnt', total: 'PayrollTeamTotal' },
  { key: 'School', label: 'School', rate: 'PayrollSchoolHr', cnt: 'PayrollSchoolHrCnt', total: 'PayrollSchoolTotal' },
  { key: 'AquaBaby', label: 'AqBaby', rate: 'PayrollAquaBabyHr', cnt: 'PayrollAquaBabyHrCnt', total: 'PayrollAquaBabyTotal' },
  { key: 'AquaGym', label: 'AqGym', rate: 'PayrollAquaGymHr', cnt: 'PayrollAquaGymHrCnt', total: 'PayrollAquaGymTotal' },
  { key: 'Physio', label: 'Physio', rate: 'PayrollPhysioHr', cnt: 'PayrollPhysioHrCnt', total: 'PayrollPhysioTotal' },
  { key: 'Misc', label: 'Misc', rate: 'PayrollMiscHr', cnt: 'PayrollMiscHrCnt', total: 'PayrollMiscTotal' },
];

// Live SubTotal / Net to Pay from the current (possibly edited) values, the
// same formula the API applies on save (RecomputePayrollNet): salary + bonus
// - (advance + loans + penalty) + all section totals converted to the salary
// currency via PayrollRate; 0 when NoWork. SubTotal = net + advance + loans.
const liveNet = (r: Row, v: (f: string) => number): { net: number; sub: number } => {
  const hrs = DISCIPLINES.reduce((t, d) => t + num(r, d.rate) * v(d.cnt), 0);
  const cur = curOf(r), hc = hrCurOf(r), rate = num(r, 'PayrollRate');
  const f = hc === cur ? 1 : hc === 'USD' && cur === 'LBP' ? rate : hc === 'LBP' && cur === 'USD' && rate ? 1 / rate : 1;
  const loans = v('PayrollLoansShort') + v('PayrollLoansLong');
  const net = r.PayrollIndivNoWork === true ? 0
    : Math.round(v('PayrollSalary') + v('PayrollBonus') - (loans + v('PayrollPenalty')) + hrs * f);
  return { net, sub: net + loans };
};

// label, field, sign(- means it reduces net) for the adjustment columns
const ADJUSTMENTS: [string, string, 1 | -1, string][] = [
  ['Bonus', 'PayrollBonus', 1, 'bonus'],
  ['Penalty', 'PayrollPenalty', -1, 'penalty'],
  ['Advance', 'PayrollLoansShort', -1, 'advance'],
  ['Loans', 'PayrollLoansLong', -1, 'loans'],
];

// Every param P_TimeSheet_Payroll_Update needs when saving a row.
const SAVE_FIELDS = [
  'PayrollSalary', 'PayrollPrivateHr', 'PayrollPrivateHrCnt', 'PayrollTeamHr', 'PayrollTeamHrCnt',
  'PayrollSchoolHr', 'PayrollSchoolHrCnt', 'PayrollAquaBabyHr', 'PayrollAquaBabyHrCnt',
  'PayrollAquaGymHr', 'PayrollAquaGymHrCnt', 'PayrollPhysioHr', 'PayrollPhysioHrCnt',
  'PayrollMiscHr', 'PayrollMiscHrCnt', 'PayrollBonus', 'PayrollLoansShort', 'PayrollLoansLong',
  'PayrollPenalty', 'PayrollNetToPay',
];

// ── Column visibility (per-user, saved in the DB) ───────────────────────────
type Cols = Record<string, boolean>;
const PREF_KEY = 'payroll-sheet-cols';
const OTHER_COLS: [string, string][] = [
  ['salary', 'Salary'], ['totPriv', 'Tot. Priv.'], ['bonus', 'Bonus'], ['penalty', 'Penalty'],
  ['advance', 'Advance'], ['loans', 'Loans'], ['subtotal', 'SubTotal'], ['net', 'Net2Pay'],
  ['paid', 'Paid'], ['nowork', 'NoWork'],
];
const DEFAULT_COLS: Cols = {
  ...Object.fromEntries(DISCIPLINES.map((d) => ['d:' + d.key, true])),
  rate: false, amount: true,
  ...Object.fromEntries(OTHER_COLS.map(([k]) => [k, true])),
  hideZero: false, // hide sections that have no hours in the current view
};
// Every column on (rate + total in each section, all sections, everything else).
const ALL_COLS: Cols = Object.fromEntries(Object.keys(DEFAULT_COLS).map((k) => [k, k !== 'hideZero']));
const normalizeCols = (v: unknown): Cols => {
  const out: Cols = { ...DEFAULT_COLS };
  if (v && typeof v === 'object')
    for (const k of Object.keys(DEFAULT_COLS)) {
      const x = (v as Record<string, unknown>)[k];
      if (typeof x === 'boolean') out[k] = x;
    }
  return out;
};

// Numeric box with the browser's up/down arrows: keeps what the user is typing as
// text and reports the parsed number; an empty box means 0 but stays blank while editing.
function NumBox({ value, onChange, disabled, className, allowNegative = false }: {
  value: number; onChange: (n: number) => void; disabled?: boolean; className?: string; allowNegative?: boolean;
}) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(String(value)); }, [value, focused]);
  return (
    <input type="number" step={1} min={allowNegative ? undefined : 0} disabled={disabled} value={text} className={className}
      onFocus={(e) => { setFocused(true); e.currentTarget.select(); }}
      onBlur={() => { setFocused(false); setText(String(value)); }}
      onChange={(e) => {
        const raw = e.target.value.replace(/[^0-9.-]/g, '');
        setText(raw);
        const n = Number(raw);
        if (raw !== '' && raw !== '-' && !isNaN(n)) onChange(allowNegative ? n : Math.max(0, n));
        else if (raw === '') onChange(0);
      }} />
  );
}

export function PayrollSheetPage() {
  const { timesheetId } = useParams<{ timesheetId: string }>();
  const [rows, setRows] = useState<Row[]>([]);
  const [edits, setEdits] = useState<Record<number, Record<string, number>>>({});
  const [showNoWork, setShowNoWork] = useState(false);
  const [cols, setCols] = useState<Cols>(DEFAULT_COLS);
  const [colsOpen, setColsOpen] = useState(false);
  const colsBtn = useRef<HTMLButtonElement>(null);
  // Click a header to sort: first click ascending, second descending, third back to the proc order.
  const [sort, setSort] = useState<{ k: string; d: 1 | -1 } | null>(null);
  const toggleSort = (k: string) => setSort((cur) => (cur?.k === k ? (cur.d > 0 ? { k, d: -1 } : null) : { k, d: 1 }));
  const colsSaveTimer = useRef<number | null>(null);
  const [loc, setLoc] = useUrlParam('loc', ''); // '' = all locations; kept in the URL so it survives leaving the page
  const [openId, setOpenId] = useState<number | null>(null);
  const [startHist, setStartHist] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function load(refresh = false) {
    setLoading(true);
    setError('');
    const q = new URLSearchParams();
    if (showNoWork) q.set('showNoWork', 'true');
    if (refresh) q.set('refresh', 'true');
    apiRequest<Row[]>(`/api/portal/payroll/sheet/${timesheetId}?${q}`)
      .then((data) => { setRows(data); setEdits({}); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the payroll.'))
      .finally(() => setLoading(false));
  }
  useEffect(() => load(), [timesheetId, showNoWork]); // eslint-disable-line react-hooks/exhaustive-deps

  // Saved column choice for this user (falls back to the defaults silently).
  useEffect(() => {
    apiRequest<{ value: unknown }>(`/api/portal/prefs/${PREF_KEY}`)
      .then((d) => { if (d?.value) setCols(normalizeCols(d.value)); })
      .catch(() => {});
  }, []);
  function updateCols(next: Cols) {
    setCols(next);
    if (colsSaveTimer.current) window.clearTimeout(colsSaveTimer.current);
    colsSaveTimer.current = window.setTimeout(() => {
      apiRequest(`/api/portal/prefs/${PREF_KEY}`, { method: 'PUT', body: JSON.stringify({ value: next }) })
        .catch(() => toast.error('Could not save your column choice.'));
    }, 500);
  }
  const toggleCol = (k: string) => updateCols({ ...cols, [k]: !cols[k] });
  const setDisciplines = (on: boolean) =>
    updateCols({ ...cols, ...Object.fromEntries(DISCIPLINES.map((d) => ['d:' + d.key, on])) });

  // Location filter options built from the loaded sheet.
  const locations = useMemo(() => {
    const seen = new Set<string>();
    for (const r of rows) { const n = str(r, 'LocationNickName'); if (n) seen.add(n); }
    return [...seen].sort();
  }, [rows]);

  const viewRows = useMemo(
    () => (loc ? rows.filter((r) => str(r, 'LocationNickName') === loc) : rows),
    [rows, loc],
  );

  const visibleDisciplines = useMemo(
    () => DISCIPLINES.filter((d) => cols['d:' + d.key] && (!cols.hideZero || viewRows.some((r) => val(r, d.cnt) > 0))),
    [cols, viewRows, edits]); // eslint-disable-line react-hooks/exhaustive-deps
  const subCols = 1 + (cols.rate ? 1 : 0) + (cols.amount ? 1 : 0); // columns per discipline section
  const twoRowHeader = visibleDisciplines.length > 0 && subCols > 1;
  const colCount = 3 + (cols.salary ? 1 : 0) + visibleDisciplines.length * subCols
    + OTHER_COLS.filter(([k]) => k !== 'salary' && cols[k]).length;
  // Fewer columns → bigger numbers. Cells and inputs inherit the table's size.
  const fontCls = colCount <= 10 ? 'text-lg' : colCount <= 14 ? 'text-base' : colCount <= 18 ? 'text-[15px]' : 'text-sm';

  const title = rows.length > 0 ? tsLabel(rows[0]) : `Timesheet #${timesheetId}`;

  function edit(payrollId: number, field: string, value: number) {
    setEdits((prev) => ({ ...prev, [payrollId]: { ...prev[payrollId], [field]: value } }));
    setNotice('');
  }
  function val(r: Row, field: string): number {
    const id = num(r, 'PayrollID');
    return edits[id]?.[field] ?? num(r, field);
  }
  // Live section amount (rate × edited count) and their sum ("Tot. Priv.").
  const amountOf = (r: Row, d: Discipline) => num(r, d.rate) * val(r, d.cnt);
  const totPrivOf = (r: Row) => DISCIPLINES.reduce((s, d) => s + amountOf(r, d), 0);
  const netOf = (r: Row) => liveNet(r, (f) => val(r, f));

  // Sort keys: loc, coach, salary, totPriv, subtotal, net, paid, nowork, an
  // adjustment field name, or rate:<disc> / cnt:<disc> / tot:<disc>.
  const sortValue = (r: Row, k: string): number | string => {
    if (k === 'loc') return str(r, 'LocationNickName');
    if (k === 'coach') return str(r, 'CoachFullName');
    if (k === 'salary') return num(r, 'PayrollSalary');
    if (k === 'totPriv') return totPrivOf(r);
    if (k === 'subtotal') return netOf(r).sub;
    if (k === 'net') return netOf(r).net;
    if (k === 'paid') return r.PayrollIndivPaid === true ? 1 : 0;
    if (k === 'nowork') return r.PayrollIndivNoWork === true ? 1 : 0;
    const [kind, key] = k.split(':');
    const d = DISCIPLINES.find((x) => x.key === key);
    if (d) return kind === 'rate' ? num(r, d.rate) : kind === 'tot' ? amountOf(r, d) : val(r, d.cnt);
    return val(r, k);
  };
  const sortedRows = useMemo(() => {
    if (!sort) return viewRows;
    const { k, d } = sort;
    return [...viewRows].sort((a, b) => {
      const x = sortValue(a, k), y = sortValue(b, k);
      const c = typeof x === 'string' || typeof y === 'string'
        ? String(x).localeCompare(String(y)) : (x as number) - (y as number);
      return c * d;
    });
  }, [viewRows, sort, edits]); // eslint-disable-line react-hooks/exhaustive-deps
  const SortBtn = ({ k, children }: { k: string; children: ReactNode }) => (
    <button type="button" onClick={() => toggleSort(k)} title="Click to sort"
      className={`inline-flex items-center gap-0.5 uppercase hover:text-[#1e5c97] ${sort?.k === k ? 'text-[#1e5c97]' : ''}`}>
      {children}<span className="w-2 text-[9px]">{sort?.k === k ? (sort.d > 0 ? '▲' : '▼') : ''}</span>
    </button>
  );

  async function toggle(r: Row, kind: 'paid' | 'nowork', on: boolean) {
    const id = num(r, 'PayrollID');
    try {
      await apiRequest(`/api/portal/payroll/rows/${id}/${kind}`, {
        method: 'POST',
        body: JSON.stringify(kind === 'paid' ? { paid: on } : { noWork: on }),
      });
      setRows((prev) => prev.map((row) =>
        num(row, 'PayrollID') === id
          ? { ...row, [kind === 'paid' ? 'PayrollIndivPaid' : 'PayrollIndivNoWork']: on }
          : row));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update the row.');
    }
  }

  // Persist one row from its pending edits (used by both the card and Save Changes).
  async function saveRow(id: number) {
    const row = rows.find((r) => num(r, 'PayrollID') === id);
    if (!row) return;
    const fields = edits[id] ?? {};
    const body: Record<string, number> = {};
    for (const p of SAVE_FIELDS) body[p] = fields[p] ?? num(row, p);
    await apiRequest(`/api/portal/payroll/rows/${id}`, { method: 'PUT', body: JSON.stringify(body) });
  }

  async function saveAll() {
    const dirty = Object.keys(edits).map(Number);
    if (dirty.length === 0) { setNotice('Nothing to save.'); return; }
    setBusy(true);
    setError('');
    try {
      for (const id of dirty) await saveRow(id);
      setNotice(`${dirty.length} row(s) saved.`);
      toast.success('Payroll saved.');
      load(); // plain reload: "Re-Calculate from HR" would reset the counts just saved
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Could not save the changes.';
      setError(m); toast.error(m);
    } finally {
      setBusy(false);
    }
  }

  // Per-column totals, split by currency (only nonzero currencies render).
  const sumCur = (pick: (r: Row) => number, cur: (r: Row) => Cur = curOf) => {
    const o: Record<Cur, number> = { USD: 0, LBP: 0 };
    for (const r of viewRows) o[cur(r)] += pick(r);
    return o;
  };
  const totals = useMemo(() => {
    const net = sumCur((r) => netOf(r).net);
    const paid: Record<Cur, number> = { USD: 0, LBP: 0 };
    for (const r of viewRows) if (r.PayrollIndivPaid === true) paid[curOf(r)] += netOf(r).net;
    return {
      salary: sumCur((r) => num(r, 'PayrollSalary')),
      cnt: Object.fromEntries(DISCIPLINES.map((d) => [d.key, viewRows.reduce((s, r) => s + val(r, d.cnt), 0)])),
      disc: Object.fromEntries(DISCIPLINES.map((d) => [d.key, sumCur((r) => amountOf(r, d), hrCurOf)])),
      totPriv: sumCur(totPrivOf, hrCurOf),
      bonus: sumCur((r) => num(r, 'PayrollBonus')),
      penalty: sumCur((r) => num(r, 'PayrollPenalty')),
      advance: sumCur((r) => num(r, 'PayrollLoansShort')),
      loans: sumCur((r) => num(r, 'PayrollLoansLong')),
      subtotal: sumCur((r) => netOf(r).sub),
      net,
      paid,
      balance: { USD: net.USD - paid.USD, LBP: net.LBP - paid.LBP } as Record<Cur, number>,
    };
  }, [viewRows, edits]); // eslint-disable-line react-hooks/exhaustive-deps

  const user = getStoredUser();
  const canEdit = user?.userType?.toLowerCase() !== 'guest' && user?.canSave !== false;
  const canExport = user?.canExport;
  const dirtyCount = Object.keys(edits).length;

  function exportCsv() {
    const cols: [string, (r: Row) => string][] = [
      ['Location', (r) => str(r, 'LocationNickName')],
      ['Coach', (r) => str(r, 'CoachFullName')],
      ['Currency', (r) => curOf(r)],
      ['Salary', (r) => String(num(r, 'PayrollSalary'))],
      ['Hourly Currency', (r) => hrCurOf(r)],
      ...DISCIPLINES.flatMap((d) => [
        [`${d.label} Rate`, (r: Row) => String(num(r, d.rate))],
        [`${d.label} Cnt`, (r: Row) => String(num(r, d.cnt))],
        [`${d.label} Total`, (r: Row) => String(num(r, d.total))],
      ] as [string, (r: Row) => string][]),
      ['Tot. Priv.', (r) => String(num(r, 'TotalPrivate'))],
      ['Bonus', (r) => String(num(r, 'PayrollBonus'))],
      ['Penalty', (r) => String(num(r, 'PayrollPenalty'))],
      ['Advance', (r) => String(num(r, 'PayrollLoansShort'))],
      ['Loans', (r) => String(num(r, 'PayrollLoansLong'))],
      ['SubTotal', (r) => String(num(r, 'SubTotal'))],
      ['Net2Pay', (r) => String(num(r, 'PayrollNetToPay'))],
      ['Paid', (r) => (r.PayrollIndivPaid === true ? 'Yes' : 'No')],
      ['NoWork', (r) => (r.PayrollIndivNoWork === true ? 'Yes' : 'No')],
    ];
    const header = cols.map((c) => c[0]).join(',');
    const lines = viewRows.map((r) => cols.map((c) => `"${c[1](r).replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `payroll-${timesheetId}${loc ? '-' + loc : ''}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ── shared cell styles ──────────────────────────────────────────────────
  const numInput =
    'w-[4.6em] rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[length:inherit] text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-[#1e5c97]/40 disabled:bg-slate-50';
  const th = 'px-1.5 py-2 font-semibold';
  const subTh = 'px-1.5 pb-1.5 text-[10px] font-semibold text-slate-400 normal-case tracking-normal';
  const CurStack = ({ v, cls = '' }: { v: Record<Cur, number>; cls?: string }) => (
    <div className={`leading-tight tabular-nums ${cls}`}>
      {v.USD ? <div>{money(v.USD)}</div> : null}
      {v.LBP ? <div>{money(v.LBP)}</div> : null}
      {!v.USD && !v.LBP ? <span className="text-slate-300">0</span> : null}
    </div>
  );
  const CheckRow = ({ k, label }: { k: string; label: string }) => (
    <label className="flex items-center gap-2 rounded px-1.5 py-1 text-sm text-slate-700 hover:bg-slate-50 select-none cursor-pointer">
      <input type="checkbox" checked={!!cols[k]} onChange={() => toggleCol(k)} className="accent-[#1e5c97]" />
      {label}
    </label>
  );

  const openRow = openId != null ? rows.find((r) => num(r, 'PayrollID') === openId) : undefined;

  return (
    <div className="p-6 md:p-8">
      <SmartBack label="Timesheets" fallback="/payroll/timesheets" />
      <PageHero title={`Payroll: ${title}`} subtitle={`${viewRows.length} coach(es)${loc ? ` · ${loc}` : ''}`} slide={2} />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <span className="font-semibold text-slate-500">Location</span>
          <select value={loc} onChange={(e) => setLoc(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#1e5c97]/40">
            <option value="">All locations</option>
            {locations.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-sm text-slate-600 select-none">
          <input type="checkbox" checked={showNoWork} onChange={(e) => setShowNoWork(e.target.checked)} className="accent-[#1e5c97]" />
          Show "No Work"
        </label>

        {/* Column picker */}
        <div className="relative">
          <button ref={colsBtn} onClick={() => setColsOpen((o) => !o)}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold ${colsOpen ? 'border-[#1e5c97] bg-[#e8f0f8] text-[#1e5c97]' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
            <Columns3 className="size-4" /> Columns
          </button>
          {colsOpen && (
            <PickerPanel anchor={colsBtn} align="left" width={520} title="Columns to show" onClose={() => setColsOpen(false)}
              footer={<>
                <button onClick={() => updateCols({ ...ALL_COLS, hideZero: cols.hideZero })}
                  className="text-[11px] font-semibold text-[#1e5c97] hover:underline">Show all columns</button>
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 select-none cursor-pointer">
                  <input type="checkbox" checked={!!cols.hideZero} onChange={() => toggleCol('hideZero')} className="accent-[#1e5c97]" />
                  Hide sections with no hours
                </label>
                <button onClick={() => updateCols({ ...DEFAULT_COLS })}
                  className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-[#1e5c97]">
                  <RotateCcw className="size-3" /> Reset to default
                </button>
              </>}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Sections</p>
                      <span className="text-[11px] text-slate-400">
                        <button className="hover:text-[#1e5c97]" onClick={() => setDisciplines(true)}>all</button>
                        {' · '}
                        <button className="hover:text-[#1e5c97]" onClick={() => setDisciplines(false)}>none</button>
                      </span>
                    </div>
                    {DISCIPLINES.map((d) => <CheckRow key={d.key} k={'d:' + d.key} label={d.label} />)}
                  </div>
                  <div>
                    <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">In each section</p>
                    <CheckRow k="rate" label="Rate (per hour)" />
                    <label className="flex items-center gap-2 rounded px-1.5 py-1 text-sm text-slate-400 select-none">
                      <input type="checkbox" checked disabled className="accent-[#1e5c97]" /> Cnt (hours)
                    </label>
                    <CheckRow k="amount" label="Total (rate × cnt)" />
                  </div>
                  <div>
                    <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">Other columns</p>
                    {OTHER_COLS.map(([k, l]) => <CheckRow key={k} k={k} label={l} />)}
                  </div>
                </div>
            </PickerPanel>
          )}
        </div>

        <div className="flex-1" />
        {canExport && viewRows.length > 0 && (
          <button onClick={exportCsv}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white text-[#1e5c97] text-sm font-semibold px-4 py-1.5 hover:bg-slate-50">
            <Download className="size-4" /> Export
          </button>
        )}
        <button disabled={busy || loading} title="Reloads salary, rates and bonus/penalty add-ons from the coach profiles for unpaid rows (hours are never changed)"
          onClick={() => {
            const msg = 'Re-calculate from HR?\n\nFor every UNPAID coach this reloads the salary, hourly rates and bonus/penalty add-ons '
              + 'from the coach profiles. Hours are never changed by this. Unsaved edits on this page will be lost.';
            if (window.confirm(msg)) load(true);
          }}
          className="flex items-center gap-1.5 rounded-lg border border-[#1e5c97]/30 text-[#1e5c97] text-sm font-semibold px-4 py-1.5 hover:bg-[#e8f0f8] disabled:opacity-50">
          <RefreshCw className="size-4" /> Re-Calculate from HR
        </button>
        {canEdit && (
          <button onClick={saveAll} disabled={busy || dirtyCount === 0}
            className="flex items-center gap-1.5 rounded-lg bg-[#1e5c97] hover:bg-[#17497a] text-white text-sm font-semibold px-5 py-1.5 disabled:opacity-50">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Save Changes {dirtyCount > 0 && `(${dirtyCount})`}
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl p-3 mb-4">
          <AlertCircle className="size-4 text-red-500 shrink-0" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}
      {notice && <p className="text-sm text-emerald-700 mb-3">{notice}</p>}
      <p className="text-xs text-slate-400 mb-3">Tip: click a coach's name to open their payroll card and edit it. Each section = Rate × Cnt = Total.</p>

      {loading ? (
        <div className="flex items-center justify-center h-40"><Loader2 className="size-8 text-[#1e5c97] animate-spin" /></div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-soft overflow-x-auto">
          <table className={`w-full whitespace-nowrap border-collapse ${fontCls}`}>
            <thead className="text-xs uppercase tracking-wide text-slate-500 bg-slate-50">
              <tr className={twoRowHeader ? '' : 'border-b-2 border-slate-200'}>
                <th rowSpan={twoRowHeader ? 2 : 1} className={`${th} text-center`}></th>
                <th rowSpan={twoRowHeader ? 2 : 1} className={`${th} px-2 text-left`}><SortBtn k="loc">Loc</SortBtn></th>
                <th rowSpan={twoRowHeader ? 2 : 1} className={`${th} px-2 text-left`}><SortBtn k="coach">Coach</SortBtn></th>
                {cols.salary && <th rowSpan={twoRowHeader ? 2 : 1} className={`${th} px-2 text-right`}><SortBtn k="salary">Salary</SortBtn></th>}
                {visibleDisciplines.map((d) => (
                  <th key={d.key} colSpan={subCols} className={`${th} text-center border-l border-slate-200 ${twoRowHeader ? 'pb-0' : ''}`}>{twoRowHeader ? d.label : <SortBtn k={'cnt:' + d.key}>{d.label}</SortBtn>}</th>
                ))}
                {cols.totPriv && <th rowSpan={twoRowHeader ? 2 : 1} className={`${th} px-2 text-right border-l border-slate-200`}><SortBtn k="totPriv">Tot. Priv.</SortBtn></th>}
                {ADJUSTMENTS.filter(([, , , k]) => cols[k]).map(([label, f], i) => (
                  <th key={f} rowSpan={twoRowHeader ? 2 : 1} className={`${th} text-right ${i === 0 ? 'border-l border-slate-200' : ''}`}><SortBtn k={f}>{label}</SortBtn></th>
                ))}
                {cols.subtotal && <th rowSpan={twoRowHeader ? 2 : 1} className={`${th} px-2 text-right border-l border-slate-200`}><SortBtn k="subtotal">SubTotal</SortBtn></th>}
                {cols.net && <th rowSpan={twoRowHeader ? 2 : 1} className={`${th} px-2 text-right`}><SortBtn k="net">Net2Pay</SortBtn></th>}
                {cols.paid && <th rowSpan={twoRowHeader ? 2 : 1} className={`${th} text-center`}><SortBtn k="paid">Paid</SortBtn></th>}
                {cols.nowork && <th rowSpan={twoRowHeader ? 2 : 1} className={`${th} text-center`}><SortBtn k="nowork">NoWork</SortBtn></th>}
              </tr>
              {twoRowHeader && (
                <tr className="border-b-2 border-slate-200">
                  {visibleDisciplines.map((d) => (
                    <Fragment key={d.key}>
                      {cols.rate && <th className={`${subTh} text-right border-l border-slate-200`}><SortBtn k={'rate:' + d.key}>Rate</SortBtn></th>}
                      <th className={`${subTh} text-center ${!cols.rate ? 'border-l border-slate-200' : ''}`}><SortBtn k={'cnt:' + d.key}>Cnt</SortBtn></th>
                      {cols.amount && <th className={`${subTh} text-right`}><SortBtn k={'tot:' + d.key}>Total</SortBtn></th>}
                    </Fragment>
                  ))}
                </tr>
              )}
            </thead>
            <tbody>
              {sortedRows.map((r) => {
                const id = num(r, 'PayrollID');
                const paid = r.PayrollIndivPaid === true;
                const noWork = r.PayrollIndivNoWork === true;
                const cur = curOf(r);
                return (
                  <tr key={id} className={`border-b border-slate-100 ${noWork ? 'bg-rose-50/60' : paid ? 'bg-emerald-50/50' : 'hover:bg-slate-50/60'}`}>
                    <td className="px-1.5 py-1">
                      <div className="flex items-center justify-center gap-0.5">
                        <button title="Edit this payroll" onClick={() => { setStartHist(false); setOpenId(id); }}
                          className="rounded-md p-1 text-[#1e5c97] hover:bg-[#e8f0f8]"><SquarePen className="size-4" /></button>
                        <button title="Payroll history" onClick={() => { setStartHist(true); setOpenId(id); }}
                          className="rounded-md p-1 text-slate-500 hover:bg-slate-100"><History className="size-4" /></button>
                        <Link title="Coach file & HR rate" to={`/coaches/${num(r, 'CoachID')}`}
                          className="rounded-md p-1 text-slate-500 hover:bg-slate-100"><UserCog className="size-4" /></Link>
                      </div>
                    </td>
                    <td className="px-2 py-1 text-slate-500">{str(r, 'LocationIcon') || str(r, 'LocationNickName')}</td>
                    <td className="px-2 py-1">
                      <Link to={`/coaches/${num(r, 'CoachID')}`} title={str(r, 'CoachFullName')}
                        className="font-semibold text-[#1e5c97] hover:underline">{str(r, 'CoachFullName')}</Link>
                    </td>
                    {cols.salary && (
                      <td className="px-2 py-1 text-right tabular-nums font-medium bg-emerald-50/40">{money(num(r, 'PayrollSalary'))}</td>
                    )}
                    {visibleDisciplines.map((d) => (
                      <Fragment key={d.key}>
                        {cols.rate && (
                          <td className="px-1.5 py-1 text-right tabular-nums text-[0.85em] text-slate-500 border-l border-slate-100 bg-sky-50/40" title="Hourly rate (from HR)">
                            {money(num(r, d.rate))}
                          </td>
                        )}
                        <td className={`px-1.5 py-1 bg-sky-50/40 ${!cols.rate ? 'border-l border-slate-100' : ''}`}>
                          <NumBox disabled={!canEdit} value={val(r, d.cnt)} onChange={(n) => edit(id, d.cnt, n)}
                            className="w-[4em] rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[length:inherit] text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-[#1e5c97]/40 disabled:bg-slate-50" />
                        </td>
                        {cols.amount && (
                          <td className="px-1.5 py-1 text-right tabular-nums text-[0.9em] font-semibold text-slate-600 bg-sky-50/40">
                            {money(amountOf(r, d))}
                          </td>
                        )}
                      </Fragment>
                    ))}
                    {cols.totPriv && (
                      <td className="px-2 py-1 text-right tabular-nums font-semibold text-slate-700 bg-sky-100/40 border-l border-slate-100" title="Sum of all sections">
                        {money(totPrivOf(r))}
                      </td>
                    )}
                    {ADJUSTMENTS.filter(([, , , k]) => cols[k]).map(([, f, sign], i) => (
                      <td key={f} className={`px-1.5 py-1 text-right ${i === 0 ? 'border-l border-slate-100' : ''} ${sign < 0 ? 'bg-rose-50/50' : 'bg-emerald-50/40'}`}>
                        <NumBox disabled={!canEdit} value={val(r, f)} onChange={(n) => edit(id, f, n)} allowNegative
                          className={`${numInput} ${sign < 0 ? 'text-rose-700' : 'text-emerald-700'}`} />
                      </td>
                    ))}
                    {cols.subtotal && (
                      <td className="px-2 py-1 text-right tabular-nums font-semibold bg-slate-50 border-l border-slate-100">{money(netOf(r).sub)}</td>
                    )}
                    {cols.net && (
                      <td className="px-2 py-1 text-right tabular-nums font-extrabold bg-amber-50/70">{sym(cur)} {money(netOf(r).net)}</td>
                    )}
                    {cols.paid && (
                      <td className="px-1.5 py-1 text-center">
                        <input type="checkbox" checked={paid} disabled={!canEdit} onChange={(e) => toggle(r, 'paid', e.target.checked)} className="size-4 accent-emerald-600" />
                      </td>
                    )}
                    {cols.nowork && (
                      <td className="px-1.5 py-1 text-center">
                        <input type="checkbox" checked={noWork} disabled={!canEdit} onChange={(e) => toggle(r, 'nowork', e.target.checked)} className="size-4 accent-rose-500" />
                      </td>
                    )}
                  </tr>
                );
              })}
              {viewRows.length === 0 && (
                <tr><td colSpan={colCount} className="px-4 py-10 text-center text-slate-400">No payroll rows.</td></tr>
              )}
            </tbody>
            {viewRows.length > 0 && (
              <tfoot>
                <tr className="text-sm bg-slate-100 border-t-2 border-slate-300">
                  <td />
                  <td className="px-2 py-2 font-bold text-slate-600" colSpan={2}>Totals</td>
                  {cols.salary && <td className="px-2 py-2 text-right font-bold"><CurStack v={totals.salary} /></td>}
                  {visibleDisciplines.map((d) => (
                    <Fragment key={d.key}>
                      {cols.rate && <td className="border-l border-slate-200" />}
                      <td className={`px-1.5 py-2 text-right text-xs font-semibold text-slate-500 tabular-nums ${!cols.rate ? 'border-l border-slate-200' : ''}`}>
                        {money(totals.cnt[d.key])}
                      </td>
                      {cols.amount && (
                        <td className="px-1.5 py-2 text-right font-semibold text-slate-600"><CurStack v={totals.disc[d.key]} /></td>
                      )}
                    </Fragment>
                  ))}
                  {cols.totPriv && <td className="px-2 py-2 text-right font-bold text-slate-700 border-l border-slate-200"><CurStack v={totals.totPriv} /></td>}
                  {cols.bonus && <td className="px-1.5 py-2 text-right font-semibold text-emerald-700 border-l border-slate-200"><CurStack v={totals.bonus} /></td>}
                  {cols.penalty && <td className={`px-1.5 py-2 text-right font-semibold text-rose-700 ${!cols.bonus ? 'border-l border-slate-200' : ''}`}><CurStack v={totals.penalty} /></td>}
                  {cols.advance && <td className={`px-1.5 py-2 text-right font-semibold text-rose-700 ${!cols.bonus && !cols.penalty ? 'border-l border-slate-200' : ''}`}><CurStack v={totals.advance} /></td>}
                  {cols.loans && <td className={`px-1.5 py-2 text-right font-semibold text-rose-700 ${!cols.bonus && !cols.penalty && !cols.advance ? 'border-l border-slate-200' : ''}`}><CurStack v={totals.loans} /></td>}
                  {cols.subtotal && <td className="px-2 py-2 text-right font-bold border-l border-slate-200"><CurStack v={totals.subtotal} /></td>}
                  {cols.net && (
                    <td className="px-2 py-2 text-right font-bold">
                      <CurStack v={totals.net} />
                      <div className="mt-1 border-t border-slate-300 pt-1 text-[11px] font-semibold">
                        <div className="text-emerald-700">Paid {money(totals.paid.USD + totals.paid.LBP)}</div>
                        <div className="text-rose-600">Bal {money(totals.balance.USD + totals.balance.LBP)}</div>
                      </div>
                    </td>
                  )}
                  {cols.paid && <td />}
                  {cols.nowork && <td />}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {openRow && (
        <CoachCard
          row={openRow}
          canEdit={canEdit}
          startWithHistory={startHist}
          currentTimesheetId={Number(timesheetId)}
          onReloadCurrent={() => load()}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

// ── Per-coach payroll card (modal): review + edit one coach cleanly ──────────
// Self-contained: keeps its own active row + edits so the payroll-history list
// can switch to any month in the SAME popup and still edit + save it.
function CoachCard({
  row, canEdit, startWithHistory, currentTimesheetId, onReloadCurrent, onClose,
}: {
  row: Row; canEdit: boolean;
  startWithHistory?: boolean; currentTimesheetId?: number;
  onReloadCurrent?: () => void; onClose: () => void;
}) {
  const coachId = num(row, 'CoachID');
  const [active, setActive] = useState<Row>(row);
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [showHist, setShowHist] = useState(!!startWithHistory);
  const [hist, setHist] = useState<Row[] | null>(null);
  const [histLoading, setHistLoading] = useState(false);

  // Reset when a different coach/payroll is opened from the grid.
  useEffect(() => { setActive(row); setEdits({}); setShowHist(!!startWithHistory); },
    [num(row, 'PayrollID')]); // eslint-disable-line react-hooks/exhaustive-deps

  function loadHistory() {
    if (!coachId) return;
    setHistLoading(true);
    apiRequest<Row[]>(`/api/portal/payroll/coach-history/${coachId}`)
      .then((d) => setHist(Array.isArray(d) ? d : []))
      .catch(() => setHist([]))
      .finally(() => setHistLoading(false));
  }
  useEffect(() => { if (showHist && !hist && !histLoading) loadHistory(); }, [showHist]); // eslint-disable-line react-hooks/exhaustive-deps

  const id = num(active, 'PayrollID');
  const activeTs = tsIdOf(active);
  const cur = curOf(active);
  const hrCur = hrCurOf(active);
  const paid = active.PayrollIndivPaid === true;
  const noWork = active.PayrollIndivNoWork === true;
  const monthLabel = tsLabel(active) || (activeTs ? `#${activeTs}` : 'Payroll');

  const v = (f: string) => edits[f] ?? num(active, f);
  const setF = (f: string, val: number) => setEdits((e) => ({ ...e, [f]: val }));
  const amountOf = (d: Discipline) => num(active, d.rate) * v(d.cnt);
  const totPriv = DISCIPLINES.reduce((s, d) => s + amountOf(d), 0);
  const live = liveNet(active, v);

  // Pull fresh (recalculated) figures for the coach and re-point active at this row.
  async function refreshActive() {
    try {
      const d = await apiRequest<Row[]>(`/api/portal/payroll/coach-history/${coachId}`);
      const list = Array.isArray(d) ? d : [];
      setHist(list);
      const fresh = list.find((h) => num(h, 'PayrollID') === id);
      if (fresh) setActive(fresh);
    } catch { /* ignore */ }
  }

  // Save the pending edits; with recalc=true also pull this coach's salary,
  // currencies and hourly rates from the coach profile (hours are untouched).
  async function saveActive(recalc = false) {
    setSaving(true);
    try {
      const body: Record<string, number> = {};
      for (const p of SAVE_FIELDS) body[p] = edits[p] ?? num(active, p);
      await apiRequest(`/api/portal/payroll/rows/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      if (recalc) await apiRequest(`/api/portal/payroll/rows/${id}/refresh-hr`, { method: 'POST' });
      toast.success(recalc ? 'Saved and recalculated from HR.' : 'Payroll saved.');
      setEdits({});
      await refreshActive();
      if (activeTs === currentTimesheetId) onReloadCurrent?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save.');
    } finally { setSaving(false); }
  }

  async function toggleActive(kind: 'paid' | 'nowork', on: boolean) {
    try {
      await apiRequest(`/api/portal/payroll/rows/${id}/${kind}`, {
        method: 'POST', body: JSON.stringify(kind === 'paid' ? { paid: on } : { noWork: on }),
      });
      setActive((a) => ({ ...a, [kind === 'paid' ? 'PayrollIndivPaid' : 'PayrollIndivNoWork']: on }));
      if (activeTs === currentTimesheetId) onReloadCurrent?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update.');
    }
  }

  function pickHistory(h: Row) { setActive(h); setEdits({}); setShowHist(false); }

  const box = 'w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-right text-[13px] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#1e5c97]/40 disabled:bg-slate-50';
  const label = 'text-[10px] font-semibold uppercase tracking-wide text-slate-400';
  const linkBtn = 'flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold';

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* header row 1: name + actions; row 2: payroll title + salary */}
        <div className="border-b border-slate-100 px-4 py-2.5 space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-800 leading-tight truncate">{str(active, 'CoachFullName')}</h2>
            <div className="ml-auto flex items-center gap-1.5 shrink-0">
              <Link to={`/coaches/${coachId}`} onClick={onClose} title="Edit coach file & HR rate"
                className={`${linkBtn} border-slate-200 text-[#1e5c97] hover:bg-[#e8f0f8]`}>
                <UserCog className="size-3.5" /> Edit coach file &amp; HR rate
              </Link>
              <button onClick={() => setShowHist((s) => !s)} title="All payrolls of this coach"
                className={`${linkBtn} ${showHist ? 'border-[#1e5c97] bg-[#e8f0f8] text-[#1e5c97]' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                <History className="size-3.5" /> All payrolls
              </button>
              <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X className="size-4" /></button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-[#e8f0f8] px-2 py-0.5 text-[11px] font-bold text-[#1e5c97]">
              <History className="size-3" /> Payroll {monthLabel}
            </span>
            <span className="text-xs text-slate-500">{str(active, 'LocationNickName')} · {cur}{hrCur !== cur ? ` / hours ${hrCur}` : ''}</span>
            <label className={`${label} ml-auto shrink-0`}>Salary ({sym(cur)})</label>
            <div className="w-28 shrink-0">
              <NumBox disabled={!canEdit} value={v('PayrollSalary')} onChange={(n) => setF('PayrollSalary', n)} className={box + ' font-semibold'} />
            </div>
          </div>
        </div>

        {/* history panel */}
        {showHist && (
          <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-2">
            <p className={label + ' mb-2'}>Payroll history</p>
            {histLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="size-4 animate-spin" /> Loading…</div>
            ) : !hist || hist.length === 0 ? (
              <p className="text-sm text-slate-400">No past payrolls found.</p>
            ) : (
              <div className="divide-y divide-slate-100 rounded-lg border border-slate-100 bg-white">
                {[...hist].sort((a, b) => tsTime(b) - tsTime(a)).map((h) => {
                  const hts = tsIdOf(h);
                  const hcur = curOf(h);
                  const isActive = num(h, 'PayrollID') === id;
                  return (
                    <button key={num(h, 'PayrollID')} onClick={() => pickHistory(h)}
                      className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50 ${isActive ? 'bg-[#e8f0f8]' : ''}`}>
                      <span className="flex items-center gap-2 font-medium text-slate-700">
                        {tsLabel(h) || `#${hts}`}
                        {isActive && <span className="rounded bg-[#1e5c97] px-1.5 py-0.5 text-[10px] font-bold text-white">viewing</span>}
                        {hts === currentTimesheetId && !isActive && <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">current</span>}
                      </span>
                      <span className="flex items-center gap-3 tabular-nums">
                        <span className={h.PayrollIndivPaid === true ? 'text-emerald-600' : 'text-rose-500'}>
                          {h.PayrollIndivPaid === true ? 'Paid' : 'Unpaid'}
                        </span>
                        <span className="font-bold text-slate-800">{sym(hcur)} {money(num(h, 'PayrollNetToPay'))}</span>
                        <ChevronRight className="size-4 text-slate-300" />
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            <p className="mt-2 text-[11px] text-slate-400">Click a month to open that payroll here.</p>
          </div>
        )}

        <div className="px-4 py-3 space-y-2.5">
          {/* adjustments on one row */}
          <div className="grid grid-cols-4 gap-2">
            {ADJUSTMENTS.map(([al, f, sign]) => (
              <div key={f}>
                <label className={label}>{al}{sign < 0 ? ' −' : ' +'}</label>
                <NumBox disabled={!canEdit} value={v(f)} onChange={(n) => setF(f, n)} allowNegative
                  className={`${box} mt-0.5 ${sign < 0 ? 'text-rose-700' : 'text-emerald-700'}`} />
              </div>
            ))}
          </div>

          {/* disciplines: Rate × Cnt = Total */}
          <div className="rounded-lg border border-slate-100">
            <div className="grid grid-cols-12 items-center gap-2 border-b border-slate-100 bg-slate-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
              <span className="col-span-4">Hours</span>
              <span className="col-span-2 text-right">Rate/hr</span>
              <span className="col-span-3 text-right">Cnt</span>
              <span className="col-span-3 text-right">Total</span>
            </div>
            <div className="divide-y divide-slate-100">
              {DISCIPLINES.map((d) => (
                <div key={d.key} className="grid grid-cols-12 items-center gap-2 px-2.5 py-px odd:bg-slate-50/60">
                  <span className="col-span-4 text-[13px] font-medium text-slate-700">{d.label}</span>
                  <span className="col-span-2 text-right text-xs text-slate-400 tabular-nums" title="Hourly rate (from HR)">{sym(hrCur)} {money(num(active, d.rate))}</span>
                  <div className="col-span-3">
                    <NumBox disabled={!canEdit} value={v(d.cnt)} onChange={(n) => setF(d.cnt, n)}
                      className="w-full rounded-md border border-sky-200 bg-sky-50/50 px-1.5 py-0.5 text-right text-[13px] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#1e5c97]/40 disabled:bg-slate-50" />
                  </div>
                  <span className="col-span-3 text-right text-[13px] font-semibold text-slate-600 tabular-nums">{sym(hrCur)} {money(amountOf(d))}</span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-12 items-center gap-2 border-t border-slate-100 bg-sky-50/60 px-2.5 py-1">
              <span className="col-span-9 text-right text-[10px] font-bold uppercase tracking-wide text-slate-400">Tot. Priv.</span>
              <span className="col-span-3 text-right text-[13px] font-bold text-slate-700 tabular-nums">{sym(hrCur)} {money(totPriv)}</span>
            </div>
          </div>

          {/* totals + toggles on one strip */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-lg bg-[#e8f0f8] px-3 py-1.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600 select-none">
              <input type="checkbox" checked={paid} disabled={!canEdit} onChange={(e) => toggleActive('paid', e.target.checked)} className="size-3.5 accent-emerald-600" />
              Paid
            </label>
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600 select-none">
              <input type="checkbox" checked={noWork} disabled={!canEdit} onChange={(e) => toggleActive('nowork', e.target.checked)} className="size-3.5 accent-rose-500" />
              No Work
            </label>
            <span className="ml-auto text-xs text-slate-500">SubTotal <b className="text-sm text-slate-700 tabular-nums">{sym(cur)} {money(live.sub)}</b></span>
            <span className="text-xs text-slate-500">Net to Pay <b className="text-lg font-extrabold text-[#1e5c97] tabular-nums">{sym(cur)} {money(live.net)}</b></span>
          </div>
        </div>

        {/* footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-4 py-2">
          <p className="mr-auto text-[11px] text-slate-400">Hours are kept; salary &amp; rates refresh from the coach profile on save.</p>
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">Close</button>
          {canEdit && (
            <button onClick={() => saveActive(!paid)} disabled={saving}
              title={paid ? 'Saves this payroll (already paid, so rates are not refreshed).' : "Saves, then reloads this coach's salary, currencies and hourly rates from the coach profile. Hours are not changed."}
              className="flex items-center gap-1.5 rounded-lg bg-[#1e5c97] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#17497a] disabled:opacity-50">
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} {paid ? 'Save' : 'Save & Recalc from HR'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

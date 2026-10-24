import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Search, Loader2, AlertCircle, ChevronLeft, ChevronRight,
  ArrowUpDown, ArrowUp, ArrowDown, Download, Plus, Pencil,
} from 'lucide-react';
import { apiRequest, getStoredUser } from '../api/portalApi';
import { DateInput } from './DateInput';
import { fmtDate } from '../lib/dates';
import { useAccess } from './AccessProvider';
import { PageHero } from './PageHero';
import { ColumnPicker, type PickerSection } from './ColumnPicker';
import { useColumnPrefs, columnPrefKey } from '../lib/columnPrefs';

import { useStickySort } from '../lib/stickySort';
// Generic, config-driven list page: filter bar → portal API endpoint that
// returns name-keyed proc rows → sortable, paginated grid with CSV export.

export type Row = Record<string, unknown>;

export interface ColumnDef {
  key: string;               // column name as returned by the proc
  label: string;
  format?: 'date' | 'money' | 'bool' | 'text';
  extra?: boolean;           // only visible with "More columns"
  total?: boolean;           // sum this column into a footer totals row
  /** Key of a ModuleConfig.columnGroups entry: the column is hidden until that
   *  group's checkbox is ticked (a second, named "More columns" set). */
  group?: string;
  /** Sum this column per distinct value of another column, e.g.
   *  totalBy: 'PackageCurrency' renders "LBP 1,200 / USD 300" in the footer. */
  totalBy?: string;
  /** Only these user types (lower-case) see this column's total. */
  totalRoles?: string[];
  /** With totalBy: sum only the rows of this group value (e.g. 'USD') and
   *  show it as one figure, "$79,090" (no LBP line). */
  totalOnly?: string;
  /** Hide the column for the current filters / user type, e.g. the legacy
   *  Due report hiding Phone/Total/Paid/OnHold outside the user's location. */
  hiddenWhen?: (values: FilterValues, role: string) => boolean;
}

export type FilterValues = Record<string, string | number | boolean>;

export interface FilterOption { value: string | number; label: string }

export interface FilterDef {
  param: string;             // query-string parameter name
  label: string;
  /** multiselect = checkbox dropdown with Check all; value is a "1,3" comma list. */
  type: 'text' | 'select' | 'checkbox' | 'date' | 'multiselect';
  options?: FilterOption[];  // static options
  optionsKey?: string;       // key into the lookups map
  initial?: string | number | boolean;
  width?: string;
  /** Only these user types (lower-case) see (and send) this filter. */
  roles?: string[];
  /** false = shown and drives the cascade, but never sent to the API. Needed
   *  where the endpoint has no such parameter (registrations, sessions): there
   *  location scopes the semester list, and the semester scopes the rows. */
  submit?: boolean;
  /** When true, changing this filter reloads the grid immediately — no Search
   *  click needed (e.g. the Location select on the payroll pages). */
  autoSubmit?: boolean;
  /** User types (case-insensitive) for which the filter is shown but locked to
   *  its initial value, e.g. ['user'] for the legacy ddlLocations.Enabled=false. */
  lockedFor?: string[];
  /** Shown but not editable for the current filters / user type (keeps its
   *  value), e.g. the Due report's "Only Due" outside the user's location. */
  disabledWhen?: (values: FilterValues, role: string) => boolean;
  /** Side effects of a user change on other filters (legacy postback rules),
   *  e.g. picking semesters moves "From" to the first semester's month.
   *  `semesterRows` are the cascade's raw semester rows. */
  derive?: (next: FilterValues, ctx: { semesterRows: Row[]; role: string }) => FilterValues;
  /** Dependent option list (legacy cascaded dropdowns, e.g. the coaches of the
   *  chosen location): `url` is re-evaluated from the current filter values and
   *  a changed URL refetches; `pick` maps the response (default FilterOption[]).
   *  A value the refreshed list no longer offers falls back to "all". */
  optionsFrom?: { url: (values: FilterValues) => string | null; pick?: (res: unknown) => FilterOption[] };
  /** With optionsFrom: an empty value takes the list's first option (legacy
   *  DropDownList DataBind selecting its first item, no "Not Selected" row). */
  firstByDefault?: boolean;
}

export interface ModuleConfig {
  title: string;
  subtitle?: string;
  endpoint: string;          // e.g. /api/portal/modules/registrations
  filters: FilterDef[];
  columns: ColumnDef[];
  idKey?: string;            // row key column
  lookups?: string;          // endpoint returning Record<string, FilterOption[]>
  renderCell?: (row: Row, col: ColumnDef, reload?: () => void) => React.ReactNode | undefined;
  /** Optional per-row CSS classes (e.g. tint a row by status). */
  rowClass?: (row: Row) => string;
  /** Summary shown next to the row count, computed over ALL loaded rows
   *  (e.g. legacy "of total : [LBP x] AND [USD y]"). */
  summary?: { roles?: string[]; text: (rows: Row[], values: FilterValues) => string;
    /** Text before the summary (default "of total : "). */
    prefix?: string };
  /** Multi-location cascade (legacy RadComboBox location + semester lists):
   *  semesters come from /modules/semester-options for the picked locations and
   *  the preselection follows the legacy rule ('upcoming' semester(s)). */
  semesterPick?: 'upcoming' | 'current';
  /** false disables Add New for the current filters (legacy BtnAddNew.Enabled). */
  canAddNew?: (values: FilterValues, role: string) => boolean;
  /** false makes the row Edit button refuse with the legacy "You do not have
   *  permission to do this action" alert (legacy _AccessReadOnly). */
  canEditRows?: (values: FilterValues, role: string) => boolean;
  /** Base route for add/edit forms (e.g. "/semesters"). Enables Add New + row Edit. */
  editBase?: string;
  /** Show the Edit pencil as the FIRST column instead of the last. */
  editFirst?: boolean;
  /** Filter params forwarded to the Add New form as query params (e.g.
   *  ['locationId'] so the new record defaults to the selected location). */
  newLinkParams?: string[];
  /** Named optional column sets, each with its own checkbox in the filter bar
   *  (e.g. the legacy "Feedback" columns). `roles` limits who sees the toggle. */
  columnGroups?: { key: string; label: string; roles?: string[] }[];
  /** Extra header buttons built from the loaded rows (proc order) and the
   *  current filter values, e.g. the private list's feedback stats prints. */
  actions?: (rows: Row[], values: Record<string, string | number | boolean>) => React.ReactNode;
}

const PAGE_SIZE = 50;

/** Footer cell for a `totalBy` column: one sum per distinct group value,
 *  e.g. "LBP 1,200 / USD 300" (groups sorted so the output is stable). */
function totalsBy(rows: Row[], col: ColumnDef): string {
  if (col.totalOnly) {
    const only = col.totalOnly.toUpperCase();
    let sum = 0;
    for (const r of rows) if (String(r[col.totalBy!] ?? '').trim().toUpperCase() === only) sum += Number(r[col.key]) || 0;
    return `${only === 'USD' ? '$' : only + ' '}${sum.toLocaleString()}`;
  }
  const sums = new Map<string, number>();
  for (const r of rows) {
    const g = String(r[col.totalBy!] ?? '');
    sums.set(g, (sums.get(g) ?? 0) + (Number(r[col.key]) || 0));
  }
  return [...sums.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([g, v]) => `${g} ${v.toLocaleString()}`.trim())
    .join(' / ');
}

/** Checkbox-dropdown filter (legacy RadComboBox CheckBoxes + Check All). */
function MultiSelect({ label, options, value, width, onChange, disabled }: {
  label: string; options: FilterOption[]; value: string; width?: string;
  onChange: (next: string) => void;
  /** lockedFor: shown but not editable (legacy ddlLocations_MS.Enabled=false). */
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const picked = new Set(value.split(',').map((s) => s.trim()).filter(Boolean));
  const all = options.length > 0 && options.every((o) => picked.has(String(o.value)));
  const summary = picked.size === 0 ? `${label}: All`
    : picked.size === 1 ? options.find((o) => picked.has(String(o.value)))?.label ?? `${label}: 1`
    : `${label}: ${picked.size}`;
  const toggle = (v: string) => {
    const next = new Set(picked);
    if (next.has(v)) next.delete(v); else next.add(v);
    onChange(options.filter((o) => next.has(String(o.value))).map((o) => String(o.value)).join(','));
  };
  return (
    <div
      className="relative"
      tabIndex={-1}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        className={`${width || 'w-40'} rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600 text-left truncate focus:outline-none focus:ring-2 focus:ring-[#1e5c97]/40 disabled:bg-slate-50 disabled:text-slate-400`}
        title={summary}
      >
        {summary}
      </button>
      {open && (
        <div className="absolute z-20 mt-1 min-w-44 max-h-64 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg p-2 text-xs">
          <label className="flex items-center gap-2 px-1 py-1 font-semibold text-slate-700 border-b border-slate-100 mb-1 select-none">
            <input
              type="checkbox"
              checked={all}
              onChange={(e) => onChange(e.target.checked ? options.map((o) => String(o.value)).join(',') : '')}
              className="accent-[#1e5c97]"
            />
            Check all
          </label>
          {options.map((o) => (
            <label key={String(o.value)} className="flex items-center gap-2 px-1 py-1 text-slate-600 hover:bg-slate-50 rounded select-none">
              <input type="checkbox" checked={picked.has(String(o.value))} onChange={() => toggle(String(o.value))} className="accent-[#1e5c97]" />
              {o.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// Location filters open scoped to the signed-in user's own location rather than
// to "all locations". Still editable, an explicit `initial` in the config wins.
const LOCATION_PARAMS = new Set(['locationId', 'locationIds']);
const SEMESTER_PARAMS = new Set(['semesterId', 'semesterIds']);

// Semester rows come straight off P_Semester_Select, which spells the key both ways.
function semesterId(r: Row): number {
  return Number(r.SemesterId ?? r.SemesterID ?? 0);
}

// Resolve a row's id value tolerant of casing: proc columns come back with the
// exact SQL casing (e.g. "ClassId"), while some configs spell the key "ClassID".
// A case-insensitive fallback keeps the row key + Edit link working either way.
function rowId(r: Row, key?: string): unknown {
  if (!key) return undefined;
  if (r[key] !== undefined) return r[key];
  const lower = key.toLowerCase();
  for (const k in r) if (k.toLowerCase() === lower) return r[k];
  return undefined;
}

function fmt(v: unknown, format?: ColumnDef['format']): React.ReactNode {
  if (v == null || v === '') return '-';
  switch (format) {
    case 'date':
      return fmtDate(v, String(v));
    case 'money':
      return Number(v).toLocaleString();
    case 'bool':
      return (
        <span
          className={`inline-block w-2.5 h-2.5 rounded-full border ${
            v === true ? 'bg-emerald-500 border-emerald-700' : 'bg-red-500 border-red-700'
          }`}
        />
      );
    default:
      return String(v);
  }
}

export function ModuleListPage({ config }: { config: ModuleConfig }) {
  const user = getStoredUser();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const access = useAccess();
  const canEdit = !!config.editBase && config.idKey && user?.userType?.toLowerCase() !== 'guest'
    && user?.canSave !== false && access.canEdit(config.editBase);
  // Role gating for filters / column groups / totals (userType, lower-case).
  const userRole = (user?.userType ?? '').toLowerCase();
  const roleOk = (roles?: string[]) => !roles || roles.includes(userRole);
  const [rows, setRows] = useState<Row[]>([]);
  const [lookups, setLookups] = useState<Record<string, FilterOption[]>>({});
  const [values, setValues] = useState<Record<string, string | number | boolean>>(() => {
    const v: Record<string, string | number | boolean> = {};
    for (const f of config.filters) {
      // A matching URL query param wins, so per-row deep-links can pre-filter a
      // list (e.g. /sessions?classId=12&date= to clear the date default).
      // A present-but-empty param is honored too (explicitly clears a default);
      // absent params leave behavior unchanged.
      if (searchParams.has(f.param)) {
        const urlVal = searchParams.get(f.param) ?? '';
        v[f.param] = f.type === 'checkbox' ? urlVal === 'true'
          : f.type === 'select' ? (/^\d+$/.test(urlVal) ? Number(urlVal) : urlVal || 0)
          : urlVal;
        continue;
      }
      if (f.initial === undefined && LOCATION_PARAMS.has(f.param) && user?.primaryLocationId) {
        v[f.param] = f.type === 'multiselect' ? String(user.primaryLocationId) : user.primaryLocationId;
        continue;
      }
      v[f.param] = f.initial ?? (f.type === 'checkbox' ? false : f.type === 'select' ? 0 : '');
    }
    return v;
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Sort is remembered per list (survives refresh / coming back from a form).
  const [sortKey, setSortKey, sortAsc, setSortAsc] = useStickySort<string>(columnPrefKey(config.endpoint).replace(/^cols\./, ''), '');
  // Per-user column choice (saved in the DB); replaces "More columns".
  // Keyed by endpoint (incl. its query, e.g. ?mode=extra) so each list has its own.
  const colPrefs = useColumnPrefs(columnPrefKey(config.endpoint));
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (config.lookups)
      apiRequest<Record<string, FilterOption[]>>(config.lookups).then(setLookups).catch(() => {});
  }, [config.lookups]);

  // ── Location → semester cascade ───────────────────────────────────────────
  // When a page filters by both, the semester list is reloaded for the chosen
  // location and reset to that location's current semester, so the grid always
  // opens on the semester actually running now.
  const locationParam = config.filters.find((f) => LOCATION_PARAMS.has(f.param))?.param;
  const semesterParam = config.filters.find((f) => SEMESTER_PARAMS.has(f.param))?.param;
  const cascades = !!locationParam && !!semesterParam;
  const [semOptions, setSemOptions] = useState<FilterOption[] | null>(null);

  // load() reads `values`; the cascade needs the freshest copy without re-firing.
  const valuesRef = useRef(values);
  valuesRef.current = values;

  // A semester passed in the URL should survive the first cascade run instead of
  // being replaced by the location's current semester (so deep-links land right).
  const urlSemester = semesterParam ? searchParams.get(semesterParam) : null;
  const pendingUrlSemester = useRef(urlSemester && /^\d+$/.test(urlSemester) ? Number(urlSemester) : 0);
  // Multiselect semesters (semesterPick): a present URL value ("1,3" or "")
  // is restored as-is once, absent means "use the legacy preselection".
  const multiSemester = config.filters.find((f) => f.param === semesterParam)?.type === 'multiselect';
  const pendingUrlSemesters = useRef<string | null>(multiSemester ? urlSemester : null);
  const semesterRows = useRef<Row[]>([]);

  const locValue = locationParam ? values[locationParam] : undefined;
  useEffect(() => {
    if (!cascades) return;
    apiRequest<{ semesters: Row[]; currentSemesterId?: number; selectedIds?: string }>(
      config.semesterPick
        ? `/api/portal/modules/semester-options?locationIds=${encodeURIComponent(String(locValue ?? ''))}&pick=${config.semesterPick}`
        : `/api/portal/schedule/semesters?locationId=${Number(locValue) || 0}`
    )
      .then((r) => {
        semesterRows.current = r.semesters ?? [];
        const opts = (r.semesters ?? [])
          .map((s) => ({ value: semesterId(s), label: String(s.SemesterName ?? '') }))
          .filter((o) => o.value > 0);
        setSemOptions(opts);
        // Consume a URL semester once; afterwards follow the location's current.
        const urlSem = pendingUrlSemester.current;
        pendingUrlSemester.current = 0;
        const urlSems = pendingUrlSemesters.current;
        pendingUrlSemesters.current = null;
        const sem: string | number = multiSemester
          ? (urlSems ?? r.selectedIds ?? '')
          : (urlSem && opts.some((o) => o.value === urlSem) ? urlSem : 0)
            || Number(String(r.selectedIds ?? '').split(',')[0]) // single-select semesterPick
            || r.currentSemesterId || Number(opts[0]?.value) || 0;
        const next = { ...valuesRef.current, [semesterParam!]: sem };
        setValues(next);
        load(next);
      })
      .catch(() => setSemOptions(null));
  }, [locValue, cascades]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Dependent option lists (FilterDef.optionsFrom) ─────────────────────────
  // Each filter's URL is recomputed from the current values; only a changed URL
  // refetches. A stale response (URL moved on meanwhile) is dropped. When the new
  // list no longer offers the selected value it falls back to "all" and the grid
  // reloads (legacy DataBind reset the dropdown to "Not Selected"). A null URL
  // (e.g. no semester yet) empties the list but keeps the value, so deep-links
  // survive until the cascade resolves.
  const [depOptions, setDepOptions] = useState<Record<string, FilterOption[]>>({});
  const depUrls = useRef<Record<string, string>>({});
  const depKey = config.filters.map((f) => (f.optionsFrom ? f.optionsFrom.url(values) ?? '' : '')).join('|');
  useEffect(() => {
    for (const f of config.filters) {
      if (!f.optionsFrom) continue;
      const url = f.optionsFrom.url(valuesRef.current) ?? '';
      if (depUrls.current[f.param] === url) continue;
      depUrls.current[f.param] = url;
      if (!url) { setDepOptions((d) => ({ ...d, [f.param]: [] })); continue; }
      apiRequest<unknown>(url)
        .then((res) => {
          if (depUrls.current[f.param] !== url) return;
          const opts = f.optionsFrom!.pick ? f.optionsFrom!.pick(res) : (Array.isArray(res) ? res as FilterOption[] : []);
          setDepOptions((d) => ({ ...d, [f.param]: opts }));
          const cur = valuesRef.current[f.param];
          const empty = cur === '' || cur === 0 || cur == null;
          if (!empty && opts.some((o) => String(o.value) === String(cur))) return;
          if (f.firstByDefault && opts.length) {
            const first = { ...valuesRef.current, [f.param]: opts[0].value };
            setValues(first);
            load(first);
            return;
          }
          if (empty) return;
          const next = { ...valuesRef.current, [f.param]: typeof cur === 'number' ? 0 : '' };
          setValues(next);
          load(next);
        })
        .catch(() => {});
    }
  }, [depKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function buildQuery(v: Record<string, string | number | boolean>): string {
    const q = new URLSearchParams();
    for (const f of config.filters) {
      if (f.submit === false || !roleOk(f.roles)) continue;
      const val = v[f.param];
      if (val === '' || val === false || val == null) continue;
      if (f.type === 'select' && Number(val) === 0 && typeof val === 'number') continue;
      q.set(f.param, String(val));
    }
    return q.toString();
  }

  function load(v = values) {
    setLoading(true);
    setError('');
    apiRequest<Row[]>(`${config.endpoint}${config.endpoint.includes('?') ? '&' : '?'}${buildQuery(v)}`)
      .then((data) => { setRows(data); setPage(0); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load data.'))
      .finally(() => setLoading(false));
  }

  // On cascading pages the semester effect above owns the first load, so we
  // don't fire a throwaway request against a not-yet-resolved semester.
  useEffect(() => { if (!cascades) load(); }, [config.endpoint]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mirror the filters into the URL as they change, so leaving the list (edit,
  // back button) and returning restores the same criteria instead of the
  // defaults. The values initialiser above already reads them back. `replace`
  // keeps typing in a text filter from flooding the history stack.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    for (const f of config.filters) next.set(f.param, String(values[f.param] ?? ''));
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }, [values]); // eslint-disable-line react-hooks/exhaustive-deps

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const arr = [...rows];
    arr.sort((a, b) => {
      const va = a[sortKey], vb = b[sortKey];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp =
        typeof va === 'number' && typeof vb === 'number'
          ? va - vb
          : String(va).localeCompare(String(vb), undefined, { sensitivity: 'base', numeric: true });
      return sortAsc ? cmp : -cmp;
    });
    return arr;
  }, [rows, sortKey, sortAsc]);

  const groups = (config.columnGroups ?? []).filter((g) => roleOk(g.roles));
  // Action columns (no label / "_" keys) always show; the rest follow the
  // user's saved choice, defaulting to: main columns on, "extra" and group
  // columns off. Group columns only exist for the roles their group allows.
  const groupAllowed = (c: ColumnDef) => !c.group || groups.some((g) => g.key === c.group);
  const pickable = (c: ColumnDef) => !!c.label && !c.key.startsWith('_');
  const defaultShown = (c: ColumnDef) => !c.extra && !c.group;
  const cols = config.columns.filter((c) => groupAllowed(c) && (!pickable(c) || colPrefs.isShown(c.key, defaultShown(c)))
    && !c.hiddenWhen?.(values, userRole));
  const pickerSections: PickerSection[] = [
    { title: 'Columns', columns: config.columns.filter((c) => pickable(c) && !c.extra && !c.group) },
    { title: 'More columns', columns: config.columns.filter((c) => pickable(c) && c.extra && !c.group) },
    ...groups.map((g) => ({ title: g.label, columns: config.columns.filter((c) => pickable(c) && c.group === g.key) })),
  ].map((sec) => ({ title: sec.title, columns: sec.columns.map((c) => ({ key: c.key, label: c.label, shown: colPrefs.isShown(c.key, defaultShown(c)) })) }));
  const showTotal = (c: ColumnDef) => (c.total || !!c.totalBy) && roleOk(c.totalRoles);
  const hasTotals = cols.some(showTotal);
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function toggleSort(key: string) {
    if (sortKey === key) setSortAsc((x) => !x);
    else { setSortKey(key); setSortAsc(true); }
  }

  function exportCsv() {
    const header = cols.map((c) => c.label).join(',');
    const lines = sorted.map((r) =>
      cols.map((c) => `"${String(r[c.key] ?? '').replace(/"/g, '""')}"`).join(',')
    );
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${config.title.toLowerCase().replace(/\s+/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const selectCls =
    'rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600 focus:outline-none focus:ring-2 focus:ring-[#1e5c97]/40';

  // Row Edit pencil (last column, or first with config.editFirst).
  const editCell = (r: Row) => (
                      <td className="px-3 py-2.5 text-right">
                        <button
                          onClick={() => {
                            // Legacy _AccessReadOnly: the Edit link refuses with an alert.
                            if (config.canEditRows?.(values, userRole) === false) {
                              window.alert('You do not have permission to do this action');
                              return;
                            }
                            navigate(`${config.editBase}/${rowId(r, config.idKey)}`);
                          }}
                          title="Edit"
                          className="text-[#1e5c97] hover:text-[#17497a]"
                        >
                          <Pencil className="size-4" />
                        </button>
                      </td>
  );

  return (
    <div className="p-6">
      <PageHero
        compact
        title={config.title}
        subtitle={
          (loading ? 'Loading…' : `${sorted.length.toLocaleString()} rows`) +
          (!loading && config.summary && roleOk(config.summary.roles) && sorted.length
            ? ` · ${config.summary.prefix ?? 'of total : '}${config.summary.text(sorted, values)}` : '') +
          (config.subtitle ? ` · ${config.subtitle}` : '')
        }
        slide={config.title.length % 4}
        right={
          <div className="flex items-center gap-2">
            {!loading && config.actions?.(rows, values)}
            {canEdit && (
              <button
                onClick={() => {
                  const q = new URLSearchParams();
                  for (const p of config.newLinkParams ?? []) {
                    const v = values[p];
                    if (v === '' || v == null || v === false || v === 0) continue;
                    q.set(p, String(v));
                  }
                  navigate(`${config.editBase}/new${q.toString() ? `?${q}` : ''}`);
                }}
                disabled={config.canAddNew?.(values, userRole) === false}
                title={config.canAddNew?.(values, userRole) === false ? 'Not available for the selected locations' : undefined}
                className="btn-grad flex items-center gap-1.5 rounded-lg text-xs font-semibold px-3 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus className="size-3.5" /> Add New
              </button>
            )}
            <ColumnPicker
              sections={pickerSections}
              onToggle={colPrefs.set}
              onSetMany={colPrefs.setMany}
              onReset={colPrefs.reset}
            />
            {user?.canExport && (
              <button
                onClick={exportCsv}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#1e5c97] hover:bg-slate-50 transition-colors"
              >
                <Download className="size-3.5" /> Export
              </button>
            )}
          </div>
        }
      />

      <form
        onSubmit={(e) => { e.preventDefault(); load(); }}
        className="bg-white rounded-2xl border border-slate-100 shadow-sm p-3 mb-4 flex flex-wrap items-center gap-2"
      >
        {config.filters.filter((f) => roleOk(f.roles)).map((f) => {
          const val = values[f.param];
          const set = (nv: string | number | boolean) => {
            let next: FilterValues = { ...values, [f.param]: nv };
            if (f.derive) next = f.derive(next, { semesterRows: semesterRows.current, role: userRole });
            setValues(next);
            // Opt-in filters (e.g. Location on payroll) apply on change, no Search click.
            if (f.autoSubmit) load(next);
          };
          const locked = !!f.lockedFor?.some((t) => t.toLowerCase() === (user?.userType || '').toLowerCase())
            || !!f.disabledWhen?.(values, userRole);
          switch (f.type) {
            case 'multiselect':
              return (
                <MultiSelect
                  key={f.param}
                  label={f.label}
                  width={f.width}
                  options={(semOptions && f.param === semesterParam ? semOptions : null) ?? f.options ?? lookups[f.optionsKey || ''] ?? []}
                  value={String(val ?? '')}
                  onChange={set}
                  disabled={locked}
                />
              );
            case 'text':
              return (
                <div key={f.param} className="relative">
                  <Search className="size-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    value={String(val ?? '')}
                    onChange={(e) => set(e.target.value)}
                    disabled={locked}
                    placeholder={f.label}
                    className={`${f.width || 'w-48'} rounded-lg border border-slate-200 pl-8 pr-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#1e5c97]/40`}
                  />
                </div>
              );
            case 'date':
              return (
                <label key={f.param} className="flex items-center gap-1 text-xs text-slate-500">
                  {f.label}
                  <DateInput value={String(val ?? '')} onChange={(e) => set(e.target.value)} disabled={locked} className={selectCls} />
                </label>
              );
            case 'checkbox':
              return (
                <label key={f.param} className="flex items-center gap-1 text-xs text-slate-500 select-none px-1">
                  <input type="checkbox" checked={val === true} onChange={(e) => set(e.target.checked)} disabled={locked} className="accent-[#1e5c97]" />
                  {f.label}
                </label>
              );
            case 'select': {
              const opts =
                (semOptions && f.param === semesterParam ? semOptions : null) ??
                (f.optionsFrom ? depOptions[f.param] ?? [] : null) ??
                f.options ?? lookups[f.optionsKey || ''] ?? [];
              return (
                <select
                  key={f.param}
                  value={String(val ?? '')}
                  onChange={(e) => {
                    const raw = e.target.value;
                    set(typeof (opts[0]?.value) === 'number' ? Number(raw) : raw);
                  }}
                  disabled={locked}
                  className={`${selectCls} ${f.width || ''} disabled:bg-slate-50 disabled:text-slate-400`}
                >
                  <option value={typeof (opts[0]?.value) === 'number' ? 0 : ''}>{f.label}</option>
                  {opts.map((o) => (
                    <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
                  ))}
                </select>
              );
            }
          }
        })}
        <button type="submit" className="btn-grad ml-auto rounded-lg text-xs font-semibold px-4 py-1.5">
          Search
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
        <>
          <div className="bg-white rounded-2xl border border-slate-100 shadow-soft overflow-x-auto">
            <table className="tbl w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="text-left text-xs text-slate-400 uppercase tracking-wider border-b border-slate-100">
                  {canEdit && config.editFirst && <th className="px-3 py-3 font-semibold">Edit</th>}
                  {cols.map((c) => (
                    <th key={c.key + c.label} className="px-3 py-3 font-semibold">
                      {/* Action columns (no title, e.g. Pay) aren't sortable. */}
                      {c.label ? (
                        <button type="button" onClick={() => toggleSort(c.key)} className="flex items-center gap-1 hover:text-slate-600">
                          {c.label}
                          {sortKey === c.key
                            ? (sortAsc ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)
                            : <ArrowUpDown className="size-3 opacity-40" />}
                        </button>
                      ) : null}
                    </th>
                  ))}
                  {canEdit && !config.editFirst && <th className="px-3 py-3 font-semibold text-right">Edit</th>}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r, i) => (
                  <tr
                    key={String(rowId(r, config.idKey) ?? i)}
                    className={`border-b border-slate-50 last:border-0 ${config.rowClass?.(r) ?? ''}`}
                  >
                    {canEdit && config.editFirst && editCell(r)}
                    {cols.map((c) => {
                      const custom = config.renderCell?.(r, c, load);
                      return (
                        <td key={c.key + c.label} className="px-3 py-2.5 text-slate-600 max-w-64 overflow-hidden text-ellipsis">
                          {custom !== undefined ? custom : fmt(r[c.key], c.format)}
                        </td>
                      );
                    })}
                    {canEdit && !config.editFirst && editCell(r)}
                  </tr>
                ))}
                {pageRows.length === 0 && (
                  <tr>
                    <td colSpan={cols.length + (canEdit ? 1 : 0)} className="px-4 py-10 text-center text-slate-400">
                      No rows found.
                    </td>
                  </tr>
                )}
              </tbody>
              {hasTotals && sorted.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-slate-200 font-bold text-slate-700 bg-slate-50/60">
                    {canEdit && config.editFirst && <td className="px-3 py-2.5">Total</td>}
                    {cols.map((c, idx) => (
                      <td key={c.key + c.label} className="px-3 py-2.5">
                        {/* w-0 + min-w-full: a long total never widens its column. */}
                        <div className="w-0 min-w-full whitespace-nowrap">
                          {!showTotal(c)
                            ? (idx === 0 && !(canEdit && config.editFirst) ? 'Total' : '')
                            : c.totalBy
                              ? totalsBy(sorted, c)
                              : Number(sorted.reduce((s, r) => s + (Number(r[c.key]) || 0), 0)).toLocaleString()}
                        </div>
                      </td>
                    ))}
                    {canEdit && !config.editFirst && <td />}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {pages > 1 && (
            <div className="flex items-center justify-end gap-2 mt-4 text-sm text-slate-500">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="p-1.5 rounded-lg border border-slate-200 bg-white disabled:opacity-40"
              >
                <ChevronLeft className="size-4" />
              </button>
              <span>Page {page + 1} of {pages}</span>
              <button
                onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
                disabled={page >= pages - 1}
                className="p-1.5 rounded-lg border border-slate-200 bg-white disabled:opacity-40"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

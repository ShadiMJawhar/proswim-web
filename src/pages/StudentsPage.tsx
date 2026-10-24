import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Search, Loader2, AlertCircle, ChevronLeft, ChevronRight,
  ArrowUpDown, ArrowUp, ArrowDown, Download, Send, ExternalLink, Pencil, Plus, ListChecks,
} from 'lucide-react';
import { apiRequest, getStoredUser } from '../api/portalApi';
import { useUrlState } from '../lib/urlState';
import { fmtDate as toDMY } from '../lib/dates';
import { PageHero } from '../components/PageHero';
import { ColumnPicker } from '../components/ColumnPicker';
import { useColumnPrefs } from '../lib/columnPrefs';

import { useStickySort } from '../lib/stickySort';
export interface StudentListItem {
  studentId: number;
  studentFullName: string | null;
  studentGender: string | null;
  studentDateOfBirth: string | null;
  phoneNumber1: string | null;
  phoneNumber2: string | null;
  studentEmail: string | null;
  studentSchool: string | null;
  locationNickName: string | null;
  studentLatestLevelName: string | null;
  studentActive: boolean;
  studentDeleted: boolean;
  studentGroupSwimmer: boolean;
  studentPrivateSwimmer: boolean;
  studentStartingDate: string | null;
  grpFirstDate: string | null;
  grpLastDate: string | null;
  prvFirstDate: string | null;
  prvLastDate: string | null;
  studentNationality1: string | null;
  studentNationality2: string | null;
  studentMomOccupation: string | null;
  studentDadOccupation: string | null;
  studentAddressFullAddress: string | null;
  scheduleRemark: string | null;
}

interface Filters {
  locations: { locationId: number; locationNickName: string | null }[];
  schools: string[];
  yobs: string[];
  occupations: string[];
  types: string[];
}

const PAGE_SIZE = 50;

type SortKey = keyof StudentListItem;

const BASE_COLS: Array<{ key: SortKey; label: string }> = [
  { key: 'studentFullName', label: 'Name' },
  { key: 'locationNickName', label: 'Location' },
  { key: 'studentDateOfBirth', label: 'Born' },
  { key: 'phoneNumber1', label: 'Phone' },
  { key: 'studentSchool', label: 'School' },
  { key: 'studentEmail', label: 'Email' },
];

const EXTRA_COLS: Array<{ key: SortKey; label: string }> = [
  { key: 'phoneNumber2', label: 'Phone 2' },
  { key: 'grpFirstDate', label: 'Grp First' },
  { key: 'grpLastDate', label: 'Grp Last' },
  { key: 'prvFirstDate', label: 'Prv First' },
  { key: 'prvLastDate', label: 'Prv Last' },
  { key: 'studentNationality1', label: 'Nationality' },
  { key: 'studentNationality2', label: 'Nationality 2' },
  { key: 'studentMomOccupation', label: 'Mom Occ.' },
  { key: 'studentDadOccupation', label: 'Dad Occ.' },
  { key: 'studentAddressFullAddress', label: 'Address' },
  { key: 'scheduleRemark', label: 'Schedule' },
];

// ddlType in StudentsList.aspx: code sent to the proc → friendly text shown.
const TYPE_LABELS: Record<string, string> = {
  Group: 'Group',
  GroupActive: 'Group Active',
  Private: 'Private',
  PrivateActive: 'Private Active',
  GroupActiveOrPrivateActive: 'Group Reg Or Private Act',
  AquaBaby: 'AquaBaby',
  School: 'School',
  Gifted: 'Gifted',
  ProSwimmer: 'ProSwimmer',
  WallOfFame: 'WallOfFame',
  GroupOrPrivate: 'Group Or Private',
  GroupAndPrivate: 'Group And Private',
  GroupAndSchool: 'Group And School',
  GroupOrSchool: 'Group Or School',
  WaitingList: 'Waiting List',
  BDay_PrevMonth: 'BDay_PrevMonth',
  BDay_ThisMonth: 'BDay_ThisMonth',
  BDay_NextMonth: 'BDay_NextMonth',
};

function fmtCell(key: SortKey, v: unknown): string {
  if (v == null || v === '') return '-';
  // Legacy grid shows every date, Born included, as dd/MM/yyyy.
  if (typeof v === 'string' && /Date|Born/i.test(key)) {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return toDMY(d);
  }
  return String(v);
}

export function StudentsPage() {
  const user = getStoredUser();
  const navigate = useNavigate();
  const userType = (user?.userType || '').toLowerCase();
  const isGuest = userType === 'guest';
  const canCreate = !isGuest && user?.canSave !== false;
  // Legacy: "user" and "guest" types are locked to their assigned location.
  const locationLocked = (userType === 'user' || isGuest) && !!user?.primaryLocationId;
  const [students, setStudents] = useState<StudentListItem[]>([]);
  const [filters, setFilters] = useState<Filters | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Deep links (e.g. the dashboard risk radar) can pre-fill the search.
  const [urlParams] = useSearchParams();
  const initialSearch = urlParams.get('searchFor') ?? '';
  // filter state
  // Filters live in the URL so opening a student and coming back restores them
  // (and the committed query below, so the grid reloads the same results).
  const [search, setSearch] = useUrlState('searchFor', initialSearch);
  // Everyone opens scoped to their own location; only locked types can't change it.
  const [locationId, setLocationId] = useUrlState('locationId', user?.primaryLocationId ?? 0);
  const [school, setSchool] = useUrlState('school', '');
  const [type, setType] = useUrlState('type', '');
  const [yob, setYob] = useUrlState('yob', '');
  const [occupation, setOccupation] = useUrlState('occupation', '');
  const [showDeleted, setShowDeleted] = useUrlState('showDeleted', false);
  const [showInactive, setShowInactive] = useUrlState('showInactive', true);
  const [query, setQuery] = useUrlState('q', // committed query string
    initialSearch ? new URLSearchParams({ searchFor: initialSearch }).toString() : '');

  // grid state
  const [sortKey, setSortKey, sortAsc, setSortAsc] = useStickySort<SortKey>('students', 'studentFullName');
  // Per-user column choice, saved in the DB (replaces "More columns").
  const colPrefs = useColumnPrefs('cols.students');
  const [page, setPage] = useState(0);
  const [inviting, setInviting] = useState<number | null>(null);

  useEffect(() => {
    apiRequest<Filters>('/api/portal/students/filters')
      .then(setFilters)
      .catch(() => {}); // filter bar degrades gracefully
  }, []);

  useEffect(() => {
    setLoading(true);
    setError('');
    apiRequest<StudentListItem[]>(`/api/portal/students?${query}`)
      .then((data) => { setStudents(data); setPage(0); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load students.'))
      .finally(() => setLoading(false));
  }, [query]);

  // Builds and commits the query from the current filter state. The dropdowns
  // and the Deleted checkbox auto-post back like the legacy page (AutoPostBack),
  // so they pass their new value as an override (state updates are async); the
  // text box still waits for the Search button / Enter.
  function applyFilters(overrides: Partial<{
    locationId: number; school: string; type: string; yob: string; occupation: string; showDeleted: boolean;
  }> = {}) {
    const v = { locationId, school, type, yob, occupation, showDeleted, ...overrides };
    const q = new URLSearchParams();
    if (search.trim()) q.set('searchFor', search.trim());
    if (v.locationId) q.set('locationId', String(v.locationId));
    if (v.school) q.set('school', v.school);
    if (v.type) q.set('type', v.type);
    if (v.yob) q.set('yob', v.yob);
    if (v.occupation) q.set('parentOccupation', v.occupation);
    if (v.showDeleted) q.set('showDeleted', 'true');
    setQuery(q.toString());
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    applyFilters();
  }

  const filtered = useMemo(
    () => students.filter((s) => (showInactive ? true : s.studentActive)),
    [students, showInactive]
  );

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const va = a[sortKey], vb = b[sortKey];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp =
        typeof va === 'number' && typeof vb === 'number'
          ? va - vb
          : String(va).localeCompare(String(vb), undefined, { sensitivity: 'base' });
      return sortAsc ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortAsc]);

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  // Legacy guest grid hides the phone column and the additional-columns set.
  const baseCols = isGuest ? BASE_COLS.filter((c) => c.key !== 'phoneNumber1') : BASE_COLS;
  // Name always shows (it is the link to the student); guests never get the
  // extra columns (the API blanks those fields for them anyway).
  const extraCols = isGuest ? [] : EXTRA_COLS;
  const cols = [
    ...baseCols.filter((c) => c.key === 'studentFullName' || colPrefs.isShown(c.key, true)),
    ...extraCols.filter((c) => colPrefs.isShown(c.key, false)),
  ];
  const pickerSections = [
    { title: 'Columns', columns: baseCols.filter((c) => c.key !== 'studentFullName').map((c) => ({ key: c.key, label: c.label, shown: colPrefs.isShown(c.key, true) })) },
    { title: 'More columns', columns: extraCols.map((c) => ({ key: c.key, label: c.label, shown: colPrefs.isShown(c.key, false) })) },
  ];

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(true); }
  }

  function exportCsv() {
    const keys = cols.map((c) => c.key);
    const header = ['StudentId', ...cols.map((c) => c.label), 'Active'].join(',');
    const lines = sorted.map((s) =>
      [
        s.studentId,
        ...keys.map((k) => `"${String(s[k] ?? '').replace(/"/g, '""')}"`),
        s.studentActive ? 'Yes' : 'No',
      ].join(',')
    );
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'students.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function sendInvite(s: StudentListItem) {
    const ok = window.confirm(
      `Send app login to ${s.studentFullName || `#${s.studentId}`}?\n\n` +
      'This creates/resets their mobile app password and sends the credentials by WhatsApp.'
    );
    if (!ok) return;
    setInviting(s.studentId);
    setNotice('');
    try {
      await apiRequest(`/api/portal/students/${s.studentId}/send-invite`, { method: 'POST' });
      setNotice(`Invite sent to ${s.studentFullName || `#${s.studentId}`}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invite failed.');
    } finally {
      setInviting(null);
    }
  }

  const selectCls =
    'rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600 focus:outline-none focus:ring-2 focus:ring-[#1e5c97]/40';

  return (
    <div className="p-8">
      <PageHero
        compact
        title="Students"
        subtitle={loading ? 'Loading…' : `${sorted.length.toLocaleString()} students`}
        slide={2}
        right={
          <div className="flex items-center gap-2">
            {canCreate && (
              <button
                onClick={() => navigate('/students/new')}
                className="btn-grad flex items-center gap-1.5 rounded-lg text-xs font-semibold px-3 py-1.5"
              >
                <Plus className="size-3.5" /> Add New
              </button>
            )}
            <ColumnPicker sections={pickerSections} onToggle={colPrefs.set} onSetMany={colPrefs.setMany} onReset={colPrefs.reset} />
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

      {/* Filter bar, mirrors legacy StudentsList.aspx controls */}
      <form onSubmit={submitSearch} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-3 mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="size-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, phone, email…"
            className="w-56 rounded-lg border border-slate-200 pl-8 pr-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#1e5c97]/40"
          />
        </div>

        <select
          value={locationId}
          onChange={(e) => { const v = Number(e.target.value); setLocationId(v); applyFilters({ locationId: v }); }}
          disabled={locationLocked}
          className={`${selectCls} disabled:bg-slate-50 disabled:text-slate-400`}
        >
          <option value={0}>All locations</option>
          {filters?.locations.map((l) => (
            <option key={l.locationId} value={l.locationId}>{l.locationNickName}</option>
          ))}
        </select>

        <select value={type} onChange={(e) => { setType(e.target.value); applyFilters({ type: e.target.value }); }} className={selectCls}>
          <option value="">ALL</option>
          {filters?.types.map((t) => <option key={t} value={t}>{TYPE_LABELS[t] ?? t}</option>)}
        </select>

        <select value={school} onChange={(e) => { setSchool(e.target.value); applyFilters({ school: e.target.value }); }} className={`${selectCls} max-w-36`}>
          <option value="">All schools</option>
          {filters?.schools.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        <select value={yob} onChange={(e) => { setYob(e.target.value); applyFilters({ yob: e.target.value }); }} className={selectCls}>
          <option value="">All years</option>
          {filters?.yobs.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>

        <select value={occupation} onChange={(e) => { setOccupation(e.target.value); applyFilters({ occupation: e.target.value }); }} className={`${selectCls} max-w-36`}>
          <option value="">All occupations</option>
          {filters?.occupations.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>

        <label className="flex items-center gap-1 text-xs text-slate-500 select-none px-1">
          <input type="checkbox" checked={showDeleted} onChange={(e) => { setShowDeleted(e.target.checked); applyFilters({ showDeleted: e.target.checked }); }} className="accent-[#1e5c97]" />
          Deleted
        </label>
        <label className="flex items-center gap-1 text-xs text-slate-500 select-none px-1">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="accent-[#1e5c97]" />
          Inactive
        </label>

        <button
          type="submit"
          className="btn-grad ml-auto rounded-lg text-xs font-semibold px-4 py-1.5"
        >
          Search
        </button>
      </form>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl p-3 mb-3">
          <AlertCircle className="size-4 text-red-500 shrink-0" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}
      {notice && (
        <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 mb-3">
          <p className="text-sm text-emerald-700">{notice}</p>
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
                  <th className="px-3 py-3 font-semibold">Actions</th>
                  {cols.map((c) => (
                    <th key={c.key} className="px-3 py-3 font-semibold">
                      <button onClick={() => toggleSort(c.key)} className="flex items-center gap-1 hover:text-slate-600">
                        {c.label}
                        {sortKey === c.key
                          ? (sortAsc ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)
                          : <ArrowUpDown className="size-3 opacity-40" />}
                      </button>
                    </th>
                  ))}
                  <th className="px-3 py-3 font-semibold">Type</th>
                  <th className="px-3 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((s) => (
                  <tr
                    key={s.studentId}
                    // Legacy GVResult_RowDataBound: deleted → pink + strike-through,
                    // inactive → pink. (rgb(230,200,200) in the old grid.)
                    className={`group border-b border-slate-50 last:border-0 ${
                      s.studentDeleted ? 'bg-[#e6c8c8]/60 line-through' : !s.studentActive ? 'bg-[#e6c8c8]/60' : ''
                    }`}
                  >
                    {/* Actions first (user, 2026-10-24). */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        {!isGuest && user?.canSave !== false && (
                          <Link
                            to={`/students/${s.studentId}?edit=1`}
                            title="Edit student"
                            className="text-[#1e5c97] hover:text-[#242c43]"
                          >
                            <Pencil className="size-4" />
                          </Link>
                        )}
                        <button
                          onClick={() => sendInvite(s)}
                          disabled={inviting === s.studentId}
                          title="Send app login by WhatsApp"
                          className="text-emerald-600 hover:text-emerald-800 disabled:opacity-40"
                        >
                          {inviting === s.studentId
                            ? <Loader2 className="size-4 animate-spin" />
                            : <Send className="size-4" />}
                        </button>
                        {!isGuest && (
                          <Link
                            to={`/students/${s.studentId}/checklist`}
                            title="Skills checklist"
                            className="text-amber-600 hover:text-amber-800"
                          >
                            <ListChecks className="size-4" />
                          </Link>
                        )}
                        {!isGuest && (
                          <a
                            href={`http://www.proswim-lb.com/student.aspx?StudentId=${s.studentId}`}
                            target="_blank" rel="noreferrer"
                            title="Public profile"
                            className="text-slate-400 hover:text-[#1e5c97]"
                          >
                            <ExternalLink className="size-4" />
                          </a>
                        )}
                      </div>
                    </td>
                    {cols.map((c, i) => (
                      <td key={c.key} className="px-3 py-2.5 text-slate-500 max-w-56 overflow-hidden text-ellipsis">
                        {i === 0 ? (
                          isGuest ? (
                            <span className="font-medium text-slate-700">{s.studentFullName || `#${s.studentId}`}</span>
                          ) : (
                            <Link to={`/students/${s.studentId}`} className="font-medium text-[#1e5c97] hover:underline">
                              {s.studentFullName || `#${s.studentId}`}
                            </Link>
                          )
                        ) : (
                          fmtCell(c.key, s[c.key])
                        )}
                      </td>
                    ))}
                    <td className="px-3 py-2.5">
                      <div className="flex gap-1">
                        {s.studentGroupSwimmer && <Badge color="blue">Grp</Badge>}
                        {s.studentPrivateSwimmer && <Badge color="violet">Prv</Badge>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      {s.studentDeleted ? <Badge color="red">Deleted</Badge>
                        : s.studentActive ? <Badge color="green">Active</Badge>
                        : <Badge color="gray">Inactive</Badge>}
                    </td>
                  </tr>
                ))}
                {pageRows.length === 0 && (
                  <tr>
                    <td colSpan={cols.length + 3} className="px-4 py-10 text-center text-slate-400">
                      No students found.
                    </td>
                  </tr>
                )}
              </tbody>
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

const BADGE_COLORS: Record<string, string> = {
  blue: 'bg-blue-50 text-blue-700',
  violet: 'bg-violet-50 text-violet-700',
  green: 'bg-emerald-50 text-emerald-700',
  red: 'bg-red-50 text-red-600',
  gray: 'bg-slate-100 text-slate-500',
};

function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded ${BADGE_COLORS[color]}`}>
      {children}
    </span>
  );
}

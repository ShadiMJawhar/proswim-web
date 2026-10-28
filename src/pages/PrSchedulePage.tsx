// Private schedule calendar (PrivatePackagesListView.aspx): one band per coach,
// one row per time, one column per day; session boxes coloured by attendance
// progress. Slot and coach remarks are the legacy tbl_Remarks rows
// ('TimePrivate' / 'CoachPrivate'), edited inline instead of the Remarks.aspx popup.

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Loader2, AlertCircle, Search, ChevronLeft, ChevronRight, Pause, StickyNote, Phone,
  CreditCard, Package, MessageSquarePlus, Plus, X,
} from 'lucide-react';
import { apiRequest, getStoredUser } from '../api/portalApi';
import { useUrlState, useUrlPatch } from '../lib/urlState';
import { useRefreshOnFocus } from '../lib/refreshOnFocus';
import { DateInput } from '../components/DateInput';
import { fmtDate as toDMY } from '../lib/dates';
import { PageHero } from '../components/PageHero';
import { toast } from '../components/Toast';

type Row = Record<string, unknown>;

interface PrivateData {
  rows: Row[];
  countsHeader: Row[];
  timeRemarks: Row[];
}

interface RemarkTarget {
  type: 'TimePrivate' | 'CoachPrivate';
  id: number;
  title: string;
  initial: string;
}

const s = (v: unknown) => (v == null ? '' : String(v));
const n = (v: unknown) => (v == null ? 0 : Number(v));

// Legacy color constants (PrivatePackagesListView.aspx.cs)
const COLOR_EMPTY = '#fdfdc3';
const COLOR_CANCELLED = '#f4f401';
const COLOR_STARTING = '#84fb65';
const COLOR_MIDDLE = '#adf99a';
const COLOR_ENDING = '#fafa76';

// GetColorBasedonAttendance, ported 1:1.
function boxStyle(r: Row): React.CSSProperties {
  const status = s(r.packageStatus).toLowerCase();
  const state = s(r.PrivateSessionState).toLowerCase();
  const followup = s(r.PackageFollowUp);
  const attended = n(r.CountAttended);
  const total = n(r.PackageNumberOfSessions);

  if (state.includes('freeze') || status.includes('freeze'))
    return { backgroundImage: 'linear-gradient(to right, #FFFFFF, #eeebd2, #FFFFFF)' };

  const pct = total > 0 ? (attended * 100) / total : 0;
  let color = pct < 30 ? COLOR_STARTING : pct < 70 ? COLOR_MIDDLE : COLOR_ENDING;
  if (state.includes('canc')) color = COLOR_CANCELLED;
  if (attended >= total - 2) color = COLOR_ENDING;

  const fu = followup.toLowerCase();
  if (fu === '') return { backgroundColor: color };
  if (fu === 'renewing' || fu === 'renewed' || fu === 'movedtogroup')
    return { backgroundImage: `linear-gradient(to right, ${color}, ${color}, ${COLOR_STARTING})` };
  if (fu === 'leaving')
    return { backgroundImage: `linear-gradient(to right, ${color}, ${color}, #ebeb08)` };
  // Legacy returned an empty style for any other follow-up value.
  return {};
}

function boxBorder(r: Row): React.CSSProperties {
  if (s(r.PrivateSessionState).toLowerCase() === 'frommakeup') return { border: '4px dotted green' };
  if (s(r.PrivateSessionMkupDate)) return { border: '4px dotted #ebeb08' };
  return { border: '4px dotted transparent' };
}

// Cell border when several sessions share one slot.
function mergedBorder(sessions: Row[]): React.CSSProperties {
  if (sessions.length <= 1) return {};
  const activeCnt = sessions.filter((x) => !s(x.PrivateSessionState).toLowerCase().includes('canc')).length;
  const color = activeCnt >= 2 ? '#e60650' : activeCnt === 1 ? '#7cdd25' : '#aabd04';
  return { border: `6px solid ${color}` };
}

function fmtISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Legacy: Now.AddDays(DayOfWeek.Monday - Now.DayOfWeek); on a Sunday that is the coming Monday.
function mondayOfWeek(base: Date): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + 1 - d.getDay());
  return d;
}

// Legacy synthetic id of a coach/weekday/time slot remark (RemarkType
// 'TimePrivate'): coachId*100000 + DayOfWeek*10000 + HHmm, Sunday = 0 like
// .NET's DayOfWeek (same numbering as JS getDay()).
function slotRemarkId(coachId: number, dateStr: string, time: string): number {
  const d = new Date(dateStr);
  return coachId * 100000 + d.getDay() * 10000 + Number(time.replace(':', '') || 0);
}

// Legacy header links, in their page order. The proc also returns a
// 'NeedPayment' row, which the legacy page never showed.
const COUNT_LABELS: [string, string][] = [
  ['AttendanceMoreThanPayment2', 'Packs Need Payment'],
  ['NeedtoBeClosed', 'Packs Need to Be Closed'],
  ['NeedFollowup', 'Packs Need Followup'],
  ['Freeze', 'Freeze Packs'],
];

// Attention counters open the private-packages list pre-filtered. The proc has
// no 'Freeze' need-attention branch, so that one filters by package status.
function counterLink(criteria: string, locationId: number): string {
  const q = new URLSearchParams({ locationIds: String(locationId) });
  if (criteria === 'Freeze') q.set('status', 'Freeze');
  else q.set('needAttention', criteria);
  return `/privates?${q}`;
}

const DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Every link opens in its own tab, like the legacy popups, so the schedule
// stays open as the user left it; rel=opener lets that tab close itself
// ("Close" in SmartBack / Save & Close) to come back here.
const NEW_TAB = { target: '_blank', rel: 'opener' } as const;

export function PrSchedulePage() {
  const user = getStoredUser();
  const userType = (user?.userType || '').toLowerCase();
  const ownLocation = user?.primaryLocationId ?? 0;
  const isGuest = userType === 'guest';
  const canSave = user?.canSave !== false;
  // Remark links: legacy shows the coach-band, session-box and empty-slot
  // remark links even on a read-only view; the remark API refuses guests and
  // accounts without saving rights, so those don't get them.
  const canRemark = !isGuest && canSave;

  const monday = mondayOfWeek(new Date());
  const [locations, setLocations] = useState<{ locationId: number; locationNickName: string | null }[]>([]);
  const [coaches, setCoaches] = useState<{ coachId: number; coachFullName: string | null }[]>([]);
  // Filters live in the URL so leaving the schedule and coming back restores
  // them; the mount-time load below then reloads the same week and criteria.
  // The location is never locked: legacy ddlLocations stays enabled for every
  // account type (other locations are read-only for 'user', see below).
  const [locationId] = useUrlState('locationId', ownLocation);
  const [coachId, setCoachId] = useUrlState('coachId', 0);
  const [day, setDay] = useUrlState('day', '');
  const [search, setSearch] = useUrlState('search', '');
  const [dateFrom, setDateFrom] = useUrlState('dateFrom', fmtISO(monday));
  const [dateTo, setDateTo] = useUrlState('dateTo', fmtISO(new Date(monday.getTime() + 5 * 86400000)));
  const [onlyActive, setOnlyActive] = useUrlState('onlyActive', true);
  const [freeTimes, setFreeTimes] = useUrlState('freeTimes', false);
  const patchUrl = useUrlPatch();
  const [data, setData] = useState<PrivateData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [remarkEdit, setRemarkEdit] = useState<RemarkTarget | null>(null);

  // Legacy _AccessReadOnly: guests, and 'user' accounts looking at a location
  // other than their own, get a view-only schedule (no package / payment /
  // remark actions, no Add New, plain day headers). The superuser branch of
  // that check never fired: ddlLocations_SelectedIndexChanged first copies the
  // picked location into Session["UserLocationID"] for every non-'user' account,
  // so a superuser always had full actions on whatever location was selected.
  const readOnly = isGuest || (userType === 'user' && locationId !== ownLocation);
  const canAddNew = !readOnly && canSave;

  useEffect(() => {
    apiRequest<{ locations: typeof locations }>('/api/portal/students/lookups')
      .then((lk) => setLocations(lk.locations))
      .catch(() => {});
  }, []);

  // Coach filter = the active coaches of the selected location (legacy
  // ddlLocations_SelectedIndexChanged → Coach_Select(active, locationId)).
  useEffect(() => {
    apiRequest<{ coaches: typeof coaches }>(`/api/portal/schedule/coaches?locationId=${locationId}&anyLocation=true`)
      .then((r) => {
        const list = r.coaches ?? [];
        setCoaches(list);
        if (coachId && !list.some((c) => c.coachId === coachId)) setCoachId(0);
      })
      .catch(() => {});
  }, [locationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback((from: string, to: string) => {
    if (!from || !to) return;
    setLoading(true);
    setError('');
    const q = new URLSearchParams({
      dateFrom: from, dateTo: to,
      locationId: String(locationId), coachId: String(coachId),
      searchFor: search, day,
      showFreeTimes: String(freeTimes), showOnlyActive: String(onlyActive),
    });
    apiRequest<PrivateData>(`/api/portal/schedule/private?${q}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load schedule.'))
      .finally(() => setLoading(false));
  }, [locationId, coachId, search, day, freeTimes, onlyActive]);

  // Legacy AutoPostBack: location, dates, coach, day and the check boxes all
  // reload the schedule on change (the search box waits for Search). This also
  // does the first load. A blank "From" resets to the current week like
  // Page_Load did; a blank "To" waits for a full date.
  useEffect(() => {
    if (!dateFrom) {
      const m = mondayOfWeek(new Date());
      patchUrl({ dateFrom: fmtISO(m), dateTo: fmtISO(new Date(m.getTime() + 5 * 86400000)) });
      return;
    }
    load(dateFrom, dateTo);
  }, [locationId, coachId, day, onlyActive, freeTimes, dateFrom, dateTo]); // eslint-disable-line react-hooks/exhaustive-deps
  useRefreshOnFocus(() => { if (dateFrom && dateTo) load(dateFrom, dateTo); });

  function shiftWeek(offset: number) {
    const from = offset === 0 ? mondayOfWeek(new Date()) : new Date(new Date(dateFrom).getTime() + offset * 7 * 86400000);
    const f = fmtISO(from);
    const t = fmtISO(new Date(from.getTime() + 5 * 86400000));
    // A date change reloads through the effect above; "This week" on the
    // current week still reloads, like the legacy button.
    if (f === dateFrom && t === dateTo) load(f, t);
    else patchUrl({ dateFrom: f, dateTo: t });
  }

  // ── derived structures ────────────────────────────────────────────────────
  const rows = data?.rows ?? [];
  const coachList: { name: string; id: number; remark: string }[] = [];
  for (const r of rows) {
    const id = n(r.CoachId);
    if (!id || coachList.some((c) => c.id === id)) continue;
    coachList.push({ name: s(r.CoachFullname), id, remark: s(r.CoachRemark) });
  }
  coachList.sort((a, b) => a.name.localeCompare(b.name));

  const days = [...new Set(rows.map((r) => s(r.PrivateSessionDate)))].filter(Boolean).sort();
  const sessionCount = rows.filter((r) => n(r.PrivateSessionId) > 0).length;

  function timeRemark(coachIdVal: number, dateStr: string, time: string): string {
    const key = slotRemarkId(coachIdVal, dateStr, time);
    const hit = (data?.timeRemarks ?? []).find((r) => n(r.RemarkTypeID) === key);
    return hit ? s(hit.Remark) : '';
  }

  const [phones, setPhones] = useState<Record<number, string>>({});

  // Phone numbers aren't in the schedule proc, fetched per student on tap.
  async function showPhone(studentId: number) {
    if (phones[studentId]) {
      setPhones((prev) => { const next = { ...prev }; delete next[studentId]; return next; });
      return;
    }
    try {
      const st = await apiRequest<Record<string, unknown>>(`/api/portal/students/${studentId}`);
      const nums = [
        [st.StudentPhoneNumberCode1, st.StudentPhoneNumber1].filter(Boolean).join(' '),
        [st.StudentPhoneNumberCode2, st.StudentPhoneNumber2].filter(Boolean).join(' '),
      ].filter((x) => x.trim().length > 0).join(' / ');
      setPhones((prev) => ({ ...prev, [studentId]: nums || '-' }));
    } catch {
      setPhones((prev) => ({ ...prev, [studentId]: '-' }));
    }
  }

  // Legacy OpenWindowForRemarks(id, 'TimePrivate') from a free slot or a session box.
  function editSlotRemark(coach: { name: string; id: number }, dateStr: string, time: string) {
    const d = new Date(dateStr);
    setRemarkEdit({
      type: 'TimePrivate',
      id: slotRemarkId(coach.id, dateStr, time),
      title: `Remarks for ${coach.name} · ${DOW[d.getDay()]} ${time} [Private]`,
      initial: timeRemark(coach.id, dateStr, time),
    });
  }

  // Legacy OpenWindowForRemarks(coachId, 'CoachPrivate') from the coach band.
  function editCoachRemark(coach: { name: string; id: number; remark: string }) {
    setRemarkEdit({ type: 'CoachPrivate', id: coach.id, title: `Remarks for coach ${coach.name} [Private]`, initial: coach.remark });
  }

  // P_Remarks_Insert replaces the (type, id) row, an empty text clears it.
  async function saveRemark(target: RemarkTarget, remark: string) {
    try {
      await apiRequest('/api/portal/schedule/remark', {
        method: 'POST',
        body: JSON.stringify({ remarkType: target.type, remarkTypeId: target.id, remark }),
      });
      setRemarkEdit(null);
      toast.success(remark.trim() ? 'Remark saved.' : 'Remark cleared.');
      load(dateFrom, dateTo);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the remark.');
    }
  }

  const todayISO = fmtISO(new Date());
  const selectCls =
    'rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600 focus:outline-none focus:ring-2 focus:ring-[#1e5c97]/40';

  return (
    <div className="p-6">
      <PageHero
        compact
        title="Private Schedule"
        subtitle={`${toDMY(dateFrom)} → ${toDMY(dateTo)}${data ? ` · ${sessionCount} sessions` : ''}`}
        slide={0}
        right={
          <div className="flex gap-2 flex-wrap justify-end items-center">
            {COUNT_LABELS.map(([criteria, label]) => {
              const cnt = n((data?.countsHeader ?? []).find((c) => s(c.Criteria) === criteria)?.Cnt);
              return cnt > 0 && (
                <Link {...NEW_TAB}
                  key={criteria}
                  to={counterLink(criteria, locationId)}
                  className="text-xs font-bold text-red-600 bg-red-50 border border-red-100 rounded-lg px-2 py-1 hover:bg-red-100"
                >
                  {cnt} {label}
                </Link>
              );
            })}
            {canAddNew ? (
              <Link {...NEW_TAB}
                to={`/privates/new?locationId=${locationId}`}
                className="btn-grad flex items-center gap-1.5 rounded-lg text-xs font-semibold px-3 py-1.5"
              >
                <Plus className="size-3.5" /> Add New
              </Link>
            ) : (
              <button
                type="button"
                disabled
                title={isGuest ? 'Guests cannot add packages' : 'Switch to your own location to add a package'}
                className="btn-grad flex items-center gap-1.5 rounded-lg text-xs font-semibold px-3 py-1.5 opacity-50 cursor-not-allowed"
              >
                <Plus className="size-3.5" /> Add New
              </button>
            )}
          </div>
        }
      />

      {/* Filters */}
      <form
        onSubmit={(e) => { e.preventDefault(); load(dateFrom, dateTo); }}
        className="bg-white rounded-2xl border border-slate-100 shadow-sm p-3 mb-4 flex flex-wrap items-center gap-2"
      >
        <div className="relative">
          <Search className="size-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search student…"
            className="w-44 rounded-lg border border-slate-200 pl-8 pr-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#1e5c97]/40"
          />
        </div>
        <select
          value={locationId}
          // Legacy rebinds ddlCoaches on a location change, back to "Not Selected".
          onChange={(e) => patchUrl({ locationId: Number(e.target.value), coachId: 0 })}
          className={selectCls}
        >
          <option value={0}>All locations</option>
          {locations.map((l) => <option key={l.locationId} value={l.locationId}>{l.locationNickName}</option>)}
        </select>

        <div className="flex items-center gap-1">
          <button type="button" onClick={() => shiftWeek(-1)} title="Previous week"
            className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50">
            <ChevronLeft className="size-4 text-slate-500" />
          </button>
          <DateInput value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={selectCls} />
          <span className="text-xs text-slate-400">→</span>
          <DateInput value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={selectCls} />
          <button type="button" onClick={() => shiftWeek(0)} title="This week"
            className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50">
            <Pause className="size-4 text-slate-500" />
          </button>
          <button type="button" onClick={() => shiftWeek(1)} title="Next week"
            className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50">
            <ChevronRight className="size-4 text-slate-500" />
          </button>
        </div>

        <select value={coachId} onChange={(e) => setCoachId(Number(e.target.value))} className={selectCls}>
          <option value={0}>All coaches</option>
          {coaches.map((c) => <option key={c.coachId} value={c.coachId}>{c.coachFullName}</option>)}
        </select>
        <select value={day} onChange={(e) => setDay(e.target.value)} className={selectCls}>
          {DAYS.map((d) => <option key={d} value={d}>{d || 'All days'}</option>)}
        </select>
        <label className="flex items-center gap-1 text-xs text-slate-500 select-none px-1">
          <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} className="accent-[#1e5c97]" />
          Only Active
        </label>
        <label className="flex items-center gap-1 text-xs text-slate-500 select-none px-1">
          <input type="checkbox" checked={freeTimes} onChange={(e) => setFreeTimes(e.target.checked)} className="accent-[#1e5c97]" />
          Free Times
        </label>
        <button type="submit" className="rounded-lg bg-[#1e5c97] text-white text-xs font-semibold px-4 py-1.5 hover:bg-[#17497a]">
          Search
        </button>
      </form>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl p-3 mb-3">
          <AlertCircle className="size-4 text-red-500 shrink-0" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {readOnly && data && (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 mb-3">
          <p className="text-xs text-amber-700">
            {isGuest ? 'View-only account.' : 'View-only: package and payment actions are available on your own location only.'}
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="size-8 text-[#1e5c97] animate-spin" />
        </div>
      ) : data && coachList.length === 0 ? (
        <div className="text-center py-16 text-slate-400 text-sm">No data for this week.</div>
      ) : data && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 shadow-sm">
          <table className="w-full text-xs border-collapse" style={{ minWidth: `${120 + days.length * 190}px` }}>
            <tbody>
              {coachList.map((coach) => {
                const coachRows = rows.filter((r) => n(r.CoachId) === coach.id);
                const times = [...new Set(coachRows.map((r) => s(r.PrivateSessionTime)))].filter(Boolean).sort();
                const total = coachRows.filter((r) => n(r.PrivateSessionId) > 0).length;
                const remarksOnly = coachRows.filter((r) => n(r.PrivateSessionId) === 0).length;
                return (
                  <FragmentRows
                    key={coach.id}
                    coach={coach}
                    total={total}
                    remarksOnly={remarksOnly}
                    days={days}
                    times={times}
                    coachRows={coachRows}
                    todayISO={todayISO}
                    locationId={locationId}
                    readOnly={readOnly}
                    canRemark={canRemark}
                    timeRemark={timeRemark}
                    phones={phones}
                    onPhone={showPhone}
                    onSlotRemark={(d, t) => editSlotRemark(coach, d, t)}
                    onCoachRemark={() => editCoachRemark(coach)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      <div className="mt-4 flex flex-wrap gap-3 text-[11px] text-slate-500">
        <LegendSwatch color={COLOR_STARTING} label="0–30% attended" />
        <LegendSwatch color={COLOR_MIDDLE} label="30–70%" />
        <LegendSwatch color={COLOR_ENDING} label="≥70% / ending" />
        <LegendSwatch color={COLOR_CANCELLED} label="Cancelled" />
        <LegendSwatch color="#eeebd2" label="Freeze" />
        <LegendSwatch color={COLOR_EMPTY} label="Free time" />
        <span className="flex items-center gap-1"><span className="inline-block w-4 h-3 border-2 border-dotted border-[#ebeb08]" /> made up later</span>
        <span className="flex items-center gap-1"><span className="inline-block w-4 h-3 border-2 border-dotted border-green-600" /> is a makeup</span>
        <span className="flex items-center gap-1"><span className="inline-block w-4 h-3 border-2 border-[#e60650]" /> merged slot</span>
      </div>

      {remarkEdit && (
        <RemarkModal
          target={remarkEdit}
          onSave={(text) => saveRemark(remarkEdit, text)}
          onClose={() => setRemarkEdit(null)}
        />
      )}
    </div>
  );
}

function FragmentRows({
  coach, total, remarksOnly, days, times, coachRows, todayISO, locationId, readOnly, canRemark,
  timeRemark, phones, onPhone, onSlotRemark, onCoachRemark,
}: {
  coach: { name: string; id: number; remark: string };
  total: number;
  remarksOnly: number;
  days: string[];
  times: string[];
  coachRows: Row[];
  todayISO: string;
  locationId: number;
  readOnly: boolean;
  canRemark: boolean;
  timeRemark: (coachId: number, dateStr: string, time: string) => string;
  phones: Record<number, string>;
  onPhone: (studentId: number) => void;
  onSlotRemark: (dateStr: string, time: string) => void;
  onCoachRemark: () => void;
}) {
  return (
    <>
      {/* Coach band */}
      <tr>
        <td className="bg-[#dce7f4] p-2" />
        <td colSpan={days.length} className="bg-[#dce7f4] p-2 text-sm font-bold text-slate-800">
          {coach.name}
          {coach.remark && (
            <span title={coach.remark} className="inline-flex align-middle ml-1">
              <StickyNote className="size-5 text-amber-600" />
            </span>
          )}
          {/* Legacy shows the CoachPrivate remark link on read-only views too. */}
          {canRemark && (
            <button
              type="button"
              onClick={onCoachRemark}
              title={coach.remark ? 'Edit coach remark' : 'Add coach remark'}
              className="inline-flex align-middle ml-1 p-1 rounded text-slate-500 hover:text-amber-600 hover:bg-white/80"
            >
              <MessageSquarePlus className="size-5" />
            </button>
          )}
          {coach.remark && <span className="ml-2 font-normal text-xs text-slate-600">{coach.remark}</span>}
          <span className="ml-3 font-normal text-slate-500">
            [Total Sessions = {total}] [Remarks Only = {remarksOnly}]
          </span>
        </td>
      </tr>
      {/* Day header: each day opens the daily attendance for that date + location (legacy OpenWindowForDailyAttendance). */}
      <tr>
        <td className="bg-[#aabacf] p-1.5 text-center font-semibold w-[90px] min-w-[90px]">Time</td>
        {days.map((d) => {
          const dd = new Date(d);
          const iso = d.slice(0, 10);
          const isToday = iso === todayISO;
          const label = `${DOW[dd.getDay()]} ${String(dd.getDate()).padStart(2, '0')}`;
          return (
            <td
              key={d}
              className={`p-1.5 text-center font-semibold ${isToday ? 'bg-[#555555] text-white border-2 border-black' : 'bg-[#aabacf]'}`}
            >
              {readOnly ? label : (
                <Link {...NEW_TAB}
                  to={`/pr-attendance?date=${iso}&locationId=${locationId}`}
                  title="Open daily attendance for this day"
                  className={`hover:underline ${isToday ? 'text-white' : 'text-slate-800'}`}
                >
                  {label}
                </Link>
              )}
            </td>
          );
        })}
      </tr>
      {/* Time rows */}
      {times.map((t) => (
        <tr key={`${coach.id}-${t}`}>
          <td className="bg-[#88abd6] p-1.5 text-center font-semibold text-[13px]">{t}</td>
          {days.map((d) => {
            const sessions = coachRows.filter(
              (r) => s(r.PrivateSessionTime) === t && s(r.PrivateSessionDate) === d
            );
            const real = sessions.filter((r) => n(r.PrivateSessionId) > 0);
            // Legacy paints both a free-time row (PrivateSessionId 0) and a slot
            // with no row at all as an empty cell with the slot-remark link.
            const free = real.length === 0;
            const remark = timeRemark(coach.id, d, t);
            return (
              <td
                key={d}
                className="border border-slate-300 p-0.5 align-top w-[190px] min-w-[190px]"
                style={{
                  backgroundColor: free ? COLOR_EMPTY : undefined,
                  ...mergedBorder(real),
                }}
              >
                {free && (
                  <div className="p-1 text-[10px] text-slate-600 flex items-start gap-1">
                    {/* Legacy: a free-time row's remark link is hidden when read-only,
                        a slot with no row at all always has it. */}
                    {canRemark && (sessions.length === 0 || !readOnly) && (
                      <button type="button" onClick={() => onSlotRemark(d, t)} title={remark ? 'Edit slot remark' : 'Add slot remark'} className="p-0.5 rounded hover:bg-white/80">
                        <MessageSquarePlus className={`size-4 ${remark ? 'text-amber-600' : 'text-slate-400'} hover:text-amber-600`} />
                      </button>
                    )}
                    <span>{remark}</span>
                  </div>
                )}
                {real.map((r, i) => (
                  <div key={i} className="rounded p-1 mb-0.5" style={{ ...boxStyle(r), ...boxBorder(r) }}>
                    <Link {...NEW_TAB}
                      to={`/students/${n(r.Std1ID)}`}
                      title="Open student page"
                      className="font-bold text-[12px] uppercase hover:underline"
                      style={{ color: n(r.DuePercent) > 0 ? '#dc2626' : '#000' }}
                    >
                      {s(r.STD1)}
                    </Link>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span
                        title={r.PrivateSessionAttended === true ? 'Attended' : 'Not attended'}
                        className={`inline-block w-2.5 h-2.5 rounded-full border ${
                          r.PrivateSessionAttended === true
                            ? 'bg-emerald-500 border-emerald-700'
                            : 'bg-red-500 border-red-700'
                        }`}
                      />
                      {readOnly ? (
                        <span>Att {n(r.CountAttended)}/{n(r.PackageNumberOfSessions)}</span>
                      ) : (
                        <Link {...NEW_TAB} to={`/privates/${n(r.PackageId)}`} title="Open package" className="hover:underline">
                          Att {n(r.CountAttended)}/{n(r.PackageNumberOfSessions)}
                        </Link>
                      )}
                      {/* Legacy "Due x%" opens the add-payment popup (plain text when read-only). */}
                      {readOnly ? (
                        <span className={n(r.DuePercent) > 0 ? 'text-red-600 font-semibold' : ''}>
                          Due {n(r.DuePercent)}%
                        </span>
                      ) : (
                        <Link {...NEW_TAB}
                          to={`/pr-payments/new?packageId=${n(r.PackageId)}`}
                          title="Add payment"
                          className={`hover:underline ${n(r.DuePercent) > 0 ? 'text-red-600 font-semibold' : ''}`}
                        >
                          Due {n(r.DuePercent)}%
                        </Link>
                      )}
                    </div>
                    {/* Legacy strRemarks = slot remark + " " + session remarks (only when longer than 1 char). */}
                    {(() => {
                      const own = s(r.PrivateSessionRemarks).length > 1 ? s(r.PrivateSessionRemarks) : '';
                      return (own || remark) ? (
                        <div className="text-[10px] text-slate-700 mt-0.5">
                          {[remark, own].filter(Boolean).join(' ')}
                        </div>
                      ) : null;
                    })()}
                    <div className="flex gap-1 mt-0.5">
                      {s(r.PAckagelevel) && (
                        <span className="text-[9px] font-semibold bg-white/60 rounded px-1">{s(r.PAckagelevel)}</span>
                      )}
                      {/* Legacy follow-up icon opens the package, also on read-only views. */}
                      {s(r.PackageFollowUp) && (
                        <Link {...NEW_TAB} to={`/privates/${n(r.PackageId)}`} title="Open package"
                          className="text-[9px] font-semibold bg-white/60 rounded px-1 hover:underline">
                          {s(r.PackageFollowUp)}
                        </Link>
                      )}
                    </div>
                    {/* Actions: package + add payment (hidden in read-only), slot remark
                        (legacy shows it on read-only views too), phone */}
                    <div className="flex items-center gap-0.5 mt-1 -ml-1">
                      {!readOnly && (
                        <>
                          <Link {...NEW_TAB} to={`/privates/${n(r.PackageId)}`} title="Open package" className="p-1 rounded hover:bg-white/80">
                            <Package className="size-5 text-slate-600 hover:text-[#1e5c97]" />
                          </Link>
                          <Link {...NEW_TAB} to={`/pr-payments/new?packageId=${n(r.PackageId)}`} title="Add payment" className="p-1 rounded hover:bg-white/80">
                            <CreditCard className={`size-5 ${n(r.DuePercent) > 0 ? 'text-red-600' : 'text-slate-600'} hover:text-[#1e5c97]`} />
                          </Link>
                        </>
                      )}
                      {canRemark && (
                        <button type="button" onClick={() => onSlotRemark(d, t)} title={remark ? 'Edit slot remark' : 'Add slot remark'} className="p-1 rounded hover:bg-white/80">
                          <MessageSquarePlus className={`size-5 ${remark ? 'text-amber-600' : 'text-slate-600'} hover:text-amber-600`} />
                        </button>
                      )}
                      <button type="button" onClick={() => onPhone(n(r.Std1ID))} title="Show phone" className="p-1 rounded hover:bg-white/80">
                        <Phone className="size-5 text-slate-600 hover:text-[#1e5c97]" />
                      </button>
                      {phones[n(r.Std1ID)] && (
                        <span className="text-[9px] font-semibold text-[#1e5c97] bg-white/70 rounded px-1">
                          {phones[n(r.Std1ID)]}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

// Inline replacement for the legacy Remarks.aspx popup (multi-line text, Save Changes).
function RemarkModal({ target, onSave, onClose }: {
  target: RemarkTarget;
  onSave: (text: string) => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState(target.initial);
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onMouseDown={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-bold text-slate-800">{target.title}</p>
          <button type="button" onClick={onClose} title="Close">
            <X className="size-4 text-slate-400 hover:text-slate-600" />
          </button>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="Remarks"
          className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e5c97]/40"
        />
        <p className="text-[11px] text-slate-400 mt-1">Leave the text empty to clear the remark.</p>
        <div className="flex justify-end gap-2 mt-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => { setBusy(true); try { await onSave(text); } finally { setBusy(false); } }}
            className="btn-grad rounded-lg px-4 py-1.5 text-xs font-semibold disabled:opacity-60"
          >
            {busy ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="inline-block w-4 h-3 rounded-sm border border-slate-300" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

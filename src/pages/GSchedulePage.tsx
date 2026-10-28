import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, AlertCircle, Search, AlertTriangle, OctagonX, Phone, Cake, StickyNote, MessageSquarePlus, Plus } from 'lucide-react';
import { apiRequest, getStoredUser } from '../api/portalApi';
import { useUrlState } from '../lib/urlState';
import { fmtDate as toDMY } from '../lib/dates';
import { coachStats, scheduleTotals } from '../lib/gscheduleStats';
import { PageHero } from '../components/PageHero';
import { useAccess } from '../components/AccessProvider';

// Group Schedule = RegistrationsListView.aspx: timeslot rows × coach columns
// from P_Registration_SelectView, legacy header counters, per-coach summary,
// cell colours, and the per-cell / per-student actions (class, attendance,
// remarks, registration, add payment, phone, birthday).

type Row = Record<string, unknown>;

interface GroupData {
  timeslots: Row[];
  coaches: Row[];
  rows: Row[];
  studentsPerClass: number;
  semester: Row | null;
  counts: { active: number; stopped: number; sumTimes: number };
}

// Legacy cell colors keyed by student count (RegistrationsListView.aspx.cs,
// compared against the hardcoded 5-per-class).
const COLOR_CAP = 5;
function cellColor(count: number): string {
  if (count > COLOR_CAP) return '#80a9ff';
  if (count === 5) return '#99bbff';
  if (count === 4) return '#b3ccff';
  if (count === 3) return '#ccddff';
  if (count === 2) return '#e5eeff';
  if (count === 1) return '#e9e9f5';
  return '#ffffff';
}

const s = (v: unknown) => (v == null ? '' : String(v));
const n = (v: unknown) => (v == null ? 0 : Number(v));
const semId = (r: Row) => n(r.SemesterId ?? r.SemesterID);
const pad2 = (x: number) => String(x).padStart(2, '0');
const dmyFull = (d: Date) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;

// Legacy: the DOB moved into this year (AddYears), shown within 6 days of now.
function isBirthdayNear(dob: unknown): boolean {
  const t = s(dob);
  if (t.length <= 2) return false;
  const d = new Date(t);
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  const thisYear = new Date(now.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes());
  return Math.abs((now.getTime() - thisYear.getTime()) / 86400000) <= 6;
}

// Legacy coach-name cleanup in the cells ("A-Name" → "Name").
const coachShort = (c: string) => c.replace(/[A-F]-/g, '');

export function GSchedulePage() {
  const user = getStoredUser();
  const userType = (user?.userType || '').toLowerCase();
  const locationLocked = (userType === 'user' || userType === 'guest') && !!user?.primaryLocationId;
  const access = useAccess();

  const [locations, setLocations] = useState<{ locationId: number; locationNickName: string | null }[]>([]);
  // Everyone opens scoped to their own location; only locked types can't change it.
  // Filters live in the URL so leaving the schedule and coming back restores them.
  const [locationId, setLocationId] = useUrlState('locationId', user?.primaryLocationId ?? 0);
  const [semesters, setSemesters] = useState<Row[]>([]);
  const [semesterId, setSemesterId] = useUrlState('semesterId', 0);
  const [search, setSearch] = useUrlState('search', '');
  const [data, setData] = useState<GroupData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Legacy _AccessReadOnly: guests always, a "user" looking at another location.
  // (A superuser's session location follows the picker, so it never applies.)
  const readOnly = userType === 'guest' || (userType === 'user' && locationId !== (user?.primaryLocationId ?? 0));
  const canAct = !readOnly && user?.canSave !== false;
  const canAddNew = canAct && access.canEdit('/registrations');

  useEffect(() => {
    apiRequest<{ locations: { locationId: number; locationNickName: string | null }[] }>(
      '/api/portal/students/lookups'
    ).then((lk) => setLocations(lk.locations)).catch(() => {});
  }, []);

  // Location → semester list (Semester_Select_ByLocation) defaulting to the
  // legacy Semester_Select_Current(location).Rows[0]: the first current semester
  // in proc order. On the first run keep a semester restored from the URL
  // (coming back from a detail page); later location changes re-default.
  const restoredSemester = useRef(semesterId);
  useEffect(() => {
    apiRequest<{ semesters: Row[]; currentSemesterId: number }>(
      `/api/portal/schedule/semesters?locationId=${locationId}`
    )
      .then((r) => {
        setSemesters(r.semesters);
        const keep = restoredSemester.current;
        restoredSemester.current = 0;
        const firstCurrent = locationId ? r.semesters.find((x) => x.SemesterCurrent === true) : undefined;
        if (keep && r.semesters.some((x) => semId(x) === keep)) setSemesterId(keep);
        else if (firstCurrent) setSemesterId(semId(firstCurrent));
        else if (r.currentSemesterId) setSemesterId(r.currentSemesterId);
        else if (r.semesters.length) setSemesterId(semId(r.semesters[0]));
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load semesters.'));
  }, [locationId]); // eslint-disable-line react-hooks/exhaustive-deps -- URL setter isn't identity-stable; run on location only

  const [shownPhones, setShownPhones] = useState<Set<string>>(new Set());
  const togglePhone = (key: string) =>
    setShownPhones((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  // Remark editor dialog, one for students, one for classes (tbl_Remarks types).
  const [remarkModal, setRemarkModal] = useState<{
    type: 'Student' | 'Class'; id: number; name: string; value: string;
  } | null>(null);
  const [remarkSaving, setRemarkSaving] = useState(false);

  async function saveRemark(value: string) {
    if (!remarkModal) return;
    setRemarkSaving(true);
    try {
      await apiRequest('/api/portal/schedule/remark', {
        method: 'POST',
        body: JSON.stringify({ remarkType: remarkModal.type, remarkTypeId: remarkModal.id, remark: value }),
      });
      setRemarkModal(null);
      load(semesterId, search);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the remark.');
      setRemarkModal(null);
    } finally {
      setRemarkSaving(false);
    }
  }

  const load = useCallback((semId: number, q: string) => {
    if (!semId) return;
    setLoading(true);
    setError('');
    apiRequest<GroupData>(`/api/portal/schedule/group?semesterId=${semId}&searchFor=${encodeURIComponent(q)}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load schedule.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(semesterId, search); }, [semesterId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── derived matrix helpers ────────────────────────────────────────────────
  const coachNames = (data?.coaches ?? []).map((c) => s(c.CoachName)).filter(Boolean);

  function cellRows(dayid: unknown, classTime: unknown, coach: string): Row[] {
    return (data?.rows ?? []).filter(
      (r) => s(r.dayid) === s(dayid) && s(r.ClassTime) === s(classTime) && s(r.CoachName) === coach
    );
  }

  // Legacy per-coach summary + totals (SemesterStudentsPerClass from result set 4).
  const spc = data?.studentsPerClass || COLOR_CAP;
  const coachSummary = (coach: string) => coachStats(data?.rows ?? [], coach, spc, data?.timeslots ?? []);
  const totals = scheduleTotals(data?.rows ?? [], coachNames, spc, data?.timeslots ?? []);

  // Legacy ltrRemark: "[w of W Weeks] [dd/MM/yyyy to dd/MM/yyyy]" while the
  // semester runs, else "W Weeks [dd/MM/yyyy to dd/MM/yyyy]".
  function weeksRemark(): string {
    const sem = data?.semester;
    if (!sem) return '';
    const start = new Date(s(sem.SemesterStart));
    const end = new Date(s(sem.SemesterEnd));
    const weeks = n(sem.SemesterNumberOfWeeks);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return '';
    const now = new Date();
    let head = `${weeks} Weeks `;
    if (now > start && now < end) {
      const days = Math.floor((now.getTime() - start.getTime()) / 86400000);
      head = `[${Math.trunc((days + 6) / 7)} of ${weeks} Weeks]`;
    }
    return `${head} [${dmyFull(start)} to ${dmyFull(end)}]`;
  }

  const counts = data?.counts;
  const classLink = (classId: number) => `/classes/${classId}`;
  const payLink = (r: Row) => `/payments/new?${new URLSearchParams({
    studentId: String(n(r.studentid)), studentName: s(r.StudentName), semesterId: String(semesterId),
  })}`;

  const selectCls =
    'rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600 focus:outline-none focus:ring-2 focus:ring-[#1e5c97]/40';

  return (
    <div className="p-6">
      <PageHero
        compact
        title="Group Schedule"
        subtitle={weeksRemark() || 'Group schedule by coach and time slot'}
        slide={3}
        right={
          <div className="flex items-center gap-2">
            {/* Legacy LblResultCounts */}
            {data && counts && (
              <div className="text-xs font-semibold bg-slate-100 border border-slate-200 text-[#1e5c97] rounded-lg px-3 py-1.5 flex flex-wrap gap-x-2">
                {totals.classes > 0 && <span>[{totals.classes} Classes]</span>}
                {counts.active > 0 && counts.stopped > 0 && (
                  <span>
                    [ <span className="text-emerald-600">{counts.active} Active</span>
                    {' + '}<span className="text-red-500">{counts.stopped} Stopped</span>
                    {' = '}{counts.active + counts.stopped} Regs ]
                  </span>
                )}
                {counts.active > 0 && counts.stopped === 0 && <span>[ {counts.active} Registrations]</span>}
                {counts.sumTimes > 0 && <span>[{counts.sumTimes} Places]</span>}
                {totals.avail > 0 && <span>[{totals.avail} Avb Places]</span>}
                {totals.avail > 0 && <span>[{totals.pct} %]</span>}
              </div>
            )}
            {/* Legacy BtnAddNew (disabled when read-only) */}
            {canAddNew && (
              <Link to="/registrations/new" className="btn-grad flex items-center gap-1.5 rounded-lg text-xs font-semibold px-3 py-1.5">
                <Plus className="size-3.5" /> Add New
              </Link>
            )}
          </div>
        }
      />

      {/* Filters */}
      <form
        onSubmit={(e) => { e.preventDefault(); load(semesterId, search); }}
        className="bg-white rounded-2xl border border-slate-100 shadow-sm p-3 mb-4 flex flex-wrap items-center gap-2"
      >
        <div className="relative">
          <Search className="size-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search student…"
            className="w-52 rounded-lg border border-slate-200 pl-8 pr-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#1e5c97]/40"
          />
        </div>
        <select
          value={locationId}
          onChange={(e) => setLocationId(Number(e.target.value))}
          disabled={locationLocked}
          className={`${selectCls} disabled:bg-slate-50 disabled:text-slate-400`}
        >
          <option value={0}>All locations</option>
          {locations.map((l) => (
            <option key={l.locationId} value={l.locationId}>{l.locationNickName}</option>
          ))}
        </select>
        <select value={semesterId} onChange={(e) => setSemesterId(Number(e.target.value))} className={`${selectCls} min-w-44`}>
          {semesters.length === 0 && <option value={0}>No semesters found</option>}
          {semesters.map((sm) => {
            const id = semId(sm);
            return <option key={id} value={id}>{s(sm.SemesterName)}</option>;
          })}
        </select>
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

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="size-8 text-[#1e5c97] animate-spin" />
        </div>
      ) : !data || (data.timeslots ?? []).length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm py-16 text-center">
          <p className="text-sm font-medium text-slate-500">No schedule to show</p>
          <p className="text-xs text-slate-400 mt-1">
            {semesters.length === 0
              ? 'No semesters found for this location, pick a different location.'
              : 'Pick a semester with classes, or clear the search filter.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 shadow-sm">
          <table className="w-full text-xs border-collapse" style={{ minWidth: `${110 + coachNames.length * 200}px` }}>
            <thead>
              {/* Coach band, same chrome as the Private Schedule coach rows */}
              <tr>
                <th className="sticky left-0 z-10 bg-[#aabacf] p-1.5 text-center font-semibold w-[90px] min-w-[90px] text-slate-800">
                  Smry
                </th>
                {coachNames.map((coach) => {
                  const sum = coachSummary(coach);
                  return (
                    <th key={coach} className="bg-[#dce7f4] p-2 w-[200px] min-w-[200px] align-top text-left">
                      {sum.classes > 0 && (
                        <>
                          <span className="text-sm font-bold text-slate-800">{coach}</span>{' '}
                          <span className="text-[#1e5c97] font-bold">{sum.pct}%</span>
                          <div className="mt-0.5 text-[10px] font-normal text-slate-500">
                            {sum.classes} Classes - {sum.avail} Av. Places -
                            <br />
                            {sum.students} Students - {sum.places} Places
                          </div>
                        </>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {(data.timeslots ?? []).map((ts, i) => (
                <tr key={i}>
                  <td className="sticky left-0 z-10 bg-[#88abd6] p-1.5 text-center font-semibold text-[13px] text-slate-900 align-middle">
                    {s(ts.ClassDay)}<br />{s(ts.ClassTime)}
                  </td>
                  {coachNames.map((coach) => {
                    const rows = cellRows(ts.dayid, ts.ClassTime, coach);
                    const students = rows.filter((r) => s(r.StudentName).length > 2);
                    const classRow = rows.find((r) => n(r.ClassId) > 0);
                    const classId = n(classRow?.ClassId);
                    const closed = rows.length > 0 && !classRow;
                    const level = rows.length ? s(rows[0].LevelName) : '';
                    const classRemark = rows.length ? s(rows[0].ClassRemark) : '';
                    return (
                      <td key={coach} className="border border-slate-300 p-0.5 align-top">
                        {rows.length > 0 && (
                          <div
                            className="rounded p-1.5 h-full"
                            style={{ backgroundColor: closed ? '#f1f5f9' : cellColor(students.length) }}
                          >
                            <div className={`flex items-center gap-1 flex-wrap ${closed ? 'line-through text-slate-400' : ''}`}>
                              <span className="font-bold underline text-[11px] text-slate-700">{coachShort(coach)}</span>
                              {/* [Level] → the class record (legacy OpenWindowForClass) */}
                              {level && (canAct && classId
                                ? <Link to={classLink(classId)} className="text-[#dd22aa] font-bold text-[12px] hover:underline">[{level}]</Link>
                                : <span className="text-[#1e5c97] font-bold text-[12px]">[{level}]</span>)}
                              {/* [count] → take the attendance of the class's latest session, like
                                  legacy OpenWindowForAttendance (ClassesSessionsAttendanceList.aspx?ClassID=);
                                  an empty cell opens the class instead. */}
                              {canAct && classId
                                ? (
                                  <Link
                                    to={students.length > 0 ? `/classes/${classId}/attendance` : classLink(classId)}
                                    className="font-bold text-red-600 hover:underline"
                                    title={students.length > 0 ? 'Take attendance (latest session)' : 'Open class'}
                                  >
                                    [{students.length}]
                                  </Link>
                                )
                                : <span className="font-bold text-red-600">[{students.length}]</span>}
                              {classId > 0 && canAct && (
                                <button type="button"
                                  onClick={() => setRemarkModal({
                                    type: 'Class',
                                    id: classId,
                                    name: `${coach} · ${s(ts.ClassDay)} ${s(ts.ClassTime)}`,
                                    value: classRemark,
                                  })}
                                  title={classRemark ? `Class remark: ${classRemark}` : 'Add class remark'} className="p-0.5 rounded hover:bg-white/80">
                                  {classRemark
                                    ? <StickyNote className="size-5 text-amber-600" />
                                    : <MessageSquarePlus className="size-5 text-slate-400 hover:text-amber-600" />}
                                </button>
                              )}
                              {(!canAct || !classId) && classRemark && (
                                <span title={classRemark}><StickyNote className="size-3.5 text-amber-600" /></span>
                              )}
                              {students.length === 6 && <span title="6 Students, Watch out"><AlertTriangle className="size-3.5 text-amber-500" /></span>}
                              {students.length > 6 && <span title="TOO MUCH STUDENTS"><OctagonX className="size-3.5 text-red-600" /></span>}
                              {closed && <span className="text-[10px] font-semibold text-slate-400 no-underline">CLOSED</span>}
                            </div>
                            <div className="mt-1 space-y-0.5">
                              {students.map((r, k) => {
                                const due = n(r.DuePercent);
                                const phoneKey = `${i}_${coach}_${k}`;
                                return (
                                  <div key={k} className="flex items-center gap-1 whitespace-nowrap">
                                    <span
                                      title={due > 0 ? `Due ${due}%` : 'Paid'}
                                      className={`inline-block w-2 h-2 rounded-full border shrink-0 ${
                                        due > 0 ? 'bg-red-500 border-red-700' : 'bg-emerald-500 border-emerald-700'
                                      }`}
                                    />
                                    {/* Name → the registration record */}
                                    {canAct ? (
                                      <Link
                                        to={`/registrations/${n(r.RegistrationId)}`}
                                        className="truncate max-w-[120px] hover:underline hover:text-[#1e5c97]"
                                        title="Open registration"
                                      >
                                        {s(r.StudentName)}
                                      </Link>
                                    ) : (
                                      <span className="truncate max-w-[120px]">{s(r.StudentName)}</span>
                                    )}
                                    {/* "D: %x" when due, "$" when paid → in-app payment form */}
                                    {canAct ? (
                                      <Link
                                        to={payLink(r)}
                                        title={`Add payment${r.DueAmount != null ? `, due ${s(r.DueAmount)}` : ''}`}
                                        className={`font-semibold hover:underline ${due > 0 ? 'text-red-600' : 'text-emerald-700'}`}
                                      >
                                        {due > 0 ? `D: %${Math.trunc(due)}` : '$'}
                                      </Link>
                                    ) : (
                                      <span className={`font-semibold ${due > 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                                        {due > 0 ? `D: %${Math.trunc(due)}` : '$'}
                                      </span>
                                    )}
                                    {canAct && (
                                      <button type="button" onClick={() => togglePhone(phoneKey)} title="Show phone" className="p-0.5 rounded hover:bg-white/80">
                                        <Phone className="size-4 text-slate-500 hover:text-[#1e5c97]" />
                                      </button>
                                    )}
                                    {canAct && shownPhones.has(phoneKey) && (
                                      <span className="text-[10px] font-semibold text-[#1e5c97] bg-[#e8f0f8] rounded px-1">
                                        {s(r.Contact).replace(/,/g, '')}
                                      </span>
                                    )}
                                    {isBirthdayNear(r.DOB) && (
                                      <span title={toDMY(r.DOB)}>
                                        <Cake className="size-4 text-pink-500" />
                                      </span>
                                    )}
                                    {/* Remark: view + edit (empty state shows an add icon) */}
                                    {canAct && (
                                      <button type="button"
                                        onClick={() => setRemarkModal({ type: 'Student', id: n(r.studentid), name: s(r.StudentName), value: s(r.StudentRemark) })}
                                        title={s(r.StudentRemark) || 'Add remark'} className="p-0.5 rounded hover:bg-white/80">
                                        {s(r.StudentRemark).length > 1
                                          ? <StickyNote className="size-4 text-amber-600" />
                                          : <MessageSquarePlus className="size-4 text-slate-300 hover:text-amber-600" />}
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Remark editor */}
      {remarkModal && (
        <RemarkDialog
          modal={remarkModal}
          saving={remarkSaving}
          onSave={saveRemark}
          onClose={() => setRemarkModal(null)}
        />
      )}

      {/* Legend, same pattern as the Private Schedule */}
      <div className="mt-4 flex flex-wrap gap-3 text-[11px] text-slate-500">
        <LegendSwatch color="#ffffff" label="Empty" />
        <LegendSwatch color="#e9e9f5" label="1 student" />
        <LegendSwatch color="#e5eeff" label="2" />
        <LegendSwatch color="#ccddff" label="3" />
        <LegendSwatch color="#b3ccff" label="4" />
        <LegendSwatch color="#99bbff" label="5 (full)" />
        <LegendSwatch color="#80a9ff" label="Over capacity" />
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 border border-emerald-700" /> paid ($)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-red-500 border border-red-700" /> payment due (D: %)
        </span>
        <span className="flex items-center gap-1"><AlertTriangle className="size-3 text-amber-500" /> 6 students</span>
        <span className="flex items-center gap-1"><OctagonX className="size-3 text-red-600" /> over 6</span>
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

function RemarkDialog({ modal, saving, onSave, onClose }: {
  modal: { type: 'Student' | 'Class'; id: number; name: string; value: string };
  saving: boolean;
  onSave: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(modal.value);
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm font-bold text-slate-800 flex items-center gap-2 mb-1">
          <StickyNote className="size-4 text-amber-600" />
          {modal.type === 'Class' ? 'Class remark' : 'Student remark'}
        </p>
        <p className="text-xs text-slate-500 mb-3 truncate">{modal.name}</p>
        <textarea
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={3}
          placeholder="Write the remark… leave empty to clear it."
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e5c97]/40 mb-3"
        />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-200 text-sm font-semibold px-4 py-2">
            Cancel
          </button>
          {modal.value && (
            <button onClick={() => onSave('')} disabled={saving}
              className="rounded-lg border border-red-200 text-red-600 text-sm font-semibold px-4 py-2 hover:bg-red-50 disabled:opacity-50">
              Clear remark
            </button>
          )}
          <button onClick={() => onSave(value)} disabled={saving}
            className="flex items-center gap-1.5 rounded-lg bg-[#1e5c97] hover:bg-[#17497a] text-white text-sm font-semibold px-5 py-2 disabled:opacity-50">
            {saving ? <Loader2 className="size-4 animate-spin" /> : null} Save
          </button>
        </div>
      </div>
    </div>
  );
}

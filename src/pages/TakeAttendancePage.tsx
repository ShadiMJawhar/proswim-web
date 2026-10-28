// Take Attendance, port of ClassesSessionsAttendanceList.aspx: tap a student to
// flip Present/Absent, set the status / remark / location per row, Save.
// Everything the legacy grid offered is here:
// - header "Class: … on dd/mm/yyyy [RemarksObligatoryForAbsent]", "N Records";
// - Refresh Current Students, Update (save), Export;
// - Bulk Update (status and/or location onto every row, then Update);
// - per row: student (→ attendance details), date, attended, status, make-up
//   info / "Choose Make Up Session" (status MakeUp), remarks, location,
//   DuePercent, Add Payment;
// - row tints: attended green, has make-up lime, make-up visitor from another
//   session yellow and read-only (its location stays editable, as in legacy);
// - classes flagged ClassObligatoryRemarksWhenAbsent refuse to save while a
//   Normal-status absentee has no remark;
// - picking a make-up session saves the grid and reloads it (legacy
//   Refresh_GridView → BtnUpdate).
// Proc: P_Classes_Sessions_Attendance_Select — keys AttendanceId,
// AttendanceSessionId, AttendanceMakeUpSessionID, StudentId, MakeUpDate, Mode.

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Loader2, AlertCircle, Save, Check, X, Users, RefreshCw, CheckCircle2, Download, CreditCard,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import { apiRequest, getStoredUser } from '../api/portalApi';
import { DateInput } from '../components/DateInput';
import { fmtDate as toDMY } from '../lib/dates';
import { PageHero } from '../components/PageHero';
import { SmartBack } from '../components/SmartBack';
import { isoToday } from '../lib/groupClasses';

type Row = Record<string, unknown>;
type Opt = { value: number; label: string };

const STATUSES = ['Normal', 'Late', 'MakeUp', 'No Suit', 'Miss Land Training'];

const num = (r: Row, k: string) => Number(r[k] ?? 0);
const str = (r: Row, k: string) => (r[k] == null ? '' : String(r[k]));
const toIso = (v: unknown) => {
  const d = v ? new Date(String(v)) : null;
  if (!d || isNaN(d.getTime()) || d.getFullYear() < 1901) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

interface Mark { attended: boolean; status: string; remarks: string; locationId: number }

export function TakeAttendancePage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const user = getStoredUser();
  const canSave = user?.canSave !== false && (user?.userType || '').toLowerCase() !== 'guest';

  const [rows, setRows] = useState<Row[]>([]);
  const [marks, setMarks] = useState<Record<number, Mark>>({});
  const [locations, setLocations] = useState<Opt[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [makeupFor, setMakeupFor] = useState<Row | null>(null);
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkLocation, setBulkLocation] = useState(0);
  // Previous / next session of the same class (user, 2026-10-28: quick way to
  // move between a class's sessions when taking attendance from the schedule).
  const [nav, setNav] = useState<{ prev: Row | null; next: Row | null } | null>(null);

  useEffect(() => {
    setNav(null);
    const sid0 = Number(sessionId) || 0;
    if (!sid0) return;
    let live = true;
    const get = (r: Row, k: string) => { const kk = Object.keys(r).find((x) => x.toLowerCase() === k.toLowerCase()); return kk ? r[kk] : undefined; };
    apiRequest<Row>(`/api/portal/edit/session/${sid0}`)
      .then((s0) => {
        const classId = Number(get(s0, 'SessionClassId') ?? 0);
        if (!classId) return [] as Row[];
        return apiRequest<Row[]>(`/api/portal/modules/sessions?classId=${classId}`);
      })
      .then((list) => {
        if (!live) return;
        const all = (Array.isArray(list) ? list : [])
          .map((r) => ({ id: Number(get(r, 'SessionId') ?? 0), date: String(get(r, 'SessionDate') ?? ''), r }))
          .filter((x) => x.id > 0)
          .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
        const i = all.findIndex((x) => x.id === sid0);
        if (i < 0) return;
        setNav({ prev: i > 0 ? all[i - 1].r : null, next: i < all.length - 1 ? all[i + 1].r : null });
      })
      .catch(() => {});
    return () => { live = false; };
  }, [sessionId]);
  const navDate = (r: Row) => { const k = Object.keys(r).find((x) => x.toLowerCase() === 'sessiondate'); return toDMY(k ? r[k] : '', ''); };
  const navId = (r: Row) => { const k = Object.keys(r).find((x) => x.toLowerCase() === 'sessionid'); return Number(k ? r[k] : 0); };

  useEffect(() => {
    apiRequest<{ locations: Opt[] }>('/api/portal/modules/lookups')
      .then((lk) => setLocations(lk.locations ?? []))
      .catch(() => {});
  }, []);

  function hydrate(data: Row[]) {
    setRows(data);
    const m: Record<number, Mark> = {};
    for (const r of data) {
      m[num(r, 'AttendanceId')] = {
        attended: r.AttendanceStudentAttended === true,
        status: str(r, 'AttendanceStatus') || 'Normal',
        remarks: str(r, 'AttendanceRemarks'),
        locationId: num(r, 'AttendanceLocationId'),
      };
    }
    setMarks(m);
  }

  function load() {
    setLoading(true);
    setError('');
    apiRequest<Row[]>(`/api/portal/attendance/session/${sessionId}`)
      .then(hydrate)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the roster.'))
      .finally(() => setLoading(false));
  }
  useEffect(load, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function refreshStudents() {
    setRefreshing(true);
    setError('');
    try {
      hydrate(await apiRequest<Row[]>(`/api/portal/attendance/session/${sessionId}/refresh`, { method: 'POST' }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not refresh the roster.');
    } finally {
      setRefreshing(false);
    }
  }

  const sid = Number(sessionId);
  // Make-up visitors belong to another session: shown read-only (legacy rule).
  const isVisitor = (r: Row) => num(r, 'AttendanceSessionId') !== 0 && num(r, 'AttendanceSessionId') !== sid;

  const header = rows[0];
  const className = header ? str(header, 'ClassName') : '';
  const sessionDate = toDMY(header?.SessionDate, '');
  const remarksRequired = rows.some((r) => r.ClassObligatoryRemarksWhenAbsent === true);
  const locationName = (id: number) => locations.find((l) => l.value === id)?.label ?? '';

  const counts = useMemo(() => {
    let present = 0, absent = 0, total = 0;
    for (const r of rows) {
      if (isVisitor(r)) continue;
      total++;
      if (marks[num(r, 'AttendanceId')]?.attended) present++; else absent++;
    }
    return { present, absent, total };
  }, [rows, marks]); // eslint-disable-line react-hooks/exhaustive-deps

  function setMark(id: number, patch: Partial<Mark>) {
    setMarks((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
    setSavedAt(null);
  }

  function markAll(attended: boolean) {
    setMarks((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        if (isVisitor(r)) continue;
        const id = num(r, 'AttendanceId');
        next[id] = { ...next[id], attended };
      }
      return next;
    });
    setSavedAt(null);
  }

  // Legacy BtnBulkUpate_Click: the chosen status and/or location onto every
  // row (status only where the row is editable); saving is still "Update".
  function bulkUpdate() {
    if (!bulkStatus && !bulkLocation) return;
    setMarks((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        const id = num(r, 'AttendanceId');
        next[id] = {
          ...next[id],
          ...(bulkStatus && !isVisitor(r) ? { status: bulkStatus } : {}),
          ...(bulkLocation ? { locationId: bulkLocation } : {}),
        };
      }
      return next;
    });
    setSavedAt(null);
  }

  /** Legacy BtnUpdate_Click: validate, then one update per row. */
  async function save(): Promise<boolean> {
    // Classes flagged ClassObligatoryRemarksWhenAbsent refuse to save while a
    // Normal-status absentee has no remark.
    if (remarksRequired) {
      const missing = rows.filter((r) => {
        if (isVisitor(r)) return false;
        const m = marks[num(r, 'AttendanceId')];
        return m && !m.attended && m.status.toLowerCase() === 'normal' && m.remarks.trim() === '';
      });
      if (missing.length > 0) {
        setError(`Can not save, Remarks is missing for absent students: ${missing.map((r) => str(r, 'StudentFullName')).join(', ')}`);
        return false;
      }
    }
    setSaving(true);
    setError('');
    try {
      // Every row goes back like the legacy grid; visitors keep their own
      // marks (read-only here) and only their location can have changed.
      const payload = rows.map((r) => ({ attendanceId: num(r, 'AttendanceId'), ...marks[num(r, 'AttendanceId')] }));
      await apiRequest('/api/portal/attendance/save', {
        method: 'POST',
        body: JSON.stringify({ sessionId: sid, marks: payload }),
      });
      setSavedAt(new Date());
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save attendance.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveAndReload() {
    if (await save()) load();
  }

  function exportCsv() {
    const cols = ['Student', 'Date', 'Attended', 'Status', 'MakeupInfo', 'Remarks', 'Location', 'DuePercent'];
    const lines = rows.map((r) => {
      const m = marks[num(r, 'AttendanceId')];
      return [
        str(r, 'StudentFullName'), toDMY(r.SessionDate, ''), m?.attended ? 'True' : 'False', m?.status ?? '',
        str(r, 'MakeupInfo'), m?.remarks ?? '', locationName(m?.locationId ?? 0), str(r, 'DuePercent'),
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',');
    });
    const blob = new Blob([[cols.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const d = new Date();
    a.download = `ClassesSessionsAttendance_${d.getFullYear()}_${String(d.getMonth() + 1).padStart(2, '0')}_${String(d.getDate()).padStart(2, '0')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const smallSel = 'rounded-lg border border-slate-200 bg-white px-1.5 py-1 text-xs disabled:bg-slate-50 disabled:text-slate-400';

  return (
    <div className="p-6 md:p-8 max-w-4xl">
      <SmartBack label="Sessions" fallback="/sessions" />
      <PageHero
        title={className ? `Class: ${className}` : 'Take Attendance'}
        subtitle={[
          sessionDate ? `on ${sessionDate}` : 'Mark who attended',
          remarksRequired ? '[RemarksObligatoryForAbsent]' : '',
          !loading ? `${rows.length} Records` : '',
        ].filter(Boolean).join('  ·  ')}
        slide={2}
      />

      {nav && (nav.prev || nav.next) && (
        <div className="flex items-center gap-2 mb-3 text-sm">
          {nav.prev ? (
            <Link to={`/sessions/${navId(nav.prev)}/attendance`} title="Previous session of this class"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-600 hover:border-[#1e5c97]/40 hover:text-[#1e5c97]">
              <ChevronLeft className="size-4" /> {navDate(nav.prev)}
            </Link>
          ) : <span className="text-xs text-slate-400 px-1">First session</span>}
          <span className="text-xs font-bold uppercase tracking-wide text-slate-400">this class</span>
          {nav.next ? (
            <Link to={`/sessions/${navId(nav.next)}/attendance`} title="Next session of this class"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-600 hover:border-[#1e5c97]/40 hover:text-[#1e5c97]">
              {navDate(nav.next)} <ChevronRight className="size-4" />
            </Link>
          ) : <span className="text-xs text-slate-400 px-1">Latest session</span>}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3 mb-4">
          <AlertCircle className="size-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-40"><Loader2 className="size-8 text-[#1e5c97] animate-spin" /></div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-soft p-8 text-center">
          <Users className="size-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500 mb-4">No attendance rows for this session yet.</p>
          {canSave && (
            <button onClick={refreshStudents} disabled={refreshing}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#1e5c97] hover:bg-[#17497a] text-white text-sm font-semibold px-5 py-2 disabled:opacity-50">
              {refreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              Refresh Current Students
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="text-sm font-bold text-[#1e5c97]">
              {counts.present} present · {counts.absent} absent · {counts.total} students
            </span>
            <div className="flex-1" />
            {canSave && (
              <>
                <button onClick={() => markAll(true)}
                  className="rounded-lg border border-emerald-300 text-emerald-700 text-xs font-bold px-3 py-1.5 hover:bg-emerald-50">
                  All present
                </button>
                <button onClick={() => markAll(false)}
                  className="rounded-lg border border-red-200 text-red-600 text-xs font-bold px-3 py-1.5 hover:bg-red-50">
                  All absent
                </button>
                <button onClick={refreshStudents} disabled={refreshing} title="Sync newly registered students into this session"
                  className="flex items-center gap-1 rounded-lg border border-slate-200 text-slate-600 text-xs font-bold px-3 py-1.5 hover:border-[#1e5c97]/40 disabled:opacity-50">
                  {refreshing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                  Refresh Current Students
                </button>
              </>
            )}
            {user?.canExport && (
              <button onClick={exportCsv}
                className="flex items-center gap-1 rounded-lg border border-slate-200 text-[#1e5c97] text-xs font-bold px-3 py-1.5 hover:bg-slate-50">
                <Download className="size-3.5" /> Export
              </button>
            )}
          </div>

          {/* Bulk Update (legacy txtStatusBulk + ddlLocationsBulk) */}
          {canSave && (
            <div className="flex flex-wrap items-center gap-2 mb-3 bg-white rounded-xl border border-slate-100 p-2.5 text-xs text-slate-500">
              Bulk Update:
              <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)} className={smallSel}>
                <option value="">Not Selected</option>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={bulkLocation} onChange={(e) => setBulkLocation(Number(e.target.value))} className={smallSel}>
                <option value={0}>Not Selected</option>
                {locations.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
              <button onClick={bulkUpdate} disabled={!bulkStatus && !bulkLocation}
                className="rounded-lg border border-[#1e5c97]/30 text-[#1e5c97] font-bold px-3 py-1 hover:bg-slate-50 disabled:opacity-40">
                Bulk Update
              </button>
              <span className="text-slate-400">After Bulk update, you need to UPDATE (Save).</span>
            </div>
          )}

          {/* Roster, tap the row to flip Present/Absent */}
          <div className="space-y-2 mb-24">
            {rows.map((r) => {
              const id = num(r, 'AttendanceId');
              const m = marks[id];
              if (!m) return null;
              const visitor = isVisitor(r);
              const makeupInfo = str(r, 'MakeupInfo');
              const hasMakeup = makeupInfo.length > 1;
              const due = r.DuePercent;
              return (
                <div key={id}
                  className={`rounded-xl border p-3 transition-colors ${
                    visitor ? 'bg-[#FAFAB4]/70 border-amber-200'
                    : hasMakeup ? 'bg-[#C8F06E]/40 border-lime-300'
                    : m.attended ? 'bg-[#00CC66]/15 border-emerald-200'
                    : 'bg-red-50/70 border-red-200'
                  }`}>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      disabled={visitor || !canSave}
                      onClick={() => setMark(id, { attended: !m.attended })}
                      className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-white shadow-sm transition-transform active:scale-90 disabled:opacity-50 ${
                        m.attended ? 'bg-emerald-500' : 'bg-red-400'
                      }`}
                      title={m.attended ? 'Mark absent' : 'Mark present'}
                    >
                      {m.attended ? <Check className="size-5" /> : <X className="size-5" />}
                    </button>
                    <div className="flex-1 min-w-40">
                      <Link
                        to={`/attendance-details?search=${encodeURIComponent(str(r, 'StudentFullName'))}`}
                        target="_blank"
                        className="text-sm font-bold text-slate-800 hover:text-[#1e5c97] hover:underline truncate block"
                        title="Attendance details"
                      >
                        {str(r, 'StudentFullName')}
                      </Link>
                      <p className="text-xs text-slate-500">
                        {toDMY(r.SessionDate, '')}
                        {' · '}
                        {visitor ? 'Make-up visitor from another session' : m.attended ? 'Present' : 'Absent'}
                        {due != null && due !== '' && <span className={Number(due) > 0 ? 'text-amber-700 font-semibold' : ''}> · Due {String(due)}%</span>}
                      </p>
                    </div>
                    <select
                      value={m.status}
                      disabled={visitor || !canSave}
                      onChange={(e) => setMark(id, { status: e.target.value })}
                      className={`shrink-0 rounded-lg border px-1.5 py-1 text-xs disabled:opacity-70 ${
                        m.status !== 'Normal' ? 'border-amber-300 bg-amber-50 font-semibold' : 'border-slate-200 bg-white/70'
                      }`}
                      title="Status"
                    >
                      {STATUSES.map((s2) => <option key={s2} value={s2}>{s2}</option>)}
                      {!STATUSES.includes(m.status) && <option value={m.status}>{m.status}</option>}
                    </select>
                    <select
                      value={m.locationId}
                      disabled={!canSave}
                      onChange={(e) => setMark(id, { locationId: Number(e.target.value) })}
                      className={`${smallSel} shrink-0 max-w-32`}
                      title="Location"
                    >
                      <option value={0}>Not Selected</option>
                      {locations.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                    </select>
                    <Link
                      to={`/payments/new?studentId=${num(r, 'StudentId')}&studentName=${encodeURIComponent(str(r, 'StudentFullName'))}`}
                      target="_blank"
                      className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-[#1e5c97] hover:underline"
                      title="Add Payment"
                    >
                      <CreditCard className="size-3.5" /> Add Payment
                    </Link>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {/* MakeupInfo link (opens the make-up picker on the current one), or
                        "Choose Make Up Session" once the status is MakeUp (legacy txtStatus_Change). */}
                    {hasMakeup ? (
                      <button
                        disabled={visitor || !canSave}
                        onClick={() => setMakeupFor(r)}
                        className="shrink-0 text-xs font-semibold text-lime-800 hover:underline disabled:no-underline disabled:cursor-default"
                        title={visitor ? undefined : 'Change the make-up session'}
                      >
                        {makeupInfo}
                      </button>
                    ) : !visitor && canSave && m.status.toLowerCase() === 'makeup' ? (
                      <button
                        onClick={() => setMakeupFor(r)}
                        className="shrink-0 rounded-lg border border-lime-300 bg-lime-50 px-2 py-1 text-xs font-semibold text-lime-700 hover:bg-lime-100"
                      >
                        Choose Make Up Session
                      </button>
                    ) : null}
                    <input
                      value={m.remarks}
                      disabled={visitor || !canSave}
                      onChange={(e) => setMark(id, { remarks: e.target.value })}
                      placeholder={remarksRequired && !m.attended ? 'Remark required for absence…' : 'Remarks…'}
                      className={`flex-1 min-w-40 rounded-lg border px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#1e5c97]/40 disabled:bg-white/50 ${
                        remarksRequired && !visitor && !m.attended && m.status.toLowerCase() === 'normal' && m.remarks.trim() === ''
                          ? 'border-red-300' : 'border-slate-200'
                      }`}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Sticky save bar */}
          {canSave && (
            <div className="fixed bottom-0 left-0 right-0 md:left-60 bg-white/95 backdrop-blur border-t border-slate-200 px-6 py-3 flex items-center gap-3 z-20">
              <span className="text-sm text-slate-500">
                {counts.present}/{counts.total} present
              </span>
              {savedAt && (
                <span className="flex items-center gap-1 text-sm text-emerald-700">
                  <CheckCircle2 className="size-4" /> Saved {savedAt.toLocaleTimeString()}
                </span>
              )}
              <div className="flex-1" />
              <button onClick={saveAndReload} disabled={saving}
                className="flex items-center gap-2 rounded-xl bg-[#1e5c97] hover:bg-[#17497a] text-white text-sm font-bold px-8 py-2.5 disabled:opacity-50">
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                Update
              </button>
            </div>
          )}
        </>
      )}

      {makeupFor && (
        <MakeupModal
          row={makeupFor}
          onClose={() => setMakeupFor(null)}
          // Legacy: the popup refreshes its opener via BtnUpdate, i.e. the grid
          // is saved (with the MakeUp status just picked) and reloaded.
          onAssigned={() => { setMakeupFor(null); void saveAndReload(); }}
        />
      )}
    </div>
  );
}

// /classes/:classId/attendance, legacy ClassesSessionsAttendanceList.aspx?ClassID=
// (opened from the registrations list): jump to the class's latest session,
// or to the sessions list when it has none.
export function ClassLatestAttendanceRedirect() {
  const { classId } = useParams<{ classId: string }>();
  const navigate = useNavigate();
  useEffect(() => {
    apiRequest<{ sessionId: number }>(`/api/portal/attendance/class/${Number(classId) || 0}/last-session`)
      .then((r) => navigate(r.sessionId ? `/sessions/${r.sessionId}/attendance` : '/sessions', { replace: true }))
      .catch(() => navigate('/sessions', { replace: true }));
  }, [classId, navigate]);
  return (
    <div className="flex items-center justify-center h-64"><Loader2 className="size-8 text-[#1e5c97] animate-spin" /></div>
  );
}

// ClassesSessionsAttendanceMakeUp.aspx: student, "MakeUp For: class ON date",
// MakeUp Date (the current make-up's date, else today), MakeUp Session
// (sessions that day in the same semester, "Not Selected" clears it), Save.
// Also opened from the Attendance Details report, whose rows carry the same
// keys (AttendanceId, AttendanceMakeUpSessionID, MakeUpDate, ClassName,
// SessionDate, StudentFullName).
export function MakeupModal({ row, onClose, onAssigned }: {
  row: Row; onClose: () => void; onAssigned: () => void;
}) {
  const attendanceId = num(row, 'AttendanceId');
  const current = num(row, 'AttendanceMakeUpSessionID');
  const [date, setDate] = useState(() => toIso(row.MakeUpDate) || isoToday());
  const [sessions, setSessions] = useState<Row[]>([]);
  const [picked, setPicked] = useState(current);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!date) { setSessions([]); return; }
    setLoading(true);
    setError('');
    apiRequest<Row[]>(`/api/portal/attendance/makeup-sessions?date=${date}&attendanceId=${attendanceId}`)
      .then((s) => {
        setSessions(s);
        // A date change rebinds the list (legacy keeps "Not Selected" unless
        // the current make-up session is in it).
        setPicked((p) => (s.some((x) => num(x, 'SessionId') === p) ? p : 0));
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load sessions.'))
      .finally(() => setLoading(false));
  }, [date, attendanceId]);

  async function saveChanges() {
    setBusy(true);
    setError('');
    try {
      await apiRequest('/api/portal/attendance/makeup', {
        method: 'POST',
        body: JSON.stringify({ attendanceId, makeupSessionId: picked }),
      });
      onAssigned();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not assign the make-up.');
      setBusy(false);
    }
  }

  const original = `${str(row, 'ClassName')}${row.SessionDate ? ` ON ${toDMY(row.SessionDate, '')}` : ''}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-bold text-slate-800">Make-up</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="size-5" /></button>
        </div>
        <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm mb-3">
          <dt className="text-slate-500">Student</dt><dd className="font-semibold text-slate-800">{str(row, 'StudentFullName')}</dd>
          <dt className="text-slate-500">MakeUp For</dt><dd className="text-slate-700">{original}</dd>
          <dt className="text-slate-500 self-center">MakeUp Date</dt>
          <dd>
            <DateInput value={date} onChange={(e) => setDate(e.target.value)}
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e5c97]/40" />
          </dd>
          <dt className="text-slate-500 self-center">MakeUp Session</dt>
          <dd>
            {loading ? <Loader2 className="size-5 text-[#1e5c97] animate-spin" /> : (
              <select value={picked} onChange={(e) => setPicked(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm">
                <option value={0}>Not Selected</option>
                {sessions.map((s) => (
                  <option key={num(s, 'SessionId')} value={num(s, 'SessionId')}>{str(s, 'SessionDesc') || str(s, 'ClassName')}</option>
                ))}
              </select>
            )}
          </dd>
        </dl>
        {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
        <div className="flex justify-end">
          <button onClick={saveChanges} disabled={busy || loading}
            className="btn-grad flex items-center gap-1.5 rounded-lg text-sm font-semibold px-5 py-2 disabled:opacity-60">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

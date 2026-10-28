// Group registration form, port of RegistrationsIndividual.aspx (+ .cs):
// location (locked for "user") → semester (default: the location's upcoming
// semester) → student / classes of that location, times-per-week + kit drive
// the semester price, 8 days into the semester the price comes from
// P_Registration_Cost_Select, discount (amount or %) and variation (amount)
// with the legacy net formula Net = Cost + Variation − Discount − PaidBefore,
// stop panel (edit only), remarks, Save / Save-and-Pay / Delete, and the
// payments + attendance history of the registration's semester.

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Loader2, AlertCircle, Save, Search, X, Calculator,
  CreditCard, Trash2, User,
} from 'lucide-react';
import { apiRequest, getStoredUser } from '../api/portalApi';
import { closeOrGo } from '../lib/history';
import { fmtDate } from '../lib/dates';
import { DateInput } from '../components/DateInput';
import { toast } from '../components/Toast';
import { PageHero } from '../components/PageHero';
import { SmartBack } from '../components/SmartBack';

type Row = Record<string, unknown>;
type Option = { value: number; label: string };
type Picker = { id: number; label: string };

const CLASS_SLOTS = [1, 2, 3, 4, 5, 6, 7] as const;
const TIMES = [1, 2, 3, 4, 5, 6, 7];
// tbl_Semesters price columns by times per week.
const PRICE_COLS = ['', 'SemesterAmountOne', 'SemesterAmountTwo', 'SemesterAmountThree', 'SemesterAmountFour',
  'SemesterAmountFive', 'SemesterAmountSix', 'SemesterAmountSeven'];
const inputCls =
  'w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e5c97]/40 disabled:bg-slate-50 disabled:text-slate-400';

const s = (v: unknown) => (v == null ? '' : String(v));
const n = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0);
const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayIso = () => isoDay(new Date());
const toDateInput = (v: unknown): string => {
  if (!v) return '';
  const d = new Date(String(v));
  if (isNaN(d.getTime()) || d.getFullYear() < 1901) return '';
  return isoDay(d);
};
const semId = (r: Row) => n(r.SemesterId ?? r.SemesterID);
// Legacy "###,###": thousands separators, and 0 prints as empty.
const fmtHash = (v: number) => (v === 0 ? '' : Math.trunc(v).toLocaleString());

// Legacy GetCodedInvoiceID: Grp-<id>, Grp-<A..>-<rest> above 1000, Grp-<AA..>-<rest> above 10000.
function codedInvoiceId(id: number): string {
  if (id > 10000) {
    const ten = Math.floor(id / 10000);
    const th = Math.floor((id - 10000 * ten) / 1000);
    return `Grp-${String.fromCharCode(64 + ten)}${String.fromCharCode(64 + th)}-${id - ten * 10000 - th * 1000}`;
  }
  if (id > 1000) {
    const th = Math.floor(id / 1000);
    return `Grp-${String.fromCharCode(64 + th)}-${id - th * 1000}`;
  }
  return `Grp-${id}`;
}

type AmountMode = 'Amnt' | '%';

// Legacy CalculateNetToPay: a % discount converts against Cost with an int cast
// (truncation), variation is an amount only.
function discountOf(entry: number, mode: AmountMode, cost: number): number {
  return Math.trunc(mode === '%' ? (entry * cost) / 100 : entry);
}

export function RegistrationForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = getStoredUser();
  const userType = (user?.userType || '').toLowerCase();
  const canSave = user?.canSave !== false;
  const isSiteMaster = userType === 'sitemaster';
  const isNew = !id || id === 'new';
  const [urlParams] = useSearchParams();
  // Add New from the list carries the single picked location (legacy: picking a
  // location made it the session location the popup opened on).
  const urlLocation = isNew && userType !== 'user' && /^\d+$/.test(urlParams.get('locationIds') ?? '')
    ? Number(urlParams.get('locationIds')) : 0;

  const [semesterRows, setSemesterRows] = useState<Row[]>([]);
  const [levels, setLevels] = useState<Option[]>([]);
  const [classes, setClasses] = useState<Picker[]>([]);
  const [locations, setLocations] = useState<Option[]>([]);
  const [discountTypes, setDiscountTypes] = useState<Option[]>([]);
  const [variationTypes, setVariationTypes] = useState<Option[]>([]);

  // form state
  const [studentId, setStudentId] = useState(0);
  const [studentLabel, setStudentLabel] = useState('');
  const [locationId, setLocationId] = useState(urlLocation || (user?.primaryLocationId ?? 0));
  const [semesterId, setSemesterId] = useState(0);
  const [levelId, setLevelId] = useState(0);
  const [times, setTimes] = useState(1);
  const [classIds, setClassIds] = useState<number[]>([0, 0, 0, 0, 0, 0, 0]);
  const [regDate, setRegDate] = useState(todayIso);
  const [cost, setCost] = useState(0);
  const [paidBefore, setPaidBefore] = useState(0);
  const [discountEntry, setDiscountEntry] = useState(0);
  const [discountMode, setDiscountMode] = useState<AmountMode>('Amnt');
  const [discountTypeId, setDiscountTypeId] = useState(0);
  const [discountNote, setDiscountNote] = useState('');
  const [discountLabel, setDiscountLabel] = useState('');
  const [variationEntry, setVariationEntry] = useState(0);
  const [variationTypeId, setVariationTypeId] = useState(0);
  const [variationNote, setVariationNote] = useState('');
  const [netToPay, setNetToPay] = useState(0);
  const [remarks, setRemarks] = useState('');
  const [stopped, setStopped] = useState(false);
  const [stopDate, setStopDate] = useState('');
  const [stopReason, setStopReason] = useState('');
  const [moneyOnHold, setMoneyOnHold] = useState(0);
  const [kit, setKit] = useState(false);
  const [history, setHistory] = useState<{ payments: Row[]; attendance: Row[] } | null>(null);

  // student search
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Picker[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // A new form defaults to the location's upcoming semester; an existing one
  // keeps the semester on the record until the user actively switches location.
  const keepSemester = useRef(!isNew);
  // Legacy ShowDataToEdit (new): Cost = SemesterAmountOne + SemesterAmountKit once.
  const initialPricePending = useRef(isNew);

  // Lookups
  useEffect(() => {
    apiRequest<{ levels: Option[] }>('/api/portal/modules/lookups')
      .then((lk) => setLevels(lk.levels))
      .catch(() => {});
    apiRequest<{ locations: { locationId: number; locationNickName: string | null }[] }>(
      '/api/portal/students/lookups'
    )
      .then((lk) => {
        const opts = lk.locations.map((l) => ({ value: l.locationId, label: l.locationNickName ?? `#${l.locationId}` }));
        setLocations(opts);
        // Legacy ddlLocations has no "all" entry: without an own location the first one is picked.
        setLocationId((cur) => cur || opts[0]?.value || 0);
      })
      .catch(() => {});
    apiRequest<{ discountTypes: Option[]; variationTypes: Option[] }>('/api/portal/edit/registration-lookups')
      .then((lk) => { setDiscountTypes(lk.discountTypes ?? []); setVariationTypes(lk.variationTypes ?? []); })
      .catch(() => {});
  }, []);

  // Location → semester list (Semester_Select_ByLocation), defaulting to the
  // location's first upcoming semester (Semester_Select_Upcoming().Rows[0]).
  useEffect(() => {
    if (!locationId) return;
    apiRequest<{ semesters: Row[] }>(`/api/portal/schedule/semesters?locationId=${locationId}`)
      .then((r) => {
        const rows = (r.semesters ?? []).filter((row) => semId(row) > 0);
        setSemesterRows(rows);
        if (keepSemester.current) return;
        const pick = rows.find((row) => row.SemesterUpcoming === true) ?? rows[0];
        const sid = pick ? semId(pick) : 0;
        setSemesterId(sid);
        setClassIds([0, 0, 0, 0, 0, 0, 0]);
        if (initialPricePending.current && pick) {
          initialPricePending.current = false;
          const c = n(pick.SemesterAmountOne) + n(pick.SemesterAmountKit);
          setCost(c);
          setNetToPay(c);
        }
      })
      .catch(() => {});
  }, [locationId]); // eslint-disable-line react-hooks/exhaustive-deps

  function changeLocation(lid: number) {
    setLocationId(lid);
    keepSemester.current = false; // re-default onto the new location's upcoming semester
  }

  // Existing registration
  useEffect(() => {
    if (isNew) return;
    apiRequest<Row>(`/api/portal/edit/registration/${id}`)
      .then((r) => {
        if (n(r.LocationId)) setLocationId(n(r.LocationId));
        setStudentId(n(r.RegistrationStudentId));
        setStudentLabel(s(r.StudentFullName) || `Student #${n(r.RegistrationStudentId)}`);
        setSemesterId(n(r.RegistrationSemesterId));
        setLevelId(n(r.RegistrationLevelID));
        setTimes(n(r.RegistrationNumberOfTimes) || 1);
        setClassIds(CLASS_SLOTS.map((i) => n(r[`RegistrationClassId${i}`])));
        setRegDate(toDateInput(r.RegistrationDate) || todayIso());
        setCost(n(r.RegistrationCost));
        setPaidBefore(n(r.RegistrationPaidPrevSemester));
        setDiscountEntry(n(r.RegistrationDiscount)); // stored as an amount
        setDiscountTypeId(n(r.RegistrationDiscountTYpeID));
        setDiscountNote(s(r.RegistrationDiscountNote));
        setVariationEntry(n(r.RegistrationVariation));
        // tbl_Registration spells this one RegistrationVariationTypeID (lower "ype").
        setVariationTypeId(n(r.RegistrationVariationTypeID ?? r.RegistrationVariationTYpeID));
        setVariationNote(s(r.RegistrationVariationNote));
        setNetToPay(n(r.RegistrationNetToPay));
        setRemarks(s(r.RegistrationRemarks));
        setStopped(r.RegistrationStudentStopped === true);
        setStopDate(toDateInput(r.RegistrationStudentStoppedDate));
        setStopReason(s(r.RegistrationStudentStoppedReason));
        setMoneyOnHold(n(r.RegistrationStudentStoppedMoneyOnHold));
        setKit(r.RegistrationKit === true);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load registration.'))
      .finally(() => setLoading(false));
    apiRequest<{ payments: Row[]; attendance: Row[] }>(`/api/portal/registrations/${id}/history`)
      .then(setHistory)
      .catch(() => setHistory(null));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Classes of the location + semester (Class_Select(location, semester)).
  useEffect(() => {
    if (!semesterId || !locationId) { setClasses([]); return; }
    apiRequest<Picker[]>(`/api/portal/registrations/form-classes?locationId=${locationId}&semesterId=${semesterId}`)
      .then(setClasses)
      .catch(() => setClasses([]));
  }, [semesterId, locationId]);

  // Debounced student search, scoped to the location like the legacy ddlStudents.
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (q.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    searchTimer.current = setTimeout(() => {
      apiRequest<Picker[]>(`/api/portal/registrations/form-students?locationId=${locationId}&q=${encodeURIComponent(q.trim())}`)
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
  }, [q, locationId]);

  // Legacy RegistrationsIndividual.aspx?StudentID=…: a new registration opened
  // from the student form's "Save and Register" comes with the student picked.
  const prefillStudentId = isNew ? Number(urlParams.get('studentId') ?? 0) : 0;
  useEffect(() => {
    if (!prefillStudentId) return;
    apiRequest<Row>(`/api/portal/students/${prefillStudentId}`)
      .then((r) => {
        setStudentId(prefillStudentId);
        setStudentLabel(s(r.StudentFullName) || `Student #${prefillStudentId}`);
        const loc = n(r.StudentPrimaryLocationId);
        if (loc > 0 && userType !== 'user') setLocationId(loc);
      })
      .catch(() => { setStudentId(prefillStudentId); setStudentLabel(`Student #${prefillStudentId}`); });
  }, [prefillStudentId]); // eslint-disable-line react-hooks/exhaustive-deps

  const semesterRow = (sid: number) => semesterRows.find((r) => semId(r) === sid);

  // ── legacy pricing rules ────────────────────────────────────────────────────

  /** CalculateNetToPay: Net = Cost + Variation − Discount − PaidBefore. */
  function netFor(c: number, paid = paidBefore): number {
    return c + Math.trunc(variationEntry) - discountOf(discountEntry, discountMode, c) - paid;
  }

  /** CalculateRemainingNetToPay: from 8 days after the semester start the cost
   *  is P_Registration_Cost_Select's Result and the net is recalculated. */
  async function remainingCost(sid: number, t: number, k: boolean, date: string) {
    const sem = semesterRow(sid);
    if (!sem || !date) return;
    const start = new Date(s(sem.SemesterStart));
    if (isNaN(start.getTime())) return;
    start.setDate(start.getDate() + 8);
    if (Date.now() <= start.getTime()) return;
    try {
      const r = await apiRequest<{ result: number | null }>(
        `/api/portal/registrations/cost?semesterId=${sid}&times=${t}&kit=${k}&registrationDate=${date}`
      );
      if (r.result == null) return;
      const c = n(r.result);
      setCost(c);
      setNetToPay(netFor(c));
    } catch { /* keep the current cost */ }
  }

  /** ddlRegistrationNumberOfTimes_SelectedIndexChanged (also the kit box and a
   *  student pick): Cost = the semester price for that many times (+ kit),
   *  Net = Cost, slots above `t` cleared, then the 8-day rule. */
  function applyTimes(t: number, k: boolean) {
    setTimes(t);
    setClassIds((prev) => prev.map((v, idx) => (idx < t ? v : 0)));
    const sem = semesterRow(semesterId);
    if (sem) {
      const c = n(sem[PRICE_COLS[t]]) + (k ? n(sem.SemesterAmountKit) : 0);
      setCost(c);
      setNetToPay(c);
    }
    void remainingCost(semesterId, t, k, regDate);
  }

  function changeSemester(sid: number) {
    setSemesterId(sid);
    setClassIds([0, 0, 0, 0, 0, 0, 0]); // the class lists rebind
    void remainingCost(sid, times, kit, regDate);
  }

  function setSlot(i: number, value: number) {
    // Legacy ddlRegistrationClassIdN_SelectedIndexChanged: identical classes are refused.
    if (value !== 0 && classIds.some((v, idx) => idx !== i && v === value)) {
      setClassIds((prev) => prev.map((v, idx) => (idx === i ? 0 : v)));
      window.alert('You Have Chosen Identical Classes, Please Correct');
      return;
    }
    setClassIds((prev) => prev.map((v, idx) => (idx === i ? value : v)));
    if (i === 0) void remainingCost(semesterId, times, kit, regDate);
  }

  function pickStudent(p: Picker) {
    setStudentId(p.id);
    setStudentLabel(p.label);
    setQ('');
    setResults([]);
    // ddlStudents_SelectedIndexChanged → the times rule (cost reset) + 8-day rule.
    applyTimes(times, kit);
  }

  // BtnCalculateDiscount_Click (both Calc buttons).
  function calc() {
    const disc = discountOf(discountEntry, discountMode, cost);
    setDiscountLabel(`Disc: ${fmtHash(disc)} = %${cost ? fmtHash(Math.trunc((disc * 100) / cost)) : ''}`);
    setNetToPay(netFor(cost));
  }

  function toggleStopped(on: boolean) {
    setStopped(on);
    setStopDate(on ? todayIso() : '');
  }

  function payLink(): string {
    const p = new URLSearchParams({
      studentId: String(studentId),
      studentName: studentLabel,
      semesterId: String(semesterId),
      locationId: String(locationId),
    });
    return `/payments/new?${p}`;
  }

  async function save(andPay = false) {
    if (!regDate) { setError('Registration Date is required (dd/mm/yyyy).'); return; }
    if (isNew) {
      if (!studentId) { window.alert('Unable to Add, Please Select a Student'); return; }
      if (!classIds[0]) { window.alert('Unable to Add, Please Select one Class at Least'); return; }
    }
    if (!semesterId) { setError('Choose a semester.'); return; }

    // Legacy: a zero net with no discount means the full cost; with a discount it only warns.
    let net = netToPay;
    if (net === 0) {
      if (discountEntry === 0) { net = cost; setNetToPay(cost); }
      else toast.info('Please Note That Net To Pay Amount is Zero');
    }

    setSaving(true);
    setError('');
    const payload: Record<string, unknown> = {
      RegistrationStudentId: studentId,
      RegistrationSemesterId: semesterId,
      RegistrationLevelID: levelId,
      RegistrationNumberOfTimes: times,
      RegistrationDate: regDate,
      RegistrationCost: cost,
      RegistrationPaidPrevSemester: paidBefore,
      RegistrationDiscount: discountOf(discountEntry, discountMode, cost),
      RegistrationDiscountTYpeID: discountTypeId,
      RegistrationDiscountNote: discountNote,
      RegistrationVariation: Math.trunc(variationEntry),
      RegistrationVariationTYpeID: variationTypeId,
      RegistrationVariationNote: variationNote,
      RegistrationNetToPay: net,
      RegistrationRemarks: remarks,
      RegistrationStudentStopped: stopped,
      RegistrationStudentStoppedReason: stopReason,
      RegistrationStudentStoppedMoneyOnHold: moneyOnHold,
      RegistrationKit: kit,
    };
    // Edit: an empty stop date clears it (legacy 01/01/2015 sentinel, applied by the API).
    if (!isNew) payload.RegistrationStudentStoppedDate = stopDate;
    CLASS_SLOTS.forEach((slot, idx) => { payload[`RegistrationClassId${slot}`] = classIds[idx]; });

    try {
      if (isNew) {
        await apiRequest('/api/portal/edit/registration', { method: 'POST', body: JSON.stringify(payload) });
      } else {
        await apiRequest(`/api/portal/edit/registration/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      }
      toast.success('Registration saved.');
      if (andPay) navigate(payLink());
      else closeOrGo(navigate, '/registrations');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed.';
      setError(msg); toast.error(msg);
      setSaving(false);
    }
  }

  async function deletePermanently() {
    if (!window.confirm('Are you sure you want to delete this Registration. This may not be restored? ')) return;
    try {
      await apiRequest(`/api/portal/edit/registration/${id}`, { method: 'DELETE' });
      toast.success('Registration Deleted Successfully');
      closeOrGo(navigate, '/registrations');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Delete failed.';
      setError(msg); toast.error(msg);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="size-8 text-[#1e5c97] animate-spin" />
      </div>
    );
  }

  const payments = history?.payments ?? [];
  const attendance = history?.attendance ?? [];
  const paidSum = payments.reduce((t, p) => t + n(p.PaymentPaidAmount), 0);
  const attendedCount = attendance.filter((a) => a.AttendanceStudentAttended === true).length;

  return (
    <div className="p-6 md:p-8 max-w-4xl">
      <PageHero
        compact
        title={isNew ? 'New Registration' : studentLabel || 'Registration'}
        subtitle={isNew ? 'Register a student for a semester' : 'Edit registration'}
        slide={1}
      />

      <div className="flex items-center gap-4 mb-4">
        <SmartBack label="Back" fallback="/registrations" />
        <div className="flex-1" />
        {!isNew && studentId > 0 && (
          <Link to={`/students/${studentId}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#1e5c97] hover:underline">
            <User className="size-4" /> Student profile
          </Link>
        )}
        {/* Legacy pnlAddPayment "Click to Add Payment" (edit mode). */}
        {!isNew && canSave && (
          <Link to={payLink()} className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 hover:underline">
            <CreditCard className="size-4" /> Click to Add Payment
          </Link>
        )}
      </div>

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

      <div className="space-y-4">
        {/* Student + semester */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-4">Student & Semester</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Location *</label>
              <select
                value={locationId}
                onChange={(e) => changeLocation(Number(e.target.value))}
                disabled={userType === 'user'}
                className={inputCls}
              >
                {locations.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Semester *</label>
              <select value={semesterId} onChange={(e) => changeSemester(Number(e.target.value))} className={inputCls}>
                {semesterRows.length === 0 && <option value={0}>-</option>}
                {semesterRows.map((r) => <option key={semId(r)} value={semId(r)}>{s(r.SemesterName)}</option>)}
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-slate-500 mb-1">Student *</label>
              {studentId ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <span className="font-medium text-slate-800">{studentLabel}</span>
                  <button onClick={() => { setStudentId(0); setStudentLabel(''); }} className="text-slate-400 hover:text-red-500" title="Change student">
                    <X className="size-4" />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <Search className="size-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search a student of this location…"
                    className={`${inputCls} pl-8`}
                  />
                  {(searching || results.length > 0) && (
                    <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                      {searching && <div className="px-3 py-2 text-xs text-slate-400">Searching…</div>}
                      {results.map((r) => (
                        <button
                          key={r.id}
                          onClick={() => pickStudent(r)}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
                        >
                          {r.label}
                        </button>
                      ))}
                      {!searching && results.length === 0 && q.trim().length >= 2 && (
                        <div className="px-3 py-2 text-xs text-slate-400">No students found.</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-end gap-4">
              <div className="flex-1">
                <label className="block text-xs font-semibold text-slate-500 mb-1">Times/Week</label>
                <select value={times} onChange={(e) => applyTimes(Number(e.target.value), kit)} className={inputCls}>
                  {TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700 select-none pb-2">
                <input
                  type="checkbox"
                  checked={kit}
                  onChange={(e) => { setKit(e.target.checked); applyTimes(times, e.target.checked); }}
                  className="accent-[#1e5c97]"
                /> Swimming Kit
              </label>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Level</label>
              <select value={levelId} onChange={(e) => setLevelId(Number(e.target.value))} className={inputCls}>
                <option value={0}>Not Selected</option>
                {levels.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Registration Date *</label>
              <DateInput
                value={regDate}
                onChange={(e) => { setRegDate(e.target.value); void remainingCost(semesterId, times, kit, e.target.value); }}
                className={inputCls}
              />
            </div>
          </div>
        </div>

        {/* Classes: slot N is open once Times/Week reaches N (legacy Enabled rules) */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-4">
            Classes {semesterId ? '' : 'pick a semester first'}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {CLASS_SLOTS.map((slot, idx) => (
              <div key={slot}>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Class {slot}{slot === 1 ? ' *' : ''}</label>
                <select
                  value={classIds[idx]}
                  onChange={(e) => setSlot(idx, Number(e.target.value))}
                  disabled={!semesterId || slot > times}
                  className={inputCls}
                >
                  <option value={0}>Not Selected</option>
                  {classes.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>

        {/* Money, legacy formula: Net = Cost + Variation − Discount − PaidBefore */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-4">Pricing</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Cost</label>
              <input
                type="number"
                value={cost}
                onChange={(e) => { const c = Math.trunc(Number(e.target.value) || 0); setCost(c); setNetToPay(netFor(c)); }}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Paid Before</label>
              <input
                type="number"
                value={paidBefore}
                onChange={(e) => { const p = Math.trunc(Number(e.target.value) || 0); setPaidBefore(p); setNetToPay(netFor(cost, p)); }}
                className={inputCls}
              />
            </div>
          </div>

          {/* Discount block (green, like the legacy form) */}
          <div className="rounded-xl bg-emerald-50/70 border border-emerald-100 p-3 mb-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-emerald-800 mb-1">Discount</label>
                <div className="flex gap-1.5">
                  <input type="number" value={discountEntry} onChange={(e) => setDiscountEntry(Number(e.target.value) || 0)} className={inputCls} />
                  <select value={discountMode} onChange={(e) => setDiscountMode(e.target.value as AmountMode)}
                    className="rounded-lg border border-slate-200 px-1.5 text-sm">
                    <option value="Amnt">Amnt</option>
                    <option value="%">%</option>
                  </select>
                  <button onClick={calc} title="Recalculate net"
                    className="rounded-lg bg-[#1e5c97] text-white px-2.5 text-sm font-semibold flex items-center gap-1">
                    <Calculator className="size-3.5" /> Calc
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-emerald-800 mb-1">Discount Type</label>
                <select value={discountTypeId} onChange={(e) => setDiscountTypeId(Number(e.target.value))} className={inputCls}>
                  <option value={0}>Not Selected</option>
                  {discountTypes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-emerald-800 mb-1">Discount Note</label>
                <input value={discountNote} onChange={(e) => setDiscountNote(e.target.value)} className={inputCls} />
              </div>
            </div>
          </div>

          {/* Variation block (cyan, like the legacy form; amount only) */}
          <div className="rounded-xl bg-cyan-50/70 border border-cyan-100 p-3 mb-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-cyan-800 mb-1">Variation Amnt</label>
                <div className="flex gap-1.5">
                  <input type="number" value={variationEntry} onChange={(e) => setVariationEntry(Number(e.target.value) || 0)} className={inputCls} />
                  <button onClick={calc} title="Recalculate net"
                    className="rounded-lg bg-[#1e5c97] text-white px-2.5 text-sm font-semibold flex items-center gap-1">
                    <Calculator className="size-3.5" /> Calc
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-cyan-800 mb-1">Variation Type</label>
                <select value={variationTypeId} onChange={(e) => setVariationTypeId(Number(e.target.value))} className={inputCls}>
                  <option value={0}>Not Selected</option>
                  {variationTypes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-cyan-800 mb-1">Variation Note</label>
                <input value={variationNote} onChange={(e) => setVariationNote(e.target.value)} className={inputCls} />
              </div>
            </div>
          </div>

          <div className="flex items-end gap-4">
            <div className="max-w-48">
              <label className="block text-xs font-bold text-slate-700 mb-1">Net To Pay</label>
              <input type="number" value={netToPay} readOnly disabled className={`${inputCls} font-bold`} />
            </div>
            <p className="text-xs pb-2.5">
              {discountLabel
                ? <span className="font-semibold text-emerald-700">{discountLabel}</span>
                : <span className="text-slate-400">Net = Cost + Variation − Discount − Paid Before (press Calc to apply)</span>}
            </p>
          </div>
        </div>

        {/* Stop panel (pink, like the legacy form); the box is only enabled when editing */}
        <div className={`rounded-2xl border p-5 ${stopped ? 'bg-red-50/60 border-red-100' : 'bg-white border-slate-100 shadow-sm'}`}>
          <label className={`flex items-center gap-2 text-sm font-bold select-none mb-3 ${isNew ? 'text-slate-400' : 'text-slate-800'}`}>
            <input
              type="checkbox"
              checked={stopped}
              disabled={isNew}
              onChange={(e) => toggleStopped(e.target.checked)}
              className="accent-red-500"
            />
            Student Stopped
          </label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-red-700 mb-1">Stop Date</label>
              <DateInput value={stopDate} onChange={(e) => setStopDate(e.target.value)} disabled={!stopped} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-red-700 mb-1">Money OnHold</label>
              <input type="number" value={moneyOnHold} onChange={(e) => setMoneyOnHold(Math.trunc(Number(e.target.value) || 0))} disabled={!stopped} className={inputCls} />
            </div>
            <div className="md:col-span-3">
              <label className="block text-xs font-semibold text-red-700 mb-1">Stop Reason</label>
              <textarea value={stopReason} onChange={(e) => setStopReason(e.target.value)} rows={2} disabled={!stopped} className={inputCls} />
            </div>
          </div>
        </div>

        {/* Remarks */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Remarks</p>
          <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} className={inputCls} />
        </div>
      </div>

      {canSave && (
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          {!isNew && isSiteMaster && (
            <button
              onClick={deletePermanently}
              className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-600 text-white text-sm font-semibold px-5 py-2.5 hover:bg-red-700 mr-auto"
            >
              <Trash2 className="size-4" /> Delete Permanently
            </button>
          )}
          <button
            onClick={() => save(false)}
            disabled={saving}
            className="btn-grad flex items-center gap-2 rounded-xl text-sm font-semibold px-6 py-2.5"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Save Changes
          </button>
          <button
            onClick={() => save(true)}
            disabled={saving}
            className="flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-6 py-2.5 disabled:opacity-50"
          >
            <CreditCard className="size-4" /> Save And Pay
          </button>
        </div>
      )}

      {/* Legacy LtrStudentProfileandHistory: this semester's payments + attendance */}
      {!isNew && payments.length > 0 && (
        <div className="mt-6 bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <p className="text-sm font-bold text-[#001c57] mb-3">Payment this Semester - {fmtHash(paidSum)}</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 uppercase tracking-wider border-b border-slate-100">
                <th className="py-2 pr-3">ID</th><th className="py-2 pr-3">Date</th>
                <th className="py-2 pr-3">Amount</th><th className="py-2">IssuedTo</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p, i) => (
                <tr key={`${n(p.PaymentPaidId)}-${i}`} className="border-b border-slate-50 last:border-0">
                  <td className="py-1.5 pr-3">
                    <Link to={`/payments/${n(p.PaymentId)}`} className="font-semibold text-[#1e5c97] hover:underline">
                      {codedInvoiceId(n(p.PaymentId))}
                    </Link>
                  </td>
                  <td className="py-1.5 pr-3">{fmtDate(p.PaymentDate, '-')}</td>
                  <td className="py-1.5 pr-3">{fmtHash(n(p.PaymentPaidAmount))}</td>
                  <td className="py-1.5">{s(p.IssuedTo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!isNew && attendance.length > 0 && (
        <div className="mt-4 bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <p className="text-sm font-bold text-[#001c57] mb-3">
            Attendance this Semester -{' '}
            <Link
              to={`/attendance-details?${new URLSearchParams({
                semesterId: String(semesterId),
                locationId: s(attendance[0].LocationID),
                search: s(attendance[0].StudentFullName),
              })}`}
              className="hover:underline"
            >
              <span className="text-green-800">{attendedCount}</span>/{attendance.length}
            </Link>
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 uppercase tracking-wider border-b border-slate-100">
                <th className="py-2 pr-3">ID</th><th className="py-2 pr-3">Date</th>
                <th className="py-2 pr-3">Attended</th><th className="py-2">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {attendance.map((a, i) => (
                <tr key={`${n(a.AttendanceSessionId)}-${i}`} className="border-b border-slate-50 last:border-0">
                  <td className="py-1.5 pr-3">{n(a.AttendanceSessionId)}</td>
                  <td className="py-1.5 pr-3">{fmtDate(a.SessionDate, '-')}</td>
                  <td className="py-1.5 pr-3">
                    {a.AttendanceStudentAttended === true
                      ? <span className="font-bold text-green-800">Yes</span>
                      : <span className="text-red-600">Absent</span>}
                  </td>
                  <td className="py-1.5">{s(a.AttendanceRemarks)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

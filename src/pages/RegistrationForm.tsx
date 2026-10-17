// Group registration form, full port of RegistrationsIndividual.aspx:
// student/semester/level, classes 1–7, registration date, cost, paid-before,
// discount and variation (amount or %, with the legacy net formula
// Net = Cost + Variation − Discount − PaidBefore), stop panel with date /
// money-on-hold / reason, kit, remarks, Save / Save-and-Pay / Delete.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Loader2, AlertCircle, Save, Search, X, Calculator,
  CreditCard, Trash2, User,
} from 'lucide-react';
import { apiRequest, getStoredUser } from '../api/portalApi';
import { canGoBack } from '../lib/history';
import { DateInput } from '../components/DateInput';
import { toast } from '../components/Toast';
import { PageHero } from '../components/PageHero';
import { SmartBack } from '../components/SmartBack';

type Row = Record<string, unknown>;
type Option = { value: number; label: string };
type Picker = { id: number; label: string };

const CLASS_SLOTS = [1, 2, 3, 4, 5, 6, 7] as const;
const inputCls =
  'w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e5c97]/40';

const s = (v: unknown) => (v == null ? '' : String(v));
const n = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const toDateInput = (v: unknown): string => {
  if (!v) return '';
  const d = new Date(String(v));
  if (isNaN(d.getTime()) || d.getFullYear() < 1901) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

type AmountMode = 'Amnt' | '%';

export function RegistrationForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = getStoredUser();
  const canSave = user?.canSave !== false;
  const isSiteMaster = (user?.userType || '').toLowerCase() === 'sitemaster';
  const isNew = !id || id === 'new';

  const [semesters, setSemesters] = useState<Option[]>([]);
  const [levels, setLevels] = useState<Option[]>([]);
  const [classes, setClasses] = useState<Picker[]>([]);
  const [locations, setLocations] = useState<Option[]>([]);
  const [discountTypes, setDiscountTypes] = useState<Option[]>([]);
  const [variationTypes, setVariationTypes] = useState<Option[]>([]);

  // form state
  const [studentId, setStudentId] = useState(0);
  const [studentLabel, setStudentLabel] = useState('');
  const [locationId, setLocationId] = useState(user?.primaryLocationId ?? 0);
  const [semesterId, setSemesterId] = useState(0);
  const [levelId, setLevelId] = useState(0);
  const [times, setTimes] = useState(1);
  const [classIds, setClassIds] = useState<number[]>([0, 0, 0, 0, 0, 0, 0]);
  const [regDate, setRegDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [cost, setCost] = useState(0);
  const [paidBefore, setPaidBefore] = useState(0);
  const [discountEntry, setDiscountEntry] = useState(0);
  const [discountMode, setDiscountMode] = useState<AmountMode>('Amnt');
  const [discountTypeId, setDiscountTypeId] = useState(0);
  const [discountNote, setDiscountNote] = useState('');
  const [variationEntry, setVariationEntry] = useState(0);
  const [variationMode, setVariationMode] = useState<AmountMode>('Amnt');
  const [variationTypeId, setVariationTypeId] = useState(0);
  const [variationNote, setVariationNote] = useState('');
  const [netToPay, setNetToPay] = useState(0);
  const [remarks, setRemarks] = useState('');
  const [stopped, setStopped] = useState(false);
  const [stopDate, setStopDate] = useState('');
  const [stopReason, setStopReason] = useState('');
  const [moneyOnHold, setMoneyOnHold] = useState(0);
  const [kit, setKit] = useState(false);

  // student search
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Picker[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // A new form defaults to the location's current semester; an existing one must
  // keep the semester on the record, until the user actively switches location.
  const keepSemester = useRef(!isNew);

  // Lookups
  useEffect(() => {
    apiRequest<{ levels: Option[] }>('/api/portal/modules/lookups')
      .then((lk) => setLevels(lk.levels))
      .catch(() => {});
    apiRequest<{ locations: { locationId: number; locationNickName: string | null }[] }>(
      '/api/portal/students/lookups'
    )
      .then((lk) => setLocations(lk.locations.map((l) => ({ value: l.locationId, label: l.locationNickName ?? `#${l.locationId}` }))))
      .catch(() => {});
    apiRequest<{ discountTypes: Option[]; variationTypes: Option[] }>('/api/portal/edit/registration-lookups')
      .then((lk) => { setDiscountTypes(lk.discountTypes ?? []); setVariationTypes(lk.variationTypes ?? []); })
      .catch(() => {});
  }, []);

  // Location → semester list, defaulting to the semester running right now.
  useEffect(() => {
    apiRequest<{ semesters: Row[]; currentSemesterId: number }>(
      `/api/portal/schedule/semesters?locationId=${locationId}`
    )
      .then((r) => {
        const opts = (r.semesters ?? [])
          .map((row) => ({ value: n(row.SemesterId ?? row.SemesterID), label: s(row.SemesterName) }))
          .filter((o) => o.value > 0);
        setSemesters(opts);
        if (keepSemester.current) return;
        setSemesterId(r.currentSemesterId || opts[0]?.value || 0);
      })
      .catch(() => {});
  }, [locationId]); // eslint-disable-line react-hooks/exhaustive-deps

  function changeLocation(id: number) {
    setLocationId(id);
    keepSemester.current = false; // re-default onto the new location's current semester
  }

  // Existing registration
  useEffect(() => {
    if (isNew) return;
    apiRequest<Row>(`/api/portal/edit/registration/${id}`)
      .then((r) => {
        setStudentId(n(r.RegistrationStudentId));
        setStudentLabel(s(r.StudentFullName) || `Student #${n(r.RegistrationStudentId)}`);
        setSemesterId(n(r.RegistrationSemesterId));
        setLevelId(n(r.RegistrationLevelID));
        setTimes(n(r.RegistrationNumberOfTimes) || 1);
        setClassIds(CLASS_SLOTS.map((i) => n(r[`RegistrationClassId${i}`])));
        setRegDate(toDateInput(r.RegistrationDate) || new Date().toISOString().slice(0, 10));
        setCost(n(r.RegistrationCost));
        setPaidBefore(n(r.RegistrationPaidPrevSemester));
        setDiscountEntry(n(r.RegistrationDiscount)); // stored as amount
        setDiscountTypeId(n(r.RegistrationDiscountTYpeID));
        setDiscountNote(s(r.RegistrationDiscountNote));
        setVariationEntry(n(r.RegistrationVariation));
        setVariationTypeId(n(r.RegistrationVariationTYpeID));
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
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Classes for the chosen semester
  useEffect(() => {
    if (!semesterId) { setClasses([]); return; }
    apiRequest<Picker[]>(`/api/portal/edit/classes-for-semester?semesterId=${semesterId}`)
      .then(setClasses)
      .catch(() => setClasses([]));
  }, [semesterId]);

  // Debounced student search
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (q.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    searchTimer.current = setTimeout(() => {
      apiRequest<Picker[]>(`/api/portal/edit/student-search?q=${encodeURIComponent(q.trim())}`)
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
  }, [q]);

  const classOptions = useMemo(() => classes, [classes]);

  function setSlot(i: number, value: number) {
    setClassIds((prev) => prev.map((v, idx) => (idx === i ? value : v)));
  }

  // Legacy RegistrationsIndividual.aspx?StudentID=…: a new registration opened
  // from the student form's "Save and Register" comes with the student picked.
  const [urlParams] = useSearchParams();
  const prefillStudentId = isNew ? Number(urlParams.get('studentId') ?? 0) : 0;
  useEffect(() => {
    if (!prefillStudentId) return;
    apiRequest<Row>(`/api/portal/students/${prefillStudentId}`)
      .then((r) => {
        setStudentId(prefillStudentId);
        setStudentLabel(s(r.StudentFullName) || `Student #${prefillStudentId}`);
        const loc = n(r.StudentPrimaryLocationId);
        if (loc > 0) setLocationId(loc);
      })
      .catch(() => { setStudentId(prefillStudentId); setStudentLabel(`Student #${prefillStudentId}`); });
  }, [prefillStudentId]);

  function pickStudent(p: Picker) {
    setStudentId(p.id);
    setStudentLabel(p.label);
    setQ('');
    setResults([]);
  }

  // Legacy CalculateNetToPay: % entries convert against Cost, rounded to int.
  const discountAmount = discountMode === '%' ? Math.round((discountEntry * cost) / 100) : Math.round(discountEntry);
  const variationAmount = variationMode === '%' ? Math.round((variationEntry * cost) / 100) : Math.round(variationEntry);

  function recalcNet() {
    setNetToPay(cost + variationAmount - discountAmount - paidBefore);
  }

  async function save(andPay = false) {
    if (!studentId) { setError('Choose a student first.'); return; }
    if (!semesterId) { setError('Choose a semester.'); return; }
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
      RegistrationDiscount: discountAmount,
      RegistrationDiscountTYpeID: discountTypeId,
      RegistrationDiscountNote: discountNote,
      RegistrationVariation: variationAmount,
      RegistrationVariationTYpeID: variationTypeId,
      RegistrationVariationNote: variationNote,
      RegistrationNetToPay: netToPay,
      RegistrationRemarks: remarks,
      RegistrationStudentStopped: stopped,
      RegistrationStudentStoppedReason: stopReason,
      RegistrationStudentStoppedMoneyOnHold: moneyOnHold,
      RegistrationKit: kit,
    };
    if (stopDate) payload.RegistrationStudentStoppedDate = stopDate;
    CLASS_SLOTS.forEach((slot, idx) => { payload[`RegistrationClassId${slot}`] = classIds[idx]; });

    try {
      if (isNew) {
        await apiRequest('/api/portal/edit/registration', { method: 'POST', body: JSON.stringify(payload) });
      } else {
        await apiRequest(`/api/portal/edit/registration/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      }
      toast.success('Registration saved.');
      navigate(andPay ? '/payments/new' : '/registrations');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed.';
      setError(msg); toast.error(msg);
      setSaving(false);
    }
  }

  async function deletePermanently() {
    if (!window.confirm(`Permanently delete this registration for ${studentLabel}? This cannot be undone.`)) return;
    if (!window.confirm('Are you absolutely sure? All linked data may be affected.')) return;
    try {
      await apiRequest(`/api/portal/edit/registration/${id}`, { method: 'DELETE' });
      if (canGoBack()) navigate(-1); else navigate('/registrations');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed.');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="size-8 text-[#1e5c97] animate-spin" />
      </div>
    );
  }

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
        {!isNew && canSave && (
          <Link to="/payments/new" className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 hover:underline">
            <CreditCard className="size-4" /> Add payment
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
              <label className="block text-xs font-semibold text-slate-500 mb-1">Student</label>
              {studentId ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <span className="font-medium text-slate-800">{studentLabel}</span>
                  {isNew && (
                    <button onClick={() => { setStudentId(0); setStudentLabel(''); }} className="text-slate-400 hover:text-red-500">
                      <X className="size-4" />
                    </button>
                  )}
                </div>
              ) : (
                <div className="relative">
                  <Search className="size-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search student by name…"
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

            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Location</label>
              <select value={locationId} onChange={(e) => changeLocation(Number(e.target.value))} className={inputCls}>
                <option value={0}>All locations</option>
                {locations.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Semester</label>
              <select value={semesterId} onChange={(e) => setSemesterId(Number(e.target.value))} className={inputCls}>
                <option value={0}>-</option>
                {semesters.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Level</label>
              <select value={levelId} onChange={(e) => setLevelId(Number(e.target.value))} className={inputCls}>
                <option value={0}>-</option>
                {levels.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Registration date</label>
              <DateInput value={regDate} onChange={(e) => setRegDate(e.target.value)} className={inputCls} />
            </div>

            <div className="flex items-end gap-4">
              <div className="flex-1">
                <label className="block text-xs font-semibold text-slate-500 mb-1">Times per week</label>
                <input type="number" min={1} max={7} value={times} onChange={(e) => setTimes(Number(e.target.value))} className={inputCls} />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700 select-none pb-2">
                <input type="checkbox" checked={kit} onChange={(e) => setKit(e.target.checked)} className="accent-[#1e5c97]" /> Swimming kit
              </label>
            </div>
          </div>
        </div>

        {/* Classes */}
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
                  disabled={!semesterId}
                  className={`${inputCls} disabled:bg-slate-50`}
                >
                  <option value={0}>-</option>
                  {classOptions.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
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
              <input type="number" value={cost} onChange={(e) => setCost(Number(e.target.value))} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Paid before</label>
              <input type="number" value={paidBefore} onChange={(e) => setPaidBefore(Number(e.target.value))} className={inputCls} />
            </div>
          </div>

          {/* Discount block (green, like the legacy form) */}
          <div className="rounded-xl bg-emerald-50/70 border border-emerald-100 p-3 mb-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-emerald-800 mb-1">Discount</label>
                <div className="flex gap-1.5">
                  <input type="number" value={discountEntry} onChange={(e) => setDiscountEntry(Number(e.target.value))} className={inputCls} />
                  <select value={discountMode} onChange={(e) => setDiscountMode(e.target.value as AmountMode)}
                    className="rounded-lg border border-slate-200 px-1.5 text-sm">
                    <option value="Amnt">Am</option>
                    <option value="%">%</option>
                  </select>
                  <button onClick={recalcNet} title="Recalculate net"
                    className="rounded-lg bg-[#1e5c97] text-white px-2.5 text-sm font-semibold flex items-center gap-1">
                    <Calculator className="size-3.5" /> Calc
                  </button>
                </div>
                {discountMode === '%' && (
                  <p className="text-[11px] text-emerald-700 mt-1">= {discountAmount.toLocaleString()} off</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-emerald-800 mb-1">Discount type</label>
                <select value={discountTypeId} onChange={(e) => setDiscountTypeId(Number(e.target.value))} className={inputCls}>
                  <option value={0}>Not selected</option>
                  {discountTypes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-emerald-800 mb-1">Discount note</label>
                <input value={discountNote} onChange={(e) => setDiscountNote(e.target.value)} className={inputCls} />
              </div>
            </div>
          </div>

          {/* Variation block (cyan, like the legacy form) */}
          <div className="rounded-xl bg-cyan-50/70 border border-cyan-100 p-3 mb-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-cyan-800 mb-1">Variation amount</label>
                <div className="flex gap-1.5">
                  <input type="number" value={variationEntry} onChange={(e) => setVariationEntry(Number(e.target.value))} className={inputCls} />
                  <select value={variationMode} onChange={(e) => setVariationMode(e.target.value as AmountMode)}
                    className="rounded-lg border border-slate-200 px-1.5 text-sm">
                    <option value="Amnt">Am</option>
                    <option value="%">%</option>
                  </select>
                  <button onClick={recalcNet} title="Recalculate net"
                    className="rounded-lg bg-[#1e5c97] text-white px-2.5 text-sm font-semibold flex items-center gap-1">
                    <Calculator className="size-3.5" /> Calc
                  </button>
                </div>
                {variationMode === '%' && (
                  <p className="text-[11px] text-cyan-700 mt-1">= {variationAmount.toLocaleString()} added</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-cyan-800 mb-1">Variation type</label>
                <select value={variationTypeId} onChange={(e) => setVariationTypeId(Number(e.target.value))} className={inputCls}>
                  <option value={0}>Not selected</option>
                  {variationTypes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-cyan-800 mb-1">Variation note</label>
                <input value={variationNote} onChange={(e) => setVariationNote(e.target.value)} className={inputCls} />
              </div>
            </div>
          </div>

          <div className="flex items-end gap-4">
            <div className="max-w-48">
              <label className="block text-xs font-bold text-slate-700 mb-1">Net to pay</label>
              <input type="number" value={netToPay} onChange={(e) => setNetToPay(Number(e.target.value))}
                className={`${inputCls} font-bold`} />
            </div>
            <p className="text-xs text-slate-400 pb-2.5">
              Net = Cost + Variation − Discount − Paid before (press Calc to apply)
            </p>
          </div>
        </div>

        {/* Stop panel (pink, like the legacy form) */}
        <div className={`rounded-2xl border p-5 ${stopped ? 'bg-red-50/60 border-red-100' : 'bg-white border-slate-100 shadow-sm'}`}>
          <label className="flex items-center gap-2 text-sm font-bold text-slate-800 select-none mb-3">
            <input type="checkbox" checked={stopped} onChange={(e) => setStopped(e.target.checked)} className="accent-red-500" />
            Student stopped
          </label>
          {stopped && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-red-700 mb-1">Stop date</label>
                <DateInput value={stopDate} onChange={(e) => setStopDate(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-red-700 mb-1">Money on hold</label>
                <input type="number" value={moneyOnHold} onChange={(e) => setMoneyOnHold(Number(e.target.value))} className={inputCls} />
              </div>
              <div className="md:col-span-3">
                <label className="block text-xs font-semibold text-red-700 mb-1">Stop reason</label>
                <textarea value={stopReason} onChange={(e) => setStopReason(e.target.value)} rows={2} className={inputCls} />
              </div>
            </div>
          )}
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
            {isNew ? 'Create registration' : 'Save changes'}
          </button>
          <button
            onClick={() => save(true)}
            disabled={saving}
            className="flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-6 py-2.5 disabled:opacity-50"
          >
            <CreditCard className="size-4" /> Save and Pay
          </button>
        </div>
      )}
    </div>
  );
}

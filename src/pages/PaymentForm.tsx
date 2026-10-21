// Group payment form, port of PaymentsIndividual.aspx: one receipt split across
// up to five students registered for a semester.
//
// Legacy rules kept here:
//  - Location (the semester's location, locked for "user") scopes the semester
//    list, which opens on the location's current semester; the student lists
//    are the semester's registered students (P_Student_Select_ForSemester).
//  - Pay Loc is a separate field (PaymentLocationId); the US→LB rate starts at
//    that location's current rate.
//  - "LBP Amount" (PaymentTotalAmount) is the LBP figure: LBP payments copy the
//    paid amount, USD payments floor(paid × rate). It stays editable.
//  - Each student line shows the registration currency, discount, To Pay
//    (RegistrationNetToPay), Paid Before (earlier payments of the semester up
//    to the payment date) and Still to Pay; "Exceeded Due" is only a warning.
//  - The student amounts are in the semester currency and must add up to the
//    payment: USD semester → the USD paid amount (or LBP paid ÷ rate), LBP
//    semester → the LBP amount. A plain user cannot record a zero payment.
//  - Only the SiteMaster can change a saved payment; others get Print Only /
//    Email Only. Save & Print / Save & Email store the legacy invoice in
//    tbl_Receipts; e-mail goes to every student's address.
//  - A payment already in a delivery opens green with a warning.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Loader2, AlertCircle, Save, Printer, Mail, Truck, Divide } from 'lucide-react';
import { apiRequest, getStoredUser } from '../api/portalApi';
import { canGoBack } from '../lib/history';
import { DateInput } from '../components/DateInput';
import { toast } from '../components/Toast';
import { PageHero } from '../components/PageHero';
import { SmartBack } from '../components/SmartBack';
import { groupInvoiceId } from '../lib/invoice';

type Row = Record<string, unknown>;
type Option = { value: number; label: string };
type Method = 'cash' | 'chq' | 'cc' | 'others';
type LineInfo = {
  studentId: number; registered: boolean; currency: string; netToPay: number;
  discount: string; discountTip: string; paidBefore: number; email: string; name: string;
};

const SLOTS = [0, 1, 2, 3, 4] as const;
// Legacy ddltitle: " " (saved as a space), Mr., Mrs., Dr.
const TITLES = [' ', 'Mr.', 'Mrs.', 'Dr.'];

const inputCls =
  'w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e5c97]/40 disabled:bg-slate-50 disabled:text-slate-500';
const labelCls = 'block text-xs font-semibold text-slate-500 mb-1';

const s = (v: unknown) => (v == null ? '' : String(v));
const n = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0);
const money = (v: number) => Math.round(v).toLocaleString('en-US');
const dateOnly = (v: unknown) => { const str = s(v); return str.length >= 10 ? str.slice(0, 10) : ''; };
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Fills the (already opened) print tab with the invoice and prints it. */
function fillPrintWindow(w: Window | null, html: string, title: string) {
  if (!w) { toast.error('The browser blocked the print window. Allow pop-ups for this site.'); return; }
  w.document.open();
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{margin:16px;font-family:Verdana,Arial,sans-serif;font-size:13px} @media print{body{margin:0}}</style></head>
<body onload="window.print()">${html}</body></html>`);
  w.document.close();
}

export function PaymentForm() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const user = getStoredUser();
  const userType = (user?.userType || '').toLowerCase();
  const isGuest = userType === 'guest';
  const isSiteMaster = userType === 'sitemaster';
  const canSave = user?.canSave !== false && !isGuest;
  const isNew = !id || id === 'new';
  const paymentId = isNew ? 0 : Number(id);
  // Legacy: a saved payment is editable by the SiteMaster (with saving rights) only.
  const canEdit = isNew ? canSave : canSave && isSiteMaster;

  const startLocation = n(params.get('locationId')) || user?.primaryLocationId || 0;
  const [locations, setLocations] = useState<Option[]>([]);
  const [semesters, setSemesters] = useState<Option[]>([]);
  const [students, setStudents] = useState<Option[]>([]);

  const [locationId, setLocationId] = useState(startLocation);
  const [payLocationId, setPayLocationId] = useState(startLocation);
  const [semesterId, setSemesterId] = useState(n(params.get('semesterId')));
  const [title, setTitle] = useState(' ');
  const [issuedTo, setIssuedTo] = useState('');
  const [date, setDate] = useState(today());
  const [currency, setCurrency] = useState('USD');
  const [rate, setRate] = useState(0);
  const [paidAmount, setPaidAmount] = useState(0);
  const [totalAmount, setTotalAmount] = useState(0);
  const [method, setMethod] = useState<Method>('cash');
  const [number, setNumber] = useState('');
  const [remarks, setRemarks] = useState('');
  const [slotIds, setSlotIds] = useState<number[]>([0, 0, 0, 0, 0]);
  const [slotAmounts, setSlotAmounts] = useState<number[]>([0, 0, 0, 0, 0]);
  const [extraNames, setExtraNames] = useState<Record<number, string>>({});
  const [infos, setInfos] = useState<Record<number, LineInfo>>({});
  const [showMore, setShowMore] = useState(false);
  const [delivered, setDelivered] = useState(false);

  const [loading, setLoading] = useState(!isNew);
  const [busy, setBusy] = useState<'' | 'save' | 'print' | 'email'>('');
  const [error, setError] = useState('');
  // Keep the loaded / deep-linked semester through the first location cascade.
  const keepSemester = useRef(!isNew || !!params.get('semesterId'));
  const prefilled = useRef(!isNew);
  const linesReq = useRef(0);

  useEffect(() => {
    apiRequest<{ locations: { locationId: number; locationNickName: string | null }[] }>('/api/portal/students/lookups')
      .then((lk) => setLocations(lk.locations.map((l) => ({ value: l.locationId, label: l.locationNickName ?? `#${l.locationId}` }))))
      .catch(() => {});
  }, []);

  // New payment: the US→LB rate starts at the pay location's current rate.
  useEffect(() => {
    if (!isNew) return;
    apiRequest<{ rate: number }>(`/api/portal/edit/currency-rate?locationId=${startLocation}`)
      .then((r) => setRate((cur) => cur || r.rate))
      .catch(() => {});
  }, [isNew, startLocation]);

  // Location → its semesters, opening on the current one (Semester_Select_Current).
  useEffect(() => {
    apiRequest<{ semesters: Row[]; selectedIds?: string }>(
      `/api/portal/modules/semester-options?locationIds=${locationId || ''}&pick=current`,
    )
      .then((r) => {
        const opts = (r.semesters ?? [])
          .map((row) => ({ value: n(row.SemesterId ?? row.SemesterID), label: s(row.SemesterName) }))
          .filter((o) => o.value > 0);
        setSemesters(opts);
        if (keepSemester.current) return;
        setSemesterId(n(String(r.selectedIds ?? '').split(',')[0]));
      })
      .catch(() => setSemesters([]));
  }, [locationId]);

  // Semester → its registered students.
  useEffect(() => {
    if (!semesterId) { setStudents([]); return; }
    apiRequest<{ id: number; label: string }[]>(`/api/portal/edit/group-payment-students?semesterId=${semesterId}`)
      .then((list) => {
        const opts = list.map((x) => ({ value: x.id, label: x.label }));
        setStudents(opts);
        if (prefilled.current) return;
        prefilled.current = true;
        // Legacy query strings: Studentid (Due report "Add Payment") and
        // PaymentIDtoAddAnother (list "Pay"): only students of this semester.
        const known = new Set(opts.map((o) => o.value));
        const fromId = n(params.get('fromPaymentId'));
        if (fromId) {
          apiRequest<{ lines: Row[] }>(`/api/portal/edit/payment/${fromId}`)
            .then(({ lines }) => {
              const ids = (lines ?? []).map((l) => n(l.PaymentPaidStudentId)).filter((x) => known.has(x)).slice(0, 5);
              setSlotIds(SLOTS.map((i) => ids[i] ?? 0));
              if (ids.length > 3) setShowMore(true);
            })
            .catch(() => {});
        } else {
          const sid = n(params.get('studentId'));
          if (sid && known.has(sid)) setSlotIds([sid, 0, 0, 0, 0]);
        }
      })
      .catch(() => setStudents([]));
  }, [semesterId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Existing payment.
  useEffect(() => {
    if (isNew) return;
    apiRequest<{ payment: Row; lines: Row[]; delivered?: boolean }>(`/api/portal/edit/payment/${id}`)
      .then(({ payment: r, lines, delivered: dl }) => {
        setLocationId(n(r.LocationId));
        setPayLocationId(n(r.PaymentLocationId));
        setSemesterId(n(r.PaymentSemesterId));
        setTitle(s(r.PaymentIssuedToTitle) || ' ');
        setIssuedTo(s(r.PaymentIssuedTo));
        setDate(dateOnly(r.PaymentDate) || today());
        setCurrency(s(r.PaymentPaidCurrency) || 'USD');
        setRate(n(r.PaymentPaidCurrencyRate));
        setPaidAmount(n(r.PaymentPaidAmount));
        setTotalAmount(n(r.PaymentTotalAmount));
        setMethod(r.PaymentCC === true ? 'cc' : r.PaymentChq === true ? 'chq' : r.PaymentOthers === true ? 'others' : 'cash');
        setNumber(s(r.PaymentNumber));
        setRemarks(s(r.PaymentRemarks));
        const ls = (lines ?? []).slice(0, 5);
        setSlotIds(SLOTS.map((i) => n(ls[i]?.PaymentPaidStudentId)));
        setSlotAmounts(SLOTS.map((i) => n(ls[i]?.PaymentPaidAmount)));
        setExtraNames(Object.fromEntries(ls.map((l) => [n(l.PaymentPaidStudentId), s(l.StudentFullName).trim()])));
        if (ls.length > 3) setShowMore(true);
        if (dl) { setDelivered(true); toast.info('Please note that this payment is already delivered'); }
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load payment.'))
      .finally(() => setLoading(false));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Per-student figures (currency, To Pay, discount, Paid Before at the date).
  const pickedKey = slotIds.filter((x) => x > 0).join(',');
  useEffect(() => {
    if (!semesterId || !pickedKey) { setInfos({}); return; }
    const req = ++linesReq.current;
    apiRequest<LineInfo[]>(`/api/portal/edit/group-payment-lines?semesterId=${semesterId}&date=${date}&paymentId=${paymentId}&studentIds=${pickedKey}`)
      .then((list) => {
        if (req !== linesReq.current) return;
        setInfos(Object.fromEntries(list.map((l) => [l.studentId, l])));
        // Legacy "Unregistered Student, Please Register First": the line resets.
        const missing = list.filter((l) => !l.registered).map((l) => l.studentId);
        if (missing.length && canEdit) {
          toast.error('Unregistered Student, Please Register First');
          setSlotIds((prev) => prev.map((x) => (missing.includes(x) ? 0 : x)));
        }
      })
      .catch(() => { if (req === linesReq.current) setInfos({}); });
  }, [semesterId, date, pickedKey, paymentId, canEdit]);

  // Legacy txtPaidAmount_TextChanged: LBP → same figure, USD → floor(paid × rate).
  function recalcTotal(paid: number, cur: string, r: number) {
    setTotalAmount(cur === 'LBP' ? paid : Math.floor(paid * r));
  }

  const regCurrency = useMemo(() => {
    for (const sid of slotIds) if (sid && infos[sid]?.currency) return infos[sid].currency;
    return '';
  }, [slotIds, infos]);

  /** Legacy TotalAmount / AmounttoDistribute in the semester currency. */
  const expectedTotal = useMemo(() => {
    if (regCurrency.toUpperCase() !== 'USD') return totalAmount;
    if (currency === 'USD') return paidAmount;
    return rate ? Math.trunc(paidAmount / rate) : 0;
  }, [regCurrency, currency, paidAmount, rate, totalAmount]);

  const linesSum = SLOTS.reduce<number>((sum, i) => (slotIds[i] > 0 ? sum + slotAmounts[i] : sum), 0);

  function pickStudent(slot: number, sid: number) {
    if (sid && slotIds.some((x, i) => i !== slot && x === sid)) {
      toast.error('You Have Chosen Identical Students, Please Correct');
      sid = 0;
    }
    setSlotIds((prev) => prev.map((x, i) => (i === slot ? sid : x)));
    if (!sid) setSlotAmounts((prev) => prev.map((x, i) => (i === slot ? 0 : x)));
  }

  function setAmount(slot: number, v: number) {
    setSlotAmounts((prev) => prev.map((x, i) => (i === slot ? v : x)));
    const info = infos[slotIds[slot]];
    if (info && info.netToPay - info.paidBefore - v < 0) toast.error('Exceeded Due, watch out!!!');
  }

  // Legacy BtnDistributePayment: split evenly, the last student takes the rest.
  function distribute() {
    const picked = SLOTS.filter((i) => slotIds[i] > 0);
    if (picked.length === 0) return;
    const each = Math.trunc(expectedTotal / picked.length);
    const next = [...slotAmounts];
    picked.forEach((slot, k) => { next[slot] = k === picked.length - 1 ? expectedTotal - each * (picked.length - 1) : each; });
    setSlotAmounts(next);
  }

  function validate(): string | null {
    if (!issuedTo.trim()) return 'Issued To is required.';
    if (!semesterId) return 'Please choose a semester.';
    if (!date) return 'The payment date is required.';
    const r = String(rate || '');
    if (r.replace(/0/g, '') === '' || r.length < 3) return 'Please fill in currency rate';
    if (!slotIds.some((x) => x > 0)) return 'Add at least one student to the payment.';
    if (expectedTotal !== linesSum) return 'Total Amount Not as Same as Sum of Payments, Please Check';
    if (expectedTotal === 0 && userType === 'user') return 'Amount Can not be Zero, Contact Site Admin';
    return null;
  }

  function payload(): Record<string, unknown> {
    return {
      PaymentSemesterId: semesterId,
      PaymentIssuedToTitle: title || ' ',
      PaymentIssuedTo: issuedTo.trim(),
      PaymentDate: date,
      PaymentTotalAmount: totalAmount,
      PaymentPaidAmount: paidAmount,
      PaymentPaidCurrencyRate: rate,
      PaymentPaidCurrency: currency,
      PaymentCash: method === 'cash',
      PaymentChq: method === 'chq',
      PaymentCC: method === 'cc',
      PaymentOthers: method === 'others',
      PaymentNumber: method === 'cash' ? '' : number,
      PaymentDeleted: false,
      PaymentRemarks: remarks,
      PaymentLocationId: payLocationId,
      lines: SLOTS.filter((i) => slotIds[i] > 0).map((i) => ({ studentId: slotIds[i], amount: slotAmounts[i] })),
    };
  }

  /** Saves (when allowed) and returns the payment id, or null on failure. */
  async function persist(): Promise<number | null> {
    if (!canEdit) return paymentId || null; // Print Only / Email Only
    const problem = validate();
    if (problem) { setError(problem); toast.error(problem); return null; }
    if (isNew) {
      const res = await apiRequest<{ id: number }>('/api/portal/edit/payment', { method: 'POST', body: JSON.stringify(payload()) });
      return res.id;
    }
    await apiRequest(`/api/portal/edit/payment/${id}`, { method: 'PUT', body: JSON.stringify(payload()) });
    return paymentId;
  }

  function goBack() { if (canGoBack()) navigate(-1); else navigate('/payments'); }

  async function onSave() {
    setBusy('save'); setError('');
    try {
      const pid = await persist();
      if (pid == null) return;
      toast.success(`Payment ${groupInvoiceId(pid)} saved.`);
      goBack();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed.';
      setError(msg); toast.error(msg);
    } finally { setBusy(''); }
  }

  async function onPrint() {
    // Open the tab now, while still inside the click (pop-up blockers).
    const w = window.open('', '_blank');
    setBusy('print'); setError('');
    try {
      const pid = await persist();
      if (pid == null) { w?.close(); return; }
      const r = await apiRequest<{ html: string; invoice: string }>(`/api/portal/edit/payment/${pid}/receipt`, {
        method: 'POST', body: JSON.stringify({ mode: 'print' }),
      });
      fillPrintWindow(w, r.html, `ProSwim Grp Class Invoice ${r.invoice}`);
      toast.success(`Invoice ${r.invoice} ready to print.`);
      goBack();
    } catch (e) {
      w?.close();
      const msg = e instanceof Error ? e.message : 'Could not print.';
      setError(msg); toast.error(msg);
    } finally { setBusy(''); }
  }

  async function onEmail() {
    setBusy('email'); setError('');
    try {
      const pid = await persist();
      if (pid == null) return;
      const r = await apiRequest<{ invoice: string; sentTo: string[]; failed: string[] }>(`/api/portal/edit/payment/${pid}/receipt`, {
        method: 'POST', body: JSON.stringify({ mode: 'email' }),
      });
      toast.success(`Email sent to the following emails: ${r.sentTo.join('; ') || '(none on file)'}`);
      if (r.failed.length) toast.error(`Not sent: ${r.failed.join('; ')}`);
      goBack();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not e-mail.';
      setError(msg); toast.error(msg);
    } finally { setBusy(''); }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="size-8 text-[#1e5c97] animate-spin" />
      </div>
    );
  }

  const studentOptions = (slot: number): Option[] => {
    const sid = slotIds[slot];
    if (!sid || students.some((o) => o.value === sid)) return students;
    return [...students, { value: sid, label: extraNames[sid] || infos[sid]?.name || `Student #${sid}` }];
  };
  const emails = Array.from(new Set(slotIds.filter((x) => x > 0).map((x) => infos[x]?.email).filter((e): e is string => !!e && e.length > 3)));
  const visibleSlots = showMore ? SLOTS : SLOTS.slice(0, 3);
  const cell = 'px-2 py-1.5';

  return (
    <div className={`p-6 md:p-8 max-w-5xl ${delivered ? 'bg-green-100 rounded-2xl' : ''}`}>
      <PageHero
        compact
        title={isNew ? 'New Group Payment' : `Invoice ID: ${groupInvoiceId(paymentId)}`}
        subtitle={isNew ? 'Record a payment, split across up to five students' : issuedTo}
        slide={1}
      />

      <SmartBack label="Back" fallback="/payments" />

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl p-3 mb-4">
          <AlertCircle className="size-4 text-red-500 shrink-0" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}
      {delivered && (
        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl p-3 mb-4">
          <Truck className="size-4 text-emerald-600 shrink-0" />
          <p className="text-sm text-emerald-800">Please note that this payment is already delivered.</p>
        </div>
      )}
      {!canEdit && (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 mb-4">
          <p className="text-sm text-amber-700">
            {isGuest || !canSave ? 'Your account has view-only access, saving is disabled.'
              : 'Only the SiteMaster can change a saved payment. You can print or e-mail the invoice.'}
          </p>
        </div>
      )}

      <div className="space-y-4">
        {/* Receipt */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-4">Receipt</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Location</label>
              <select
                value={locationId}
                disabled={!canEdit || userType === 'user'}
                onChange={(e) => {
                  keepSemester.current = false;
                  setLocationId(Number(e.target.value)); setSlotIds([0, 0, 0, 0, 0]); setSlotAmounts([0, 0, 0, 0, 0]);
                }}
                className={inputCls}
              >
                {locationId === 0 && <option value={0}>-</option>}
                {locations.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Semester</label>
              <select
                value={semesterId}
                disabled={!canEdit}
                onChange={(e) => { setSemesterId(Number(e.target.value)); setSlotIds([0, 0, 0, 0, 0]); setSlotAmounts([0, 0, 0, 0, 0]); }}
                className={inputCls}
              >
                <option value={0}>Not Selected</option>
                {semesters.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Date <span className="text-rose-500">*</span></label>
              <DateInput value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} disabled={!canEdit} />
            </div>
            <div className="md:col-span-2">
              <label className={labelCls}>Issued To <span className="text-rose-500">*</span></label>
              <div className="flex gap-2">
                <select value={title} onChange={(e) => setTitle(e.target.value)} className={`${inputCls} w-20`} disabled={!canEdit}>
                  {TITLES.map((t) => <option key={t} value={t}>{t.trim() || '-'}</option>)}
                </select>
                <input value={issuedTo} onChange={(e) => setIssuedTo(e.target.value)} placeholder="Payer name" className={inputCls} disabled={!canEdit} />
              </div>
            </div>
            <div>
              <label className={labelCls}>Pay Loc</label>
              <select value={payLocationId} onChange={(e) => setPayLocationId(Number(e.target.value))} className={inputCls} disabled={!canEdit}>
                <option value={0}>Not Selected</option>
                {locations.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Amounts */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-4">Amounts</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className={labelCls}>Paid Amount</label>
              <input type="number" min={0} step={1} value={paidAmount} disabled={!canEdit}
                onChange={(e) => { const v = Math.trunc(Number(e.target.value) || 0); setPaidAmount(v); recalcTotal(v, currency, rate); }}
                className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Currency</label>
              <select value={currency} disabled={!canEdit}
                onChange={(e) => { setCurrency(e.target.value); recalcTotal(paidAmount, e.target.value, rate); }}
                className={inputCls}>
                <option value="LBP">LBP</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>US TO LB</label>
              <input type="number" min={0} step={1} value={rate} disabled={!canEdit}
                onChange={(e) => { const v = Math.trunc(Number(e.target.value) || 0); setRate(v); recalcTotal(paidAmount, currency, v); }}
                className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>LBP Amount</label>
              <div className="flex gap-2">
                <input type="number" min={0} step={1} value={totalAmount} disabled={!canEdit}
                  onChange={(e) => setTotalAmount(Math.trunc(Number(e.target.value) || 0))}
                  className={`${inputCls} font-semibold`} title="LBP figure stored with the payment: paid amount for LBP, paid × rate for USD" />
                {canEdit && (
                  <button type="button" onClick={distribute} title="Split the payment across the chosen students"
                    className="flex items-center gap-1 rounded-lg border border-[#1e5c97]/30 px-2.5 text-xs font-semibold text-[#1e5c97] hover:bg-[#e8f0f8]">
                    <Divide className="size-3.5" /> Distribute
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-5 mt-4">
            {([['cash', 'Cash'], ['chq', 'Chq'], ['cc', 'C C'], ['others', 'Other']] as [Method, string][]).map(([val, label]) => (
              <label key={val} className="flex items-center gap-2 text-sm text-slate-700 select-none">
                <input type="radio" name="method" checked={method === val} onChange={() => setMethod(val)} className="accent-[#1e5c97]" disabled={!canEdit} /> {label}
              </label>
            ))}
            {method !== 'cash' && (
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-slate-500">Number</label>
                <input value={number} onChange={(e) => setNumber(e.target.value)} className={`${inputCls} w-40`} disabled={!canEdit} />
              </div>
            )}
          </div>
        </div>

        {/* Payment details */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 overflow-x-auto">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">Payment Details</p>
          <p className={`text-xs mb-3 ${linesSum === expectedTotal ? 'text-slate-400' : 'text-red-500 font-semibold'}`}>
            Students {money(linesSum)} of {money(expectedTotal)}{regCurrency ? ` ${regCurrency}` : ''}: the payments must add up to the total.
          </p>
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="text-xs text-slate-400 text-left">
                <th className={cell}>Student</th><th className={cell}>Curr</th><th className={cell}>Discount</th>
                <th className={`${cell} text-right`}>To Pay</th><th className={`${cell} text-right`}>Paid Before</th>
                <th className={`${cell} text-right`}>Payment</th><th className={`${cell} text-right`}>Still to Pay</th>
              </tr>
            </thead>
            <tbody>
              {visibleSlots.map((slot) => {
                const sid = slotIds[slot];
                const info = sid ? infos[sid] : undefined;
                const still = info ? info.netToPay - info.paidBefore - slotAmounts[slot] : 0;
                return (
                  <tr key={slot} className="border-t border-slate-50">
                    <td className={`${cell} min-w-56`}>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400 w-16">Student {slot + 1}</span>
                        <select value={sid} onChange={(e) => pickStudent(slot, Number(e.target.value))} className={inputCls} disabled={!canEdit}>
                          <option value={0}>Not Selected</option>
                          {studentOptions(slot).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>
                    </td>
                    <td className={`${cell} text-xs`}>{info?.currency ?? ''}</td>
                    <td className={`${cell} text-xs`} title={info?.discountTip ?? ''}>{info?.discount ?? ''}</td>
                    <td className={`${cell} text-right text-slate-500 tabular-nums`}>{sid ? money(info?.netToPay ?? 0) : '0'}</td>
                    <td className={`${cell} text-right text-slate-500 tabular-nums`}>{sid ? money(info?.paidBefore ?? 0) : '0'}</td>
                    <td className={`${cell} w-28`}>
                      <input type="number" min={0} step={1} value={slotAmounts[slot]} disabled={!canEdit || !sid}
                        onChange={(e) => setAmount(slot, Math.max(0, Math.trunc(Number(e.target.value) || 0)))}
                        className={`${inputCls} text-right`} />
                    </td>
                    <td className={`${cell} text-right tabular-nums ${still < 0 ? 'text-red-600 font-bold' : 'text-slate-500'}`}
                      title={still < 0 ? 'Exceeded Due, watch out!!!' : undefined}>
                      {sid ? money(still) : '0'}{still < 0 && <span className="ml-1 text-[10px]">Exceeded Due!</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <button type="button" onClick={() => setShowMore((v) => !v)} className="mt-2 text-xs font-semibold text-[#1e5c97] hover:underline">
            {showMore ? 'Hide' : 'More'}
          </button>
        </div>

        {/* Remarks */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Remarks</p>
          <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} className={inputCls} disabled={!canEdit} />
          {emails.length > 0 && (
            <p className="mt-3 text-xs text-slate-500">E-mail goes to: <span className="font-semibold text-slate-700">{emails.join('; ')}</span></p>
          )}
        </div>
      </div>

      {!isGuest && (canEdit || !isNew) && (
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button onClick={onEmail} disabled={busy !== '' || !semesterId}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white text-slate-700 text-sm font-semibold px-4 py-2.5 hover:bg-slate-50 disabled:opacity-50">
            {busy === 'email' ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
            {canEdit ? 'Save and Email' : 'Email Only'}
          </button>
          <button onClick={onPrint} disabled={busy !== '' || !semesterId}
            className="flex items-center gap-2 rounded-xl border border-[#1e5c97]/30 bg-white text-[#1e5c97] text-sm font-semibold px-4 py-2.5 hover:bg-[#e8f0f8] disabled:opacity-50">
            {busy === 'print' ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}
            {canEdit ? 'Save and Print' : 'Print Only'}
          </button>
          {canEdit && (
            <button onClick={onSave} disabled={busy !== ''}
              className="btn-grad flex items-center gap-2 rounded-xl text-sm font-semibold px-6 py-2.5 disabled:opacity-50">
              {busy === 'save' ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Save
            </button>
          )}
        </div>
      )}
    </div>
  );
}

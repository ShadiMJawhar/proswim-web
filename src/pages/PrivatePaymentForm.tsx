// Private payment form, port of PrivatePaymentsIndividual.aspx: one receipt
// against one private package (or an extra class / membership, ids >= 100000).
//
// Legacy rules kept here:
//  - Total amount is the LBP figure: LBP payments store the paid amount, USD
//    payments store floor(paid × rate). (The list "Amount" column sums it.)
//  - Package list = Active packages with a balance due (OnlyWithDue) for the
//    location; the package is locked once preselected or when editing.
//  - "Total / Paid / Due" of the package at the payment date, and the
//    "Amount higher than Due" guard; plain users cannot record a zero amount.
//  - Payment method is one of Cash / Cheque / Card / Others; the reference
//    number only applies to the last three.
//  - Only the SiteMaster can change a saved payment; others get Print / Email.
//  - Save & Print opens the legacy invoice (stored in tbl_Receipts); Save &
//    Email sends it to the ticked student e-mails with the terms footer.
//  - A payment that is already in a delivery shows a green warning.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Loader2, AlertCircle, Save, Printer, Mail, Truck } from 'lucide-react';
import { apiRequest, getStoredUser } from '../api/portalApi';
import { canGoBack } from '../lib/history';
import { DateInput } from '../components/DateInput';
import { toast } from '../components/Toast';
import { PageHero } from '../components/PageHero';
import { SmartBack } from '../components/SmartBack';
import { codedInvoiceId } from '../lib/invoice';

type Row = Record<string, unknown>;
type Option = { value: number; label: string };
type Picker = { id: number; label: string; currency?: string };
type Method = 'cash' | 'chq' | 'cc' | 'others';
type Context = {
  package: { id: number; label: string; currency: string; classType: string; locationNickName: string; netToPay: number };
  balance: { hasPayments: boolean; currency: string; total: number; paid: number; due: number };
  emails: { studentId: number; name: string; email: string }[];
};

const TITLES = ['', 'Mr.', 'Mrs.', 'Dr.'];
const EXTRA_FLOOR = 100000;

const inputCls =
  'w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e5c97]/40 disabled:bg-slate-50 disabled:text-slate-500';
const labelCls = 'block text-xs font-semibold text-slate-500 mb-1';

const s = (v: unknown) => (v == null ? '' : String(v));
const n = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const money = (v: number) => Math.round(v).toLocaleString(undefined, { maximumFractionDigits: 0 });
const dateOnly = (v: unknown) => { const str = s(v); return str.length >= 10 ? str.slice(0, 10) : ''; };
// Local calendar day (toISOString is UTC and gives yesterday just after midnight in Beirut).
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// Legacy RadNumericTextBox DecimalDigits=0 / int.Parse: amounts and rate are whole numbers.
const whole = (v: string) => (v.trim() === '' ? 0 : Math.round(Number(v)) || 0);

/** Opens the invoice HTML in a new tab and prints it. The window is opened by
 * the caller synchronously (pop-up blockers), we only fill it here. */
function fillPrintWindow(w: Window | null, html: string, title: string) {
  if (!w) { toast.error('The browser blocked the print window. Allow pop-ups for this site.'); return; }
  w.document.open();
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{margin:16px;font-family:Verdana,Arial,sans-serif;font-size:13px} @media print{body{margin:0}}</style></head>
<body onload="window.print()">${html}</body></html>`);
  w.document.close();
}

export function PrivatePaymentForm() {
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
  // Legacy: edit only for the SiteMaster with saving rights; others print/email only.
  const canEdit = isNew ? canSave : canSave && isSiteMaster;

  const [locations, setLocations] = useState<Option[]>([]);
  const [packages, setPackages] = useState<Picker[]>([]);
  const presetPackage = n(params.get('packageId'));
  const [packageLocked, setPackageLocked] = useState(presetPackage > 0 || !isNew);

  const [locationId, setLocationId] = useState(n(params.get('locationId')) || user?.primaryLocationId || 0);
  // Legacy Add New passed the list's location selection (?LocationID=hdnLocsIds):
  // the package dropdown lists that selection's packages, while the pay location
  // stays on the user's own location. Without it, follow the pay location.
  const listLocationIds = (params.get('locationIds') ?? '').split(',').map(Number).filter((x) => x > 0).join(',');
  const packageLocations = listLocationIds || String(locationId);
  const [packageId, setPackageId] = useState(presetPackage);
  const [ctx, setCtx] = useState<Context | null>(null);
  const [emailPick, setEmailPick] = useState<Record<string, boolean>>({});
  const [title, setTitle] = useState('');
  const [issuedTo, setIssuedTo] = useState('');
  const [date, setDate] = useState(today());
  const [currency, setCurrency] = useState('USD');
  const [rate, setRate] = useState(0);
  const [paidAmount, setPaidAmount] = useState(0);
  // Saved payment: legacy shows the stored LBP figure and only recomputes it
  // once the amount, currency or rate is changed (txtPaidAmount_TextChanged).
  const [storedTotal, setStoredTotal] = useState<number | null>(null);
  const [method, setMethod] = useState<Method>('cash');
  const [number, setNumber] = useState('');
  const [remarks, setRemarks] = useState('');
  const [showDue, setShowDue] = useState(true);
  const [serial, setSerial] = useState('');

  const [loading, setLoading] = useState(!isNew);
  const [busy, setBusy] = useState<'' | 'save' | 'print' | 'email'>('');
  const [error, setError] = useState('');
  const ctxReq = useRef(0);

  // Legacy txtPaidAmount_TextChanged: LBP → same figure; USD → floor(paid × rate).
  const totalAmount = useMemo(
    () => storedTotal ?? (currency === 'LBP' ? paidAmount : Math.floor(paidAmount * rate)),
    [storedTotal, currency, paidAmount, rate],
  );

  useEffect(() => {
    apiRequest<{ locations: { locationId: number; locationNickName: string | null }[] }>('/api/portal/students/lookups')
      .then((lk) => setLocations(lk.locations.map((l) => ({ value: l.locationId, label: l.locationNickName ?? `#${l.locationId}` }))))
      .catch(() => {});
  }, []);

  // Open packages with a due balance (new, unlocked only).
  useEffect(() => {
    if (isNew && !packageLocked) {
      apiRequest<Picker[]>(`/api/portal/edit/package-search?locationIds=${packageLocations}&onlyWithDue=true`)
        .then(setPackages)
        .catch(() => setPackages([]));
    }
  }, [packageLocations, isNew, packageLocked]);

  // Current USD rate of the pay location (new payments).
  useEffect(() => {
    if (isNew) {
      apiRequest<{ rate: number }>(`/api/portal/edit/currency-rate?locationId=${locationId}`)
        .then((r) => setRate((cur) => cur || r.rate))
        .catch(() => {});
    }
  }, [locationId, isNew]);

  // Existing payment.
  useEffect(() => {
    if (isNew) return;
    apiRequest<Row>(`/api/portal/edit/private-payment/${id}`)
      .then((r) => {
        setLocationId(n(r.PrivatePaymentLocationId ?? r.PrivatePaymentLocationID));
        setPackageId(n(r.PrivatePackageId));
        setTitle(s(r.PrivatePaymentIssuedToTitle).trim());
        setIssuedTo(s(r.PrivatePaymentIssuedTo));
        setDate(dateOnly(r.PrivatePaymentDate) || today());
        setCurrency(s(r.PrivatePaymentPaidCurrency) || 'USD');
        setRate(n(r.PrivatePaymentPaidCurrencyRate));
        setPaidAmount(n(r.PrivatePaymentPaidAmount));
        setStoredTotal(n(r.PrivatePaymentTotalAmount));
        setMethod(r.PrivatePaymentCC === true ? 'cc' : r.PrivatePaymentChq === true ? 'chq' : r.PrivatePaymentOthers === true ? 'others' : 'cash');
        setNumber(s(r.PrivatePaymentNumber));
        setRemarks(s(r.PrivatePaymentRemarks));
        setSerial(s(r.Serial).trim());
        setPackageLocked(true);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load payment.'))
      .finally(() => setLoading(false));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Package context: label, currency, balance at the payment date, student e-mails.
  useEffect(() => {
    if (!packageId) { setCtx(null); return; }
    const req = ++ctxReq.current;
    apiRequest<Context>(`/api/portal/edit/private-payment-context?packageId=${packageId}&date=${date}&notId=${paymentId}`)
      .then((c) => {
        if (req !== ctxReq.current) return;
        setCtx(c);
        setEmailPick((prev) => Object.fromEntries(c.emails.map((e) => [e.email, prev[e.email] ?? true])));
      })
      .catch(() => { if (req === ctxReq.current) setCtx(null); });
  }, [packageId, date, paymentId]);

  const pkg = ctx?.package;
  const bal = ctx?.balance;
  const sym = (c: string) => (c === 'LBP' ? 'LBP ' : '$');
  const classType = pkg?.classType && pkg.classType !== 'Private' ? pkg.classType : 'Private';
  const isExtra = packageId >= EXTRA_FLOOR;

  function validate(): string | null {
    if (!packageId) return 'Please Choose a Package to Add Payment For';
    if (!issuedTo.trim()) return 'Issued To is required.';
    if (!date) return 'The payment date is required.';
    if (!rate || rate < 100) return 'Please fill in currency rate';
    if (bal?.hasPayments && bal.due > 0 && paidAmount > bal.due && totalAmount > bal.due && (paidAmount < 2000 || totalAmount < 2000))
      return 'Amount higher than Due.';
    if (totalAmount === 0 && userType === 'user') return 'Amount Can not be Zero, Contact Site Admin';
    return null;
  }

  function payload(): Record<string, unknown> {
    return {
      PrivatePackageId: packageId,
      PrivatePaymentIssuedToTitle: title,
      PrivatePaymentIssuedTo: issuedTo.trim(),
      PrivatePaymentDate: date,
      PrivatePaymentPaidAmount: paidAmount,
      PrivatePaymentPaidCurrency: currency,
      PrivatePaymentPaidCurrencyRate: rate,
      PrivatePaymentTotalAmount: totalAmount,
      PrivatePaymentCash: method === 'cash',
      PrivatePaymentChq: method === 'chq',
      PrivatePaymentCC: method === 'cc',
      PrivatePaymentOthers: method === 'others',
      PrivatePaymentNumber: method === 'cash' ? '' : number,
      PrivatePaymentDeleted: false,
      PrivatePaymentRemarks: remarks,
      PrivatePaymentLocationId: locationId,
    };
  }

  /** Saves (when allowed) and returns the payment id, or null on failure. */
  async function persist(): Promise<number | null> {
    if (!canEdit) return paymentId || null; // print / email only
    const problem = validate();
    if (problem) { setError(problem); toast.error(problem); return null; }
    if (isNew) {
      const res = await apiRequest<{ id: number }>('/api/portal/edit/private-payment', { method: 'POST', body: JSON.stringify(payload()) });
      return res.id;
    }
    await apiRequest(`/api/portal/edit/private-payment/${id}`, { method: 'PUT', body: JSON.stringify(payload()) });
    return paymentId;
  }

  function goBack() { if (canGoBack()) navigate(-1); else navigate(isExtra ? '/ex-payments' : '/pr-payments'); }

  async function onSave() {
    setBusy('save'); setError('');
    try {
      const pid = await persist();
      if (pid == null) return;
      toast.success(`Payment ${codedInvoiceId(pid)} saved.`);
      goBack();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed.';
      setError(msg); toast.error(msg);
    } finally { setBusy(''); }
  }

  async function onPrint() {
    // Open the tab now, while we're still inside the click (pop-up blockers).
    const w = window.open('', '_blank');
    setBusy('print'); setError('');
    try {
      const pid = await persist();
      if (pid == null) { w?.close(); return; }
      const r = await apiRequest<{ html: string; invoice: string }>(`/api/portal/edit/private-payment/${pid}/receipt`, {
        method: 'POST', body: JSON.stringify({ mode: 'print', showDue }),
      });
      fillPrintWindow(w, r.html, `ProSwim Invoice ${r.invoice}`);
      toast.success(`Invoice ${r.invoice} ready to print.`);
      goBack();
    } catch (e) {
      w?.close();
      const msg = e instanceof Error ? e.message : 'Could not print.';
      setError(msg); toast.error(msg);
    } finally { setBusy(''); }
  }

  async function onEmail() {
    const emails = Object.entries(emailPick).filter(([, on]) => on).map(([e]) => e);
    if (emails.length === 0) { toast.error('Tick at least one e-mail address.'); return; }
    setBusy('email'); setError('');
    try {
      const pid = await persist();
      if (pid == null) return;
      const r = await apiRequest<{ invoice: string; sentTo: string[]; failed: string[] }>(`/api/portal/edit/private-payment/${pid}/receipt`, {
        method: 'POST', body: JSON.stringify({ mode: 'email', showDue, emails }),
      });
      if (r.sentTo.length) toast.success(`Invoice ${r.invoice} e-mailed to: ${r.sentTo.join(', ')}`);
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

  const knownPackage = packages.some((p) => p.id === packageId);
  const balanceText = !ctx ? '' : !bal?.hasPayments
    ? `No previous payments · package total ${sym(pkg!.currency)}${money(pkg!.netToPay)}`
    : `Total: ${sym(bal.currency)}${money(bal.total)}  Paid: ${sym(bal.currency)}${money(bal.paid)}  Due: ${sym(bal.currency)}${money(bal.due)}`;
  const emailList = ctx?.emails ?? [];

  return (
    <div className="p-6 md:p-8 max-w-3xl">
      <PageHero
        compact
        title={isNew ? `New ${classType} Payment` : `Invoice ${codedInvoiceId(paymentId)}`}
        subtitle={isNew ? `Record a payment against a ${classType.toLowerCase()} package` : `${issuedTo}${pkg ? ` · ${pkg.locationNickName}` : ''}`}
        slide={1}
      />

      <SmartBack label="Back" fallback={isExtra ? '/ex-payments' : '/pr-payments'} />

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl p-3 mb-4">
          <AlertCircle className="size-4 text-red-500 shrink-0" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}
      {serial.length > 2 && (
        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl p-3 mb-4">
          <Truck className="size-4 text-emerald-600 shrink-0" />
          <p className="text-sm text-emerald-800">Please note that this payment is already delivered (delivery {serial}).</p>
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
        {/* Package */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-4">Package</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Pay location</label>
              <select value={locationId} onChange={(e) => setLocationId(Number(e.target.value))} className={inputCls} disabled={!canEdit}>
                <option value={0}>-</option>
                {locations.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Package {!packageLocked && <span className="font-normal text-slate-400">(active, with a balance due)</span>}</label>
              {packageLocked ? (
                <input value={pkg?.label ?? (packageId ? `Package #${packageId}` : '')} disabled className={inputCls} />
              ) : (
                <select value={packageId} onChange={(e) => setPackageId(Number(e.target.value))} className={inputCls} disabled={!canEdit}>
                  <option value={0}>Not Selected</option>
                  {packages.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  {packageId > 0 && !knownPackage && <option value={packageId}>{pkg?.label ?? `Package #${packageId}`}</option>}
                </select>
              )}
              {balanceText && <p className="mt-1 text-xs font-semibold text-[#1e5c97]">{balanceText}</p>}
            </div>
            <div>
              <label className={labelCls}>Title</label>
              <select value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} disabled={!canEdit}>
                {TITLES.map((t) => <option key={t} value={t}>{t || '-'}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Issued to <span className="text-rose-500">*</span></label>
              <input value={issuedTo} onChange={(e) => setIssuedTo(e.target.value)} placeholder="Payer name" className={inputCls} disabled={!canEdit} />
            </div>
            <div>
              <label className={labelCls}>Date <span className="text-rose-500">*</span></label>
              <DateInput value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} disabled={!canEdit} />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-slate-700 select-none pb-2">
                <input type="checkbox" checked={showDue} onChange={(e) => setShowDue(e.target.checked)} className="accent-[#1e5c97]" />
                Due on invoice
              </label>
            </div>
          </div>
        </div>

        {/* Amounts */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-4">Amounts</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className={labelCls}>Paid amount</label>
              <input type="number" min={0} step={1} value={paidAmount} onChange={(e) => { setStoredTotal(null); setPaidAmount(whole(e.target.value)); }} className={inputCls} disabled={!canEdit} />
            </div>
            <div>
              <label className={labelCls}>Currency</label>
              <select value={currency} onChange={(e) => { setStoredTotal(null); setCurrency(e.target.value); }} className={inputCls} disabled={!canEdit}>
                <option value="USD">USD</option>
                <option value="LBP">LBP</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>USD to LBP rate</label>
              <input type="number" min={0} step={1} value={rate} onChange={(e) => { setStoredTotal(null); setRate(whole(e.target.value)); }} className={inputCls} disabled={!canEdit} />
            </div>
            <div>
              <label className={labelCls}>LBP amount</label>
              <input value={money(totalAmount)} disabled className={`${inputCls} font-semibold`} title="LBP figure stored with the payment: paid amount for LBP, paid × rate for USD" />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-5 mt-4">
            {([['cash', 'Cash'], ['chq', 'Cheque'], ['cc', 'Card'], ['others', 'Others']] as [Method, string][]).map(([val, label]) => (
              <label key={val} className="flex items-center gap-2 text-sm text-slate-700 select-none">
                <input type="radio" name="method" checked={method === val} onChange={() => setMethod(val)} className="accent-[#1e5c97]" disabled={!canEdit} /> {label}
              </label>
            ))}
            {method !== 'cash' && (
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-slate-500">Number</label>
                <input value={number} onChange={(e) => setNumber(e.target.value)} className={`${inputCls} w-40`} disabled={!canEdit} placeholder="Cheque / card ref." />
              </div>
            )}
          </div>
        </div>

        {/* Remarks + e-mails */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Remarks</p>
          <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} className={inputCls} disabled={!canEdit} />
          {emailList.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">E-mail invoice to</p>
              <div className="flex flex-wrap gap-4">
                {emailList.map((e) => (
                  <label key={e.email} className="flex items-center gap-2 text-sm text-slate-700 select-none" title={e.name}>
                    <input type="checkbox" checked={!!emailPick[e.email]} onChange={(ev) => setEmailPick((p) => ({ ...p, [e.email]: ev.target.checked }))} className="accent-[#1e5c97]" />
                    {e.email} <span className="text-xs text-slate-400">({e.name})</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {!isGuest && (
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button onClick={onEmail} disabled={busy !== '' || emailList.length === 0 || !packageId}
            title={emailList.length === 0 ? 'No student e-mail on file for this package' : 'Save and e-mail the invoice to the ticked addresses'}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white text-slate-700 text-sm font-semibold px-4 py-2.5 hover:bg-slate-50 disabled:opacity-50">
            {busy === 'email' ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
            {canEdit ? 'Save & Email' : 'Email only'}
          </button>
          <button onClick={onPrint} disabled={busy !== '' || !packageId}
            className="flex items-center gap-2 rounded-xl border border-[#1e5c97]/30 bg-white text-[#1e5c97] text-sm font-semibold px-4 py-2.5 hover:bg-[#e8f0f8] disabled:opacity-50">
            {busy === 'print' ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}
            {canEdit ? 'Save & Print' : 'Print only'}
          </button>
          {canEdit && (
            <button onClick={onSave} disabled={busy !== ''}
              className="btn-grad flex items-center gap-2 rounded-xl text-sm font-semibold px-6 py-2.5 disabled:opacity-50">
              {busy === 'save' ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {isNew ? 'Record payment' : 'Save changes'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

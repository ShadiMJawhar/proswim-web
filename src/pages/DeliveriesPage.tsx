// Payment deliveries, port of PaymentDeliverysList / PrivatePaymentDeliverysList
// and their popup pages. One component serves both variants: list with filters,
// an expandable detail (linked payment/expense lines), and a create flow that
// checks off undelivered lines and recomputes totals live (far simpler in React
// than the WebForms postback dance it replaces).
//
// The private variant mirrors PrivatePaymentDeliverysIndividual.aspx closely:
// location pinned to the user's primary location unless SiteMaster, editable
// generated/received dates, SiteMaster-only "Closed" on create, the per-currency
// split label, Cash/CC/Chq row colours, sortable 25-row paged list with a
// SiteMaster footer total, and a printable receipt per delivery.

import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  Loader2, AlertCircle, Plus, X, Truck, ChevronDown, ChevronRight, ChevronLeft, Lock, Unlock, Download,
  Printer, ArrowUp, ArrowDown, ArrowUpDown, Pencil,
} from 'lucide-react';
import { apiRequest, getStoredUser } from '../api/portalApi';
import { useUrlState, useUrlPatch } from '../lib/urlState';
import { DateInput } from '../components/DateInput';
import { PageHero } from '../components/PageHero';

import { useStickySort, routeGridKey } from '../lib/stickySort';
type Row = Record<string, unknown>;
type Option = { value: number; label: string };

// Proc columns keep their SQL casing and it differs between procs
// (Privatepaymentid / paidamount / Currency from the undelivered proc versus
// PaidAmount / currency from the delivery lines proc), so every read is
// case-insensitive.
const pick = (r: Row, k: string): unknown => {
  if (k in r) return r[k];
  const lk = k.toLowerCase();
  for (const key of Object.keys(r)) if (key.toLowerCase() === lk) return r[key];
  return undefined;
};
const num = (r: Row, k: string) => Number(pick(r, k) ?? 0);
const str = (r: Row, k: string) => { const v = pick(r, k); return v == null ? '' : String(v); };
const flag = (r: Row, k: string) => pick(r, k) === true;
const money = (v: unknown) => (v == null ? '-' : Number(v).toLocaleString());
// Legacy "###,###,##0" and "###,###,##0.##" formats.
const money0 = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 0 });
const money2 = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 2 });
const pad = (n: number) => String(n).padStart(2, '0');
const dmy = (v: unknown) => {
  if (!v) return '-';
  const d = new Date(String(v));
  if (isNaN(d.getTime())) return '-';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

interface Variant {
  title: string;
  subtitle: string;
  base: string;             // API path segment
  idKey: string;
  serialKey: string;
  amountKey: string;
  closedKey: string;
  recDateKey: string;
  hasSemester: boolean;     // group deliveries filter/group by semester
  paymentsKey: string;      // header totals column for payments
  issuedToKey: string;
  isPrivate: boolean;       // private-delivery rules (location lock, split, print, paging)
  lineIdKeys: string[];     // id column of a candidate/line row, first present wins
  pageSize: number;         // legacy GridView PageSize (Infinity = no paging)
}

const GROUP: Variant = {
  title: 'Payment Delivery',
  subtitle: 'Group payments & expenses handed over to ProSwim',
  base: 'deliveries',
  idKey: 'PaymentDeliveryId',
  serialKey: 'PaymentDeliverySerialNumber',
  amountKey: 'PaymentDeliveryTotalDifference',
  closedKey: 'PaymentDeliveryClosed',
  recDateKey: 'PaymentDeliveryRecievedDate',
  hasSemester: true,
  paymentsKey: 'PaymentDeliveryTotalPayments',
  issuedToKey: 'PaymentIssuedTo',
  isPrivate: false,
  lineIdKeys: ['IndividualID'],
  pageSize: Infinity,
};

const PRIVATE: Variant = {
  title: 'Private Payment Delivery',
  subtitle: 'Private payments handed over to ProSwim',
  base: 'private-deliveries',
  idKey: 'PrivatePaymentDeliveryId',
  serialKey: 'PrivatePaymentDeliverySerialNumber',
  amountKey: 'PrivatePaymentDeliveryAmount',
  closedKey: 'PrivatePaymentDeliveryClosed',
  recDateKey: 'PrivatePaymentDeliveryRecievedDate',
  hasSemester: false,
  paymentsKey: 'PrivatePaymentDeliveryTotalPayments',
  issuedToKey: 'PrivatePaymentIssuedTo',
  isPrivate: true,
  // P_PrivatePaymentDelivery_Payments_NotDelivered_Select keys rows on
  // Privatepaymentid (the group proc uses IndividualID).
  lineIdKeys: ['Privatepaymentid', 'IndividualID'],
  pageSize: 25,
};

function lineId(l: Row, variant: Variant): number {
  for (const k of variant.lineIdKeys) {
    const v = pick(l, k);
    if (v != null && v !== '') return Number(v);
  }
  return 0;
}

// Legacy LblPrivatePaymentsSplit: paid amounts per currency, plus the share
// coming from rows whose Mode is not "Private Payment" (extra classes).
function currencySplit(lines: Row[]): string {
  let lbp = 0, usd = 0, exLbp = 0, exUsd = 0;
  for (const l of lines) {
    const cur = str(l, 'Currency').toUpperCase();
    const paid = num(l, 'PaidAmount');
    const extra = str(l, 'Mode').toLowerCase() !== 'private payment';
    if (cur === 'LBP') { lbp += paid; if (extra) exLbp += paid; }
    else if (cur === 'USD') { usd += paid; if (extra) exUsd += paid; }
  }
  let text = `[ LBP ${money2(lbp)} + USD ${money2(usd)} ]`;
  if (exLbp + exUsd > 0) text += `  [Ex-Cls LBP ${money2(exLbp)} + USD ${money2(exUsd)}]`;
  return text;
}

// Legacy RowDataBound colours: Cash #66C866, CC #99C899, Chq #CCC8CC, each
// lightened when the Mode is not "Private Payment". Later matches win there
// (cash, then cc, then chq), hence the reversed test order.
function typeRowClass(l: Row): string {
  const t = str(l, 'Type').toLowerCase();
  const soft = str(l, 'Mode').toLowerCase() !== 'private payment';
  if (t.includes('chq')) return soft ? 'bg-stone-100' : 'bg-stone-200';
  if (t.includes('cc')) return soft ? 'bg-emerald-100' : 'bg-emerald-200';
  if (t.includes('cash')) return soft ? 'bg-green-100' : 'bg-green-300';
  return '';
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

// Reproduces the legacy BtnPrint receipt (PrivatePaymentDeliverysIndividual.aspx.cs).
function buildPrintHtml(header: Row, lines: Row[]): string {
  const cell = (v: string, bold = false) => `<td align="center">${bold ? '<b>' : ''}${esc(v)}${bold ? '</b>' : ''}</td>`;
  const lineRow = (l: Row) => `<tr>${cell(str(l, 'Mode'))}${cell(str(l, 'Type'))}${cell(dmy(pick(l, 'PEDate')))}`
    + `${cell(money0(num(l, 'Amount')), true)}${cell(money2(num(l, 'PaidAmount')), true)}${cell(str(l, 'Currency'), true)}`
    + `${cell(str(l, 'PrivatePaymentIssuedTo') || str(l, 'PaymentIssuedTo'))}</tr>`;
  const isExpense = (l: Row) => str(l, 'Mode').toLowerCase() === 'expense';
  const payments = lines.filter((l) => !isExpense(l));
  const expenses = lines.filter(isExpense);
  const tableHead = '<tr><td align="center">Mode</td><td align="center">Type</td><td align="center">Date</td>'
    + '<td align="center"><b>USD</b></td><td align="center"><b>PaidAmount</b></td><td align="center"><b>Currency</b></td>'
    + '<td align="center">Issued To</td></tr>';
  const serial = str(header, 'PrivatePaymentDeliverySerialNumber');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Private Payment Delivery ${esc(serial)}</title>
<style>body{font-family:Arial,Helvetica,sans-serif;font-size:13px;margin:24px}table{border-collapse:separate}
table.lines td{padding:4px 8px}h2,h3{margin:8px 0}</style></head><body>
<table cellspacing="3" cellpadding="3" width="100%">
<tr><td colspan="2"><h2>Private Package</h2></td><td colspan="2" align="right">Swimming Classes</td></tr>
<tr><td style="width:90px"></td><td style="width:200px"></td><td style="width:120px"></td><td style="width:150px"></td></tr>
<tr><td align="left">Serial Number:</td><td align="left"><b>${esc(serial)}</b></td>
<td align="left">Amount:</td><td align="left"><u><i><b>${esc(money2(num(header, 'PrivatePaymentDeliveryAmount')))}</b></i></u></td></tr>
<tr><td align="left">Location:</td><td align="left"><b>${esc(str(header, 'LocationNickName'))}</b></td></tr>
<tr><td align="left">Generated On:</td><td align="left"><b>${esc(dmy(pick(header, 'PrivatePaymentDeliveryGenerationDate')))}</b></td>
<td align="left">Recieved On:</td><td align="left"><b>${esc(dmy(pick(header, 'PrivatePaymentDeliveryRecievedDate')))}</b></td></tr>
<tr><td align="left">Remarks:</td><td align="left"><b>${esc(str(header, 'PrivatePaymentDeliveryRemarks'))}</b></td></tr>
<tr><td colspan="2"><h3>Private Payment Delivery Details</h3></td><td colspan="2" align="right"></td></tr>
<tr><td colspan="4" align="left"><p><b>${esc(currencySplit(lines))}</b></p></td></tr>
<tr><td colspan="4" align="left"><table class="lines" width="90%" border="1" style="border-style:solid">${tableHead}${payments.map(lineRow).join('')}</table></td></tr>
${expenses.length > 0 ? `<tr><td colspan="4" align="center"><table class="lines" width="90%" border="1" style="border-style:solid">${expenses.map(lineRow).join('')}</table></td></tr>` : ''}
</table></body></html>`;
}

// ── Group delivery (PaymentDeliverysIndividual.aspx) helpers ────────────────

// Legacy RowDataBound colours: Cash (102,255,102), CC (153,255,153), Chq
// (204,255,204), Expense (255,204,204); a payment of another semester than the
// delivery's is 40 darker with dark-red text.
function groupRowStyle(l: Row, semesterName: string): React.CSSProperties {
  const t = str(l, 'Type').toLowerCase();
  const mode = str(l, 'Mode').toLowerCase();
  let rgb: [number, number, number] | null = null;
  if (t.includes('cash')) rgb = [102, 255, 102];
  if (t.includes('cc')) rgb = [153, 255, 153];
  if (t.includes('chq')) rgb = [204, 255, 204];
  if (mode.includes('expense')) rgb = [255, 204, 204];
  const style: React.CSSProperties = {};
  if (!mode.includes('expense') && semesterName && !str(l, 'SemesterName').toLowerCase().includes(semesterName.toLowerCase())) {
    const base = rgb ?? [255, 255, 255];
    rgb = [base[0] - 40, base[1] - 40, base[2] - 40];
    style.color = '#8b0000';
  }
  if (rgb) style.backgroundColor = `rgb(${rgb.join(',')})`;
  return style;
}

/** Legacy group totals: Payments = Σ Amount (LBP figure) of the payment rows,
 *  Expenses = Σ Amount of the expense rows, Net = Payments − Expenses. */
function groupTotals(lines: Row[]) {
  let payments = 0, expenses = 0;
  for (const l of lines) {
    if (str(l, 'Mode').toLowerCase() === 'expense') expenses += num(l, 'Amount');
    else payments += num(l, 'Amount');
  }
  return { payments, expenses, net: payments - expenses };
}

// Legacy LblPaymentsSplit: paid amounts per currency, minus the expenses per
// currency and the resulting net when there are expenses.
function groupSplit(lines: Row[]): string {
  let pL = 0, pU = 0, eL = 0, eU = 0;
  for (const l of lines) {
    const cur = str(l, 'Currency').toUpperCase();
    const paid = num(l, 'PaidAmount');
    const exp = str(l, 'Mode').toLowerCase() === 'expense';
    if (cur === 'LBP') { if (exp) eL += paid; else pL += paid; }
    else if (cur === 'USD') { if (exp) eU += paid; else pU += paid; }
  }
  let text = `[ LBP ${money2(pL)} +  USD ${money2(pU)}]`;
  if (eL > 0 || eU > 0) text += ` - [ LBP ${money2(eL)} +  USD ${money2(eU)}]   >>  [ LBP ${money2(pL - eL)} +  USD ${money2(pU - eU)}]`;
  return text;
}

const fixed2 = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Reproduces the legacy group BtnPrint receipt (its heading really says
// "Private Package"); every grid row goes in the one details table.
function buildGroupPrintHtml(h: {
  serial: string; amount: number; location: string; semester: string; generated: string; received: string;
  payments: number; expenses: number; net: number; remarks: string;
}, lines: Row[]): string {
  const cell = (v: string, bold = false) => `<td align="center">${bold ? '<b>' : ''}${esc(v)}${bold ? '</b>' : ''}</td>`;
  const rows = lines.map((l) => `<tr>${cell(str(l, 'Mode'))}${cell(str(l, 'Type'))}${cell(dmy(pick(l, 'PEDate')))}`
    + `${cell(money0(num(l, 'Amount')), true)}${cell(money2(num(l, 'PaidAmount')), true)}${cell(str(l, 'Currency'), true)}`
    + `${cell(str(l, 'PaymentIssuedTo'))}</tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Payment Delivery ${esc(h.serial)}</title>
<style>body{font-family:Arial,Helvetica,sans-serif;font-size:13px;margin:24px}table.lines td{padding:4px 8px}h2,h3{margin:8px 0}</style></head><body>
<table cellspacing="3" cellpadding="3" width="100%">
<tr><td colspan="2"><h2>Private Package</h2></td><td colspan="2" align="right">Swimming Classes</td></tr>
<tr><td style="width:90px"></td><td style="width:200px"></td><td style="width:120px"></td><td style="width:150px"></td></tr>
<tr><td align="left">Serial Number:</td><td align="left"><b>${esc(h.serial)}</b></td><td align="left">Amount:</td><td align="left"><u><i><b>${esc(fixed2(h.amount))}</b></i></u></td></tr>
<tr><td align="left">Location:</td><td align="left"><b>${esc(h.location)}</b></td><td align="left">Semester:</td><td align="left"><b>${esc(h.semester)}</b></td></tr>
<tr><td align="left">Generated On:</td><td align="left"><b>${esc(h.generated)}</b></td><td align="left">Recieved On:</td><td align="left"><b>${esc(h.received)}</b></td></tr>
<tr><td align="left">Payments:</td><td align="left"><u><i><b>${esc(fixed2(h.payments))}</b></i></u></td><td align="left">Expenses:</td><td align="left"><u><i><b>${esc(fixed2(h.expenses))}</b></i></u></td></tr>
<tr><td align="left">Net to Deliver:</td><td align="left"><u><i><b>${esc(fixed2(h.net))}</b></i></u></td><td align="left">Remarks:</td><td align="left"><b>${esc(h.remarks)}</b></td></tr>
<tr><td colspan="2"><h3>Payment Delivery Details</h3></td><td colspan="2" align="right"></td></tr>
<tr><td colspan="4" align="left"><p><b>${esc(groupSplit(lines))}</b></p></td></tr>
<tr><td colspan="4" align="left"><table class="lines" width="90%" border="1" style="border-style:solid">
<tr><td align="center">Mode</td><td align="center">Type</td><td align="center">PEDate</td><td align="center"><b>USD</b></td><td align="center"><b>Paid</b></td><td align="center"><b>Currency</b></td><td align="center">Issued To</td></tr>
${rows}</table></td></tr>
</table></body></html>`;
}

/** Fills a tab opened synchronously inside the click (pop-up blockers) with
 *  the receipt and prints it. */
function printHtml(w: Window | null, html: string) {
  if (!w) { window.alert('Allow pop-ups for this site to print a delivery.'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 150);
}

/** Print header fields from a stored P_PaymentDelivery_Select row. */
function groupHeaderForPrint(h: Row) {
  return {
    serial: str(h, 'PaymentDeliverySerialNumber'), amount: num(h, 'PaymentDeliveryAmount'),
    location: str(h, 'LocationNickName'), semester: str(h, 'SemesterName'),
    generated: dmy(pick(h, 'PaymentDeliveryGenerationDate')), received: dmy(pick(h, 'PaymentDeliveryRecievedDate')),
    payments: num(h, 'PaymentDeliveryTotalPayments'), expenses: num(h, 'PaymentDeliveryTotalExpenses'),
    net: num(h, 'PaymentDeliveryTotalDifference'), remarks: str(h, 'PaymentDeliveryRemarks'),
  };
}

// Client-side sort + page machinery (legacy sorted/paged the cached DataTable).
function useGrid(rows: Row[], pageSize: number) {
  const [sortKey, setSortKey, sortAsc, setSortAsc] = useStickySort<string>(routeGridKey(), '');
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const arr = [...rows];
    arr.sort((a, b) => {
      const va = pick(a, sortKey), vb = pick(b, sortKey);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va).localeCompare(String(vb), undefined, { sensitivity: 'base', numeric: true });
      return sortAsc ? cmp : -cmp;
    });
    return arr;
  }, [rows, sortKey, sortAsc]);

  const pages = Number.isFinite(pageSize) ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const safePage = Math.min(page, pages - 1);
  const pageRows = Number.isFinite(pageSize) ? sorted.slice(safePage * pageSize, (safePage + 1) * pageSize) : sorted;

  function toggleSort(key: string) {
    if (sortKey === key) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(true); }
    setPage(0);
  }
  return { sorted, pageRows, pages, page: safePage, setPage, sortKey, sortAsc, toggleSort };
}
type Grid = ReturnType<typeof useGrid>;

function SortHeader({ label, k, grid, align = 'left' }: { label: string; k: string; grid: Grid; align?: 'left' | 'right' | 'center' }) {
  const just = align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : '';
  return (
    <th className={`text-${align}`}>
      <button type="button" onClick={() => grid.toggleSort(k)} className={`flex w-full items-center gap-1 hover:text-slate-600 ${just}`}>
        {label}
        {grid.sortKey === k
          ? grid.sortAsc ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />
          : <ArrowUpDown className="size-3 opacity-30" />}
      </button>
    </th>
  );
}

function Pager({ grid, total }: { grid: Grid; total: number }) {
  if (grid.pages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 p-3 text-sm text-slate-500">
      <span>{total.toLocaleString()} rows · page {grid.page + 1} / {grid.pages}</span>
      <button onClick={() => grid.setPage(Math.max(0, grid.page - 1))} disabled={grid.page === 0}
        className="rounded border border-slate-200 p-1 disabled:opacity-30"><ChevronLeft className="size-4" /></button>
      <button onClick={() => grid.setPage(Math.min(grid.pages - 1, grid.page + 1))} disabled={grid.page >= grid.pages - 1}
        className="rounded border border-slate-200 p-1 disabled:opacity-30"><ChevronRight className="size-4" /></button>
    </div>
  );
}

function DeliveriesPage({ variant }: { variant: Variant }) {
  const user = getStoredUser();
  const userType = (user?.userType || '').toLowerCase();
  const canSave = user?.canSave !== false && userType !== 'guest' && userType !== 'payment/audit';
  const isSiteMaster = userType === 'sitemaster';
  const primaryLocation = user?.primaryLocationId ?? 0;
  // Legacy private and group pages: the location dropdown is disabled for
  // everyone but a SiteMaster and sits on the user's primary location (group:
  // "Not Selected" = every location when the user has none).
  const lockLocation = !isSiteMaster;
  const noLocation = variant.isPrivate && lockLocation && !primaryLocation;
  // Legacy group grid: the Edit popup (with Print / Deleted / Closed) for all
  // but payment/audit.
  const canOpenGroup = !variant.isPrivate && userType !== 'payment/audit' && userType !== 'guest';

  const [rows, setRows] = useState<Row[]>([]);
  const [locations, setLocations] = useState<Option[]>([]);
  // Filters live in the URL so opening a delivery and coming back restores them.
  const [urlLocationId, setLocationId] = useUrlState('locationId', primaryLocation);
  const locationId = lockLocation ? primaryLocation : urlLocationId;
  const [search, setSearch] = useUrlState('search', '');
  const [showDeleted, setShowDeleted] = useUrlState('showDeleted', false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<{ header: Row; lines: Row[] } | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  // Group: legacy ddlSemester = the location's semesters ("Not Selected" = all),
  // opening on its current semester. -1 = not resolved yet for this location.
  const [semesterId, setSemesterId] = useUrlState('semesterId', -1);
  const [semOptions, setSemOptions] = useState<Option[]>([]);
  const patchUrl = useUrlPatch();

  useEffect(() => {
    apiRequest<{ locations: Option[] }>('/api/portal/modules/lookups')
      .then((lk) => setLocations(lk.locations ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!variant.hasSemester) return;
    if (!locationId) { setSemOptions([]); if (semesterId === -1) setSemesterId(0); return; }
    apiRequest<{ semesters: Row[]; selectedIds?: string }>(`/api/portal/modules/semester-options?locationIds=${locationId}&pick=current`)
      .then((r) => {
        setSemOptions((r.semesters ?? []).map((x) => ({ value: num(x, 'SemesterId'), label: str(x, 'SemesterName') })).filter((o) => o.value > 0));
        if (semesterId === -1) setSemesterId(Number(String(r.selectedIds ?? '').split(',')[0]) || 0);
      })
      .catch(() => { setSemOptions([]); if (semesterId === -1) setSemesterId(0); });
  }, [locationId, variant.hasSemester]); // eslint-disable-line react-hooks/exhaustive-deps

  function load() {
    if (noLocation) { setRows([]); setLoading(false); return; }
    if (variant.hasSemester && semesterId === -1) return; // the semester list resolves first
    setLoading(true);
    setError('');
    const q = new URLSearchParams();
    if (locationId) q.set('locationId', String(locationId));
    if (variant.hasSemester && semesterId > 0) q.set('semesterId', String(semesterId));
    if (search.trim()) q.set('searchFor', search.trim());
    if (showDeleted) q.set('deleted', 'true');
    apiRequest<Row[]>(`/api/portal/finance/${variant.base}?${q}`)
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load deliveries.'))
      .finally(() => setLoading(false));
  }
  useEffect(load, [locationId, showDeleted, semesterId]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleDetail(id: number) {
    if (openId === id) { setOpenId(null); setDetail(null); return; }
    setOpenId(id);
    setDetail(null);
    apiRequest<{ header: Row; lines: Row[] }>(`/api/portal/finance/${variant.base}/${id}`)
      .then(setDetail)
      .catch(() => setDetail(null));
  }

  async function setClosed(id: number, closed: boolean) {
    try {
      await apiRequest(`/api/portal/finance/${variant.base}/${id}`, {
        method: 'PUT', body: JSON.stringify({ closed }),
      });
      load();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Could not update the delivery.');
    }
  }

  // Legacy BtnPrint: the receipt opens in its own page and goes to the printer.
  // The tab is opened synchronously (inside the click) so pop-up blockers let
  // it through, then filled once the delivery has loaded.
  function printDelivery(id: number) {
    const w = window.open('', '_blank');
    if (!w) { window.alert('Allow pop-ups for this site to print a delivery.'); return; }
    w.document.write('<p style="font-family:sans-serif">Preparing the receipt…</p>');
    apiRequest<{ header: Row; lines: Row[] }>(`/api/portal/finance/${variant.base}/${id}`)
      .then((d) => {
        w.document.open();
        w.document.write(buildPrintHtml(d.header, d.lines));
        w.document.close();
        w.focus();
        setTimeout(() => w.print(), 150);
      })
      .catch(() => { w.document.body.innerHTML = '<p style="font-family:sans-serif">Could not load the delivery.</p>'; });
  }

  // Group: legacy Print from the Edit popup (stored delivery + its lines).
  function printGroupDelivery(id: number) {
    const w = window.open('', '_blank');
    apiRequest<{ header: Row; lines: Row[] }>(`/api/portal/finance/${variant.base}/${id}`)
      .then((d) => printHtml(w, buildGroupPrintHtml(groupHeaderForPrint(d.header), d.lines)))
      .catch(() => { w?.close(); window.alert('Could not load the delivery.'); });
  }

  const displayRows = rows;
  const grid = useGrid(displayRows, variant.pageSize);
  // Legacy footer sums the whole result, not the visible page.
  const amountTotal = useMemo(() => displayRows.reduce((s, r) => s + num(r, variant.amountKey), 0), [displayRows, variant.amountKey]);
  const groupFooter = useMemo(() => ({
    payments: displayRows.reduce((s, r) => s + num(r, 'PaymentDeliveryTotalPayments'), 0),
    expenses: displayRows.reduce((s, r) => s + num(r, 'PaymentDeliveryTotalExpenses'), 0),
    net: displayRows.reduce((s, r) => s + num(r, 'PaymentDeliveryTotalDifference'), 0),
  }), [displayRows]);

  function exportCsv() {
    const cols: [string, (r: Row) => string][] = [
      ['Location', (r) => str(r, 'LocationNickName')],
      ...(variant.hasSemester ? [['Semester', (r: Row) => str(r, 'SemesterName')] as [string, (r: Row) => string]] : []),
      ['S/N', (r) => str(r, variant.serialKey)],
      ...(variant.hasSemester ? [
        ['Payments', (r: Row) => String(num(r, 'PaymentDeliveryTotalPayments'))] as [string, (r: Row) => string],
        ['Expenses', (r: Row) => String(num(r, 'PaymentDeliveryTotalExpenses'))] as [string, (r: Row) => string],
      ] : []),
      [variant.hasSemester ? 'Net' : 'Amount', (r) => String(num(r, variant.amountKey))],
      ['Received', (r) => dmy(pick(r, variant.recDateKey))],
      ['Closed', (r) => (flag(r, variant.closedKey) ? 'Yes' : 'No')],
    ];
    const header = cols.map((c) => c[0]).join(',');
    const lines = grid.sorted.map((r) => cols.map((c) => `"${c[1](r).replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${variant.base}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const inputCls = 'rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e5c97]/40';
  const showActions = isSiteMaster || variant.isPrivate || canOpenGroup;
  const colCount = 10;

  return (
    <div className="p-6 md:p-8">
      <PageHero title={variant.title} subtitle={variant.subtitle} slide={3} />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
          placeholder="Search…" className={`${inputCls} w-44`} />
        <select value={locationId} disabled={lockLocation}
          onChange={(e) => {
            const v = Number(e.target.value);
            // Group: a new location re-resolves its current semester.
            if (variant.hasSemester) patchUrl({ locationId: v, semesterId: -1 }); else setLocationId(v);
          }}
          className={`${inputCls} disabled:bg-slate-50 disabled:text-slate-500`}
          title={lockLocation ? 'Only a SiteMaster can change the location' : undefined}>
          {(!variant.isPrivate || isSiteMaster) && <option value={0}>{variant.hasSemester ? 'Not Selected' : 'All locations'}</option>}
          {noLocation && <option value={0}>No location assigned</option>}
          {locations.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>
        {variant.hasSemester && (
          <select value={Math.max(0, semesterId)} onChange={(e) => setSemesterId(Number(e.target.value))} className={inputCls}>
            <option value={0}>Not Selected</option>
            {semOptions.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        )}
        <label className="flex items-center gap-1.5 text-sm text-slate-600 select-none">
          <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} className="accent-[#1e5c97]" />
          Deleted
        </label>
        <button onClick={load} className="rounded-lg bg-[#1e5c97] hover:bg-[#17497a] text-white text-sm font-semibold px-4 py-1.5">
          Search
        </button>
        {user?.canExport && displayRows.length > 0 && (
          <button onClick={exportCsv}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-[#1e5c97] hover:bg-slate-50">
            <Download className="size-4" /> Export
          </button>
        )}
        <div className="flex-1" />
        {canSave && !noLocation && (
          <button onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-4 py-1.5">
            <Plus className="size-4" /> New Delivery
          </button>
        )}
      </div>

      {noLocation && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-100 rounded-xl p-3 mb-4">
          <AlertCircle className="size-4 text-amber-500 shrink-0" />
          <p className="text-sm text-amber-700">
            Your account has no primary location, so private deliveries cannot be listed or created. Ask a SiteMaster to assign one.
          </p>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl p-3 mb-4">
          <AlertCircle className="size-4 text-red-500 shrink-0" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {!loading && !noLocation && (
        <p className="text-sm font-semibold text-[#1e5c97] mb-2">{displayRows.length.toLocaleString()} {variant.isPrivate ? 'Private Payments' : 'Payments'}</p>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-40"><Loader2 className="size-8 text-[#1e5c97] animate-spin" /></div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-soft overflow-x-auto">
          <table className="tbl w-full text-[15px] whitespace-nowrap [&_td]:py-3 [&_td]:px-4 [&_th]:py-3 [&_th]:px-4">
            <thead>
              <tr>
                <th className="!px-2" />
                {showActions && <th />}
                <SortHeader label="Location" k="LocationNickName" grid={grid} />
                {variant.hasSemester && <SortHeader label="Semester" k="SemesterName" grid={grid} />}
                <SortHeader label="S/N" k={variant.serialKey} grid={grid} />
                {variant.hasSemester && <SortHeader label="Payments" k="PaymentDeliveryTotalPayments" grid={grid} align="right" />}
                {variant.hasSemester && <SortHeader label="Expenses" k="PaymentDeliveryTotalExpenses" grid={grid} align="right" />}
                <SortHeader label={variant.hasSemester ? 'Net' : 'Amount'} k={variant.amountKey} grid={grid} align="right" />
                <SortHeader label="Received" k={variant.recDateKey} grid={grid} />
                <SortHeader label="Closed" k={variant.closedKey} grid={grid} align="center" />
              </tr>
            </thead>
            <tbody>
              {grid.pageRows.length === 0 && (
                <tr><td colSpan={colCount} className="text-center text-slate-400 py-6">No deliveries found.</td></tr>
              )}
              {grid.pageRows.map((r) => {
                const id = num(r, variant.idKey);
                const closed = flag(r, variant.closedKey);
                return (
                  <Fragment key={id}>
                    <tr onClick={() => toggleDetail(id)} className="cursor-pointer hover:bg-slate-50">
                      <td className="w-6 !px-2">{openId === id ? <ChevronDown className="size-4 text-slate-400" /> : <ChevronRight className="size-4 text-slate-400" />}</td>
                      {/* Actions first (user, 2026-10-24). */}
                      {showActions && (
                        <td onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-3">
                            {/* Legacy hides the Edit popup (where Print lives) from payment/audit. */}
                            {variant.isPrivate && userType !== 'payment/audit' && (
                              <button onClick={() => printDelivery(id)} title="Print receipt"
                                className="inline-flex items-center gap-1 text-xs font-bold text-[#1e5c97] hover:underline">
                                <Printer className="size-3.5" /> Print
                              </button>
                            )}
                            {canOpenGroup && (
                              <>
                                <button onClick={() => setEditId(id)} title="Open the delivery (Deleted / Closed, print)"
                                  className="inline-flex items-center gap-1 text-xs font-bold text-[#1e5c97] hover:underline">
                                  <Pencil className="size-3.5" /> Edit
                                </button>
                                <button onClick={() => printGroupDelivery(id)} title="Print receipt"
                                  className="inline-flex items-center gap-1 text-xs font-bold text-[#1e5c97] hover:underline">
                                  <Printer className="size-3.5" /> Print
                                </button>
                              </>
                            )}
                            {isSiteMaster && (
                              <button onClick={() => setClosed(id, !closed)}
                                title={closed ? 'Reopen' : 'Close'}
                                className="inline-flex items-center gap-1 text-xs font-bold text-[#1e5c97] hover:underline">
                                {closed ? <Unlock className="size-3.5" /> : <Lock className="size-3.5" />}
                                {closed ? 'Reopen' : 'Close'}
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                      <td>{str(r, 'LocationNickName') || '-'}</td>
                      {variant.hasSemester && <td>{str(r, 'SemesterName') || '-'}</td>}
                      <td className="font-semibold">{str(r, variant.serialKey)}</td>
                      {variant.hasSemester && <td className="text-right text-emerald-700 tabular-nums">{money(pick(r, 'PaymentDeliveryTotalPayments'))}</td>}
                      {variant.hasSemester && <td className="text-right text-red-600 tabular-nums">{money(pick(r, 'PaymentDeliveryTotalExpenses'))}</td>}
                      <td className="text-right font-bold tabular-nums">{money(pick(r, variant.amountKey))}</td>
                      <td>{dmy(pick(r, variant.recDateKey))}</td>
                      <td className="text-center">{closed ? <span className="text-emerald-700 font-bold">Yes</span> : ''}</td>
                    </tr>
                    {openId === id && (
                      <tr>
                        <td colSpan={colCount} className="bg-slate-50 p-3">
                          {!detail ? (
                            <span className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="size-4 animate-spin" /> Loading lines…</span>
                          ) : (
                            <>
                              {variant.isPrivate && <PrivateHeader header={detail.header} lines={detail.lines} />}
                              <DeliveryLines lines={detail.lines} variant={variant} semesterName={str(detail.header, "SemesterName")} />
                            </>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
            {variant.isPrivate && isSiteMaster && displayRows.length > 0 && (
              <tfoot>
                <tr className="bg-slate-50 font-bold">
                  <td />
                  {showActions && <td />}
                  <td colSpan={2} className="text-slate-500 text-sm">Total</td>
                  <td className="text-center tabular-nums">{money0(amountTotal)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
            {/* Legacy group footer (SiteMaster): Payments / Expenses / Net sums. */}
            {variant.hasSemester && isSiteMaster && displayRows.length > 0 && (
              <tfoot>
                <tr className="bg-slate-50 font-bold">
                  <td />
                  {showActions && <td />}
                  <td colSpan={3} className="text-slate-500 text-sm">Total</td>
                  <td className="text-right tabular-nums">{money0(groupFooter.payments)}</td>
                  <td className="text-right tabular-nums">{money0(groupFooter.expenses)}</td>
                  <td className="text-right tabular-nums">{money0(groupFooter.net)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
          <Pager grid={grid} total={displayRows.length} />
        </div>
      )}

      {creating && (
        <CreateDelivery
          variant={variant}
          locations={locations}
          initialLocation={locationId || primaryLocation}
          lockLocation={lockLocation}
          isSiteMaster={isSiteMaster}
          onClose={(saved) => { setCreating(false); if (saved) load(); }}
        />
      )}

      {editId != null && (
        <GroupDeliveryEditor
          id={editId}
          isSiteMaster={isSiteMaster}
          canSave={canSave}
          onClose={(saved) => { setEditId(null); if (saved) load(); }}
        />
      )}
    </div>
  );
}

// Legacy PaymentDeliverysIndividual.aspx in edit mode: the stored fields are
// read-only, "Deleted" can be ticked, "Closed" only by a SiteMaster, and Save
// is hidden on a closed delivery unless SiteMaster. Print reprints the receipt.
function GroupDeliveryEditor({ id, isSiteMaster, canSave, onClose }: {
  id: number; isSiteMaster: boolean; canSave: boolean; onClose: (saved: boolean) => void;
}) {
  const [data, setData] = useState<{ header: Row; lines: Row[] } | null>(null);
  const [deleted, setDeleted] = useState(false);
  const [closed, setClosed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apiRequest<{ header: Row; lines: Row[] }>(`/api/portal/finance/deliveries/${id}`)
      .then((d) => { setData(d); setDeleted(flag(d.header, 'PaymentDeliveryDeleted')); setClosed(flag(d.header, 'PaymentDeliveryClosed')); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the delivery.'));
  }, [id]);

  const h = data?.header ?? {};
  const wasClosed = flag(h, 'PaymentDeliveryClosed');
  const showSave = canSave && (!wasClosed || isSiteMaster);
  const semesterName = str(h, 'SemesterName');

  async function save() {
    setSaving(true); setError('');
    try {
      const body: Record<string, unknown> = { deleted };
      if (isSiteMaster) body.closed = closed;
      await apiRequest(`/api/portal/finance/deliveries/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      onClose(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the delivery.');
      setSaving(false);
    }
  }

  function print() {
    if (!data) return;
    printHtml(window.open('', '_blank'), buildGroupPrintHtml(groupHeaderForPrint(data.header), data.lines));
  }

  const ro = 'rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm w-full text-slate-600';
  const F = (label: string, value: string) => (
    <div key={label}><label className="block text-xs font-semibold text-slate-500 mb-1">{label}</label><input value={value} readOnly className={ro} /></div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-start justify-center overflow-y-auto p-4 md:p-10">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-base font-bold text-slate-800 flex items-center gap-2">
            <Truck className="size-5 text-[#1e5c97]" /> Payment Delivery {str(h, 'PaymentDeliverySerialNumber')}
          </p>
          <button onClick={() => onClose(false)}><X className="size-5 text-slate-400 hover:text-slate-600" /></button>
        </div>
        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl p-3 mb-3">
            <AlertCircle className="size-4 text-red-500 shrink-0" />
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}
        {!data ? (
          !error && <div className="flex items-center gap-2 py-6 text-sm text-slate-400"><Loader2 className="size-4 animate-spin" /> Loading…</div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
              {F("Location", str(h, 'LocationNickName'))}
              {F("Semester", semesterName)}
              {F("Serial #", str(h, 'PaymentDeliverySerialNumber'))}
              {F("Amount", fixed2(num(h, 'PaymentDeliveryAmount')))}
              {F("Generated On", dmy(pick(h, 'PaymentDeliveryGenerationDate')))}
              {F("Recieved On", dmy(pick(h, 'PaymentDeliveryRecievedDate')))}
              {F("Payments", fixed2(num(h, 'PaymentDeliveryTotalPayments')))}
              {F("Expenses", fixed2(num(h, 'PaymentDeliveryTotalExpenses')))}
              {F("Net to Deliver", fixed2(num(h, 'PaymentDeliveryTotalDifference')))}
              <div className="md:col-span-2">{F("Remarks", str(h, 'PaymentDeliveryRemarks'))}</div>
              <div className="flex items-end gap-4 pb-1.5">
                <label className="flex items-center gap-1.5 text-sm text-slate-600 select-none">
                  <input type="checkbox" checked={deleted} disabled={!showSave} onChange={(e) => setDeleted(e.target.checked)} className="accent-[#1e5c97]" />
                  Deleted
                </label>
                <label className="flex items-center gap-1.5 text-sm text-slate-600 select-none">
                  <input type="checkbox" checked={closed} disabled={!isSiteMaster || !showSave} onChange={(e) => setClosed(e.target.checked)} className="accent-[#1e5c97]" />
                  Closed
                </label>
              </div>
            </div>
            <p className="text-sm font-bold text-emerald-800 text-center mb-2">{groupSplit(data.lines)}</p>
            <div className="border border-slate-100 rounded-xl overflow-y-auto max-h-80 mb-4">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-slate-500">
                    <th className="text-left p-1.5">Mode</th><th className="text-left">Type</th><th className="text-left">PEDate</th>
                    <th className="text-right">Amount</th><th className="text-right">PaidAmount</th><th className="text-left px-1">Currency</th>
                    <th className="text-left">Issued_To</th><th className="text-left">SemesterName</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.map((l, i) => (
                    <tr key={i} style={groupRowStyle(l, semesterName)}>
                      <td className="p-1.5">{str(l, 'Mode')}</td><td>{str(l, 'Type')}</td><td>{dmy(pick(l, 'PEDate'))}</td>
                      <td className="text-right">{money0(num(l, 'Amount'))}</td><td className="text-right">{money0(num(l, 'PaidAmount'))}</td>
                      <td className="px-1">{str(l, 'Currency')}</td><td>{str(l, 'PaymentIssuedTo')}</td><td>{str(l, 'SemesterName')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={() => onClose(false)} className="rounded-lg border border-slate-200 text-sm font-semibold px-4 py-2">Close</button>
          <button onClick={print} disabled={!data}
            className="flex items-center gap-1.5 rounded-lg border border-[#1e5c97]/30 text-[#1e5c97] text-sm font-semibold px-4 py-2 disabled:opacity-50">
            <Printer className="size-4" /> Print
          </button>
          {showSave && (
            <button onClick={save} disabled={saving || !data}
              className="flex items-center gap-1.5 rounded-lg bg-[#1e5c97] hover:bg-[#17497a] text-white text-sm font-semibold px-5 py-2 disabled:opacity-50">
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Truck className="size-4" />}
              Save
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const Field = ({ label, value }: { label: string; value: string }) => (
  <div><span className="text-slate-400">{label}: </span><span className="font-semibold text-slate-700">{value}</span></div>
);

// Legacy edit popup header: the stored delivery fields plus the split label.
function PrivateHeader({ header, lines }: { header: Row; lines: Row[] }) {
  const h = header;
  return (
    <div className="mb-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1 text-xs mb-2">
        <Field label="Generated On" value={dmy(pick(h, 'PrivatePaymentDeliveryGenerationDate'))} />
        <Field label="Received On" value={dmy(pick(h, 'PrivatePaymentDeliveryRecievedDate'))} />
        <Field label="Total Payments" value={money2(num(h, 'PrivatePaymentDeliveryTotalPayments'))} />
        <Field label="Amount" value={money2(num(h, 'PrivatePaymentDeliveryAmount'))} />
        <Field label="Deleted" value={flag(h, 'PrivatePaymentDeliveryDeleted') ? 'Yes' : 'No'} />
        <Field label="Closed" value={flag(h, 'PrivatePaymentDeliveryClosed') ? 'Yes' : 'No'} />
        <div className="col-span-2"><Field label="Remarks" value={str(h, 'PrivatePaymentDeliveryRemarks') || '-'} /></div>
      </div>
      <p className="text-xs font-bold text-slate-700">{currencySplit(lines)}</p>
    </div>
  );
}

function DeliveryLines({ lines, variant, semesterName = "" }: { lines: Row[]; variant: Variant; semesterName?: string }) {
  if (lines.length === 0) return <p className="text-sm text-slate-400">No lines recorded.</p>;
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-slate-400">
          <th className="text-left py-1">Mode</th><th className="text-left">Type</th><th className="text-left">Date</th>
          <th className="text-right">Amount</th><th className="text-right">Paid</th><th className="text-left">Curr</th>
          <th className="text-left">Issued To</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l, i) => {
          const isExpense = str(l, 'Mode').toLowerCase() === 'expense';
          const cls = isExpense ? 'text-red-700' : variant.isPrivate ? typeRowClass(l) : '';
          return (
            <tr key={i} className={variant.isPrivate ? cls : ""} style={variant.isPrivate ? undefined : groupRowStyle(l, semesterName)}>
              <td className="py-0.5 px-1">{str(l, 'Mode')}</td>
              <td className="px-1">{str(l, 'Type')}</td>
              <td className="px-1">{dmy(pick(l, 'PEDate'))}</td>
              <td className="text-right px-1">{money(pick(l, 'Amount'))}</td>
              <td className="text-right px-1">{money(pick(l, 'PaidAmount'))}</td>
              <td className="px-1">{str(l, 'Currency')}</td>
              <td className="px-1">{str(l, variant.issuedToKey) || str(l, 'PaymentIssuedTo')}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function CreateDelivery({ variant, locations, initialLocation, lockLocation, isSiteMaster, onClose }: {
  variant: Variant;
  locations: Option[];
  initialLocation: number;
  lockLocation: boolean;
  isSiteMaster: boolean;
  onClose: (saved: boolean) => void;
}) {
  const [locationId, setLocationId] = useState(initialLocation);
  const [candidates, setCandidates] = useState<Row[] | null>(null);
  const [serial, setSerial] = useState('');
  const [semesterId, setSemesterId] = useState(0);
  const [semesterName, setSemesterName] = useState('');
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [remarks, setRemarks] = useState('');
  // Legacy defaults both dates to today; both stay editable.
  const [receivedDate, setReceivedDate] = useState(todayIso());
  const [generatedDate, setGeneratedDate] = useState(todayIso());
  const [closed, setClosed] = useState(false);
  // Group: legacy ddlSemesters (the location's semesters, current one first)
  // and the editable Amount, which starts at the Net and must equal it on save.
  const [semOptions, setSemOptions] = useState<Option[]>([]);
  const [amountText, setAmountText] = useState('0');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!locationId) { setCandidates(null); return; }
    setCandidates(null);
    setError('');
    apiRequest<{ lines: Row[]; serial: string; semesterId?: number; semesterName?: string }>(
      `/api/portal/finance/${variant.base}/candidates?locationId=${locationId}`,
    )
      .then((r) => {
        setCandidates(r.lines);
        setSerial(r.serial);
        setSemesterId(r.semesterId ?? 0);
        setSemesterName(r.semesterName ?? '');
        setChecked(new Set(r.lines.map((l) => lineId(l, variant))));
        if (variant.hasSemester) setAmountText(groupTotals(r.lines).net.toFixed(2));
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load undelivered lines.'));
    if (variant.hasSemester) {
      apiRequest<{ semesters: Row[] }>(`/api/portal/modules/semester-options?locationIds=${locationId}&pick=current`)
        .then((r) => setSemOptions((r.semesters ?? []).map((x) => ({ value: num(x, 'SemesterId'), label: str(x, 'SemesterName') })).filter((o) => o.value > 0)))
        .catch(() => setSemOptions([]));
    }
  }, [locationId, variant]);

  const checkedLines = useMemo(
    () => (candidates ?? []).filter((l) => checked.has(lineId(l, variant))),
    [candidates, checked, variant],
  );

  const totals = useMemo(() => {
    let payments = 0, expenses = 0;
    for (const l of checkedLines) {
      if (str(l, 'Mode').toLowerCase() === 'expense') expenses += num(l, 'Amount');
      else payments += num(l, 'Amount');
    }
    return { payments, expenses, net: payments - expenses };
  }, [checkedLines]);

  async function save() {
    if (checked.size === 0) { setError('Select at least one line.'); return; }
    if (variant.hasSemester && !semesterId) { setError('No current semester found for this location.'); return; }
    // Legacy BtnSaveChanges: "Total Amount Not as Same as Net to Deliver".
    if (variant.hasSemester && Math.round((Number(amountText.replace(/,/g, '')) || 0) * 100) !== Math.round(totals.net * 100)) {
      setError('Total Amount Not as Same as Net to Deliver, Please Check');
      return;
    }
    setSaving(true);
    setError('');
    const lines = checkedLines.map((l) => ({ individualId: lineId(l, variant), mode: str(l, 'Mode') }));
    const body: Record<string, unknown> = {
      locationId,
      serialNumber: serial,
      remarks,
      lines,
    };
    if (variant.hasSemester) {
      // Plain yyyy-mm-dd days, like the private variant (the API keeps the
      // legacy swap of the two date columns).
      Object.assign(body, {
        generationDate: generatedDate || todayIso(),
        receivedDate: receivedDate || todayIso(),
        semesterId,
        amount: Number(amountText.replace(/,/g, '')) || 0,
        totalPayments: totals.payments,
        totalExpenses: totals.expenses,
        totalDifference: totals.net,
      });
    } else {
      // Plain yyyy-mm-dd so the API stores the calendar day the user picked
      // (no timezone shift); the API maps each date onto its own column.
      Object.assign(body, {
        generationDate: generatedDate || todayIso(),
        receivedDate: receivedDate || todayIso(),
        amount: totals.payments,
        totalPayments: totals.payments,
        closed: isSiteMaster && closed,
      });
    }
    try {
      await apiRequest(`/api/portal/finance/${variant.base}`, { method: 'POST', body: JSON.stringify(body) });
      onClose(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the delivery.');
      setSaving(false);
    }
  }

  const inputCls = 'rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e5c97]/40';

  // Legacy group BtnPrint: prints the form as it stands (no save).
  function printGroup() {
    printHtml(window.open('', '_blank'), buildGroupPrintHtml({
      serial, amount: Number(amountText.replace(/,/g, '')) || 0,
      location: locations.find((l) => l.value === locationId)?.label ?? '', semester: semesterName,
      generated: dmy(generatedDate), received: dmy(receivedDate),
      payments: totals.payments, expenses: totals.expenses, net: totals.net, remarks,
    }, checkedLines));
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-start justify-center overflow-y-auto p-4 md:p-10">
      <div className={`bg-white rounded-2xl shadow-xl w-full ${variant.hasSemester ? 'max-w-4xl' : 'max-w-3xl'} p-5`}>
        <div className="flex items-center justify-between mb-4">
          <p className="text-base font-bold text-slate-800 flex items-center gap-2">
            <Truck className="size-5 text-[#1e5c97]" /> New {variant.title}
          </p>
          <button onClick={() => onClose(false)}><X className="size-5 text-slate-400 hover:text-slate-600" /></button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Location</label>
            <select value={locationId} disabled={lockLocation}
              onChange={(e) => setLocationId(Number(e.target.value))}
              className={`${inputCls} w-full disabled:bg-slate-50 disabled:text-slate-500`}
              title={lockLocation ? 'Only a SiteMaster can change the location' : undefined}>
              {(!variant.isPrivate || locationId === 0) && <option value={0}>Choose…</option>}
              {locations.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Serial</label>
            <input value={serial} readOnly className={`${inputCls} w-full bg-slate-50`} />
          </div>
          {variant.hasSemester && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Semester</label>
              <select value={semesterId}
                onChange={(e) => { const v = Number(e.target.value); setSemesterId(v); setSemesterName(semOptions.find((o) => o.value === v)?.label ?? ''); }}
                className={`${inputCls} w-full`}>
                {(semesterId === 0 || !semOptions.some((o) => o.value === semesterId)) && <option value={semesterId}>{semesterName || '-'}</option>}
                {semOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          )}
          {variant.hasSemester && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Amount</label>
              <input value={amountText} onChange={(e) => setAmountText(e.target.value)} className={`${inputCls} w-full text-right`} />
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Generated On</label>
            <DateInput value={generatedDate} onChange={(e) => setGeneratedDate(e.target.value)} className={`${inputCls} w-full`} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">{variant.isPrivate ? 'Received On' : 'Recieved On'}</label>
            <DateInput value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} className={`${inputCls} w-full`} />
          </div>
          {variant.isPrivate && isSiteMaster && (
            <label className="flex items-center gap-1.5 text-sm text-slate-600 select-none self-end pb-1.5">
              <input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} className="accent-[#1e5c97]" />
              Closed
            </label>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl p-3 mb-3">
            <AlertCircle className="size-4 text-red-500 shrink-0" />
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {!locationId ? (
          <p className="text-sm text-slate-400 py-4">Pick a location to load its undelivered lines.</p>
        ) : !candidates ? (
          <div className="flex items-center gap-2 py-4 text-sm text-slate-400"><Loader2 className="size-4 animate-spin" /> Loading undelivered lines…</div>
        ) : candidates.length === 0 ? (
          <p className="text-sm text-slate-400 py-4">Nothing waiting to be delivered at this location.</p>
        ) : (
          <div className="border border-slate-100 rounded-xl overflow-y-auto max-h-72 mb-3">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="text-slate-400">
                  <th className="p-1.5">
                    <input type="checkbox"
                      checked={checked.size === candidates.length}
                      onChange={(e) => setChecked(e.target.checked
                        ? new Set(candidates.map((l) => lineId(l, variant)))
                        : new Set())}
                      className="accent-[#1e5c97]" />
                  </th>
                  <th className="text-left">Mode</th><th className="text-left">Type</th><th className="text-left">Date</th>
                  <th className="text-right">Amount</th>
                  <th className="text-right">Paid</th>
                  <th className="text-left px-1">Curr</th><th className="text-left">Issued To</th>
                  {variant.hasSemester && <th className="text-left">Semester</th>}
                </tr>
              </thead>
              <tbody>
                {candidates.map((l) => {
                  const id = lineId(l, variant);
                  const isExpense = str(l, 'Mode').toLowerCase() === 'expense';
                  const cls = isExpense ? 'text-red-700' : variant.isPrivate ? typeRowClass(l) : '';
                  return (
                    <tr key={id} className={variant.isPrivate ? cls : ''} style={variant.isPrivate ? undefined : groupRowStyle(l, semesterName)}>
                      <td className="p-1.5 text-center">
                        <input type="checkbox" checked={checked.has(id)}
                          onChange={(e) => setChecked((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(id); else next.delete(id);
                            return next;
                          })}
                          className="accent-[#1e5c97]" />
                      </td>
                      <td>{str(l, 'Mode')}</td>
                      <td>{str(l, 'Type')}</td>
                      <td>{dmy(pick(l, 'PEDate'))}</td>
                      <td className="text-right">{money(pick(l, 'Amount'))}</td>
                      <td className="text-right">{money2(num(l, 'PaidAmount'))}</td>
                      <td className="px-1">{str(l, 'Currency')}</td>
                      <td>{str(l, variant.issuedToKey) || str(l, 'PaymentIssuedTo')}</td>
                      {variant.hasSemester && <td>{str(l, 'SemesterName')}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-4 mb-3 text-sm">
          <span className="text-emerald-700 font-bold">Payments: {totals.payments.toLocaleString()}</span>
          {variant.hasSemester && <span className="text-red-600 font-bold">Expenses: {totals.expenses.toLocaleString()}</span>}
          <span className="font-extrabold text-slate-900">
            {variant.hasSemester ? 'Net to deliver' : 'Total'}: {(variant.hasSemester ? totals.net : totals.payments).toLocaleString()}
          </span>
          {variant.isPrivate && candidates && candidates.length > 0 && (
            <span className="font-bold text-slate-700">{currencySplit(checkedLines)}</span>
          )}
          {variant.hasSemester && candidates && candidates.length > 0 && (
            <span className="font-bold text-emerald-800">{groupSplit(checkedLines)}</span>
          )}
        </div>

        <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2}
          placeholder="Remarks…" className={`${inputCls} w-full mb-4`} />

        <div className="flex justify-end gap-2">
          <button onClick={() => onClose(false)} className="rounded-lg border border-slate-200 text-sm font-semibold px-4 py-2">Cancel</button>
          {variant.hasSemester && (
            <button onClick={printGroup} disabled={!candidates}
              className="flex items-center gap-1.5 rounded-lg border border-[#1e5c97]/30 text-[#1e5c97] text-sm font-semibold px-4 py-2 disabled:opacity-50">
              <Printer className="size-4" /> Print
            </button>
          )}
          <button onClick={save} disabled={saving || checked.size === 0}
            className="flex items-center gap-1.5 rounded-lg bg-[#1e5c97] hover:bg-[#17497a] text-white text-sm font-semibold px-5 py-2 disabled:opacity-50">
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Truck className="size-4" />}
            Create Delivery
          </button>
        </div>
      </div>
    </div>
  );
}

export const PaymentDeliveriesPage = () => <DeliveriesPage variant={GROUP} />;
export const PrivateDeliveriesPage = () => <DeliveriesPage variant={PRIVATE} />;

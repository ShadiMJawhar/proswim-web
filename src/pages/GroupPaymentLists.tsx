// Group payment list pages, ported 1:1 from the legacy PaymentsList.aspx and
// PaymentsRptDue.aspx (filters, defaults, columns, totals and their role
// gating). Both use the multi-location + multi-semester pickers of the legacy
// RadComboBoxes (ModuleConfig.semesterPick).

import { Link } from 'react-router-dom';
import type { ModuleConfig, Row, FilterValues } from '../components/ModuleListPage';
import { getStoredUser } from '../api/portalApi';

const LOOKUPS = '/api/portal/modules/lookups';
const SITEMASTER = ['sitemaster'];
// Legacy PaymentsList shows its money totals to SiteMaster and payment/audit.
const PAY_TOTAL_ROLES = ['sitemaster', 'payment/audit'];

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const n0 = (v: number) => Math.round(v).toLocaleString('en-US');
const n2 = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 2 });
const role = () => (getStoredUser()?.userType ?? '').toLowerCase();

/** Legacy GetSelectedItemsComma length rule: ",1,16," (> 5 chars) = several locations. */
const commaLen = (v: unknown) => (String(v ?? '') ? `,${String(v)},`.length : 0);

/** Sum of `key` over rows whose `curKey` equals `cur`, or null when there are none
 *  (legacy DataTable.Compute returns DBNull, and the label part is skipped). */
function sumWhere(rows: Row[], key: string, curKey: string, cur: string): number | null {
  let any = false, total = 0;
  for (const r of rows) {
    if (String(r[curKey] ?? '').trim().toUpperCase() !== cur) continue;
    any = true;
    total += Number(r[key]) || 0;
  }
  return any ? total : null;
}

// Legacy txtMultiSemesters_SelectedIndexChanged: picking semesters moves "From"
// to the 1st of the month of the earliest selected semester start (all listed
// semesters when none is ticked, as Semester_Select("") returns them all).
function fromFirstSemester(next: FilterValues, ctx: { semesterRows: Row[] }): FilterValues {
  const ids = new Set(String(next.semesterIds ?? '').split(',').filter(Boolean));
  const pool = ids.size
    ? ctx.semesterRows.filter((r) => ids.has(String(r.SemesterId ?? r.SemesterID ?? '')))
    : ctx.semesterRows;
  const months = pool.map((r) => String(r.SemesterStart ?? '').slice(0, 7)).filter((m) => /^\d{4}-\d{2}$/.test(m)).sort();
  return months.length ? { ...next, dateFrom: `${months[0]}-01` } : next;
}

// Legacy LoadData: below SiteMaster a multi-location pick forces "Only Current
// Semester" (the API enforces it as well).
function forceCurrentSemester(next: FilterValues, ctx: { role: string }): FilterValues {
  return ctx.role !== 'sitemaster' && commaLen(next.locationIds) > 5 ? { ...next, onlyCurrentSemester: true } : next;
}

// ── Group payments (PaymentsList.aspx → P_Payment_Select) ────────────────────

export function groupPaymentsConfig(): ModuleConfig {
  // From = 1st of this month once past the 20th (else the 1st of last month),
  // To = 1 Jan next year.
  const d = new Date();
  const from = d.getDate() >= 20 ? new Date(d.getFullYear(), d.getMonth(), 1) : new Date(d.getFullYear(), d.getMonth() - 1, 1);
  const to = new Date(d.getFullYear() + 1, 0, 1);
  return {
    title: 'Group Payments',
    endpoint: '/api/portal/modules/payments',
    lookups: LOOKUPS,
    idKey: 'PaymentId',
    editBase: '/payments',
    semesterPick: 'upcoming',
    // Legacy LblResultCounts: "[LBP Σ amount of LBP payments] [USD Σ paid = LBP Σ amount]"
    // for SiteMaster and payment/audit.
    summary: {
      roles: PAY_TOTAL_ROLES,
      prefix: '',
      text: (rows) => {
        const parts: string[] = [];
        const lbp = sumWhere(rows, 'PaymentTotalAmount', 'PaymentPaidCurrency', 'LBP');
        if (lbp != null) parts.push(`[LBP ${n0(lbp)}]`);
        const usdLbp = sumWhere(rows, 'PaymentTotalAmount', 'PaymentPaidCurrency', 'USD');
        if (usdLbp != null) parts.push(`[USD ${n0(sumWhere(rows, 'PaymentPaidAmount', 'PaymentPaidCurrency', 'USD') ?? 0)} = LBP ${n0(usdLbp)}]`);
        return parts.join('  ');
      },
    },
    // Legacy: a SuperUser can only add while the picked locations include theirs
    // (a single picked location becomes the session location).
    canAddNew: (v, r) => {
      if (r !== 'superuser') return true;
      const picked = String(v.locationIds ?? '').split(',').filter(Boolean);
      return picked.length === 1 || picked.includes(String(getStoredUser()?.primaryLocationId ?? ''));
    },
    filters: [
      // The location change re-runs the semester cascade, which reloads the grid.
      { param: 'locationIds', label: 'Location', type: 'multiselect', optionsKey: 'locations', width: 'w-40', lockedFor: ['user', 'payment/audit'], derive: forceCurrentSemester },
      { param: 'semesterIds', label: 'Semester', type: 'multiselect', optionsKey: 'semesters', width: 'w-48', autoSubmit: true, derive: fromFirstSemester },
      { param: 'searchFor', label: 'Search…', type: 'text' },
      { param: 'dateFrom', label: 'From', type: 'date', initial: iso(from), autoSubmit: true },
      { param: 'dateTo', label: 'To', type: 'date', initial: iso(to), autoSubmit: true },
      { param: 'onlyCurrentSemester', label: 'Only Current Semester', type: 'checkbox', autoSubmit: true },
    ],
    // P_Payment_Select spells these locationNickName / paymentmode (exact SQL casing).
    columns: [
      { key: 'locationNickName', label: 'Location' },
      { key: 'SemesterName', label: 'Semester' },
      { key: 'IDShow', label: 'ID' },
      { key: 'IssuedTo', label: 'Issued To' },
      { key: 'PaymentDate', label: 'Date', format: 'date' },
      { key: 'PaymentTotalAmount', label: 'Amount', format: 'money', total: true, totalRoles: PAY_TOTAL_ROLES },
      { key: 'PaymentPaidAmount', label: 'Paid', format: 'money' },
      { key: 'PaymentPaidCurrency', label: 'Curr' },
      { key: 'paymentmode', label: 'Mode' },
      { key: 'Serial', label: 'Delivery S/N' },
      { key: 'PayLoc', label: 'PayLoc' },
      { key: '_pay', label: '' },
    ],
    renderCell: (row, col) => {
      switch (col.key) {
        case 'PaymentPaidAmount':
          return <span className="text-blue-900">{row.PaymentPaidAmount == null ? '-' : Number(row.PaymentPaidAmount).toLocaleString()}</span>;
        case 'PaymentPaidCurrency':
          return <span className="text-blue-900">{String(row.PaymentPaidCurrency ?? '-')}</span>;
        // Legacy "Pay" link: a new payment for the same students
        // (PaymentsIndividual.aspx?PaymentIDtoAddAnother=). Hidden for
        // payment/audit (like the legacy grid), guests and non-savers.
        case '_pay': {
          const u = getStoredUser();
          const r = role();
          if (r === 'guest' || r === 'payment/audit' || u?.canSave === false) return '';
          const q = new URLSearchParams({ fromPaymentId: String(row.PaymentId ?? ''), locationId: String(row.LocationId ?? '') });
          return (
            <Link
              to={`/payments/new?${q}`}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center text-xs font-bold text-emerald-700 hover:underline whitespace-nowrap"
            >
              Pay
            </Link>
          );
        }
        default:
          return undefined;
      }
    },
  };
}

// ── Due payments (PaymentsRptDue.aspx → P_Payment_Rpt_Due) ──────────────────

// Legacy _AccessReadOnly: below SiteMaster the pick must equal the session
// location, which a single picked location becomes, so several (or no)
// locations hide Phone / Total / Paid / OnHold.
const dueReadOnly = (v: FilterValues, r: string) =>
  r !== 'sitemaster' && String(v.locationIds ?? '').split(',').filter(Boolean).length !== 1;

export function groupPaymentsDueConfig(): ModuleConfig {
  return {
    title: 'Due Payments',
    endpoint: '/api/portal/modules/payments-due',
    lookups: LOOKUPS,
    semesterPick: 'upcoming',
    // Legacy LblResultCounts: "Records N", SiteMaster + ShowAmount adds the
    // Total / Paid / Due per semester currency, then everyone gets the
    // Collected % and Due % (over all currencies, like the legacy Compute).
    summary: {
      prefix: '',
      text: (rows, v) => {
        const parts: string[] = [];
        if (role() === 'sitemaster' && v.showAmount === true) {
          for (const [label, key] of [['Total', 'Total'], ['Paid', 'PaidAmount'], ['Due', 'DueAmount']] as const) {
            const lb = sumWhere(rows, key, 'SemesterCurrency', 'LBP');
            const us = sumWhere(rows, key, 'SemesterCurrency', 'USD');
            parts.push(`${label}: ${[lb != null ? `LB ${n2(lb)}` : '', us != null ? `US ${n2(us)}` : ''].filter(Boolean).join(' ')}`);
          }
        }
        const total = rows.reduce((s, r) => s + (Number(r.Total) || 0), 0);
        const paid = rows.reduce((s, r) => s + (Number(r.PaidAmount) || 0), 0);
        if (total) {
          parts.push(`[Collected %: ${n2((100 * paid) / total)}]`);
          parts.push(`[Due %: ${n2((100 * (total - paid)) / total)}]`);
        }
        return parts.join('   ');
      },
    },
    filters: [
      { param: 'searchFor', label: 'Search…', type: 'text' },
      { param: 'locationIds', label: 'Location', type: 'multiselect', optionsKey: 'locations', width: 'w-40', lockedFor: ['user'] },
      { param: 'semesterIds', label: 'Semester', type: 'multiselect', optionsKey: 'semesters', width: 'w-48', autoSubmit: true },
      { param: 'onlyDue', label: 'Only Due', type: 'checkbox', autoSubmit: true, disabledWhen: dueReadOnly },
      { param: 'showActive', label: 'Active', type: 'checkbox', initial: true, autoSubmit: true },
      { param: 'showStopped', label: 'Stopped', type: 'checkbox', initial: true, autoSubmit: true },
      // Only changes the header totals (SiteMaster).
      { param: 'showAmount', label: 'ShowAmount', type: 'checkbox', roles: SITEMASTER, submit: false },
      { param: 'onlyCurrentSemester', label: 'Only Current Semester', type: 'checkbox', autoSubmit: true },
    ],
    columns: [
      { key: 'SemesterName', label: 'Semester' },
      { key: 'StudentFullName', label: 'Student' },
      { key: 'Phone', label: 'Phone', hiddenWhen: dueReadOnly },
      { key: 'Total', label: 'Total', format: 'money', totalBy: 'SemesterCurrency', totalRoles: SITEMASTER, hiddenWhen: dueReadOnly },
      { key: 'PaidAmount', label: 'Paid', format: 'money', totalBy: 'SemesterCurrency', totalRoles: SITEMASTER, hiddenWhen: dueReadOnly },
      { key: 'RegistrationPaidPrevSemester', label: 'OnHold', format: 'money', totalBy: 'SemesterCurrency', totalRoles: SITEMASTER, hiddenWhen: dueReadOnly },
      { key: 'DueAmount', label: 'Due_Amnt', format: 'money', totalBy: 'SemesterCurrency', totalRoles: SITEMASTER },
      { key: 'DuePercent', label: 'Due_%' },
      { key: '_pay', label: '' },
      { key: '_attendance', label: '' },
    ],
    // Legacy RowDataBound: stopped registrations are tinted and struck through.
    rowClass: (row) => (row.RegistrationStudentStopped === true ? 'bg-[#e6c8c8] line-through' : ''),
    renderCell: (row, col) => {
      if (col.key === '_attendance') {
        return (
          <Link
            to={`/attendance-details?search=${encodeURIComponent(String(row.StudentFullName ?? ''))}`}
            target="_blank"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center text-xs font-bold text-[#1e5c97] hover:underline whitespace-nowrap"
          >
            Attendance
          </Link>
        );
      }
      if (col.key !== '_pay') return undefined;
      // Legacy "Add Payment": PaymentsIndividual.aspx?StudentId=&SemesterId=&LocationId=.
      const u = getStoredUser();
      const r = role();
      if (r === 'guest' || r === 'payment/audit' || u?.canSave === false) return '';
      const q = new URLSearchParams({
        studentId: String(row.Studentid ?? ''),
        semesterId: String(row.RegistrationSemesterId ?? ''),
        locationId: String(row.LocationId ?? ''),
      });
      return (
        <Link
          to={`/payments/new?${q}`}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 hover:underline whitespace-nowrap"
        >
          Add Payment
        </Link>
      );
    },
  };
}

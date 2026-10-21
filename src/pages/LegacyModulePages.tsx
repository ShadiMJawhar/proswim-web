// List pages for the legacy modules ported in this batch: expenses, private
// package types, payroll (timesheets / addons / coach attendance) and portal
// users. Each maps 1:1 to a legacy XxxList.aspx page via the new controllers.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, KeyRound, Calculator, Clock, Lock, Unlock } from 'lucide-react';
import { ModuleListPage, type ModuleConfig, type Row } from '../components/ModuleListPage';
import { apiRequest, getStoredUser } from '../api/portalApi';
import { fmtDateTime, toDate } from '../lib/dates';
import { toast } from '../components/Toast';

const LOOKUPS = '/api/portal/modules/lookups';

const ADDON_TYPES = [
  { value: 'Bonus', label: 'Bonus' },
  { value: 'LongLoan', label: 'Long Loan' },
  { value: 'Penalty', label: 'Penalty' },
];

// ── Expenses (ExpensesList.aspx) ─────────────────────────────────────────────

const expenses: ModuleConfig = {
  title: 'Expenses',
  subtitle: 'Cash expenses, loans and refunds',
  endpoint: '/api/portal/finance/expenses',
  lookups: LOOKUPS,
  idKey: 'ExpenseID',
  editBase: '/expenses',
  filters: [
    { param: 'searchFor', label: 'Search…', type: 'text' },
    { param: 'locationIds', label: 'Location', type: 'select', optionsKey: 'locations', width: 'max-w-36' },
    { param: 'semesterIds', label: 'Semester', type: 'select', optionsKey: 'semesters', width: 'max-w-44' },
    { param: 'coachId', label: 'Coach', type: 'select', optionsKey: 'coaches', width: 'max-w-36' },
    { param: 'dateFrom', label: 'From', type: 'date' },
    { param: 'dateTo', label: 'To', type: 'date' },
  ],
  columns: [
    { key: 'SemesterName', label: 'Semester' },
    { key: 'ExpenseDate', label: 'Date', format: 'date' },
    { key: 'ExpenseAmount', label: 'Amount', format: 'money', total: true },
    { key: 'ExpensePaidAmount', label: 'Paid', format: 'money', total: true },
    { key: 'ExpensePaidCurrency', label: 'Curr' },
    { key: 'ExpenseType', label: 'Type' },
    { key: 'ExpenseRemarks_WCoach', label: 'Remarks' },
    { key: 'Serial', label: 'Delivery S/N', extra: true },
  ],
};

// ── Private package types (PrivatePackagesSettings.aspx) ─────────────────────

const packTypes: ModuleConfig = {
  title: 'Pack Types',
  subtitle: 'Private package types & pricing',
  endpoint: '/api/portal/admin/pack-types',
  lookups: LOOKUPS,
  idKey: 'PrivatePackageId',
  editBase: '/pack-types',
  // Legacy: the location drop-down auto-posts back, is locked for 'user'
  // accounts, and the Add New popup opens on the selected location.
  newLinkParams: ['locationId'],
  filters: [
    { param: 'locationId', label: 'Location', type: 'select', optionsKey: 'locations', width: 'max-w-44', autoSubmit: true, lockedFor: ['user'] },
  ],
  columns: [
    // Legacy GVResult columns and header texts, in order; the currency was not
    // a legacy column, so it is an opt-in extra.
    { key: 'PrivatePackageName', label: 'Package Name' },
    { key: 'PrivatePackagePriceForOneStudent', label: 'PriceForOneStudent', format: 'money' },
    { key: 'PrivatePackagePriceForTwoStudents', label: 'PriceForTwoStudent', format: 'money' },
    { key: 'PrivatePackagePriceForThreeStudents', label: 'PriceForThreeStudent', format: 'money' },
    { key: 'PrivatePackageSessionsCount', label: 'Count' },
    { key: 'PrivatePackageActive', label: 'Active', format: 'bool' },
    { key: 'PrivatePackageCurrency', label: 'Curr', extra: true },
  ],
};

// ── Timesheets (TimesheetsList.aspx) ─────────────────────────────────────────

// Default the timesheet date range to this whole year — but during Q1 reach back
// to the start of last year (so recent timesheets from last year still show).
const TS_RANGE = (() => {
  const now = new Date();
  const y = now.getFullYear();
  const q1 = now.getMonth() + 1 <= 3;
  return { from: `${q1 ? y - 1 : y}-01-01`, to: `${y}-12-31` };
})();

// Mirrors TimesheetsAddonsList.aspx.cs Page_Load: From = the 1st of the month,
// rolled back to the PREVIOUS month while still in the first half (day < 16);
// To = Jan 1 of next year.
const ADDON_RANGE = (() => {
  const now = new Date();
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const fromMonth = now.getDate() < 16 ? now.getMonth() - 1 : now.getMonth(); // JS normalizes -1 → Dec of prior year
  return { from: iso(new Date(now.getFullYear(), fromMonth, 1)), to: iso(new Date(now.getFullYear() + 1, 0, 1)) };
})();

const isTimesheetOpen = (r: Row) => String(r.TimesheetStatus) === 'Open';

// Close / reopen a timesheet in place. Sitemaster only (the API gates it too).
// Re-sends the row with a changed status, so every other field is preserved.
function TimesheetStatusButton({ row, reload }: { row: Row; reload?: () => void }) {
  const [busy, setBusy] = useState(false);
  if ((getStoredUser()?.userType || '').toLowerCase() !== 'sitemaster') return null;
  const open = isTimesheetOpen(row);
  async function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    const next = open ? 'Closed' : 'Open';
    if (!window.confirm(`Mark this timesheet as ${next}?`)) return;
    setBusy(true);
    try {
      await apiRequest(`/api/portal/edit/timesheet/${row.TimesheetID}`, {
        method: 'PUT',
        body: JSON.stringify({ ...row, TimesheetStatus: next }),
      });
      toast.success(`Timesheet ${next.toLowerCase()}.`);
      reload?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the timesheet.');
      setBusy(false);
    }
  }
  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={open ? 'Close this timesheet' : 'Reopen this timesheet'}
      className={`inline-flex items-center gap-1 text-xs font-bold hover:underline ${open ? 'text-[#1e5c97]' : 'text-emerald-700'}`}
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : open ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}
      {open ? 'Close' : 'Reopen'}
    </button>
  );
}

const timesheets: ModuleConfig = {
  title: 'Timesheets',
  subtitle: 'Monthly payroll timesheets',
  endpoint: '/api/portal/payroll/timesheets',
  idKey: 'TimesheetID',
  editBase: '/payroll/timesheets',
  // Open = working (green tint); Closed = done (blue tint).
  rowClass: (r) => (isTimesheetOpen(r) ? 'bg-emerald-50/60' : 'bg-sky-50/50'),
  filters: [
    { param: 'dateFrom', label: 'From', type: 'date', initial: TS_RANGE.from },
    { param: 'dateTo', label: 'To', type: 'date', initial: TS_RANGE.to },
  ],
  columns: [
    { key: 'TimesheetYr', label: 'Year' },
    { key: 'TimesheetMonth', label: 'Month' },
    { key: 'TimesheetStartDate', label: 'Start', format: 'date' },
    { key: 'TimesheetEndDate', label: 'End', format: 'date' },
    { key: 'TimesheetStatus', label: 'Status' },
    { key: 'TimesheetRemarks', label: 'Remarks' },
    { key: '_payroll', label: '' },
    { key: '_hours', label: '' },
    { key: '_close', label: '' },
  ],
  renderCell: (row, col, reload) => {
    if (col.key === 'TimesheetStatus') {
      const s = String(row.TimesheetStatus ?? '');
      const cls = s === 'Open' ? 'bg-emerald-100 text-emerald-800'
        : s === 'ClosedNoPayment' ? 'bg-amber-100 text-amber-800'
        : 'bg-sky-100 text-sky-800';
      return <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 ${cls}`}>{s || '-'}</span>;
    }
    if (col.key === '_payroll') {
      return (
        <Link
          to={`/payroll/sheet/${row.TimesheetID}`}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-xs font-bold text-[#1e5c97] hover:underline"
        >
          <Calculator className="size-3.5" /> Payroll
        </Link>
      );
    }
    if (col.key === '_hours') {
      return (
        <Link
          to={`/payroll/hours/${row.TimesheetID}`}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-xs font-bold text-[#1e5c97] hover:underline"
        >
          <Clock className="size-3.5" /> Hours
        </Link>
      );
    }
    if (col.key === '_close') return <TimesheetStatusButton row={row} reload={reload} />;
    return undefined;
  },
};

// ── Addons (TimesheetsAddonsList.aspx) ───────────────────────────────────────

const addons: ModuleConfig = {
  title: 'Payroll Add-ons',
  subtitle: 'Bonuses, long loans and penalties',
  endpoint: '/api/portal/payroll/addons',
  lookups: LOOKUPS,
  idKey: 'AddonID',
  editBase: '/payroll/addons',
  filters: [
    { param: 'locationIds', label: 'Location', type: 'select', optionsKey: 'locations', width: 'max-w-36', autoSubmit: true },
    { param: 'type', label: 'Type', type: 'select', options: ADDON_TYPES, width: 'max-w-32' },
    { param: 'dateFrom', label: 'From', type: 'date', initial: ADDON_RANGE.from },
    { param: 'dateTo', label: 'To', type: 'date', initial: ADDON_RANGE.to },
    { param: 'byAddonDate', label: 'Addon Date', type: 'checkbox', initial: true },
    { param: 'byPaymentDate', label: 'Payment Date', type: 'checkbox', initial: true },
  ],
  columns: [
    { key: 'LocationIcon', label: 'Loc' },
    { key: 'AddonDate', label: 'Date', format: 'date' },
    { key: 'CoachFullName', label: 'Coach' },
    { key: 'AddonType', label: 'Type' },
    { key: 'AddonCurrency', label: 'Curr' },
    { key: 'AddonAmount', label: 'Amount', format: 'money', total: true },
    { key: 'Pay1', label: 'Pay 1', format: 'money' },
    { key: 'Pay2', label: 'Pay 2', format: 'money' },
    { key: 'Pay3', label: 'Pay 3', format: 'money' },
  ],
};

// ── Coach attendance (CoachsAttendancesList.aspx) ────────────────────────────

const coachAttendance: ModuleConfig = {
  title: 'Coach Attendance',
  subtitle: 'Absences, lateness and deductions',
  endpoint: '/api/portal/payroll/coach-attendance',
  lookups: LOOKUPS,
  idKey: 'Coaches_Attendance_ID',
  editBase: '/payroll/coach-attendance',
  filters: [
    { param: 'searchFor', label: 'Search…', type: 'text' },
    { param: 'locationIds', label: 'Location', type: 'select', optionsKey: 'locations', width: 'max-w-36', autoSubmit: true },
    { param: 'coachId', label: 'Coach', type: 'select', optionsKey: 'coaches', width: 'max-w-36' },
    { param: 'dateFrom', label: 'From', type: 'date' },
    { param: 'dateTo', label: 'To', type: 'date' },
    { param: 'needApproval', label: 'Need Approval', type: 'checkbox' },
    { param: 'deleted', label: 'Deleted', type: 'checkbox' },
  ],
  columns: [
    { key: 'Coaches_Attendance_Date', label: 'Date', format: 'date' },
    { key: 'CoachFullName', label: 'Coach' },
    { key: 'LocationIcon', label: 'Loc' },
    { key: 'Coaches_Attendance_Absent', label: 'Absent', format: 'bool' },
    { key: 'Coaches_Attendance_Late', label: 'Late', format: 'bool' },
    { key: 'Coaches_Attendance_EarlyLeave', label: 'Early', format: 'bool' },
    { key: 'ReasonName', label: 'Reason' },
    { key: 'Coaches_Attendance_AbsentTime', label: 'Time' },
    { key: 'Coaches_Attendance_Approved', label: 'Approved', format: 'bool' },
    { key: 'Coaches_Attendance_Approvedby', label: 'By', extra: true },
    { key: 'Coaches_Attendance_Remarks', label: 'Remarks', extra: true },
    { key: 'Coaches_Attendance_AbsentDeduct', label: 'Deduct', extra: true },
    { key: 'Coaches_Attendance_AbsentDeductReason', label: 'Deduct Reason', extra: true },
  ],
};

// ── Portal users (UsersList.aspx), passwords never leave the server ─────────

function ResetPasswordButton({ userId, name }: { userId: number; name: string }) {
  const [busy, setBusy] = useState(false);
  async function reset(e: React.MouseEvent) {
    e.stopPropagation();
    if (!window.confirm(`Reset the password for ${name}? A new temporary password will be generated.`)) return;
    setBusy(true);
    try {
      const r = await apiRequest<{ newPassword: string }>(`/api/portal/admin/users/${userId}/reset-password`, { method: 'POST' });
      window.alert(`New temporary password for ${name}:\n\n${r.newPassword}\n\nShare it now, it is not shown again.`);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not reset the password.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      onClick={reset}
      disabled={busy}
      className="inline-flex items-center gap-1 text-xs font-bold text-amber-700 hover:underline disabled:opacity-50"
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />} Reset
    </button>
  );
}

const users: ModuleConfig = {
  title: 'Users',
  subtitle: 'Portal user accounts & permissions',
  endpoint: '/api/portal/admin/users',
  idKey: 'UserID',
  editBase: '/users',
  filters: [
    { param: 'searchFor', label: 'Search…', type: 'text' },
    { param: 'deleted', label: 'Deleted', type: 'checkbox' },
  ],
  columns: [
    { key: 'UserFullName', label: 'Full Name' },
    { key: 'UserEmail', label: 'Email' },
    { key: 'UserPhoneNumber', label: 'Phone' },
    { key: 'UserType', label: 'Type' },
    { key: 'LocationNickName', label: 'Location' },
    { key: 'UserActive', label: 'Active', format: 'bool' },
    { key: 'UserLastLoginDate', label: 'Last Login', format: 'date' },
    { key: 'UserNumberofLogins', label: 'Logins', extra: true },
    { key: '_reset', label: '' },
  ],
  renderCell: (row, col) => {
    if (col.key !== '_reset') return undefined;
    return <ResetPasswordButton userId={Number(row.UserID)} name={String(row.UserFullName ?? '')} />;
  },
};

// ── Locations (LocationsList.aspx) ───────────────────────────────────────────

const locations: ModuleConfig = {
  title: 'Locations',
  subtitle: 'Branches & pools',
  endpoint: '/api/portal/modules/locations',
  idKey: 'LocationId',
  editBase: '/locations',
  filters: [
    { param: 'searchFor', label: 'Search…', type: 'text' },
    { param: 'school', label: 'Schools', type: 'checkbox' },
    { param: 'deleted', label: 'Deleted', type: 'checkbox' },
  ],
  columns: [
    { key: 'LocationNickName', label: 'Nick Name' },
    { key: 'LocationFullName', label: 'Full Name' },
    { key: 'LocationCity', label: 'City' },
    { key: 'LocationContact', label: 'Contact' },
    { key: 'LocationPhone1', label: 'Phone' },
    { key: 'LocationActive', label: 'Active', format: 'bool' },
    { key: 'LocationWebsite', label: 'Website', extra: true },
    { key: 'LocationColor', label: 'Color', extra: true },
    { key: 'LocationSchool', label: 'School', format: 'bool', extra: true },
    { key: 'LocationDeleted', label: 'Deleted', format: 'bool', extra: true },
  ],
};

// ── Main expenses (MainExpensesList.aspx) ────────────────────────────────────

const mainExpenses: ModuleConfig = {
  title: 'Main Expenses',
  subtitle: 'Company overhead (rent, maintenance, etc.)',
  endpoint: '/api/portal/modules/main-expenses',
  lookups: LOOKUPS,
  idKey: 'ExpenseId',
  editBase: '/main-expenses',
  filters: [
    { param: 'searchFor', label: 'Search…', type: 'text' },
    { param: 'locationIds', label: 'Location', type: 'select', optionsKey: 'locations', width: 'max-w-36' },
    { param: 'type', label: 'Type', type: 'select', optionsKey: 'mainExpenseTypes', width: 'max-w-56' },
    { param: 'dateFrom', label: 'From', type: 'date' },
    { param: 'dateTo', label: 'To', type: 'date' },
  ],
  columns: [
    { key: 'locationNickName', label: 'Location' },
    { key: 'ExpenseDate', label: 'Date', format: 'date' },
    { key: 'ExpenseType', label: 'Type' },
    { key: 'ExpenseAmount', label: 'Amount', format: 'money', total: true },
    { key: 'ExpensePaidAmount', label: 'Paid', format: 'money', total: true },
    { key: 'ExpensePaidCurrency', label: 'Curr' },
    { key: 'ExpenseAutoRenew', label: 'Auto Renew', format: 'bool' },
    { key: 'ExpenseRemarks', label: 'Remarks', extra: true },
  ],
};

export const LocationsListPage = () => <ModuleListPage config={locations} />;
export const MainExpensesListPage = () => <ModuleListPage config={mainExpenses} />;

// ── User activity log (UsersActivityList.aspx), read-only audit trail ────────

const userActivity: ModuleConfig = {
  title: 'User Activity',
  subtitle: 'Audit log of record changes (last 30 days by default)',
  endpoint: '/api/portal/modules/user-activity',
  idKey: 'ActivityId',
  filters: [
    { param: 'searchFor', label: 'Search…', type: 'text' },
    { param: 'type', label: 'Type', type: 'text', width: 'w-40' },
    { param: 'dateFrom', label: 'From', type: 'date' },
    { param: 'dateTo', label: 'To', type: 'date' },
  ],
  columns: [
    { key: 'ActivityDate', label: 'Date' },
    { key: 'UserFullName', label: 'User' },
    { key: 'ActivityType', label: 'Type' },
    { key: 'ActivityDesc', label: 'Description' },
    { key: 'ActivityColumnName', label: 'Column', extra: true },
    { key: 'ActivityValueBefore', label: 'Before', extra: true },
    { key: 'ActivityValueAfter', label: 'After', extra: true },
    { key: 'ActivityIPAddress', label: 'IP', extra: true },
    { key: 'ActivityURL', label: 'URL', extra: true },
  ],
  // Audit rows need the time, not just the date.
  renderCell: (row, col) => {
    if (col.key !== 'ActivityDate') return undefined;
    const d = toDate(row.ActivityDate);
    return d ? fmtDateTime(d) : undefined;
  },
};

// ── System change log (NotificationsList.aspx), audit feed of record changes ─

const CHANGE_TYPES = [
  'Gr_Payment Modified', 'Pr_Payment Modified', 'Pr_Package Deleted',
  'Pr_Package Modified', 'Pr_Pck_Status', 'Reg. Net2Pay Changed',
  'Reg. Student BACK', 'Reg. Student Stopped',
].map((t) => ({ value: t, label: t }));

// Map a legacy TR_Link (…Individual.aspx?…ID=n) to the equivalent portal route.
function traceLinkToRoute(link: string): string | null {
  const id = (re: RegExp) => { const m = link.match(re); return m ? m[1] : null; };
  const reg = id(/RegistrationID=(\d+)/i);
  if (reg) return `/registrations/${reg}`;
  const prPack = id(/PrivatePackageI[dD]=(\d+)/i) ?? id(/PackageID=(\d+)/i);
  if (prPack) return `/privates/${prPack}`;
  const prPay = id(/PrivatePaymentID=(\d+)/i);
  if (prPay) return `/pr-payments/${prPay}`;
  const pay = id(/PaymentID=(\d+)/i);
  if (pay) return `/payments/${pay}`;
  const stu = id(/StudentID=(\d+)/i);
  if (stu) return `/students/${stu}`;
  return null;
}

const changeLog: ModuleConfig = {
  title: 'Change Log',
  subtitle: 'Record changes: payments, packages, registrations (last 30 days by default)',
  endpoint: '/api/portal/modules/change-log',
  lookups: LOOKUPS,
  idKey: 'TR_ID',
  filters: [
    { param: 'searchFor', label: 'Search…', type: 'text' },
    { param: 'traceUser', label: 'By user', type: 'select', optionsKey: 'users', width: 'max-w-44' },
    { param: 'type', label: 'Type', type: 'select', options: CHANGE_TYPES, width: 'max-w-52' },
    { param: 'important', label: 'Importance', type: 'select', options: [{ value: 'NeedAttention', label: 'Need Attention' }] },
    { param: 'dateFrom', label: 'From', type: 'date' },
    { param: 'dateTo', label: 'To', type: 'date' },
  ],
  columns: [
    { key: 'TR_Date', label: 'Date' },
    { key: 'TR_User', label: 'User' },
    { key: 'TR_Title', label: 'Title' },
    { key: 'TR_Title2', label: 'Detail' },
    { key: 'TR_Description', label: 'Description' },
    { key: 'TR_Link', label: 'Open' },
  ],
  renderCell: (row, col) => {
    if (col.key === 'TR_Date') {
      const d = toDate(row.TR_Date);
      return d ? fmtDateTime(d) : undefined;
    }
    if (col.key === 'TR_Link') {
      const route = traceLinkToRoute(String(row.TR_Link ?? ''));
      return route
        ? <Link to={route} className="text-[#1e5c97] font-semibold hover:underline">Open</Link>
        : '-';
    }
    return undefined;
  },
};

export const UserActivityPage = () => <ModuleListPage config={userActivity} />;
export const ChangeLogPage = () => <ModuleListPage config={changeLog} />;
export const ExpensesListPage = () => <ModuleListPage config={expenses} />;
export const PackTypesPage = () => <ModuleListPage config={packTypes} />;
export const TimesheetsPage = () => <ModuleListPage config={timesheets} />;
export const AddonsListPage = () => <ModuleListPage config={addons} />;
export const CoachAttendancePage = () => <ModuleListPage config={coachAttendance} />;
export const UsersAdminPage = () => <ModuleListPage config={users} />;

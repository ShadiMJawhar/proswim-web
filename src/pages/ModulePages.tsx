import { Link } from 'react-router-dom';
import { ModuleListPage, type ModuleConfig, type Row, type ColumnDef, type FilterOption } from '../components/ModuleListPage';
import { getStoredUser } from '../api/portalApi';

// Configured list pages for the migrated legacy modules. Each maps 1:1 to a
// legacy XxxList.aspx page and its stored procedure (see PortalModulesController).

const LOOKUPS = '/api/portal/modules/lookups';

// Local-time "today" for date-filter defaults (toISOString would slip a day
// around midnight in UTC+ timezones).
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const PACKAGE_STATUSES = ['Active', 'Closed', 'ClosedNeedPayment', 'MovedtoGroup', 'Freeze', 'Cancelled', 'Transfer']
  .map((v) => ({ value: v, label: v }));

// Legacy txtPackageNeedAttention list (same values/order; "" = All Packs).
const NEED_ATTENTION = [
  { value: 'AttendanceMoreThanPayment1', label: 'Att. > Payment' },
  { value: 'AttendanceMoreThanPayment2', label: 'Att. >>> Payment' },
  { value: 'NeedFollowup', label: 'Need Followup' },
  { value: 'NeedPayment', label: 'Need Payment' },
  { value: 'NeedLevel', label: 'Need Level' },
  { value: 'NeedtoBeClosed', label: 'Need to Be Closed' },
  { value: 'Done1', label: 'Done 1' },
  { value: 'Done4', label: 'Done 4' },
  { value: 'Done10', label: 'Done 10' },
];

const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((v) => ({ value: v, label: v }));

// P_Private_Package_Select @SessionDay compares against DATEPART(dw) as text
// (Sun=1 … Sat=7), so the private list sends the legacy numeric values.
const PRIVATE_WEEK_DAYS = [
  { value: '2', label: 'Mon' }, { value: '3', label: 'Tue' }, { value: '4', label: 'Wed' },
  { value: '5', label: 'Thu' }, { value: '6', label: 'Fri' }, { value: '7', label: 'Sat' },
  { value: '1', label: 'Sun' },
];

const SITEMASTER = ['sitemaster'];

// Legacy PrivatePackagesList row tints by PackageStatus.
const PACKAGE_ROW_CLASS: Record<string, string> = {
  Closed: 'bg-green-100',
  ClosedNeedPayment: 'bg-orange-100',
  MovedtoGroup: 'bg-sky-100',
  Freeze: 'bg-pink-100',
  Cancelled: 'bg-yellow-100',
};

const EXTRA_TYPES = ['AquaBaby', 'AquaGym', 'AquaMermaid', 'MemberShipPasses', 'MemberShip', 'Others']
  .map((v) => ({ value: v, label: v }));

// Currency filter (blank = both, matching the endpoints' "USD,LBP" default).
const CURRENCIES = [{ value: 'USD', label: 'USD' }, { value: 'LBP', label: 'LBP' }];

// ── Registrations ────────────────────────────────────────────────────────────

const registrations: ModuleConfig = {
  title: 'Registrations',
  endpoint: '/api/portal/modules/registrations',
  lookups: LOOKUPS,
  idKey: 'RegistrationID',
  editBase: '/registrations',
  filters: [
    { param: 'searchFor', label: 'Search student…', type: 'text' },
    // P_Registration_Select takes no location, the location picker scopes the
    // semester list, and the semester scopes the rows.
    { param: 'locationIds', label: 'Location', type: 'select', optionsKey: 'locations', width: 'max-w-36', submit: false },
    { param: 'semesterIds', label: 'Semester', type: 'select', optionsKey: 'semesters', width: 'max-w-44' },
    { param: 'coachId', label: 'Coach', type: 'select', optionsKey: 'coaches', width: 'max-w-36' },
    { param: 'classId', label: 'Class', type: 'select', optionsKey: 'classes', width: 'max-w-56' },
    { param: 'calculateDate', label: 'Dues as of', type: 'date' },
    { param: 'active', label: 'Active', type: 'checkbox', initial: true },
    { param: 'stopped', label: 'Stopped', type: 'checkbox', initial: true },
    { param: 'withDiscount', label: 'With Discount', type: 'checkbox' },
    { param: 'onlyDue', label: 'Only Due', type: 'checkbox' },
  ],
  columns: [
    { key: 'StudentFullName', label: 'Student' },
    { key: 'PhoneNumber1', label: 'Phone' },
    { key: 'RegistrationNumberOfTimes', label: 'Times' },
    { key: 'ClassName1', label: 'Class 1' },
    { key: 'ClassName2', label: 'Class 2' },
    { key: 'Status', label: 'Status' },
    { key: 'SemesterName', label: 'Semester' },
    { key: 'RegistrationDate', label: 'Start', format: 'date' },
    { key: 'DOB', label: 'DOB', format: 'date', extra: true },
    { key: 'ClassName3', label: 'Class 3', extra: true },
    { key: 'DiscountFullRemark', label: 'Remarks', extra: true },
    { key: 'RegistrationCost', label: 'Total', format: 'money', extra: true },
    { key: 'RegistrationDiscount', label: 'Disc', format: 'money', extra: true },
    { key: 'RegistrationNetToPay', label: 'Net', format: 'money', extra: true },
    { key: 'PaidAmount', label: 'Paid', format: 'money', extra: true },
    { key: 'DueAmount', label: 'Due', format: 'money', extra: true },
    { key: 'SessionsTotal', label: 'S-Total', extra: true },
    { key: 'SessionsAttended', label: 'S-Attended', extra: true },
    { key: 'SessionsMissed', label: 'S-Missed', extra: true },
    { key: 'SessionsNet', label: 'S-Net', extra: true },
    { key: 'SessionsCancelled', label: 'S-Cancelled', extra: true },
    { key: 'SessionsToBeAttended', label: 'S-ToAttend', extra: true },
    { key: 'PhoneNumber2', label: 'Phone 2', extra: true },
    { key: 'RegistrationStudentStoppedReason', label: 'Stop Reason', extra: true },
    { key: 'RegistrationStudentStoppedDate', label: 'Stop Date', format: 'date', extra: true },
    { key: 'RegistrationStudentStoppedMoneyOnHold', label: 'On Hold', format: 'money', extra: true },
    { key: 'RegistrationVariation', label: 'Variation', format: 'money', extra: true },
    { key: 'AmountUsed', label: 'Used', format: 'money', extra: true },
    { key: 'Net2PayCalc', label: 'Net to Pay', format: 'money', extra: true },
  ],
  // The student name opens the full registration form (like the legacy popup);
  // guests are blocked from the record endpoint, so they get plain text.
  renderCell: (row, col) => {
    if (col.key !== 'StudentFullName') return undefined;
    if ((getStoredUser()?.userType || '').toLowerCase() === 'guest') return undefined;
    return (
      <Link
        to={`/registrations/${row.RegistrationID}`}
        onClick={(e) => e.stopPropagation()}
        className="font-semibold text-[#1e5c97] hover:underline"
      >
        {String(row.StudentFullName ?? '')}
      </Link>
    );
  },
};

// ── Group payments ───────────────────────────────────────────────────────────

const payments: ModuleConfig = {
  title: 'Group Payments',
  endpoint: '/api/portal/modules/payments',
  lookups: LOOKUPS,
  idKey: 'PaymentID',
  editBase: '/payments',
  filters: [
    { param: 'searchFor', label: 'Search…', type: 'text' },
    { param: 'locationIds', label: 'Location', type: 'select', optionsKey: 'locations', width: 'max-w-36' },
    { param: 'semesterIds', label: 'Semester', type: 'select', optionsKey: 'semesters', width: 'max-w-44' },
    { param: 'dateFrom', label: 'From', type: 'date' },
    { param: 'dateTo', label: 'To', type: 'date' },
    { param: 'onlyCurrentSemester', label: 'Current Semester Only', type: 'checkbox' },
  ],
  columns: [
    { key: 'LocationNickName', label: 'Location' },
    { key: 'SemesterName', label: 'Semester' },
    { key: 'IDShow', label: 'ID' },
    { key: 'IssuedTo', label: 'Issued To' },
    { key: 'PaymentDate', label: 'Date', format: 'date' },
    { key: 'PaymentTotalAmount', label: 'Amount', format: 'money' },
    { key: 'PaymentPaidAmount', label: 'Paid', format: 'money' },
    { key: 'PaymentPaidCurrency', label: 'Curr' },
    { key: 'PaymentMode', label: 'Mode' },
    { key: 'Serial', label: 'Delivery S/N', extra: true },
    { key: 'PayLoc', label: 'Pay Loc', extra: true },
  ],
};

// ── Due payments ─────────────────────────────────────────────────────────────

const paymentsDue: ModuleConfig = {
  title: 'Due Payments',
  endpoint: '/api/portal/modules/payments-due',
  lookups: LOOKUPS,
  filters: [
    { param: 'searchFor', label: 'Search…', type: 'text' },
    { param: 'locationIds', label: 'Location', type: 'select', optionsKey: 'locations', width: 'max-w-36' },
    { param: 'semesterIds', label: 'Semester', type: 'select', optionsKey: 'semesters', width: 'max-w-44' },
    { param: 'onlyDue', label: 'Only With Due', type: 'checkbox' },
    { param: 'showActive', label: 'Active', type: 'checkbox', initial: true },
    { param: 'showStopped', label: 'Stopped', type: 'checkbox', initial: true },
    { param: 'onlyCurrentSemester', label: 'Current Semester Only', type: 'checkbox' },
  ],
  columns: [
    { key: 'SemesterName', label: 'Semester' },
    { key: 'StudentFullName', label: 'Student' },
    { key: 'Phone', label: 'Phone' },
    { key: 'Total', label: 'Total', format: 'money' },
    { key: 'PaidAmount', label: 'Paid', format: 'money' },
    { key: 'RegistrationPaidPrevSemester', label: 'On Hold', format: 'money' },
    { key: 'DueAmount', label: 'Due', format: 'money' },
    { key: 'DuePercent', label: 'Due %' },
    { key: '_pay', label: '' },
  ],
  // Quick jump to a new payment, prefilled with this student + semester.
  renderCell: (row, col) => {
    if (col.key !== '_pay') return undefined;
    const u = getStoredUser();
    if ((u?.userType || '').toLowerCase() === 'guest' || u?.canSave === false) return undefined;
    const q = new URLSearchParams({
      studentId: String(row.Studentid ?? ''),
      studentName: String(row.StudentFullName ?? ''),
      semesterId: String(row.RegistrationSemesterId ?? ''),
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

// ── Private packages ─────────────────────────────────────────────────────────

const privatePackages: ModuleConfig = {
  title: 'Private Packages',
  endpoint: '/api/portal/modules/private-packages',
  lookups: LOOKUPS,
  idKey: 'PackageId',
  editBase: '/privates',
  // Legacy AutoPostBack: every filter applies on change; the free-text search
  // keeps the Search button.
  filters: [
    { param: 'searchFor', label: 'Search…', type: 'text' },
    { param: 'locationIds', label: 'Location', type: 'multiselect', optionsKey: 'locations', width: 'w-40', autoSubmit: true },
    { param: 'status', label: 'ALL Statuses', type: 'select', options: PACKAGE_STATUSES, initial: 'Active', autoSubmit: true },
    { param: 'needAttention', label: 'All Packs', type: 'select', options: NEED_ATTENTION, autoSubmit: true },
    { param: 'currencies', label: 'Currency', type: 'select', options: CURRENCIES, width: 'max-w-24', autoSubmit: true },
    { param: 'sessionDay', label: 'Day', type: 'select', options: PRIVATE_WEEK_DAYS, width: 'max-w-24', autoSubmit: true },
    { param: 'sessionDate', label: 'On Date', type: 'date', autoSubmit: true },
    { param: 'dateFrom', label: 'From', type: 'date', autoSubmit: true },
    { param: 'dateTo', label: 'To', type: 'date', autoSubmit: true },
    { param: 'onlyDue', label: 'Only Due', type: 'checkbox', autoSubmit: true },
    // Feedback filters: SiteMaster only, like the legacy chkFeedback block.
    { param: 'feedbackDateFrom', label: 'Fb From', type: 'date', autoSubmit: true, roles: SITEMASTER },
    { param: 'feedbackDateTo', label: 'Fb To', type: 'date', autoSubmit: true, roles: SITEMASTER },
    { param: 'onlyWithFeedback', label: 'Only if feedback Requested', type: 'checkbox', autoSubmit: true, roles: SITEMASTER },
    { param: 'onlyWithFeedbackResults', label: 'Only if feedback Filled', type: 'checkbox', autoSubmit: true, roles: SITEMASTER },
    { param: 'onlyWithFeedbackRequireAction', label: 'Only if Action is Needed', type: 'checkbox', autoSubmit: true, roles: SITEMASTER },
  ],
  columnGroups: [{ key: 'feedback', label: 'Feedback columns', roles: SITEMASTER }],
  columns: [
    { key: 'LocationNickName', label: 'Loc' },
    { key: 'CoachFullName', label: 'Coach' },
    { key: 'PackageDesc', label: 'Package' },
    { key: 'StudentPackagesCount', label: '# Pkgs' },
    { key: 'PackageStartDate', label: 'Start', format: 'date' },
    { key: 'PackageNumberOfSessions', label: 'Sessions', total: true },
    { key: 'SessionsLeft', label: 'Avlb', total: true },
    { key: 'PackageCurrency', label: 'Curr' },
    { key: 'PackageAmount', label: 'Amount', format: 'money', totalBy: 'PackageCurrency', totalRoles: SITEMASTER },
    { key: 'DuePayment', label: 'Due', format: 'money', totalBy: 'PackageCurrency', totalRoles: SITEMASTER },
    { key: 'Phone', label: 'Phone', extra: true },
    { key: 'PackageRemarks', label: 'Remarks', extra: true },
    { key: 'PackageStatus', label: 'Status' },
    { key: 'ActionNeeded', label: 'Action' },
    // Legacy chkFeedback columns (tbl_FeedbackRequests join in the proc).
    { key: 'FeedbackTotal', label: 'Score', group: 'feedback' },
    { key: 'FeedbackQuestion1Answer', label: 'Q1', group: 'feedback' },
    { key: 'FeedbackQuestion2Answer', label: 'Q2', group: 'feedback' },
    { key: 'FeedbackQuestion3Answer', label: 'Q3', group: 'feedback' },
    { key: 'FeedbackQuestion4Answer', label: 'Q4', group: 'feedback' },
    { key: 'FeedbackQuestion5Answer', label: 'Q5', group: 'feedback' },
    { key: 'FeedbackDate1', label: 'D1', format: 'date', group: 'feedback' },
    { key: 'FeedbackDate2', label: 'D2', format: 'date', group: 'feedback' },
    { key: 'FeedbackSuggestion', label: 'Sgstn', group: 'feedback' },
    { key: 'FeedbackFollowUpStatus', label: 'Followup', group: 'feedback' },
    { key: 'FeedbackFollowUpMasterStatus', label: 'Approved', group: 'feedback' },
    { key: '_followup', label: '', group: 'feedback' },
    { key: '_pay', label: '' },
  ],
  rowClass: (row) => PACKAGE_ROW_CLASS[String(row.PackageStatus ?? '')] ?? '',
  renderCell: (row, col) => {
    const u = getStoredUser();
    const canAct = (u?.userType || '').toLowerCase() !== 'guest' && u?.canSave !== false;
    switch (col.key) {
      case 'ActionNeeded': {
        const v = String(row.ActionNeeded ?? '');
        return v ? <span className="font-bold text-red-600">{v}</span> : '';
      }
      // Legacy RowDataBound colour rules on the two follow-up columns.
      case 'FeedbackFollowUpStatus':
      case 'FeedbackFollowUpMasterStatus': {
        const status = String(row.FeedbackFollowUpStatus ?? '');
        const master = String(row.FeedbackFollowUpMasterStatus ?? '');
        const cls = master === 'AdminNeedFollowup' ? 'text-red-900 font-semibold'
          : status === '' || status === 'ReviewedNeedFollowup' ? 'text-red-600 font-semibold' : '';
        const text = col.key === 'FeedbackFollowUpStatus' && status === '' ? 'Not Available' : String(row[col.key] ?? '');
        return <span className={cls}>{text || '-'}</span>;
      }
      case 'FeedbackSuggestion':
        return <span title={String(row.FeedbackQuestionSuggestions ?? '')}>{String(row.FeedbackSuggestion ?? '') || '-'}</span>;
      // Legacy OpenWindowForFeedback → FBAdmin.aspx (no portal equivalent yet).
      case '_followup': {
        if (!row.FeedbackID) return '';
        const q = new URLSearchParams({
          ID: String(row.FeedbackID), RefID: String(row.FeedbackRefID ?? ''), PsCode: String(row.FeedbackPassCode ?? ''),
        });
        return (
          <a
            href={`https://admin.proswim-lb.com/Aspxpages/FbAdmin.aspx?${q}`}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-xs font-bold text-[#1e5c97] hover:underline whitespace-nowrap"
          >
            Followup
          </a>
        );
      }
      // Quick jump to a new private payment, prefilled with this package.
      case '_pay':
        if (!canAct) return '';
        return (
          <Link
            to={`/pr-payments/new?packageId=${row.PackageId ?? ''}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center text-xs font-bold text-emerald-700 hover:underline whitespace-nowrap"
          >
            Add Payment
          </Link>
        );
      default:
        return undefined;
    }
  },
};

// ── Private / extra / membership payments ────────────────────────────────────

// Legacy PrivatePaymentsList date window: from the 1st of this month once past
// the 20th (else the 1st of last month), to the 1st of January next year.
function paymentDateDefaults(): { from: string; to: string } {
  const d = new Date();
  const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  const from = d.getDate() >= 20 ? new Date(d.getFullYear(), d.getMonth(), 1) : new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return { from: iso(from), to: iso(new Date(d.getFullYear() + 1, 0, 1)) };
}

const MEMBERSHIP_TYPES: FilterOption[] = EXTRA_TYPES.filter((t) => String(t.value).startsWith('MemberShip'));

function privatePaymentsConfig(mode: string, title: string): ModuleConfig {
  const { from, to } = paymentDateDefaults();
  // One form serves all three lists: extra-class / membership ids are >= 100000
  // and the form loads them through P_ExtraClasses_Select, like the legacy popup.
  return {
    title,
    endpoint: `/api/portal/modules/private-payments?mode=${mode}`,
    lookups: LOOKUPS,
    idKey: 'PrivatePaymentID',
    editBase: '/pr-payments',
    filters: [
      { param: 'searchFor', label: 'Search…', type: 'text' },
      { param: 'locationIds', label: 'Location', type: 'select', optionsKey: 'locations', width: 'max-w-36', autoSubmit: true },
      ...(mode === 'extra' ? [{ param: 'types', label: 'Type', type: 'select' as const, options: EXTRA_TYPES, autoSubmit: true }] : []),
      ...(mode === 'memberships' ? [{ param: 'types', label: 'Type', type: 'select' as const, options: MEMBERSHIP_TYPES, autoSubmit: true }] : []),
      { param: 'currencies', label: 'Currency', type: 'select', options: CURRENCIES, width: 'max-w-24', autoSubmit: true },
      { param: 'dateFrom', label: 'From', type: 'date', initial: from, autoSubmit: true },
      { param: 'dateTo', label: 'To', type: 'date', initial: to, autoSubmit: true },
    ],
    columns: [
      { key: 'ClassType', label: 'Type' },
      { key: 'PackageName', label: 'Package' },
      { key: 'IDShow', label: 'ID' },
      { key: 'IssuedTo', label: 'Issued To' },
      { key: 'PrivatePaymentDate', label: 'Date', format: 'date' },
      { key: 'PrivatePaymentTotalAmount', label: 'Amount', format: 'money', total: true },
      { key: 'PrivatePaymentPaidAmount', label: 'Paid', format: 'money' },
      { key: 'PrivatePaymentPaidCurrency', label: 'Curr' },
      { key: 'PaymentMode', label: 'Mode' },
      { key: 'Serial', label: 'Delivery S/N' },
      { key: 'PayLoc', label: 'Pay Loc' },
      { key: '_pay', label: '' },
    ],
    // Quick jump to a new payment prefilled with the same package (legacy "Add
    // Payment" link). Hidden for guests, non-savers and payment/audit accounts.
    renderCell: (row: Row, col: ColumnDef) => {
      if (col.key !== '_pay') return undefined;
      const u = getStoredUser();
      const ut = (u?.userType || '').toLowerCase();
      if (ut === 'guest' || ut === 'payment/audit' || u?.canSave === false) return undefined;
      return (
        <Link
          to={`/pr-payments/new?packageId=${row.PrivatePackageId ?? ''}`}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center text-xs font-bold text-emerald-700 hover:underline whitespace-nowrap"
        >
          Add Payment
        </Link>
      );
    },
  };
}

// ── Extra classes / memberships ──────────────────────────────────────────────

function extraClassesConfig(types: string, title: string): ModuleConfig {
  return {
    title,
    endpoint: `/api/portal/modules/extra-classes${types ? `?types=${types}` : ''}`,
    lookups: LOOKUPS,
    idKey: 'ExtraClassId',
    editBase: '/extra-classes',
    filters: [
      { param: 'searchFor', label: 'Search…', type: 'text' },
      { param: 'locationIds', label: 'Location', type: 'select', optionsKey: 'locations', width: 'max-w-36' },
      ...(types ? [] : [{ param: 'types', label: 'Type', type: 'select' as const, options: EXTRA_TYPES }]),
      { param: 'status', label: 'Status', type: 'select', options: PACKAGE_STATUSES, initial: 'Active' },
      { param: 'currencies', label: 'Currency', type: 'select', options: CURRENCIES, width: 'max-w-24' },
      { param: 'dateFrom', label: 'From', type: 'date' },
      { param: 'dateTo', label: 'To', type: 'date' },
      { param: 'onlyDue', label: 'Only Due', type: 'checkbox' },
    ],
    columns: [
      { key: 'ExtraClassType', label: 'Type' },
      { key: 'LocationNickName', label: 'Location' },
      { key: 'StudentFullname', label: 'Student' },
      { key: 'ExtraClassStartDate', label: 'Start', format: 'date' },
      { key: 'ExtraClassNumberOfSessions', label: 'Sessions' },
      { key: 'SessionsLeft', label: 'Available' },
      { key: 'ExtraClassCurrency', label: 'Curr' },
      { key: 'ExtraClassCost', label: 'Cost', format: 'money' },
      { key: 'DuePayment', label: 'Due', format: 'money' },
      { key: 'Phone', label: 'Phone', extra: true },
      { key: 'ExtraClassValidityMonths', label: 'Validity (m)', extra: true },
      { key: 'ExtraClassDescription', label: 'Description', extra: true },
    ],
  };
}

// ── Coaches ──────────────────────────────────────────────────────────────────

const coaches: ModuleConfig = {
  title: 'Coaches',
  endpoint: '/api/portal/modules/coaches',
  lookups: LOOKUPS,
  idKey: 'CoachId',
  editBase: '/coaches',
  filters: [
    { param: 'searchFor', label: 'Search…', type: 'text' },
    { param: 'locationIds', label: 'Location', type: 'select', optionsKey: 'locations', width: 'max-w-36' },
    { param: 'active', label: 'Active', type: 'checkbox', initial: true },
    { param: 'inactive', label: 'Inactive', type: 'checkbox' },
    { param: 'onlyPrimary', label: 'Only Primary', type: 'checkbox' },
  ],
  columns: [
    { key: 'CoachFullName', label: 'Coach' },
    { key: 'locationNickName', label: 'Location' },
    { key: 'CoachEmail', label: 'Email' },
    { key: 'CoachPhoneNumber', label: 'Phone' },
    { key: 'CoachActive', label: 'Active', format: 'bool' },
    { key: 'CoachDailyHrs', label: 'Daily Hrs' },
    { key: 'CoachWeeklyHrs', label: 'Weekly Hrs' },
    { key: '_schedule', label: '' },
  ],
  renderCell: (row, col) => {
    if (col.key !== '_schedule') return undefined;
    return (
      <Link
        to={`/coaches/${row.CoachId}/schedule`}
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center text-xs font-bold text-[#1e5c97] hover:underline whitespace-nowrap"
      >
        Schedule
      </Link>
    );
  },
};

// ── Classes ──────────────────────────────────────────────────────────────────

const classes: ModuleConfig = {
  title: 'Classes',
  endpoint: '/api/portal/modules/classes',
  lookups: LOOKUPS,
  idKey: 'ClassID',
  editBase: '/classes',
  filters: [
    { param: 'searchFor', label: 'Search…', type: 'text' },
    { param: 'locationId', label: 'Location', type: 'select', optionsKey: 'locations', width: 'max-w-36' },
    { param: 'semesterId', label: 'Semester', type: 'select', optionsKey: 'semesters', width: 'max-w-44' },
    { param: 'coachId', label: 'Coach', type: 'select', optionsKey: 'coaches', width: 'max-w-36' },
    { param: 'deleted', label: 'Deleted', type: 'checkbox' },
  ],
  columns: [
    { key: 'SemesterName', label: 'Semester' },
    { key: 'LocationNickName', label: 'Location' },
    { key: 'CoachFullName', label: 'Coach' },
    { key: 'ClassDay', label: 'Day' },
    { key: 'ClassTimeFrom', label: 'Time' },
    { key: 'ClassPeriod', label: 'Period' },
    { key: '_sessions', label: '' },
  ],
  // Jump to this class's sessions (all dates), scoped to its semester/location.
  renderCell: (row, col) => {
    if (col.key !== '_sessions') return undefined;
    const cid = row.ClassId ?? row.ClassID;
    const q = new URLSearchParams({
      classId: String(cid ?? ''),
      semesterId: String(row.ClassSemesterId ?? ''),
      locationId: String(row.ClassLocationId ?? ''),
      date: '',
    });
    return (
      <Link
        to={`/sessions?${q}`}
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center text-xs font-bold text-[#1e5c97] hover:underline whitespace-nowrap"
      >
        Sessions
      </Link>
    );
  },
};

// ── Semesters ────────────────────────────────────────────────────────────────

const semesters: ModuleConfig = {
  title: 'Semesters',
  endpoint: '/api/portal/modules/semesters',
  lookups: LOOKUPS,
  idKey: 'SemesterID',
  editBase: '/semesters',
  filters: [
    { param: 'searchFor', label: 'Search…', type: 'text' },
    { param: 'locationId', label: 'Location', type: 'select', optionsKey: 'locations', width: 'max-w-36' },
    { param: 'currentUpcoming', label: 'Current/Upcoming', type: 'checkbox', initial: true },
    { param: 'deleted', label: 'Deleted', type: 'checkbox' },
  ],
  columns: [
    { key: 'SemesterName', label: 'Semester' },
    { key: 'locationNickName', label: 'Location' },
    { key: 'SemesterStart', label: 'Start', format: 'date' },
    { key: 'SemesterEnd', label: 'End', format: 'date' },
    { key: 'SemesterNumberOfWeeks', label: 'Weeks' },
    { key: 'SemesterDeleted', label: 'Deleted', format: 'bool' },
  ],
};

// ── Group sessions ───────────────────────────────────────────────────────────

const sessions: ModuleConfig = {
  title: 'Sessions & Attendance',
  endpoint: '/api/portal/modules/sessions',
  lookups: LOOKUPS,
  idKey: 'SessionId',
  editBase: '/sessions',
  filters: [
    { param: 'searchFor', label: 'Search…', type: 'text' },
    // As with registrations, P_Classes_Sessions_Select has no location param.
    { param: 'locationId', label: 'Location', type: 'select', optionsKey: 'locations', width: 'max-w-36', submit: false },
    { param: 'semesterId', label: 'Semester', type: 'select', optionsKey: 'semesters', width: 'max-w-44' },
    { param: 'coachId', label: 'Coach', type: 'select', optionsKey: 'coaches', width: 'max-w-36' },
    { param: 'classId', label: 'Class', type: 'select', optionsKey: 'classes', width: 'max-w-56' },
    { param: 'day', label: 'Day', type: 'select', options: WEEK_DAYS, width: 'max-w-24' },
    // Opens on today's sessions, clear or change the date to browse others.
    { param: 'date', label: 'Date', type: 'date', initial: today() },
  ],
  columns: [
    { key: 'ClassName', label: 'Class' },
    { key: 'SessionDate', label: 'Date', format: 'date' },
    { key: 'SessionStatus', label: 'Status' },
    { key: 'Registered', label: 'Registered' },
    { key: 'Attended', label: 'Attended' },
    { key: 'Makeuped', label: 'Makeup' },
    { key: 'SessionRemarks', label: 'Remarks' },
    { key: '_take', label: '' },
  ],
  // One tap from the session row into the marking page.
  renderCell: (row, col) => {
    if (col.key !== '_take') return undefined;
    if ((getStoredUser()?.userType || '').toLowerCase() === 'guest') return undefined;
    return (
      <Link
        to={`/sessions/${row.SessionId}/attendance`}
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-1 text-xs font-bold text-[#1e5c97] hover:underline whitespace-nowrap"
      >
        Take Attendance
      </Link>
    );
  },
};

// ── Exported pages ───────────────────────────────────────────────────────────

export const RegistrationsPage = () => <ModuleListPage config={registrations} />;
export const PaymentsPage = () => <ModuleListPage config={payments} />;
export const PaymentsDuePage = () => <ModuleListPage config={paymentsDue} />;
export const PrivatePackagesPage = () => <ModuleListPage config={privatePackages} />;
export const PrivatePaymentsPage = () => <ModuleListPage config={privatePaymentsConfig('private', 'Private Payments')} />;
export const ExtraPaymentsPage = () => <ModuleListPage config={privatePaymentsConfig('extra', 'Extra Class Payments')} />;
export const MembershipPaymentsPage = () => <ModuleListPage config={privatePaymentsConfig('memberships', 'Membership Payments')} />;
export const ExtraClassesPage = () => <ModuleListPage config={extraClassesConfig('', 'Extra Classes')} />;
export const MembershipsPage = () => <ModuleListPage config={extraClassesConfig('MemberShipPasses,MemberShip', 'Memberships')} />;
export const CoachesPage = () => <ModuleListPage config={coaches} />;
export const ClassesPage = () => <ModuleListPage config={classes} />;
export const SemestersPage = () => <ModuleListPage config={semesters} />;
export const SessionsPage = () => <ModuleListPage config={sessions} />;

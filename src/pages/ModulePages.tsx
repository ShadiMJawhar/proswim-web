import { Link } from 'react-router-dom';
import { ModuleListPage, type ModuleConfig, type Row, type ColumnDef, type FilterOption } from '../components/ModuleListPage';
import { getStoredUser } from '../api/portalApi';
import { legacyCurrencyTotal } from '../lib/totals';
import { Printer } from 'lucide-react';
import { toast } from '../components/Toast';
import { printFeedbackStats } from './privateFeedbackStats';
import { groupPaymentsConfig, groupPaymentsDueConfig } from './GroupPaymentLists';
import { ClassesHeaderActions, SessionsHeaderActions } from './GroupClassActions';
import { coachesOfLocation, legacyPercent, todayDay } from '../lib/groupClasses';

// Configured list pages for the migrated legacy modules. Each maps 1:1 to a
// legacy XxxList.aspx page and its stored procedure (see PortalModulesController).

const LOOKUPS = '/api/portal/modules/lookups';

// Local-time "today" for date-filter defaults (toISOString would slip a day
// around midnight in UTC+ timezones).
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Legacy txtPackageNeedAttention list (same values/order; "" = All Packs).
const NEED_ATTENTION = [
  { value: 'AttendanceMoreThanPayment1', label: 'Att. > Payment' },
  { value: 'AttendanceMoreThanPayment2', label: 'Att. >>> Payment' },
  { value: 'NeedFollowup', label: 'Need Followup' },
  { value: 'NeedPayment', label: 'Need Payment' },
  { value: 'NeedLevel', label: 'Need Level' },
  { value: 'NeedtoBeClosed', label: 'Need Closed' },
  { value: 'Done1', label: 'Done 1 Session' },
  { value: 'Done4', label: 'Done 4 Sessions' },
  { value: 'Done10', label: 'Done 10 Sessions' },
];

// Legacy PrivatePackagesList txtPackageStatus (same values, labels and order;
// "" = ALL Statuses). No "Transfer" item there.
const PRIVATE_PACKAGE_STATUSES: FilterOption[] = [
  { value: 'Active', label: 'Active' },
  { value: 'ClosedNeedPayment', label: 'Closed Need Payment' },
  { value: 'Closed', label: 'Closed' },
  { value: 'MovedtoGroup', label: 'MovedtoGroup' },
  { value: 'Freeze', label: 'Freeze' },
  { value: 'Cancelled', label: 'Cancelled' },
];

// The legacy feedback checkboxes were shown to SiteMaster and to user 13.
const isFeedbackUser = () => {
  const u = getStoredUser();
  return (u?.userType ?? '').toLowerCase() === 'sitemaster' || u?.userId === 13;
};

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

// Legacy RegistrationsList.aspx: a superuser is read-only (no Add New, Edit
// refuses) unless exactly one location is picked (picking one becomes their
// session location).
const oneLocation = (v: Record<string, unknown>) => /^\d+$/.test(String(v.locationIds ?? ''));
const regsWritable = (v: Record<string, unknown>, role: string) => role !== 'superuser' || oneLocation(v);

const registrations: ModuleConfig = {
  title: 'Registrations',
  endpoint: '/api/portal/modules/registrations',
  lookups: LOOKUPS,
  idKey: 'RegistrationId',   // P_Registration_Select returns tbl_Registration.* casing
  editBase: '/registrations',
  newLinkParams: ['locationIds'],
  // Locations → semesters (one location: its first upcoming; several: all their
  // upcoming), coaches of the locations, classes of locations + semesters.
  semesterPick: 'upcoming',
  canAddNew: regsWritable,
  canEditRows: regsWritable,
  filters: [
    // P_Registration_Select takes no location: the location picker scopes the
    // semester / coach / class lists, and the semesters scope the rows.
    { param: 'locationIds', label: 'Location', type: 'multiselect', optionsKey: 'locations', width: 'w-40', lockedFor: ['user'], submit: false },
    { param: 'semesterIds', label: 'Semester', type: 'multiselect', optionsKey: 'semesters', width: 'w-48', autoSubmit: true },
    { param: 'searchFor', label: 'Search…', type: 'text', width: 'w-36' },
    {
      param: 'coachId', label: 'Coach: Not Selected', type: 'select', width: 'max-w-40', autoSubmit: true,
      optionsFrom: { url: (v) => `/api/portal/registrations/coaches?locationIds=${encodeURIComponent(String(v.locationIds ?? ''))}` },
    },
    {
      param: 'classId', label: 'Class: Not Selected', type: 'select', width: 'max-w-48',
      optionsFrom: {
        url: (v) => `/api/portal/registrations/classes?locationIds=${encodeURIComponent(String(v.locationIds ?? ''))}`
          + `&semesterIds=${encodeURIComponent(String(v.semesterIds ?? ''))}`,
      },
    },
    { param: 'stopped', label: 'Stop', type: 'checkbox', initial: true, autoSubmit: true },
    { param: 'active', label: 'Act', type: 'checkbox', initial: true, autoSubmit: true },
    { param: 'withDiscount', label: 'Disc', type: 'checkbox', autoSubmit: true },
    { param: 'onlyDue', label: 'OnlyDue', type: 'checkbox', autoSubmit: true },
    // Empty = calculate till the end of the semester (proc gets 01/01/2000).
    { param: 'calculateDate', label: 'Calculation Date (empty = till end of semester)', type: 'date', autoSubmit: true },
  ],
  // Legacy LblResultCounts.
  summary: {
    prefix: '',
    text: (rows) => {
      const stopped = rows.filter((r) => r.RegistrationStudentStopped === true).length;
      const active = rows.filter((r) => r.RegistrationStudentStopped === false).length;
      const places = rows.reduce((t, r) => t + (Number(r.RegistrationNumberOfTimes) || 0), 0);
      let txt = '';
      if (active > 0 && stopped > 0) txt += `[ ${active} Active + ${stopped} Stopped = ${rows.length} Regs ] `;
      if (active > 0 && stopped === 0) txt += `[ ${active} Registrations] `;
      if (active === 0 && stopped > 0) txt += `[ ${stopped} StoppedRegistrations] `;
      if (places > 0) txt += `[${places} Places]`;
      return txt.trim();
    },
  },
  // Legacy: a stopped registration is tinted and struck through.
  rowClass: (row) => (row.RegistrationStudentStopped === true ? 'bg-[#e6c8c8] line-through' : ''),
  // Legacy grid order; the Ad_Info columns (hidden by default) are `extra`.
  // Money footers are SiteMaster-only, session-count footers are for everyone.
  columns: [
    { key: 'StudentFullName', label: 'Student' },
    { key: 'PhoneNumber1', label: 'Phone' },
    { key: 'RegistrationNumberOfTimes', label: 'Times' },
    { key: 'DOB', label: 'D.O.B', format: 'date' },
    { key: 'PhoneNumber2', label: 'S_Phone' },
    { key: 'ClassName1', label: 'Class1' },
    { key: 'ClassName2', label: 'Class2' },
    { key: 'ClassName3', label: 'Class3' },
    { key: 'Status', label: 'Status' },
    { key: 'SemesterName', label: 'Semester' },
    { key: 'DiscountFullRemark', label: 'Remarks' },
    { key: 'RegistrationStudentStoppedReason', label: 'Reason' },
    { key: 'RegistrationDate', label: 'Start', format: 'date' },
    { key: 'RegistrationStudentStoppedDate', label: 'Stop', format: 'date' },
    { key: 'SemesterStart', label: 'SemStart', format: 'date', extra: true },
    { key: 'SemesterStop', label: 'SemStop', format: 'date', extra: true },
    { key: 'SemesterEnd', label: 'SemEnd', format: 'date', extra: true },
    { key: 'RegistrationCost', label: 'Total', format: 'money', extra: true, total: true, totalRoles: SITEMASTER },
    { key: 'RegistrationDiscount', label: 'Disc', format: 'money', extra: true, total: true, totalRoles: SITEMASTER },
    { key: 'RegistrationVariation', label: 'Variation', format: 'money', extra: true, total: true, totalRoles: SITEMASTER },
    { key: 'RegistrationNetToPay', label: 'Net', format: 'money', extra: true, total: true, totalRoles: SITEMASTER },
    { key: 'PaidAmount', label: 'Paid', format: 'money', extra: true, total: true, totalRoles: SITEMASTER },
    { key: 'DueAmount', label: 'Due', format: 'money', extra: true, total: true, totalRoles: SITEMASTER },
    { key: 'RegistrationStudentStoppedMoneyOnHold', label: 'Hold', extra: true, total: true, totalRoles: SITEMASTER },
    { key: 'SessionsTotal', label: 'S-Total', extra: true, total: true },
    { key: 'SessionsNet', label: 'S-Paid', extra: true, total: true },
    { key: 'SessionsCancelled', label: 'S-Cancelled', extra: true, total: true },
    { key: 'SessionsToBeAttended', label: 'S-ToAttend', extra: true, total: true },
    { key: 'SessionsAttended', label: 'S-Attended', extra: true, total: true },
    { key: 'SessionsMissed', label: 'S-Missed', extra: true, total: true },
    { key: 'AmountUsed', label: 'AmountUsed', format: 'money', extra: true, total: true, totalRoles: SITEMASTER },
    { key: 'PaidAmount', label: 'Paid2', format: 'money', extra: true, total: true, totalRoles: SITEMASTER },
    { key: 'Net2PayCalc', label: 'Net2PayCalc', format: 'money', extra: true, total: true, totalRoles: SITEMASTER },
    { key: '_attendance', label: '' },
  ],
  // "Did Not Renew" (legacy BtnDidNotRenew → RegistrationsListView_NotRenewed
  // with the single picked location).
  actions: (_rows, values) => {
    const loc = oneLocation(values) ? `?locationId=${values.locationIds}` : '';
    return (
      <Link
        to={`/registrations-not-renewed${loc}`}
        className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#1e5c97] hover:bg-slate-50"
      >
        Did Not Renew
      </Link>
    );
  },
  // Legacy per-row "Attendance" → RptAttendanceDetails?LocationID=&Search=<student>.
  renderCell: (row, col) => {
    if (col.key !== '_attendance') return undefined;
    const q = new URLSearchParams({ locationId: String(row.LocationId ?? ''), search: String(row.StudentFullName ?? '') });
    return (
      <Link
        to={`/attendance-details?${q}`}
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center text-xs font-bold text-[#1e5c97] hover:underline whitespace-nowrap no-underline"
      >
        Attendance
      </Link>
    );
  },
};

// ── Did not renew (RegistrationsListView_NotRenewed.aspx) ────────────────────
// Students registered in "In Semester" and not in "Not in Semester"
// (P_Registration_Select_NotRenewed). Legacy defaults: In = the location's
// latest semester (first in Semester_Select_ByLocation), Not in = its upcoming one.

const notRenewed: ModuleConfig = {
  title: 'Did Not Renew',
  subtitle: 'Registered in the first semester, not in the second',
  endpoint: '/api/portal/registrations/not-renewed',
  lookups: LOOKUPS,
  semesterPick: 'upcoming',
  filters: [
    { param: 'locationId', label: 'Location', type: 'select', optionsKey: 'locations', width: 'max-w-40', lockedFor: ['user'] },
    {
      param: 'semesterIdPrevious', label: 'In Semester', type: 'select', width: 'max-w-48', autoSubmit: true, firstByDefault: true,
      optionsFrom: {
        url: (v) => (Number(v.locationId) ? `/api/portal/modules/semester-options?locationIds=${v.locationId}&pick=upcoming` : null),
        pick: (res) => ((res as { semesters?: Row[] }).semesters ?? [])
          .map((s) => ({ value: Number(s.SemesterId ?? s.SemesterID ?? 0), label: String(s.SemesterName ?? '') }))
          .filter((o) => o.value > 0),
      },
    },
    // The cascade semester: the location's upcoming semester by default.
    { param: 'semesterId', label: 'Not in Semester', type: 'select', optionsKey: 'semesters', width: 'max-w-48', autoSubmit: true },
  ],
  columns: [
    { key: 'StudentFullName', label: 'Student' },
    { key: 'PhoneNumber1', label: 'Phone' },
    { key: 'PhoneNumber2', label: 'Phone 2' },
    { key: 'StudentEmail', label: 'Email' },
    { key: 'CoachFullName', label: 'Coach' },
    { key: 'Status', label: 'Status' },
  ],
};

// ── Group payments / due payments ────────────────────────────────────────────
// Built in GroupPaymentLists.tsx (legacy PaymentsList / PaymentsRptDue).

// ── Private packages ─────────────────────────────────────────────────────────

function privatePackagesConfig(): ModuleConfig {
  // Built per render: the feedback block depends on the signed-in user, and
  // the date window on today. From (user rule 2026-10-24): July onwards → 1 Jan
  // of this year; January–June → 1 Jan of last year. To: 1 Jan next year.
  const fbRoles = isFeedbackUser() ? undefined : SITEMASTER;
  const now = new Date();
  const y = now.getFullYear();
  const fromYear = now.getMonth() >= 6 ? y : y - 1;
  // Legacy "Pr-Feedback" menu link (?Feedback=true): all statuses, only
  // packages whose feedback was requested and filled.
  const fbLink = !fbRoles && new URLSearchParams(window.location.search).get('Feedback') === 'true';
  return {
    title: 'Private Packages',
    endpoint: '/api/portal/modules/private-packages',
    lookups: LOOKUPS,
    idKey: 'PackageId',
    editBase: '/privates',
    // Edit + Pay first, so they're reachable without scrolling (user, 2026-10-24).
    editFirst: true,
    // Legacy filter order and AutoPostBack: every filter applies on change; the
    // free-text search keeps the Search button.
    filters: [
      { param: 'locationIds', label: 'Location', type: 'multiselect', optionsKey: 'locations', width: 'w-40', autoSubmit: true, lockedFor: ['user'] },
      { param: 'searchFor', label: 'Search…', type: 'text' },
      { param: 'dateFrom', label: 'From', type: 'date', initial: `${fromYear}-01-01`, autoSubmit: true },
      { param: 'dateTo', label: 'To', type: 'date', initial: `${y + 1}-01-01`, autoSubmit: true },
      { param: 'status', label: 'ALL Statuses', type: 'select', options: PRIVATE_PACKAGE_STATUSES, initial: fbLink ? '' : 'Active', autoSubmit: true },
      // Legacy ddlCurrency: checkbox list, both ticked.
      { param: 'currencies', label: 'Currency', type: 'multiselect', options: CURRENCIES, initial: 'USD,LBP', width: 'w-28', autoSubmit: true },
      { param: 'needAttention', label: 'All Packs', type: 'select', options: NEED_ATTENTION, autoSubmit: true },
      { param: 'sessionDay', label: 'on: Day', type: 'select', options: PRIVATE_WEEK_DAYS, width: 'max-w-24', autoSubmit: true },
      { param: 'sessionDate', label: 'or date', type: 'date', autoSubmit: true },
      { param: 'onlyDue', label: 'Only Due', type: 'checkbox', autoSubmit: true },
      // Legacy txtFeedbackDateFrom/To were shown to every user; the checkboxes
      // only to SiteMaster (and user 13).
      { param: 'feedbackDateFrom', label: 'FeedbackDate', type: 'date', autoSubmit: true },
      { param: 'feedbackDateTo', label: 'To', type: 'date', autoSubmit: true },
      { param: 'onlyWithFeedback', label: 'Only if feedback Requested', type: 'checkbox', initial: fbLink, autoSubmit: true, roles: fbRoles },
      { param: 'onlyWithFeedbackResults', label: 'Only if feedback Filled', type: 'checkbox', initial: fbLink, autoSubmit: true, roles: fbRoles },
      { param: 'onlyWithFeedbackRequireAction', label: 'Only if Action is Needed', type: 'checkbox', autoSubmit: true, roles: fbRoles },
    ],
    columnGroups: [{ key: 'feedback', label: 'Feedback columns', roles: fbRoles }],
    // Legacy BtnPrintFeedbackCoaches / BtnPrintFeedbackLocations: shown once the
    // "Only if feedback Requested" filter is on and the search returned rows.
    actions: (rows, values) => {
      if (fbRoles || values.onlyWithFeedback !== true || rows.length === 0) return null;
      const btn = (by: 'coach' | 'location', label: string) => (
        <button
          type="button"
          onClick={() => { if (!printFeedbackStats(rows, by)) toast.error('Pop-up blocked; allow pop-ups to print.'); }}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#1e5c97] hover:bg-slate-50 transition-colors"
        >
          <Printer className="size-3.5" /> {label}
        </button>
      );
      return <>{btn('coach', 'Coaches Stats')}{btn('location', 'Location Stats')}</>;
    },
    columns: [
      { key: '_pay', label: '' },
      { key: 'LocationNickName', label: 'Loc' },
      { key: 'CoachFullName', label: 'Coach' },
      { key: 'PackageDesc', label: 'Package' },
      { key: 'StudentPackagesCount', label: '# Pkgs' },
      { key: 'PackageStartDate', label: 'Start', format: 'date' },
      { key: 'PackageNumberOfSessions', label: 'Sessions', total: true },
      { key: 'SessionsLeft', label: 'Avlb', total: true },
      { key: 'PackageCurrency', label: 'Curr' },
      { key: 'PackageAmount', label: 'Amount', format: 'money', totalBy: 'PackageCurrency', totalOnly: 'USD', totalRoles: SITEMASTER },
      { key: 'DuePayment', label: 'Due', format: 'money', totalBy: 'PackageCurrency', totalOnly: 'USD', totalRoles: SITEMASTER },
      { key: 'Phone', label: 'Phone' },
      { key: 'PackageRemarks', label: 'Remarks' },
      { key: 'PackageStatus', label: 'Status' },
      { key: 'ActionNeeded', label: 'Action' },
      // Feedback columns (tbl_FeedbackRequests join in the proc). Legacy
      // bindGVResults hides only the last 7 (Q5 … Followup link) without the
      // "Feedback" box, so Score and Q1–Q4 show for every user by default.
      { key: 'FeedbackTotal', label: 'Score' },
      { key: 'FeedbackQuestion1Answer', label: 'Q1' },
      { key: 'FeedbackQuestion2Answer', label: 'Q2' },
      { key: 'FeedbackQuestion3Answer', label: 'Q3' },
      { key: 'FeedbackQuestion4Answer', label: 'Q4' },
      { key: 'FeedbackQuestion5Answer', label: 'Q5', group: 'feedback' },
      { key: 'FeedbackDate1', label: 'D1', format: 'date', group: 'feedback' },
      { key: 'FeedbackDate2', label: 'D2', format: 'date', group: 'feedback' },
      { key: 'FeedbackSuggestion', label: 'Sgstn', group: 'feedback' },
      { key: 'FeedbackFollowUpStatus', label: 'Followup', group: 'feedback' },
      { key: 'FeedbackFollowUpMasterStatus', label: 'Approved', group: 'feedback' },
      { key: '_followup', label: '', group: 'feedback' },
    ],
    rowClass: (row) => PACKAGE_ROW_CLASS[String(row.PackageStatus ?? '')] ?? '',
    renderCell: (row, col) => {
      const u = getStoredUser();
      const canAct = (u?.userType || '').toLowerCase() !== 'guest' && u?.canSave !== false;
      switch (col.key) {
        // Legacy "Edit" opened the package for every user (no-save users get a
        // read-only form with Print); the pencil needs saving rights, so the
        // package name opens it for the others too.
        case 'PackageDesc':
          if ((u?.userType || '').toLowerCase() === 'guest' || !row.PackageId) return undefined;
          return (
            <Link to={`/privates/${row.PackageId}`} onClick={(e) => e.stopPropagation()} className="font-semibold text-[#1e5c97] hover:underline">
              {String(row.PackageDesc ?? '') || `#${row.PackageId}`}
            </Link>
          );
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
        // Legacy "Pay" link: new private payment prefilled with this package.
        case '_pay':
          if (!canAct) return '';
          return (
            <Link
              to={`/pr-payments/new?packageId=${row.PackageId ?? ''}`}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center text-xs font-bold text-emerald-700 hover:underline whitespace-nowrap"
            >
              Pay
            </Link>
          );
        default:
          return undefined;
      }
    },
  };
}

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
    summary: { roles: SITEMASTER, text: (rows) => legacyCurrencyTotal(rows, 'PrivatePaymentPaidAmount', 'PrivatePaymentPaidCurrency') },
    // Legacy filter bar order: Location, Class Types, Currency, search, From, To.
    filters: [
      // ddlLocations_MS: checkbox list, disabled for user and payment/audit.
      { param: 'locationIds', label: 'Location', type: 'multiselect', optionsKey: 'locations', width: 'w-40', autoSubmit: true, lockedFor: ['user', 'payment/audit'] },
      // ddlType (ExPayments / M-Payments only): all six types listed, every one
      // ticked; M-Payments opens with just the two membership types ticked.
      ...(mode !== 'private' ? [{
        param: 'types', label: 'Class Types', type: 'multiselect' as const, options: EXTRA_TYPES, width: 'w-40', autoSubmit: true,
        initial: (mode === 'memberships' ? MEMBERSHIP_TYPES : EXTRA_TYPES).map((t) => String(t.value)).join(','),
      }] : []),
      { param: 'currencies', label: 'Currency', type: 'select', options: CURRENCIES, width: 'max-w-24', autoSubmit: true },
      { param: 'searchFor', label: 'Search…', type: 'text' },
      { param: 'dateFrom', label: 'From', type: 'date', initial: from, autoSubmit: true },
      { param: 'dateTo', label: 'To', type: 'date', initial: to, autoSubmit: true },
    ],
    // Legacy Add New passed the list's location selection (hdnLocsIds): the
    // form offers that location's open packages.
    newLinkParams: ['locationIds'],
    columns: [
      { key: 'ClassType', label: 'Class Type' },
      { key: 'PackageName', label: 'Package' },
      { key: 'IDShow', label: 'ID' },
      { key: 'IssuedTo', label: 'Issued To' },
      { key: 'PrivatePaymentDate', label: 'Date', format: 'date' },
      // Legacy footer + "of total" header: SiteMaster only (money totals).
      { key: 'PrivatePaymentTotalAmount', label: 'Amount', format: 'money', total: true, totalRoles: SITEMASTER },
      { key: 'PrivatePaymentPaidAmount', label: 'Paid', format: 'money', totalBy: 'PrivatePaymentPaidCurrency', totalRoles: SITEMASTER },
      { key: 'PrivatePaymentPaidCurrency', label: 'Curr' },
      { key: 'PaymentMode', label: 'Mode' },
      { key: 'Serial', label: 'Delivery S/N' },
      { key: 'PayLoc', label: 'Pay Loc' },
      { key: '_pay', label: '' },
    ],
    renderCell: (row: Row, col: ColumnDef) => {
      const u = getStoredUser();
      const ut = (u?.userType || '').toLowerCase();
      switch (col.key) {
        // Legacy ItemStyle-ForeColor="DarkBlue" on Paid and Curr.
        case 'PrivatePaymentPaidAmount':
          return row.PrivatePaymentPaidAmount == null ? undefined
            : <span className="text-blue-900">{Number(row.PrivatePaymentPaidAmount).toLocaleString()}</span>;
        case 'PrivatePaymentPaidCurrency':
          return <span className="text-blue-900">{String(row.PrivatePaymentPaidCurrency ?? '') || '-'}</span>;
        // Legacy "Edit" link opened the payment for everyone but payment/audit,
        // Print / Email only without saving rights. The pencil needs saving
        // rights, so the ID opens the form for the others too.
        case 'IDShow':
          if (ut === 'guest' || ut === 'payment/audit' || !row.PrivatePaymentID) return undefined;
          return (
            <Link
              to={`/pr-payments/${row.PrivatePaymentID}`}
              onClick={(e) => e.stopPropagation()}
              className="font-semibold text-[#1e5c97] hover:underline"
            >
              {String(row.IDShow ?? row.PrivatePaymentID)}
            </Link>
          );
        // Quick jump to a new payment prefilled with the same package (legacy "Add
        // Payment" link). Hidden for guests, non-savers and payment/audit accounts.
        case '_pay':
          if (ut === 'guest' || ut === 'payment/audit' || u?.canSave === false) return '';
          return (
            <Link
              to={`/pr-payments/new?packageId=${row.PrivatePackageId ?? ''}`}
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
}

// ── Extra classes / memberships ──────────────────────────────────────────────

// Legacy ExtraClassesList txtPackageStatus ("" = All Statuses; no Transfer).
const EXTRA_STATUSES: FilterOption[] = [
  { value: 'Active', label: 'Active' },
  { value: 'ClosedNeedPayment', label: 'Closed Need Payment' },
  { value: 'Closed', label: 'Closed' },
  { value: 'MovedtoGroup', label: 'MovedtoGroup' },
  { value: 'Freeze', label: 'Freeze' },
  { value: 'Cancelled', label: 'Cancelled' },
];

// One legacy page (ExtraClassesList.aspx) behind two menu links: "Classes"
// (every type ticked) and "Memberships" (?Memberships=True ticks only the two
// membership types). The type list stays editable on both, like the legacy.
function extraClassesConfig(memberships: boolean, title: string): ModuleConfig {
  const y = new Date().getFullYear();
  return {
    title,
    // ?list= only keeps the two lists' saved column choices apart (the API ignores it).
    endpoint: `/api/portal/modules/extra-classes${memberships ? '?list=memberships' : ''}`,
    lookups: LOOKUPS,
    idKey: 'ExtraClassId',
    editBase: '/extra-classes',
    // Legacy: ticking exactly one location makes it the session location the
    // "New" pop-up opens on (the form takes ?locationIds= when it is one id).
    newLinkParams: ['locationIds'],
    // Legacy filter order; everything but the free-text search is AutoPostBack.
    filters: [
      { param: 'locationIds', label: 'Location', type: 'multiselect', optionsKey: 'locations', width: 'w-36', autoSubmit: true, lockedFor: ['user'] },
      {
        param: 'types', label: 'Class Types', type: 'multiselect', options: EXTRA_TYPES, width: 'w-40', autoSubmit: true,
        initial: (memberships ? MEMBERSHIP_TYPES : EXTRA_TYPES).map((t) => String(t.value)).join(','),
      },
      { param: 'currencies', label: 'Currency', type: 'multiselect', options: CURRENCIES, initial: 'USD,LBP', width: 'w-28', autoSubmit: true },
      { param: 'searchFor', label: 'Search…', type: 'text' },
      // Legacy window: 1 Jan this year → 1 Jan next year.
      { param: 'dateFrom', label: 'From', type: 'date', initial: `${y}-01-01`, autoSubmit: true },
      { param: 'dateTo', label: 'To', type: 'date', initial: `${y + 1}-01-01`, autoSubmit: true },
      { param: 'status', label: 'All Statuses', type: 'select', options: EXTRA_STATUSES, initial: 'Active', autoSubmit: true },
      { param: 'onlyDue', label: 'Only Due', type: 'checkbox', autoSubmit: true },
    ],
    columns: [
      { key: 'ExtraClassType', label: 'Type' },
      { key: 'LocationNickName', label: 'Location' },
      { key: 'StudentFullname', label: 'Student' },
      { key: 'ExtraClassStartDate', label: 'Start Date', format: 'date' },
      { key: 'ExtraClassNumberOfSessions', label: 'Sessions', total: true },
      { key: 'SessionsLeft', label: 'Available', total: true },
      { key: 'ExtraClassCurrency', label: 'Curr' },
      // Legacy footer: per-currency money sums, SiteMaster only.
      { key: 'ExtraClassCost', label: 'Amount', format: 'money', totalBy: 'ExtraClassCurrency', totalRoles: SITEMASTER },
      { key: 'DuePayment', label: 'Due', format: 'money', totalBy: 'ExtraClassCurrency', totalRoles: SITEMASTER },
      { key: 'Phone', label: 'Phone' },
      { key: 'ExtraClassValidityMonths', label: 'Months' },
      { key: 'ExtraClassDescription', label: 'Note' },
      { key: '_pay', label: '' },
    ],
    // Legacy RowDataBound tints by ExtraClassStatus (same colours as private packs).
    rowClass: (row) => PACKAGE_ROW_CLASS[String(row.ExtraClassStatus ?? '')] ?? '',
    // Legacy "Pay" link → PrivatePaymentsIndividual.aspx?ExtraClassID= (extra ids
    // are >= 100000, which the private payment form loads as an extra class).
    renderCell: (row, col) => {
      if (col.key !== '_pay') return undefined;
      const u = getStoredUser();
      if ((u?.userType || '').toLowerCase() === 'guest' || u?.canSave === false) return '';
      return (
        <Link
          to={`/pr-payments/new?packageId=${row.ExtraClassId ?? ''}`}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center text-xs font-bold text-emerald-700 hover:underline whitespace-nowrap"
        >
          Pay
        </Link>
      );
    },
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

// ── Classes (ClassesList.aspx → P_Class_Select) ─────────────────────────────
// P_Class_Select projects `semestername` and `locationNickName` in that exact
// casing (and `ClassId`), so the column keys below must match it.

// Legacy deleted-row style: RGB(230,200,200) + line-through.
const DELETED_ROW = 'bg-[#E6C8C8] line-through';

const classes: ModuleConfig = {
  title: 'Classes',
  endpoint: '/api/portal/modules/classes',
  lookups: LOOKUPS,
  idKey: 'ClassId',
  editBase: '/classes',
  // The new-class popup defaulted to the list's location (Session UserLocationID).
  newLinkParams: ['locationId'],
  // Legacy ddlLocations_SelectedIndexChanged: the semester list opens on the
  // location's UPCOMING semester (Semester_Select_Upcoming), not the current one.
  semesterPick: 'upcoming',
  filters: [
    { param: 'searchFor', label: 'Search…', type: 'text' },
    { param: 'locationId', label: 'Location', type: 'select', optionsKey: 'locations', width: 'max-w-36', lockedFor: ['user'] },
    // AutoPostBack without a reload in legacy: pick, then Search.
    { param: 'semesterId', label: 'Semester', type: 'select', optionsKey: 'semesters', width: 'max-w-44' },
    { param: 'coachId', label: 'Coach', type: 'select', optionsFrom: coachesOfLocation, width: 'max-w-36', autoSubmit: true },
    { param: 'deleted', label: 'Deleted', type: 'checkbox', autoSubmit: true },
  ],
  columns: [
    { key: 'semestername', label: 'SemesterName' },
    { key: 'locationNickName', label: 'Location' },
    { key: 'CoachFullName', label: 'Coach' },
    { key: 'ClassDay', label: 'Day' },
    { key: 'ClassTimeFrom', label: 'Time' },
    { key: 'ClassPeriod', label: 'Period' },
    { key: '_sessions', label: '' },
  ],
  rowClass: (r) => (r.ClassDeleted === true ? DELETED_ROW : ''),
  actions: () => <ClassesHeaderActions />,
  // Jump to this class's sessions (all dates), scoped to its semester/location.
  renderCell: (row, col) => {
    if (col.key !== '_sessions') return undefined;
    const cid = row.ClassId ?? row.ClassID;
    const q = new URLSearchParams({
      classId: String(cid ?? ''),
      semesterId: String(row.ClassSemesterId ?? ''),
      locationId: String(row.ClassLocationId ?? ''),
      date: '',
      day: '',
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

// ── Semesters (SemestersList.aspx → P_Semester_Select) ───────────────────────
// P_Semester_Select returns `SemesterId` and `LocationNickName` (capital L).

const semesters: ModuleConfig = {
  title: 'Semesters',
  endpoint: '/api/portal/modules/semesters',
  lookups: LOOKUPS,
  idKey: 'SemesterId',
  editBase: '/semesters',
  newLinkParams: ['locationId'],
  // Every legacy filter control was AutoPostBack → reload.
  filters: [
    { param: 'searchFor', label: 'Search…', type: 'text' },
    { param: 'locationId', label: 'Location', type: 'select', optionsKey: 'locations', width: 'max-w-36', lockedFor: ['user'], autoSubmit: true },
    { param: 'currentUpcoming', label: 'Current or Upcoming', type: 'checkbox', initial: true, autoSubmit: true },
    { param: 'deleted', label: 'Deleted', type: 'checkbox', autoSubmit: true },
  ],
  columns: [
    { key: 'SemesterName', label: 'Semester' },
    { key: 'LocationNickName', label: 'Location' },
    { key: 'SemesterStart', label: 'Start Date', format: 'date' },
    { key: 'SemesterEnd', label: 'End Date', format: 'date' },
    { key: 'SemesterNumberOfWeeks', label: 'Number of Weeks' },
    { key: 'SemesterDeleted', label: 'Deleted', format: 'bool' },
  ],
  // Legacy RowDataBound: deleted = red + line-through, then current = green
  // (the colour wins, the strike-through stays).
  rowClass: (r) => [
    r.SemesterCurrent === true ? 'bg-[#00CC66]/40' : r.SemesterDeleted === true ? 'bg-[#E6C8C8]' : '',
    r.SemesterDeleted === true ? 'line-through' : '',
  ].join(' ').trim(),
};

// ── Group sessions (ClassesSessionsList.aspx → P_Classes_Sessions_Select) ────

const sessions: ModuleConfig = {
  title: 'Sessions & Attendance',
  endpoint: '/api/portal/modules/sessions',
  lookups: LOOKUPS,
  idKey: 'SessionId',
  editBase: '/sessions',
  // Legacy filter order and postbacks: Day / Date / Coach / Class reload at
  // once; picking a Day clears the Date and vice versa; the page opens on
  // today's date AND today's weekday; Location re-scopes semesters + coaches
  // (the cascade reloads), Semester only re-scopes the class list.
  filters: [
    { param: 'day', label: 'Day', type: 'select', options: WEEK_DAYS, width: 'max-w-24', initial: todayDay(), autoSubmit: true,
      derive: (n) => ({ ...n, date: '' }) },
    { param: 'date', label: 'Date', type: 'date', initial: today(), autoSubmit: true,
      derive: (n) => ({ ...n, day: '' }) },
    // As with registrations, P_Classes_Sessions_Select has no location param.
    { param: 'locationId', label: 'Location', type: 'select', optionsKey: 'locations', width: 'max-w-36', submit: false, lockedFor: ['user'] },
    { param: 'semesterId', label: 'Semester', type: 'select', optionsKey: 'semesters', width: 'max-w-44' },
    { param: 'coachId', label: 'Coach', type: 'select', optionsFrom: coachesOfLocation, width: 'max-w-36', autoSubmit: true },
    // Legacy Class_Select(semester, coach, day): "Coach - Day - Time" labels.
    { param: 'classId', label: 'Class', type: 'select', width: 'max-w-56', autoSubmit: true,
      optionsFrom: { url: (v) => (Number(v.semesterId)
        ? `/api/portal/reports/classes?semesterId=${Number(v.semesterId)}&coachId=${Number(v.coachId) || 0}&day=${encodeURIComponent(String(v.day ?? ''))}`
        : null) } },
    { param: 'searchFor', label: 'Search…', type: 'text' },
  ],
  columns: [
    { key: 'ClassName', label: 'Class' },
    { key: 'SessionDate', label: 'Date', format: 'date' },
    { key: 'SessionStatus', label: 'Status' },
    { key: 'Registered', label: 'Registered' },
    { key: 'Attended', label: 'Attended' },
    { key: 'Makeuped', label: 'Makeuped' },
    { key: 'SessionRemarks', label: 'Remarks' },
    { key: '_take', label: '' },
  ],
  // Legacy LblResultCounts: "N Sessions - Attendance : A Out of R - [%xx.xx]"
  // (the percentage part fails, and is dropped, when nobody is registered).
  summary: {
    prefix: '',
    text: (rows) => {
      const sum = (k: string) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
      const att = sum('Attended'), reg = sum('Registered');
      return `Attendance : ${att} Out of ${reg}${reg ? ` - [${legacyPercent(att / reg)}]` : ''}`;
    },
  },
  actions: (_rows, values) => <SessionsHeaderActions values={values} />,
  // Legacy "Attendance" link on every row (any user; the marking page itself
  // is read-only without saving rights).
  renderCell: (row, col) => {
    if (col.key !== '_take') return undefined;
    return (
      <Link
        to={`/sessions/${row.SessionId}/attendance`}
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-1 text-xs font-bold text-[#1e5c97] hover:underline whitespace-nowrap"
      >
        Attendance
      </Link>
    );
  },
};

// ── Exported pages ───────────────────────────────────────────────────────────

export const RegistrationsPage = () => <ModuleListPage config={registrations} />;
export const NotRenewedPage = () => <ModuleListPage config={notRenewed} />;
export const PaymentsPage = () => <ModuleListPage config={groupPaymentsConfig()} />;
export const PaymentsDuePage = () => <ModuleListPage config={groupPaymentsDueConfig()} />;
export const PrivatePackagesPage = () => <ModuleListPage config={privatePackagesConfig()} />;
export const PrivatePaymentsPage = () => <ModuleListPage config={privatePaymentsConfig('private', 'Private Payments')} />;
export const ExtraPaymentsPage = () => <ModuleListPage config={privatePaymentsConfig('extra', 'Extra Class Payments')} />;
export const MembershipPaymentsPage = () => <ModuleListPage config={privatePaymentsConfig('memberships', 'Membership Payments')} />;
export const ExtraClassesPage = () => <ModuleListPage config={extraClassesConfig(false, 'Extra Classes')} />;
export const MembershipsPage = () => <ModuleListPage config={extraClassesConfig(true, 'Memberships')} />;
export const CoachesPage = () => <ModuleListPage config={coaches} />;
export const ClassesPage = () => <ModuleListPage config={classes} />;
export const SemestersPage = () => <ModuleListPage config={semesters} />;
export const SessionsPage = () => <ModuleListPage config={sessions} />;

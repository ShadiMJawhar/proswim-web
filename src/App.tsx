import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { Shell } from './components/Shell';
import { DashboardPage } from './pages/DashboardPage';
import { StudentsPage } from './pages/StudentsPage';
import { StudentDetailPage } from './pages/StudentDetailPage';
import { GSchedulePage } from './pages/GSchedulePage';
import { PrSchedulePage } from './pages/PrSchedulePage';
import {
  RegistrationsPage, NotRenewedPage, PaymentsPage, PaymentsDuePage, PrivatePackagesPage,
  PrivatePaymentsPage, ExtraPaymentsPage, MembershipPaymentsPage,
  ExtraClassesPage, MembershipsPage, CoachesPage, ClassesPage,
  SemestersPage, SessionsPage,
} from './pages/ModulePages';
import {
  SemesterForm, CoachForm, ClassForm, StudentForm,
  ExpenseForm, PackTypeForm, UserForm, TimesheetForm, CoachAttendanceForm, LocationForm, MainExpenseForm,
  SessionForm,
} from './pages/RecordForms';
import { ExtraClassForm } from './pages/ExtraClassForm';
import { RegistrationForm } from './pages/RegistrationForm';
import { PrivatePackageForm } from './pages/PrivatePackageForm';
import { PaymentForm } from './pages/PaymentForm';
import { PrivatePaymentForm } from './pages/PrivatePaymentForm';
import { CleanupPage } from './pages/CleanupPage';
import { NewsAdminPage } from './pages/NewsAdminPage';
import { ChangeRequestsPage } from './pages/ChangeRequestsPage';
import { CompPortfolioPage } from './pages/CompPortfolioPage';
import { CompetitionsPage } from './pages/CompetitionsPage';
import { CompSwimmersPage } from './pages/CompSwimmersPage';
import { LocationsAdminPage } from './pages/LocationsAdminPage';
import { SessionChangesManualPage } from './pages/SessionChangesManualPage';
import { SessionChangesApprovePage } from './pages/SessionChangesApprovePage';
import { AnnouncementsPage } from './pages/AnnouncementsPage';
import { NotificationsListPage } from './pages/NotificationsListPage';
import {
  ExpensesListPage, PackTypesPage, TimesheetsPage, AddonsListPage,
  CoachAttendancePage, UsersAdminPage, LocationsListPage, MainExpensesListPage,
  UserActivityPage, ChangeLogPage,
} from './pages/LegacyModulePages';
import {
  ReportByMonthPage, ReportByPrivatePage, ReportBySemesterPage,
  ReportByCoachPage, ReportByAttendancePage, ReportPaymentsByCoachPage,
} from './pages/ReportsPages';
import { PaymentDeliveriesPage, PrivateDeliveriesPage } from './pages/DeliveriesPage';
import { BulkWhatsAppPage } from './pages/BulkWhatsAppPage';
import { SettingsAdminPage, TextSettingsPage } from './pages/SettingsAdminPage';
import { PayrollSheetPage } from './pages/PayrollSheetPage';
import { AddonFormPage } from './pages/AddonFormPage';
import { AttendanceSummaryPage, AttendanceDetailsPage } from './pages/AttendanceReports';
import { FeedbackDashboardPage } from './pages/FeedbackDashboardPage';
import { TakeAttendancePage, ClassLatestAttendanceRedirect } from './pages/TakeAttendancePage';
import { CoachSchedulePage } from './pages/CoachSchedulePage';
import { PrivateAttendancePage } from './pages/PrivateAttendancePage';
import { ExtraAttendancePage } from './pages/ExtraAttendancePage';
import { GenerateSessionsPage } from './pages/GenerateSessionsPage';
import { GenerateClassesPage } from './pages/GenerateClassesPage';
import { ChecklistPage } from './pages/ChecklistPage';
import { PayrollHoursPage } from './pages/PayrollHoursPage';
import {
  WebClassesPage, WebClassForm, WebFaqsPage, WebFaqForm, WebLevelsPage, WebLevelForm,
  WebPressesPage, WebPressForm, WebVideosPage, WebVideoForm, WebFeedbackPage,
} from './pages/WebCmsPages';
import { getStoredToken, clearAuth, LAST_ACTIVITY_KEY } from './api/portalApi';
import { AccessProvider, useAccess } from './components/AccessProvider';
import { AccessControlPage } from './pages/AccessControlPage';
import { OldSystemPage } from './pages/OldSystemPage';
import { LandingPage } from './pages/LandingPage';

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!getStoredToken()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** Sign out after 30 minutes without any activity (mouse, keyboard, touch,
 *  scroll) and send the user back to the login page. The last-activity time
 *  lives in localStorage so every open tab shares one idle clock and a tab
 *  that was left open in the background is checked when it becomes visible. */
const IDLE_MS = 30 * 60 * 1000;
function IdleLogout() {
  const navigate = useNavigate();
  useEffect(() => {
    const touch = () => { try { localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now())); } catch { /* ignore */ } };
    const check = () => {
      if (!getStoredToken()) return;
      let last = 0;
      try { last = Number(localStorage.getItem(LAST_ACTIVITY_KEY) || 0); } catch { /* ignore */ }
      if (!last) { touch(); return; }
      if (Date.now() - last > IDLE_MS) {
        clearAuth();
        navigate('/login', { replace: true, state: { reason: 'idle' } });
      }
    };
    check();
    let lastTouch = 0;
    const onActivity = () => { const n = Date.now(); if (n - lastTouch > 15000) { lastTouch = n; touch(); } };
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    const id = window.setInterval(check, 30000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, onActivity));
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(id);
    };
  }, [navigate]);
  return null;
}

/** Analytics dashboard is Full-only (default: SiteMaster). Others sent home. */
function DashboardRoute() {
  const { loading, canEdit } = useAccess();
  if (loading) return null;
  return canEdit('/dashboard') ? <DashboardPage /> : <Navigate to="/" replace />;
}

/** Reset scroll to the top on every route change — otherwise a new page keeps
 *  the previous page's scroll position (the window is the scroll container). */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

export default function App() {
  // BASE_URL tracks vite's `base`, so routing follows the deploy path
  // (/V27_WEB/ in production, / in dev) with no second setting to keep in sync.
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <ScrollToTop />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route
          element={
            <RequireAuth>
              <IdleLogout />
              <AccessProvider>
                <Shell />
              </AccessProvider>
            </RequireAuth>
          }
        >
          <Route path="/" element={<LandingPage />} />
          <Route path="/change-password" element={<ChangePasswordPage />} />
          <Route path="/dashboard" element={<DashboardRoute />} />
          <Route path="/students" element={<StudentsPage />} />
          <Route path="/students/new" element={<StudentForm />} />
          <Route path="/students/:id" element={<StudentDetailPage />} />
          <Route path="/students/:id/portfolio" element={<CompPortfolioPage />} />
          <Route path="/students/:id/checklist" element={<ChecklistPage />} />
          <Route path="/competitions" element={<CompetitionsPage />} />
          <Route path="/comp-swimmers" element={<CompSwimmersPage />} />
          <Route path="/locations" element={<LocationsListPage />} />
          <Route path="/locations/new" element={<LocationForm />} />
          <Route path="/locations/:id" element={<LocationForm />} />
          <Route path="/location-photos" element={<LocationsAdminPage />} />
          <Route path="/session-changes/manual" element={<SessionChangesManualPage />} />
          <Route path="/session-changes/approve" element={<SessionChangesApprovePage />} />
          <Route path="/schedule" element={<GSchedulePage />} />
          <Route path="/pr-schedule" element={<PrSchedulePage />} />
          <Route path="/registrations" element={<RegistrationsPage />} />
          <Route path="/registrations-not-renewed" element={<NotRenewedPage />} />
          <Route path="/registrations/new" element={<RegistrationForm />} />
          <Route path="/registrations/:id" element={<RegistrationForm />} />
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/sessions/generate" element={<GenerateSessionsPage />} />
          <Route path="/sessions/new" element={<SessionForm />} />
          <Route path="/sessions/:sessionId/attendance" element={<TakeAttendancePage />} />
          <Route path="/sessions/:id" element={<SessionForm />} />
          <Route path="/attendance-summary" element={<AttendanceSummaryPage />} />
          <Route path="/attendance-details" element={<AttendanceDetailsPage />} />
          <Route path="/payments" element={<PaymentsPage />} />
          <Route path="/payments/new" element={<PaymentForm />} />
          <Route path="/payments/:id" element={<PaymentForm />} />
          <Route path="/payments-due" element={<PaymentsDuePage />} />
          <Route path="/privates" element={<PrivatePackagesPage />} />
          <Route path="/privates/new" element={<PrivatePackageForm />} />
          <Route path="/privates/:id" element={<PrivatePackageForm />} />
          <Route path="/pr-attendance" element={<PrivateAttendancePage />} />
          <Route path="/pr-payments" element={<PrivatePaymentsPage />} />
          <Route path="/pr-payments/new" element={<PrivatePaymentForm />} />
          <Route path="/pr-payments/:id" element={<PrivatePaymentForm />} />
          <Route path="/ex-payments" element={<ExtraPaymentsPage />} />
          <Route path="/m-payments" element={<MembershipPaymentsPage />} />
          <Route path="/extra-classes" element={<ExtraClassesPage />} />
          <Route path="/extra-classes/new" element={<ExtraClassForm />} />
          <Route path="/extra-classes/:id" element={<ExtraClassForm />} />
          <Route path="/extra-attendance" element={<ExtraAttendancePage key="extra" />} />
          <Route path="/m-attendance" element={<ExtraAttendancePage key="members" memberships />} />
          <Route path="/members" element={<MembershipsPage />} />
          <Route path="/coaches" element={<CoachesPage />} />
          <Route path="/coaches/:id" element={<CoachForm />} />
          <Route path="/coaches/:id/schedule" element={<CoachSchedulePage />} />
          <Route path="/classes" element={<ClassesPage />} />
          <Route path="/classes/generate" element={<GenerateClassesPage />} />
          <Route path="/classes/:classId/attendance" element={<ClassLatestAttendanceRedirect />} />
          <Route path="/classes/:id" element={<ClassForm />} />
          <Route path="/semesters" element={<SemestersPage />} />
          <Route path="/semesters/:id" element={<SemesterForm />} />
          <Route path="/cleanup" element={<CleanupPage />} />
          <Route path="/news" element={<NewsAdminPage />} />
          <Route path="/change-requests" element={<ChangeRequestsPage />} />
          <Route path="/announcements" element={<AnnouncementsPage />} />
          <Route path="/notifications-list" element={<NotificationsListPage />} />
          <Route path="/feedback" element={<FeedbackDashboardPage />} />
          <Route path="/expenses" element={<ExpensesListPage />} />
          <Route path="/expenses/:id" element={<ExpenseForm />} />
          <Route path="/main-expenses" element={<MainExpensesListPage />} />
          <Route path="/main-expenses/new" element={<MainExpenseForm />} />
          <Route path="/main-expenses/:id" element={<MainExpenseForm />} />
          <Route path="/payment-delivery" element={<PaymentDeliveriesPage />} />
          <Route path="/pr-payment-delivery" element={<PrivateDeliveriesPage />} />
          <Route path="/bulk-whatsapp" element={<BulkWhatsAppPage />} />
          <Route path="/pack-types" element={<PackTypesPage />} />
          <Route path="/pack-types/:id" element={<PackTypeForm />} />
          <Route path="/settings" element={<SettingsAdminPage />} />
          <Route path="/text-settings" element={<TextSettingsPage />} />
          <Route path="/access-control" element={<AccessControlPage />} />
          <Route path="/old-system" element={<OldSystemPage />} />
          <Route path="/users" element={<UsersAdminPage />} />
          <Route path="/users/:id" element={<UserForm />} />
          <Route path="/user-activity" element={<UserActivityPage />} />
          <Route path="/web/classes" element={<WebClassesPage />} />
          <Route path="/web/classes/new" element={<WebClassForm />} />
          <Route path="/web/classes/:id" element={<WebClassForm />} />
          <Route path="/web/faqs" element={<WebFaqsPage />} />
          <Route path="/web/faqs/new" element={<WebFaqForm />} />
          <Route path="/web/faqs/:id" element={<WebFaqForm />} />
          <Route path="/web/levels" element={<WebLevelsPage />} />
          <Route path="/web/levels/new" element={<WebLevelForm />} />
          <Route path="/web/levels/:id" element={<WebLevelForm />} />
          <Route path="/web/presses" element={<WebPressesPage />} />
          <Route path="/web/presses/new" element={<WebPressForm />} />
          <Route path="/web/presses/:id" element={<WebPressForm />} />
          <Route path="/web/videos" element={<WebVideosPage />} />
          <Route path="/web/videos/new" element={<WebVideoForm />} />
          <Route path="/web/videos/:id" element={<WebVideoForm />} />
          <Route path="/web/feedback" element={<WebFeedbackPage />} />
          <Route path="/change-log" element={<ChangeLogPage />} />
          <Route path="/reports/by-month" element={<ReportByMonthPage />} />
          <Route path="/reports/by-private" element={<ReportByPrivatePage />} />
          <Route path="/reports/by-semester" element={<ReportBySemesterPage />} />
          <Route path="/reports/by-coach" element={<ReportByCoachPage />} />
          <Route path="/reports/by-attendance" element={<ReportByAttendancePage />} />
          <Route path="/reports/payments-by-coach" element={<ReportPaymentsByCoachPage />} />
          <Route path="/payroll/timesheets" element={<TimesheetsPage />} />
          <Route path="/payroll/timesheets/:id" element={<TimesheetForm />} />
          <Route path="/payroll/sheet/:timesheetId" element={<PayrollSheetPage />} />
          <Route path="/payroll/hours/:timesheetId" element={<PayrollHoursPage />} />
          <Route path="/payroll/addons" element={<AddonsListPage />} />
          <Route path="/payroll/addons/:id" element={<AddonFormPage />} />
          <Route path="/payroll/coach-attendance" element={<CoachAttendancePage />} />
          <Route path="/payroll/coach-attendance/:id" element={<CoachAttendanceForm />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

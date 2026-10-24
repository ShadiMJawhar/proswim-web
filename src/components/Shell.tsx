import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Users, GraduationCap, CalendarDays, ClipboardCheck, UserRound,
  BookOpen, CreditCard, Trophy, LayoutDashboard, LogOut, Waves,
  PanelLeftClose, PanelLeftOpen, ChevronDown, Layers, Wrench, Wand2,
  Menu, X, Newspaper, Inbox, Megaphone, Medal, MapPin, CalendarX,
  Smartphone, MessageCircle, Settings, Bell, Wallet, Receipt, Truck,
  Shield, Clock, MessageSquare, BarChart3, History, CalendarPlus, Globe, Search, ShieldCheck, Home, PowerOff, KeyRound, Sparkles,
} from 'lucide-react';
import { getStoredUser, clearAuth, apiRequest, isSuperUser } from '../api/portalApi';
import { IntroSplash } from './IntroSplash';
import { Bubbles } from './Bubbles';
import { AiPanel } from './AiPanel';
import { CommandPalette } from './CommandPalette';
import { ToastHost } from './Toast';
import { useAccess } from './AccessProvider';

type Icon = React.ComponentType<{ className?: string }>;

interface NavItem {
  to: string;
  label: string;
  icon: Icon;
  end?: boolean;
  soon?: boolean;
  /** Live count rendered as a red pill next to the label. */
  badge?: 'requests' | 'notifs';
  /** Only shown to super users (matches the API's super-user gate). */
  superOnly?: boolean;
}

interface NavGroup {
  label: string;
  icon: Icon;
  children: NavItem[];
  /** Only shown to super users (matches the API's super-user gate). */
  superOnly?: boolean;
}

type NavEntry = NavItem | NavGroup;

const isGroup = (e: NavEntry): e is NavGroup => 'children' in e;

// Grouped navigation, top-level sections expand to reveal their pages, so the
// long flat list collapses to a handful of headers (cf. the legacy top menu's
// dropdowns). Single links stay flat.
const FULL_NAV: NavEntry[] = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  {
    label: 'Students',
    icon: Users,
    children: [
      { to: '/students', label: 'Students', icon: Users },
      { to: '/comp-swimmers', label: 'Competitive Swimmers', icon: Medal },
      { to: '/competitions', label: 'Competitions', icon: Trophy },
    ],
  },
  {
    label: 'Group',
    icon: CalendarDays,
    children: [
      { to: '/schedule', label: 'Schedule', icon: CalendarDays },
      { to: '/registrations', label: 'Registrations', icon: BookOpen },
      { to: '/registrations-not-renewed', label: 'Did Not Renew', icon: CalendarX },
      { to: '/sessions', label: 'Sessions', icon: ClipboardCheck },
      { to: '/sessions/generate', label: 'Generate Sessions', icon: CalendarPlus },
      // Attendance Details stays routable via the Summary's per-student links.
      { to: '/attendance-summary', label: 'Attendance', icon: ClipboardCheck },
      { to: '/payments', label: 'Payments', icon: CreditCard },
      { to: '/payments-due', label: 'Due Payments', icon: CreditCard },
      { to: '/payment-delivery', label: 'Payment Delivery', icon: Truck },
      { to: '/expenses', label: 'Expenses', icon: Receipt },
      { to: '/main-expenses', label: 'Main Expenses', icon: Receipt },
    ],
  },
  {
    label: 'Private',
    icon: GraduationCap,
    children: [
      { to: '/pr-schedule', label: 'Schedule', icon: CalendarDays },
      { to: '/pr-attendance', label: 'Daily Attendance', icon: ClipboardCheck },
      { to: '/privates', label: 'Packages', icon: GraduationCap },
      { to: '/pr-payments', label: 'Payments', icon: CreditCard },
      { to: '/pr-payment-delivery', label: 'Payment Delivery', icon: Truck },
    ],
  },
  {
    label: 'Extras & Membership',
    icon: Layers,
    children: [
      { to: '/extra-classes', label: 'Extra Classes', icon: BookOpen },
      { to: '/extra-attendance', label: 'Daily Attendance', icon: ClipboardCheck },
      { to: '/members', label: 'Memberships', icon: UserRound },
      { to: '/m-attendance', label: 'Membership Attendance', icon: ClipboardCheck },
      { to: '/ex-payments', label: 'Extra Payments', icon: CreditCard },
      { to: '/m-payments', label: 'Membership Payments', icon: CreditCard },
    ],
  },
  {
    label: 'Mobile App',
    icon: Smartphone,
    children: [
      { to: '/change-requests', label: 'Requests', icon: Inbox, badge: 'requests' },
      { to: '/session-changes/approve', label: 'Approve Changes', icon: ClipboardCheck },
      { to: '/session-changes/manual', label: 'Manual Change', icon: CalendarX },
      { to: '/news', label: 'News', icon: Newspaper },
      { to: '/announcements', label: 'Notifications', icon: Megaphone },
    ],
  },
  {
    label: 'Setup Website',
    icon: Globe,
    children: [
      { to: '/web/classes', label: 'Classes', icon: Globe },
      { to: '/web/levels', label: 'Levels', icon: Globe },
      { to: '/web/faqs', label: 'FAQs', icon: Globe },
      { to: '/web/presses', label: 'Press', icon: Globe },
      { to: '/web/videos', label: 'Videos', icon: Globe },
      { to: '/web/feedback', label: 'Feedback', icon: Globe },
    ],
  },
  {
    label: 'Communication',
    icon: MessageCircle,
    children: [
      { to: '/bulk-whatsapp', label: 'Bulk WhatsApp', icon: MessageCircle },
    ],
  },
  {
    label: 'Setup Group',
    icon: CalendarDays,
    children: [
      { to: '/classes', label: 'Classes', icon: CalendarDays },
      { to: '/semesters', label: 'Semesters', icon: ClipboardCheck },
    ],
  },
  {
    label: 'Setup Private',
    icon: GraduationCap,
    children: [
      { to: '/pack-types', label: 'Pack Types', icon: Layers },
    ],
  },
  {
    label: 'Payroll',
    icon: Wallet,
    children: [
      { to: '/payroll/timesheets', label: 'Timesheets', icon: Clock },
      { to: '/payroll/addons', label: 'Add-ons', icon: Wallet },
      { to: '/payroll/coach-attendance', label: 'Coach Attendance', icon: ClipboardCheck },
    ],
  },
  {
    label: 'Reports',
    icon: BarChart3,
    children: [
      { to: '/reports/by-month', label: 'By Month', icon: BarChart3, superOnly: true },
      { to: '/reports/by-semester', label: 'By Semester', icon: BarChart3, superOnly: true },
      { to: '/reports/by-coach', label: 'By Coach', icon: BarChart3, superOnly: true },
      { to: '/reports/by-private', label: 'Private Sessions', icon: BarChart3, superOnly: true },
      { to: '/reports/by-attendance', label: 'Attendance', icon: BarChart3, superOnly: true },
      { to: '/reports/payments-by-coach', label: 'Payments by Coach', icon: BarChart3, superOnly: true },
      { to: '/user-activity', label: 'Activity Log', icon: Clock, superOnly: true },
      { to: '/change-log', label: 'Trace Log', icon: History },
      { to: '/cleanup', label: 'Data Cleanup', icon: Wand2 },
    ],
  },
  { to: '/feedback', label: 'Feedback', icon: MessageSquare },
  { to: '/notifications-list', label: 'Notifications', icon: Bell, badge: 'notifs' },
  {
    label: 'Setup',
    icon: Wrench,
    children: [
      { to: '/locations', label: 'Locations', icon: MapPin },
      { to: '/location-photos', label: 'Location Photos', icon: MapPin },
      { to: '/coaches', label: 'Coaches', icon: UserRound },
      { to: '/users', label: 'Users', icon: Shield },
      { to: '/settings', label: 'System Settings', icon: Settings },
      { to: '/text-settings', label: 'Text Settings', icon: MessageSquare },
      { to: '/access-control', label: 'Access Control', icon: ShieldCheck },
      { to: '/old-system', label: 'Old System', icon: PowerOff },
    ],
  },
];

// Legacy Admin_TopMenu short-circuits for restricted personas, kept flat.
const GUEST_NAV: NavEntry[] = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/schedule', label: 'Group Schedule', icon: CalendarDays },
  { to: '/pr-schedule', label: 'Private Schedule', icon: GraduationCap },
  { to: '/students', label: 'Students', icon: Users },
];

const PAYMENT_AUDIT_NAV: NavEntry[] = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/payments', label: 'Group Payments', icon: CreditCard },
  { to: '/pr-payments', label: 'Private Payments', icon: GraduationCap },
  { to: '/ex-payments', label: 'Extra Payments', icon: BookOpen },
  { to: '/m-payments', label: 'Membership Payments', icon: UserRound },
];

function navForUserType(userType: string | null | undefined) {
  const t = (userType || '').toLowerCase();
  if (t === 'guest') return GUEST_NAV;
  if (t === 'payment/audit') return PAYMENT_AUDIT_NAV;
  return FULL_NAV;
}

// The set of group labels whose children include the current path, used to
// auto-open the active group on first render.
function groupsContaining(nav: NavEntry[], path: string): Set<string> {
  const open = new Set<string>();
  for (const e of nav)
    if (isGroup(e) && e.children.some((c) => c.to === path))
      open.add(e.label);
  return open;
}

export function Shell() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = getStoredUser();
  const superU = isSuperUser(user);
  const { canView, map: accessMap } = useAccess();
  // Block direct navigation to a page the role has no access to (menu hides it,
  // but a typed URL / stale link would still land here). Match the longest
  // registered route that prefixes the current path.
  const deniedRoute = (() => {
    const p = location.pathname;
    if (p === '/') return ''; // the landing is always accessible
    const match = Object.keys(accessMap)
      .filter((code) => code !== '/' && (p === code || p.startsWith(code + '/')))
      .sort((a, b) => b.length - a.length)[0];
    return match && accessMap[match] === 'None' ? match : '';
  })();
  // A leaf is shown when the role's access map allows viewing its route (and it
  // isn't gated to super users by an explicit flag). Groups show if any child does.
  const showLeaf = (it: NavItem) => canView(it.to) && (!it.superOnly || superU);
  const NAV = navForUserType(user?.userType)
    .filter((e) => !e.superOnly || superU)
    .map((e) => (isGroup(e) ? { ...e, children: e.children.filter(showLeaf) } : e))
    .filter((e) => (isGroup(e) ? e.children.length > 0 : showLeaf(e)));

  // Post-login cinematic intro, plays once per sign-in.
  const [showIntro, setShowIntro] = useState(() => sessionStorage.getItem('showIntro') === '1');

  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('sidebarCollapsed') === '1'
  );
  const [open, setOpen] = useState<Set<string>>(
    () => groupsContaining(NAV, location.pathname)
  );

  // Under md the sidebar stops being a rail and becomes an off-canvas drawer:
  // an icon-only rail is the wrong affordance on a phone, so `rail` (the visual
  // collapse) is suppressed there while `collapsed` keeps the desktop setting.
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const rail = collapsed && !isMobile;

  // Live nav badges (pending parent requests, sent notifications). Refreshed
  // on navigation so acting on a queue updates the count without a reload.
  const [badgeCounts, setBadgeCounts] = useState<Record<'requests' | 'notifs', number>>(
    { requests: 0, notifs: 0 }
  );
  const allItems = NAV.flatMap((e) => (isGroup(e) ? e.children : [e]));
  const wantsBadge = (b: 'requests' | 'notifs') => allItems.some((i) => i.badge === b);
  const hasRequestsBadge = wantsBadge('requests');
  const hasNotifsBadge = wantsBadge('notifs');
  useEffect(() => {
    // Badges are best-effort; the pages themselves report errors.
    if (hasRequestsBadge) {
      apiRequest<unknown[]>('/api/portal/change-requests?status=Pending')
        .then((rows) => setBadgeCounts((b) => ({ ...b, requests: Array.isArray(rows) ? rows.length : 0 })))
        .catch(() => {});
    }
    if (hasNotifsBadge) {
      apiRequest<unknown[]>('/api/portal/notify/sent')
        .then((rows) => setBadgeCounts((b) => ({ ...b, notifs: Array.isArray(rows) ? rows.length : 0 })))
        .catch(() => {});
    }
  }, [hasRequestsBadge, hasNotifsBadge, location.pathname]);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const sync = () => setIsMobile(mq.matches);
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // Navigating on a phone should dismiss the drawer, not leave it covering the page.
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  function toggleSidebar() {
    setCollapsed((v) => {
      localStorage.setItem('sidebarCollapsed', v ? '0' : '1');
      return !v;
    });
  }

  function toggleGroup(label: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });
  }

  const [aiOpen, setAiOpen] = useState(false);
  const closeAi = useCallback(() => setAiOpen(false), []);
  const [signingOut, setSigningOut] = useState(false);
  function logout() {
    if (signingOut) return;
    setSigningOut(true); // a red-bubble beat on the way out
    setTimeout(() => {
      clearAuth();
      navigate('/login');
    }, 1100);
  }

  const linkClass = (isActive: boolean, indent = false) =>
    `relative flex items-center py-2.5 text-sm transition-all duration-200 ${
      rail ? 'justify-center px-0 mx-2 rounded-xl' : indent ? 'gap-3 pl-11 pr-4 mx-2 rounded-xl' : 'gap-3 px-4 mx-2 rounded-xl'
    } ${
      isActive
        ? 'bg-white/15 text-white font-semibold shadow-[0_4px_14px_-4px_rgba(0,0,0,0.4)] ring-1 ring-white/15 backdrop-blur-sm'
        : 'text-white/65 hover:text-white hover:bg-white/8 hover:translate-x-0.5'
    }`;

  function renderItem(item: NavItem, indent = false) {
    if (item.soon) {
      return (
        <div
          key={item.to}
          title={rail ? `${item.label}, coming soon` : 'Coming soon'}
          className={`flex items-center py-2.5 text-sm text-white/30 cursor-not-allowed select-none ${rail ? 'justify-center px-0' : 'gap-3 px-5'}`}
        >
          <item.icon className="size-4 shrink-0" />
          {!rail && (
            <>
              <span className="whitespace-nowrap">{item.label}</span>
              <span className="ml-auto text-[9px] uppercase tracking-wider bg-white/10 rounded px-1.5 py-0.5">soon</span>
            </>
          )}
        </div>
      );
    }
    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.end}
        title={rail ? item.label : undefined}
        className={({ isActive }) => linkClass(isActive, indent && !rail)}
      >
        <item.icon className="size-4 shrink-0" />
        {!rail && <span className="whitespace-nowrap">{item.label}</span>}
        {item.badge && badgeCounts[item.badge] > 0 && (
          rail ? (
            <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-red-500" />
          ) : (
            <span className="ml-auto text-[10px] font-bold bg-red-500 text-white rounded-full px-1.5 py-0.5 min-w-5 text-center">
              {badgeCounts[item.badge]}
            </span>
          )
        )}
      </NavLink>
    );
  }

  return (
    <div className="min-h-screen flex">
      {showIntro && (
        <IntroSplash onDone={() => { sessionStorage.removeItem('showIntro'); setShowIntro(false); }} />
      )}
      {signingOut && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: '#f7f9fc' }}>
          <Bubbles tint="red" speed={3} />
          <p className="text-xl font-semibold text-slate-700">See you soon</p>
        </div>
      )}
      {/* Mobile top bar, the only way to reach the nav under md */}
      <header
        className="md:hidden fixed top-0 inset-x-0 z-30 h-14 flex items-center gap-3 px-4 text-white shadow-md"
        style={{ background: 'linear-gradient(90deg, #202f4d 0%, #1e5c97 100%)' }}
      >
        <button onClick={() => setDrawerOpen(true)} title="Open menu" className="p-1 -ml-1">
          <Menu className="size-6" />
        </button>
        <img src={`${import.meta.env.BASE_URL}ProSwimLogo.png`} alt="ProSwim" className="h-6 w-auto bg-white rounded px-1.5 py-0.5" />
        <span className="text-[10px] tracking-widest uppercase text-white/60">Portal</span>
      </header>

      {/* Backdrop behind the open drawer */}
      {drawerOpen && (
        <div
          onClick={() => setDrawerOpen(false)}
          className="md:hidden fixed inset-0 z-40 bg-slate-900/50"
        />
      )}

      {/* Sidebar, an icon rail on desktop, an off-canvas drawer under md */}
      <aside
        className={`${rail ? 'w-16' : 'w-60'} shrink-0 text-white flex flex-col transition-transform md:transition-[width] duration-200 ease-in-out overflow-hidden
          fixed inset-y-0 left-0 z-50 md:static md:z-auto md:translate-x-0
          ${drawerOpen ? 'translate-x-0' : '-translate-x-full'}`}
        style={{ background: 'linear-gradient(180deg, #202f4d 0%, #1d3a5f 55%, #1e5c97 130%)' }}
      >
        {/* Collapse toggle (desktop) / close drawer (mobile), pinned to the top */}
        <button
          onClick={() => (isMobile ? setDrawerOpen(false) : toggleSidebar())}
          title={isMobile ? 'Close menu' : rail ? 'Expand menu' : 'Collapse menu'}
          className={`flex items-center pt-3 pb-1 text-white/50 hover:text-white ${rail ? 'justify-center px-0' : 'justify-end px-4'}`}
        >
          {isMobile
            ? <X className="size-5 shrink-0" />
            : rail ? <PanelLeftOpen className="size-4 shrink-0" /> : <PanelLeftClose className="size-4 shrink-0" />}
        </button>

        <div className={`flex flex-col items-center border-b border-white/10 pb-4 pt-1 ${rail ? 'px-1' : 'px-4'}`}>
          {rail ? (
            <div className="w-9 h-9 rounded-xl bg-white flex items-center justify-center shrink-0">
              <Waves className="size-5 text-[#1e5c97]" />
            </div>
          ) : (
            <>
              <div className="bg-white rounded-lg px-3 py-2 w-full flex justify-center">
                <img src={`${import.meta.env.BASE_URL}ProSwimLogo.png`} alt="ProSwim" className="h-7 w-auto" />
              </div>
              <p className="text-[10px] text-white/50 mt-1.5 tracking-widest uppercase whitespace-nowrap">Management Portal</p>
            </>
          )}
        </div>

        <button
          onClick={() => window.dispatchEvent(new Event('command-palette:open'))}
          title="Search (Ctrl-K)"
          className={`mx-3 mt-3 flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white transition-colors ${rail ? 'justify-center p-2' : 'px-3 py-2'}`}
        >
          <Search className="size-4 shrink-0" />
          {!rail && (
            <>
              <span className="text-sm flex-1 text-left">Search…</span>
              <kbd className="text-[10px] border border-white/20 rounded px-1 py-0.5">Ctrl K</kbd>
            </>
          )}
        </button>

        <nav className="flex-1 py-3 overflow-y-auto overflow-x-hidden">
          {NAV.map((entry) => {
            // Flat link
            if (!isGroup(entry)) return renderItem(entry);

            // When the rail is collapsed, groups flatten to their icon children.
            if (rail) return entry.children.map((c) => renderItem(c));

            const isOpen = open.has(entry.label);
            const activeInside = entry.children.some((c) => c.to === location.pathname);
            return (
              <div key={entry.label}>
                <button
                  onClick={() => toggleGroup(entry.label)}
                  className={`w-full flex items-center gap-3 px-5 py-2.5 text-sm transition-colors ${
                    activeInside ? 'text-white font-semibold' : 'text-white/70 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <entry.icon className="size-4 shrink-0" />
                  <span className="whitespace-nowrap">{entry.label}</span>
                  <ChevronDown className={`size-4 ml-auto shrink-0 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                </button>
                {isOpen && (
                  <div className="overflow-hidden">
                    {entry.children.map((c) => renderItem(c, true))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className={`border-t border-white/10 py-4 ${rail ? 'px-0 flex flex-col items-center gap-2' : 'px-5'}`}>
          {!rail && (
            <>
              <p className="text-xs font-semibold truncate">{user?.fullName || 'Signed in'}</p>
              <p className="text-[10px] text-white/50 truncate">{user?.userType || ''}</p>
            </>
          )}
          {superU && (
            <button
              onClick={() => setAiOpen(true)}
              title="ProSwim AI assistant"
              className={`flex items-center text-xs text-white/60 hover:text-white ${rail ? 'justify-center' : 'gap-1.5 mt-2'}`}
            >
              <Sparkles className="size-3.5 shrink-0" />
              {!rail && 'ProSwim AI'}
            </button>
          )}
          <button
            onClick={() => navigate('/change-password')}
            title="Change password"
            className={`flex items-center text-xs text-white/60 hover:text-white ${rail ? 'justify-center' : 'gap-1.5 mt-2'}`}
          >
            <KeyRound className="size-3.5 shrink-0" />
            {!rail && 'Change password'}
          </button>
          <button
            onClick={logout}
            title="Sign out"
            className={`flex items-center text-xs text-white/60 hover:text-white ${rail ? 'justify-center' : 'gap-1.5 mt-2'}`}
          >
            <LogOut className="size-3.5 shrink-0" />
            {!rail && 'Sign out'}
          </button>
        </div>
      </aside>

      {/* Main, keyed on the route so every navigation animates in.
          pt-14 clears the fixed mobile top bar. */}
      <main className="flex-1 min-w-0 overflow-x-hidden pt-14 md:pt-0">
        <div key={location.pathname} className="page-in">
          {deniedRoute ? (
            <div className="flex flex-col items-center justify-center h-[70vh] text-center px-6">
              <ShieldCheck className="size-10 text-slate-300 mb-3" />
              <p className="text-lg font-bold text-slate-700">No access to this page</p>
              <p className="text-sm text-slate-500 mt-1">Your role doesn’t have access here. Ask a SiteMaster if you need it.</p>
            </div>
          ) : (
            <Outlet />
          )}
        </div>
      </main>

      {/* AI assistant — super users only */}
      {isSuperUser(user) && <AiPanel open={aiOpen} onClose={closeAi} />}
      <CommandPalette />
      <ToastHost />
    </div>
  );
}

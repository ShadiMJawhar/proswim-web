// Home / launcher, accessible to every role. Three parts:
//  1) an intro about the portal,
//  2) an icon grid of every page this role can open (from the access map),
//  3) a footer about the ProSwim website + mobile app, with a link to the site.
// The analytics Dashboard is a Full-only tile here (it lives at /dashboard).

import { Link } from 'react-router-dom';
import {
  LayoutGrid, Users, GraduationCap, CalendarDays, ClipboardCheck, UserRound, BookOpen,
  CreditCard, Trophy, Medal, MapPin, Wallet, Clock, MessageSquare, Settings, Shield,
  BarChart3, Globe, Megaphone, Truck, Layers, Receipt, Wand2, History, Bell, Inbox,
  CalendarX, Newspaper, Waves, Smartphone, ExternalLink, MessageCircle, CalendarPlus, ShieldCheck, PowerOff,
} from 'lucide-react';
import { getStoredUser } from '../api/portalApi';
import { useAccess } from '../components/AccessProvider';

const WEBSITE_URL = 'https://www.proswim-lb.com';

type Icon = typeof Users;
// route -> icon (mirrors the sidebar); anything unmapped falls back to a grid glyph.
const ICONS: Record<string, Icon> = {
  '/dashboard': BarChart3,
  '/students': Users, '/comp-swimmers': Medal, '/competitions': Trophy,
  '/schedule': CalendarDays, '/registrations': BookOpen, '/sessions': ClipboardCheck,
  '/attendance-summary': ClipboardCheck, '/attendance-details': ClipboardCheck,
  '/payments': CreditCard, '/payments-due': CreditCard, '/payment-delivery': Truck,
  '/expenses': Receipt, '/main-expenses': Receipt,
  '/pr-schedule': CalendarDays, '/pr-attendance': ClipboardCheck, '/privates': GraduationCap, '/pr-payments': CreditCard,
  '/extra-classes': BookOpen, '/extra-attendance': ClipboardCheck, '/members': UserRound, '/m-attendance': ClipboardCheck,
  '/ex-payments': CreditCard, '/m-payments': CreditCard,
  '/change-requests': Inbox, '/session-changes/approve': ClipboardCheck, '/session-changes/manual': CalendarX,
  '/news': Newspaper, '/announcements': Megaphone,
  '/bulk-whatsapp': MessageCircle,
  '/classes': CalendarDays, '/semesters': ClipboardCheck, '/pack-types': Layers,
  '/sessions/generate': CalendarPlus,
  '/payroll/timesheets': Clock, '/payroll/addons': Wallet, '/payroll/coach-attendance': ClipboardCheck,
  '/reports/by-month': BarChart3, '/reports/by-semester': BarChart3, '/reports/by-coach': BarChart3,
  '/reports/by-private': BarChart3, '/reports/by-attendance': BarChart3, '/reports/payments-by-coach': BarChart3,
  '/user-activity': Clock, '/change-log': History, '/cleanup': Wand2,
  '/feedback': MessageSquare, '/notifications-list': Bell,
  '/web/classes': Globe, '/web/levels': Globe, '/web/faqs': Globe, '/web/presses': Globe,
  '/web/videos': Globe, '/web/feedback': Globe,
  '/locations': MapPin, '/location-photos': MapPin, '/coaches': UserRound, '/users': Shield,
  '/settings': Settings, '/text-settings': MessageSquare, '/access-control': ShieldCheck,
  '/old-system': PowerOff,
};

// Order groups the way the sidebar reads.
const GROUP_ORDER = [
  'General', 'Students', 'Group', 'Private', 'Extras', 'Mobile App', 'Communication',
  'Setup Group', 'Setup Private', 'Payroll', 'Reports', 'Setup Website', 'Setup',
];

export function LandingPage() {
  const { items, canEdit } = useAccess();
  const user = getStoredUser();

  // Tiles: everything the role can open, minus Home itself. Dashboard needs Full.
  const tiles = items.filter((i) => {
    if (i.code === '/') return false;
    if (i.code === '/dashboard') return canEdit('/dashboard');
    return i.level === 'View' || i.level === 'Full';
  });

  const groups = GROUP_ORDER
    .map((g) => ({ group: g, list: tiles.filter((t) => t.group === g) }))
    .filter((g) => g.list.length > 0);

  const firstName = (user?.fullName || '').trim().split(/\s+/)[0] || '';

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto">
      {/* 1) Intro */}
      <section className="rounded-3xl bg-gradient-to-br from-[#1e5c97] to-[#2f7fc4] text-white p-8 md:p-10 shadow-lg mb-8">
        <div className="flex items-center gap-3 mb-3">
          <Waves className="size-8" />
          <span className="text-sm font-semibold tracking-widest uppercase text-white/70">ProSwim Management Portal</span>
        </div>
        <h1 className="text-2xl md:text-3xl font-extrabold mb-2">
          {firstName ? `Welcome back, ${firstName}.` : 'Welcome to ProSwim.'}
        </h1>
        <p className="text-white/85 max-w-2xl leading-relaxed">
          Your central place to run the school — students and schedules, group &amp; private classes, payments,
          payroll and reports. Everything you can access is one tap away below. Use <kbd className="mx-1 px-1.5 py-0.5 rounded bg-white/15 text-xs font-semibold">Ctrl</kbd>
          <kbd className="px-1.5 py-0.5 rounded bg-white/15 text-xs font-semibold">K</kbd> anytime to jump to any page or search a student.
        </p>
      </section>

      {/* 2) Icon grid */}
      {groups.length === 0 ? (
        <p className="text-slate-400 text-sm">No pages are available to your account yet — ask a SiteMaster for access.</p>
      ) : (
        groups.map((g) => (
          <section key={g.group} className="mb-7">
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">{g.group}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {g.list.map((t) => {
                const Ic = ICONS[t.code] ?? LayoutGrid;
                return (
                  <Link
                    key={t.code}
                    to={t.code}
                    className="group flex flex-col items-center gap-2 rounded-2xl border border-slate-100 bg-white p-4 text-center shadow-sm hover:shadow-md hover:border-[#1e5c97]/30 hover:-translate-y-0.5 transition-all"
                  >
                    <span className="flex size-11 items-center justify-center rounded-xl bg-[#e8f0f8] text-[#1e5c97] group-hover:bg-[#1e5c97] group-hover:text-white transition-colors">
                      <Ic className="size-5" />
                    </span>
                    <span className="text-[13px] font-semibold text-slate-700 leading-tight">{t.label}</span>
                  </Link>
                );
              })}
            </div>
          </section>
        ))
      )}

      {/* 3) ProSwim website + mobile app */}
      <section className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-4">
        <a href={WEBSITE_URL} target="_blank" rel="noopener noreferrer"
          className="flex items-start gap-4 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm hover:shadow-md hover:border-[#1e5c97]/30 transition-all">
          <span className="flex size-12 items-center justify-center rounded-xl bg-[#e8f0f8] text-[#1e5c97] shrink-0"><Globe className="size-6" /></span>
          <div>
            <p className="font-bold text-slate-800 flex items-center gap-1.5">ProSwim Website <ExternalLink className="size-3.5 text-slate-400" /></p>
            <p className="text-sm text-slate-500 mt-1">Our public site — classes, levels, FAQs, press and videos. Content here is managed under <span className="font-semibold">Setup&nbsp;Website</span>.</p>
            <p className="text-xs text-[#1e5c97] mt-1">{WEBSITE_URL.replace('https://', '')}</p>
          </div>
        </a>
        <div className="flex items-start gap-4 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <span className="flex size-12 items-center justify-center rounded-xl bg-[#e8f0f8] text-[#1e5c97] shrink-0"><Smartphone className="size-6" /></span>
          <div>
            <p className="font-bold text-slate-800">ProSwim Mobile App</p>
            <p className="text-sm text-slate-500 mt-1">Families use the ProSwim app for schedules, attendance, payments and news — available on iOS and Android. News &amp; notifications you post reach it instantly.</p>
          </div>
        </div>
      </section>
    </div>
  );
}

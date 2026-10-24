// Global command palette (Ctrl/Cmd-K): fuzzy-jump to any page/action and search
// students live. Mounted once in the Shell so it's available on every screen.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, CornerDownLeft, Users, GraduationCap, CalendarDays, CreditCard, BookOpen,
  UserRound, Trophy, MapPin, Wallet, Clock, MessageSquare, Settings, Shield, BarChart3,
  Globe, Megaphone, Truck, Layers, Receipt, ClipboardCheck, Plus,
} from 'lucide-react';
import { apiRequest, getStoredUser, isSuperUser } from '../api/portalApi';
import { useAccess } from './AccessProvider';

type Icon = typeof Search;
interface Page { label: string; to: string; icon: Icon; keywords?: string; superOnly?: boolean }
type Picker = { id: number; label: string };

// Curated jump targets (label + route + search keywords).
const PAGES: Page[] = [
  { label: 'Dashboard', to: '/', icon: BarChart3, keywords: 'home' },
  { label: 'Students', to: '/students', icon: Users, keywords: 'kids swimmers list' },
  { label: 'New Student', to: '/students/new', icon: Plus, keywords: 'add create student' },
  { label: 'Competitive Swimmers', to: '/comp-swimmers', icon: Trophy, keywords: 'competition team' },
  { label: 'Competitions', to: '/competitions', icon: Trophy },
  { label: 'Group Schedule', to: '/schedule', icon: CalendarDays, keywords: 'calendar sessions' },
  { label: 'Registrations', to: '/registrations', icon: BookOpen, keywords: 'enroll' },
  { label: 'Did Not Renew', to: '/registrations-not-renewed', icon: BookOpen, keywords: 'not renewed registrations lost' },
  { label: 'Sessions', to: '/sessions', icon: ClipboardCheck, keywords: 'attendance' },
  { label: 'Generate Sessions', to: '/sessions/generate', icon: CalendarDays },
  { label: 'Attendance Summary', to: '/attendance-summary', icon: ClipboardCheck },
  { label: 'Attendance Details', to: '/attendance-details', icon: ClipboardCheck },
  { label: 'Payments', to: '/payments', icon: CreditCard, keywords: 'money' },
  { label: 'Due Payments', to: '/payments-due', icon: CreditCard, keywords: 'owed balance' },
  { label: 'Payment Delivery', to: '/payment-delivery', icon: Truck },
  { label: 'Expenses', to: '/expenses', icon: Receipt },
  { label: 'Main Expenses', to: '/main-expenses', icon: Receipt, keywords: 'rent maintenance' },
  { label: 'Private Schedule', to: '/pr-schedule', icon: CalendarDays, keywords: 'private lessons' },
  { label: 'Private Daily Attendance', to: '/pr-attendance', icon: ClipboardCheck },
  { label: 'Private Packages', to: '/privates', icon: GraduationCap },
  { label: 'Private Payments', to: '/pr-payments', icon: CreditCard },
  { label: 'Extra Classes', to: '/extra-classes', icon: BookOpen, keywords: 'aquagym aquababy' },
  { label: 'Extra Class Attendance', to: '/extra-attendance', icon: ClipboardCheck },
  { label: 'Memberships', to: '/members', icon: UserRound },
  { label: 'Membership Attendance', to: '/m-attendance', icon: ClipboardCheck },
  { label: 'Coaches', to: '/coaches', icon: UserRound, keywords: 'staff instructors' },
  { label: 'Schools', to: '/schools', icon: GraduationCap, keywords: 'school list setup' },
  { label: 'Classes', to: '/classes', icon: CalendarDays },
  { label: 'Semesters', to: '/semesters', icon: ClipboardCheck },
  { label: 'Locations', to: '/locations', icon: MapPin, keywords: 'branch pool' },
  { label: 'Bulk WhatsApp / Email / Push', to: '/bulk-whatsapp', icon: MessageSquare, keywords: 'message communicate blast' },
  { label: 'News', to: '/news', icon: Megaphone },
  { label: 'Announcements', to: '/announcements', icon: Megaphone, keywords: 'notify push' },
  { label: 'Feedback', to: '/feedback', icon: MessageSquare, keywords: 'survey rating' },
  { label: 'Timesheets', to: '/payroll/timesheets', icon: Clock, keywords: 'payroll salary' },
  { label: 'Payroll Add-ons', to: '/payroll/addons', icon: Wallet, keywords: 'bonus loan penalty' },
  { label: 'Coach Attendance', to: '/payroll/coach-attendance', icon: ClipboardCheck },
  { label: 'Pack Types', to: '/pack-types', icon: Layers },
  { label: 'Settings', to: '/settings', icon: Settings },
  { label: 'Users', to: '/users', icon: Shield, keywords: 'accounts staff logins' },
  // Website (super users)
  { label: 'Website · Classes', to: '/web/classes', icon: Globe, superOnly: true },
  { label: 'Website · FAQs', to: '/web/faqs', icon: Globe, superOnly: true },
  { label: 'Website · Levels', to: '/web/levels', icon: Globe, superOnly: true },
  { label: 'Website · Press', to: '/web/presses', icon: Globe, superOnly: true },
  { label: 'Website · Videos', to: '/web/videos', icon: Globe, superOnly: true },
  { label: 'Website · Feedback', to: '/web/feedback', icon: Globe, superOnly: true },
  // Reports (super users)
  { label: 'Reports · By Month', to: '/reports/by-month', icon: BarChart3, superOnly: true },
  { label: 'Reports · By Semester', to: '/reports/by-semester', icon: BarChart3, superOnly: true },
  { label: 'Reports · By Coach', to: '/reports/by-coach', icon: BarChart3, superOnly: true },
  { label: 'Reports · Payments by Coach', to: '/reports/payments-by-coach', icon: BarChart3, superOnly: true },
  { label: 'Reports · Attendance', to: '/reports/by-attendance', icon: BarChart3, superOnly: true },
  { label: 'Change Log', to: '/change-log', icon: Clock, keywords: 'audit history' },
  { label: 'Activity Log', to: '/user-activity', icon: Clock, superOnly: true, keywords: 'audit' },
];

// Lightweight subsequence fuzzy match ("ptd" matches "Payment Due").
function fuzzy(text: string, q: string): boolean {
  const t = text.toLowerCase();
  if (t.includes(q)) return true;
  let i = 0;
  for (const ch of t) { if (ch === q[i]) i++; if (i === q.length) return true; }
  return i === q.length;
}

export function CommandPalette() {
  const navigate = useNavigate();
  const user = getStoredUser();
  const superUser = isSuperUser(user);
  // Same gate as the sidebar: role access (tbl_Portal_RoleAccess) + superOnly.
  const { canView } = useAccess();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [students, setStudents] = useState<Picker[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global open shortcut + Escape to close; also opens via a custom event so a
  // visible button (in the sidebar) can trigger it.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); }
      else if (e.key === 'Escape') setOpen(false);
    };
    const openEvt = () => setOpen(true);
    window.addEventListener('keydown', h);
    window.addEventListener('command-palette:open', openEvt);
    return () => { window.removeEventListener('keydown', h); window.removeEventListener('command-palette:open', openEvt); };
  }, []);

  useEffect(() => {
    if (open) { setQ(''); setStudents([]); setActive(0); setTimeout(() => inputRef.current?.focus(), 20); }
  }, [open]);

  // Live student search (debounced), reusing the existing endpoint.
  useEffect(() => {
    if (q.trim().length < 2) { setStudents([]); return; }
    const t = setTimeout(() => {
      apiRequest<Picker[]>(`/api/portal/edit/student-search?q=${encodeURIComponent(q.trim())}`)
        .then((r) => setStudents(r.slice(0, 6)))
        .catch(() => setStudents([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const pageMatches = useMemo(() => {
    const s = q.trim().toLowerCase();
    const visible = PAGES.filter((p) => canView(p.to) && (!p.superOnly || superUser));
    if (!s) return visible.slice(0, 7);
    return visible.filter((p) => fuzzy(`${p.label} ${p.keywords ?? ''}`, s)).slice(0, 8);
  }, [q, superUser, canView]);

  type Item = { key: string; label: string; icon: Icon; to: string; group: string };
  const items: Item[] = useMemo(() => [
    ...pageMatches.map((p) => ({ key: 'p' + p.to, label: p.label, icon: p.icon, to: p.to, group: 'Pages' })),
    ...students.map((s) => ({ key: 's' + s.id, label: s.label, icon: Users, to: `/students/${s.id}`, group: 'Students' })),
  ], [pageMatches, students]);

  useEffect(() => { setActive((a) => Math.min(a, Math.max(0, items.length - 1))); }, [items.length]);

  function go(to: string) { setOpen(false); navigate(to); }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[active]) go(items[active].to); }
  }

  if (!open) return null;

  let lastGroup = '';
  return (
    <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-start justify-center pt-[12vh] px-4"
      onClick={() => setOpen(false)}>
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 border-b border-slate-100">
          <Search className="size-4 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            onKeyDown={onKey}
            placeholder="Jump to a page or search a student…"
            className="flex-1 py-3.5 text-sm outline-none placeholder:text-slate-400"
          />
          <kbd className="hidden sm:block text-[10px] font-semibold text-slate-400 border border-slate-200 rounded px-1.5 py-0.5">ESC</kbd>
        </div>

        <div className="max-h-80 overflow-y-auto py-1">
          {items.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-slate-400">No matches. Try a page name or a student.</p>
          )}
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? (lastGroup = it.group) : null;
            const Ic = it.icon;
            return (
              <div key={it.key}>
                {header && (
                  <p className="px-4 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{header}</p>
                )}
                <button
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(it.to)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm ${
                    i === active ? 'bg-[#e8f0f8] text-[#1e5c97]' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Ic className={`size-4 shrink-0 ${i === active ? 'text-[#1e5c97]' : 'text-slate-400'}`} />
                  <span className="flex-1 truncate">{it.label}</span>
                  {i === active && <CornerDownLeft className="size-3.5 text-[#1e5c97]/60" />}
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-3 px-4 py-2 border-t border-slate-100 text-[11px] text-slate-400">
          <span className="flex items-center gap-1"><kbd className="border border-slate-200 rounded px-1">↑</kbd><kbd className="border border-slate-200 rounded px-1">↓</kbd> navigate</span>
          <span className="flex items-center gap-1"><kbd className="border border-slate-200 rounded px-1">↵</kbd> open</span>
          <span className="ml-auto flex items-center gap-1"><kbd className="border border-slate-200 rounded px-1">Ctrl</kbd><kbd className="border border-slate-200 rounded px-1">K</kbd></span>
        </div>
      </div>
    </div>
  );
}

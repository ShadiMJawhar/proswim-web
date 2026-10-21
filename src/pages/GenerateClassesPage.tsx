// Multi-class generate, port of ClassIndividualMulti.aspx ("Generate
// Multi-Classes" on the classes list). Pick location / semester / coach /
// level, the weekdays, a start time, a period and how many classes per day;
// Generate lays out the day × time grid: every slot ticked, except days left
// unticked and slots the coach already has in that semester (disabled, legacy
// per-slot Class_Select check). Save Changes creates one class per ticked slot
// (remarks blank, not deleted, remarks obligatory when absent), each audited.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, AlertCircle, CalendarPlus, Save } from 'lucide-react';
import { apiRequest, getStoredUser } from '../api/portalApi';
import { PageHero } from '../components/PageHero';
import { SmartBack } from '../components/SmartBack';
import { toast } from '../components/Toast';
import { CLASS_PERIODS, CLASS_TIMES } from '../lib/groupClasses';

type Opt = { value: number; label: string };
type Row = Record<string, unknown>;

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const COUNTS = [1, 2, 3, 4, 5];

const toMinutes = (t: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
const fromMinutes = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function GenerateClassesPage() {
  const user = getStoredUser();
  const navigate = useNavigate();
  const role = (user?.userType || '').toLowerCase();
  const canSave = role !== 'guest' && user?.canSave !== false;
  const locationLocked = role === 'user';

  const [locations, setLocations] = useState<Opt[]>([]);
  const [levels, setLevels] = useState<Opt[]>([]);
  const [semesters, setSemesters] = useState<Opt[]>([]);
  const [coaches, setCoaches] = useState<Opt[]>([]);

  const [locationId, setLocationId] = useState<number>(user?.primaryLocationId || 0);
  const [semesterId, setSemesterId] = useState(0);
  const [coachId, setCoachId] = useState(0);
  const [levelId, setLevelId] = useState(0);
  const [count, setCount] = useState(4);
  const [days, setDays] = useState<Set<string>>(new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']));
  const [timeFrom, setTimeFrom] = useState('15:30');
  const [period, setPeriod] = useState('1');

  // The generated grid: times × days, with the existing slots and the ticks.
  const [times, setTimes] = useState<string[] | null>(null);
  const [existing, setExisting] = useState<Set<string>>(new Set());
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [gridDays, setGridDays] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apiRequest<{ locations: Opt[]; levels: Opt[] }>('/api/portal/modules/lookups')
      .then((lk) => { setLocations(lk.locations ?? []); setLevels(lk.levels ?? []); })
      .catch(() => {});
  }, []);

  // Location → semesters (opens on the UPCOMING one) + coaches (first one;
  // the legacy rebind has no "Not Selected").
  useEffect(() => {
    apiRequest<{ semesters: Row[]; selectedIds?: string }>(
      `/api/portal/modules/semester-options?locationIds=${locationId || ''}&pick=upcoming`)
      .then((r) => {
        const opts = (r.semesters ?? [])
          .map((s) => ({ value: Number(s.SemesterId ?? s.SemesterID ?? 0), label: String(s.SemesterName ?? '') }))
          .filter((o) => o.value > 0);
        setSemesters(opts);
        setSemesterId(Number(String(r.selectedIds ?? '').split(',')[0]) || 0);
      })
      .catch(() => setSemesters([]));
    apiRequest<{ coaches: { coachId: number; coachFullName: string | null }[] }>(
      `/api/portal/schedule/coaches?locationId=${locationId || 0}`)
      .then((r) => {
        const opts = (r.coaches ?? []).map((c) => ({ value: c.coachId, label: c.coachFullName ?? '' }));
        setCoaches(opts);
        setCoachId(opts[0]?.value ?? 0);
      })
      .catch(() => setCoaches([]));
    setTimes(null);
  }, [locationId]);

  const key = (day: string, time: string) => `${day.toLowerCase()}|${toMinutes(time)}`;

  async function generate() {
    setError('');
    const start = toMinutes(timeFrom), step = Math.round(Number(period) * 60);
    const slots: string[] = [];
    for (let i = 0; i < count; i++) {
      const m = start + i * step;
      if (m < 24 * 60) slots.push(fromMinutes(m));
    }
    setBusy(true);
    try {
      const taken = await apiRequest<{ day: string; time: string }[]>(
        `/api/portal/edit/class-slots?semesterId=${semesterId}&coachId=${coachId}`);
      const ex = new Set(taken.map((t) => key(t.day, t.time)));
      const tick = new Set<string>();
      for (const d of DAYS) {
        if (!days.has(d)) continue;
        for (const t of slots) if (!ex.has(key(d, t))) tick.add(key(d, t));
      }
      setExisting(ex);
      setTicked(tick);
      setGridDays(new Set(days));
      setTimes(slots);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not check the existing classes.');
    } finally {
      setBusy(false);
    }
  }

  const selected = useMemo(() => {
    const out: { day: string; time: string }[] = [];
    for (const d of DAYS) for (const t of times ?? []) if (ticked.has(key(d, t))) out.push({ day: d, time: t });
    return out;
  }, [times, ticked]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setBusy(true);
    setError('');
    try {
      const r = await apiRequest<{ generated: number; skipped: number }>('/api/portal/edit/generate-classes', {
        method: 'POST',
        body: JSON.stringify({ locationId, semesterId, coachId, levelId, period, slots: selected }),
      });
      toast.success(`${r.generated} class(es) created${r.skipped ? `, ${r.skipped} skipped (already existed)` : ''}.`);
      navigate(`/classes?locationId=${locationId}&semesterId=${semesterId}`);
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Could not create the classes.';
      setError(m); toast.error(m);
      setBusy(false);
    }
  }

  const sel = 'rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e5c97]/40 disabled:bg-slate-50 disabled:text-slate-400';
  const lbl = 'block text-xs font-semibold text-slate-500 mb-1';

  return (
    <div className="p-6 md:p-8 max-w-5xl">
      <PageHero compact title="Generate Multi-Classes" subtitle="Create a coach's weekly classes in one go" slide={2} />
      <SmartBack label="Back" fallback="/classes" />

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 mb-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={lbl}>Location</label>
          <select value={locationId} disabled={locationLocked} onChange={(e) => setLocationId(Number(e.target.value))} className={`${sel} w-full`}>
            <option value={0}>Not Selected</option>
            {locations.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Semester</label>
          <select value={semesterId} onChange={(e) => { setSemesterId(Number(e.target.value)); setTimes(null); }} className={`${sel} w-full`}>
            <option value={0}>Not Selected</option>
            {semesters.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Coach</label>
          <select value={coachId} onChange={(e) => { setCoachId(Number(e.target.value)); setTimes(null); }} className={`${sel} w-full`}>
            {coaches.length === 0 && <option value={0}>Not Selected</option>}
            {coaches.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Daily Classes</label>
          <select value={count} onChange={(e) => setCount(Number(e.target.value))} className={`${sel} w-full`}>
            {COUNTS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="md:col-start-2">
          <label className={lbl}>Level</label>
          <select value={levelId} onChange={(e) => setLevelId(Number(e.target.value))} className={`${sel} w-full`}>
            <option value={0}>Not Selected</option>
            {levels.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className={lbl}>Days</label>
          <div className="flex flex-wrap gap-3">
            {DAYS.map((d) => (
              <label key={d} className="flex items-center gap-1.5 text-sm text-slate-700 select-none">
                <input
                  type="checkbox"
                  checked={days.has(d)}
                  onChange={() => setDays((cur) => { const n = new Set(cur); if (n.has(d)) n.delete(d); else n.add(d); return n; })}
                  className="accent-[#1e5c97]"
                />
                {d}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className={lbl}>Time From</label>
          <select value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} className={`${sel} w-full`}>
            {CLASS_TIMES.map((t) => <option key={String(t.value)} value={String(t.value)}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Period <span className="font-normal text-slate-400">Hrs</span></label>
          <select value={period} onChange={(e) => setPeriod(e.target.value)} className={`${sel} w-full`}>
            {CLASS_PERIODS.map((p) => <option key={String(p.value)} value={String(p.value)}>{p.label}</option>)}
          </select>
        </div>
        <div className="md:col-span-2 flex justify-end">
          <button onClick={generate} disabled={busy}
            className="btn-grad flex items-center gap-1.5 rounded-lg text-sm font-semibold px-5 py-2 disabled:opacity-60">
            {busy && !times ? <Loader2 className="size-4 animate-spin" /> : <CalendarPlus className="size-4" />}
            Generate
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl p-3 mb-3">
          <AlertCircle className="size-4 text-red-500 shrink-0" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {times && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-soft p-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 uppercase tracking-wider">
                  {DAY_NAMES.map((n) => <th key={n} className="px-2 py-2 font-semibold">{n}</th>)}
                </tr>
              </thead>
              <tbody>
                <tr className="align-top">
                  {DAYS.map((d) => (
                    <td key={d} className="px-2 py-1">
                      {times.map((t) => {
                        const k = key(d, t);
                        const disabled = !gridDays.has(d) || existing.has(k);
                        return (
                          <label key={k} className={`flex items-center gap-1.5 py-1 select-none ${disabled ? 'text-slate-300' : 'text-slate-700'}`}
                            title={existing.has(k) ? 'Class already exists' : undefined}>
                            <input
                              type="checkbox"
                              disabled={disabled}
                              checked={ticked.has(k)}
                              onChange={() => setTicked((cur) => { const n = new Set(cur); if (n.has(k)) n.delete(k); else n.add(k); return n; })}
                              className="accent-[#1e5c97]"
                            />
                            {t}
                          </label>
                        );
                      })}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          {canSave && (
            <div className="flex items-center justify-end gap-3 mt-4 pt-4 border-t border-slate-100">
              <span className="text-sm text-slate-500">{selected.length} class(es) selected</span>
              <button onClick={save} disabled={busy || selected.length === 0}
                className="btn-grad flex items-center gap-1.5 rounded-lg text-sm font-semibold px-5 py-2 disabled:opacity-60">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                Save Changes
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

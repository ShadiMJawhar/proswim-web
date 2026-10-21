// Shared bits of the group-classes pages (classes, sessions, semesters):
// legacy dropdown lists, day/date helpers and the location-scoped option
// sources used by the list filters and the record forms.

type Opt = { value: string | number; label: string };

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Local-time yyyy-mm-dd for today (toISOString would slip a day east of UTC). */
export const isoToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

/** Today's weekday as the legacy ddlDays value ("Mon" … "Sun"). */
export const todayDay = () => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date().getDay()];

/** .NET "%##.00" (percent sign first, no leading zero): 0.8 → "%80.00", 0 → "%.00". */
export function legacyPercent(ratio: number): string {
  const s = (ratio * 100).toFixed(2);
  return `%${s.startsWith('0.') ? s.slice(1) : s}`;
}

/** Legacy ddlClassTime / ddlTimeFrom: 04:30 … 22:45 every quarter hour. */
export const CLASS_TIMES: Opt[] = Array.from({ length: (22 * 60 + 45 - (4 * 60 + 30)) / 15 + 1 }, (_, i) => {
  const m = 4 * 60 + 30 + i * 15;
  const t = `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
  return { value: t, label: t };
});

/** Legacy ddlClassPeriod / ddlPeriod (hours). */
export const CLASS_PERIODS: Opt[] = ['0.5', '1', '1.5', '2', '2.5'].map((v) => ({ value: v, label: v }));

const pickCoaches = (res: unknown): Opt[] =>
  ((res as { coaches?: { coachId: number; coachFullName: string | null }[] } | null)?.coaches ?? [])
    .map((c) => ({ value: c.coachId, label: c.coachFullName ?? '' }));

const pickSemesters = (res: unknown): Opt[] =>
  ((res as { semesters?: Record<string, unknown>[] } | null)?.semesters ?? [])
    .map((s) => ({ value: Number(s.SemesterId ?? s.SemesterID ?? 0), label: String(s.SemesterName ?? '') }))
    .filter((o) => o.value > 0);

/** List filter option source: active coaches of the selected location
 *  (legacy Coach_Select("", active, !inactive, location, "", false)). */
export const coachesOfLocation = {
  url: (v: Record<string, unknown>) => `/api/portal/schedule/coaches?locationId=${Number(v.locationId) || 0}`,
  pick: pickCoaches,
};

/** Form option source: semesters of the form's location (proc order, newest first). */
export const semestersOfFormLocation = (locKey: string, autoFirst = true) => ({
  url: (f: Record<string, unknown>) => `/api/portal/schedule/semesters?locationId=${Number(f[locKey]) || 0}`,
  pick: pickSemesters,
  autoFirst,
});

/** Form option source: active coaches of the form's location. */
export const coachesOfFormLocation = (locKey: string, autoFirst = true) => ({
  url: (f: Record<string, unknown>) => `/api/portal/schedule/coaches?locationId=${Number(f[locKey]) || 0}`,
  pick: pickCoaches,
  autoFirst,
});

// Group Schedule header numbers, ported from RegistrationsListView.aspx.cs
// LoadData (integer maths, same filters). Rows are the P_Registration_SelectView
// matrix rows (dayid / ClassTime / CoachName / StudentName / ClassId).

type Row = Record<string, unknown>;

const str = (v: unknown) => (v == null ? '' : String(v));
const num = (v: unknown) => (v == null ? 0 : Number(v) || 0);
// Legacy DataView filter "len(StudentName) > 2": rows without an active student
// come back as two spaces.
const hasStudent = (r: Row) => str(r.StudentName).length > 2;

export interface CoachStats {
  classes: number;    // distinct ClassId of the coach
  students: number;   // distinct StudentName with a student
  places: number;     // registration-class rows with a student
  avail: number;      // "Av. Places"
  pct: number;        // PercentageReserved (int division)
}

export function coachStats(rows: Row[], coach: string, spc: number, timeslots: Row[]): CoachStats {
  const all = rows.filter((r) => str(r.CoachName) === coach);
  const withStudent = all.filter(hasStudent);
  const classes = new Set(all.map((r) => num(r.ClassId))).size;
  let avail = spc * classes - withStudent.length;
  // Over-full slots give their overflow back (legacy DV2.Count >= SPC + 1).
  for (const ts of timeslots) {
    const cnt = withStudent.filter((r) => str(r.dayid) === str(ts.dayid) && str(r.ClassTime) === str(ts.ClassTime)).length;
    if (cnt >= spc + 1) avail += cnt - spc;
  }
  const cap = spc * classes;
  const pct = cap > 0 ? Math.trunc((100 * (cap - avail)) / cap) : 0;
  return {
    classes,
    students: new Set(withStudent.map((r) => str(r.StudentName))).size,
    places: withStudent.length,
    avail,
    pct,
  };
}

export interface ScheduleTotals {
  classes: number;    // TotalNumberOfClasses
  avail: number;      // TotalAvailablePlaces
  pct: number;        // reserved %, only meaningful when avail > 0
}

export function scheduleTotals(rows: Row[], coaches: string[], spc: number, timeslots: Row[]): ScheduleTotals {
  let classes = 0;
  let avail = 0;
  for (const c of coaches) {
    const st = coachStats(rows, c, spc, timeslots);
    classes += st.classes;
    avail += st.avail;
  }
  const cap = classes * spc;
  return { classes, avail, pct: cap > 0 ? Math.trunc(((cap - avail) * 100) / cap) : 0 };
}

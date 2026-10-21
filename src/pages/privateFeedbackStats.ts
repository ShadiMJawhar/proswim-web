// Legacy PrivatePackagesList GenerateStatsPrint (SiteMaster "Coaches Stats" /
// "Location Stats"): per-coach / per-location averages of the feedback answers
// over the loaded rows, scaled ×4, only groups with at least 3 feedbacks,
// sorted by score. Rendered as a printable page in a new tab.

type Row = Record<string, unknown>;

const MIN_COUNT = 3;
const QUESTIONS = [1, 2, 3, 4, 5] as const;

const escapeHtml = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// .NET Math.Round(x, 0) rounds half to even (2.5 → 2, 3.5 → 4).
function roundHalfEven(x: number): number {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff === 0.5) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
}

interface StatRow { desc: string; count: number; total: number; q: number[] }

function buildStats(rows: Row[], groupKey: 'CoachFullName' | 'LocationNickName'): StatRow[] {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const k = String(r[groupKey] ?? '');
    const g = groups.get(k);
    if (g) g.push(r); else groups.set(k, [r]);
  }
  const avg4 = (g: Row[], key: string) =>
    roundHalfEven(4 * (g.reduce((s, r) => s + (Number(r[key]) || 0), 0) / g.length));
  const out: StatRow[] = [];
  for (const [desc, g] of groups) {
    if (g.length < MIN_COUNT) continue;
    out.push({
      desc,
      count: g.length,
      total: avg4(g, 'FeedbackTotal'),
      q: QUESTIONS.map((n) => avg4(g, `FeedbackQuestion${n}Answer`)),
    });
  }
  // DataTable.Select("", "FeedbackTotal desc"); Array sort is stable, so ties
  // keep the proc's order like the legacy page.
  out.sort((a, b) => b.total - a.total);
  return out;
}

// Legacy display name: the "A- " … "D- " coach/location prefixes are dropped.
const cleanDesc = (d: string) =>
  ['A- ', 'B- ', 'C- ', 'D- '].reduce((s, p) => s.split(p).join('').trim(), d);

function todayShort(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/** Opens the legacy AdminPrint "Statistics Per Coach / Location" page in a
 *  new tab and prints it. Returns false when the pop-up was blocked. */
export function printFeedbackStats(rows: Row[], by: 'coach' | 'location'): boolean {
  const stats = buildStats(rows, by === 'coach' ? 'CoachFullName' : 'LocationNickName');
  const label = by === 'coach' ? 'Coach' : 'Location';
  const first = rows[0] ?? {};
  const body = stats.map((s) => `<tr><td style="font-weight:bold">${escapeHtml(cleanDesc(s.desc))}</td>`
    + `<td style="font-weight:bold">${s.count}</td><td style="font-weight:bold">${s.total}</td>`
    + s.q.map((v) => `<td style="color:#666666">${v}</td>`).join('') + '</tr>').join('\n');
  const texts = QUESTIONS.map((n) => `Q${n}: ${escapeHtml(String(first[`FeedbackQuestion${n}Text`] ?? ''))}<br/>`).join('\n');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>ProSwim - ${label} Stats</title>
<style>
body{font-family:Arial,Helvetica,sans-serif;font-size:13px;padding:16px;background:#fff}
#Stats{border-collapse:collapse;min-width:500px}
#Stats td,#Stats th{border:1px solid #6973b8;padding:5px;text-align:center;border-right-color:black;border-left-color:black}
#Stats tbody tr:nth-child(odd){background-color:#d2d7f8}
#Stats th{padding-top:5px;padding-bottom:5px;background-color:#6973b8;color:white;font-weight:bold}
@media print{#Stats tbody tr:nth-child(odd),#Stats th{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>
<h3>Statistics Per ${label} [${todayShort()}]</h3>
<table id="Stats"><tbody>
<tr><th>${label}</th><th>Cnt</th><th>Score</th><th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th><th>Q5</th></tr>
${body}
</tbody></table>
<br/>
PS: Only Records with more than 3 feedback filled are shown<br/>
<br/>
${texts}
<script>window.onload=function(){window.print();}</script></body></html>`;
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
}

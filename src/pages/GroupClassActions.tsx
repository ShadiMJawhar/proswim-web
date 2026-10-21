// Header buttons for the group-classes list pages (ClassesList.aspx,
// ClassesSessionsList.aspx), kept apart from ModulePages so the configs stay lean.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarPlus, Download, Loader2 } from 'lucide-react';
import { apiRequest } from '../api/portalApi';
import { toast } from '../components/Toast';
import type { FilterValues, Row } from '../components/ModuleListPage';
import { isoToday } from '../lib/groupClasses';

const btnCls =
  'flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#1e5c97] hover:bg-slate-50 transition-colors disabled:opacity-50';

const pad = (n: number) => String(n).padStart(2, '0');

function downloadCsv(rows: Row[], name: string) {
  const cols = rows.length ? Object.keys(rows[0]) : [];
  const lines = rows.map((r) => cols.map((c) => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(','));
  const blob = new Blob([[cols.join(','), ...lines].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const d = new Date();
  a.download = `${name}_${d.getFullYear()}_${pad(d.getMonth() + 1)}_${pad(d.getDate())}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** ClassesList.aspx header: "Generate Multi-Classes" (ClassIndividualMulti.aspx). */
export function ClassesHeaderActions() {
  return (
    <Link to="/classes/generate" className={btnCls}>
      <CalendarPlus className="size-3.5" /> Generate Multi-Classes
    </Link>
  );
}

/** ClassesSessionsList.aspx header: "Generate Multi-Sessions" and
 *  "Export Attendance and Remarks" (Attendance_Details_Select for the current
 *  semester / coach / class / day and the picked date, or today; every column). */
export function SessionsHeaderActions({ values }: { values: FilterValues }) {
  const [busy, setBusy] = useState(false);

  async function exportDetails() {
    setBusy(true);
    try {
      const date = String(values.date || '') || isoToday();
      const q = new URLSearchParams({
        semesterIds: String(Number(values.semesterId) || ''),
        coachId: String(Number(values.coachId) || 0),
        classId: String(Number(values.classId) || 0),
        day: String(values.day ?? ''),
        dateFrom: date,
        dateTo: date,
      });
      const rows = await apiRequest<Row[]>(`/api/portal/reports/attendance-details?${q}`);
      if (!rows.length) { toast.info('No attendance rows to export.'); return; }
      downloadCsv(rows, 'ClassesSessions');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Link to="/sessions/generate" className={btnCls}>
        <CalendarPlus className="size-3.5" /> Generate Multi-Sessions
      </Link>
      <button type="button" onClick={exportDetails} disabled={busy} className={btnCls}>
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
        Export Attendance and Remarks
      </button>
    </>
  );
}

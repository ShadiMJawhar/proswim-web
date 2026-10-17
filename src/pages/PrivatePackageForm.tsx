import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Loader2, AlertCircle, Save, Search, X, CalendarPlus, Printer, Link2, Unlink } from 'lucide-react';
import { apiRequest, getStoredUser } from '../api/portalApi';
import { DateInput } from '../components/DateInput';
import { toast } from '../components/Toast';
import { PageHero } from '../components/PageHero';
import { SmartBack } from '../components/SmartBack';
import { fmtDate } from '../lib/dates';

// Private package form (legacy PrivatePackagesIndividual.aspx): package
// fields + parent/child links, and on an existing package the sessions
// workflow (generate, attendance grid, print) and its payments.

type Row = Record<string, unknown>;
type Option = { value: number; label: string };
type Picker = { id: number; label: string };
type PackLink = { id: number; label: string; status: string; parentId: number };

type PackageType = {
  name: string;
  info: string;
  sessions: number;
  price1: number;
  price2: number;
  price3: number;
  currency: string;
};

type SessionRow = {
  PrivateSessionId: number;
  PrivateSessionDate: string;
  PrivateSessionTime: string;
  PrivateSessionStatus: string;
  PrivateSessionAttended: boolean;
  PrivateSessionOverTime: boolean;
  PrivateSessionState: string;
  PrivateSessionRemarks: string;
  PrivateSessionMkupDate: string;
  PrivateSessionMkupTime: string;
  PrivateSessionMkupCoachID: number;
  PrivateSessionLocationID: number;
};

const STUDENT_SLOTS = [0, 1, 2] as const;
const PACKAGE_STATUSES = ['Active', 'Closed', 'ClosedNeedPayment', 'MovedtoGroup', 'Freeze', 'Cancelled', 'Transfer'];
const FOLLOW_UPS = ['', 'Renewing', 'Renewed', 'Leaving', 'MovedtoGroup'];
// Legacy txtPackageLevel: fixed private levels (not the group P_Level_Select list).
const LEVELS = [
  { value: '', label: '-' },
  { value: 'Preperation', label: 'Preperation' },
  { value: 'Beginner', label: 'Beginner' },
  { value: 'Intermediate', label: 'Intermediate' },
  { value: 'Advanced', label: 'Advanced' },
  { value: 'ReadytoGroup', label: 'Ready to Group' },
];
// Legacy txtState list, in order.
const SESSION_STATES = [
  'Regular', 'Cancelled By ProSwim', 'Cancelled Prev. By Student', 'Cancelled on same Day', 'Merged w/o Pack',
  'Freeze Package', 'Cancelled Package', 'Reduced Package', 'Transfer Package', 'Makeup',
];
const SESSION_TYPES = ['Normal', 'Intensive'];
// Legacy time dropdowns: 04:30 … 22:45 in 15-minute steps.
const TIMES: string[] = [];
for (let m = 4 * 60 + 30; m <= 22 * 60 + 45; m += 15)
  TIMES.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
// JS getDay() numbering, Monday first like the legacy checkboxes.
const WEEKDAYS = [
  { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, { value: 3, label: 'Wed' }, { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' }, { value: 0, label: 'Sun' },
];

const inputCls =
  'w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e5c97]/40 disabled:bg-slate-50 disabled:text-slate-500';
const cellCls =
  'rounded border border-slate-200 px-1.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[#1e5c97]/40 disabled:bg-slate-100 disabled:text-slate-400';
const cardCls = 'bg-white rounded-2xl border border-slate-100 shadow-sm p-5';
const btnCls = 'inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#1e5c97] hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed';

const s = (v: unknown) => (v == null ? '' : String(v));
const n = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const dateOnly = (v: unknown) => {
  const str = s(v);
  return str.length >= 10 ? str.slice(0, 10) : '';
};
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// Legacy RowDataBound: date/time are locked once the session is older than yesterday.
const isLockedDate = (iso: string) => {
  const d = new Date(iso);
  return !isNaN(d.getTime()) && d.getTime() < Date.now() - 24 * 3600 * 1000;
};
const escapeHtml = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function toSessionRow(r: Row): SessionRow {
  return {
    PrivateSessionId: n(r.PrivateSessionId),
    PrivateSessionDate: dateOnly(r.PrivateSessionDate),
    PrivateSessionTime: s(r.PrivateSessionTime),
    PrivateSessionStatus: s(r.PrivateSessionStatus),
    PrivateSessionAttended: r.PrivateSessionAttended === true,
    PrivateSessionOverTime: r.PrivateSessionOverTime === true,
    PrivateSessionState: s(r.PrivateSessionState) || 'Regular',
    PrivateSessionRemarks: s(r.PrivateSessionRemarks),
    PrivateSessionMkupDate: dateOnly(r.PrivateSessionMkupDate),
    PrivateSessionMkupTime: s(r.PrivateSessionMkupTime),
    PrivateSessionMkupCoachID: n(r.PrivateSessionMkupCoachID),
    PrivateSessionLocationID: n(r.PrivateSessionLocationID),
  };
}

async function studentName(id: number): Promise<string> {
  if (!id) return '';
  try {
    const r = await apiRequest<Row>(`/api/portal/students/${id}`);
    return s(r.StudentFullName ?? r.studentFullName) || `Student #${id}`;
  } catch {
    return `Student #${id}`;
  }
}

export function PrivatePackageForm() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const user = getStoredUser();
  const userType = (user?.userType ?? '').toLowerCase();
  const isSiteMaster = userType === 'sitemaster';
  const canSave = user?.canSave !== false && userType !== 'guest';
  const isNew = !id || id === 'new';
  const packageId = isNew ? 0 : Number(id);

  const [locations, setLocations] = useState<Option[]>([]);
  const [coaches, setCoaches] = useState<Option[]>([]);
  const [allCoaches, setAllCoaches] = useState<Option[]>([]);
  const [types, setTypes] = useState<PackageType[]>([]);

  // form state
  const [locationId, setLocationId] = useState(user?.primaryLocationId ?? 0);
  const [packageName, setPackageName] = useState('');
  const [coachId, setCoachId] = useState(0);
  const [level, setLevel] = useState('');
  const [startDate, setStartDate] = useState(localToday());
  const [status, setStatus] = useState('Active');
  const [followUp, setFollowUp] = useState('');
  const [sessions, setSessions] = useState(0);
  const [amount, setAmount] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [netToPay, setNetToPay] = useState(0);
  const [currency, setCurrency] = useState('USD');
  const [remarks, setRemarks] = useState('');
  const [studentIds, setStudentIds] = useState<number[]>([0, 0, 0]);
  const [studentLabels, setStudentLabels] = useState<string[]>(['', '', '']);
  const [actionNeeded, setActionNeeded] = useState('');
  const [savedStatus, setSavedStatus] = useState('');
  const [locationName, setLocationName] = useState('');
  const [coachName, setCoachName] = useState('');

  // parent / child links
  const [parentId, setParentId] = useState(0);
  const [parentLabel, setParentLabel] = useState('');
  const [parentOptions, setParentOptions] = useState<PackLink[] | null>(null);
  const [children, setChildren] = useState<PackLink[]>([]);

  // student search (one active slot at a time)
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Picker[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // sessions
  const [sessionRows, setSessionRows] = useState<SessionRow[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [savingSessions, setSavingSessions] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [genStart, setGenStart] = useState('');
  const [genTime1, setGenTime1] = useState('15:30');
  const [genTime2, setGenTime2] = useState('');
  const [genType, setGenType] = useState('Normal');
  const [genDays, setGenDays] = useState<number[]>([]);
  const [genCount, setGenCount] = useState(0);
  const [generating, setGenerating] = useState(false);

  // payments
  const [payments, setPayments] = useState<Row[]>([]);

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const loadedType = useRef(false); // avoid auto-fill clobbering a loaded record

  const isClosed = savedStatus === 'Closed';
  const canSavePackage = canSave && (!isClosed || isSiteMaster);
  const canTouchSessions = canSave && !isNew && (!isClosed || isSiteMaster);
  const lockLocation = userType === 'user';

  // Lookups: locations, all coaches (make-up coach picker), per-location coaches + package types
  useEffect(() => {
    apiRequest<{ locations: { locationId: number; locationNickName: string | null }[] }>('/api/portal/students/lookups')
      .then((lk) =>
        setLocations(lk.locations.map((l) => ({ value: l.locationId, label: l.locationNickName ?? `#${l.locationId}` })))
      )
      .catch(() => {});
    apiRequest<{ coaches: Option[] }>('/api/portal/modules/lookups?locationId=0')
      .then((lk) => setAllCoaches(lk.coaches))
      .catch(() => {});
  }, []);

  useEffect(() => {
    apiRequest<{ coaches: Option[] }>(`/api/portal/modules/lookups?locationId=${locationId}`)
      .then((lk) => setCoaches(lk.coaches))
      .catch(() => {});
    apiRequest<Row[]>(`/api/portal/edit/package-types?locationId=${locationId}`)
      .then((rows) =>
        setTypes(
          rows
            .filter((r) => r.PrivatePackageActive !== false)
            .map((r) => ({
              name: s(r.PrivatePackageName),
              info: s(r.PrivatePackageInfo) || s(r.PrivatePackageName),
              sessions: n(r.PrivatePackageSessionsCount),
              price1: n(r.PrivatePackagePriceForOneStudent),
              price2: n(r.PrivatePackagePriceForTwoStudents),
              price3: n(r.PrivatePackagePriceForThreeStudents),
              currency: s(r.PrivatePackageCurrency) || 'USD',
            }))
        )
      )
      .catch(() => setTypes([]));
  }, [locationId]);

  // ?studentId= prefill for a new package (legacy Request.QueryString["StudentID"]).
  useEffect(() => {
    if (!isNew) return;
    const sid = Number(searchParams.get('studentId') ?? 0);
    if (!sid) return;
    studentName(sid).then((name) => {
      setStudentIds((prev) => prev.map((v, i) => (i === 0 ? sid : v)));
      setStudentLabels((prev) => prev.map((v, i) => (i === 0 ? name : v)));
    });
  }, [isNew]); // eslint-disable-line react-hooks/exhaustive-deps

  function loadSessions() {
    if (!packageId) return;
    setSessionsLoading(true);
    apiRequest<Row[]>(`/api/portal/edit/private-package/${packageId}/sessions`)
      .then((rows) => setSessionRows(rows.map(toSessionRow)))
      .catch(() => setSessionRows([]))
      .finally(() => setSessionsLoading(false));
  }

  function loadPayments() {
    if (!packageId) return;
    apiRequest<Row[]>(`/api/portal/edit/private-package/${packageId}/payments`).then(setPayments).catch(() => setPayments([]));
  }

  function loadLinks(parent: number) {
    if (!packageId) return;
    apiRequest<PackLink[]>(`/api/portal/edit/private-package/${packageId}/children`).then(setChildren).catch(() => setChildren([]));
    if (parent > 0) {
      apiRequest<Row>(`/api/portal/edit/private-package/${parent}`)
        .then((p) => setParentLabel(s(p.PackageNamewInfo) || `Package #${parent}`))
        .catch(() => setParentLabel(`Package #${parent}`));
    } else setParentLabel('');
  }

  function applyRecord(r: Row) {
    loadedType.current = true;
    setLocationId(n(r.PackageLocationId));
    setPackageName(s(r.PackageName));
    setCoachId(n(r.PackageCoachId));
    setLevel(s(r.PackageLevel));
    setStartDate(dateOnly(r.PackageStartDate) || localToday());
    setStatus(s(r.PackageStatus) || 'Active');
    setSavedStatus(s(r.PackageStatus));
    setFollowUp(s(r.PackageFollowUp));
    setSessions(n(r.PackageNumberOfSessions));
    setAmount(n(r.PackageAmount));
    setDiscount(n(r.PackageDiscount));
    setNetToPay(n(r.PackageNetToPay));
    setCurrency(s(r.PackageCurrency) || 'USD');
    setRemarks(s(r.PackageRemarks));
    setActionNeeded(s(r.ActionNeeded));
    setLocationName(s(r.LocationNickName));
    setCoachName(s(r.CoachFullName));
    const parent = n(r.PackageParentID);
    setParentId(parent);
    const ids = [n(r.PackageStudentId1), n(r.PackageStudentId2), n(r.PackageStudentId3)];
    setStudentIds(ids);
    setStudentLabels(ids.map((sid) => (sid ? `Student #${sid}` : '')));
    Promise.all(ids.map(studentName)).then(setStudentLabels);
    loadLinks(parent);
  }

  // Existing package + its sessions, links and payments
  useEffect(() => {
    if (isNew) return;
    setLoading(true);
    apiRequest<Row>(`/api/portal/edit/private-package/${packageId}`)
      .then((r) => {
        applyRecord(r);
        loadSessions();
        loadPayments();
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load package.'))
      .finally(() => setLoading(false));
  }, [packageId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced student search
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (q.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    searchTimer.current = setTimeout(() => {
      apiRequest<Picker[]>(`/api/portal/edit/student-search?q=${encodeURIComponent(q.trim())}`)
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
  }, [q]);

  const studentCount = useMemo(() => studentIds.filter((v) => v > 0).length, [studentIds]);
  const selectedType = useMemo(() => types.find((t) => t.name === packageName), [types, packageName]);
  // Legacy rule: only package types whose name contains "custom" let the user
  // edit the sessions count and amount; the rest come from the price catalogue.
  const isCustom = packageName.toLowerCase().includes('custom');

  useEffect(() => {
    if (!selectedType) return;
    if (loadedType.current) { loadedType.current = false; return; }
    setCurrency(selectedType.currency);
    setSessions(selectedType.sessions);
    const price =
      studentCount >= 3 ? selectedType.price3 : studentCount === 2 ? selectedType.price2 : selectedType.price1;
    setAmount(price);
  }, [selectedType, studentCount]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setNetToPay(amount - discount);
  }, [amount, discount]);

  function pickStudent(p: Picker) {
    if (activeSlot == null) return;
    // Legacy ddlStudentsN_SelectedIndexChanged: identical students are rejected.
    if (studentIds.some((v, i) => i !== activeSlot && v === p.id)) {
      toast.error('You have chosen identical students, please correct.');
      return;
    }
    setStudentIds((prev) => prev.map((v, i) => (i === activeSlot ? p.id : v)));
    setStudentLabels((prev) => prev.map((v, i) => (i === activeSlot ? p.label : v)));
    setActiveSlot(null);
    setQ('');
    setResults([]);
  }

  function clearStudent(slot: number) {
    setStudentIds((prev) => prev.map((v, i) => (i === slot ? 0 : v)));
    setStudentLabels((prev) => prev.map((v, i) => (i === slot ? '' : v)));
  }

  // ── Parent / child links ─────────────────────────────────────────────────
  function openParentPicker() {
    apiRequest<PackLink[]>(`/api/portal/edit/private-package/parent-options?locationId=${locationId}&exclude=${packageId}`)
      .then(setParentOptions)
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Could not load packages.'));
  }

  async function unlinkParent() {
    if (isNew) { setParentId(0); setParentLabel(''); setParentOptions(null); return; }
    try {
      await apiRequest(`/api/portal/edit/private-package/${packageId}/unlink`, { method: 'POST' });
      setParentId(0); setParentLabel(''); setParentOptions(null);
      toast.success('Package unlinked.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Unlink failed.');
    }
  }

  // ── Save ─────────────────────────────────────────────────────────────────
  async function save() {
    if (!studentIds.some((v) => v > 0)) { setError('No student is chosen, please correct.'); return; }
    if (!packageName) { setError('No package is chosen, please correct.'); return; }
    if (!level.trim()) { setError('No level is chosen, please correct.'); return; }
    setSaving(true);
    setError('');

    try {
      if (isNew) {
        // Legacy PackageStudentCheck_Select: warn when an open package exists.
        const open: string[] = [];
        for (const [i, sid] of studentIds.entries()) {
          if (!sid) continue;
          const r = await apiRequest<{ count: number }>(
            `/api/portal/edit/private-package/open-for-student?locationId=${locationId}&studentId=${sid}`
          );
          if (r.count > 0) open.push(studentLabels[i] || `Student #${sid}`);
        }
        if (open.length > 0 && !window.confirm(
          `Please note that another open package already exists for ${open.join(', ')}.\nContinue and add this package anyway?`
        )) { setSaving(false); return; }
      }

      const payload: Record<string, unknown> = {
        PackageLocationId: locationId,
        PackageCoachId: coachId,
        PackageStudentId1: studentIds[0],
        PackageStudentId2: studentIds[1],
        PackageStudentId3: studentIds[2],
        PackageNumberOfSessions: sessions,
        PackageAmount: amount,
        PackageDiscount: discount,
        PackageNetToPay: netToPay,
        PackageStartDate: startDate,
        PackageRemarks: remarks,
        PackageDeleted: false,
        PackageStatus: status,
        PackageName: packageName,
        PackagePenalty: 0,
        PackageLevel: level,
        PackageFollowUp: followUp,
        PackageParentID: parentId,
      };
      if (isNew) payload.PackageCurrency = currency;

      if (isNew) {
        const r = await apiRequest<{ id: number }>('/api/portal/edit/private-package', { method: 'POST', body: JSON.stringify(payload) });
        toast.success('Package created. You can now generate its sessions.');
        // Legacy redirects to the new package so sessions can be generated.
        navigate(`/privates/${r.id}`, { replace: true });
      } else {
        const after = await apiRequest<Row>(`/api/portal/edit/private-package/${packageId}`, { method: 'PUT', body: JSON.stringify(payload) });
        toast.success('Package saved.');
        if (after && typeof after === 'object') applyRecord(after);
        setSaving(false);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed.';
      setError(msg); toast.error(msg);
      setSaving(false);
    }
  }

  // ── Sessions: generate ───────────────────────────────────────────────────
  function toggleGenerate() {
    if (!genOpen) {
      // Legacy BtnAdd_Click: start date = package start, count = package sessions.
      setGenStart(startDate);
      setGenCount(sessions);
    }
    setGenOpen((o) => !o);
  }

  async function generateSessions() {
    if (genDays.length === 0) { toast.error('Please select at least one day of the week.'); return; }
    setGenerating(true);
    try {
      const r = await apiRequest<{ generated: number; duplicates: number; skipped: string[] }>(
        `/api/portal/edit/private-package/${packageId}/generate-sessions`,
        {
          method: 'POST',
          body: JSON.stringify({ startDate: genStart, time1: genTime1, time2: genTime2, status: genType, weekdays: genDays, count: genCount }),
        }
      );
      toast.success(`Sessions generated successfully [new sessions generated: ${r.generated}]`);
      for (const msg of r.skipped) toast.error(msg);
      setGenOpen(false);
      loadSessions();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not generate sessions.');
    } finally {
      setGenerating(false);
    }
  }

  // ── Sessions: attendance grid ────────────────────────────────────────────
  function setRow<K extends keyof SessionRow>(sid: number, key: K, value: SessionRow[K]) {
    setSessionRows((rows) => rows.map((r) => (r.PrivateSessionId === sid ? { ...r, [key]: value } : r)));
  }

  function changeState(row: SessionRow, value: string) {
    // Legacy txtState_Change: not allowed for a session later than now-6h.
    if (value.toLowerCase() === 'cancelled prev. by student') {
      const when = new Date(`${row.PrivateSessionDate}T${row.PrivateSessionTime || '00:00'}:00`);
      if (!isNaN(when.getTime()) && when.getTime() >= Date.now() - 6 * 3600 * 1000) {
        toast.error('Date of session is same as current date, can not choose this status.');
        setRow(row.PrivateSessionId, 'PrivateSessionState', 'Regular');
        return;
      }
    }
    setRow(row.PrivateSessionId, 'PrivateSessionState', value);
  }

  async function saveAttendance() {
    // Client-side copy of the legacy BtnSaveAttendance checks (server re-validates).
    for (const r of sessionRows) {
      const when = `${fmtDate(r.PrivateSessionDate)} ${r.PrivateSessionTime}`;
      if (r.PrivateSessionState === 'Regular' && (r.PrivateSessionMkupDate || r.PrivateSessionMkupTime.length > 2)) {
        toast.error(`Can not SAVE | Regular and having Make Up date (${when}).`); return;
      }
      if (!r.PrivateSessionRemarks.trim() && (r.PrivateSessionMkupDate || r.PrivateSessionState === 'Makeup')) {
        toast.error(`Can not SAVE | Remarks must be added when we have Make Up (${when}).`); return;
      }
    }
    setSavingSessions(true);
    try {
      const r = await apiRequest<{ saved: number; skipped: string[]; notes: string[] }>(
        `/api/portal/edit/private-package/${packageId}/sessions`,
        { method: 'PUT', body: JSON.stringify({ sessions: sessionRows }) }
      );
      toast.success(`Attendance saved (${r.saved} session${r.saved === 1 ? '' : 's'}).`);
      for (const msg of [...r.skipped, ...r.notes]) toast.error(msg);
      loadSessions();
      // Counts/dues on the package change with attendance.
      apiRequest<Row>(`/api/portal/edit/private-package/${packageId}`).then((p) => setActionNeeded(s(p.ActionNeeded))).catch(() => {});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save attendance.');
    } finally {
      setSavingSessions(false);
    }
  }

  // ── Print (legacy BtnPrint_Click HTML) ───────────────────────────────────
  function printPackage() {
    const cell = (label: string, value: string) =>
      `<td align="center">${escapeHtml(label)}</td><td align="center"><u><b>${escapeHtml(value)}</b></u></td>`;
    const cur = currency === 'LBP' ? ' LBP' : ' $';
    const rows = sessionRows.map((r) => `<tr>
      <td align="center">${escapeHtml(fmtDate(r.PrivateSessionDate))}</td>
      <td align="center">${escapeHtml(r.PrivateSessionTime)}</td>
      <td align="center">${escapeHtml(r.PrivateSessionStatus)}</td>
      <td align="center">${r.PrivateSessionAttended ? 'Attended' : 'Absent'}</td>
      <td align="center">${escapeHtml(r.PrivateSessionState)}</td>
      <td align="center">${escapeHtml(r.PrivateSessionRemarks)}</td></tr>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Private Package</title>
<style>body{font-family:Arial,sans-serif;font-size:13px;padding:16px} td{padding:4px 6px} .grid{border-collapse:collapse;width:90%} .grid td{border:1px solid #888}</style>
</head><body>
<table cellspacing="3" cellpadding="3" width="100%">
<tr><td colspan="2"><h2>Private Package</h2></td><td colspan="2" align="right">Swimming Classes</td></tr>
<tr>${cell('Location:', locationName || locations.find((l) => l.value === locationId)?.label || '')}${cell('Package:', packageName)}</tr>
<tr>${cell('Coach:', coachName || coaches.find((c) => c.value === coachId)?.label || '')}${cell('Sessions #:', String(sessions))}</tr>
<tr>${cell('Student 1:', studentLabels[0])}${cell('Amount:', `${amount}${cur}`)}</tr>
<tr>${cell('Student 2:', studentLabels[1])}${cell('Discount:', `${discount}${cur}`)}</tr>
<tr>${cell('Student 3:', studentLabels[2])}<td></td><td></td></tr>
<tr>${cell('Start Date:', fmtDate(startDate))}${cell('Net To Pay:', `${netToPay}${cur}`)}</tr>
<tr>${cell('Status:', status)}${cell('Remarks:', remarks)}</tr>
<tr><td colspan="4"><br/></td></tr>
<tr><td colspan="4" align="center"><table class="grid">
<tr style="background-color:#dddddd"><td align="center"><b>Date</b></td><td align="center"><b>Time</b></td><td align="center"><b>Type</b></td><td align="center"><b>Attendance</b></td><td align="center"><b>Status</b></td><td align="center"><b>Remarks</b></td></tr>
${rows}
</table></td></tr></table>
<script>window.onload=function(){window.print();}</script></body></html>`;
    const w = window.open('', '_blank');
    if (!w) { toast.error('Pop-up blocked; allow pop-ups to print.'); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  // Legacy lblDue rule: LBP packages add up PrivatePaymentTotalAmount (the LBP
  // figure); USD packages add USD paid amounts + ReverseCalcPrivatePayment
  // (the USD value) of LBP payments.
  const paymentsTotal = payments.reduce((sum, p) => {
    if (currency === 'LBP') return sum + n(p.PrivatePaymentTotalAmount);
    const cur = String(p.PrivatePaymentPaidCurrency ?? '').trim().toUpperCase();
    return sum + (cur === 'LBP' ? n(p.ReverseCalcPrivatePayment) : n(p.PrivatePaymentPaidAmount));
  }, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="size-8 text-[#1e5c97] animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-6xl">
      <PageHero
        compact
        title={isNew ? 'New Private Package' : studentLabels[0] || 'Private Package'}
        subtitle={isNew ? 'Register a private training package' : `Edit private package #${packageId}${savedStatus ? ` · ${savedStatus}` : ''}`}
        slide={1}
        right={
          !isNew && canSave ? (
            <div className="flex items-center gap-2">
              <Link to={`/pr-payments/new?packageId=${packageId}`} className="btn-grad rounded-lg text-xs font-semibold px-3 py-1.5">
                Add Payment
              </Link>
            </div>
          ) : undefined
        }
      />

      <SmartBack label="Back" fallback="/privates" />

      {actionNeeded && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl p-3 mb-4">
          <AlertCircle className="size-4 text-red-500 shrink-0" />
          <p className="text-sm font-bold text-red-600">{actionNeeded}</p>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl p-3 mb-4">
          <AlertCircle className="size-4 text-red-500 shrink-0" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}
      {!canSave && (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 mb-4">
          <p className="text-sm text-amber-700">Your account has view-only access, saving is disabled.</p>
        </div>
      )}
      {isClosed && !isSiteMaster && canSave && (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 mb-4">
          <p className="text-sm text-amber-700">This package is closed; only a SiteMaster can change it or its sessions.</p>
        </div>
      )}

      <div className="space-y-4">
        {/* Students */}
        <div className={cardCls}>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-4">Students (1–3 per package)</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {STUDENT_SLOTS.map((slot) => (
              <div key={slot}>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Student {slot + 1}</label>
                {studentIds[slot] ? (
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    <span className="font-medium text-slate-800 truncate">{studentLabels[slot]}</span>
                    <button onClick={() => clearStudent(slot)} className="text-slate-400 hover:text-red-500" title="Remove">
                      <X className="size-4" />
                    </button>
                  </div>
                ) : activeSlot === slot ? (
                  <div className="relative">
                    <Search className="size-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      autoFocus
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      onBlur={() => setTimeout(() => setActiveSlot((cur) => (cur === slot ? null : cur)), 200)}
                      placeholder="Search student…"
                      className={`${inputCls} pl-8`}
                    />
                    {(searching || results.length > 0) && (
                      <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                        {searching && <div className="px-3 py-2 text-xs text-slate-400">Searching…</div>}
                        {results.map((r) => (
                          <button
                            key={r.id}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => pickStudent(r)}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
                          >
                            {r.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => { setActiveSlot(slot); setQ(''); setResults([]); }}
                    className={`${inputCls} text-left text-slate-400 hover:border-[#1e5c97]/50`}
                  >
                    Choose student…
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Package */}
        <div className={cardCls}>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-4">Package</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Location</label>
              <select
                value={locationId}
                onChange={(e) => setLocationId(Number(e.target.value))}
                disabled={lockLocation}
                title={lockLocation ? 'Your account is bound to its location' : undefined}
                className={inputCls}
              >
                <option value={0}>-</option>
                {locations.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Package type</label>
              <select value={packageName} onChange={(e) => setPackageName(e.target.value)} className={inputCls}>
                <option value="">-</option>
                {types.map((t) => <option key={t.name} value={t.name}>{t.info}</option>)}
                {packageName && !types.some((t) => t.name === packageName) && (
                  <option value={packageName}>{packageName}</option>
                )}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Coach</label>
              <select value={coachId} onChange={(e) => setCoachId(Number(e.target.value))} className={inputCls}>
                <option value={0}>-</option>
                {coaches.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                {coachId > 0 && !coaches.some((c) => c.value === coachId) && (
                  <option value={coachId}>{coachName || `Coach #${coachId}`}</option>
                )}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Level</label>
              <select value={level} onChange={(e) => setLevel(e.target.value)} className={inputCls}>
                {LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                {level && !LEVELS.some((l) => l.value === level) && <option value={level}>{level}</option>}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Start date</label>
              <DateInput value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
                {PACKAGE_STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
                {status && !PACKAGE_STATUSES.includes(status) && <option value={status}>{status}</option>}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Follow-up</label>
              <select value={followUp} onChange={(e) => setFollowUp(e.target.value)} className={inputCls}>
                {FOLLOW_UPS.map((f) => <option key={f} value={f}>{f || '-'}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Linked to package</label>
              {parentId > 0 && parentOptions == null ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <Link to={`/privates/${parentId}`} className="font-medium text-[#1e5c97] hover:underline truncate">
                    {parentLabel || `Package #${parentId}`}
                  </Link>
                  {canSavePackage && (
                    <button onClick={unlinkParent} className="text-slate-400 hover:text-red-500" title="Unlink">
                      <Unlink className="size-4" />
                    </button>
                  )}
                </div>
              ) : parentOptions ? (
                <div className="flex items-center gap-2">
                  <select value={parentId} onChange={(e) => setParentId(Number(e.target.value))} className={inputCls}>
                    <option value={0}>-</option>
                    {parentOptions.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                  <button onClick={() => setParentOptions(null)} className="text-slate-400 hover:text-slate-600" title="Cancel">
                    <X className="size-4" />
                  </button>
                </div>
              ) : (
                <button onClick={openParentPicker} disabled={!canSavePackage} className={btnCls}>
                  <Link2 className="size-3.5" /> Link to other pack
                </button>
              )}
              {parentOptions && <p className="text-[11px] text-slate-400 mt-1">The link is stored when you save the package.</p>}
              {children.length > 0 && (
                <ul className="mt-2 text-xs text-slate-600 space-y-0.5">
                  {children.map((c) => (
                    <li key={c.id}>
                      Linked package: <Link to={`/privates/${c.id}`} className="text-[#1e5c97] hover:underline">{c.label}</Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* Pricing */}
        <div className={cardCls}>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-4">
            Sessions & Pricing {selectedType && !isCustom ? '· from the package type' : isCustom ? '· custom package' : ''}
          </p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Sessions</label>
              <input type="number" value={sessions} readOnly={!isCustom} onChange={(e) => setSessions(Number(e.target.value))}
                className={`${inputCls} ${isCustom ? '' : 'bg-slate-50'}`} title={isCustom ? undefined : 'Set by the package type'} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Amount</label>
              <input type="number" value={amount} readOnly={!isCustom} onChange={(e) => setAmount(Number(e.target.value))}
                className={`${inputCls} ${isCustom ? '' : 'bg-slate-50'}`} title={isCustom ? undefined : 'Set by the package type'} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Discount</label>
              <input type="number" value={discount} onChange={(e) => setDiscount(Number(e.target.value))} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Net to pay</label>
              <input type="number" value={netToPay} readOnly className={`${inputCls} bg-slate-50`} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                disabled={!isNew}
                className={inputCls}
                title={isNew ? '' : 'Currency is set when the package is created'}
              >
                <option value="USD">USD</option>
                <option value="LBP">LBP</option>
              </select>
            </div>
          </div>
        </div>

        {/* Remarks */}
        <div className={cardCls}>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Remarks</p>
          <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} className={inputCls} />
        </div>
      </div>

      {canSave && (
        <div className="mt-6 flex justify-end">
          <button
            onClick={save}
            disabled={saving || !canSavePackage}
            className="btn-grad flex items-center gap-2 rounded-xl text-sm font-semibold px-6 py-2.5 disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {isNew ? 'Create package' : 'Save changes'}
          </button>
        </div>
      )}

      {/* ── Sessions (edit mode only) ─────────────────────────────────────── */}
      {!isNew && (
        <div className={`${cardCls} mt-8`}>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mr-auto">
              Sessions · {sessionRows.length} of {sessions}
            </p>
            {canTouchSessions && (
              <button onClick={toggleGenerate} className={btnCls}>
                <CalendarPlus className="size-3.5" /> {genOpen ? 'Hide' : 'Generate Sessions'}
              </button>
            )}
            {sessionRows.length > 0 && (
              <button onClick={printPackage} className={btnCls}>
                <Printer className="size-3.5" /> Print
              </button>
            )}
            {canTouchSessions && sessionRows.length > 0 && (
              <button onClick={saveAttendance} disabled={savingSessions} className="btn-grad inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold px-3 py-1.5 disabled:opacity-50">
                {savingSessions ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save Attendance
              </button>
            )}
          </div>

          {genOpen && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 mb-4">
              <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Start date</label>
                  <DateInput value={genStart} onChange={(e) => setGenStart(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Time (day 1)</label>
                  <select value={genTime1} onChange={(e) => setGenTime1(e.target.value)} className={inputCls}>
                    {TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Time (day 2)</label>
                  <select value={genTime2} onChange={(e) => setGenTime2(e.target.value)} className={inputCls} title="Used alternately when exactly two weekdays are chosen">
                    <option value="">same</option>
                    {TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Type</label>
                  <select value={genType} onChange={(e) => setGenType(e.target.value)} className={inputCls}>
                    {SESSION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Sessions to generate</label>
                  <input type="number" min={1} value={genCount} onChange={(e) => setGenCount(Number(e.target.value))} className={inputCls} />
                </div>
                <div className="flex items-end">
                  <button onClick={generateSessions} disabled={generating} className="btn-grad inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold px-3 py-2 disabled:opacity-50">
                    {generating ? <Loader2 className="size-3.5 animate-spin" /> : <CalendarPlus className="size-3.5" />} Generate
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-3 mt-3">
                {WEEKDAYS.map((d) => (
                  <label key={d.value} className="flex items-center gap-1 text-xs text-slate-600 select-none">
                    <input
                      type="checkbox"
                      checked={genDays.includes(d.value)}
                      onChange={(e) => setGenDays((cur) => (e.target.checked ? [...cur, d.value] : cur.filter((v) => v !== d.value)))}
                      className="accent-[#1e5c97]"
                    />
                    {d.label}
                  </label>
                ))}
              </div>
            </div>
          )}

          {sessionsLoading ? (
            <div className="flex items-center justify-center h-24"><Loader2 className="size-6 text-[#1e5c97] animate-spin" /></div>
          ) : sessionRows.length === 0 ? (
            <p className="text-sm text-slate-400">No sessions yet. Generate them above.</p>
          ) : (
            <div className="overflow-x-auto -mx-2">
              <table className="tbl w-full text-xs whitespace-nowrap">
                <thead>
                  <tr className="text-left text-[11px] text-slate-400 uppercase tracking-wider border-b border-slate-100">
                    {['Date', 'Time', 'Type', 'Att', 'OT', 'Status', 'Remarks', 'New Date', 'New Time', 'New Coach', 'Loc'].map((h) => (
                      <th key={h} className="px-2 py-2 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sessionRows.map((r) => {
                    const locked = isLockedDate(r.PrivateSessionDate);
                    const ro = !canTouchSessions;
                    return (
                      <tr key={r.PrivateSessionId} className={`border-b border-slate-50 last:border-0 ${r.PrivateSessionAttended ? 'bg-emerald-100' : ''}`}>
                        <td className="px-2 py-1">
                          <DateInput value={r.PrivateSessionDate} disabled={locked || ro}
                            onChange={(e) => setRow(r.PrivateSessionId, 'PrivateSessionDate', e.target.value)} className={`${cellCls} w-28`} />
                        </td>
                        <td className="px-2 py-1">
                          <select value={r.PrivateSessionTime} disabled={locked || ro}
                            onChange={(e) => setRow(r.PrivateSessionId, 'PrivateSessionTime', e.target.value)} className={cellCls}>
                            <option value="">-</option>
                            {TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
                            {r.PrivateSessionTime && !TIMES.includes(r.PrivateSessionTime) && <option value={r.PrivateSessionTime}>{r.PrivateSessionTime}</option>}
                          </select>
                        </td>
                        <td className="px-2 py-1 text-slate-600">{r.PrivateSessionStatus || '-'}</td>
                        <td className="px-2 py-1 text-center">
                          <input type="checkbox" checked={r.PrivateSessionAttended} disabled={ro}
                            onChange={(e) => setRow(r.PrivateSessionId, 'PrivateSessionAttended', e.target.checked)} className="accent-emerald-600" />
                        </td>
                        <td className="px-2 py-1 text-center">
                          <input type="checkbox" checked={r.PrivateSessionOverTime} disabled={ro}
                            onChange={(e) => setRow(r.PrivateSessionId, 'PrivateSessionOverTime', e.target.checked)} className="accent-[#1e5c97]" />
                        </td>
                        <td className="px-2 py-1">
                          <select value={r.PrivateSessionState} disabled={ro} onChange={(e) => changeState(r, e.target.value)} className={cellCls}>
                            {SESSION_STATES.map((st) => <option key={st} value={st}>{st}</option>)}
                            {!SESSION_STATES.includes(r.PrivateSessionState) && <option value={r.PrivateSessionState}>{r.PrivateSessionState}</option>}
                          </select>
                        </td>
                        <td className="px-2 py-1">
                          <input value={r.PrivateSessionRemarks} disabled={ro}
                            onChange={(e) => setRow(r.PrivateSessionId, 'PrivateSessionRemarks', e.target.value)} className={`${cellCls} w-40`} />
                        </td>
                        <td className="px-2 py-1">
                          <DateInput value={r.PrivateSessionMkupDate} disabled={ro}
                            onChange={(e) => setRow(r.PrivateSessionId, 'PrivateSessionMkupDate', e.target.value)} className={`${cellCls} w-28`} />
                        </td>
                        <td className="px-2 py-1">
                          <select value={r.PrivateSessionMkupTime} disabled={ro}
                            onChange={(e) => setRow(r.PrivateSessionId, 'PrivateSessionMkupTime', e.target.value)} className={cellCls}>
                            <option value="">-</option>
                            {TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1">
                          <select value={r.PrivateSessionMkupCoachID} disabled={ro}
                            onChange={(e) => setRow(r.PrivateSessionId, 'PrivateSessionMkupCoachID', Number(e.target.value))} className={cellCls}>
                            <option value={0}>-</option>
                            {allCoaches.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1">
                          <select value={r.PrivateSessionLocationID} disabled={ro}
                            onChange={(e) => setRow(r.PrivateSessionId, 'PrivateSessionLocationID', Number(e.target.value))} className={cellCls}>
                            <option value={0}>-</option>
                            {locations.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Payments (edit mode only) ─────────────────────────────────────── */}
      {!isNew && (
        <div className={`${cardCls} mt-6`}>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Payments · {payments.length}</p>
          {payments.length === 0 ? (
            <p className="text-sm text-slate-400">No payments recorded for this package.</p>
          ) : (
            <table className="tbl w-full text-xs whitespace-nowrap">
              <thead>
                <tr className="text-left text-[11px] text-slate-400 uppercase tracking-wider border-b border-slate-100">
                  <th className="px-2 py-2 font-semibold">ID</th>
                  <th className="px-2 py-2 font-semibold">Date</th>
                  <th className="px-2 py-2 font-semibold">LBP amount</th>
                  <th className="px-2 py-2 font-semibold">Paid</th>
                  <th className="px-2 py-2 font-semibold">Mode</th>
                  <th className="px-2 py-2 font-semibold">Issued to</th>
                  <th className="px-2 py-2 font-semibold">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={n(p.PrivatePaymentId)} className={`border-b border-slate-50 last:border-0 ${p.PrivatePaymentDeleted === true ? 'line-through text-slate-400' : 'text-slate-600'}`}>
                    <td className="px-2 py-1.5">
                      <Link to={`/pr-payments/${n(p.PrivatePaymentId)}`} className="font-semibold text-[#1e5c97] hover:underline">
                        {s(p.IDShow) || `#${n(p.PrivatePaymentId)}`}
                      </Link>
                    </td>
                    <td className="px-2 py-1.5">{fmtDate(p.PrivatePaymentDate)}</td>
                    <td className="px-2 py-1.5">{n(p.PrivatePaymentTotalAmount).toLocaleString()}</td>
                    <td className="px-2 py-1.5">{n(p.PrivatePaymentPaidAmount).toLocaleString()} {s(p.PrivatePaymentPaidCurrency)}</td>
                    <td className="px-2 py-1.5">{s(p.paymentmode)}</td>
                    <td className="px-2 py-1.5">{s(p.IssuedTo)}</td>
                    <td className="px-2 py-1.5 max-w-64 truncate" title={s(p.PrivatePaymentRemarks)}>{s(p.PrivatePaymentRemarks)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 font-bold text-slate-700">
                  <td className="px-2 py-1.5" colSpan={2}>Total</td>
                  <td className="px-2 py-1.5" />
                  <td className="px-2 py-1.5">Paid {Math.round(paymentsTotal).toLocaleString()} {currency}</td>
                  <td className="px-2 py-1.5" colSpan={3}>Net to pay {netToPay.toLocaleString()} {currency} · due {Math.round(netToPay - paymentsTotal).toLocaleString()} {currency}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

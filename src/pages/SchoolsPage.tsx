// Schools (Setup): the school master list (tbl_Schools) behind the student
// form's school picker, with how many students use each name. SiteMaster and
// super users rename and (de)activate; a rename moves every student on the
// old name to the new one (server-side, same transaction). Add New is open to
// anyone with saving rights and uses the picker's rules: capitals rule, junk
// guard and the "Did you mean …?" near-duplicate check.

import { useEffect, useMemo, useState } from 'react';
import {
  Loader2, AlertCircle, Plus, Pencil, Search, Check, X, ArrowUp, ArrowDown, ArrowUpDown,
} from 'lucide-react';
import { apiRequest, getStoredUser, isSuperUser } from '../api/portalApi';
import { PageHero } from '../components/PageHero';
import { toast } from '../components/Toast';
import {
  type School, JUNK_MESSAGE, capitalizeSchoolName, cleanName, findExactSchool, findSimilarSchool,
  isJunkSchoolName, loadSchools, normalizeName,
} from '../lib/schoolNames';

type Status = 'all' | 'active' | 'inactive';
type SortKey = 'name' | 'students';

const inputCls =
  'w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e5c97]/40';

/** The student form pickers keep a per-page-load copy of the list; refresh it. */
const refreshPickers = () => { loadSchools(true).catch(() => {}); };

export function SchoolsPage() {
  const user = getStoredUser();
  const canSave = user?.canSave !== false && (user?.userType || '').toLowerCase() !== 'guest';
  const canEdit = canSave && isSuperUser(user);

  const [rows, setRows] = useState<School[] | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<Status>('all');
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'name', asc: true });
  const [editId, setEditId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  function load() {
    setError('');
    apiRequest<School[]>('/api/portal/schools?all=true&counts=true')
      .then((r) => setRows(Array.isArray(r) ? r : []))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load schools.'));
  }
  useEffect(() => { load(); }, []);

  const visible = useMemo(() => {
    if (!rows) return [];
    const words = normalizeName(search).split(' ').filter(Boolean);
    const list = rows.filter((s) => (status === 'all' || (status === 'active') === s.active)
      && words.every((w) => normalizeName(s.schoolName).includes(w)));
    const dir = sort.asc ? 1 : -1;
    return list.sort((a, b) => (sort.key === 'students'
      ? dir * ((a.students ?? 0) - (b.students ?? 0)) || a.schoolName.localeCompare(b.schoolName)
      : dir * a.schoolName.localeCompare(b.schoolName)));
  }, [rows, search, status, sort]);

  const activeCount = rows?.filter((s) => s.active).length ?? 0;

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, asc: !s.asc } : { key, asc: key === 'name' }));
  }

  function sortIcon(key: SortKey) {
    if (sort.key !== key) return <ArrowUpDown className="size-3 opacity-40" />;
    return sort.asc ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />;
  }

  function onAdded(s: School) {
    setRows((rs) => [...(rs ?? []), { ...s, students: 0 }]);
    setAdding(false);
    setSearch(s.schoolName);
    refreshPickers();
  }

  function onSaved(s: School) {
    setRows((rs) => (rs ?? []).map((r) => (r.schoolId === s.schoolId ? { ...r, ...s } : r)));
    setEditId(null);
    refreshPickers();
  }

  return (
    <div className="p-6 md:p-8 max-w-5xl">
      <PageHero
        title="Schools"
        subtitle="The list behind the student form's school picker"
        right={canSave && !adding ? (
          <button
            onClick={() => { setAdding(true); setEditId(null); }}
            className="btn-grad flex items-center gap-1.5 rounded-lg text-xs font-semibold px-3 py-1.5"
          >
            <Plus className="size-3.5" /> Add New
          </button>
        ) : undefined}
      />

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl p-3 mb-4">
          <AlertCircle className="size-4 text-red-500 shrink-0" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {adding && rows && (
        <AddSchool rows={rows} onAdded={onAdded} onShow={(n) => setSearch(n)} onClose={() => setAdding(false)} />
      )}

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-3 mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-56">
          <Search className="size-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search schools…"
            className="w-full rounded-lg border border-slate-200 pl-8 pr-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e5c97]/40"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as Status)}
          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e5c97]/40"
        >
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        {rows && (
          <span className="text-xs text-slate-500 ml-auto">
            {visible.length.toLocaleString()} shown · {rows.length.toLocaleString()} schools, {activeCount.toLocaleString()} active
          </span>
        )}
      </div>

      {rows === null && !error && (
        <div className="flex justify-center py-20">
          <Loader2 className="size-8 animate-spin text-[#1e5c97]" />
        </div>
      )}

      {rows && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-soft overflow-x-auto">
          <table className="tbl w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 uppercase tracking-wider border-b border-slate-100">
                {/* Actions first (user, 2026-10-24). */}
                {canEdit && <th className="px-3 py-3 font-semibold w-20">Edit</th>}
                <th className="px-3 py-3 font-semibold">
                  <button type="button" onClick={() => toggleSort('name')} className="flex items-center gap-1 hover:text-slate-600">
                    School {sortIcon('name')}
                  </button>
                </th>
                <th className="px-3 py-3 font-semibold w-28 text-right">
                  <button type="button" onClick={() => toggleSort('students')} className="inline-flex items-center gap-1 hover:text-slate-600">
                    Students {sortIcon('students')}
                  </button>
                </th>
                <th className="px-3 py-3 font-semibold w-28">Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((s) => (editId === s.schoolId ? (
                <EditRow key={s.schoolId} school={s} rows={rows} onSaved={onSaved} onCancel={() => setEditId(null)} />
              ) : (
                <tr key={s.schoolId} className={`border-b border-slate-50 last:border-0 ${s.active ? '' : 'text-slate-400'}`}>
                  {canEdit && (
                    <td className="px-3 py-2.5">
                      <button
                        onClick={() => { setEditId(s.schoolId); setAdding(false); }}
                        title="Edit"
                        className="text-[#1e5c97] hover:text-[#17497a]"
                      >
                        <Pencil className="size-4" />
                      </button>
                    </td>
                  )}
                  <td className={`px-3 py-2.5 ${s.active ? 'text-slate-700' : ''}`}>{s.schoolName}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{(s.students ?? 0).toLocaleString()}</td>
                  <td className="px-3 py-2.5"><StatusPill active={s.active} /></td>
                </tr>
              )))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={canEdit ? 4 : 3} className="px-4 py-10 text-center text-slate-400">
                    {rows.length ? 'No school matches.' : 'The school list is not set up yet.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span className={`text-[10px] font-bold uppercase rounded-full px-2 py-0.5 ${active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

// ── Add New (same rules as the picker's "Add new school") ────────────────────

function AddSchool({ rows, onAdded, onShow, onClose }: {
  rows: School[];
  onAdded: (s: School) => void;
  onShow: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [similar, setSimilar] = useState<School | null>(null);
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const final = capitalizeSchoolName(name);

  async function save(anyway = false) {
    setMsg('');
    if (!final) { setMsg('Type the school name.'); return; }
    const ex = findExactSchool(final, rows);
    if (ex) {
      setMsg(`"${ex.schoolName}" is already on the list${ex.active ? '' : ' (inactive)'}.`);
      onShow(ex.schoolName);
      return;
    }
    if (isJunkSchoolName(final)) { setMsg(JUNK_MESSAGE); return; }
    if (!anyway) {
      const sim = findSimilarSchool(final, rows);
      if (sim) { setSimilar(sim); return; }
    }
    setSaving(true);
    try {
      const s = await apiRequest<School>('/api/portal/schools', { method: 'POST', body: JSON.stringify({ name: final }) });
      toast.success(`School "${s.schoolName}" added.`);
      onAdded(s);
    } catch (e) {
      setSimilar(null);
      setMsg(e instanceof Error ? e.message : 'Could not add the school.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 mb-4">
      <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">New school</p>
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex-1 min-w-64">
          <input
            autoFocus
            value={name}
            onChange={(e) => { setName(e.target.value); setSimilar(null); setMsg(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !similar) void save(); if (e.key === 'Escape') onClose(); }}
            placeholder="School name"
            className={inputCls}
          />
          {final && final !== cleanName(name) && (
            <p className="mt-1 text-[11px] text-slate-500">Will be saved as <b className="text-slate-700">{final}</b></p>
          )}
        </div>
        {!similar && (
          <button
            onClick={() => void save()}
            disabled={saving}
            className="btn-grad flex items-center gap-1.5 rounded-lg text-xs font-semibold px-3 py-2 disabled:opacity-60"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Add
          </button>
        )}
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 text-slate-600 text-xs font-semibold px-3 py-2 hover:bg-slate-50"
        >
          <X className="size-3.5" /> Cancel
        </button>
      </div>
      {similar && (
        <div className="mt-3 rounded-xl bg-amber-50 border border-amber-100 p-3 text-sm">
          <p className="text-amber-800">Did you mean <b>{similar.schoolName}</b>{similar.active ? '' : ' (inactive)'}?</p>
          <div className="flex flex-wrap gap-2 mt-2">
            <button
              onClick={() => { onShow(similar.schoolName); onClose(); }}
              className="rounded-lg bg-[#1e5c97] text-white text-xs font-semibold px-3 py-1.5 hover:bg-[#174a7c]"
            >
              Show {similar.schoolName}
            </button>
            <button
              onClick={() => void save(true)}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-semibold px-3 py-1.5 hover:bg-slate-50 disabled:opacity-60"
            >
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              Add &quot;{final}&quot; as new anyway
            </button>
          </div>
        </div>
      )}
      {msg && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-red-600">
          <AlertCircle className="size-3.5 shrink-0" /> {msg}
        </p>
      )}
    </div>
  );
}

// ── Inline edit row (SiteMaster + super users) ───────────────────────────────

function EditRow({ school, rows, onSaved, onCancel }: {
  school: School;
  rows: School[];
  onSaved: (s: School) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(school.schoolName);
  const [active, setActive] = useState(school.active);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  // Only a changed name goes through the capitals rule (an untouched "AGBU" stays).
  const nameChanged = cleanName(name) !== school.schoolName;
  const final = nameChanged ? capitalizeSchoolName(name) : school.schoolName;
  const renamed = final !== school.schoolName;

  async function save() {
    setMsg('');
    if (renamed) {
      if (!final) { setMsg('Type the school name.'); return; }
      if (isJunkSchoolName(final)) { setMsg(JUNK_MESSAGE); return; }
      const other = findExactSchool(final, rows.filter((r) => r.schoolId !== school.schoolId));
      if (other) { setMsg(`Another school is already called "${other.schoolName}".`); return; }
      const n = school.students ?? 0;
      if (n > 0 && !window.confirm(
        `Rename "${school.schoolName}" to "${final}"?\n${n.toLocaleString()} student(s) on "${school.schoolName}" will move to the new name.`)) return;
    }
    if (!renamed && active === school.active) { onCancel(); return; }
    setSaving(true);
    try {
      const body: Record<string, unknown> = { active };
      if (renamed) body.name = final;
      const r = await apiRequest<School & { studentsUpdated?: number }>(
        `/api/portal/schools/${school.schoolId}`, { method: 'PUT', body: JSON.stringify(body) });
      const moved = r.studentsUpdated ? ` ${r.studentsUpdated.toLocaleString()} student(s) moved.` : '';
      toast.success(`School saved.${moved}`);
      onSaved({ ...school, schoolName: r.schoolName, active: r.active });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not save the school.');
      setSaving(false);
    }
  }

  return (
    <tr className="border-b border-slate-50 bg-[#1e5c97]/5">
      <td className="px-3 py-2.5 align-top whitespace-nowrap">
        <button onClick={() => void save()} disabled={saving} title="Save" className="text-emerald-600 hover:text-emerald-700 disabled:opacity-50 mr-3">
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
        </button>
        <button onClick={onCancel} disabled={saving} title="Cancel" className="text-slate-400 hover:text-slate-600">
          <X className="size-4" />
        </button>
      </td>
      <td className="px-3 py-2 align-top">
        <input
          autoFocus
          value={name}
          onChange={(e) => { setName(e.target.value); setMsg(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') onCancel(); }}
          className={inputCls}
        />
        {renamed && final !== cleanName(name) && (
          <p className="mt-1 text-[11px] text-slate-500">Will be saved as <b className="text-slate-700">{final}</b></p>
        )}
        {msg && (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-red-600">
            <AlertCircle className="size-3.5 shrink-0" /> {msg}
          </p>
        )}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums align-top">{(school.students ?? 0).toLocaleString()}</td>
      <td className="px-3 py-2.5 align-top">
        <label className="flex items-center gap-2 text-sm text-slate-700 select-none">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="accent-[#1e5c97]" />
          Active
        </label>
      </td>
    </tr>
  );
}

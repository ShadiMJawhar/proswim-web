import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Loader2, AlertCircle, Save, Search } from 'lucide-react';
import { apiRequest, getStoredUser } from '../api/portalApi';
import { canGoBack } from '../lib/history';
import { DateInput } from './DateInput';
import { PageHero } from './PageHero';
import { SmartBack } from './SmartBack';
import { toast } from './Toast';

type Row = Record<string, unknown>;
type Option = { value: string | number; label: string };
type Picker = { id: number; label: string };

export type FieldType = 'text' | 'number' | 'date' | 'checkbox' | 'textarea' | 'select' | 'student';

export interface FormField {
  key: string;                 // proc parameter / column name
  label: string;
  type: FieldType;
  options?: Option[];          // static select options
  optionsKey?: string;         // key into a lookups map
  labelKey?: string;           // for 'student': record column holding the display name
  colSpan2?: boolean;
  hint?: string;               // short grey note shown beside the label, e.g. "ex: $500 (3 days)"
  /** For 'text': key into the config.datalists map; renders browser suggestions (legacy jQuery autocomplete). */
  datalist?: string;
  /** Shown but not editable on an existing record (legacy ddlCurrency.Enabled=false on edit). */
  readOnlyOnEdit?: boolean;
  /** User types (case-insensitive) for which the field is locked, e.g. ['user']. */
  lockedFor?: string[];
  /** On create, default the field from this URL query param (e.g. 'locationId'). */
  urlParam?: string;
  /** On create, default to the signed-in user's primary location (a URL param wins). */
  defaultToUserLocation?: boolean;
}

// Type-ahead student picker (reuses /api/portal/edit/student-search). Sets the
// field to the chosen student's id; shows the name once picked/loaded.
function StudentField({ label, value, initialLabel, onPick }: {
  label: string; value: unknown; initialLabel: string;
  onPick: (id: number) => void;
}) {
  const [q, setQ] = useState(initialLabel);
  const [results, setResults] = useState<Picker[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => { setQ(initialLabel); }, [initialLabel]);

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(() => {
      apiRequest<Picker[]>(`/api/portal/edit/student-search?q=${encodeURIComponent(q.trim())}`)
        .then((r) => { setResults(r); setOpen(true); })
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const inputCls =
    'w-full rounded-lg border border-slate-200 pl-8 pr-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e5c97]/40';

  return (
    <div className="md:col-span-2 relative">
      <label className="block text-xs font-semibold text-slate-500 mb-1">
        {label} {value ? <span className="text-slate-400">· #{String(value)}</span> : null}
      </label>
      <div className="relative">
        <Search className="size-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          placeholder="Search a student by name…"
          className={inputCls}
        />
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg">
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => { onPick(r.id); setQ(r.label); setOpen(false); }}
              className="block w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export interface FormSection {
  title: string;
  fields: FormField[];
}

export interface RecordFormConfig {
  title: string;               // e.g. "Semester"
  listPath: string;            // e.g. "/semesters"
  slug: string;                // e.g. "semester" → /api/portal/edit/semester
  idKey: string;               // column that holds the record id
  titleKey: string;            // column to show as the record's name
  sections: FormSection[];
  lookups?: string;            // endpoint returning Record<string, Option[]>
  /** Defaults applied when creating a new record (a function is evaluated per
   *  mount, e.g. to read the signed-in user's location). */
  createDefaults?: Record<string, unknown> | (() => Record<string, unknown>);
  /** Endpoint returning server-side defaults to merge over createDefaults on create
   *  (e.g. carry the last timesheet's USD→LBP rate into a new one). */
  createPrefill?: string;
  /** Endpoint returning Record<string, string[]> used by fields with `datalist`. */
  datalists?: string;
  /** "Duplicate" support: when the create URL carries ?{param}=<id>, load that
   *  record from `load(id)` and prefill every form field except `omit`. */
  duplicate?: { param: string; load: (id: string) => string; omit: string[] };
  /** After a successful create, go here instead of back to the list. Receives the
   *  POST response (e.g. { id }) and the submitted form. */
  onCreated?: (res: Record<string, unknown>, form: Record<string, unknown>) => string;
  /** Extra submit buttons on create (legacy "Save and Register"): save, then go to `path`. */
  extraActions?: { label: string; path: (res: Record<string, unknown>, form: Record<string, unknown>) => string }[];
  heroSlide?: number;
  /** Client-side check before saving; return an error message to block the save. */
  validate?: (form: Record<string, unknown>) => string | null;
}

function resolveDefaults(config: RecordFormConfig): Record<string, unknown> {
  const d = config.createDefaults;
  return typeof d === 'function' ? d() : d ?? {};
}

function toDateInput(v: unknown): string {
  if (!v || typeof v !== 'string') return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function RecordFormPage({ config }: { config: RecordFormConfig }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = getStoredUser();
  const canSave = user?.canSave !== false;
  const isNew = !id || id === 'new';
  const userType = (user?.userType || '').toLowerCase();

  const [searchParams] = useSearchParams();
  const duplicateOf = isNew && config.duplicate ? searchParams.get(config.duplicate.param) : null;

  const [form, setForm] = useState<Record<string, unknown>>({});
  const [record, setRecord] = useState<Row | null>(null);
  const [lookups, setLookups] = useState<Record<string, Option[]>>({});
  const [datalists, setDatalists] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(!isNew || !!duplicateOf);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function hydrate(r: Row, omit: string[] = [], base: Record<string, unknown> = {}) {
    const f: Record<string, unknown> = {};
    const skip = new Set(omit);
    for (const sec of config.sections)
      for (const fd of sec.fields) {
        if (skip.has(fd.key)) { f[fd.key] = base[fd.key] ?? (fd.type === 'checkbox' ? false : ''); continue; }
        f[fd.key] = fd.type === 'date' ? toDateInput(r[fd.key]) : r[fd.key] ?? (fd.type === 'checkbox' ? false : '');
      }
    setForm(f);
  }

  useEffect(() => {
    if (config.lookups)
      apiRequest<Record<string, Option[]>>(config.lookups).then(setLookups).catch(() => {});
    if (config.datalists)
      apiRequest<Record<string, string[]>>(config.datalists).then(setDatalists).catch(() => {});
  }, [config.lookups, config.datalists]);

  useEffect(() => {
    if (isNew) {
      const defaults = resolveDefaults(config);
      const f: Record<string, unknown> = {};
      for (const sec of config.sections)
        for (const fd of sec.fields) {
          let v = defaults[fd.key] ?? (fd.type === 'checkbox' ? false : '');
          // Field-level create defaults: the user's own location, then a URL
          // query param (e.g. ?locationId= from the list page) which wins.
          if (fd.defaultToUserLocation && user?.primaryLocationId) v = user.primaryLocationId;
          if (fd.urlParam && searchParams.has(fd.urlParam)) {
            const raw = searchParams.get(fd.urlParam) ?? '';
            v = /^\d+$/.test(raw) ? Number(raw) : raw;
          }
          f[fd.key] = v;
        }
      setForm(f);
      // "Duplicate": prefill from an existing record, keeping the defaults for
      // the omitted keys (legacy StudentIDDuplicate behaviour).
      if (duplicateOf && config.duplicate) {
        apiRequest<Row>(config.duplicate.load(duplicateOf))
          .then((r) => hydrate(r, config.duplicate!.omit, f))
          .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the record to duplicate.'))
          .finally(() => setLoading(false));
      }
      // Merge server-side defaults (e.g. last timesheet's rate) over the blanks.
      if (config.createPrefill)
        apiRequest<Record<string, unknown>>(config.createPrefill)
          .then((pre) => setForm((cur) => ({ ...cur, ...pre })))
          .catch(() => {});
      return;
    }
    apiRequest<Row>(`/api/portal/edit/${config.slug}/${id}`)
      .then((r) => { setRecord(r); hydrate(r); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load record.'))
      .finally(() => setLoading(false));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  function set(key: string, value: unknown) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save(action?: { path: (res: Record<string, unknown>, form: Record<string, unknown>) => string }) {
    setError('');
    const problem = config.validate?.(form);
    if (problem) { setError(problem); toast.error(problem); return; }
    setSaving(true);
    try {
      // Merge in createDefaults for keys not on the form (proc needs every param).
      const payload = isNew ? { ...resolveDefaults(config), ...form } : form;
      let res: Record<string, unknown> = {};
      if (isNew) {
        res = (await apiRequest<Record<string, unknown> | undefined>(
          `/api/portal/edit/${config.slug}`, { method: 'POST', body: JSON.stringify(payload) })) ?? {};
      } else {
        await apiRequest(`/api/portal/edit/${config.slug}/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      }
      toast.success(`${config.title} ${isNew ? 'created' : 'saved'}.`);
      // Server-side follow-up note (e.g. the welcome-email result on a new student).
      if (typeof res.message === 'string' && res.message) toast.info(res.message);
      if (isNew && action) { navigate(action.path(res, payload)); return; }
      if (isNew && config.onCreated) { navigate(config.onCreated(res, payload)); return; }
      // Back to the list as the user left it (filters live in its URL), not a
      // fresh default-filtered copy; bare list only when opened directly.
      if (canGoBack()) navigate(-1); else navigate(config.listPath);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed.';
      setError(msg);
      toast.error(msg);
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="size-8 text-[#1e5c97] animate-spin" />
      </div>
    );
  }

  const inputCls =
    'w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e5c97]/40 disabled:bg-slate-50 disabled:text-slate-500';
  const recordName = record ? String(record[config.titleKey] ?? '') : '';

  function renderField(fd: FormField) {
    const v = form[fd.key];
    const locked = (!isNew && !!fd.readOnlyOnEdit)
      || !!fd.lockedFor?.some((t) => t.toLowerCase() === userType);
    switch (fd.type) {
      case 'checkbox':
        return (
          <label key={fd.key} className="flex items-center gap-2 text-sm text-slate-700 select-none py-1.5">
            <input type="checkbox" checked={v === true} onChange={(e) => set(fd.key, e.target.checked)} disabled={locked} className="accent-[#1e5c97]" />
            {fd.label}
          </label>
        );
      case 'textarea':
        return (
          <div key={fd.key} className="md:col-span-2">
            <label className="block text-xs font-semibold text-slate-500 mb-1">{fd.label}{fd.hint && <span className="ml-1 font-normal text-slate-400">{fd.hint}</span>}</label>
            <textarea value={String(v ?? '')} onChange={(e) => set(fd.key, e.target.value)} rows={2} disabled={locked} className={inputCls} />
          </div>
        );
      case 'select': {
        const opts = fd.options ?? lookups[fd.optionsKey || ''] ?? [];
        const numeric = typeof opts[0]?.value === 'number';
        return (
          <div key={fd.key} className={fd.colSpan2 ? 'md:col-span-2' : ''}>
            <label className="block text-xs font-semibold text-slate-500 mb-1">{fd.label}{fd.hint && <span className="ml-1 font-normal text-slate-400">{fd.hint}</span>}</label>
            <select
              value={String(v ?? (numeric ? 0 : ''))}
              onChange={(e) => set(fd.key, numeric ? Number(e.target.value) : e.target.value)}
              disabled={locked}
              className={inputCls}
            >
              <option value={numeric ? 0 : ''}>-</option>
              {opts.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
            </select>
          </div>
        );
      }
      case 'student':
        return (
          <StudentField
            key={fd.key}
            label={fd.label}
            value={v}
            initialLabel={record ? String(record[fd.labelKey || ''] ?? '') : ''}
            onPick={(sid) => set(fd.key, sid)}
          />
        );
      case 'number':
        return (
          <div key={fd.key} className={fd.colSpan2 ? 'md:col-span-2' : ''}>
            <label className="block text-xs font-semibold text-slate-500 mb-1">{fd.label}{fd.hint && <span className="ml-1 font-normal text-slate-400">{fd.hint}</span>}</label>
            <input type="number" value={String(v ?? '')} onChange={(e) => set(fd.key, e.target.value === '' ? '' : Number(e.target.value))} disabled={locked} className={inputCls} />
          </div>
        );
      case 'date':
        return (
          <div key={fd.key}>
            <label className="block text-xs font-semibold text-slate-500 mb-1">{fd.label}{fd.hint && <span className="ml-1 font-normal text-slate-400">{fd.hint}</span>}</label>
            <DateInput value={String(v ?? '')} onChange={(e) => set(fd.key, e.target.value)} disabled={locked} className={inputCls} />
          </div>
        );
      default: {
        const suggestions = fd.datalist ? datalists[fd.datalist] : undefined;
        const listId = suggestions?.length ? `dl-${config.slug}-${fd.key}` : undefined;
        return (
          <div key={fd.key} className={fd.colSpan2 ? 'md:col-span-2' : ''}>
            <label className="block text-xs font-semibold text-slate-500 mb-1">{fd.label}{fd.hint && <span className="ml-1 font-normal text-slate-400">{fd.hint}</span>}</label>
            <input value={String(v ?? '')} onChange={(e) => set(fd.key, e.target.value)} disabled={locked} className={inputCls} list={listId} />
            {listId && (
              <datalist id={listId}>
                {suggestions!.map((s) => <option key={s} value={s} />)}
              </datalist>
            )}
          </div>
        );
      }
    }
  }

  return (
    <div className="p-6 md:p-8 max-w-4xl">
      <PageHero
        compact
        title={isNew ? `New ${config.title}` : recordName || config.title}
        subtitle={isNew ? `Add a ${config.title.toLowerCase()}` : `Edit ${config.title.toLowerCase()}`}
        slide={config.heroSlide ?? 0}
      />

      <SmartBack label="Back" fallback={config.listPath} />

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

      <div className="space-y-4">
        {config.sections.map((sec) => (
          <div key={sec.title} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-4">{sec.title}</p>
            <div className={sec.fields.every((f) => f.type === 'checkbox')
              ? 'grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1'
              : 'grid grid-cols-1 md:grid-cols-2 gap-4'}>
              {sec.fields.map(renderField)}
            </div>
          </div>
        ))}
      </div>

      {canSave && (
        <div className="mt-6 flex justify-end gap-2">
          {isNew && config.extraActions?.map((a) => (
            <button
              key={a.label}
              onClick={() => save(a)}
              disabled={saving}
              className="flex items-center gap-2 rounded-xl border border-[#1e5c97]/30 bg-white text-sm font-semibold text-[#1e5c97] px-5 py-2.5 hover:bg-slate-50 disabled:opacity-60"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {a.label}
            </button>
          ))}
          <button
            onClick={() => save()}
            disabled={saving}
            className="btn-grad flex items-center gap-2 rounded-xl text-sm font-semibold px-6 py-2.5"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {isNew ? `Create ${config.title}` : 'Save changes'}
          </button>
        </div>
      )}
    </div>
  );
}

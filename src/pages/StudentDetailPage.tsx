import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useRef } from 'react';
import {
  Loader2, AlertCircle, Save, Pencil, X, HeartPulse, PhoneCall, Trophy, Camera, Users, UserPlus, ListChecks,
  Copy, ExternalLink, Plus, Layers, MessageSquare,
} from 'lucide-react';
import { toast } from '../components/Toast';
import { apiRequest, apiUpload, getStoredUser } from '../api/portalApi';
import { DateInput } from '../components/DateInput';
import { fmtDate as toDMY } from '../lib/dates';
import { AiStudentOverview } from '../components/AiStudentOverview';
import { SmartBack } from '../components/SmartBack';

// Full proc row, keyed by original column names (PascalCase from SQL).
type StudentRow = Record<string, unknown>;

interface Lookups {
  bloodTypes: { bloodTypeId: number; bloodTypeName: string | null }[];
  locations: { locationId: number; locationNickName: string | null }[];
  coaches: { coachId: number; coachFullName: string | null; locationNickName: string | null }[];
  levels?: { levelId: number; levelName: string | null }[];
}

// Text fields that had a jQuery autocomplete on StudentsIndividual.aspx →
// key in /api/portal/students/autocomplete.
const DATALIST_FOR: Record<string, string> = {
  StudentFirstName: 'firstNames',
  StudentMiddleName: 'firstNames',
  StudentLastName: 'lastNames',
  StudentSchool: 'schools',
  StudentAddressCity: 'cities',
  StudentAddressRegion: 'regions',
  StudentAddressStreet: 'streets',
  StudentNationality1: 'nationalities',
  StudentNationality2: 'nationalities',
  StudentMomOccupation: 'occupations',
  StudentDadOccupation: 'occupations',
  StudentStartingCoach: 'startingCoaches',
  StudentStartingLocation: 'startingLocations',
};

type FieldType = 'text' | 'date' | 'checkbox' | 'textarea' | 'gender' | 'bloodType' | 'location' | 'coach';

interface FieldDef {
  key: string;      // original column / proc param name
  label: string;
  type: FieldType;
}

// Mirrors the StudentsIndividual.aspx form groups. Every key is a
// P_Student_Update parameter.
const SECTIONS: Array<{ title: string; fields: FieldDef[] }> = [
  {
    title: 'Personal',
    fields: [
      { key: 'StudentFirstName', label: 'First name', type: 'text' },
      { key: 'StudentMiddleName', label: 'Middle name', type: 'text' },
      { key: 'StudentLastName', label: 'Last name', type: 'text' },
      { key: 'StudentGender', label: 'Gender', type: 'gender' },
      { key: 'StudentDateOfBirth', label: 'Date of birth', type: 'date' },
      { key: 'StudentBloodTypeId', label: 'Blood type', type: 'bloodType' },
      { key: 'StudentSchool', label: 'School', type: 'text' },
      { key: 'StudentNationality1', label: 'Nationality 1', type: 'text' },
      { key: 'StudentNationality2', label: 'Nationality 2', type: 'text' },
      { key: 'StudentMomOccupation', label: 'Mom occupation', type: 'text' },
      { key: 'StudentDadOccupation', label: 'Dad occupation', type: 'text' },
    ],
  },
  {
    title: 'Contact',
    fields: [
      { key: 'StudentPhoneNumberCode1', label: 'Phone code 1', type: 'text' },
      { key: 'StudentPhoneNumber1', label: 'Phone 1', type: 'text' },
      { key: 'StudentPhoneNumberCode2', label: 'Phone code 2', type: 'text' },
      { key: 'StudentPhoneNumber2', label: 'Phone 2', type: 'text' },
      { key: 'StudentEmail', label: 'Email', type: 'text' },
      { key: 'StudentEmail2', label: 'Email 2', type: 'text' },
      { key: 'StudentFacebookAccount', label: 'Facebook', type: 'text' },
      { key: 'StudentParentFacebook', label: 'Parent Facebook', type: 'text' },
    ],
  },
  {
    // Parent-editable via the app's Personal Information screen; staff edit
    // here. Allergies/medical notes also surface in the red banner up top.
    title: 'Emergency & Medical',
    fields: [
      { key: 'StudentEmergencyContactName', label: 'Emergency contact', type: 'text' },
      { key: 'StudentEmergencyContactRelation', label: 'Relation', type: 'text' },
      { key: 'StudentEmergencyContactPhoneCode', label: 'Emergency phone code', type: 'text' },
      { key: 'StudentEmergencyContactPhone', label: 'Emergency phone', type: 'text' },
      { key: 'StudentAllergies', label: 'Allergies', type: 'textarea' },
      { key: 'StudentMedicalNotes', label: 'Medical notes', type: 'textarea' },
    ],
  },
  {
    title: 'Address',
    fields: [
      { key: 'StudentAddressCity', label: 'City', type: 'text' },
      { key: 'StudentAddressRegion', label: 'Region', type: 'text' },
      { key: 'StudentAddressStreet', label: 'Street', type: 'text' },
      { key: 'StudentAddressBuilding', label: 'Building', type: 'text' },
      { key: 'StudentAddressFloor', label: 'Floor', type: 'text' },
    ],
  },
  {
    title: 'Swimming',
    fields: [
      { key: 'StudentStartingDate', label: 'Starting date', type: 'date' },
      { key: 'StudentPrimaryLocationId', label: 'Primary location', type: 'location' },
      { key: 'StudentPrimaryLocationId2', label: 'Location 2', type: 'location' },
      { key: 'StudentPrimaryLocationId3', label: 'Location 3', type: 'location' },
      { key: 'StudentPrimaryCoachId', label: 'Primary coach', type: 'coach' },
      { key: 'StudentStartingCoach', label: 'Starting coach', type: 'text' },
      { key: 'StudentStartingLocation', label: 'Starting location', type: 'text' },
    ],
  },
  {
    // Formerly "Swimmer Types", one swimmer can be enrolled in several
    // programs, so the flags read as program enrollment, and the cards above
    // the form show each active program's schedule/package/attendance.
    title: 'Programs Enrolled In',
    fields: [
      { key: 'StudentGroupSwimmer', label: 'Group Training', type: 'checkbox' },
      { key: 'StudentPrivateSwimmer', label: 'Private Training', type: 'checkbox' },
      { key: 'StudentEliteSwimmer', label: 'Competitive Team', type: 'checkbox' },
      { key: 'StudentAquaBabySwimmer', label: 'AquaBaby', type: 'checkbox' },
      { key: 'StudentAquaGymSwimmer', label: 'AquaGym', type: 'checkbox' },
      { key: 'StudentSchoolSwimmer', label: 'School', type: 'checkbox' },
      { key: 'StudentGiftedSwimmer', label: 'Gifted', type: 'checkbox' },
      { key: 'StudentOthersSwimmer', label: 'Other', type: 'checkbox' },
      { key: 'StudentWaitingList', label: 'Waiting list', type: 'checkbox' },
      { key: 'StudentActive', label: 'Active', type: 'checkbox' },
    ],
  },
  {
    title: 'Website & Messaging',
    fields: [
      { key: 'StudentShowOnline', label: 'Show online', type: 'checkbox' },
      { key: 'StudentShowWallofFame', label: 'Wall of Fame', type: 'checkbox' },
      { key: 'StudentShowChampion', label: 'Champion', type: 'checkbox' },
      { key: 'StudentShowSpecial', label: 'Special', type: 'checkbox' },
      { key: 'StudentSpecialText', label: 'Special text', type: 'text' },
      { key: 'StudentNoBulkWA', label: 'No bulk WhatsApp', type: 'checkbox' },
      { key: 'StudentNoBulkEmail', label: 'No bulk email', type: 'checkbox' },
    ],
  },
  {
    title: 'Health & Notes',
    fields: [
      { key: 'StudentDifficulty', label: 'Difficulty', type: 'checkbox' },
      { key: 'StudentDifficultyRemarks', label: 'Difficulty remarks', type: 'textarea' },
      { key: 'StudentVaccinated', label: 'Vaccinated', type: 'checkbox' },
      { key: 'StudentVaccinatedRemarks', label: 'Vaccination remarks', type: 'textarea' },
      { key: 'StudentNotes', label: 'Notes', type: 'textarea' },
    ],
  },
];

function toDateInput(v: unknown): string {
  if (!v || typeof v !== 'string') return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function StudentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const user = getStoredUser();
  const canSave = user?.canSave !== false;
  const editing = searchParams.get('edit') === '1' && canSave;

  const navigate = useNavigate();
  const [row, setRow] = useState<StudentRow | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // Legacy ChkSendWelcomeEmail: unchecked when editing an existing student.
  const [sendWelcome, setSendWelcome] = useState(false);
  // Legacy jQuery autocompletes (distinct first/last names, schools, …), loaded
  // once edit mode is entered.
  const [datalists, setDatalists] = useState<Record<string, string[]>>({});
  useEffect(() => {
    if (!editing || Object.keys(datalists).length) return;
    apiRequest<Record<string, string[]>>('/api/portal/students/autocomplete').then(setDatalists).catch(() => {});
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  function initForm(r: StudentRow) {
    const f: Record<string, unknown> = {};
    for (const sec of SECTIONS)
      for (const fd of sec.fields)
        f[fd.key] = fd.type === 'date' ? toDateInput(r[fd.key]) : r[fd.key] ?? (fd.type === 'checkbox' ? false : '');
    setForm(f);
  }

  useEffect(() => {
    Promise.all([
      apiRequest<StudentRow>(`/api/portal/students/${id}`),
      apiRequest<Lookups>('/api/portal/students/lookups'),
    ])
      .then(([r, lk]) => { setRow(r); initForm(r); setLookups(lk); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load student.'))
      .finally(() => setLoading(false));
  }, [id]);

  function set(key: string, value: unknown) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function startEdit() {
    setSearchParams({ edit: '1' });
  }

  function cancelEdit() {
    if (row) initForm(row); // discard unsaved changes
    setNotice('');
    setSearchParams({});
  }

  async function save() {
    setError('');
    setNotice('');
    // Legacy RequiredFieldValidators (ValidationGroup "Student").
    const blank = (k: string) => String(form[k] ?? '').trim() === '';
    const problem =
      blank('StudentFirstName') ? 'First name is required.'
      : blank('StudentLastName') ? 'Last name is required.'
      : blank('StudentPhoneNumber1') ? 'Phone 1 is required.'
      : blank('StudentDateOfBirth') ? 'Date of birth is required.'
      : blank('StudentStartingDate') ? 'Starting date is required.'
      : '';
    if (problem) { setError(problem); toast.error(problem); return; }
    setSaving(true);
    try {
      const updated = await apiRequest<StudentRow>(`/api/portal/students/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...form, SendWelcomeEmail: sendWelcome }),
      });
      const welcome = updated.WelcomeEmailResult ? String(updated.WelcomeEmailResult) : '';
      delete updated.WelcomeEmailResult;
      setRow(updated);
      initForm(updated);
      setSendWelcome(false);
      setSearchParams({});
      setNotice('Saved. Changes are audit-logged per field, same as the legacy tool.' + (welcome ? ` ${welcome}` : ''));
      toast.success('Student saved.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed.';
      setError(msg);
      toast.error(msg);
    } finally {
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

  if (!row) {
    return (
      <div className="p-8">
        <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl p-4">
          <AlertCircle className="size-4 text-red-500 shrink-0" />
          <p className="text-sm text-red-600">{error || 'Student not found.'}</p>
        </div>
      </div>
    );
  }

  const inputCls =
    'w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e5c97]/40';

  function renderField(fd: FieldDef) {
    const v = form[fd.key];
    switch (fd.type) {
      case 'checkbox':
        return (
          <label key={fd.key} className="flex items-center gap-2 text-sm text-slate-700 select-none py-1">
            <input
              type="checkbox"
              checked={v === true}
              onChange={(e) => set(fd.key, e.target.checked)}
              className="accent-[#1e5c97]"
            />
            {fd.label}
          </label>
        );
      case 'textarea':
        return (
          <div key={fd.key} className="col-span-2">
            <label className="block text-xs font-semibold text-slate-500 mb-1">{fd.label}</label>
            <textarea value={String(v ?? '')} onChange={(e) => set(fd.key, e.target.value)} rows={2} className={inputCls} />
          </div>
        );
      case 'date':
        return (
          <div key={fd.key}>
            <label className="block text-xs font-semibold text-slate-500 mb-1">{fd.label}</label>
            <DateInput value={String(v ?? '')} onChange={(e) => set(fd.key, e.target.value)} className={inputCls} />
          </div>
        );
      case 'gender':
        return (
          <div key={fd.key}>
            <label className="block text-xs font-semibold text-slate-500 mb-1">{fd.label}</label>
            <select value={String(v ?? '')} onChange={(e) => set(fd.key, e.target.value)} className={inputCls}>
              <option value="">-</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
          </div>
        );
      case 'bloodType':
        return (
          <div key={fd.key}>
            <label className="block text-xs font-semibold text-slate-500 mb-1">{fd.label}</label>
            <select value={Number(v ?? 0)} onChange={(e) => set(fd.key, Number(e.target.value))} className={inputCls}>
              <option value={0}>-</option>
              {lookups?.bloodTypes.map((b) => (
                <option key={b.bloodTypeId} value={b.bloodTypeId}>{b.bloodTypeName}</option>
              ))}
            </select>
          </div>
        );
      case 'location':
        return (
          <div key={fd.key}>
            <label className="block text-xs font-semibold text-slate-500 mb-1">{fd.label}</label>
            <select value={Number(v ?? 0)} onChange={(e) => set(fd.key, Number(e.target.value))} className={inputCls}>
              <option value={0}>-</option>
              {lookups?.locations.map((l) => (
                <option key={l.locationId} value={l.locationId}>{l.locationNickName}</option>
              ))}
            </select>
          </div>
        );
      case 'coach':
        return (
          <div key={fd.key}>
            <label className="block text-xs font-semibold text-slate-500 mb-1">{fd.label}</label>
            <select value={Number(v ?? 0)} onChange={(e) => set(fd.key, Number(e.target.value))} className={inputCls}>
              <option value={0}>-</option>
              {lookups?.coaches.map((c) => (
                <option key={c.coachId} value={c.coachId}>
                  {c.coachFullName}{c.locationNickName ? ` (${c.locationNickName})` : ''}
                </option>
              ))}
            </select>
          </div>
        );
      default: {
        const dl = DATALIST_FOR[fd.key];
        const suggestions = dl ? datalists[dl] : undefined;
        const listId = suggestions?.length ? `dl-student-${fd.key}` : undefined;
        return (
          <div key={fd.key}>
            <label className="block text-xs font-semibold text-slate-500 mb-1">{fd.label}</label>
            <input value={String(v ?? '')} onChange={(e) => set(fd.key, e.target.value)} className={inputCls} list={listId} />
            {listId && (
              <datalist id={listId}>
                {suggestions!.map((s, i) => <option key={`${i}-${s}`} value={s} />)}
              </datalist>
            )}
          </div>
        );
      }
    }
  }

  // Read-only rendering of the same field definitions (view mode).
  function renderViewField(fd: FieldDef) {
    const v = row![fd.key];
    if (fd.type === 'checkbox') {
      return (
        <div key={fd.key} className="flex items-center gap-2 text-sm py-1">
          <span className={`inline-block w-2 h-2 rounded-full ${v === true ? 'bg-emerald-500' : 'bg-slate-200'}`} />
          <span className={v === true ? 'text-slate-800' : 'text-slate-400'}>{fd.label}</span>
        </div>
      );
    }
    let text: string;
    if (v == null || v === '') text = '-';
    else if (fd.type === 'date') {
      text = toDMY(v);
    } else if (fd.type === 'bloodType') {
      text = lookups?.bloodTypes.find((b) => b.bloodTypeId === Number(v))?.bloodTypeName ?? '-';
    } else if (fd.type === 'location') {
      text = lookups?.locations.find((l) => l.locationId === Number(v))?.locationNickName ?? '-';
    } else if (fd.type === 'coach') {
      text = lookups?.coaches.find((c) => c.coachId === Number(v))?.coachFullName ?? '-';
    } else {
      text = String(v);
    }
    return (
      <div key={fd.key} className="flex items-baseline justify-between gap-4 text-sm py-0.5">
        <span className="text-slate-400 shrink-0">{fd.label}</span>
        <span className="text-slate-800 text-right">{text}</span>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-4">
        <SmartBack label="Back" fallback="/students" />
        <div className="flex items-center gap-2">
          {row.StudentEliteSwimmer === true && !editing && (
            <Link
              to={`/students/${id}/portfolio`}
              className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 text-sm font-semibold text-amber-700 px-4 py-2 hover:bg-amber-100"
            >
              <Trophy className="size-4" /> Portfolio
            </Link>
          )}
          {!editing && (
            <Link
              to={`/students/${id}/checklist`}
              className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-[#1e5c97] px-4 py-2 hover:bg-slate-50"
            >
              <ListChecks className="size-4" /> Checklist
            </Link>
          )}
          {!editing && canSave && (
            // Legacy BtnDuplicate: new student prefilled from this one (minus
            // first name, DOB, starting date, coach, blood type, facebook, photo).
            <button
              onClick={() => navigate(`/students/new?duplicateOf=${id}`)}
              title="Create a new student prefilled from this one"
              className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-600 px-4 py-2 hover:bg-slate-50"
            >
              <Copy className="size-4" /> Duplicate
            </button>
          )}
          {editing ? (
            <>
              <button
                onClick={cancelEdit}
                disabled={saving}
                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-600 px-4 py-2 hover:bg-slate-50 disabled:opacity-60"
              >
                <X className="size-4" /> Cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="flex items-center gap-2 rounded-xl bg-[#1e5c97] text-white text-sm font-semibold px-5 py-2 hover:bg-[#17497a] disabled:opacity-60"
              >
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                Save changes
              </button>
            </>
          ) : (
            canSave && (
              <button
                onClick={startEdit}
                className="flex items-center gap-2 rounded-xl bg-[#1e5c97] text-white text-sm font-semibold px-5 py-2 hover:bg-[#17497a]"
              >
                <Pencil className="size-4" /> Edit
              </button>
            )
          )}
        </div>
      </div>

      <div className="mb-6 flex items-center gap-4">
        <StudentAvatar
          studentId={id!}
          name={String(row.StudentFullName ?? '')}
          photoUrl={row.StudentPhotoUrl ? String(row.StudentPhotoUrl) : null}
          canSave={canSave}
          onUploaded={(url) => setRow((r) => (r ? { ...r, StudentPhotoUrl: url } : r))}
          onError={setError}
        />
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{String(row.StudentFullName ?? '')}</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            #{String(row.StudentId)} · {String(row.locationNickName ?? '-')} · {String(row.StudentLatestLevelName ?? '-')}
          </p>
          {/* Legacy HlnkOnlinePRofile */}
          <a
            href={`https://www.proswim-lb.com/student.aspx?StudentId=${String(row.StudentId)}`}
            target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-semibold text-[#1e5c97] hover:underline mt-1"
          >
            <ExternalLink className="size-3.5" /> Online ProSwim Profile
          </a>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl p-3 mb-4">
          <AlertCircle className="size-4 text-red-500 shrink-0" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}
      {notice && (
        <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 mb-4">
          <p className="text-sm text-emerald-700">{notice}</p>
        </div>
      )}
      {!canSave && (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 mb-4">
          <p className="text-sm text-amber-700">Your account has view-only access, saving is disabled.</p>
        </div>
      )}

      <MedicalBanner row={row} />

      {!editing && (
        <AiStudentOverview
          studentId={id!}
          studentFullName={String(row.StudentFullName ?? '')}
          startingDate={row.StudentStartingDate ? String(row.StudentStartingDate) : null}
          phone={`${String(row.StudentPhoneNumberCode1 ?? '')}${String(row.StudentPhoneNumber1 ?? '')}`}
        />
      )}

      {!editing && <ProgramsEnrolled studentId={id!} />}

      {!editing && <FamilyLinks studentId={id!} canSave={canSave} />}

      <div className="space-y-4">
        {SECTIONS.map((sec) => (
          <div key={sec.title} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-4">{sec.title}</p>
            <div className={sec.fields.every((f) => f.type === 'checkbox')
              ? 'grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1'
              : editing
                ? 'grid grid-cols-1 md:grid-cols-2 gap-4'
                : 'grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-1'}>
              {sec.fields.map(editing ? renderField : renderViewField)}
            </div>
          </div>
        ))}
      </div>

      {!editing && <LevelHistory studentId={id!} canSave={canSave} levels={lookups?.levels ?? []} />}
      {!editing && <BulkHistory studentId={id!} />}

      {editing && (
        <div className="mt-6 flex items-center justify-end gap-4">
          <label className="flex items-center gap-2 text-sm text-slate-700 select-none">
            <input type="checkbox" checked={sendWelcome} onChange={(e) => setSendWelcome(e.target.checked)} className="accent-[#1e5c97]" />
            Send Welcome Email
          </label>
          <button
            onClick={cancelEdit}
            disabled={saving}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-600 px-4 py-2 hover:bg-slate-50 disabled:opacity-60"
          >
            <X className="size-4" /> Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 rounded-xl bg-[#1e5c97] text-white text-sm font-semibold px-5 py-2 hover:bg-[#17497a] disabled:opacity-60"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Save changes
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Level history (StudentsIndividual.aspx GVResult + "Add Level") ──────────
// P_LevelHistory_Select rows; per-row Edit (P_LevelHistory_Update) and an
// "Add Level" panel (P_LevelHistory_Insert): level, date from, date to
// (optional), remarks.

type LevelRow = Record<string, unknown>;
type LevelDraft = { LevelId: number; LevelDateFrom: string; LevelDateTo: string; LevelRemarks: string };

function toIsoDate(v: unknown): string {
  if (!v || typeof v !== 'string') return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function LevelHistory({ studentId, canSave, levels }: {
  studentId: string; canSave: boolean; levels: { levelId: number; levelName: string | null }[];
}) {
  const [rows, setRows] = useState<LevelRow[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const empty: LevelDraft = { LevelId: 0, LevelDateFrom: new Date().toISOString().slice(0, 10), LevelDateTo: '', LevelRemarks: '' };
  const [draft, setDraft] = useState<LevelDraft>(empty);

  const load = () => {
    apiRequest<LevelRow[]>(`/api/portal/students/${studentId}/level-history`).then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load level history.'));
  };
  useEffect(load, [studentId]);

  const lvId = (r: LevelRow) => Number(r.LevelHistoryId ?? 0);

  function startAdd() { setEditingId(null); setDraft(empty); setAdding(true); }
  function startEdit(r: LevelRow) {
    setAdding(false);
    setEditingId(lvId(r));
    setDraft({
      LevelId: Number(r.LevelId ?? 0),
      LevelDateFrom: toIsoDate(r.LevelDateFrom),
      LevelDateTo: toIsoDate(r.LevelDateTo),
      LevelRemarks: String(r.LevelRemarks ?? ''),
    });
  }
  function cancel() { setAdding(false); setEditingId(null); setDraft(empty); }

  async function submit() {
    setError('');
    if (!draft.LevelId) { setError('Choose a level.'); return; }
    if (!draft.LevelDateFrom) { setError('Date from is required.'); return; }
    setBusy(true);
    try {
      const body = JSON.stringify({ ...draft, LevelDateTo: draft.LevelDateTo || null });
      if (editingId) {
        await apiRequest(`/api/portal/students/level-history/${editingId}`, { method: 'PUT', body });
        toast.success('Level updated.');
      } else {
        await apiRequest(`/api/portal/students/${studentId}/level-history`, { method: 'POST', body });
        toast.success('Level added.');
      }
      cancel();
      load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not save the level.';
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    'w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e5c97]/40';

  const editor = (
    <div className="border border-slate-200 rounded-xl p-3 mb-3 grid grid-cols-1 md:grid-cols-4 gap-3">
      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1">Level *</label>
        <select value={draft.LevelId} onChange={(e) => setDraft({ ...draft, LevelId: Number(e.target.value) })} className={inputCls}>
          <option value={0}>Not Selected</option>
          {levels.map((l) => <option key={l.levelId} value={l.levelId}>{l.levelName}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1">Date from *</label>
        <DateInput value={draft.LevelDateFrom} onChange={(e) => setDraft({ ...draft, LevelDateFrom: e.target.value })} className={inputCls} />
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1">Date to</label>
        <DateInput value={draft.LevelDateTo} onChange={(e) => setDraft({ ...draft, LevelDateTo: e.target.value })} className={inputCls} />
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1">Remarks</label>
        <input value={draft.LevelRemarks} onChange={(e) => setDraft({ ...draft, LevelRemarks: e.target.value })} className={inputCls} />
      </div>
      <div className="md:col-span-4 flex justify-end gap-2">
        <button onClick={cancel} disabled={busy}
          className="rounded-lg border border-slate-200 text-slate-600 text-xs font-semibold px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50">
          Cancel
        </button>
        <button onClick={submit} disabled={busy}
          className="rounded-lg bg-[#1e5c97] text-white text-xs font-semibold px-3 py-1.5 hover:bg-[#174a7c] disabled:opacity-50">
          {busy ? 'Saving…' : editingId ? 'Update Level' : 'Add Level'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 mb-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
          <Layers className="size-4" /> Level History
        </p>
        {canSave && !adding && editingId === null && (
          <button onClick={startAdd}
            className="flex items-center gap-1.5 rounded-lg bg-[#1e5c97] text-white text-xs font-semibold px-3 py-1.5 hover:bg-[#174a7c] transition-colors">
            <Plus className="size-3.5" /> Add Level
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
      {adding && editor}

      {rows === null && !error && <Loader2 className="size-5 animate-spin text-[#1e5c97]" />}
      {rows !== null && rows.length === 0 && !adding && (
        <p className="text-sm text-slate-400">No level history recorded.</p>
      )}
      {rows !== null && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="text-left text-xs text-slate-400 uppercase tracking-wider border-b border-slate-100">
                <th className="px-2 py-2 font-semibold">Level</th>
                <th className="px-2 py-2 font-semibold">Date From</th>
                <th className="px-2 py-2 font-semibold">Date To</th>
                <th className="px-2 py-2 font-semibold">Remarks</th>
                {canSave && <th className="px-2 py-2" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={lvId(r)} className="border-b border-slate-50 last:border-0">
                  {editingId === lvId(r) ? (
                    <td colSpan={canSave ? 5 : 4} className="px-2 py-2">{editor}</td>
                  ) : (
                    <>
                      <td className="px-2 py-2 font-medium text-slate-800">{String(r.LevelName ?? '-')}</td>
                      <td className="px-2 py-2 text-slate-600">{toDMY(r.LevelDateFrom)}</td>
                      <td className="px-2 py-2 text-slate-600">{toDMY(r.LevelDateTo)}</td>
                      <td className="px-2 py-2 text-slate-600 whitespace-normal">{String(r.LevelRemarks ?? '') || '-'}</td>
                      {canSave && (
                        <td className="px-2 py-2 text-right">
                          <button onClick={() => startEdit(r)} title="Edit level" className="text-[#1e5c97] hover:text-[#242c43]">
                            <Pencil className="size-4" />
                          </button>
                        </td>
                      )}
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Bulk-message history (StudentsIndividual.aspx GVBulk) ───────────────────
// Read-only: every bulk WhatsApp / email / push row queued for this student.

function BulkHistory({ studentId }: { studentId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    apiRequest<Row[]>(`/api/portal/students/${studentId}/bulks`).then(setRows).catch(() => setFailed(true));
  }, [studentId]);

  if (failed || (rows !== null && rows.length === 0)) return null;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 mb-4">
      <p className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2 mb-3">
        <MessageSquare className="size-4" /> Bulk Messages
      </p>
      {rows === null && <Loader2 className="size-5 animate-spin text-[#1e5c97]" />}
      {rows !== null && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="text-left text-xs text-slate-400 uppercase tracking-wider border-b border-slate-100">
                <th className="px-2 py-2 font-semibold">Type</th>
                <th className="px-2 py-2 font-semibold">Date</th>
                <th className="px-2 py-2 font-semibold">Status</th>
                <th className="px-2 py-2 font-semibold">Phone 1</th>
                <th className="px-2 py-2 font-semibold">Sent</th>
                <th className="px-2 py-2 font-semibold">Subject</th>
                <th className="px-2 py-2 font-semibold">Body</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const bid = num(r, 'BulkId');
                const body = str(r, 'BulkBody');
                const expanded = open === bid;
                return (
                  <tr key={bid} className="border-b border-slate-50 last:border-0 align-top">
                    <td className="px-2 py-2 text-slate-700">{str(r, 'BulkType') || '-'}</td>
                    <td className="px-2 py-2 text-slate-600">{toDMY(r.BulkDate)}</td>
                    <td className="px-2 py-2 text-slate-600">{str(r, 'BulkStatus') || '-'}</td>
                    <td className="px-2 py-2 text-slate-600">{str(r, 'BulkPhone1') || '-'}</td>
                    <td className="px-2 py-2 text-slate-600">{toDMY(r.BulkSentDate)}</td>
                    <td className="px-2 py-2 text-slate-600 whitespace-normal max-w-48">{str(r, 'BulkSubject') || '-'}</td>
                    <td className="px-2 py-2 text-slate-600 whitespace-normal max-w-md">
                      {body.length > 120 && !expanded ? (
                        <>
                          {body.slice(0, 120)}…{' '}
                          <button onClick={() => setOpen(bid)} className="text-[#1e5c97] text-xs font-semibold hover:underline">more</button>
                        </>
                      ) : body || '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Profile photo (supervisor-managed) ──────────────────────────────────────

function StudentAvatar({ studentId, name, photoUrl, canSave, onUploaded, onError }: {
  studentId: string;
  name: string;
  photoUrl: string | null;
  canSave: boolean;
  onUploaded: (url: string) => void;
  onError: (msg: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

  async function handle(file: File | undefined | null) {
    if (!file) return;
    setUploading(true);
    onError('');
    try {
      const res = await apiUpload<{ url: string }>(`/api/portal/students/${studentId}/photo`, file);
      onUploaded(res.url);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Photo upload failed.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="relative shrink-0">
      <div className="w-16 h-16 rounded-full overflow-hidden bg-[#e8f0f8] flex items-center justify-center border border-slate-200">
        {uploading ? (
          <Loader2 className="size-5 text-[#1e5c97] animate-spin" />
        ) : photoUrl ? (
          <img src={photoUrl} alt={name} className="w-full h-full object-cover" />
        ) : (
          <span className="text-lg font-bold text-[#1e5c97]">{initials || '?'}</span>
        )}
      </div>
      {canSave && (
        <>
          <button
            onClick={() => input.current?.click()}
            title="Upload profile photo"
            className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-[#1e5c97] text-white flex items-center justify-center hover:bg-[#17497a] shadow"
          >
            <Camera className="size-3.5" />
          </button>
          <input
            ref={input}
            type="file"
            accept=".png,.jpg,.jpeg,image/png,image/jpeg"
            className="hidden"
            onChange={(e) => { handle(e.target.files?.[0]); e.target.value = ''; }}
          />
        </>
      )}
    </div>
  );
}

// ─── Medical banner ──────────────────────────────────────────────────────────
// Allergies and medical notes must be impossible to miss for staff, so they
// get a red banner above the record (visible in both view and edit mode),
// with the emergency contact right there for when it matters.

function MedicalBanner({ row }: { row: StudentRow }) {
  const trimmed = (k: string) => String(row[k] ?? '').trim();
  const allergies = trimmed('StudentAllergies');
  const medical = trimmed('StudentMedicalNotes');
  const ecName = trimmed('StudentEmergencyContactName');
  const ecRelation = trimmed('StudentEmergencyContactRelation');
  const ecPhone = [trimmed('StudentEmergencyContactPhoneCode'), trimmed('StudentEmergencyContactPhone')]
    .filter(Boolean).join(' ');
  if (!allergies && !medical) return null;

  return (
    <div className="rounded-2xl border-2 border-red-200 bg-red-50 p-4 mb-4">
      <div className="flex items-start gap-3">
        <HeartPulse className="size-5 text-red-600 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-widest text-red-600 mb-1">Medical, check before sessions</p>
          {allergies && (
            <p className="text-sm text-red-800">
              <span className="font-bold">Allergies:</span> {allergies}
            </p>
          )}
          {medical && (
            <p className="text-sm text-red-800">
              <span className="font-bold">Medical notes:</span> {medical}
            </p>
          )}
          {(ecName || ecPhone) && (
            <p className="text-sm text-red-700 mt-1.5 flex items-center gap-1.5">
              <PhoneCall className="size-3.5 shrink-0" />
              Emergency contact: {ecName || '-'}{ecRelation ? ` (${ecRelation})` : ''}{ecPhone ? `: ${ecPhone}` : ''}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Programs Enrolled In ────────────────────────────────────────────────────
// One card per active program (a swimmer can be in several), each with the
// enrollment behind it: registrations + attendance for Group Training,
// packages for Private Training. Flag-only programs render as compact cards.

type Row = Record<string, unknown>;

interface ProgramsData {
  programs: {
    groupTraining: boolean;
    privateTraining: boolean;
    competitiveTeam: boolean;
    aquaBaby: boolean;
    aquaGym: boolean;
    school: boolean;
    gifted: boolean;
    other: boolean;
  };
  registrations: Row[];
  attendance: Row[];
  packages: Row[];
}

const str = (r: Row, k: string) => (r[k] == null ? '' : String(r[k]));
const num = (r: Row, k: string) => Number(r[k] ?? 0);

function ProgramsEnrolled({ studentId }: { studentId: string }) {
  const [data, setData] = useState<ProgramsData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    apiRequest<ProgramsData>(`/api/portal/students/${studentId}/programs`)
      .then(setData)
      .catch(() => setFailed(true));
  }, [studentId]);

  if (failed) return null; // form below still works; cards are an overlay
  if (!data) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 mb-4 flex items-center gap-2">
        <Loader2 className="size-4 text-[#1e5c97] animate-spin" />
        <p className="text-sm text-slate-400">Loading programs…</p>
      </div>
    );
  }

  const { programs, registrations, attendance, packages } = data;
  // A program is "active" when its flag is set or real enrollment data exists.
  const groupActive = programs.groupTraining || registrations.length > 0;
  const privateActive = programs.privateTraining || packages.length > 0;
  const flagCards: { label: string; on: boolean; cls: string }[] = [
    { label: 'Competitive Team', on: programs.competitiveTeam, cls: 'bg-amber-50 border-amber-200 text-amber-800' },
    { label: 'AquaBaby', on: programs.aquaBaby, cls: 'bg-cyan-50 border-cyan-200 text-cyan-800' },
    { label: 'AquaGym', on: programs.aquaGym, cls: 'bg-teal-50 border-teal-200 text-teal-800' },
    { label: 'School', on: programs.school, cls: 'bg-slate-50 border-slate-200 text-slate-700' },
    { label: 'Gifted', on: programs.gifted, cls: 'bg-pink-50 border-pink-200 text-pink-800' },
    { label: 'Other', on: programs.other, cls: 'bg-slate-50 border-slate-200 text-slate-700' },
  ].filter((f) => f.on);

  if (!groupActive && !privateActive && flagCards.length === 0) return null;

  const att = (regId: number) => attendance.find((a) => num(a, 'RegistrationId') === regId);

  return (
    <div className="mb-4">
      <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Programs Enrolled In</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {groupActive && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-soft p-5 border-t-4 border-t-[#1e5c97]">
            <p className="text-sm font-bold text-[#1e5c97] mb-3">Group Training</p>
            {registrations.length === 0 && (
              <p className="text-sm text-slate-400">Enrolled, no registrations recorded yet.</p>
            )}
            <div className="space-y-3">
              {registrations.map((reg) => {
                const regId = num(reg, 'RegistrationId');
                const classes = [str(reg, 'ClassName1'), str(reg, 'ClassName2'), str(reg, 'ClassName3')]
                  .filter(Boolean).join(' · ');
                const a = att(regId);
                const total = a ? num(a, 'TotalSessions') : 0;
                const attended = a ? num(a, 'AttendedSessions') : 0;
                const stopped = reg['RegistrationStudentStopped'] === true;
                return (
                  <div key={regId} className="text-sm border-b border-slate-50 last:border-0 pb-2 last:pb-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-800">{str(reg, 'SemesterName') || '-'}</span>
                      {stopped
                        ? <span className="text-[11px] font-bold text-red-600 bg-red-50 rounded-full px-2 py-0.5">Stopped</span>
                        : total > 0 && (
                          <span className="text-[11px] font-bold text-[#1e5c97] bg-[#e8f0f8] rounded-full px-2 py-0.5">
                            {attended}/{total} attended{total > 0 ? ` · ${Math.round((attended / total) * 100)}%` : ''}
                          </span>
                        )}
                    </div>
                    <p className="text-slate-500 mt-0.5">
                      {classes || 'No classes assigned'}
                      {str(reg, 'LocationNickName') && <> · {str(reg, 'LocationNickName')}</>}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {privateActive && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-soft p-5 border-t-4 border-t-indigo-500">
            <p className="text-sm font-bold text-indigo-600 mb-3">Private Training</p>
            {packages.length === 0 && (
              <p className="text-sm text-slate-400">Enrolled, no packages recorded yet.</p>
            )}
            <div className="space-y-3">
              {packages.map((p) => {
                const totalSessions = num(p, 'PackageNumberOfSessions');
                const attended = num(p, 'CountAttended');
                const closed = p['PackageClosed'] === true;
                return (
                  <div key={num(p, 'PackageId')} className="text-sm border-b border-slate-50 last:border-0 pb-2 last:pb-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-800">{str(p, 'PackageName') || `Package #${num(p, 'PackageId')}`}</span>
                      {closed
                        ? <span className="text-[11px] font-bold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">Closed</span>
                        : totalSessions > 0 && (
                          <span className="text-[11px] font-bold text-indigo-600 bg-indigo-50 rounded-full px-2 py-0.5">
                            {attended}/{totalSessions} attended
                          </span>
                        )}
                    </div>
                    <p className="text-slate-500 mt-0.5">
                      {[str(p, 'CoachFullName'), str(p, 'LocationNickName'), str(p, 'PackageStatus')]
                        .filter(Boolean).join(' · ') || '-'}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {flagCards.map((f) => (
          <div key={f.label} className={`rounded-2xl border shadow-soft p-5 border-t-4 ${f.cls}`}>
            <p className="text-sm font-bold">{f.label}</p>
            <p className="text-sm opacity-70 mt-1">Enrolled, sessions are tracked under this student's schedule.</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Family links (manual siblings) ──────────────────────────────────────────
// Families are staff-made links only, no automatic phone grouping. Links are
// DIRECTIONAL: linking a sibling from this page makes THIS swimmer the main
// account, the family signs in with the main's credentials and switches.
function FamilyLinks({ studentId, canSave }: { studentId: string; canSave: boolean }) {
  const [links, setLinks] = useState<Row[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Row[] | null>(null);
  const [searching, setSearching] = useState(false);

  const load = () => {
    apiRequest<Row[]>(`/api/portal/students/${studentId}/family`).then(setLinks)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load family links.'));
  };
  useEffect(load, [studentId]);

  async function runSearch(term?: string) {
    const q = (term ?? search).trim();
    if (q.length < 2) { setResults(null); return; }
    setSearching(true);
    try {
      const rows = await apiRequest<Row[]>(`/api/portal/students?searchFor=${encodeURIComponent(q)}`);
      const linked = new Set((links ?? []).map((l) => num(l, 'SiblingId')));
      const ql = q.toLowerCase();
      const matches = rows
        .filter((r) => num(r, 'studentId') !== Number(studentId) && !linked.has(num(r, 'studentId')))
        // Best matches first: names that start with the query, then names
        // containing it, then everything else (the proc also matches phone,
        // email, notes, school...).
        .sort((a, b) => {
          const rank = (r: Row) => {
            const name = str(r, 'studentFullName').toLowerCase();
            if (name.startsWith(ql)) return 0;
            if (name.includes(ql)) return 1;
            return 2;
          };
          return rank(a) - rank(b) || str(a, 'studentFullName').localeCompare(str(b, 'studentFullName'));
        });
      setResults(matches.slice(0, 30));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed.');
    } finally {
      setSearching(false);
    }
  }

  // Live search: fires 350ms after the admin stops typing.
  useEffect(() => {
    if (!adding) return;
    const t = setTimeout(() => { runSearch(search); }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, adding]);

  async function addSibling(siblingId: number) {
    setBusy(true);
    setError('');
    try {
      await apiRequest(`/api/portal/students/${studentId}/family`, {
        method: 'POST',
        body: JSON.stringify({ siblingId }),
      });
      setAdding(false);
      setSearch('');
      setResults(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not link the sibling.');
    } finally {
      setBusy(false);
    }
  }

  async function removeLink(linkId: number) {
    setBusy(true);
    setError('');
    try {
      await apiRequest(`/api/portal/students/family/${linkId}`, { method: 'DELETE' });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove the link.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 mb-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
          <Users className="size-4" /> Family. Siblings
        </p>
        {canSave && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 rounded-lg bg-[#1e5c97] text-white text-xs font-semibold px-3 py-1.5 hover:bg-[#174a7c] transition-colors"
          >
            <UserPlus className="size-3.5" /> Link sibling
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}

      {/* This swimmer sits under someone else's main account */}
      {(links ?? []).some((l) => num(l, 'IsMainSide') === 0) && (
        <p className="text-sm text-slate-600 mb-2 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
          Main account:{' '}
          {(links ?? []).filter((l) => num(l, 'IsMainSide') === 0).map((l, i) => (
            <span key={num(l, 'LinkId')}>
              {i > 0 && ', '}
              <Link to={`/students/${num(l, 'SiblingId')}`} className="font-semibold text-[#1e5c97]">
                {str(l, 'SiblingFullName')}
              </Link>
            </span>
          ))}
          {' '}the family signs in with that swimmer's login.
        </p>
      )}

      {adding && (
        <div className="mb-3 border border-slate-200 rounded-xl p-3">
          <div className="flex gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
              placeholder="Search swimmer by name…"
              className="flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e5c97]/40"
              autoFocus
            />
            <button onClick={() => runSearch()} disabled={searching}
              className="rounded-lg bg-[#1e5c97] text-white text-xs font-semibold px-3 py-1.5 disabled:opacity-50">
              {searching ? 'Searching…' : 'Search'}
            </button>
            <button onClick={() => { setAdding(false); setSearch(''); setResults(null); }}
              className="rounded-lg border border-slate-200 text-slate-500 text-xs font-semibold px-2 py-1.5">
              <X className="size-3.5" />
            </button>
          </div>
          {results !== null && (
            <div className="mt-2 divide-y divide-slate-100 max-h-80 overflow-y-auto">
              {results.length === 0 && <p className="text-sm text-slate-400 py-2">No matches.</p>}
              {results.map((r) => (
                <button
                  key={num(r, 'studentId')}
                  onClick={() => addSibling(num(r, 'studentId'))}
                  disabled={busy}
                  className="w-full flex items-center justify-between py-2 text-left hover:bg-slate-50 px-1 rounded disabled:opacity-50"
                >
                  <span className="text-sm text-slate-800">{str(r, 'studentFullName')}</span>
                  <span className="text-xs text-slate-400">
                    #{num(r, 'studentId')}
                    {str(r, 'studentDateOfBirth') ? ` · b. ${new Date(str(r, 'studentDateOfBirth')).getFullYear()}` : ''}
                    {' · '}{str(r, 'locationNickName') || '-'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {links === null && !error && <Loader2 className="size-5 animate-spin text-[#1e5c97]" />}
      {links !== null && links.length === 0 && (
        <p className="text-sm text-slate-400">
          No linked siblings, link one to make this swimmer the family's main
          account (the login the whole family uses).
        </p>
      )}
      {links !== null && links.some((l) => num(l, 'IsMainSide') === 1) && (
        <div className="flex flex-wrap gap-2">
          {links.filter((l) => num(l, 'IsMainSide') === 1).map((l) => (
            <div key={num(l, 'LinkId')}
              className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 pl-1.5 pr-2 py-1">
              <span className="w-7 h-7 rounded-full overflow-hidden bg-[#1e5c97]/10 flex items-center justify-center shrink-0">
                {str(l, 'StudentPhotoUrl') ? (
                  <img src={str(l, 'StudentPhotoUrl')} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-[10px] font-bold text-[#1e5c97]">
                    {str(l, 'SiblingFullName').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
                  </span>
                )}
              </span>
              <Link to={`/students/${num(l, 'SiblingId')}`} className="text-sm font-medium text-slate-800 hover:text-[#1e5c97]">
                {str(l, 'SiblingFullName')}
              </Link>
              {canSave && (
                <button onClick={() => removeLink(num(l, 'LinkId'))} disabled={busy}
                  aria-label="Remove link"
                  className="text-slate-400 hover:text-red-500 disabled:opacity-50">
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

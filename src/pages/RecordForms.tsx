import { RecordFormPage, type RecordFormConfig } from '../components/RecordFormPage';
import { getStoredUser } from '../api/portalApi';
import { CLASS_PERIODS, CLASS_TIMES, coachesOfFormLocation, isoToday, semestersOfFormLocation } from '../lib/groupClasses';

const LOOKUPS = '/api/portal/modules/lookups';

const CURRENCY = [
  { value: 'USD', label: 'USD' },
  { value: 'LBP', label: 'LBP' },
];

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => ({ value: d, label: d }));

// ── Semester ─────────────────────────────────────────────────────────────────

// Mirrors SemestersIndividual.aspx: same fields/labels, defaults (Stds/Class
// Limit 5, kit and prices 0, currency LBP, no flag ticked, blank stop which the
// proc stores as NULL), validators (name + "# Of Weeks" required, dates
// required, amounts whole numbers ≥ 0). Location = the list's / user's own,
// locked for 'user'. On edit the currency is fixed, and Current / Upcoming
// can't be unticked once set (legacy chk*.Enabled=false). "Exclusive Current"
// is the legacy radio pair: ticked = clear the location's other currents.
const SEMESTER_AMOUNTS = [
  'SemesterNumberOfWeeks', 'SemesterStudentsPerClass', 'SemesterAmountKit', 'SemesterAmountOne', 'SemesterAmountTwo',
  'SemesterAmountThree', 'SemesterAmountFour', 'SemesterAmountFive', 'SemesterAmountSix', 'SemesterAmountSeven',
];

const semester: RecordFormConfig = {
  title: 'Semester',
  listPath: '/semesters',
  slug: 'semester',
  idKey: 'SemesterId',
  titleKey: 'SemesterName',
  lookups: LOOKUPS,
  heroSlide: 3,
  createDefaults: {
    SemesterCurrency: 'LBP',
    SemesterStudentsPerClass: 5,
    SemesterAmountKit: 0,
    SemesterAmountOne: 0, SemesterAmountTwo: 0, SemesterAmountThree: 0, SemesterAmountFour: 0,
    SemesterAmountFive: 0, SemesterAmountSix: 0, SemesterAmountSeven: 0,
    SemesterDeleted: false,
    SemesterCurrent: false,
    SemesterUpcoming: false,
    Exclusivecurrent: false,
  },
  validate: (f) => {
    if (!String(f.SemesterName ?? '').trim()) return 'Semester Name is required.';
    if (f.SemesterNumberOfWeeks === '' || f.SemesterNumberOfWeeks == null) return '# Of Weeks is required.';
    if (!f.SemesterStart) return 'Semester Start is required.';
    if (!f.SemesterEnd) return 'Semester End is required.';
    for (const k of SEMESTER_AMOUNTS) {
      const v = f[k];
      if (v !== '' && v != null && !(Number.isInteger(Number(v)) && Number(v) >= 0)) return 'Amounts must be whole numbers (Number).';
    }
    return null;
  },
  sections: [
    {
      title: 'Semester',
      fields: [
        { key: 'SemesterName', label: 'Semester Name', type: 'text' },
        { key: 'SemesterStart', label: 'Semester Start', type: 'date' },
        { key: 'SemesterEnd', label: 'Semester End', type: 'date' },
        { key: 'SemesterStop', label: 'Semester Stop', type: 'date' },
        { key: 'SemesterNumberOfWeeks', label: '# Of Weeks', type: 'number' },
        { key: 'SemesterPrimaryLocationId', label: 'Primary Location', type: 'select', optionsKey: 'locations',
          urlParam: 'locationId', defaultToUserLocation: true, lockedFor: ['user'] },
        { key: 'SemesterStudentsPerClass', label: 'Stds / Class Limit', type: 'number' },
        { key: 'SemesterAmountKit', label: 'Swimming Kit', type: 'number' },
      ],
    },
    {
      title: 'Pricing',
      fields: [
        { key: 'SemesterCurrency', label: 'Currency', type: 'select', readOnlyOnEdit: true,
          options: [{ value: 'LBP', label: 'LBP' }, { value: 'USD', label: 'USD' }] },
        { key: 'SemesterAmountOne', label: 'Price For One', type: 'number' },
        { key: 'SemesterAmountTwo', label: 'Price For Two', type: 'number' },
        { key: 'SemesterAmountThree', label: 'Price For Three', type: 'number' },
        { key: 'SemesterAmountFour', label: 'Price For Four', type: 'number' },
        { key: 'SemesterAmountFive', label: 'Price For Five', type: 'number' },
        { key: 'SemesterAmountSix', label: 'Price For Six', type: 'number' },
        { key: 'SemesterAmountSeven', label: 'Price For Seven', type: 'number' },
        { key: 'SemesterDescription', label: 'Description', type: 'textarea' },
      ],
    },
    {
      title: 'Flags',
      fields: [
        { key: 'SemesterDeleted', label: 'Deleted', type: 'checkbox' },
        { key: 'SemesterCurrent', label: 'Current', type: 'checkbox', lockedWhen: (r) => r?.SemesterCurrent === true },
        { key: 'SemesterUpcoming', label: 'Upcoming', type: 'checkbox', lockedWhen: (r) => r?.SemesterUpcoming === true },
        { key: 'Exclusivecurrent', label: 'Exclusive Current (untick other currents)', type: 'checkbox' },
      ],
    },
  ],
};

// ── Coach ────────────────────────────────────────────────────────────────────

const coach: RecordFormConfig = {
  title: 'Coach',
  listPath: '/coaches',
  slug: 'coach',
  idKey: 'CoachId',
  titleKey: 'CoachFullName',
  lookups: LOOKUPS,
  heroSlide: 1,
  createDefaults: {
    CoachActive: true,
    CoachDateOfBirth: '1990-01-01',
    CoachStartingDate: new Date().toISOString().slice(0, 10),
    CoachPayrollSalaryCurrency: 'USD',
    CoachPayrollHrlyCurrency: 'USD',
    CoachPayrollSalaryEffective: 0,
    CoachPayrollAquaBabyHour: 0,
    CoachPayrollAquaGymHour: 0,
    CoachPayrollPhysioHour: 0,
    CoachPayrollMiscHour: 0,
  },
  validate: (f) => {
    const full = Number(f.CoachPayrollSalaryEffective ?? 0), paid = Number(f.CoachPayrollSalary ?? 0);
    return full > 0 && paid > full ? 'Payroll salary cannot be higher than the full salary.' : null;
  },
  sections: [
    {
      title: 'Personal',
      fields: [
        { key: 'CoachFullName', label: 'Full name', type: 'text' },
        { key: 'CoachGender', label: 'Gender', type: 'select', options: [{ value: 'Male', label: 'Male' }, { value: 'Female', label: 'Female' }] },
        { key: 'CoachDateOfBirth', label: 'Date of birth', type: 'date' },
        { key: 'CoachNationality', label: 'Nationality', type: 'text' },
        { key: 'CoachPhoneNumber', label: 'Phone', type: 'text' },
        { key: 'CoachEmail', label: 'Email', type: 'text' },
        { key: 'CoachStartingDate', label: 'Starting date', type: 'date' },
        { key: 'CoachActive', label: 'Active', type: 'checkbox' },
      ],
    },
    {
      title: 'Assignment',
      fields: [
        { key: 'CoachPrimaryLocationId', label: 'Primary location', type: 'select', optionsKey: 'locations' },
        { key: 'CoachSecondaryLocationId', label: 'Second location', type: 'select', optionsKey: 'locations' },
        { key: 'CoachLevel', label: 'Level', type: 'text' },
        { key: 'CoachJobDescription', label: 'Job description', type: 'text' },
      ],
    },
    {
      title: 'Coaching types',
      fields: [
        { key: 'CoachGroup', label: 'Group', type: 'checkbox' },
        { key: 'CoachPrivate', label: 'Private', type: 'checkbox' },
        { key: 'CoachOther', label: 'Other', type: 'checkbox' },
      ],
    },
    {
      title: 'Payroll',
      fields: [
        // Same set as the legacy coach page: full salary vs the salary actually
        // paid through payroll (part-time), then one hourly rate per discipline.
        { key: 'CoachPayrollSalaryCurrency', label: 'Salary currency', type: 'select', options: CURRENCY },
        { key: 'CoachPayrollSalaryEffective', label: 'Salary', type: 'number', hint: 'full monthly salary, ex: $800' },
        { key: 'CoachPayrollSalary', label: 'Payroll salary', type: 'number', hint: 'amount paid on the timesheet, ex: $500 (3 days)' },
        { key: 'CoachPayrollHrlyCurrency', label: 'Hourly currency', type: 'select', options: CURRENCY },
        { key: 'CoachPayrollPRHour', label: 'Private / hour', type: 'number' },
        { key: 'CoachPayrollTeamHour', label: 'Team / hour', type: 'number' },
        { key: 'CoachPayrollSchoolHour', label: 'School / hour', type: 'number' },
        { key: 'CoachPayrollAquaBabyHour', label: 'Aqua Baby / hour', type: 'number' },
        { key: 'CoachPayrollAquaGymHour', label: 'Aqua Gym / hour', type: 'number' },
        { key: 'CoachPayrollPhysioHour', label: 'Physio / hour', type: 'number' },
        { key: 'CoachPayrollMiscHour', label: 'Misc / hour', type: 'number' },
      ],
    },
    {
      title: 'Notes',
      fields: [{ key: 'CoachNotes', label: 'Notes', type: 'textarea' }],
    },
  ],
};

// ── Class ────────────────────────────────────────────────────────────────────

// Mirrors ClassIndividual.aspx. Location → semesters + coaches cascade (legacy
// ddlLocations_SelectedIndexChanged rebinds both without "Not Selected", so the
// first entry is picked: the newest semester, the first active coach). Time is
// the legacy 04:30–22:45 quarter-hour list (default 15:30), Period 0.5–2.5 Hrs
// (default 1), remarks obligatory when absent ticked by default. The server
// refuses a duplicate (same semester, coach, day and time): "Class Already Exists".
const klass: RecordFormConfig = {
  title: 'Class',
  listPath: '/classes',
  slug: 'class',
  idKey: 'ClassId',
  titleKey: 'ClassName',
  lookups: LOOKUPS,
  heroSlide: 2,
  createDefaults: {
    ClassLevelId: 0,
    ClassDay: 'Mon',
    ClassTimeFrom: '15:30',
    ClassPeriod: '1',
    ClassRemarks: '',
    ClassDeleted: false,
    ClassObligatoryRemarksWhenAbsent: true,
  },
  sections: [
    {
      title: 'Class',
      fields: [
        { key: 'ClassLocationId', label: 'Location', type: 'select', optionsKey: 'locations',
          urlParam: 'locationId', defaultToUserLocation: true, lockedFor: ['user'] },
        { key: 'ClassSemesterId', label: 'Semester', type: 'select', labelKey: 'semestername',
          optionsFrom: semestersOfFormLocation('ClassLocationId') },
        { key: 'ClassLevelId', label: 'Level', type: 'select', optionsKey: 'levels' },
        { key: 'CoachId', label: 'Coach', type: 'select', labelKey: 'CoachFullName',
          optionsFrom: coachesOfFormLocation('ClassLocationId') },
        { key: 'ClassDay', label: 'Day', type: 'select', options: DAYS },
        { key: 'ClassTimeFrom', label: 'Time', type: 'select', options: CLASS_TIMES },
        { key: 'ClassPeriod', label: 'Period', hint: 'Hrs', type: 'select', options: CLASS_PERIODS },
        { key: 'ClassRemarks', label: 'Remarks', type: 'textarea' },
      ],
    },
    {
      title: 'Flags',
      fields: [
        { key: 'ClassObligatoryRemarksWhenAbsent', label: 'Obligatory Remarks When Absent', type: 'checkbox' },
        { key: 'ClassDeleted', label: 'Deleted', type: 'checkbox' },
      ],
    },
  ],
};

// ── Student (create) ─────────────────────────────────────────────────────────

// Mirrors StudentsIndividual.aspx (add path): every P_Student_Insert parameter
// the legacy form sets, same defaults (Group + Active checked, phone codes 961,
// nationality Lebanese, primary location = signed-in user's location, DOB
// blank, starting date today, "Send Welcome Email" on). POST returns the new
// id → open the student's page; "Save and Register" goes to the private
// package form when Private is ticked, else to a new group registration.
const student: RecordFormConfig = {
  title: 'Student',
  listPath: '/students',
  slug: 'student',
  idKey: 'StudentId',
  titleKey: 'StudentFullName',
  lookups: LOOKUPS,
  datalists: '/api/portal/students/autocomplete',
  heroSlide: 2,
  createDefaults: () => ({
    StudentActive: true,
    StudentDeleted: false,
    StudentGroupSwimmer: true,
    StudentStartingDate: new Date().toISOString().slice(0, 10),
    StudentPhoneNumberCode1: '961',
    StudentPhoneNumberCode2: '961',
    StudentNationality1: 'Lebanese',
    StudentPrimaryLocationId: getStoredUser()?.primaryLocationId ?? 0,
    SendWelcomeEmail: true,
  }),
  // Legacy BtnDuplicate: ?StudentIDDuplicate=<id> prefilled everything except
  // first name, facebook, blood type, coach, DOB, starting date (and the photo).
  duplicate: {
    param: 'duplicateOf',
    load: (id) => `/api/portal/students/${id}`,
    omit: ['StudentFirstName', 'StudentFacebookAccount', 'StudentBloodTypeId', 'StudentPrimaryCoachId',
      'StudentDateOfBirth', 'StudentStartingDate', 'SendWelcomeEmail'],
  },
  validate: (f) => {
    const blank = (k: string) => String(f[k] ?? '').trim() === '';
    if (blank('StudentFirstName')) return 'First name is required.';
    if (blank('StudentLastName')) return 'Last name is required.';
    if (blank('StudentPhoneNumber1')) return 'Phone 1 is required.';
    if (blank('StudentDateOfBirth')) return 'Date of birth is required.';
    if (blank('StudentStartingDate')) return 'Starting date is required.';
    return null;
  },
  // POST /api/portal/edit/student → { ok, id, studentId, message }
  onCreated: (res) => `/students/${res.id ?? res.studentId}`,
  extraActions: [
    {
      label: 'Save and Register',
      path: (res, f) => f.StudentPrivateSwimmer === true
        ? `/privates/new?studentId=${res.id ?? res.studentId}`
        : `/registrations/new?studentId=${res.id ?? res.studentId}`,
    },
  ],
  sections: [
    {
      title: 'Personal',
      fields: [
        { key: 'StudentFirstName', label: 'First name *', type: 'text', datalist: 'firstNames' },
        { key: 'StudentMiddleName', label: 'Middle name', type: 'text', datalist: 'firstNames' },
        { key: 'StudentLastName', label: 'Last name *', type: 'text', datalist: 'lastNames' },
        { key: 'StudentGender', label: 'Gender', type: 'select', options: [{ value: 'Male', label: 'Male' }, { value: 'Female', label: 'Female' }] },
        { key: 'StudentDateOfBirth', label: 'Date of birth *', type: 'date' },
        { key: 'StudentBloodTypeId', label: 'Blood type', type: 'select', optionsKey: 'bloodTypes' },
        { key: 'StudentSchool', label: 'School', type: 'text', datalist: 'schools' },
        { key: 'StudentNationality1', label: 'Nationality 1', type: 'text', datalist: 'nationalities' },
        { key: 'StudentNationality2', label: 'Nationality 2', type: 'text', datalist: 'nationalities' },
        { key: 'StudentMomOccupation', label: 'Mom occupation', type: 'text', datalist: 'occupations' },
        { key: 'StudentDadOccupation', label: 'Dad occupation', type: 'text', datalist: 'occupations' },
      ],
    },
    {
      title: 'Contact',
      fields: [
        { key: 'StudentPhoneNumberCode1', label: 'Phone code 1', type: 'text' },
        { key: 'StudentPhoneNumber1', label: 'Phone 1 *', type: 'text' },
        { key: 'StudentPhoneNumberCode2', label: 'Phone code 2', type: 'text' },
        { key: 'StudentPhoneNumber2', label: 'Phone 2', type: 'text' },
        { key: 'StudentEmail', label: 'Email', type: 'text' },
        { key: 'StudentEmail2', label: 'Email 2', type: 'text' },
        { key: 'StudentFacebookAccount', label: 'Facebook', type: 'text' },
        { key: 'StudentParentFacebook', label: 'Parent Facebook', type: 'text' },
      ],
    },
    {
      title: 'Address',
      fields: [
        { key: 'StudentAddressCity', label: 'City', type: 'text', datalist: 'cities' },
        { key: 'StudentAddressRegion', label: 'Region', type: 'text', datalist: 'regions' },
        { key: 'StudentAddressStreet', label: 'Street', type: 'text', datalist: 'streets' },
        { key: 'StudentAddressBuilding', label: 'Building', type: 'text' },
        { key: 'StudentAddressFloor', label: 'Floor', type: 'text' },
      ],
    },
    {
      title: 'Swimming',
      fields: [
        { key: 'StudentStartingDate', label: 'Starting date *', type: 'date' },
        { key: 'StudentPrimaryCoachId', label: 'Primary coach', type: 'select', optionsKey: 'coaches' },
        { key: 'StudentPrimaryLocationId', label: 'Primary location', type: 'select', optionsKey: 'locations' },
        { key: 'StudentPrimaryLocationId2', label: 'Location 2', type: 'select', optionsKey: 'locations' },
        { key: 'StudentPrimaryLocationId3', label: 'Location 3', type: 'select', optionsKey: 'locations' },
        { key: 'StudentStartingCoach', label: 'Starting coach', type: 'text', datalist: 'startingCoaches' },
        { key: 'StudentStartingLocation', label: 'Starting location', type: 'text', datalist: 'startingLocations' },
      ],
    },
    {
      title: 'Programs Enrolled In',
      fields: [
        { key: 'StudentGroupSwimmer', label: 'Group Training', type: 'checkbox' },
        { key: 'StudentPrivateSwimmer', label: 'Private Training', type: 'checkbox' },
        { key: 'StudentEliteSwimmer', label: 'Competitive Team', type: 'checkbox' },
        { key: 'StudentAquaBabySwimmer', label: 'AquaBaby', type: 'checkbox' },
        { key: 'StudentAquaGymSwimmer', label: 'AquaGym', type: 'checkbox' },
        { key: 'StudentSchoolSwimmer', label: 'School', type: 'checkbox' },
        { key: 'StudentGiftedSwimmer', label: 'Gifted', type: 'checkbox' },
        { key: 'StudentOthersSwimmer', label: 'Others', type: 'checkbox' },
        { key: 'StudentWaitingList', label: 'Waiting list', type: 'checkbox' },
        { key: 'StudentActive', label: 'Active', type: 'checkbox' },
      ],
    },
    {
      title: 'Website & Messaging',
      fields: [
        { key: 'StudentShowOnline', label: 'Show online', type: 'checkbox' },
        { key: 'StudentShowChampion', label: 'Champion (show in proswimmers page)', type: 'checkbox' },
        { key: 'StudentShowWallofFame', label: 'Wall of Fame (show in WallofFame page)', type: 'checkbox' },
        { key: 'StudentShowSpecial', label: 'Show special (priority, show on top)', type: 'checkbox' },
        { key: 'StudentSpecialText', label: 'Special text', type: 'text' },
        { key: 'StudentNoBulkWA', label: 'No bulk WhatsApp', type: 'checkbox' },
        { key: 'StudentNoBulkEmail', label: 'No bulk email', type: 'checkbox' },
        { key: 'SendWelcomeEmail', label: 'Send Welcome Email (to email 1 and 2)', type: 'checkbox' },
      ],
    },
    {
      title: 'Health & Notes',
      fields: [
        { key: 'StudentDifficulty', label: 'Difficulty (special case)', type: 'checkbox' },
        { key: 'StudentDifficultyRemarks', label: 'Difficulty remarks', type: 'textarea' },
        { key: 'StudentVaccinated', label: 'Vaccinated', type: 'checkbox' },
        { key: 'StudentVaccinatedRemarks', label: 'Vaccination remarks', type: 'textarea' },
        { key: 'StudentNotes', label: 'Notes', type: 'textarea' },
      ],
    },
  ],
};

// The blood-type lookup isn't in the generic modules lookups endpoint; the
// student form falls back gracefully (dropdown just shows "-" until picked).

// ── Expense (ExpensesIndividual.aspx) ────────────────────────────────────────

const expense: RecordFormConfig = {
  title: 'Expense',
  listPath: '/expenses',
  slug: 'expense',
  idKey: 'ExpenseId',
  titleKey: 'ExpenseType',
  lookups: '/api/portal/modules/lookups',
  heroSlide: 3,
  createDefaults: {
    ExpensePaidCurrency: 'USD',
    ExpensePaidCurrencyRate: 1500,
    ExpenseType: 'Other',
    ExpenseCoachId: 0,
  },
  sections: [
    {
      title: 'Expense',
      fields: [
        { key: 'ExpenseSemesterId', label: 'Semester', type: 'select', optionsKey: 'semesters' },
        { key: 'ExpenseDate', label: 'Date', type: 'date' },
        { key: 'ExpensePaidAmount', label: 'Amount Paid', type: 'number' },
        { key: 'ExpensePaidCurrency', label: 'Currency', type: 'select', options: [
          { value: 'LBP', label: 'LBP' }, { value: 'USD', label: 'USD' },
        ] },
        { key: 'ExpensePaidCurrencyRate', label: 'USD to LBP Rate', type: 'number' },
        { key: 'ExpenseAmount', label: 'Amount (normalized)', type: 'number' },
        { key: 'ExpenseType', label: 'Type', type: 'select', options: [
          'Loan', 'Return/Refund', 'Tools', 'M.Sakr', 'Gr Pay By M.Sakr', 'Pr Pay By M.Sakr', 'Other',
        ].map((v) => ({ value: v, label: v })) },
        { key: 'ExpenseCoachId', label: 'Coach', type: 'select', optionsKey: 'coaches' },
        { key: 'ExpenseRemarks', label: 'Remarks', type: 'textarea' },
      ],
    },
  ],
};

// ── Private package type (PrivatePackagesSettingsIndividual.aspx) ────────────

const packType: RecordFormConfig = {
  title: 'Pack Type',
  listPath: '/pack-types',
  slug: 'pack-type',
  idKey: 'PrivatePackageId',
  titleKey: 'PrivatePackageName',
  lookups: '/api/portal/modules/lookups',
  heroSlide: 4,
  createDefaults: {
    PrivatePackageCurrency: 'LBP',
    PrivatePackageSessionsCount: 10,
    PrivatePackagePriceForOneStudent: 0,
    PrivatePackagePriceForTwoStudents: 0,
    PrivatePackagePriceForThreeStudents: 0,
    PrivatePackageActive: true,
  },
  // Legacy PrivatePackagesSettingsIndividual validators: name required,
  // sessions/prices ^[0-9]*$ (int.Parse on save, so blank is rejected too).
  validate: (f) => {
    if (!String(f.PrivatePackageName ?? '').trim()) return 'Package name is required.';
    const ints: [string, string][] = [
      ['PrivatePackageSessionsCount', 'Sessions'],
      ['PrivatePackagePriceForOneStudent', 'Price For One'],
      ['PrivatePackagePriceForTwoStudents', 'Price For Two'],
      ['PrivatePackagePriceForThreeStudents', 'Price For Three'],
    ];
    for (const [key, label] of ints) {
      const v = f[key];
      if (v === '' || v == null || !Number.isInteger(Number(v)) || Number(v) < 0)
        return `${label} must be a whole number.`;
    }
    return null;
  },
  sections: [
    {
      title: 'Package Type',
      fields: [
        // Location: defaults to ?locationId= from the list (else the user's own
        // location), locked for 'user' accounts, immutable once created.
        { key: 'PrivatePackageLocationId', label: 'Primary Location', type: 'select', optionsKey: 'locations',
          urlParam: 'locationId', defaultToUserLocation: true, lockedFor: ['user'], readOnlyOnEdit: true },
        { key: 'PrivatePackageName', label: 'Package Name', type: 'text' },
        { key: 'PrivatePackageCurrency', label: 'Currency', hint: 'fixed after create', type: 'select', readOnlyOnEdit: true, options: [
          { value: 'LBP', label: 'LBP' }, { value: 'USD', label: 'USD' },
        ] },
        { key: 'PrivatePackageSessionsCount', label: 'Sessions', type: 'number' },
        { key: 'PrivatePackagePriceForOneStudent', label: 'Price For One', type: 'number' },
        { key: 'PrivatePackagePriceForTwoStudents', label: 'Price For Two', type: 'number' },
        { key: 'PrivatePackagePriceForThreeStudents', label: 'Price For Three', type: 'number' },
        { key: 'PrivatePackageActive', label: 'Active', type: 'checkbox' },
      ],
    },
  ],
};

// ── Portal user (UsersIndividual.aspx) ───────────────────────────────────────

const portalUser: RecordFormConfig = {
  title: 'User',
  listPath: '/users',
  slug: 'user',
  idKey: 'UserID',
  titleKey: 'UserFullname',
  lookups: '/api/portal/modules/lookups',
  heroSlide: 1,
  createDefaults: {
    UserType: 'User',
    UserActive: true,
    UserExport: true,
    UserSaving: true,
    UserNotifications: true,
  },
  sections: [
    {
      title: 'Account',
      fields: [
        { key: 'UserFullname', label: 'Full Name', type: 'text' },
        { key: 'UserEmail', label: 'Email', type: 'text' },
        { key: 'UserPhoneNumber', label: 'Phone Number', type: 'text' },
        { key: 'UserType', label: 'User Type', type: 'select', options: [
          'SiteMaster', 'SuperUser', 'Payment/Audit', 'User', 'Guest',
        ].map((v) => ({ value: v, label: v })) },
        { key: 'UserPrimaryLocationId', label: 'Primary Location', type: 'select', optionsKey: 'locations' },
      ],
    },
    {
      title: 'Access Management',
      fields: [
        { key: 'UserActive', label: 'Active', type: 'checkbox' },
        { key: 'UserDeleted', label: 'Deleted', type: 'checkbox' },
        { key: 'UserExport', label: 'Exports', type: 'checkbox' },
        { key: 'UserSaving', label: 'Save / Edit', type: 'checkbox' },
        { key: 'UserNotifications', label: 'Notifications', type: 'checkbox' },
      ],
    },
  ],
};

// ── Timesheet (TimeSheetsIndividual.aspx) ────────────────────────────────────

// Value is the plain month number ("1".."12") to match the DB int column;
// label is the month name. (Padded "08" never matched the stored 8.)
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS = MONTH_NAMES.map((label, i) => ({ value: String(i + 1), label }));
const YEARS = Array.from({ length: 10 }, (_, i) => String(2019 + i))
  .map((v) => ({ value: v, label: v }));

const timesheet: RecordFormConfig = {
  title: 'Timesheet',
  listPath: '/payroll/timesheets',
  slug: 'timesheet',
  idKey: 'TimesheetID',
  titleKey: 'TimesheetStatus',
  heroSlide: 2,
  createDefaults: {
    TimesheetStatus: 'Open',
    TimesheetSalaryPercent: 100,
    TimeSheetCurrencyRate: 1500,
  },
  // On a new timesheet, carry the USD→LBP rate (and salary %) from the last one.
  createPrefill: '/api/portal/payroll/timesheet-defaults',
  sections: [
    {
      title: 'Timesheet',
      fields: [
        { key: 'TimesheetMonth', label: 'Month', type: 'select', options: MONTHS },
        { key: 'TimesheetYr', label: 'Year', type: 'select', options: YEARS },
        { key: 'TimesheetStartDate', label: 'Start Date', type: 'date' },
        { key: 'TimesheetEndDate', label: 'End Date', type: 'date' },
        { key: 'TimesheetStatus', label: 'Status', type: 'select', options: [
          { value: 'Open', label: 'Open' },
          { value: 'Closed', label: 'Closed' },
          { value: 'ClosedNoPayment', label: 'Closed. No Payment' },
        ] },
        { key: 'TimesheetSalaryPercent', label: 'Salary %', type: 'number' },
        { key: 'TimeSheetCurrencyRate', label: 'USD to LBP Rate', type: 'number' },
        { key: 'TimesheetRemarks', label: 'Remarks', type: 'textarea' },
      ],
    },
  ],
};

// ── Coach attendance (CoachsAttendancesIndividual.aspx) ──────────────────────

const ABSENT_TIMES = ['', '0-15', '15-30', '30-45', '1', '2', '3', '4', 'Day', '2Day', '3Day', '1Month']
  .map((v) => ({ value: v, label: v === '' ? 'On Time' : v }));
const DEDUCTS = ['', '1Hr', '2Hrs', '3Hrs', '4Hrs', '1Day', '2Day', '3Day', '1Month']
  .map((v) => ({ value: v, label: v === '' ? 'No Deduction' : v }));

const coachAttendanceForm: RecordFormConfig = {
  title: 'Coach Attendance',
  listPath: '/payroll/coach-attendance',
  slug: 'coach-attendance',
  idKey: 'Coaches_Attendance_ID',
  titleKey: 'CoachFullName',
  lookups: '/api/portal/payroll/attendance-lookups',
  heroSlide: 3,
  createDefaults: {
    Coaches_Attendance_ReasonID: 2,
    Coaches_Attendance_Absent: true,
  },
  sections: [
    {
      title: 'Attendance',
      fields: [
        { key: 'Coaches_Attendance_CoachID', label: 'Coach', type: 'select', optionsKey: 'coaches' },
        { key: 'Coaches_Attendance_Date', label: 'Date', type: 'date' },
        { key: 'Coaches_Attendance_ReasonID', label: 'Reason', type: 'select', optionsKey: 'reasons' },
        { key: 'Coaches_Attendance_Absent', label: 'Absent', type: 'checkbox' },
        { key: 'Coaches_Attendance_Late', label: 'Late', type: 'checkbox' },
        { key: 'Coaches_Attendance_EarlyLeave', label: 'Early Leave', type: 'checkbox' },
        { key: 'Coaches_Attendance_AbsentTime', label: 'Time Missed', type: 'select', options: ABSENT_TIMES },
        { key: 'Coaches_Attendance_AbsentDeduct', label: 'Deduction', type: 'select', options: DEDUCTS },
        { key: 'Coaches_Attendance_AbsentDeductReason', label: 'Deduction Reason', type: 'select', options: [
          { value: '', label: 'No Reason' }, { value: 'ByProswim', label: 'By ProSwim' }, { value: 'ByCoach', label: 'By Coach' },
        ] },
        { key: 'Coaches_Attendance_Approved', label: 'Approved', type: 'checkbox' },
        { key: 'Coaches_Attendance_Approvedby', label: 'Approved By', type: 'text' },
        { key: 'Coaches_Attendance_ApprovedManager', label: 'Manager Approved (SiteMaster only)', type: 'checkbox' },
        { key: 'Coaches_Attendance_Remarks', label: 'Remarks', type: 'textarea' },
      ],
    },
  ],
};

// ── Location ─────────────────────────────────────────────────────────────────

const location: RecordFormConfig = {
  title: 'Location',
  listPath: '/locations',
  slug: 'location',
  idKey: 'LocationId',
  titleKey: 'LocationNickName',
  createDefaults: { LocationActive: true },
  sections: [
    {
      title: 'Location',
      fields: [
        { key: 'LocationNickName', label: 'Nick Name', type: 'text' },
        { key: 'LocationFullName', label: 'Full Name', type: 'text' },
        { key: 'LocationCity', label: 'City', type: 'text' },
        { key: 'LocationColor', label: 'Color', type: 'text' },
        { key: 'LocationFullAddress', label: 'Full Address', type: 'textarea' },
        { key: 'LocationRemarks', label: 'Remarks', type: 'textarea' },
      ],
    },
    {
      title: 'Contact',
      fields: [
        { key: 'LocationContact', label: 'Contact', type: 'text' },
        { key: 'LocationContactPhone', label: 'Contact Phone', type: 'text' },
        { key: 'LocationPhone1', label: 'Phone 1', type: 'text' },
        { key: 'LocationPhone2', label: 'Phone 2', type: 'text' },
        { key: 'LocationInfoEmail', label: 'Info Email', type: 'text' },
        { key: 'LocationFax', label: 'Fax', type: 'text' },
        { key: 'LocationWebsiteText', label: 'Website Text', type: 'text' },
        { key: 'LocationWebsite', label: 'Website URL', type: 'text' },
      ],
    },
    {
      title: 'WhatsApp & Map',
      fields: [
        { key: 'LocationWAName', label: 'WhatsApp Name', type: 'text' },
        { key: 'LocationWAPhone', label: 'WhatsApp Phone', type: 'text' },
        { key: 'LocationXLAT', label: 'Map Latitude', type: 'text' },
        { key: 'LocationXLONG', label: 'Map Longitude', type: 'text' },
        { key: 'LocationMapURL', label: 'Map URL', type: 'text' },
        { key: 'LocationIcon', label: 'Icon', type: 'text' },
        { key: 'LocationWABulk', label: 'Bulk WhatsApp', type: 'checkbox' },
        { key: 'LocationWAAuto', label: 'Auto WhatsApp', type: 'checkbox' },
      ],
    },
    {
      title: 'Status',
      fields: [
        { key: 'LocationActive', label: 'Active', type: 'checkbox' },
        { key: 'LocationSchool', label: 'School', type: 'checkbox' },
        { key: 'LocationDeleted', label: 'Deleted', type: 'checkbox' },
      ],
    },
  ],
};

// ── Main Expense ─────────────────────────────────────────────────────────────

const mainExpense: RecordFormConfig = {
  title: 'Main Expense',
  listPath: '/main-expenses',
  slug: 'mainexpense',
  idKey: 'ExpenseId',
  titleKey: 'ExpenseType',
  lookups: LOOKUPS,
  createDefaults: { ExpensePaidCurrency: 'USD', ExpensePaidCurrencyRate: 1 },
  sections: [
    {
      title: 'Expense',
      fields: [
        { key: 'ExpenseLocationId', label: 'Location', type: 'select', optionsKey: 'locations' },
        { key: 'ExpenseType', label: 'Type', type: 'select', optionsKey: 'mainExpenseTypes' },
        { key: 'ExpenseDate', label: 'Date', type: 'date' },
        { key: 'ExpenseAmount', label: 'Amount', type: 'number' },
        { key: 'ExpensePaidAmount', label: 'Paid Amount', type: 'number' },
        { key: 'ExpensePaidCurrency', label: 'Currency', type: 'select', options: CURRENCY },
        { key: 'ExpensePaidCurrencyRate', label: 'USD to LBP Rate', type: 'number' },
        { key: 'ExpenseAutoRenew', label: 'Auto Renew', type: 'checkbox' },
        { key: 'ExpenseRemarks', label: 'Remarks', type: 'textarea' },
      ],
    },
  ],
};

// ── Group session (ClassesSessionsIndividual.aspx) ───────────────────────────

// Mirrors ClassesSessionsIndividual.aspx: Date (today) drives the Class list,
// the classes of the user's own location, current semester, on that weekday
// ("Coach - Day - Time"). Class is fixed once created (the update proc ignores
// it). The server refuses a second session of the same class on the same
// date: "Session For This Class and Date Already Exists".
const session: RecordFormConfig = {
  title: 'Session',
  listPath: '/sessions',
  slug: 'session',
  idKey: 'SessionId',
  titleKey: 'ClassName',
  heroSlide: 2,
  createDefaults: () => ({
    SessionDate: isoToday(),
    SessionStatus: 'Active',
    SessionRemarks: '',
  }),
  validate: (f) => (!f.SessionDate ? 'Date is required (dd/mm/yyyy).'
    : !Number(f.SessionClassId) ? 'Pick a class.' : null),
  sections: [
    {
      title: 'Session',
      fields: [
        { key: 'SessionDate', label: 'Date', type: 'date' },
        { key: 'SessionClassId', label: 'Class', type: 'select', readOnlyOnEdit: true, labelKey: 'ClassName',
          optionsFrom: { url: (f) => (f.SessionDate ? `/api/portal/edit/session-classes?date=${String(f.SessionDate)}` : null) } },
        { key: 'SessionStatus', label: 'Status', type: 'select', options: [
          'Active', 'Cancelled', 'Make-Up',
        ].map((v) => ({ value: v, label: v })) },
        { key: 'SessionRemarks', label: 'Remarks', type: 'textarea' },
      ],
    },
  ],
};

// Extra class / membership (ExtraClasssIndividual.aspx) is the bespoke
// ExtraClassForm.tsx (sessions grid, generate, renew).

export const SessionForm = () => <RecordFormPage config={session} />;
export const SemesterForm = () => <RecordFormPage config={semester} />;
export const CoachForm = () => <RecordFormPage config={coach} />;
export const ClassForm = () => <RecordFormPage config={klass} />;
export const StudentForm = () => <RecordFormPage config={student} />;
export const ExpenseForm = () => <RecordFormPage config={expense} />;
export const PackTypeForm = () => <RecordFormPage config={packType} />;
export const UserForm = () => <RecordFormPage config={portalUser} />;
export const TimesheetForm = () => <RecordFormPage config={timesheet} />;
export const CoachAttendanceForm = () => <RecordFormPage config={coachAttendanceForm} />;
export const LocationForm = () => <RecordFormPage config={location} />;
export const MainExpenseForm = () => <RecordFormPage config={mainExpense} />;

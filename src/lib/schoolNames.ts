// School master list (tbl_Schools) helpers shared by the SchoolPicker and the
// Schools admin page. Name rules mirror proswim-api Helpers/SchoolList.cs:
//  - capitals rule: first letter of every word and every hyphen part upper
//    case, the rest lower case ("Grand Lycee Franco-Libanais");
//  - junk guard: fewer than 3 letters, one repeated letter, or a placeholder
//    word (n/a, none, unknown, test...).
// Plus a client-only "did you mean" guard for near-duplicates.

import { apiRequest } from '../api/portalApi';

export interface School { schoolId: number; schoolName: string; active: boolean; students?: number }

export const JUNK_MESSAGE = 'Please type the real school name, or choose Unknown.';

// ── Active list, loaded once per page load and shared by every picker ────────

let cache: Promise<School[]> | null = null;

export function loadSchools(force = false): Promise<School[]> {
  if (!cache || force) {
    cache = apiRequest<School[]>('/api/portal/schools')
      .then((r) => (Array.isArray(r) ? r : []))
      .catch((e) => { cache = null; throw e; });
  }
  return cache;
}

/** Put a just-added school into the shared list (kept sorted by name). */
export function rememberSchool(s: School): void {
  if (!cache) return;
  cache = cache.then((list) => (list.some((x) => x.schoolId === s.schoolId)
    ? list
    : [...list, s].sort((a, b) => a.schoolName.localeCompare(b.schoolName))));
}

// ── Name rules ───────────────────────────────────────────────────────────────

export const cleanName = (s: string) => s.trim().replace(/\s+/g, ' ');

function capPart(p: string): string {
  const chars = Array.from(p.toLowerCase());
  for (let i = 0; i < chars.length; i++) {
    if (/\p{L}/u.test(chars[i])) { chars[i] = chars[i].toUpperCase(); break; }
    if (/\p{N}/u.test(chars[i])) break;
  }
  return chars.join('');
}

/** Capitals rule (see file header). A part starting with a digit stays as is. */
export function capitalizeSchoolName(raw: string): string {
  const s = cleanName(raw);
  if (!s) return '';
  return s.split(' ').map((w) => w.split('-').map(capPart).join('-')).join(' ');
}

/** Lower case, no accents, punctuation → single spaces. */
export function normalizeName(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const PLACEHOLDERS = new Set([
  'n a', 'na', 'none', 'nil', 'null', 'unknown', 'unknow', 'unkown', 'other', 'others',
  'no school', 'noschool', 'no', 'nothing', 'x', 'xx', 'xxx', 'test', 'testing', 'tbd',
  'school', 'college', 'not applicable', 'not available', 'no name', 'idk', 'dont know',
  'don t know', 'i dont know', 'i don t know', 'nope', 'empty', 'blank', 'asdf', 'qwerty',
  'abc', 'abcd', 'xyz',
]);

/** True when the name is not a real school name. */
export function isJunkSchoolName(raw: string): boolean {
  const letters = Array.from(cleanName(raw).toLowerCase()).filter((c) => /\p{L}/u.test(c));
  if (letters.length < 3) return true;                  // also "only digits / punctuation"
  if (new Set(letters).size === 1) return true;         // aaaa, gggg
  return PLACEHOLDERS.has(normalizeName(raw));
}

const exactKey = (s: string) => cleanName(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const exactCache = new WeakMap<School, string>();
function exactOf(s: School): string {
  let k = exactCache.get(s);
  if (k === undefined) { k = exactKey(s.schoolName); exactCache.set(s, k); }
  return k;
}

/** Exact match ignoring case, accents and extra spaces ("lycée  verdun" =
 *  "Lycee Verdun"), the same comparison the API uses (CI_AI collation). */
export function findExactSchool(name: string, list: School[]): School | undefined {
  const k = exactKey(name);
  return k ? list.find((s) => exactOf(s) === k) : undefined;
}

// ── "Did you mean" guard ─────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'school', 'schools', 'college', 'lycee', 'high', 'the', 'de', 'des', 'du', 'la', 'le', 'les',
  'el', 'al', 'ecole', 'of',
]);

// Normalised forms of the list's names, computed once per school object.
const normCache = new WeakMap<School, string>();
function normOf(s: School): string {
  let n = normCache.get(s);
  if (n === undefined) { n = normalizeName(s.schoolName); normCache.set(s, n); }
  return n;
}

/** Compact keys: all words, and without the generic words (falls back to all). */
function keys(normalized: string): { full: string; core: string } {
  const full = normalized.replace(/ /g, '');
  const core = normalized.split(' ').filter((w) => w && !STOP_WORDS.has(w)).join('');
  return { full, core: core || full };
}

/** Levenshtein similarity 1 − distance / longer length. */
function levRatio(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (!max) return 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[b.length] / max;
}

/** Consonant skeleton: transliterated Arabic names mostly differ in vowels and
 *  doubled letters (Zahret/Zahrat, Ehsan/Ihsan, Hassan/Hasan). */
function skeleton(k: string): string {
  return k.replace(/[aeiouy]/g, '').replace(/(.)\1+/g, '$1');
}

/** Closest existing school when `name` looks like it: the same name ignoring
 *  case, accents, punctuation, spacing and words like school/college/lycee/
 *  high/the/de/el/al; the same consonants (vowel spellings differ); or a
 *  Levenshtein similarity ≥ 0.82 (with or without those words). Else null.
 *  Only drives the "Did you mean …?" prompt, so a near miss costs one click. */
export function findSimilarSchool(name: string, list: School[]): School | null {
  const k = keys(normalizeName(name));
  if (!k.full) return null;
  const kSkel = skeleton(k.core);
  let best: School | null = null;
  let bestScore = 0;
  for (const s of list) {
    const sk = keys(normOf(s));
    const score = sk.core === k.core ? 1
      : kSkel.length >= 4 && skeleton(sk.core) === kSkel ? 0.95
      : Math.max(levRatio(k.core, sk.core), levRatio(k.full, sk.full));
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return bestScore >= 0.82 ? best : null;
}

/** Search filter: every typed word must appear in the (normalised) name;
 *  names starting with the query come first. */
export function filterSchools(query: string, list: School[]): School[] {
  const q = normalizeName(query);
  if (!q) return list;
  const words = q.split(' ');
  const hits: { s: School; first: number }[] = [];
  for (const s of list) {
    const n = normOf(s);
    if (words.every((w) => n.includes(w))) hits.push({ s, first: n.startsWith(q) ? 0 : 1 });
  }
  hits.sort((a, b) => a.first - b.first || a.s.schoolName.localeCompare(b.s.schoolName));
  return hits.map((h) => h.s);
}

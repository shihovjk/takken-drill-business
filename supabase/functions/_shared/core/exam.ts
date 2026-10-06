// Exam constants and the pass-pace diagnosis, ported from takken-drill.com (prototype/app.js).
// Pure TypeScript with no imports, so both the Vite app and Supabase Edge Functions (Deno) can use it.

export type CategoryId = "gyoho" | "kenri" | "seigen" | "zei";

export const CATEGORIES: { id: CategoryId; ja: string; en: string }[] = [
  { id: "gyoho", ja: "宅建業法", en: "Real Estate Brokerage Act" },
  { id: "kenri", ja: "権利関係", en: "Civil Law & Rights" },
  { id: "seigen", ja: "法令上の制限", en: "Land Use Regulations" },
  { id: "zei", ja: "税・その他", en: "Taxes & Other" },
];

// Points per category on the real exam (the 5 exempt questions are counted in "zei")
export const EXAM_POINTS: Record<CategoryId, number> = { gyoho: 20, kenri: 14, seigen: 8, zei: 8 };
// Target accuracy (%) per category by exam day
export const TARGET: Record<CategoryId, number> = { gyoho: 90, kenri: 60, seigen: 75, zei: 75 };
// Share of the target expected at each phase (days left until the exam)
export const PHASE_FACTOR = [
  { upTo: 30, ja: "直前期", en: "Final sprint", f: 1.0 },
  { upTo: 90, ja: "仕上げ期", en: "Polishing", f: 0.95 },
  { upTo: 150, ja: "演習期", en: "Practice", f: 0.85 },
  { upTo: Infinity, ja: "基礎期", en: "Foundations", f: 0.75 },
];
export const PASS_SCORE = 37; // passing line is 35-38 points most years; a small margin on top
export const SEC_PER_Q = 120; // 50 questions in 120 minutes leaves review time at 2 min/question
export const FAST_SEC = 10; // a 4-choice question answered faster than this was not really read

const DAY = 86_400_000;
const jstKey = (t: number) => new Date(t + 9 * 3_600_000).toISOString().slice(0, 10);

// Exam day: third Sunday of October (JST)
export function examDateFor(year: number): string {
  const first = 1 + ((7 - new Date(Date.UTC(year, 9, 1)).getUTCDay()) % 7);
  return `${year}-10-${String(first + 14).padStart(2, "0")}`;
}
export function nextExamDate(now = Date.now()): string {
  const y = Number(jstKey(now).slice(0, 4));
  return new Date(`${examDateFor(y)}T23:59:59+09:00`).getTime() < now ? examDateFor(y + 1) : examDateFor(y);
}
export function daysLeft(exam: string, now = Date.now()): number {
  const today = new Date(`${jstKey(now)}T00:00:00+09:00`).getTime();
  return Math.max(0, Math.round((new Date(`${exam}T00:00:00+09:00`).getTime() - today) / DAY));
}
export const phaseOf = (left: number) => PHASE_FACTOR.find((p) => left <= p.upTo)!;

export type CatStat = { right: number; wrong: number };
export type PaceRow = { id: CategoryId; acc: number | null; need: number; status: "none" | "ok" | "warn" | "ng" };

// Compare each category's accuracy with what this phase needs, and predict the score
export function paceDiagnosis(cats: Partial<Record<CategoryId, CatStat>>, left: number) {
  const ph = phaseOf(left);
  let predicted = 0, answered = 0;
  const rows: PaceRow[] = CATEGORIES.map(({ id }) => {
    const s = cats[id] || { right: 0, wrong: 0 };
    const n = s.right + s.wrong;
    const acc = n ? Math.round((s.right / n) * 100) : null;
    const need = Math.round(TARGET[id] * ph.f);
    if (acc !== null) { predicted += (EXAM_POINTS[id] * acc) / 100; answered++; }
    const status = acc === null ? "none" : acc >= need ? "ok" : acc >= need - 10 ? "warn" : "ng";
    return { id, acc, need, status };
  });
  const score = Math.round(predicted);
  return { phase: ph, rows, score: answered ? score : null, gap: PASS_SCORE - score };
}

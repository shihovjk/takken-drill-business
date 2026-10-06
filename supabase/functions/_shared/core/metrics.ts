// Accuracy and answer-speed figures computed from the per-answer log. These numbers are the only
// input the AI uses to judge study effort, and the admin grid shows them as they are.
import { CATEGORIES, type CategoryId, FAST_SEC, SEC_PER_Q, paceDiagnosis } from "./exam.ts";

export type Attempt = {
  question_id: string;
  category: CategoryId;
  correct: boolean;
  ms: number | null; // time spent on the question (null in mock exams)
  answered_at: string; // ISO timestamp
  mode?: "four" | "ox" | "mock"; // 4-choice drill (default) / one true-false statement / mock exam
};

export type Slice = { n: number; accuracy: number | null; medianSec: number | null; fastShare: number | null };
export type Week = Slice & { weekStart: string; minutes: number };
export type Metrics = Slice & {
  minutes: number;
  studyDays: number;
  byCategory: Record<CategoryId, Slice>;
  weeks: Week[]; // oldest first
  predictedScore: number | null;
};

const DAY = 86_400_000;
const WEEK = 7 * DAY;
// Time left idle on a question should not count as study: cap each answer at 5x the exam pace.
// Mock exam questions have no own timer: count them at exam pace.
const capSec = (a: Attempt) => (a.ms == null ? SEC_PER_Q : Math.min(a.ms / 1000, SEC_PER_Q * 5));
// Speed is compared with the 4-choice exam pace, so only timed 4-choice answers count for it;
// true/false statements (50% by chance) are left out of accuracy too.
const isFour = (a: Attempt) => (a.mode ?? "four") === "four" && a.ms != null;
const scored = (a: Attempt) => a.mode !== "ox";
const jstDay = (t: number) => new Date(t + 9 * 3_600_000).toISOString().slice(0, 10);
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
}

function slice(list: Attempt[]): Slice {
  const graded = list.filter(scored);
  const secs = list.filter(isFour).map((a) => a.ms! / 1000);
  return {
    n: list.length,
    accuracy: pct(graded.filter((a) => a.correct).length, graded.length),
    medianSec: median(secs),
    fastShare: pct(secs.filter((s) => s < FAST_SEC).length, secs.length),
  };
}

const minutesOf = (list: Attempt[]) => Math.round(list.reduce((s, a) => s + capSec(a), 0) / 60);

// weeks: how many 7-day windows to return, counting back from asOf
export function computeMetrics(attempts: Attempt[], asOf = Date.now(), weeks = 8): Metrics {
  const byCategory = Object.fromEntries(
    CATEGORIES.map(({ id }) => [id, slice(attempts.filter((a) => a.category === id))]),
  ) as Record<CategoryId, Slice>;

  const weekList: Week[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const end = asOf - i * WEEK, start = end - WEEK;
    const inWeek = attempts.filter((a) => { const t = Date.parse(a.answered_at); return t > start && t <= end; });
    weekList.push({ weekStart: jstDay(start + 1), minutes: minutesOf(inWeek), ...slice(inWeek) });
  }

  const cats = Object.fromEntries(CATEGORIES.map(({ id }) => {
    const list = attempts.filter((a) => a.category === id && scored(a));
    const right = list.filter((a) => a.correct).length;
    return [id, { right, wrong: list.length - right }];
  }));

  return {
    ...slice(attempts),
    minutes: minutesOf(attempts),
    studyDays: new Set(attempts.map((a) => jstDay(Date.parse(a.answered_at)))).size,
    byCategory,
    weeks: weekList,
    // Days-left does not change the predicted score, only the per-phase targets
    predictedScore: paceDiagnosis(cats, 999).score,
  };
}

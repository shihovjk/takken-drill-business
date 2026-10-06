// Plain checks on the accuracy/speed figures. They are given to the AI as facts, and the server
// uses them to keep the AI's flags and recommendation consistent with the company rules.
// The AI still judges effort and pass chance and explains the pattern in words.
import type { AwardRules } from "./award.ts";
import type { Metrics } from "./metrics.ts";

export type Signals = {
  meets_min_minutes: boolean;
  too_fast_for_accuracy: boolean; // high accuracy at a pace too fast to read the question (fastShare = answers under FAST_SEC)
  guessing: boolean; // near-random accuracy at a fast pace
  last_minute_spike: boolean; // latest week outweighs the 7 weeks before
  inconsistent: boolean; // weekly accuracy swings a lot
  category_gap: boolean; // one category far behind the others
};
export type FlagCode = Exclude<keyof Signals, "meets_min_minutes"> | "low_volume";

export function signals(m: Metrics, rules: AwardRules): Signals {
  const acc = m.accuracy ?? 0, med = m.medianSec ?? Infinity, fast = m.fastShare ?? 0;
  const last = m.weeks[m.weeks.length - 1];
  const before = m.weeks.slice(0, -1).reduce((s, w) => s + w.minutes, 0);
  const weekly = m.weeks.filter((w) => w.n >= 20 && w.accuracy != null).map((w) => w.accuracy!);
  const cats = Object.values(m.byCategory).filter((c) => c.n >= 20 && c.accuracy != null).map((c) => c.accuracy!);
  return {
    meets_min_minutes: m.minutes >= rules.minMinutes,
    too_fast_for_accuracy: acc >= 70 && (med < 20 || fast > 30),
    guessing: acc < 45 && med < 20,
    last_minute_spike: !!last && last.minutes > 60 && last.minutes > before,
    inconsistent: weekly.length >= 3 && Math.max(...weekly) - Math.min(...weekly) >= 30,
    category_gap: cats.length >= 2 && Math.max(...cats) - Math.min(...cats) >= 25,
  };
}

const PATTERN: FlagCode[] = ["too_fast_for_accuracy", "guessing", "last_minute_spike"];

// Keep only flags whose condition really holds, and make the recommendation follow the rules:
// below the minimum time -> self_pay; minimum met but a suspicious pattern -> at least follow_up;
// no suspicious pattern -> no follow_up (uneven weeks or one weak category alone are coaching notes).
export function reconcile<F extends { code: string }>(
  rec: "pay" | "follow_up" | "self_pay", flags: F[], s: Signals,
): { recommendation: "pay" | "follow_up" | "self_pay"; flags: F[] } {
  const holds = (code: string) => (code === "low_volume" ? !s.meets_min_minutes : !!s[code as keyof Signals]);
  const kept = flags.filter((f) => holds(f.code));
  if (!s.meets_min_minutes) return { recommendation: "self_pay", flags: kept };
  const suspicious = PATTERN.some((c) => s[c as keyof Signals]);
  if (rec === "self_pay" || (rec === "pay" && suspicious)) return { recommendation: "follow_up", flags: kept };
  if (rec === "follow_up" && !suspicious) return { recommendation: "pay", flags: kept };
  return { recommendation: rec, flags: kept };
}

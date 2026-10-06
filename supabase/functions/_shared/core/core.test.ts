import { describe, expect, it } from "vitest";
import { clampAward, DEFAULT_RULES } from "./award.ts";
import { daysLeft, examDateFor, paceDiagnosis } from "./exam.ts";
import { type Attempt, computeMetrics } from "./metrics.ts";

const NOW = Date.parse("2026-10-04T12:00:00+09:00");
const at = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString();

describe("exam", () => {
  it("exam day is the third Sunday of October", () => {
    expect(examDateFor(2026)).toBe("2026-10-18");
    expect(examDateFor(2025)).toBe("2025-10-19");
    expect(daysLeft("2026-10-18", NOW)).toBe(14);
  });
  it("predicts the score from category accuracy x exam points", () => {
    const d = paceDiagnosis({ gyoho: { right: 18, wrong: 2 }, kenri: { right: 7, wrong: 7 }, seigen: { right: 6, wrong: 2 }, zei: { right: 6, wrong: 2 } }, 14);
    expect(d.score).toBe(18 + 7 + 6 + 6);
  });
});

describe("metrics", () => {
  // Memorizer: 88% right but 9 seconds per question
  const memorizer: Attempt[] = Array.from({ length: 100 }, (_, i) => ({
    question_id: `q${i % 50}`, category: "gyoho", correct: i % 25 >= 3, ms: 9000, answered_at: at(i % 20),
  }));
  it("reports accuracy, median speed and the share of too-fast answers", () => {
    const m = computeMetrics(memorizer, NOW);
    expect(m.accuracy).toBe(88);
    expect(m.medianSec).toBe(9);
    expect(m.fastShare).toBe(100);
    expect(m.byCategory.gyoho.n).toBe(100);
    expect(m.byCategory.kenri.n).toBe(0);
    expect(m.weeks).toHaveLength(8);
    expect(m.weeks.reduce((s, w) => s + w.n, 0)).toBe(100);
    expect(m.studyDays).toBe(20);
  });
  it("keeps true/false answers out of 4-choice speed and accuracy", () => {
    const mixed: Attempt[] = [
      { question_id: "a", category: "gyoho", correct: true, ms: 90_000, answered_at: at(1) },
      { question_id: "b", category: "gyoho", correct: false, ms: 5_000, answered_at: at(1), mode: "ox" },
      { question_id: "c", category: "gyoho", correct: true, ms: null, answered_at: at(1), mode: "mock" },
    ];
    const m = computeMetrics(mixed, NOW);
    expect(m.medianSec).toBe(90);
    expect(m.fastShare).toBe(0);
    expect(m.accuracy).toBe(100);
    expect(m.n).toBe(3);
    expect(m.minutes).toBe(Math.round((90 + 5 + 120) / 60));
  });
  it("caps idle time when counting study minutes", () => {
    const idle: Attempt[] = [{ question_id: "a", category: "zei", correct: true, ms: 3_600_000, answered_at: at(1) }];
    expect(computeMetrics(idle, NOW).minutes).toBe(10);
  });
});

describe("award", () => {
  it("never pays more than the rules allow, and no bonus before passing", () => {
    expect(clampAward({ examFee: 99999, passBonus: 99999 }, DEFAULT_RULES, null)).toEqual({ examFee: 8200, passBonus: 0 });
    expect(clampAward({ examFee: -5, passBonus: 50000 }, DEFAULT_RULES, true)).toEqual({ examFee: 0, passBonus: 30000 });
    const onlyPassed = { ...DEFAULT_RULES, examFeeOnlyIfPassed: true };
    expect(clampAward({ examFee: 8200, passBonus: 30000 }, onlyPassed, null)).toEqual({ examFee: 0, passBonus: 0 });
    expect(clampAward({ examFee: 8200, passBonus: 30000 }, onlyPassed, true)).toEqual({ examFee: 8200, passBonus: 30000 });
  });
});

import { reconcile, signals } from "./signals.ts";

describe("signals", () => {
  const base = computeMetrics([], NOW);
  it("keeps the recommendation within the rules", () => {
    const s = { ...signals(base, DEFAULT_RULES), meets_min_minutes: true, too_fast_for_accuracy: true };
    expect(reconcile("self_pay", [{ code: "guessing" }, { code: "too_fast_for_accuracy" }], s)).toEqual({ recommendation: "follow_up", flags: [{ code: "too_fast_for_accuracy" }] });
    expect(reconcile("pay", [], s).recommendation).toBe("follow_up");
    expect(reconcile("follow_up", [{ code: "low_volume" }], { ...s, meets_min_minutes: false })).toEqual({ recommendation: "self_pay", flags: [{ code: "low_volume" }] });
    const steady = { ...s, too_fast_for_accuracy: false, inconsistent: true };
    expect(reconcile("follow_up", [{ code: "inconsistent" }], steady)).toEqual({ recommendation: "pay", flags: [{ code: "inconsistent" }] });
  });
});

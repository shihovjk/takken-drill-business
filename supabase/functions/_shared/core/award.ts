// Award rules set by the company, and the server-side guard that keeps an AI proposal within them.
// The AI suggests; this decides the ceiling. Approval and payout never trust the AI's number as-is.

export type AwardRules = {
  currency: string; // "JPY" (PayPal Payouts supports JPY without decimals)
  examFee: number; // exam fee reimbursed to employees who studied seriously
  examFeeOnlyIfPassed: boolean; // false: pass or fail / true: only employees who also passed
  passBonus: number; // bonus paid on passing
  minSeriousness: number; // 0-100: below this the exam fee is self-paid
  minMinutes: number; // minimum study time over the evaluation period
};

export const DEFAULT_RULES: AwardRules = {
  currency: "JPY",
  examFee: 8200,
  examFeeOnlyIfPassed: false,
  passBonus: 30000,
  minSeriousness: 60,
  minMinutes: 600,
};

export type AwardProposal = { examFee: number; passBonus: number };

// passed: null until results are out. The pass bonus (and the exam fee, when the company pays it
// only to those who passed) waits for the result.
export function clampAward(p: AwardProposal, rules: AwardRules, passed: boolean | null): AwardProposal {
  const fit = (v: number, max: number) => Math.max(0, Math.min(Math.round(Number(v) || 0), max));
  return {
    examFee: rules.examFeeOnlyIfPassed && !passed ? 0 : fit(p.examFee, rules.examFee),
    passBonus: passed ? fit(p.passBonus, rules.passBonus) : 0,
  };
}

// What a plain rule (study time only) would pay. Shown next to the AI proposal so the admin can see
// where the AI disagrees, e.g. lots of answers but each one answered in a few seconds.
export function ruleAward(minutes: number, rules: AwardRules, passed: boolean | null): AwardProposal {
  const studied = minutes >= rules.minMinutes && (!rules.examFeeOnlyIfPassed || !!passed);
  return { examFee: studied ? rules.examFee : 0, passBonus: passed ? rules.passBonus : 0 };
}

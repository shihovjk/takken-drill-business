// The AI part: Claude reads one employee's accuracy and speed figures and judges study effort,
// then writes a company-wide report. Called only from the admin's "Judge with AI" button.
//
// Secrets: ANTHROPIC_API_KEY. Optional AI_MODEL (default claude-haiku-4-5, the cheapest current model).
import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk@0.131.0/helpers/zod";
import { z } from "npm:zod@4.6.5";
import type { AwardRules } from "./core/award.ts";
import { CATEGORIES, FAST_SEC, PASS_SCORE, SEC_PER_Q } from "./core/exam.ts";
import type { Metrics } from "./core/metrics.ts";
import { reconcile, signals } from "./core/signals.ts";

export const MODEL = Deno.env.get("AI_MODEL") || "claude-haiku-4-5";
export const PROMPT_VERSION = "judge-v5"; // part of the cache key: bump when the prompt changes

const client = new Anthropic(); // reads ANTHROPIC_API_KEY

const FLAG_CODES = ["too_fast_for_accuracy", "guessing", "last_minute_spike", "low_volume", "inconsistent", "category_gap"] as const;

export const Judgement = z.object({
  seriousness: z.number().int().describe("0-100: how genuinely the employee is studying"),
  pass_probability: z.number().int().describe("0-100: chance of passing the exam at the current level"),
  flags: z.array(z.object({
    code: z.enum(FLAG_CODES),
    evidence_ja: z.string().describe("The specific numbers behind this flag, in Japanese"),
    evidence_en: z.string().describe("The same evidence in English"),
  })),
  recommendation: z.enum(["pay", "follow_up", "self_pay"]),
  proposed_exam_fee: z.number().int(),
  proposed_pass_bonus: z.number().int(),
  reason_ja: z.string().describe("3-6 sentences in Japanese, readable by both the admin and the employee"),
  reason_en: z.string(),
  one_liner_ja: z.string().describe("Under 20 Japanese characters"),
  one_liner_en: z.string().describe("Under 8 words"),
  follow_up_message_ja: z.string().describe("A short, kind message the admin can send to the employee in Japanese; empty if not needed"),
});
export type Judgement = z.infer<typeof Judgement>;

const JUDGE_SYSTEM = `You review study logs for employees of a Japanese real-estate company who are preparing for the Takken (宅地建物取引士) national exam.
The company pays the exam fee for employees who study genuinely (pass or fail) and a bonus for passing. Your judgement is a proposal: a person at the company approves every payment.

You receive only two kinds of evidence per answer, aggregated: whether it was correct, and how long it took. Judge the COMBINATION and the CHANGE over weeks, not either number alone:
- Exam pace is ${SEC_PER_Q} seconds per 4-choice question. Reading the question and four statements honestly takes roughly 60 seconds or more.
- High accuracy with very short times (median under ~20 s, many answers under ${FAST_SEC} s) suggests memorized answers to repeated questions, not understanding. The real exam uses unseen questions, so this accuracy overstates ability.
- Very short times with accuracy near 25% suggests clicking through without reading.
- A sudden jump in volume or speed right before the review (last week vs the 7 weeks before) suggests a last-minute push to look busy.
- Steady weekly study at a reasonable pace with flat or rising accuracy is genuine study, even if accuracy is still modest.
- Large differences between categories can be worth noting (category_gap).

The input includes "signals": checks already computed from the numbers. Treat them as facts.
Only use a flag whose signal is true (low_volume = meets_min_minutes is false). Explain what the true signals mean; do not invent others.

Flag definitions:
- too_fast_for_accuracy: accuracy 70% or higher with a median under 20 s, or more than 30% of answers under ${FAST_SEC} s.
- guessing: accuracy under 45% together with a median under 20 s.
- last_minute_spike: the latest week has more study minutes than the previous 7 weeks combined.
- low_volume: study_minutes is below rules.minMinutes. Do NOT use it when the minimum is met.
- inconsistent: weekly accuracy swings by 30 points or more between weeks with 20+ answers.
- category_gap: one category's accuracy is 25+ points below the others (with 20+ answers in it).

Recommendation:
- "pay": steady study at a believable pace and study_minutes meets rules.minMinutes. proposed_exam_fee = rules.examFee.
- "follow_up": the minimum study time is met, but too_fast_for_accuracy, guessing or last_minute_spike is true, so a person should talk with the employee before deciding. proposed_exam_fee = 0.
  inconsistent or category_gap alone are NOT reasons for follow_up: recommend "pay" and mention them as advice.
- "self_pay": study_minutes is below rules.minMinutes. proposed_exam_fee = 0.
- proposed_pass_bonus = the rule's pass bonus when the exam result is "passed", otherwise 0. Never exceed the rule amounts.
- If rules.examFeeOnlyIfPassed is true, the exam fee is paid only to employees who studied genuinely AND passed; still judge effort the same way.
- seriousness below the rule's minimum means no exam-fee support.

The predicted score uses accuracy per category times exam points (pass line about ${PASS_SCORE}/50); treat it as an upper bound when speed suggests memorization.
Category ids: ${CATEGORIES.map((c) => `${c.id} = ${c.ja} (${c.en})`).join(", ")}. Always use these names, never the ids.

Writing the reasons (both the admin and the employee read them):
- Neutral, factual description of the study pattern in polite Japanese (です・ます). Refer to the person as 「この方」 or not at all.
- No apologies, greetings, closing lines, or offers to answer questions. No 貴殿, 職員, 申し訳ございません.
- 3-5 sentences: what the numbers show, why that matters for the real exam, and what the recommendation is.
- Cite the actual numbers. Do not speculate about personal circumstances.
- reason_en is a natural English version of the same content.
- follow_up_message_ja: only for "follow_up"; 2-3 friendly sentences addressed to the employee with one concrete suggestion. Empty string otherwise.`;

export async function judge(input: { metrics: Metrics; rules: AwardRules; examResult: string; asOf: string }): Promise<Judgement> {
  const { metrics: m } = input;
  // Compact the figures; categories and weeks keep only what the judgement uses
  const sig = signals(m, input.rules);
  const payload = {
    as_of: input.asOf,
    exam_result: input.examResult,
    rules: input.rules,
    signals: sig,
    overall: { answers: m.n, accuracy_pct: m.accuracy, median_sec: m.medianSec, under_10s_pct: m.fastShare, study_minutes: m.minutes, study_days: m.studyDays, predicted_score: m.predictedScore },
    by_category: m.byCategory,
    weeks_oldest_first: m.weeks.map((w) => ({ week: w.weekStart, answers: w.n, minutes: w.minutes, accuracy_pct: w.accuracy, median_sec: w.medianSec, under_10s_pct: w.fastShare })),
  };
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: 2000,
    system: [{ type: "text", text: JUDGE_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `Judge this employee's study effort.\n\n${JSON.stringify(payload)}` }],
    output_config: { format: zodOutputFormat(Judgement) },
  });
  if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens" || !res.parsed_output) {
    throw new Error(`AI did not return a judgement (${res.stop_reason})`);
  }
  // The server, not the AI, has the last word on which checks hold and what the rules allow
  const j = res.parsed_output;
  const fixed = reconcile(j.recommendation, j.flags, sig);
  return { ...j, ...fixed, follow_up_message_ja: fixed.recommendation === "follow_up" ? j.follow_up_message_ja : "" };
}

export const Report = z.object({
  summary_ja: z.string().describe("4-6 sentences in Japanese for the company: overall trend and what to do"),
  summary_en: z.string(),
  follow_ups: z.array(z.object({
    ref: z.string().describe("The employee ref from the input"),
    reason_ja: z.string().describe("One sentence with the key numbers, Japanese"),
    reason_en: z.string(),
  })),
});
export type Report = z.infer<typeof Report>;

// people: pseudonymous refs only (no names leave the system)
export async function report(people: { ref: string; recommendation: string; seriousness: number; pass_probability: number; one_liner_en: string; flags: string[]; accuracy: number | null; median_sec: number | null; minutes: number }[]): Promise<Report> {
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: 3000,
    system: "You write a short report for the HR admin of a Japanese real-estate company about employees preparing for the Takken exam. You receive counts and per-employee AI judgements (accuracy, seconds per question, study minutes, flags). Summarize the overall picture and list every employee whose recommendation is follow_up (and only those), citing their numbers. Use the counts exactly as given. Write summary_ja in polite, plain Japanese (です・ます). Be factual and kind; do not speculate about personal circumstances.",
    messages: [{ role: "user", content: JSON.stringify({ counts: Object.fromEntries(["pay", "follow_up", "self_pay"].map((r) => [r, people.filter((p) => p.recommendation === r).length])), employees: people }) }],
    output_config: { format: zodOutputFormat(Report) },
  });
  if (!res.parsed_output) throw new Error(`AI did not return a report (${res.stop_reason})`);
  return res.parsed_output;
}

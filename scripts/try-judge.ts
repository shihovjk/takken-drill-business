// Runs the real AI judgement on the five demo personas, without Supabase or PayPal.
// Costs a few cents. Run from the repo root:
//   ANTHROPIC_API_KEY=... npx deno run --config supabase/functions/deno.json --allow-env --allow-net --allow-read scripts/try-judge.ts
import { judge, MODEL } from "../supabase/functions/_shared/ai.ts";
import { DEFAULT_RULES } from "../supabase/functions/_shared/core/award.ts";
import { computeMetrics } from "../supabase/functions/_shared/core/metrics.ts";

const demo = JSON.parse(await Deno.readTextFile(new URL("../src/data/demo.json", import.meta.url)));
const qs = JSON.parse(await Deno.readTextFile(new URL("../src/data/questions.json", import.meta.url)));
const now = Date.now();
const people = { e01: "memorizer", e02: "diligent", e03: "guesser", e05: "spike", e06: "low" };

console.log(`model: ${MODEL}\n`);
for (const [key, persona] of Object.entries(people)) {
  const m = demo.members.find((x: { key: string }) => x.key === key);
  const attempts = demo.attempts[key].map(([q, ok, ms, ago]: number[]) => ({
    question_id: qs[q].id, category: qs[q].category, correct: !!ok, ms, answered_at: new Date(now - ago * 60_000).toISOString(),
  }));
  const metrics = computeMetrics(attempts, now);
  const t = performance.now();
  const j = await judge({ metrics, rules: DEFAULT_RULES, examResult: m.examResult, asOf: new Date(now).toISOString() });
  console.log(`== ${key} (${persona}) acc ${metrics.accuracy}% / ${metrics.medianSec}s / ${metrics.minutes} min  [${Math.round(performance.now() - t)} ms]`);
  console.log(`   ${j.recommendation}  effort ${j.seriousness}  pass ${j.pass_probability}%  fee ${j.proposed_exam_fee} bonus ${j.proposed_pass_bonus}  flags: ${j.flags.map((f) => f.code).join(", ") || "-"}`);
  console.log(`   ${j.one_liner_en}\n   ${j.reason_ja}\n`);
}

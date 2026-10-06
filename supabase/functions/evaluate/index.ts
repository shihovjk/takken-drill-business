// "Judge with AI" (admin only). For each employee whose award is still open:
//   1. compute accuracy & speed figures from the answer log (same code as the browser)
//   2. reuse the stored judgement if the input is unchanged, otherwise ask Claude
//   3. clamp the proposed amounts to the company rules and save the award proposal
// Then write the company-wide report. Nothing is paid here; an admin approves each award.
import { judge, MODEL, PROMPT_VERSION, report, type Judgement } from "../_shared/ai.ts";
import { clampAward, DEFAULT_RULES, type AwardRules } from "../_shared/core/award.ts";
import { type Attempt, computeMetrics } from "../_shared/core/metrics.ts";
import { sha256 } from "../_shared/crypto.ts";
import { caller, HttpError, serve } from "../_shared/http.ts";

const OPEN = ["proposed", "follow_up", "self_pay"];
const DAILY_RUNS = Number(Deno.env.get("AI_DAILY_RUNS") ?? 20);
const PARALLEL = 5;
const WEEKS = 8;

serve(async (req, _body, db) => {
  const me = await caller(req, db, "admin");
  const { data: company } = await db.from("companies").select("rules, ai_enabled").eq("id", me.companyId).single();
  if (!company?.ai_enabled) throw new HttpError(403, "AI is not enabled for this company");
  const rules: AwardRules = { ...DEFAULT_RULES, ...company.rules };

  // Daily cap per company (keeps the public demo's API cost bounded)
  const day = new Date().toISOString().slice(0, 10);
  const { data: usage } = await db.from("ai_usage").select("runs").eq("company_id", me.companyId).eq("day", day).maybeSingle();
  if ((usage?.runs ?? 0) >= DAILY_RUNS) throw new HttpError(429, "daily AI limit reached");
  await db.from("ai_usage").upsert({ company_id: me.companyId, day, runs: (usage?.runs ?? 0) + 1 });

  // One award per employee per calendar year (study Jan-Oct, exam in October, awards Nov-Dec)
  const cycle = String(new Date(Date.now() + 9 * 3_600_000).getUTCFullYear());
  const [{ data: members }, { data: awards }] = await Promise.all([
    db.from("company_members").select("user_id, exam_result").eq("company_id", me.companyId).eq("role", "employee"),
    db.from("awards").select("user_id, status").eq("company_id", me.companyId).eq("cycle", cycle),
  ]);
  const closed = new Set((awards ?? []).filter((a) => !OPEN.includes(a.status)).map((a) => a.user_id));
  const todo = (members ?? []).filter((m) => !closed.has(m.user_id));

  const now = Date.now();
  const since = new Date(now - WEEKS * 7 * 86_400_000).toISOString();
  const results: { userId: string; ref: string; j: Judgement | null; m: ReturnType<typeof computeMetrics> }[] = [];

  async function one(m: { user_id: string; exam_result: string }, ref: string) {
    const attempts = await allAttempts(m.user_id, since);
    const metrics = computeMetrics(attempts, now, WEEKS);
    const hash = await sha256(JSON.stringify([PROMPT_VERSION, MODEL, rules, m.exam_result, metrics]));
    const { data: cached } = await db.from("evaluations").select("id, result").eq("company_id", me.companyId).eq("user_id", m.user_id).eq("input_hash", hash).not("result", "is", null).maybeSingle();
    let j: Judgement | null = cached?.result ?? null;
    let evalId = cached?.id as string | undefined;
    if (!j) {
      let error: string | null = null;
      try { j = await judge({ metrics, rules, examResult: m.exam_result, asOf: new Date(now).toISOString() }); } catch (e) { error = e instanceof Error ? e.message : String(e); }
      const { data: ev } = await db.from("evaluations").upsert({
        company_id: me.companyId, user_id: m.user_id, period_start: since, period_end: new Date(now).toISOString(),
        metrics, input_hash: hash, model: MODEL, result: j, error,
      }, { onConflict: "company_id,user_id,input_hash" }).select("id").single();
      evalId = ev?.id;
    }
    const passed = m.exam_result === "passed" ? true : m.exam_result === "failed" ? false : null;
    // If the AI failed, the award waits for a human ("follow_up") with no amount
    const a = j ? clampAward({ examFee: j.proposed_exam_fee, passBonus: j.proposed_pass_bonus }, rules, passed) : { examFee: 0, passBonus: 0 };
    if (j && j.seriousness < rules.minSeriousness) a.examFee = 0;
    // "pay" with nothing payable yet only because the exam result is pending stays a proposal, not self-pay
    const waiting = j?.recommendation === "pay" && passed === null && rules.examFeeOnlyIfPassed;
    const status = !j ? "follow_up" : j.recommendation === "follow_up" ? "follow_up" : a.examFee + a.passBonus > 0 || waiting ? "proposed" : "self_pay";
    await db.from("awards").upsert({
      company_id: me.companyId, user_id: m.user_id, cycle, evaluation_id: evalId,
      ai_exam_fee: a.examFee, ai_pass_bonus: a.passBonus, exam_fee: a.examFee, pass_bonus: a.passBonus, currency: rules.currency,
      status, edited_note: null, confirmed_by: null, confirmed_at: null,
      ai: j && { seriousness: j.seriousness, pass_probability: j.pass_probability, flags: j.flags, reason_ja: j.reason_ja, reason_en: j.reason_en, one_liner_ja: j.one_liner_ja, one_liner_en: j.one_liner_en, follow_up_message_ja: j.follow_up_message_ja, model: MODEL },
      updated_at: new Date().toISOString(),
    }, { onConflict: "company_id,user_id,cycle" });
    results.push({ userId: m.user_id, ref, j, m: metrics });
  }

  // A few at a time: fast enough for 25 people, gentle on rate limits
  const queue = todo.map((m, i) => [m, `E${String(i + 1).padStart(2, "0")}`] as const);
  await Promise.all(Array.from({ length: PARALLEL }, async () => { for (let x; (x = queue.shift());) await one(x[0], x[1]); }));

  // Company report: pseudonymous refs go to the AI, mapped back to user IDs here
  const judged = results.filter((r) => r.j);
  if (judged.length) {
    const refToUser = Object.fromEntries(judged.map((r) => [r.ref, r.userId]));
    const people = judged.map((r) => ({
      ref: r.ref, recommendation: r.j!.recommendation, seriousness: r.j!.seriousness, pass_probability: r.j!.pass_probability,
      one_liner_en: r.j!.one_liner_en, flags: r.j!.flags.map((f) => f.code), accuracy: r.m.accuracy, median_sec: r.m.medianSec, minutes: r.m.minutes,
    }));
    const hash = await sha256(JSON.stringify([PROMPT_VERSION, MODEL, people]));
    const { data: last } = await db.from("ai_reports").select("input_hash").eq("company_id", me.companyId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (last?.input_hash !== hash) {
      try {
        const r = await report(people);
        const body = { ...r, follow_ups: r.follow_ups.filter((f) => refToUser[f.ref]).map((f) => ({ user_id: refToUser[f.ref], reason_ja: f.reason_ja, reason_en: f.reason_en })) };
        await db.from("ai_reports").insert({ company_id: me.companyId, body, model: MODEL, input_hash: hash });
      } catch (e) { console.error("report failed", e); }
    }
  }
  return { judged: judged.length, failed: results.length - judged.length };

  // PostgREST returns at most 1000 rows per request; page through
  async function allAttempts(userId: string, from: string): Promise<Attempt[]> {
    const out: Attempt[] = [];
    for (let page = 0; ; page++) {
      const { data, error } = await db.from("attempts").select("question_id, category, correct, ms, mode, answered_at")
        .eq("company_id", me.companyId).eq("user_id", userId).gte("answered_at", from)
        .order("answered_at").range(page * 1000, page * 1000 + 999);
      if (error) throw error;
      out.push(...(data as Attempt[]));
      if (!data || data.length < 1000) return out;
    }
  }
});

// Everything the admin screen needs in one call: each employee's accuracy and speed figures
// (computed with the same shared code the AI judgement uses), award, and PayPal readiness.
import { type Attempt, computeMetrics } from "../_shared/core/metrics.ts";
import { caller, serve } from "../_shared/http.ts";

const WEEKS = 8;

serve(async (req, _body, db) => {
  const me = await caller(req, db, "admin");
  const cycle = String(new Date(Date.now() + 9 * 3_600_000).getUTCFullYear());
  const since = new Date(Date.now() - WEEKS * 7 * 86_400_000).toISOString();

  const [{ data: members }, { data: awards }, { data: report }, { data: batches }] = await Promise.all([
    db.from("company_members").select("user_id, display_name, department, exam_result").eq("company_id", me.companyId).eq("role", "employee").order("joined_at"),
    db.from("awards").select("*").eq("company_id", me.companyId).eq("cycle", cycle),
    db.from("ai_reports").select("body, model, created_at").eq("company_id", me.companyId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("payout_batches").select("id, created_at, total, currency, provider, status, payout_items(count)").eq("company_id", me.companyId).order("created_at", { ascending: false }).limit(50),
  ]);
  const userIds = (members ?? []).map((m) => m.user_id);
  const { data: payees } = await db.from("payees").select("user_id").in("user_id", userIds).not("verified_at", "is", null);

  // All answers in the window, paged (PostgREST returns 1000 rows at a time)
  const attempts: (Attempt & { user_id: string })[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await db.from("attempts").select("user_id, question_id, category, correct, ms, mode, answered_at")
      .eq("company_id", me.companyId).gte("answered_at", since).order("id").range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    attempts.push(...(data as typeof attempts));
    if (!data || data.length < 1000) break;
  }
  const byUser = new Map<string, Attempt[]>();
  for (const a of attempts) (byUser.get(a.user_id) ?? byUser.set(a.user_id, []).get(a.user_id)!).push(a);

  const award = new Map((awards ?? []).map((a) => [a.user_id, a]));
  const ready = new Set((payees ?? []).map((p) => p.user_id));
  return {
    rows: (members ?? []).map((m) => ({
      userId: m.user_id, name: m.display_name, dept: m.department ?? "", examResult: m.exam_result,
      payeeReady: ready.has(m.user_id), metrics: computeMetrics(byUser.get(m.user_id) ?? [], Date.now(), WEEKS),
      award: award.get(m.user_id) ?? null,
    })),
    report: report && { ...report.body, createdAt: report.created_at, model: report.model },
    payouts: (batches ?? []).map((b) => ({ id: b.id, at: b.created_at, total: b.total, currency: b.currency, provider: b.provider, status: b.status, count: (b.payout_items as unknown as { count: number }[])[0]?.count ?? 0 })),
  };
});

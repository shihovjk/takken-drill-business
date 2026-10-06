// Loads the demo company into Supabase (called by `node scripts/seed.ts --supabase`).
// Safe to run again: it updates the same company and users and replaces their study logs.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEMO_PASSWORD (shared by all demo accounts),
//      DEMO_PAYEE_EMAIL (optional: a PayPal *sandbox personal* account that receives the demo payouts)
import { createClient } from "@supabase/supabase-js";
import { clampAward } from "../supabase/functions/_shared/core/award.ts";
import type { Attempt } from "../supabase/functions/_shared/core/metrics.ts";

const DOMAIN = "demo.takken-drill.com";
export const emailFor = (key: string) => (key === "admin" ? `admin@${DOMAIN}` : `${key}@${DOMAIN}`);

type Out = {
  company: { name: string; rules: Record<string, unknown> & { currency: string; examFee: number; passBonus: number } };
  members: { key: string; name: string; dept: string; role: "admin" | "employee"; examResult: string; paidLastCycle?: boolean; payee?: boolean }[];
  attempts: Record<string, [number, number, number, number][]>;
  samples: Record<string, { proposed_award: { examFee: number; passBonus: number }; [k: string]: unknown }>;
};

export async function loadIntoSupabase(out: Out, toAttempts: (rows: Out["attempts"][string]) => Attempt[]) {
  const env = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`${k} is not set`); return v; };
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const password = env("DEMO_PASSWORD");
  // Optional until the PayPal sandbox is set up; payouts need a real sandbox personal account
  const payeeEmail = process.env.DEMO_PAYEE_EMAIL || "sandbox-payee@example.com";
  const must = <T>(r: { data: T; error: { message: string } | null }) => { if (r.error) throw new Error(r.error.message); return r.data; };

  // Company
  const existing = must(await db.from("companies").select("id").eq("name", out.company.name).maybeSingle()) as { id: string } | null;
  const companyId = existing?.id ?? (must(await db.from("companies").insert({ name: out.company.name }).select("id").single()) as { id: string }).id;
  must(await db.from("companies").update({ rules: out.company.rules, is_demo: true, ai_enabled: true, payout_provider: "paypal_payouts" }).eq("id", companyId));
  console.log("company", companyId);

  // Users (created already confirmed, all with the demo password)
  const users = new Map<string, string>();
  for (let page = 1; ; page++) {
    const { data } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    data.users.forEach((u) => u.email && users.set(u.email, u.id));
    if (data.users.length < 1000) break;
  }
  const idOf: Record<string, string> = {};
  for (const m of out.members) {
    const email = emailFor(m.key);
    let id = users.get(email);
    if (id) await db.auth.admin.updateUserById(id, { password });
    else id = (await db.auth.admin.createUser({ email, password, email_confirm: true })).data.user!.id;
    idOf[m.key] = id;
  }

  // Memberships, consent, PayPal receivers. Suzuki (e02) consents and registers PayPal during the demo.
  must(await db.from("company_members").upsert(out.members.map((m) => ({
    company_id: companyId, user_id: idOf[m.key], role: m.role, display_name: m.name, department: m.dept, exam_result: m.examResult,
  }))));
  const employees = out.members.filter((m) => m.role === "employee");
  must(await db.from("consents").delete().eq("company_id", companyId));
  must(await db.from("consents").insert(employees.filter((m) => m.key !== "e02").map((m) => ({ company_id: companyId, user_id: idOf[m.key], version: "2026-10" }))));
  must(await db.from("payees").delete().in("user_id", employees.map((m) => idOf[m.key])));
  must(await db.from("payees").insert(employees.filter((m) => m.payee && m.key !== "e02").map((m) => ({
    user_id: idOf[m.key], paypal_email: payeeEmail, verified_at: new Date().toISOString(),
  }))));

  // Study logs
  must(await db.from("attempts").delete().eq("company_id", companyId));
  const rows = employees.flatMap((m) => toAttempts(out.attempts[m.key]).map((a) => ({ ...a, company_id: companyId, user_id: idOf[m.key], choice: 0 })));
  for (let i = 0; i < rows.length; i += 1000) must(await db.from("attempts").insert(rows.slice(i, i + 1000)));
  console.log("attempts", rows.length);

  // Start clean, then add the awards paid earlier this year (marked 'seed' so demo_reset keeps them)
  must(await db.from("payout_items").delete().in("award_id", (must(await db.from("awards").select("id").eq("company_id", companyId)) as { id: string }[]).map((a) => a.id)));
  must(await db.from("payout_batches").delete().eq("company_id", companyId));
  must(await db.from("awards").delete().eq("company_id", companyId));
  must(await db.from("ai_reports").delete().eq("company_id", companyId));
  const early = employees.filter((m) => m.paidLastCycle);
  const paidAt = new Date(Date.now() - 9 * 86_400_000).toISOString();
  const cycle = String(new Date().getFullYear());
  const awards = must(await db.from("awards").insert(early.map((m) => {
    const s = out.samples[m.key];
    const a = clampAward(s.proposed_award, out.company.rules as never, m.examResult === "passed");
    return {
      company_id: companyId, user_id: idOf[m.key], cycle, ai_exam_fee: a.examFee, ai_pass_bonus: a.passBonus, exam_fee: a.examFee, pass_bonus: a.passBonus,
      currency: "JPY", status: "paid", provider: "seed", confirmed_by: idOf.admin, confirmed_at: paidAt, paid_at: paidAt,
      ai: { ...s, model: "sample" },
    };
  })).select("id, exam_fee, pass_bonus")) as { id: string; exam_fee: number; pass_bonus: number }[];
  const batch = must(await db.from("payout_batches").insert({
    company_id: companyId, provider: "paypal_payouts", sender_batch_id: "seed-1", status: "SUCCESS", created_at: paidAt,
    total: awards.reduce((s, a) => s + a.exam_fee + a.pass_bonus, 0), currency: "JPY", created_by: idOf.admin,
  }).select("id").single()) as { id: string };
  must(await db.from("payout_items").insert(awards.map((a) => ({ batch_id: batch.id, award_id: a.id, amount: a.exam_fee + a.pass_bonus, status: "SUCCESS" }))));

  console.log(`\nDemo logins (password: DEMO_PASSWORD)\n  admin:      ${emailFor("admin")}\n  employee A: ${emailFor("e02")}\n  employee B: ${emailFor("e01")}`);
}

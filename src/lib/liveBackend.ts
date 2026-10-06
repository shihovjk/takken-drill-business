// Live backend: Supabase Auth + Postgres (row-level security) + Edge Functions.
// Reads go straight to the database where RLS allows; anything involving money or AI goes
// through an Edge Function.
import { createClient } from "@supabase/supabase-js";
import { DEFAULT_RULES, type AwardRules } from "@core/award.ts";
import type { Attempt } from "@core/metrics.ts";
import type { Award, Backend, EmployeeRow, Judgement, MyView, PayoutRecord, Report, Session } from "./types";

type AwardDb = {
  id: string; status: Award["status"]; ai_exam_fee: number; ai_pass_bonus: number; exam_fee: number; pass_bonus: number;
  currency: string; edited_note: string | null; confirmed_at: string | null; paid_at: string | null; provider: string | null;
  ai: (Omit<Judgement, "proposed_award" | "status"> & { model?: string }) | null;
};

const toAward = (a: AwardDb): Award => ({
  id: a.id, status: a.status, aiExamFee: a.ai_exam_fee, aiPassBonus: a.ai_pass_bonus, examFee: a.exam_fee, passBonus: a.pass_bonus,
  currency: a.currency, editedNote: a.edited_note, confirmedAt: a.confirmed_at, paidAt: a.paid_at, provider: a.provider,
});
const toJudgement = (a: AwardDb): Judgement | null => a.ai && {
  ...a.ai, follow_up_message_ja: a.ai.follow_up_message_ja ?? "",
  proposed_award: { examFee: a.ai_exam_fee, passBonus: a.ai_pass_bonus },
  status: a.status === "follow_up" || a.status === "self_pay" ? a.status : "proposed",
};

const PAYPAL_AUTHORIZE = import.meta.env.VITE_PAYPAL_AUTHORIZE_URL || "https://www.sandbox.paypal.com/connect";

export async function createLiveBackend(url: string, key: string): Promise<Backend> {
  const sb = createClient(url, key);
  let me: { userId: string; companyId: string; role: "admin" | "employee" } | null = null;

  async function fn<T = Record<string, unknown>>(name: string, body: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await sb.functions.invoke(name, { body });
    if (error) {
      // Surface the function's own error message when there is one
      const ctx = (error as { context?: Response }).context;
      const msg = ctx ? await ctx.json().then((j) => j.error).catch(() => null) : null;
      throw new Error(msg || error.message);
    }
    return data as T;
  }

  async function loadSession(): Promise<Session | null> {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { me = null; return null; }
    // Joining through an invitation link (?invite=token)
    const invite = new URLSearchParams(location.search).get("invite");
    if (invite) {
      await fn("invite", { action: "accept", token: invite }).catch((e) => alert(e.message));
      history.replaceState(null, "", location.pathname);
    }
    const { data: m } = await sb.from("company_members").select("company_id, role, display_name, companies(name, is_demo)").eq("user_id", user.id).limit(1).maybeSingle();
    if (!m) { me = null; return null; }
    me = { userId: user.id, companyId: m.company_id, role: m.role };
    // Coming back from "Log in with PayPal" (?code=...)
    const code = new URLSearchParams(location.search).get("code");
    if (code && m.role === "employee") {
      await fn("paypal-identity", { code }).catch((e) => alert(e.message));
      history.replaceState(null, "", location.pathname);
    }
    const company = m.companies as unknown as { name: string; is_demo: boolean };
    return { userId: user.id, role: m.role, name: m.display_name, nameEn: m.display_name, companyName: company.name, companyNameEn: company.name, isDemo: company.is_demo };
  }

  // employees(), report() and payouts() are requested together; they share one dashboard call
  let dashP: Promise<{ rows: EmployeeRow[]; report: Report | null; payouts: PayoutRecord[] }> | null = null;
  async function dashboard() {
    const d = await fn<{ rows: (Omit<EmployeeRow, "award" | "judgement" | "judgedBy" | "nameEn" | "deptEn"> & { award: AwardDb | null })[]; report: Report | null; payouts: PayoutRecord[] }>("dashboard");
    return {
      report: d.report, payouts: d.payouts,
      rows: d.rows.map((r) => ({
        ...r, nameEn: r.name, deptEn: r.dept,
        award: r.award && toAward(r.award), judgement: r.award ? toJudgement(r.award) : null, judgedBy: r.award?.ai?.model ?? null,
      })),
    };
  }

  async function myAttempts(): Promise<Attempt[]> {
    const out: Attempt[] = [];
    const since = new Date(Date.now() - 8 * 7 * 86_400_000).toISOString();
    for (let page = 0; ; page++) {
      const { data } = await sb.from("attempts").select("question_id, category, correct, ms, mode, answered_at").eq("user_id", me!.userId).gte("answered_at", since).order("id").range(page * 1000, page * 1000 + 999);
      out.push(...((data ?? []) as Attempt[]));
      if (!data || data.length < 1000) return out;
    }
  }

  return {
    mode: "live",
    session: loadSession,
    demoLogins: () => [],
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password: password ?? "" });
      if (error) throw new Error(error.message);
      const s = await loadSession();
      if (!s) throw new Error("This account is not a member of any company yet.");
      return s;
    },
    async signOut() { await sb.auth.signOut(); me = null; },

    async employees() { dashP = dashboard(); return (await dashP).rows; },
    async report() { return (await (dashP ??= dashboard())).report; },
    async payouts() { return (await (dashP ??= dashboard())).payouts; },
    async rules() {
      const { data } = await sb.from("companies").select("rules").eq("id", me!.companyId).single();
      return { ...DEFAULT_RULES, ...(data?.rules as AwardRules) };
    },
    async saveRules(r) {
      const { error } = await sb.from("companies").update({ rules: r }).eq("id", me!.companyId);
      if (error) throw new Error(error.message);
    },
    async evaluate(onProgress) {
      // The function judges everyone in one call; show a rough progress bar meanwhile
      let n = 0;
      const tick = setInterval(() => onProgress?.(Math.min(++n, 23), 25), 700);
      try { await fn("evaluate"); onProgress?.(25, 25); } finally { clearInterval(tick); }
    },
    async invite(i) { return fn("invite", { action: "create", ...i }); },
    async paypalStatus() { return fn("paypal-connect", { action: "status" }); },
    async connectCompanyPayPal(clientId, secret) { await fn("paypal-connect", { action: "connect", clientId, secret }); },
    async subscription() { return fn("subscription", { action: "status" }); },
    async subscriptionConfig() { return fn("subscription", { action: "config" }); },
    async activateSubscription(subscriptionId) { await fn("subscription", { action: "activate", subscriptionId }); },
    async resetDemo() { await fn("demo-refresh", { action: "reset" }); },
    async confirm(ids, edit) { await fn("awards", { action: "confirm", ids, edit }); },
    async setSelfPay(ids) { await fn("awards", { action: "self_pay", ids }); },
    async setExamResult(id, result) { await fn("awards", { action: "exam_result", id, result }); },
    async sendFollowUp(id, message) { await fn("awards", { action: "follow_up", id, message }); },
    async pay(ids) {
      const res = await fn<{ status: string; file?: { name: string; mime: string; content: string } }>("payout", { ids });
      if (res.file) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([res.file.content], { type: res.file.mime }));
        a.download = res.file.name;
        a.click();
        return;
      }
      // Wait for PayPal's webhook to mark the payouts paid (sandbox usually takes a few seconds)
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const { data } = await sb.from("awards").select("status").in("user_id", ids).eq("status", "processing");
        if (!data?.length) return;
      }
    },

    async me(): Promise<MyView> {
      const [{ data: consent }, attempts, { data: award }, { data: payee }, { data: messages }] = await Promise.all([
        sb.from("consents").select("agreed_at").eq("user_id", me!.userId).eq("company_id", me!.companyId).maybeSingle(),
        myAttempts(),
        sb.from("awards").select("*").eq("user_id", me!.userId).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
        sb.from("payees").select("paypal_email, verified_at").eq("user_id", me!.userId).maybeSingle(),
        sb.from("messages").select("body, created_at").eq("user_id", me!.userId).order("created_at", { ascending: false }).limit(5),
      ]);
      const a = award as AwardDb | null; // RLS only returns it once the admin has confirmed it
      return {
        messages: (messages ?? []).map((m) => ({ body: m.body, createdAt: m.created_at })),
        consented: !!consent, attempts,
        award: a && toAward(a),
        judgement: a?.ai ? { seriousness: a.ai.seriousness, pass_probability: a.ai.pass_probability, reason_ja: a.ai.reason_ja, reason_en: a.ai.reason_en, one_liner_ja: a.ai.one_liner_ja, one_liner_en: a.ai.one_liner_en, flags: a.ai.flags } : null,
        payee: { email: payee?.paypal_email ?? null, verified: !!payee?.verified_at },
      };
    },
    async consent() {
      const { error } = await sb.from("consents").insert({ company_id: me!.companyId, user_id: me!.userId, version: "2026-10" });
      if (error) throw new Error(error.message);
    },
    async recordAttempt(a) {
      await sb.from("attempts").insert({ question_id: a.question_id, category: a.category, correct: a.correct, ms: a.ms, mode: a.mode, choice: a.choice ?? 0, company_id: me!.companyId, user_id: me!.userId });
    },
    async connectPayPal() {
      // Log in with PayPal (OpenID Connect). PayPal returns to this page with ?code=..., handled in loadSession
      const p = new URLSearchParams({
        flowEntry: "static", client_id: import.meta.env.VITE_PAYPAL_CLIENT_ID, response_type: "code",
        scope: "openid email https://uri.paypal.com/services/paypalattributes", redirect_uri: location.origin, // must match the Return URL registered on the PayPal app exactly
      });
      location.href = `${PAYPAL_AUTHORIZE}?${p}`;
      await new Promise(() => {}); // the page is leaving
    },
  };
}

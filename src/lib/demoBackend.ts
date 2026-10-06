// Offline demo: runs entirely in the browser from src/data/demo.json, with changes kept in localStorage.
// It shows the screens without Supabase, PayPal or an AI key. AI results here are the pre-written
// samples from scripts/seed.ts and are labelled as samples on screen; the live backend calls Claude.
import { clampAward, DEFAULT_RULES, type AwardRules } from "@core/award.ts";
import type { CategoryId } from "@core/exam.ts";
import { type Attempt, computeMetrics } from "@core/metrics.ts";
import questions from "../data/questions.json";
import type { Award, Backend, EmployeeRow, ExamResult, Judgement, MyView, PayoutRecord, Report, Session } from "./types";

type Row = [number, number, number, number];
type DemoData = {
  company: { name: string; nameEn: string; rules: AwardRules };
  members: { key: string; name: string; nameEn: string; dept: string; deptEn: string; role: "admin" | "employee"; examResult: ExamResult; paidLastCycle?: boolean; payee?: boolean }[];
  attempts: Record<string, Row[]>;
  samples: Record<string, Judgement>;
};

type State = {
  v: 1;
  user: string | null;
  rules: AwardRules;
  judged: Record<string, boolean>;
  awards: Record<string, Award>;
  report: Report | null;
  payouts: PayoutRecord[];
  consents: Record<string, boolean>;
  payees: Record<string, boolean>;
  examResults: Record<string, ExamResult>;
  extra: Record<string, Attempt[]>; // answers given in this browser
  followUps: Record<string, string>;
};

const KEY = "tdb-demo-v1";
const LOADED_AT = Date.now();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const qs = questions as { id: string; category: CategoryId }[];

export async function createDemoBackend(): Promise<Backend> {
  const data = (await import("../data/demo.json")).default as unknown as DemoData;
  const employees = data.members.filter((m) => m.role === "employee");
  const memberOf = (k: string) => data.members.find((m) => m.key === k)!;

  const fresh = (): State => {
    const s: State = {
      v: 1, user: null, rules: { ...DEFAULT_RULES, ...data.company.rules }, judged: {}, awards: {}, report: null, payouts: [],
      consents: Object.fromEntries(employees.map((m) => [m.key, m.key !== "e02"])), // e02 shows the consent screen once
      payees: Object.fromEntries(employees.map((m) => [m.key, !!m.payee && m.key !== "e02"])), // e02 registers PayPal in the demo
      examResults: Object.fromEntries(employees.map((m) => [m.key, m.examResult])),
      extra: {}, followUps: {},
    };
    // Paid earlier this year (shows in the payout history before anything is clicked)
    const early = employees.filter((m) => m.paidLastCycle);
    early.forEach((m) => {
      s.judged[m.key] = true;
      s.awards[m.key] = { ...awardFrom(data.samples[m.key], s.rules, m.examResult), status: "paid", confirmedAt: ago(9), paidAt: ago(9), provider: "paypal_payouts" };
    });
    if (early.length) s.payouts.push({ id: "demo-batch-0", at: ago(9), total: early.reduce((t, m) => t + s.awards[m.key].examFee + s.awards[m.key].passBonus, 0), currency: "JPY", count: early.length, provider: "paypal_payouts", status: "SUCCESS" });
    return s;
  };

  let st: State;
  try { st = JSON.parse(localStorage.getItem(KEY) || "null") || fresh(); } catch { st = fresh(); }
  if (st.v !== 1) st = fresh();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* private mode: keep in memory */ } };

  const attemptsOf = (k: string): Attempt[] => [
    ...(data.attempts[k] || []).map(([q, ok, ms, minAgo]) => ({
      question_id: qs[q].id, category: qs[q].category, correct: !!ok, ms,
      answered_at: new Date(LOADED_AT - minAgo * 60_000).toISOString(),
    })),
    ...(st.extra[k] || []),
  ];
  const passedOf = (k: string) => (st.examResults[k] === "passed" ? true : st.examResults[k] === "failed" ? false : null);

  function awardFrom(j: Judgement, rules: AwardRules, result: ExamResult): Award {
    const a = clampAward(j.proposed_award, rules, result === "passed" ? true : result === "failed" ? false : null);
    return {
      id: crypto.randomUUID(), status: j.status, aiExamFee: a.examFee, aiPassBonus: a.passBonus, examFee: a.examFee, passBonus: a.passBonus,
      currency: rules.currency, editedNote: null, confirmedAt: null, paidAt: null, provider: null,
    };
  }

  const row = (k: string): EmployeeRow => {
    const m = memberOf(k);
    return {
      userId: k, name: m.name, nameEn: m.nameEn, dept: m.dept, deptEn: m.deptEn, examResult: st.examResults[k],
      payeeReady: !!st.payees[k], metrics: computeMetrics(attemptsOf(k)),
      judgement: st.judged[k] ? data.samples[k] : null, judgedBy: st.judged[k] ? "sample" : null, award: st.awards[k] || null,
    };
  };

  const session = (): Session | null => {
    if (!st.user) return null;
    const m = memberOf(st.user);
    return { userId: m.key, role: m.role, name: m.name, nameEn: m.nameEn, companyName: data.company.name, companyNameEn: data.company.nameEn };
  };

  function makeReport(): Report {
    const rows = employees.map((m) => row(m.key)).filter((r) => r.judgement);
    const follow = rows.filter((r) => r.award?.status === "follow_up");
    const selfPay = rows.filter((r) => r.award?.status === "self_pay");
    const good = rows.length - follow.length - selfPay.length;
    return {
      model: "sample",
      createdAt: new Date().toISOString(),
      summary_ja: `対象${rows.length}人のうち${good}人は毎週継続して学習しており、解答のペースも本試験に近く、受験費用の支給対象と判断しました。一方、${follow.length}人は数字の上では学習量や正答率が十分に見えますが、解答の速さとの組み合わせから「答えの暗記」「読まずに選択」「判定直前の追い込み」の傾向が見られ、確認が必要です。${selfPay.length}人は学習量が支給条件に届いていません。特に正答率が高い社員の中にも、1問数秒で解いている人がいるため、正答率だけで判断しないことをおすすめします。`,
      summary_en: `${good} of ${rows.length} employees studied every week at close to exam pace and qualify for exam-fee support. ${follow.length} look fine on volume or accuracy alone, but their answer speed points to memorized answers, clicking without reading, or a last-minute spike, so they need a human check. ${selfPay.length} did not reach the minimum study time. Several high-accuracy employees answer in a few seconds per question, so accuracy alone should not drive the decision.`,
      follow_ups: follow.map((r) => ({ user_id: r.userId, reason_ja: `${r.judgement!.one_liner_ja}：${r.judgement!.flags[0]?.evidence_ja ?? ""}`, reason_en: `${r.judgement!.one_liner_en}: ${r.judgement!.flags[0]?.evidence_en ?? ""}` })),
    };
  }

  return {
    mode: "demo",
    async session() { return session(); },
    demoLogins: () => [
      { key: "admin", label: "会社の管理者", labelEn: "Company admin" },
      { key: "e02", label: "社員A", labelEn: "Employee A" },
      { key: "e01", label: "社員B", labelEn: "Employee B" },
    ],
    async signIn(key) { st.user = key; save(); return session()!; },
    async signOut() { st.user = null; save(); },

    async employees() { return employees.map((m) => row(m.key)); },
    async report() { return st.report; },
    async rules() { return st.rules; },
    async saveRules(r) { st.rules = r; save(); },
    async evaluate(onProgress) {
      const todo = employees.filter((m) => !st.awards[m.key] || ["proposed", "follow_up", "self_pay"].includes(st.awards[m.key].status));
      for (let i = 0; i < todo.length; i++) {
        await wait(90);
        const k = todo[i].key;
        st.judged[k] = true;
        st.awards[k] = awardFrom(data.samples[k], st.rules, st.examResults[k]);
        onProgress?.(i + 1, todo.length);
      }
      st.report = makeReport();
      save();
    },
    async confirm(ids, edit) {
      ids.forEach((k) => {
        const a = st.awards[k];
        if (!a || !["proposed", "follow_up", "self_pay", "failed"].includes(a.status)) return;
        if (edit) {
          const c = clampAward({ examFee: edit.examFee, passBonus: edit.passBonus }, st.rules, passedOf(k));
          Object.assign(a, { examFee: c.examFee, passBonus: c.passBonus, editedNote: edit.note || null });
        }
        Object.assign(a, { status: a.examFee + a.passBonus > 0 ? "approved" : "self_pay", confirmedAt: new Date().toISOString() });
      });
      save();
    },
    async setSelfPay(ids) {
      ids.forEach((k) => { const a = st.awards[k]; if (a) Object.assign(a, { status: "self_pay", examFee: 0, passBonus: 0, confirmedAt: new Date().toISOString() }); });
      save();
    },
    async pay(ids) {
      const ready = ids.filter((k) => st.awards[k]?.status === "approved" && st.payees[k]);
      if (!ready.length) return;
      ready.forEach((k) => Object.assign(st.awards[k], { status: "processing", provider: "paypal_payouts" }));
      save();
      // Stand-in for the PayPal webhook (PAYMENT.PAYOUTS-ITEM.SUCCEEDED) arriving a moment later
      await wait(1600);
      const now = new Date().toISOString();
      ready.forEach((k) => Object.assign(st.awards[k], { status: "paid", paidAt: now }));
      st.payouts.unshift({ id: `demo-batch-${st.payouts.length}`, at: now, total: ready.reduce((t, k) => t + st.awards[k].examFee + st.awards[k].passBonus, 0), currency: st.rules.currency, count: ready.length, provider: "paypal_payouts", status: "SUCCESS" });
      save();
    },
    async sendFollowUp(k, msg) { st.followUps[k] = msg; save(); },
    async payouts() { return st.payouts; },
    async invite(i) { await wait(300); return { link: `${location.origin}/?invite=demo-${encodeURIComponent(i.email)}`, emailed: true }; },
    async paypalStatus() { return { connected: true, merchantEmail: "hr@mirai-realty.example.com" }; },
    async connectCompanyPayPal() { await wait(500); },
    async subscription() { return { status: "active", next_billing_at: new Date(LOADED_AT + 20 * 86_400_000).toISOString() }; },
    async subscriptionConfig() { return null; },
    async activateSubscription() {},
    async resetDemo() { resetDemo(); },
    async setExamResult(k, r) { st.examResults[k] = r; save(); },

    async me(): Promise<MyView> {
      const k = st.user!;
      const a = st.awards[k];
      const confirmed = a && a.confirmedAt ? a : null;
      const j = confirmed && st.judged[k] ? data.samples[k] : null;
      return {
        messages: st.followUps[k] ? [{ body: st.followUps[k], createdAt: new Date().toISOString() }] : [],
        consented: !!st.consents[k],
        attempts: attemptsOf(k),
        award: confirmed,
        judgement: j && { seriousness: j.seriousness, pass_probability: j.pass_probability, reason_ja: j.reason_ja, reason_en: j.reason_en, one_liner_ja: j.one_liner_ja, one_liner_en: j.one_liner_en, flags: j.flags },
        payee: { email: st.payees[k] ? `${k}@personal.example.com` : null, verified: !!st.payees[k] },
      };
    },
    async consent() { st.consents[st.user!] = true; save(); },
    async recordAttempt(a) {
      const k = st.user!;
      (st.extra[k] ||= []).push({ question_id: a.question_id, category: a.category, correct: a.correct, ms: a.ms, mode: a.mode, answered_at: new Date().toISOString() });
      save();
    },
    async connectPayPal() { await wait(700); st.payees[st.user!] = true; save(); },
  };
}

function ago(days: number) { return new Date(LOADED_AT - days * 86_400_000).toISOString(); }

export function resetDemo() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }

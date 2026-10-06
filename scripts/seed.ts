// Builds the demo company: 25 fictional employees with 8 weeks of study logs, plus a sample
// AI judgement for each (shown only when the AI API is not available, and labelled as a sample).
//
//   node scripts/seed.ts            -> writes src/data/demo.json (used by the offline demo mode)
//   node scripts/seed.ts --supabase -> also loads everything into Supabase
//                                      (needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEMO_PASSWORD)
//
// All names are fictional. Dates are stored as "minutes before now" so the demo always looks current.
import { readFileSync, writeFileSync } from "node:fs";
import { DEFAULT_RULES, clampAward, ruleAward } from "../supabase/functions/_shared/core/award.ts";
import { EXAM_POINTS, SEC_PER_Q, type CategoryId } from "../supabase/functions/_shared/core/exam.ts";
import { type Attempt, computeMetrics, type Metrics } from "../supabase/functions/_shared/core/metrics.ts";

type Persona = "diligent" | "memorizer" | "guesser" | "low" | "spike";
type Member = {
  key: string; name: string; nameEn: string; dept: string; deptEn: string;
  role: "admin" | "employee"; persona?: Persona; level?: number; examResult?: "pending" | "passed" | "failed";
  paidLastCycle?: boolean; payee?: boolean;
};

const MEMBERS: Member[] = [
  { key: "admin", name: "山本 恵", nameEn: "Megumi Yamamoto", dept: "総務部", deptEn: "General Affairs", role: "admin" },
  { key: "e01", name: "佐藤 健太", nameEn: "Kenta Sato", dept: "売買仲介1課", deptEn: "Sales 1", role: "employee", persona: "memorizer", payee: true },
  { key: "e02", name: "鈴木 美咲", nameEn: "Misaki Suzuki", dept: "賃貸管理課", deptEn: "Property Mgmt", role: "employee", persona: "diligent", level: 0.9, examResult: "passed", payee: true },
  { key: "e03", name: "高橋 翔", nameEn: "Sho Takahashi", dept: "売買仲介2課", deptEn: "Sales 2", role: "employee", persona: "guesser", payee: true },
  { key: "e04", name: "田中 優子", nameEn: "Yuko Tanaka", dept: "賃貸仲介課", deptEn: "Leasing", role: "employee", persona: "diligent", level: 0.7, payee: true },
  { key: "e05", name: "伊藤 大輔", nameEn: "Daisuke Ito", dept: "売買仲介1課", deptEn: "Sales 1", role: "employee", persona: "spike", payee: true },
  { key: "e06", name: "渡辺 彩", nameEn: "Aya Watanabe", dept: "賃貸仲介課", deptEn: "Leasing", role: "employee", persona: "low", payee: false },
  { key: "e07", name: "中村 拓也", nameEn: "Takuya Nakamura", dept: "売買仲介2課", deptEn: "Sales 2", role: "employee", persona: "diligent", level: 0.8, examResult: "passed", payee: true },
  { key: "e08", name: "小林 真由", nameEn: "Mayu Kobayashi", dept: "賃貸管理課", deptEn: "Property Mgmt", role: "employee", persona: "diligent", level: 0.55, payee: true },
  { key: "e09", name: "加藤 誠", nameEn: "Makoto Kato", dept: "売買仲介1課", deptEn: "Sales 1", role: "employee", persona: "diligent", level: 0.65, payee: true, paidLastCycle: true },
  { key: "e10", name: "吉田 愛", nameEn: "Ai Yoshida", dept: "賃貸仲介課", deptEn: "Leasing", role: "employee", persona: "low", payee: true },
  { key: "e11", name: "山田 浩二", nameEn: "Koji Yamada", dept: "売買仲介2課", deptEn: "Sales 2", role: "employee", persona: "diligent", level: 0.75, payee: true, paidLastCycle: true },
  { key: "e12", name: "佐々木 陽菜", nameEn: "Hina Sasaki", dept: "賃貸管理課", deptEn: "Property Mgmt", role: "employee", persona: "diligent", level: 0.6, payee: true },
  { key: "e13", name: "山口 隆", nameEn: "Takashi Yamaguchi", dept: "売買仲介1課", deptEn: "Sales 1", role: "employee", persona: "guesser", payee: true },
  { key: "e14", name: "松本 さくら", nameEn: "Sakura Matsumoto", dept: "賃貸仲介課", deptEn: "Leasing", role: "employee", persona: "diligent", level: 0.85, examResult: "passed", payee: true },
  { key: "e15", name: "井上 亮", nameEn: "Ryo Inoue", dept: "売買仲介2課", deptEn: "Sales 2", role: "employee", persona: "spike", payee: true },
  { key: "e16", name: "木村 奈々", nameEn: "Nana Kimura", dept: "賃貸管理課", deptEn: "Property Mgmt", role: "employee", persona: "diligent", level: 0.5, payee: true },
  { key: "e17", name: "林 健一", nameEn: "Kenichi Hayashi", dept: "売買仲介1課", deptEn: "Sales 1", role: "employee", persona: "low", payee: false },
  { key: "e18", name: "斎藤 美穂", nameEn: "Miho Saito", dept: "賃貸仲介課", deptEn: "Leasing", role: "employee", persona: "diligent", level: 0.7, payee: true, paidLastCycle: true },
  { key: "e19", name: "清水 大樹", nameEn: "Daiki Shimizu", dept: "売買仲介2課", deptEn: "Sales 2", role: "employee", persona: "memorizer", payee: true },
  { key: "e20", name: "山崎 結衣", nameEn: "Yui Yamazaki", dept: "賃貸管理課", deptEn: "Property Mgmt", role: "employee", persona: "diligent", level: 0.65, payee: true },
  { key: "e21", name: "森 俊介", nameEn: "Shunsuke Mori", dept: "売買仲介1課", deptEn: "Sales 1", role: "employee", persona: "diligent", level: 0.45, payee: true },
  { key: "e22", name: "池田 千尋", nameEn: "Chihiro Ikeda", dept: "賃貸仲介課", deptEn: "Leasing", role: "employee", persona: "diligent", level: 0.8, payee: true },
  { key: "e23", name: "橋本 直人", nameEn: "Naoto Hashimoto", dept: "売買仲介2課", deptEn: "Sales 2", role: "employee", persona: "low", payee: true },
  { key: "e24", name: "石川 舞", nameEn: "Mai Ishikawa", dept: "賃貸管理課", deptEn: "Property Mgmt", role: "employee", persona: "diligent", level: 0.6, examResult: "failed", payee: true },
  { key: "e25", name: "前田 悠斗", nameEn: "Yuto Maeda", dept: "売買仲介1課", deptEn: "Sales 1", role: "employee", persona: "diligent", level: 0.7, payee: true },
];

// ---------- Deterministic random numbers (same demo every time) ----------
let seed = 20261018;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const between = (a: number, b: number) => a + (b - a) * rand();
const logNormal = (median: number, spread = 0.35) => median * Math.exp(spread * Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand()));

const questions: { id: string; category: CategoryId; choices: unknown[] }[] = JSON.parse(readFileSync(new URL("../src/data/questions.json", import.meta.url), "utf8"));
const byCat = (c: CategoryId) => questions.filter((q) => q.category === c);
const CAT_WEIGHTS = Object.entries(EXAM_POINTS) as [CategoryId, number][];
const pickCat = (): CategoryId => {
  let r = rand() * 50;
  for (const [c, w] of CAT_WEIGHTS) if ((r -= w) < 0) return c;
  return "gyoho";
};

// Week w = 0 (8 weeks ago) .. 7 (this week): answers per week, accuracy, median seconds, how bunched up
function weekPlan(m: Member, w: number) {
  const L = m.level ?? 0.6;
  switch (m.persona) {
    // Many fast answers: the study-time rule alone would pass them, which is the point of the demo
    case "memorizer": return { n: Math.round(between(520, 580)), acc: between(0.87, 0.89), sec: between(8.6, 9.4), cram: false };
    case "guesser": return { n: Math.round(between(430, 500)), acc: between(0.3, 0.38), sec: between(9, 12), cram: false };
    case "low": return { n: Math.round(between(0, 12)), acc: between(0.45, 0.6), sec: between(70, 110), cram: false };
    case "spike": return w < 7
      ? { n: Math.round(between(0, 6)), acc: between(0.4, 0.5), sec: between(80, 110), cram: false }
      : { n: Math.round(between(200, 230)), acc: between(0.62, 0.7), sec: between(55, 75), cram: true };
    default: return { n: Math.round(between(35, 60) + L * 50), acc: Math.min(0.92, 0.48 + L * 0.25 + w * 0.02 * L + between(-0.03, 0.03)), sec: between(70, 115), cram: false };
  }
}

const WEEK_MIN = 7 * 24 * 60;
type Row = [number, number, number, number]; // question index, correct 0/1, ms, minutes ago
function makeAttempts(m: Member): Row[] {
  const rows: Row[] = [];
  for (let w = 0; w < 8; w++) {
    const p = weekPlan(m, w);
    for (let i = 0; i < p.n; i++) {
      const cat = pickCat();
      const pool = byCat(cat);
      const qIdx = questions.indexOf(pool[Math.floor(rand() * pool.length)]);
      const correct = rand() < p.acc ? 1 : 0;
      const ms = Math.round(Math.min(logNormal(p.sec), SEC_PER_Q * 6) * 1000);
      // Cramming: everything in the last ~36 hours; otherwise spread over the week in the evenings
      const weekStartAgo = (8 - w) * WEEK_MIN;
      const ago = p.cram ? Math.round(between(60, 36 * 60)) : Math.round(weekStartAgo - between(0, WEEK_MIN - 60));
      rows.push([qIdx, correct, ms, Math.max(5, ago)]);
    }
  }
  return rows.sort((a, b) => b[3] - a[3]);
}

const toAttempts = (rows: Row[], now: number): Attempt[] => rows.map(([q, ok, ms, ago]) => ({
  question_id: questions[q].id, category: questions[q].category, correct: !!ok, ms,
  answered_at: new Date(now - ago * 60_000).toISOString(),
}));

// ---------- Sample judgements (fallback when the AI cannot be called) ----------
type Flag = { code: string; evidence_ja: string; evidence_en: string };
function sampleJudgement(m: Member, x: Metrics) {
  const acc = x.accuracy ?? 0, sec = x.medianSec ?? 0, fast = x.fastShare ?? 0;
  const last = x.weeks[x.weeks.length - 1];
  const before = x.weeks.slice(0, -1).reduce((s, w) => s + w.minutes, 0);
  const flags: Flag[] = [];
  let seriousness = 0, pass = 0, ja = "", en = "", oneJa = "", oneEn = "", follow = "";
  switch (m.persona) {
    case "memorizer":
      flags.push({ code: "too_fast_for_accuracy", evidence_ja: `正答率${acc}%なのに解答時間の中央値が${sec}秒（本試験の目安は120秒）。${fast}%が10秒未満`, evidence_en: `${acc}% accuracy with a median of ${sec}s per question (exam pace is 120s); ${fast}% answered in under 10s` });
      seriousness = 32; pass = 35;
      ja = `正答率は${acc}%と高いものの、1問あたりの解答時間の中央値が${sec}秒しかありません。4択の問題文と選択肢を読むだけでも通常は1分以上かかるため、問題を読まずに答えを覚えて選んでいる可能性が高いと判断しました。この8週間、速度と正答率の組み合わせがほとんど変わっておらず、新しい論点に取り組んでいる様子も見られません。本試験は初めて見る問題が中心のため、現在の正答率は実力を表していない可能性があります。受験費用の支給は、本人への確認とフォローのあとに判断することをおすすめします。`;
      en = `Accuracy is high at ${acc}%, but the median time per question is only ${sec} seconds. Reading a four-choice question normally takes over a minute, so the answers are most likely being recalled from memory rather than reasoned out. The speed/accuracy pattern has not changed in 8 weeks, with no sign of new topics. Because the real exam is made of unseen questions, this accuracy probably overstates ability. We recommend talking with the employee before deciding on the exam-fee support.`;
      oneJa = "高い正答率は答えの暗記の可能性"; oneEn = "High accuracy likely from memorized answers";
      follow = "最近の学習、正答率は高いですね。ただ1問あたり数秒で解いているので、答えを覚えてしまっているかもしれません。本試験は初めて見る問題ばかりなので、1問2分を目安に、解説を読みながら理由を確かめる解き方に変えてみませんか。";
      break;
    case "guesser":
      flags.push({ code: "guessing", evidence_ja: `中央値${sec}秒で正答率${acc}%（4択の当て推量は25%）`, evidence_en: `median ${sec}s with ${acc}% accuracy (random guessing on 4 choices gives 25%)` });
      seriousness = 22; pass = 8;
      ja = `解答数は多いものの、1問あたり中央値${sec}秒で答えており、正答率は${acc}%です。当て推量（25%）に近い水準で、問題を読まずに選んでいる可能性が高いと判断しました。学習時間の数字は多く見えますが、実際の学習にはなっていない可能性があります。`;
      en = `Plenty of answers, but at a median of ${sec}s each and ${acc}% accuracy — close to the 25% of random guessing. The employee is probably clicking through without reading, so the study-time figure overstates real study.`;
      oneJa = "読まずに選んでいる可能性"; oneEn = "Likely clicking through without reading";
      follow = "たくさん解いていますね。ただ1問を数秒で答えているので、問題文を読み切れていないかもしれません。数を減らしてもいいので、1問ずつ解説まで読んでみてください。";
      break;
    case "spike":
      flags.push({ code: "last_minute_spike", evidence_ja: `直近1週間の学習${last.minutes}分に対し、それまでの7週間は合計${before}分`, evidence_en: `${last.minutes} min in the last week vs ${before} min in the 7 weeks before` });
      seriousness = 45; pass = 30;
      ja = `直近の1週間だけで${last.n}問・${last.minutes}分解いていますが、その前の7週間は合計${before}分でした。判定の直前に急に学習量が増えており、速度も1問${last.medianSec}秒と、それまでより大幅に速くなっています。直前の追い込みとしては評価できますが、継続的な学習とは言えないため、要確認としました。`;
      en = `${last.n} questions and ${last.minutes} minutes in the last week alone, versus ${before} minutes in the previous 7 weeks. Volume jumped right before the review and speed rose to ${last.medianSec}s per question. A late push counts for something, but this is not sustained study, so we flagged it for review.`;
      oneJa = "判定直前に急増、継続性に疑問"; oneEn = "Sudden spike right before the review";
      follow = "先週はたくさん頑張りましたね。試験まで毎日少しずつ続けると、さらに力がつきます。1日30分からでも続けてみてください。";
      break;
    case "low":
      flags.push({ code: "low_volume", evidence_ja: `8週間で${x.n}問・${x.minutes}分`, evidence_en: `${x.n} questions and ${x.minutes} minutes over 8 weeks` });
      seriousness = 15; pass = 5;
      ja = `8週間で解いた問題は${x.n}問、学習時間は約${x.minutes}分でした。会社の支給条件（期間内${DEFAULT_RULES.minMinutes}分以上）に届いておらず、受験費用は自己負担となる見込みです。`;
      en = `${x.n} questions and about ${x.minutes} minutes in 8 weeks. This is below the company's ${DEFAULT_RULES.minMinutes}-minute requirement, so the exam fee would be self-paid.`;
      oneJa = "学習量が支給条件に届かず"; oneEn = "Study volume below the requirement";
      follow = "最近、学習の記録が少ないようです。試験まで、まずは1日10問から始めてみませんか。";
      break;
    default: {
      const rising = (x.weeks[7].accuracy ?? 0) - (x.weeks[0].accuracy ?? 0);
      seriousness = Math.round(Math.min(95, 62 + (m.level ?? 0.6) * 30));
      pass = Math.round(Math.max(10, Math.min(92, ((x.predictedScore ?? 25) - 25) * 5 + 30)));
      ja = `8週間で${x.n}問・約${Math.round(x.minutes / 60)}時間、毎週欠かさず学習しています。1問あたりの時間は中央値${sec}秒と本試験のペースに近く、問題を読んで考えたうえで解いていると判断しました。正答率は${acc}%で、8週前から${rising >= 0 ? `${rising}ポイント上がっています` : "ほぼ横ばいです"}。予想得点は${x.predictedScore}点です。`;
      en = `${x.n} questions and about ${Math.round(x.minutes / 60)} hours over 8 weeks, studying every week. A median of ${sec}s per question is close to exam pace, which suggests the questions are being read and reasoned through. Accuracy is ${acc}%, ${rising >= 0 ? `up ${rising} points from 8 weeks ago` : "roughly flat"}. Predicted score: ${x.predictedScore} points.`;
      oneJa = rising >= 5 ? "着実に学習し正答率も上昇" : "継続して学習している"; oneEn = rising >= 5 ? "Steady study, improving accuracy" : "Consistent study";
    }
  }
  const studied = seriousness >= DEFAULT_RULES.minSeriousness && ruleAward(x.minutes, DEFAULT_RULES, null).examFee > 0;
  const passed = m.examResult === "passed" ? true : m.examResult === "failed" ? false : null;
  // The pass bonus is proposed for everyone; clampAward pays it only once the employee has passed
  const proposal = { examFee: studied ? DEFAULT_RULES.examFee : 0, passBonus: DEFAULT_RULES.passBonus };
  const award = clampAward(proposal, DEFAULT_RULES, passed);
  const status = flags.length && m.persona !== "low" ? "follow_up" : award.examFee || award.passBonus ? "proposed" : "self_pay";
  return {
    seriousness, pass_probability: pass, flags,
    proposed_award: proposal, status,
    reason_ja: ja, reason_en: en, one_liner_ja: oneJa, one_liner_en: oneEn,
    follow_up_message_ja: follow,
  };
}

// ---------- Build ----------
const NOW = Date.now();
const out = {
  note: "Generated by scripts/seed.ts. All people are fictional. Times are minutes before page load.",
  company: { name: "みらい不動産株式会社", nameEn: "Mirai Realty Co., Ltd.", rules: DEFAULT_RULES },
  members: MEMBERS.map(({ persona, level, ...m }) => ({ ...m, examResult: m.examResult ?? "pending" })),
  attempts: {} as Record<string, Row[]>,
  samples: {} as Record<string, ReturnType<typeof sampleJudgement>>,
};
for (const m of MEMBERS) {
  if (m.role !== "employee") continue;
  const rows = makeAttempts(m);
  out.attempts[m.key] = rows;
  out.samples[m.key] = sampleJudgement(m, computeMetrics(toAttempts(rows, NOW), NOW));
}
writeFileSync(new URL("../src/data/demo.json", import.meta.url), JSON.stringify(out));
const total = Object.values(out.attempts).reduce((s, r) => s + r.length, 0);
console.log(`demo.json: ${out.members.length} members, ${total} answers`);
for (const k of ["e01", "e02", "e03", "e05"]) {
  const x = computeMetrics(toAttempts(out.attempts[k], NOW), NOW);
  console.log(k, { acc: x.accuracy, medianSec: x.medianSec, fast: x.fastShare, n: x.n, minutes: x.minutes, status: out.samples[k].status });
}

if (process.argv.includes("--supabase")) {
  const { loadIntoSupabase } = await import("./seed-supabase.ts");
  await loadIntoSupabase(out, (rows) => toAttempts(rows, NOW));
}

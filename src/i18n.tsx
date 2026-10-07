// Japanese is the product language; English is for the hackathon judges. Toggle in the header.
import { createContext, useContext, useState, type ReactNode } from "react";

export type Lang = "ja" | "en";

const D = {
  appName: ["宅建過去問ドリル", "Takken Drill"],
  tagline: ["AIが学習を見極め、会社がPayPalで直接支給", "AI judges study effort. Companies pay employees directly with PayPal."],
  demoBanner: ["オフラインデモ：AIの判定は事前に作ったサンプル、PayPalはシミュレーションです", "Offline demo: AI results are pre-made samples and PayPal is simulated"],
  resetDemo: ["デモを初期状態に戻す", "Reset demo"],
  signOut: ["ログアウト", "Sign out"],
  signInAs: ["デモにログイン", "Sign in to the demo"],
  email: ["メールアドレス", "Email"],
  password: ["パスワード", "Password"],
  signIn: ["ログイン", "Sign in"],
  // Admin nav
  navDashboard: ["学習状況と支給", "Study & awards"],
  navRules: ["支給ルール", "Award rules"],
  navPaypal: ["PayPal連携", "PayPal"],
  // KPIs
  kpiEmployees: ["対象社員", "Employees"],
  kpiPlanned: ["支給予定額", "Planned payouts"],
  kpiPlannedSub: ["承認待ち・承認済み", "pending + approved"],
  kpiSelfPay: ["自己負担に切り替え", "Switched to self-pay"],
  kpiSaved: ["会社負担の削減", "saved"],
  kpiPaid: ["今年度の支払い実績", "Paid this year"],
  kpiPaidSub: ["PayPal", "via PayPal"],
  people: ["人", " people"],
  // AI
  aiRun: ["AIで判定する", "Judge with AI"],
  aiRerun: ["AIで再判定", "Re-judge with AI"],
  aiRunning: ["AIが判定しています", "AI is judging"],
  aiReport: ["AIレポート", "AI report"],
  aiReportEmpty: ["まだ判定していません。「AIで判定する」を押すと、全社員の学習記録をAIが読み、支給額の案と理由を作ります。", "Not judged yet. Press “Judge with AI” to have the AI read every employee's study log and propose awards with reasons."],
  needsFollow: ["要フォローの社員", "Needs follow-up"],
  sampleLabel: ["サンプル判定", "Sample result"],
  // Grid
  colName: ["氏名・部署", "Name / Dept"],
  colTime: ["学習時間", "Study time"],
  colAcc: ["正答率", "Accuracy"],
  colSpeed: ["1問の時間", "Sec / question"],
  colSerious: ["真剣度 (AI)", "Effort (AI)"],
  colPass: ["合格可能性 (AI)", "Pass chance (AI)"],
  colComment: ["AIのひとこと", "AI note"],
  colAward: ["支給予定額 (AI提案)", "Award (AI proposal)"],
  colStatus: ["状況", "Status"],
  filterAll: ["すべて", "All"],
  filterFollow: ["要フォロー・自己負担", "Follow-up / self-pay"],
  filterPending: ["承認待ち", "Pending"],
  filterPaid: ["支払済", "Paid"],
  bulkApprove: ["選んだ社員を承認してPayPalで支払う", "Approve selected & pay with PayPal"],
  selected: ["人を選択中", " selected"],
  selectHint: ["左端のチェックで「承認待ち」の社員を選ぶと押せます。要フォロー・自己負担の社員は行を開いて1人ずつ判断します。PayPal未登録の社員は、本人が受け取り先を登録するまで支払えません。", "Tick pending employees in the left column to use this. Open a row to decide on follow-up or self-pay cases one by one. Employees marked \"No PayPal\" can be paid once they register a PayPal account."],
  noPayeeShort: ["PayPal未登録", "No PayPal"],
  paying: ["PayPalで支払っています…", "Paying with PayPal…"],
  demoMax: ["デモでは1回に3人まで支払えます。3人以下を選んでください。", "In the demo you can pay up to 3 employees at a time. Select 3 or fewer."],
  // Status
  st_none: ["未判定", "Not judged"],
  st_proposed: ["承認待ち", "Pending"],
  st_follow_up: ["要フォロー", "Follow-up"],
  st_self_pay: ["自己負担", "Self-pay"],
  st_approved: ["承認済み", "Approved"],
  st_processing: ["支払い処理中", "Paying…"],
  st_paid: ["支払済", "Paid"],
  st_failed: ["支払い失敗", "Failed"],
  st_exported: ["給与データ出力済", "Exported"],
  // Detail
  serious: ["真剣度", "Effort"],
  passChance: ["合格可能性", "Pass chance"],
  totalTime: ["累計学習時間", "Total study"],
  answered: ["解いた問題", "Answered"],
  medianSpeed: ["1問の時間（中央値）", "Median sec / question"],
  fastShare: ["10秒未満の解答", "Under 10 s"],
  weekly: ["直近8週の学習時間", "Study minutes, last 8 weeks"],
  aiReason: ["AIの判定理由", "Why the AI decided this"],
  evidence: ["根拠", "Evidence"],
  breakdown: ["支給の内訳", "Award breakdown"],
  examFee: ["受験費用", "Exam fee"],
  passBonus: ["合格奨励金", "Pass bonus"],
  total: ["合計", "Total"],
  ruleOnly: ["学習時間のルールだけなら", "Time-only rule would pay"],
  aiSays: ["AIの提案", "AI proposes"],
  examResult: ["試験結果", "Exam result"],
  er_pending: ["結果待ち", "Pending"],
  er_passed: ["合格", "Passed"],
  er_failed: ["不合格", "Failed"],
  approvePay: ["承認してPayPalで支払う", "Approve & pay with PayPal"],
  editAmount: ["金額を修正する", "Edit amount"],
  sendFollow: ["本人にフォローを送る", "Send follow-up"],
  approveAfterCheck: ["判定を確認のうえ承認する", "Approve after review"],
  confirmSelfPay: ["自己負担で確定する", "Confirm self-pay"],
  payNow: ["PayPalで支払う", "Pay with PayPal"],
  noPayee: ["PayPalの受け取り先が未登録です", "No PayPal account registered yet"],
  editNote: ["修正の理由", "Reason for the change"],
  save: ["保存", "Save"],
  cancel: ["キャンセル", "Cancel"],
  sent: ["送りました", "Sent"],
  paidOn: ["支払日", "Paid on"],
  close: ["閉じる", "Close"],
  // Rules
  rulesTitle: ["支給ルール", "Award rules"],
  rulesLead: ["AIはこのルールに沿って金額を提案します。AIの提案がルールの上限を超えることはありません（サーバー側で確認します）。", "The AI proposes amounts under these rules. Proposals can never exceed them; the server enforces the limits."],
  ruleExamFee: ["受験費用の支給額", "Exam-fee support"],
  ruleExamFeeWhen: ["受験費用を支給する社員", "Who gets the exam fee"],
  ruleAnyResult: ["真面目に学習した社員（合否を問わない）", "Employees who studied genuinely, pass or fail"],
  ruleOnlyPassed: ["真面目に学習し、合格した社員だけ", "Only employees who studied genuinely and passed"],
  rulePassBonus: ["合格奨励金", "Pass bonus"],
  ruleMinSerious: ["受験費用を支給する真剣度の下限（AI）", "Minimum effort score for exam-fee support (AI)"],
  ruleMinMinutes: ["期間内の最低学習時間（分）", "Minimum study minutes in the period"],
  saved: ["保存しました", "Saved"],
  // PayPal
  ppTitle: ["PayPal連携", "PayPal"],
  ppLead: ["社員への支給は、会社のPayPalビジネスアカウントから社員のPayPalへ直接送金されます。このアプリはお金を預かりません。", "Awards go straight from the company's PayPal Business account to each employee's PayPal. This app never holds the money."],
  ppConnected: ["接続済み（サンドボックス）", "Connected (sandbox)"],
  ppHistory: ["支払いの履歴", "Payout history"],
  ppSub: ["アプリの利用料（月額）", "App subscription (monthly)"],
  ppSubActive: ["PayPalの定期支払いで契約中", "Active via PayPal Subscriptions"],
  // Employee
  navStudy: ["学習", "Study"],
  navAward: ["受験費用・奨励金", "My award"],
  consentTitle: ["学習データの共有について", "Sharing your study data"],
  consentBody: ["このアプリで解いた問題・正誤・解答にかかった時間は、会社の担当者に共有されます。会社はこれをもとに、受験費用の支給と合格奨励金を決めます。AIが学習の様子を判定し、最終的には担当者が確認して決めます。", "The questions you answer, whether they were right, and how long each took are shared with your employer. The company uses this to decide exam-fee support and pass bonuses. An AI reviews your study pattern; a person at your company makes the final decision."],
  consentAgree: ["同意して始める", "Agree and start"],
  awardNotYet: ["まだ会社の確認が済んでいません。確認が終わると、ここにAIの判定理由と支給額が表示されます。", "Your company has not confirmed your award yet. Once it does, the AI's reasoning and the amount appear here."],
  receiveTo: ["受け取り先", "Receive to"],
  connectPaypal: ["PayPalでログインして受け取り先を登録", "Log in with PayPal to receive payments"],
  paypalReady: ["PayPalに登録済み", "PayPal registered"],
  yourAward: ["あなたの支給額", "Your award"],
} satisfies Record<string, [string, string]>;

export type Key = keyof typeof D;

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: "ja", setLang: () => {} });

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    try { return (localStorage.getItem("tdb-lang") as Lang) || (navigator.language.startsWith("ja") ? "ja" : "en"); } catch { return "ja"; }
  });
  const setLang = (l: Lang) => { setLangState(l); try { localStorage.setItem("tdb-lang", l); } catch { /* ignore */ } };
  return <Ctx.Provider value={{ lang, setLang }}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const { lang, setLang } = useContext(Ctx);
  const t = (k: Key) => D[k][lang === "ja" ? 0 : 1];
  // Pick between a Japanese and an English value (data fields such as name / nameEn)
  const pick = <T,>(ja: T, en: T) => (lang === "ja" ? ja : en);
  const yen = (n: number) => (lang === "ja" ? `${n.toLocaleString("ja-JP")}円` : `¥${n.toLocaleString("en-US")}`);
  return { lang, setLang, t, pick, yen };
}

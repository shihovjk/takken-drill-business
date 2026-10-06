import type { AwardRules } from "@core/award.ts";
import type { Attempt, Metrics } from "@core/metrics.ts";

export type Role = "admin" | "employee";
export type AwardStatus = "proposed" | "follow_up" | "self_pay" | "approved" | "processing" | "paid" | "failed" | "exported";
export type ExamResult = "pending" | "passed" | "failed";

export type Flag = { code: string; evidence_ja: string; evidence_en: string };

// What the AI returns for one employee (also the shape of the offline samples)
export type Judgement = {
  seriousness: number;
  pass_probability: number;
  flags: Flag[];
  proposed_award: { examFee: number; passBonus: number };
  status: "proposed" | "follow_up" | "self_pay";
  reason_ja: string;
  reason_en: string;
  one_liner_ja: string;
  one_liner_en: string;
  follow_up_message_ja: string;
};

export type Award = {
  id: string;
  status: AwardStatus;
  aiExamFee: number;
  aiPassBonus: number;
  examFee: number;
  passBonus: number;
  currency: string;
  editedNote: string | null;
  confirmedAt: string | null;
  paidAt: string | null;
  provider: string | null;
};

export type EmployeeRow = {
  userId: string;
  name: string;
  nameEn: string;
  dept: string;
  deptEn: string;
  examResult: ExamResult;
  payeeReady: boolean; // PayPal receiving account registered
  metrics: Metrics;
  judgement: Judgement | null;
  judgedBy: string | null; // model id, or "sample" for the offline samples
  award: Award | null;
};

export type Report = {
  summary_ja: string;
  summary_en: string;
  follow_ups: { user_id: string; reason_ja: string; reason_en: string }[];
  createdAt: string;
  model: string;
};

export type Session = { userId: string; role: Role; name: string; nameEn: string; companyName: string; companyNameEn: string; isDemo?: boolean };

export type PayoutRecord = { id: string; at: string; total: number; currency: string; count: number; provider: string; status: string };

export type Message = { body: string; createdAt: string };

export type MyView = {
  messages: Message[]; // follow-ups from the company
  consented: boolean;
  attempts: Attempt[];
  award: Award | null; // only once confirmed by the admin
  judgement: Pick<Judgement, "seriousness" | "pass_probability" | "reason_ja" | "reason_en" | "one_liner_ja" | "one_liner_en" | "flags"> | null;
  payee: { email: string | null; verified: boolean };
};

export interface Backend {
  readonly mode: "demo" | "live";
  session(): Promise<Session | null>;
  demoLogins(): { label: string; labelEn: string; key: string }[];
  signIn(keyOrEmail: string, password?: string): Promise<Session>;
  signOut(): Promise<void>;

  // Admin
  employees(): Promise<EmployeeRow[]>;
  report(): Promise<Report | null>;
  rules(): Promise<AwardRules>;
  saveRules(r: AwardRules): Promise<void>;
  evaluate(onProgress?: (done: number, total: number) => void): Promise<void>;
  confirm(userIds: string[], edit?: { examFee: number; passBonus: number; note: string }): Promise<void>;
  setSelfPay(userIds: string[]): Promise<void>;
  pay(userIds: string[]): Promise<void>;
  sendFollowUp(userId: string, message: string): Promise<void>;
  payouts(): Promise<PayoutRecord[]>;
  setExamResult(userId: string, r: ExamResult): Promise<void>;

  invite(i: { email: string; name: string; department: string }): Promise<{ link: string; emailed: boolean }>;
  paypalStatus(): Promise<{ connected: boolean; merchantEmail?: string | null; balance?: number | null }>;
  connectCompanyPayPal(clientId: string, secret: string): Promise<void>;
  subscription(): Promise<{ status: string; next_billing_at?: string | null }>;
  subscriptionConfig(): Promise<{ clientId: string; planId: string; companyId: string } | null>;
  activateSubscription(subscriptionId: string): Promise<void>;
  resetDemo(): Promise<void>;

  // Employee
  me(): Promise<MyView>;
  consent(): Promise<void>;
  recordAttempt(a: { question_id: string; category: Attempt["category"]; correct: boolean; ms: number | null; mode: "four" | "ox" | "mock"; choice?: number }): Promise<void>;
  connectPayPal(): Promise<void>;
}

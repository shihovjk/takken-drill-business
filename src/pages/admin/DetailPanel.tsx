import { useState } from "react";
import { ruleAward, type AwardRules } from "@core/award.ts";
import WeeklyChart from "../../components/WeeklyChart";
import { useI18n } from "../../i18n";
import type { Backend, EmployeeRow, ExamResult } from "../../lib/types";

type Edit = { examFee: number; passBonus: number; note: string };

export default function DetailPanel({ row, rules, backend, busy, onClose, onApprovePay, onChanged }: {
  row: EmployeeRow; rules: AwardRules; backend: Backend; busy: boolean;
  onClose: () => void; onApprovePay: (edit?: Edit) => void; onChanged: (msg?: string) => Promise<void>;
}) {
  const { t, pick, yen, lang } = useI18n();
  const { metrics: m, judgement: j, award: a } = row;
  const [mode, setMode] = useState<"none" | "edit" | "follow">("none");
  const [edit, setEdit] = useState<Edit>({ examFee: a?.examFee ?? 0, passBonus: a?.passBonus ?? 0, note: "" });
  const [msg, setMsg] = useState(j?.follow_up_message_ja ?? "");

  const passed = row.examResult === "passed" ? true : row.examResult === "failed" ? false : null;
  const rule = ruleAward(m.minutes, rules, passed);
  const sec = lang === "ja" ? "秒" : " s";
  const status = a?.status ?? "none";
  const open = ["proposed", "follow_up", "self_pay", "failed"].includes(status);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="panel" role="dialog" aria-label={pick(row.name, row.nameEn)}>
        <div className="panel-head">
          <div>
            <h2>{pick(row.name, row.nameEn)}</h2>
            <div className="sub">{pick(row.dept, row.deptEn)}</div>
            <div className="row" style={{ marginTop: 6, gap: 6 }}>
              <span className={`badge b-${status}`}>{t(`st_${status}` as never)}</span>
              {row.judgedBy && <span className={`badge ${row.judgedBy === "sample" ? "b-sample" : "b-ai"}`}>{row.judgedBy === "sample" ? t("sampleLabel") : `AI · ${row.judgedBy}`}</span>}
            </div>
          </div>
          <button className="x" onClick={onClose} aria-label={t("close")}>×</button>
        </div>

        <div className="panel-body">
          <div className="stats">
            <div className="stat"><div className="k">{t("serious")}</div><div className="v">{j?.seriousness ?? "—"}</div></div>
            <div className="stat"><div className="k">{t("passChance")}</div><div className="v">{j ? <>{j.pass_probability}<small>%</small></> : "—"}</div></div>
            <div className="stat"><div className="k">{t("totalTime")}</div><div className="v">{(m.minutes / 60).toFixed(1)}<small>{lang === "ja" ? "時間" : "h"}</small></div></div>
            <div className="stat"><div className="k">{t("colAcc")}</div><div className="v">{m.accuracy ?? "—"}<small>%</small></div></div>
            <div className={`stat ${m.medianSec != null && m.medianSec < 20 ? "hl" : ""}`}><div className="k">{t("medianSpeed")}</div><div className="v">{m.medianSec ?? "—"}<small>{sec}</small></div></div>
            <div className={`stat ${(m.fastShare ?? 0) >= 30 ? "hl" : ""}`}><div className="k">{t("fastShare")}</div><div className="v">{m.fastShare ?? "—"}<small>%</small></div></div>
          </div>

          <div>
            <div className="sec-title">{t("weekly")}</div>
            <WeeklyChart weeks={m.weeks} />
          </div>

          {j && (
            <div>
              <div className="sec-title">✦ {t("aiReason")}</div>
              <div className="reason">
                <p>{pick(j.reason_ja, j.reason_en)}</p>
                {j.flags.length > 0 && (
                  <ul className="flags">{j.flags.map((f) => <li key={f.code}><b>{t("evidence")}：</b>{pick(f.evidence_ja, f.evidence_en)}</li>)}</ul>
                )}
              </div>
            </div>
          )}

          <div>
            <div className="sec-title">{t("breakdown")}</div>
            <table className="amounts"><tbody>
              <tr><td>{t("examFee")}</td><td>{a ? yen(a.examFee) : "—"}</td></tr>
              <tr><td>{t("passBonus")}<span className="muted">（{t(`er_${row.examResult}` as never)}）</span></td><td>{a ? yen(a.passBonus) : "—"}</td></tr>
              <tr className="total"><td>{t("total")}</td><td>{a ? yen(a.examFee + a.passBonus) : "—"}</td></tr>
            </tbody></table>
            {a && (
              <div className="compare">
                <div className="rule">{t("ruleOnly")}<b>{yen(rule.examFee + rule.passBonus)}</b></div>
                <div className="ai">{t("aiSays")}<b>{yen(a.aiExamFee + a.aiPassBonus)}</b></div>
              </div>
            )}
            {a?.editedNote && <p className="muted" style={{ margin: "8px 0 0", fontSize: 12.5 }}>{t("editNote")}：{a.editedNote}</p>}
            {a?.paidAt && <p className="muted" style={{ margin: "8px 0 0", fontSize: 12.5 }}>{t("paidOn")}：{new Date(a.paidAt).toLocaleString()}（PayPal）</p>}
          </div>

          <label className="field" style={{ marginBottom: 0 }}>
            <span>{t("examResult")}</span>
            <select value={row.examResult} style={{ maxWidth: 200, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--line)" }}
              onChange={async (e) => { await backend.setExamResult(row.userId, e.target.value as ExamResult); await onChanged(); }}>
              {(["pending", "passed", "failed"] as const).map((r) => <option key={r} value={r}>{t(`er_${r}`)}</option>)}
            </select>
          </label>

          {mode === "edit" && (
            <div className="form-inline">
              <label>{t("examFee")}（≤ {yen(rules.examFee)}）<input type="number" min={0} max={rules.examFee} value={edit.examFee} onChange={(e) => setEdit({ ...edit, examFee: Number(e.target.value) })} /></label>
              <label>{t("passBonus")}（≤ {yen(rules.passBonus)}）<input type="number" min={0} max={rules.passBonus} value={edit.passBonus} onChange={(e) => setEdit({ ...edit, passBonus: Number(e.target.value) })} /></label>
              <label>{t("editNote")}<input value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></label>
              <div className="row">
                <button className="btn pay" disabled={busy || !row.payeeReady} onClick={() => onApprovePay(edit)}>{t("approvePay")}</button>
                <button className="btn ghost" onClick={() => setMode("none")}>{t("cancel")}</button>
              </div>
            </div>
          )}
          {mode === "follow" && (
            <div className="form-inline">
              <label>{t("sendFollow")}<textarea rows={4} value={msg} onChange={(e) => setMsg(e.target.value)} /></label>
              <div className="row">
                <button className="btn primary" onClick={async () => { await backend.sendFollowUp(row.userId, msg); setMode("none"); await onChanged(t("sent")); }}>{t("sendFollow")}</button>
                <button className="btn ghost" onClick={() => setMode("none")}>{t("cancel")}</button>
              </div>
            </div>
          )}
        </div>

        {a && mode === "none" && (
          <div className="panel-foot">
            {!row.payeeReady && ["proposed", "follow_up", "approved"].includes(status) && <span className="muted" style={{ width: "100%", fontSize: 12.5 }}>{t("noPayee")}</span>}
            {status === "proposed" && <>
              <button className="btn pay" disabled={busy || !row.payeeReady} onClick={() => onApprovePay()}>{t("approvePay")}</button>
              <button className="btn" onClick={() => setMode("edit")}>{t("editAmount")}</button>
            </>}
            {status === "follow_up" && <>
              <button className="btn primary" onClick={() => setMode("follow")}>{t("sendFollow")}</button>
              <button className="btn" onClick={() => { setEdit({ examFee: a.examFee || rules.examFee, passBonus: a.passBonus, note: "" }); setMode("edit"); }}>{t("approveAfterCheck")}</button>
              <button className="btn ghost" onClick={async () => { await backend.setSelfPay([row.userId]); await onChanged(); }}>{t("confirmSelfPay")}</button>
            </>}
            {status === "approved" && <button className="btn pay" disabled={busy || !row.payeeReady} onClick={() => onApprovePay()}>{t("payNow")}</button>}
            {status === "self_pay" && !a.confirmedAt && <>
              <button className="btn primary" onClick={async () => { await backend.setSelfPay([row.userId]); await onChanged(); }}>{t("confirmSelfPay")}</button>
              <button className="btn" onClick={() => setMode("edit")}>{t("editAmount")}</button>
            </>}
            {open && status === "failed" && <button className="btn pay" disabled={busy} onClick={() => onApprovePay()}>{t("payNow")}</button>}
          </div>
        )}
      </aside>
    </>
  );
}

import { useMemo, useState } from "react";
import { useI18n } from "../../i18n";
import type { Backend, EmployeeRow } from "../../lib/types";
import type { AdminData, Refresh } from "./AdminApp";
import DetailPanel from "./DetailPanel";
import EmployeeGrid, { type Filter } from "./EmployeeGrid";

const PENDING = ["proposed", "approved", "processing"];

// The shared demo company pays at most this many people per click (see supabase/functions/payout)
const DEMO_MAX = 3;

export default function Dashboard({ backend, data, isDemo, refresh, notify }: {
  backend: Backend; data: AdminData; isDemo: boolean; refresh: Refresh; notify: (m: string) => void;
}) {
  const { t, pick, yen } = useI18n();
  const { rows, report, payouts, rules } = data;
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [busy, setBusy] = useState(false);
  // The outcome of the last payout stays on screen until closed (a toast is too easy to miss)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const kpi = useMemo(() => {
    const planned = rows.filter((r) => r.award && PENDING.includes(r.award.status)).reduce((s, r) => s + r.award!.examFee + r.award!.passBonus, 0);
    // Only people the admin has confirmed as self-pay (an AI proposal alone does not count)
    const selfPay = rows.filter((r) => r.award?.status === "self_pay" && r.award.confirmedAt).length;
    const paid = payouts.reduce((s, p) => s + p.total, 0);
    return { planned, selfPay, saved: selfPay * rules.examFee, paid };
  }, [rows, payouts, rules]);

  const judged = rows.some((r) => r.judgement && r.award?.status !== "paid");
  const nameOf = (id: string) => { const r = rows.find((x) => x.userId === id); return r ? pick(r.name, r.nameEn) : id; };

  const runAi = async () => {
    setProgress([0, rows.length]);
    try { await backend.evaluate((d, n) => setProgress([d, n])); } catch (e) { notify(e instanceof Error ? e.message : String(e)); }
    setProgress(null);
    await refresh();
  };

  // Approve (confirm the AI amount) and send the payout in one step
  const approveAndPay = async (ids: string[], edit?: { examFee: number; passBonus: number; note: string }) => {
    // Check before approving, so nobody is left approved but unpaid
    if (isDemo && ids.length > DEMO_MAX) { setResult({ ok: false, text: t("demoMax") }); return; }
    // Nobody is approved without a PayPal account to pay them to
    const noPayee = rows.filter((r) => ids.includes(r.userId) && !r.payeeReady);
    if (noPayee.length) {
      setResult({ ok: false, text: pick(
        `${noPayee.map((r) => r.name).join("、")}はPayPalの受け取り先が未登録のため、支払えません。本人が「支給」タブで登録すると支払えるようになります。`,
        `${noPayee.map((r) => r.nameEn).join(", ")} cannot be paid yet: no PayPal account registered. They can register it in their Award tab.`) });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      await backend.confirm(ids, edit);
      await refresh();
      const p = backend.pay(ids);
      await refresh(); // shows "paying…" while the payout is in flight
      await p;
      const after = await refresh();
      const sent = after.filter((r) => ids.includes(r.userId) && r.award && ["processing", "paid", "exported"].includes(r.award.status));
      const total = sent.reduce((s, r) => s + r.award!.examFee + r.award!.passBonus, 0);
      const names = sent.map((r) => pick(r.name, r.nameEn)).join(pick("、", ", "));
      setResult({ ok: true, text: pick(
        `${names}（${sent.length}人）に、合計${yen(total)}をPayPalで送金しました。PayPalから完了の知らせが届くと「支払済」に変わります。`,
        `Sent ${yen(total)} via PayPal to ${names} (${sent.length}). The status changes to "Paid" when PayPal confirms.`) });
      setSelected([]);
      // PayPal confirms by webhook a few seconds later; refresh so "Paid" appears without a reload
      setTimeout(refresh, 5000);
      setTimeout(refresh, 15000);
    } catch (e) {
      await refresh();
      setResult({ ok: false, text: pick("支払いできませんでした：", "Payment failed: ") + payError(e instanceof Error ? e.message : String(e), pick) });
    }
    setBusy(false);
  };

  const open = rows.find((r) => r.userId === openId) || null;

  return (
    <div className="stack">
      <section className="kpis">
        <div className="card kpi"><div className="k">{t("kpiEmployees")}</div><div className="v">{rows.length}<small>{t("people")}</small></div><div className="s">&nbsp;</div></div>
        <div className="card kpi"><div className="k">{t("kpiPlanned")}</div><div className="v">{yen(kpi.planned)}</div><div className="s">{t("kpiPlannedSub")}</div></div>
        <div className="card kpi good"><div className="k">{t("kpiSelfPay")}</div><div className="v">{kpi.selfPay}<small>{t("people")}</small></div><div className="s">{t("kpiSaved")} {yen(kpi.saved)}</div></div>
        <div className="card kpi"><div className="k">{t("kpiPaid")}</div><div className="v">{yen(kpi.paid)}</div><div className="s">{t("kpiPaidSub")}・{payouts.reduce((s, p) => s + p.count, 0)}{t("people")}</div></div>
      </section>

      <section className="card ai-card">
        <div className="ai-head">
          <h2>{t("aiReport")}</h2>
          {report && <span className={`badge ${report.model === "sample" ? "b-sample" : "b-ai"}`}>{report.model === "sample" ? t("sampleLabel") : report.model}</span>}
          {report && <span className="muted" style={{ fontSize: 12 }}>{new Date(report.createdAt).toLocaleString()}</span>}
          <span className="spacer" />
          <button className="btn ai" onClick={runAi} disabled={!!progress}>✦ {progress ? t("aiRunning") : judged ? t("aiRerun") : t("aiRun")}</button>
        </div>
        {progress && <div className="progress"><i style={{ width: `${(progress[0] / Math.max(1, progress[1])) * 100}%` }} /></div>}
        {!report && !progress && <p className="ai-summary">{t("aiReportEmpty")}</p>}
        {report && (
          <>
            <p className="ai-summary">{pick(report.summary_ja, report.summary_en)}</p>
            {report.follow_ups.length > 0 && (
              <>
                <div className="sec-title">{t("needsFollow")}</div>
                <ul className="follow-list">
                  {report.follow_ups.map((f) => (
                    <li key={f.user_id}><button onClick={() => setOpenId(f.user_id)}>{nameOf(f.user_id)}</button><span className="muted">{pick(f.reason_ja, f.reason_en)}</span></li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </section>

      <section className="card grid-card">
        <div className="grid-tools">
          <div className="tabs" role="tablist">
            {([["all", t("filterAll")], ["follow", t("filterFollow")], ["pending", t("filterPending")], ["paid", t("filterPaid")]] as [Filter, string][]).map(([f, label]) => (
              <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>{label}<span className="n">{countFor(rows, f)}</span></button>
            ))}
          </div>
          <span className="spacer" />
          {selected.length > 0
            ? <span className="muted">{selected.length}{t("selected")}</span>
            : <span className="muted" style={{ fontSize: 12, maxWidth: 420 }}>{t("selectHint")}</span>}
          <button className="btn pay" disabled={!selected.length || busy} onClick={() => approveAndPay(selected)}>{busy ? t("paying") : t("bulkApprove")}</button>
        </div>
        {result && (
          <div className={`pay-result ${result.ok ? "ok" : "ng"}`} role="status">
            <span>{result.ok ? "✓ " : "! "}{result.text}</span>
            <button className="link" onClick={() => setResult(null)} aria-label={pick("閉じる", "Close")}>×</button>
          </div>
        )}
        <EmployeeGrid rows={rows} filter={filter} onOpen={setOpenId} onSelect={setSelected} />
      </section>

      {open && (
        <DetailPanel key={open.userId} row={open} rules={rules} backend={backend} busy={busy} onClose={() => setOpenId(null)}
          onApprovePay={(edit) => approveAndPay([open.userId], edit)}
          onChanged={async (msg) => { await refresh(); if (msg) notify(msg); }} />
      )}
    </div>
  );
}

// Server messages (English) shown to the admin in their language
function payError(msg: string, pick: (ja: string, en: string) => string) {
  if (msg.startsWith("demo: up to")) return pick("デモでは1回に3人まで支払えます。", msg);
  if (msg.includes("no employee has a PayPal account")) return pick("PayPalの受け取り先が登録されていない社員です。", msg);
  if (msg.includes("nothing approved to pay")) return pick("支払える状態の社員がいません。", msg);
  if (msg.includes("already being paid")) return pick("すでに支払い処理中です。", msg);
  return pick(`${msg}（もう一度試すときは、行を開いて「PayPalで支払う」を押してください）`, `${msg} (to retry, open the row and press "Pay with PayPal")`);
}

export function matches(r: EmployeeRow, f: Filter) {
  const s = r.award?.status;
  if (f === "follow") return s === "follow_up" || s === "self_pay";
  if (f === "pending") return s === "proposed" || s === "approved";
  if (f === "paid") return s === "paid";
  return true;
}
const countFor = (rows: EmployeeRow[], f: Filter) => rows.filter((r) => matches(r, f)).length;

import { useMemo, useState } from "react";
import { useI18n } from "../../i18n";
import type { Backend, EmployeeRow } from "../../lib/types";
import type { AdminData } from "./AdminApp";
import DetailPanel from "./DetailPanel";
import EmployeeGrid, { type Filter } from "./EmployeeGrid";

const PENDING = ["proposed", "approved", "processing"];

// The shared demo company pays at most this many people per click (see supabase/functions/payout)
const DEMO_MAX = 3;

export default function Dashboard({ backend, data, isDemo, refresh, notify }: {
  backend: Backend; data: AdminData; isDemo: boolean; refresh: () => Promise<void>; notify: (m: string) => void;
}) {
  const { t, pick, yen } = useI18n();
  const { rows, report, payouts, rules } = data;
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [busy, setBusy] = useState(false);

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
    if (isDemo && ids.length > DEMO_MAX) { notify(t("demoMax")); return; }
    setBusy(true);
    try {
      await backend.confirm(ids, edit);
      await refresh();
      const p = backend.pay(ids);
      await refresh(); // shows "paying…" while the payout is in flight
      await p;
      await refresh();
      notify(pick(`${ids.length}人への支払いが完了しました（PayPal）`, `Paid ${ids.length} employee(s) via PayPal`));
      setSelected([]);
    } catch (e) { notify(e instanceof Error ? e.message : String(e)); }
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
          <button className="btn pay" disabled={!selected.length || busy} onClick={() => approveAndPay(selected)}>{t("bulkApprove")}</button>
        </div>
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

export function matches(r: EmployeeRow, f: Filter) {
  const s = r.award?.status;
  if (f === "follow") return s === "follow_up" || s === "self_pay";
  if (f === "pending") return s === "proposed" || s === "approved";
  if (f === "paid") return s === "paid";
  return true;
}
const countFor = (rows: EmployeeRow[], f: Filter) => rows.filter((r) => matches(r, f)).length;

import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import type { Backend } from "../../lib/types";
import type { AdminData } from "./AdminApp";

export default function PayPalPage({ backend, data, notify }: { backend: Backend; data: AdminData; notify: (m: string) => void }) {
  const { t, pick, yen } = useI18n();
  const [conn, setConn] = useState<{ connected: boolean; merchantEmail?: string | null; balance?: number | null } | null>(null);
  const [sub, setSub] = useState<{ status: string; next_billing_at?: string | null } | null>(null);
  const [form, setForm] = useState({ clientId: "", secret: "" });
  const [busy, setBusy] = useState(false);
  const load = () => { backend.paypalStatus().then(setConn).catch(() => setConn({ connected: false })); backend.subscription().then(setSub).catch(() => setSub({ status: "none" })); };
  useEffect(load, [backend]);

  const connect = async () => {
    setBusy(true);
    try { await backend.connectCompanyPayPal(form.clientId, form.secret); setForm({ clientId: "", secret: "" }); notify(t("saved")); load(); }
    catch (e) { notify(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  return (
    <div className="stack" style={{ maxWidth: 860 }}>
      <div className="card">
        <h2>{t("ppTitle")}{conn?.connected && <span className="badge b-paid">{t("ppConnected")}</span>}</h2>
        <p className="muted" style={{ marginTop: 0 }}>{t("ppLead")}</p>
        {conn?.connected && conn.merchantEmail && <p style={{ margin: "0 0 10px" }}>{conn.merchantEmail}</p>}
        {conn?.connected && conn.balance != null && <p style={{ margin: "0 0 10px" }}>{pick("残高", "Balance")}：<b>{yen(conn.balance)}</b></p>}
        {conn && !conn.connected && (
          <form className="form-inline" onSubmit={(e) => { e.preventDefault(); connect(); }} style={{ marginBottom: 12 }}>
            <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>{pick("PayPal Developer の「Apps & Credentials」で作ったアプリ（サンドボックス）のクライアントIDとシークレットを入れてください。シークレットは暗号化して保存し、画面には二度と表示しません。", "Enter the client ID and secret of your PayPal REST app (sandbox) from PayPal Developer → Apps & Credentials. The secret is stored encrypted and never shown again.")}</p>
            <label>Client ID<input required value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} autoComplete="off" /></label>
            <label>Secret<input required type="password" value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} autoComplete="off" /></label>
            <div><button className="btn primary" disabled={busy}>{pick("接続する", "Connect")}</button></div>
          </form>
        )}
        <div className="row"><span className="badge b-approved">Payouts API</span><span className="badge b-approved">Webhooks</span><span className="badge b-approved">Log in with PayPal</span><span className="badge b-approved">Subscriptions API</span></div>
      </div>
      <div className="card">
        <h2>{t("ppSub")}{sub?.status === "active" && <span className="badge b-paid">{t("ppSubActive")}</span>}</h2>
        {sub?.next_billing_at && <p className="muted" style={{ margin: 0 }}>{pick("次回のお支払い", "Next billing")}：{new Date(sub.next_billing_at).toLocaleDateString()}</p>}
        {sub && sub.status !== "active" && <SubscribeButton backend={backend} onDone={load} />}
      </div>
      <div className="card">
        <h2>{t("ppHistory")}</h2>
        <table className="amounts"><tbody>
          {data.payouts.map((p) => (
            <tr key={p.id}><td>{new Date(p.at).toLocaleString()}<span className="muted">　{p.count}{t("people")}・{p.provider}・{p.status}</span></td><td>{yen(p.total)}</td></tr>
          ))}
          {!data.payouts.length && <tr><td className="muted">—</td><td /></tr>}
        </tbody></table>
      </div>
    </div>
  );
}

// PayPal's own subscription button (JS SDK). The plan is the app's monthly fee; custom_id ties it to the company.
type PayPalButtons = { Buttons: (o: object) => { render: (el: HTMLElement) => Promise<void> } };
function SubscribeButton({ backend, onDone }: { backend: Backend; onDone: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    let gone = false;
    backend.subscriptionConfig().then((cfg) => {
      if (gone) return; // React runs effects twice in development; only the live one renders
      if (!cfg?.clientId || !cfg.planId) { setMsg("PAYPAL_PLAN_ID is not set"); return; }
      const s = document.createElement("script");
      s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(cfg.clientId)}&vault=true&intent=subscription`;
      s.onload = () => {
        const pp = (window as unknown as { paypal: PayPalButtons }).paypal;
        if (gone || !box.current) return;
        pp.Buttons({
          style: { label: "subscribe" },
          createSubscription: (_d: unknown, actions: { subscription: { create: (o: object) => Promise<string> } }) =>
            actions.subscription.create({ plan_id: cfg.planId, custom_id: cfg.companyId }),
          onApprove: async (d: { subscriptionID: string }) => { await backend.activateSubscription(d.subscriptionID); onDone(); },
        }).render(box.current);
      };
      document.body.appendChild(s);
    }).catch((e) => setMsg(String(e.message ?? e)));
    return () => { gone = true; };
  }, [backend, onDone]);
  return <><div ref={box} style={{ maxWidth: 320 }} />{msg && <p className="muted">{msg}</p>}</>;
}

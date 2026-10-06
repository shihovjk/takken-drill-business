import { useState } from "react";
import { useI18n } from "../../i18n";
import type { Backend } from "../../lib/types";
import type { AdminData } from "./AdminApp";

// Invite employees. They get an email, set a password, consent to data sharing, and start studying.
export default function MembersPage({ backend, data }: { backend: Backend; data: AdminData }) {
  const { pick } = useI18n();
  const [f, setF] = useState({ email: "", name: "", department: "" });
  const [result, setResult] = useState<{ link: string; emailed: boolean } | null>(null);
  const [error, setError] = useState("");
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <div className="card">
        <h2>{pick("社員を招待する", "Invite an employee")}</h2>
        <form className="form-inline" onSubmit={async (e) => {
          e.preventDefault(); setError("");
          try { setResult(await backend.invite(f)); setF({ email: "", name: "", department: "" }); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
        }}>
          <label>{pick("氏名", "Name")}<input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label>{pick("部署", "Department")}<input value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} /></label>
          <label>{pick("メールアドレス", "Email")}<input required type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
          <div><button className="btn primary">{pick("招待メールを送る", "Send invitation")}</button></div>
        </form>
        {result && <p style={{ marginBottom: 0 }}>{result.emailed ? pick("招待メールを送りました。", "Invitation sent.") : pick("メールは送れませんでした。次のリンクを本人に伝えてください。", "Email could not be sent; share this link instead.")}<br /><code style={{ fontSize: 12, wordBreak: "break-all" }}>{result.link}</code></p>}
        {error && <p style={{ color: "var(--bad)", marginBottom: 0 }}>{error}</p>}
      </div>
      <div className="card">
        <h2>{pick("社員", "Employees")}<span className="muted" style={{ fontWeight: 500 }}>{data.rows.length}</span></h2>
        <table className="amounts"><tbody>
          {data.rows.map((r) => <tr key={r.userId}><td>{pick(r.name, r.nameEn)}<span className="muted">　{pick(r.dept, r.deptEn)}</span></td><td>{r.payeeReady ? <span className="badge b-paid">PayPal</span> : <span className="badge b-none">{pick("PayPal未登録", "No PayPal")}</span>}</td></tr>)}
        </tbody></table>
      </div>
    </div>
  );
}

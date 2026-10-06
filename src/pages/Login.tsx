import { useState } from "react";
import { useI18n } from "../i18n";
import type { Backend, Session } from "../lib/types";

export default function Login({ backend, onSignedIn }: { backend: Backend; onSignedIn: (s: Session) => void }) {
  const { t, lang, setLang, pick } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const go = async (key: string, pw?: string) => {
    setError("");
    try { onSignedIn(await backend.signIn(key, pw)); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div className="login">
      <div className="card login-card">
        <div className="row" style={{ marginBottom: 14 }}>
          <span className="brand-mark" style={{ color: "#fff" }}>宅</span>
          <span className="spacer" />
          <div className="lang" style={{ borderColor: "var(--line)" }}>
            <button className={lang === "ja" ? "on" : ""} style={{ color: lang === "ja" ? "#fff" : "var(--ink-2)", background: lang === "ja" ? "var(--ink)" : "none" }} onClick={() => setLang("ja")}>日本語</button>
            <button className={lang === "en" ? "on" : ""} style={{ color: lang === "en" ? "#fff" : "var(--ink-2)", background: lang === "en" ? "var(--ink)" : "none" }} onClick={() => setLang("en")}>EN</button>
          </div>
        </div>
        <h1>{t("appName")}<span className="biz-tag">for Business</span></h1>
        <p className="lead">{t("tagline")}</p>
        {backend.mode === "demo" ? (
          <>
            <div className="sec-title">{t("signInAs")}</div>
            <div className="login-opts">
              {backend.demoLogins().map((d) => (
                <button key={d.key} className="btn" onClick={() => go(d.key)}>{pick(d.label, d.labelEn)}</button>
              ))}
            </div>
          </>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); go(email, password); }}>
            <label className="field"><span>{t("email")}</span><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" style={{ maxWidth: "none" }} /></label>
            <label className="field"><span>{t("password")}</span><input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" style={{ maxWidth: "none" }} /></label>
            <button className="btn primary" type="submit">{t("signIn")}</button>
          </form>
        )}
        {error && <p style={{ color: "var(--bad)" }}>{error}</p>}
      </div>
    </div>
  );
}

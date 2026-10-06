import { lazy, Suspense, useEffect, useState } from "react";
import { useI18n } from "./i18n";
import { loadBackend } from "./lib/backend";
import type { Backend, Session } from "./lib/types";
import Login from "./pages/Login";

// Each side loads only its own code (the admin grid is the large part)
const AdminApp = lazy(() => import("./pages/admin/AdminApp"));
const EmployeeApp = lazy(() => import("./pages/employee/EmployeeApp"));

export default function App() {
  const [backend, setBackend] = useState<Backend | null>(null);
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    loadBackend().then(async (b) => { setBackend(b); setSession(await b.session()); });
  }, []);

  if (!backend || session === undefined) return <div className="login"><span className="muted">Loading…</span></div>;
  if (!session) return <Login backend={backend} onSignedIn={setSession} />;
  const signOut = async () => { await backend.signOut(); setSession(null); };
  return (
    <Suspense fallback={<div className="login"><span className="muted">Loading…</span></div>}>
      {session.role === "admin"
        ? <AdminApp backend={backend} session={session} onSignOut={signOut} />
        : <EmployeeApp backend={backend} session={session} onSignOut={signOut} />}
    </Suspense>
  );
}

export function TopBar({ backend, session, nav, onSignOut }: {
  backend: Backend; session: Session; onSignOut: () => void;
  nav: { items: { id: string; label: string }[]; current: string; go: (id: string) => void };
}) {
  const { t, lang, setLang, pick } = useI18n();
  return (
    <>
      <header className="topbar">
        <div className="topbar-in">
          <div className="brand"><span className="brand-mark">宅</span>{t("appName")}<span className="biz-tag">for Business</span></div>
          <nav className="nav">
            {nav.items.map((i) => <button key={i.id} className={nav.current === i.id ? "on" : ""} onClick={() => nav.go(i.id)}>{i.label}</button>)}
          </nav>
          <div className="top-right">
            <span className="who">{pick(session.companyName, session.companyNameEn)}・{pick(session.name, session.nameEn)}</span>
            <div className="lang">
              <button className={lang === "ja" ? "on" : ""} onClick={() => setLang("ja")}>日本語</button>
              <button className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>EN</button>
            </div>
            <button className="link-btn" onClick={onSignOut}>{t("signOut")}</button>
          </div>
        </div>
      </header>
      {backend.mode === "demo" && <DemoBanner />}
      {backend.mode === "live" && session.isDemo && session.role === "admin" && <LiveDemoBanner backend={backend} />}
    </>
  );
}

// The public demo company on the live backend: real AI and PayPal sandbox, shared by all judges
function LiveDemoBanner({ backend }: { backend: Backend }) {
  const { pick } = useI18n();
  return (
    <div className="demo-banner">
      {pick("公開デモ：AIは実際に Claude を呼び、PayPal はサンドボックスで送金します", "Public demo: the AI really calls Claude and PayPal pays in sandbox")}
      <button onClick={async () => { await backend.resetDemo(); location.reload(); }}>{pick("デモを初期状態に戻す", "Reset demo")}</button>
    </div>
  );
}

function DemoBanner() {
  const { t } = useI18n();
  const reset = async () => { (await import("./lib/demoBackend")).resetDemo(); location.reload(); };
  return <div className="demo-banner">{t("demoBanner")}<button onClick={reset}>{t("resetDemo")}</button></div>;
}

import { useEffect, useState } from "react";
import type { Backend, Session } from "../../lib/types";
import Consent from "./Consent";
import Study from "./Study";

// Employees use the study app itself (with a 「支給」 tab added), after agreeing to share their data
export default function EmployeeApp({ backend, session, onSignOut }: { backend: Backend; session: Session; onSignOut: () => void }) {
  const [consented, setConsented] = useState<boolean | null>(null);
  useEffect(() => { backend.me().then((m) => setConsented(m.consented)); }, [backend]);

  if (consented === null) return <div className="login"><span className="muted">Loading…</span></div>;
  if (!consented) {
    return (
      <main className="page narrow">
        <Consent onAgree={async () => { await backend.consent(); setConsented(true); }} />
      </main>
    );
  }
  return <Study backend={backend} userId={session.userId} onSignOut={onSignOut} />;
}

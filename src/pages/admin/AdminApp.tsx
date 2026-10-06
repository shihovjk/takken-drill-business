import { useCallback, useEffect, useState } from "react";
import type { AwardRules } from "@core/award.ts";
import { TopBar } from "../../App";
import { useI18n } from "../../i18n";
import type { Backend, EmployeeRow, PayoutRecord, Report, Session } from "../../lib/types";
import Dashboard from "./Dashboard";
import MembersPage from "./MembersPage";
import PayPalPage from "./PayPalPage";
import RulesPage from "./RulesPage";

export type AdminData = { rows: EmployeeRow[]; report: Report | null; payouts: PayoutRecord[]; rules: AwardRules };

export default function AdminApp({ backend, session, onSignOut }: { backend: Backend; session: Session; onSignOut: () => void }) {
  const { t, lang } = useI18n();
  const [tab, setTab] = useState("dashboard");
  const [data, setData] = useState<AdminData | null>(null);
  const [toast, setToast] = useState("");

  const refresh = useCallback(async () => {
    const [rows, report, payouts, rules] = await Promise.all([backend.employees(), backend.report(), backend.payouts(), backend.rules()]);
    setData({ rows, report, payouts, rules });
  }, [backend]);
  useEffect(() => { refresh(); }, [refresh]);

  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2600); };

  return (
    <>
      <TopBar backend={backend} session={session} onSignOut={onSignOut} nav={{
        current: tab, go: setTab,
        items: [{ id: "dashboard", label: t("navDashboard") }, { id: "rules", label: t("navRules") }, { id: "members", label: lang === "ja" ? "社員の招待" : "Members" }, { id: "paypal", label: t("navPaypal") }],
      }} />
      <main className="page">
        {!data ? <p className="muted">Loading…</p>
          : tab === "dashboard" ? <Dashboard backend={backend} data={data} refresh={refresh} notify={notify} />
          : tab === "rules" ? <RulesPage backend={backend} rules={data.rules} onSaved={() => { refresh(); notify(t("saved")); }} />
          : tab === "members" ? <MembersPage backend={backend} data={data} />
          : <PayPalPage backend={backend} data={data} notify={notify} />}
      </main>
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}

import { useState } from "react";
import type { AwardRules } from "@core/award.ts";
import { useI18n } from "../../i18n";
import type { Backend } from "../../lib/types";

export default function RulesPage({ backend, rules, onSaved }: { backend: Backend; rules: AwardRules; onSaved: () => void }) {
  const { t } = useI18n();
  const [r, setR] = useState(rules);
  const num = (k: keyof AwardRules, label: string, max?: number) => (
    <label className="field">
      <span>{label}</span>
      <input type="number" min={0} max={max} value={r[k] as number} onChange={(e) => setR({ ...r, [k]: Number(e.target.value) })} />
    </label>
  );
  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <h2>{t("rulesTitle")}</h2>
      <p className="muted" style={{ marginTop: 0 }}>{t("rulesLead")}</p>
      <form onSubmit={async (e) => { e.preventDefault(); await backend.saveRules(r); onSaved(); }}>
        {num("examFee", `${t("ruleExamFee")}（JPY）`)}
        <fieldset className="field" style={{ border: 0, padding: 0, margin: "0 0 14px" }}>
          <span>{t("ruleExamFeeWhen")}</span>
          {([[false, t("ruleAnyResult")], [true, t("ruleOnlyPassed")]] as const).map(([v, label]) => (
            <label key={String(v)} className="radio-row">
              <input type="radio" name="examFeeOnlyIfPassed" checked={!!r.examFeeOnlyIfPassed === v} onChange={() => setR({ ...r, examFeeOnlyIfPassed: v })} />
              {label}
            </label>
          ))}
        </fieldset>
        {num("passBonus", `${t("rulePassBonus")}（JPY）`)}
        {num("minSeriousness", t("ruleMinSerious"), 100)}
        {num("minMinutes", t("ruleMinMinutes"))}
        <button className="btn primary" type="submit">{t("save")}</button>
      </form>
    </div>
  );
}

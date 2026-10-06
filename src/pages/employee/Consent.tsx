import { useI18n } from "../../i18n";

export default function Consent({ onAgree }: { onAgree: () => void }) {
  const { t } = useI18n();
  return (
    <div className="card" style={{ marginTop: 24 }}>
      <h2>{t("consentTitle")}</h2>
      <p>{t("consentBody")}</p>
      <button className="btn primary" onClick={onAgree}>{t("consentAgree")}</button>
    </div>
  );
}

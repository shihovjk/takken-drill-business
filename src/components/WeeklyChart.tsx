import type { Week } from "@core/metrics.ts";
import { useI18n } from "../i18n";

// Study minutes per week (bars) with the median seconds per question underneath
export default function WeeklyChart({ weeks }: { weeks: Week[] }) {
  const { lang } = useI18n();
  const max = Math.max(60, ...weeks.map((w) => w.minutes));
  const W = 460, H = 130, pad = 22, bw = (W - pad) / weeks.length;
  return (
    <svg viewBox={`0 0 ${W} ${H + 34}`} width="100%" role="img" aria-label={lang === "ja" ? "直近8週の学習時間" : "Study minutes for the last 8 weeks"}>
      <line x1={pad} x2={W} y1={H} y2={H} stroke="#e2e8f0" />
      {weeks.map((w, i) => {
        const h = Math.round((w.minutes / max) * (H - 16));
        const x = pad + i * bw + bw * 0.18;
        const fast = w.medianSec != null && w.medianSec < 20;
        return (
          <g key={w.weekStart}>
            <rect x={x} y={H - h} width={bw * 0.64} height={Math.max(h, 1)} rx={4} fill={fast ? "#f87171" : "#3b82f6"} opacity={i === weeks.length - 1 ? 1 : 0.8} />
            <text x={x + bw * 0.32} y={H - h - 4} fontSize={10.5} textAnchor="middle" fill="#4a5568">{w.minutes}</text>
            <text x={x + bw * 0.32} y={H + 14} fontSize={10} textAnchor="middle" fill="#718096">{w.weekStart.slice(5).replace("-", "/")}</text>
            <text x={x + bw * 0.32} y={H + 28} fontSize={10} textAnchor="middle" fill={fast ? "#c53030" : "#a0aec0"}>{w.medianSec == null ? "—" : `${w.medianSec}${lang === "ja" ? "秒" : "s"}`}</text>
          </g>
        );
      })}
      <text x={0} y={H + 14} fontSize={9.5} fill="#a0aec0">{lang === "ja" ? "週" : "wk"}</text>
      <text x={0} y={H + 28} fontSize={9.5} fill="#a0aec0">{lang === "ja" ? "速度" : "sec"}</text>
      <text x={0} y={10} fontSize={9.5} fill="#a0aec0">{lang === "ja" ? "分" : "min"}</text>
    </svg>
  );
}

import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type ICellRendererParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useMemo } from "react";
import { useI18n } from "../../i18n";
import type { EmployeeRow } from "../../lib/types";
import { matches } from "./Dashboard";

ModuleRegistry.registerModules([AllCommunityModule]);

export type Filter = "all" | "follow" | "pending" | "paid";

const theme = themeQuartz.withParams({
  fontFamily: "inherit",
  fontSize: 13,
  headerFontWeight: 700,
  headerBackgroundColor: "#f8fafc",
  headerTextColor: "#4a5568",
  borderColor: "#e2e8f0",
  rowHoverColor: "#f5f8ff",
  selectedRowBackgroundColor: "#e8efff",
  accentColor: "#1d4ed8",
  wrapperBorder: false,
  wrapperBorderRadius: 0,
  cellHorizontalPadding: 12,
});

// Who can be ticked for "approve & pay": pending, approved or a failed payout to retry, with a PayPal account
const PAYABLE = ["proposed", "approved", "failed"];

// Slow enough to read a 4-choice question is about a minute; under 20 s with high accuracy is suspicious
const FAST = 20;

export default function EmployeeGrid({ rows, filter, onOpen, onSelect }: {
  rows: EmployeeRow[]; filter: Filter; onOpen: (id: string) => void; onSelect: (ids: string[]) => void;
}) {
  const { t, pick, yen, lang } = useI18n();
  const data = useMemo(() => rows.filter((r) => matches(r, filter)), [rows, filter]);

  const cols = useMemo<ColDef<EmployeeRow>[]>(() => [
    {
      // The status sits next to the name, so it is clear who can be ticked for payment
      colId: "name", headerName: t("colName"), pinned: "left", width: 230,
      valueGetter: (p) => pick(p.data!.name, p.data!.nameEn),
      cellRenderer: (p: ICellRendererParams<EmployeeRow>) => {
        const st = p.data!.award?.status ?? "none";
        return (
          <div className="cell-name">
            <b>
              {pick(p.data!.name, p.data!.nameEn)} <span className={`badge b-${st}`}>{t(`st_${st}` as never)}</span>
              {PAYABLE.includes(st) && !p.data!.payeeReady && <> <span className="badge b-none">{t("noPayeeShort")}</span></>}
            </b>
            <span>{pick(p.data!.dept, p.data!.deptEn)}</span>
          </div>
        );
      },
    },
    {
      colId: "time", headerName: t("colTime"), width: 105, type: "rightAligned",
      valueGetter: (p) => p.data!.metrics.minutes,
      valueFormatter: (p) => `${(p.value / 60).toFixed(1)}${lang === "ja" ? "時間" : " h"}`,
    },
    {
      colId: "acc", headerName: t("colAcc"), width: 90, type: "rightAligned",
      valueGetter: (p) => p.data!.metrics.accuracy,
      valueFormatter: (p) => (p.value == null ? "—" : `${p.value}%`),
    },
    {
      colId: "speed", headerName: t("colSpeed"), width: 105, type: "rightAligned",
      valueGetter: (p) => p.data!.metrics.medianSec,
      cellRenderer: (p: ICellRendererParams<EmployeeRow>) => p.value == null ? "—"
        : <span className={p.value < FAST ? "lo" : ""}>{p.value}{lang === "ja" ? "秒" : " s"}</span>,
    },
    {
      colId: "serious", headerName: t("colSerious"), width: 140,
      valueGetter: (p) => p.data!.judgement?.seriousness ?? null,
      cellRenderer: Meter,
    },
    {
      colId: "pass", headerName: t("colPass"), width: 150,
      valueGetter: (p) => p.data!.judgement?.pass_probability ?? null,
      cellRenderer: Meter,
    },
    {
      colId: "comment", headerName: t("colComment"), flex: 1, minWidth: 200, wrapText: true, autoHeight: true,
      valueGetter: (p) => (p.data!.judgement ? pick(p.data!.judgement.one_liner_ja, p.data!.judgement.one_liner_en) : ""),
      cellRenderer: (p: ICellRendererParams<EmployeeRow>) => <div className="ai-note">{p.value || <span className="muted">—</span>}</div>,
    },
    {
      colId: "award", headerName: t("colAward"), width: 150, type: "rightAligned",
      valueGetter: (p) => (p.data!.award ? p.data!.award.examFee + p.data!.award.passBonus : null),
      valueFormatter: (p) => (p.value == null ? "—" : yen(p.value)),
    },
  ], [t, pick, yen, lang]);

  return (
    <div style={{ height: 620 }}>
      <AgGridReact<EmployeeRow>
        theme={theme}
        rowData={data}
        columnDefs={cols}
        defaultColDef={{ sortable: true, resizable: true, suppressMovable: true }}
        getRowId={(p) => p.data.userId}
        rowHeight={56}
        rowSelection={{ mode: "multiRow", isRowSelectable: (n) => PAYABLE.includes(n.data?.award?.status ?? "") && !!n.data?.payeeReady, headerCheckbox: true }}
        selectionColumnDef={{ pinned: "left", width: 48 }}
        onSelectionChanged={(e) => onSelect(e.api.getSelectedRows().map((r) => r.userId))}
        onCellClicked={(e) => { if (e.column.getColId() !== "ag-Grid-SelectionColumn") onOpen(e.data!.userId); }}
        rowClass="clickable-row"
        animateRows
      />
    </div>
  );
}

function Meter(p: ICellRendererParams<EmployeeRow>) {
  if (p.value == null) return <span className="muted">—</span>;
  const v = p.value as number;
  const color = v >= 70 ? "var(--ok)" : v >= 45 ? "var(--warn)" : "var(--bad)";
  return <div className="meter"><div className="bar"><i style={{ width: `${v}%`, background: color }} /></div><b>{v}</b></div>;
}

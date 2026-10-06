import type { PayoutProvider } from "./provider.ts";

// Exports approved awards for the payroll system instead of sending money.
const esc = (v: string | number) => `"${String(v).replaceAll('"', '""')}"`;

export const payrollCsv: PayoutProvider = {
  id: "payroll_csv",
  async send(items, { senderBatchId }) {
    const lines = [["award_id", "employee_id", "name", "amount", "currency", "item"].map(esc).join(",")];
    for (const i of items) lines.push([i.awardId, i.userId, i.name, i.amount, i.currency, "宅建 受験費用・合格奨励金"].map(esc).join(","));
    return {
      status: "exported",
      providerBatchId: senderBatchId,
      items: items.map((i) => ({ awardId: i.awardId, providerItemId: null })),
      file: { name: `takken-awards-${senderBatchId}.csv`, mime: "text/csv", content: "﻿" + lines.join("\r\n") },
    };
  },
};

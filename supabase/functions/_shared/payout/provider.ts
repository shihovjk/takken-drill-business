// How approved awards turn into money. The approval flow (AI proposal -> admin confirms) never
// depends on which provider is used; a company switches provider with companies.payout_provider.
//   paypal_payouts : PayPal Payouts from the company's own PayPal Business account (hackathon)
//   payroll_csv    : a CSV for the payroll system (awards may be taxable as salary in Japan)
// A bank-transfer (Zengin format) provider can be added the same way.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type PayItem = { awardId: string; userId: string; name: string; amount: number; currency: string; payerId: string | null; email: string | null };
export type SendResult = {
  status: "processing" | "exported"; // processing = wait for the provider's webhook; exported = done on our side
  providerBatchId: string | null;
  items: { awardId: string; providerItemId: string | null; error?: string }[];
  file?: { name: string; mime: string; content: string }; // for export-style providers
};

export interface PayoutProvider {
  id: "paypal_payouts" | "payroll_csv";
  send(items: PayItem[], ctx: { db: SupabaseClient; companyId: string; senderBatchId: string }): Promise<SendResult>;
}

export async function providerFor(id: string): Promise<PayoutProvider> {
  if (id === "payroll_csv") return (await import("./payrollCsv.ts")).payrollCsv;
  return (await import("./paypalPayouts.ts")).paypalPayouts;
}

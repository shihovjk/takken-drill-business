import { decrypt } from "../crypto.ts";
import { paypal } from "../paypal.ts";
import type { PayoutProvider } from "./provider.ts";

// One PayPal payout batch per approval click. sender_batch_id makes a retry of the same batch a no-op
// on PayPal's side, so an employee is never paid twice. Final status arrives via paypal-webhook.
export const paypalPayouts: PayoutProvider = {
  id: "paypal_payouts",
  async send(items, { db, companyId, senderBatchId }) {
    const { data: conn } = await db.from("paypal_connections").select("client_id, secret_enc").eq("company_id", companyId).maybeSingle();
    if (!conn) throw new Error("PayPal is not connected for this company");
    const creds = { clientId: conn.client_id, secret: await decrypt(conn.secret_enc) };
    const res = await paypal<{ batch_header: { payout_batch_id: string } }>(creds, "/v1/payments/payouts", {
      method: "POST",
      body: {
        sender_batch_header: {
          sender_batch_id: senderBatchId,
          email_subject: "宅建の受験費用・合格奨励金のお支払い / Your Takken exam support",
          email_message: "会社から受験費用・合格奨励金をお送りしました。 Your company has sent your exam support.",
        },
        items: items.map((i) => ({
          // Prefer the verified PayPal ID from "Log in with PayPal"
          recipient_type: i.payerId ? "PAYPAL_ID" : "EMAIL",
          receiver: i.payerId ?? i.email,
          amount: { value: String(i.amount), currency: i.currency }, // JPY has no decimals
          sender_item_id: i.awardId,
          note: "Takken Drill for Business",
        })),
      },
    });
    // Item IDs come with the webhook (matched by sender_item_id = award id)
    return { status: "processing", providerBatchId: res.batch_header.payout_batch_id, items: items.map((i) => ({ awardId: i.awardId, providerItemId: null })) };
  },
};

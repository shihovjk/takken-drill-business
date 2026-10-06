// PayPal webhooks.
//   ?company=<id> : Payouts events from that company's own PayPal app (registered by paypal-connect)
//   (no param)    : Subscription events from this app's own PayPal app (the monthly fee)
// Every event is verified with PayPal and handled once (webhook_events).
// Deploy with "Verify JWT" off: PayPal does not send a Supabase login.
import { decrypt } from "../_shared/crypto.ts";
import { admin } from "../_shared/http.ts";
import { appCreds, type Creds, verifyWebhook } from "../_shared/paypal.ts";

type Event = { id: string; event_type: string; resource: Record<string, any> };

const ITEM_STATUS: Record<string, string> = {
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED": "paid",
  "PAYMENT.PAYOUTS-ITEM.FAILED": "failed",
  "PAYMENT.PAYOUTS-ITEM.RETURNED": "failed",
  "PAYMENT.PAYOUTS-ITEM.BLOCKED": "failed",
  "PAYMENT.PAYOUTS-ITEM.CANCELED": "failed",
  "PAYMENT.PAYOUTS-ITEM.DENIED": "failed",
  "PAYMENT.PAYOUTS-ITEM.UNCLAIMED": "processing", // the employee has 30 days to claim
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  const db = admin();
  const raw = await req.text();
  const companyId = new URL(req.url).searchParams.get("company");

  let creds: Creds, webhookId: string | undefined;
  if (companyId) {
    const { data: c } = await db.from("paypal_connections").select("client_id, secret_enc, webhook_id").eq("company_id", companyId).maybeSingle();
    if (!c?.webhook_id) return new Response("unknown company", { status: 404 });
    creds = { clientId: c.client_id, secret: await decrypt(c.secret_enc) };
    webhookId = c.webhook_id;
  } else {
    creds = appCreds();
    webhookId = Deno.env.get("PAYPAL_WEBHOOK_ID");
  }
  if (!webhookId || !(await verifyWebhook(creds, webhookId, req, raw).catch(() => false))) {
    return new Response("bad signature", { status: 400 });
  }

  const ev: Event = JSON.parse(raw);
  const { error: dup } = await db.from("webhook_events").insert({ id: ev.id, type: ev.event_type });
  if (dup) return new Response("already handled"); // unique id: seen before

  const now = new Date().toISOString();
  const r = ev.resource;
  if (ev.event_type in ITEM_STATUS && companyId) {
    const awardId = r.payout_item?.sender_item_id as string;
    const status = ITEM_STATUS[ev.event_type];
    await db.from("payout_items").update({ status: r.transaction_status, provider_item_id: r.payout_item_id, error: r.errors?.message ?? null, updated_at: now }).eq("award_id", awardId).eq("status", "PENDING");
    await db.from("awards").update({ status, paid_at: status === "paid" ? now : null, updated_at: now }).eq("id", awardId).eq("company_id", companyId);
  } else if (ev.event_type.startsWith("PAYMENT.PAYOUTSBATCH.") && companyId) {
    await db.from("payout_batches").update({ status: r.batch_header?.batch_status }).eq("provider_batch_id", r.batch_header?.payout_batch_id).eq("company_id", companyId);
  } else if (ev.event_type.startsWith("BILLING.SUBSCRIPTION.")) {
    // custom_id carries our company id (set when the subscription was created in the browser)
    await db.from("subscriptions").upsert({
      company_id: r.custom_id, paypal_subscription_id: r.id, plan_id: r.plan_id, status: String(r.status ?? "").toLowerCase(),
      next_billing_at: r.billing_info?.next_billing_time ?? null, updated_at: now,
    });
  } else if (ev.event_type === "PAYMENT.SALE.COMPLETED" && r.billing_agreement_id) {
    await db.from("subscriptions").update({ status: "active", updated_at: now }).eq("paypal_subscription_id", r.billing_agreement_id);
  }
  return new Response("ok");
});

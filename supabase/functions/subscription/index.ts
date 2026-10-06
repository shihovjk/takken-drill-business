// The company's monthly fee for this app (PayPal Subscriptions, paid to the app operator).
// The browser shows PayPal's subscription button with PAYPAL_PLAN_ID and custom_id = company id;
// after approval it sends the subscription ID here and we confirm it with PayPal.
// Later changes (renewals, cancellation) arrive via paypal-webhook.
import { caller, HttpError, serve } from "../_shared/http.ts";
import { appCreds, paypal } from "../_shared/paypal.ts";

serve(async (req, body, db) => {
  const me = await caller(req, db, "admin");
  if (body.action === "config") return { clientId: Deno.env.get("PAYPAL_CLIENT_ID"), planId: Deno.env.get("PAYPAL_PLAN_ID"), companyId: me.companyId };
  if (body.action === "status") {
    const { data } = await db.from("subscriptions").select("status, next_billing_at").eq("company_id", me.companyId).maybeSingle();
    return data ?? { status: "none" };
  }
  if (body.action !== "activate") throw new HttpError(400, "action");
  const id = String(body.subscriptionId ?? "");
  const s = await paypal<{ id: string; status: string; plan_id: string; custom_id?: string; billing_info?: { next_billing_time?: string } }>(appCreds(), `/v1/billing/subscriptions/${encodeURIComponent(id)}`);
  if (s.custom_id !== me.companyId) throw new HttpError(400, "subscription belongs to another company");
  await db.from("subscriptions").upsert({
    company_id: me.companyId, paypal_subscription_id: s.id, plan_id: s.plan_id, status: s.status.toLowerCase(),
    next_billing_at: s.billing_info?.next_billing_time ?? null, updated_at: new Date().toISOString(),
  });
  return { status: s.status.toLowerCase() };
});

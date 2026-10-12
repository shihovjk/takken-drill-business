// The company's monthly fee for this app (PayPal Subscriptions, paid to the app operator).
// PAYPAL_PLAN_ID is a per-employee plan (quantity_supported): PayPal bills the plan price x quantity.
// The browser shows PayPal's subscription button with quantity = employee count and custom_id = company id;
// after approval it sends the subscription ID here and we confirm it with PayPal.
// Later changes (renewals, cancellation) arrive via paypal-webhook. When the employee count changes,
// syncSeats asks PayPal to change the billed quantity (see _shared/seats.ts).
import { caller, HttpError, serve } from "../_shared/http.ts";
import { appCreds, paypal } from "../_shared/paypal.ts";
import { employeeCount, refreshFromPayPal, syncSeats } from "../_shared/seats.ts";

type Plan = { billing_cycles: { pricing_scheme: { fixed_price: { value: string } } }[] };
const unitPrice = async (planId: string) => {
  const p = await paypal<Plan>(appCreds(), `/v1/billing/plans/${encodeURIComponent(planId)}`);
  return Number(p.billing_cycles.at(-1)?.pricing_scheme.fixed_price.value ?? 0);
};

serve(async (req, body, db) => {
  const me = await caller(req, db, "admin");
  if (body.action === "config") {
    const planId = Deno.env.get("PAYPAL_PLAN_ID") ?? "";
    return { clientId: Deno.env.get("PAYPAL_CLIENT_ID"), planId, companyId: me.companyId, seats: await employeeCount(db, me.companyId), unitPrice: planId ? await unitPrice(planId) : 0 };
  }
  if (body.action === "status") {
    // Opening the page also catches a changed employee count, or a change the admin just approved
    try {
      await syncSeats(db, me.companyId);
      const { data: p } = await db.from("subscriptions").select("paypal_subscription_id, pending_quantity").eq("company_id", me.companyId).maybeSingle();
      if (p?.pending_quantity != null) await refreshFromPayPal(db, me.companyId, p.paypal_subscription_id);
    } catch (e) { console.error(e); }
    const { data } = await db.from("subscriptions").select("status, next_billing_at, quantity, unit_price, pending_quantity, approve_url").eq("company_id", me.companyId).maybeSingle();
    return data ?? { status: "none" };
  }
  if (body.action !== "activate") throw new HttpError(400, "action");
  const id = String(body.subscriptionId ?? "");
  const s = await paypal<{ id: string; status: string; plan_id: string; quantity?: string; custom_id?: string; billing_info?: { next_billing_time?: string } }>(appCreds(), `/v1/billing/subscriptions/${encodeURIComponent(id)}`);
  if (s.custom_id !== me.companyId) throw new HttpError(400, "subscription belongs to another company");
  await db.from("subscriptions").upsert({
    company_id: me.companyId, paypal_subscription_id: s.id, plan_id: s.plan_id, status: s.status.toLowerCase(),
    quantity: Number(s.quantity ?? 1), unit_price: await unitPrice(s.plan_id), pending_quantity: null, approve_url: null,
    next_billing_at: s.billing_info?.next_billing_time ?? null, updated_at: new Date().toISOString(),
  });
  return { status: s.status.toLowerCase() };
});

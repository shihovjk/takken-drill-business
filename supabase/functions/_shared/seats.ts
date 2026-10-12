// Keeps the billed quantity of the company's subscription equal to its employee count.
// PayPal changes the quantity through "revise". When it needs the subscriber's consent (the amount
// changes), it returns an approve link; we keep it so the admin can approve from the PayPal page.
// The new quantity is saved when PayPal reports it (status refresh or BILLING.SUBSCRIPTION.UPDATED).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { appCreds, paypal } from "./paypal.ts";

type Link = { rel: string; href: string };

export async function employeeCount(db: SupabaseClient, companyId: string): Promise<number> {
  const { count } = await db.from("company_members").select("user_id", { count: "exact", head: true }).eq("company_id", companyId).eq("role", "employee");
  return Math.max(1, count ?? 0);
}

// Pull the subscription from PayPal; clears the pending change once PayPal shows the new quantity
export async function refreshFromPayPal(db: SupabaseClient, companyId: string, subscriptionId: string) {
  const s = await paypal<{ status: string; quantity?: string; billing_info?: { next_billing_time?: string } }>(appCreds(), `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`);
  const quantity = Number(s.quantity ?? 1);
  const { data: sub } = await db.from("subscriptions").select("pending_quantity").eq("company_id", companyId).maybeSingle();
  const done = sub?.pending_quantity === quantity;
  await db.from("subscriptions").update({
    status: s.status.toLowerCase(), quantity, next_billing_at: s.billing_info?.next_billing_time ?? null, updated_at: new Date().toISOString(),
    ...(done ? { pending_quantity: null, approve_url: null } : {}),
  }).eq("company_id", companyId);
}

export async function syncSeats(db: SupabaseClient, companyId: string): Promise<void> {
  const { data: sub } = await db.from("subscriptions").select("paypal_subscription_id, plan_id, status, quantity, pending_quantity").eq("company_id", companyId).maybeSingle();
  // Only per-employee subscriptions (quantity is saved for those since the seats migration)
  if (!sub?.paypal_subscription_id || sub.status !== "active" || sub.quantity == null) return;
  const seats = await employeeCount(db, companyId);
  if (seats === (sub.pending_quantity ?? sub.quantity)) return;
  if (seats === sub.quantity) {
    await db.from("subscriptions").update({ pending_quantity: null, approve_url: null, updated_at: new Date().toISOString() }).eq("company_id", companyId);
    return;
  }
  const plan = await paypal<{ quantity_supported?: boolean }>(appCreds(), `/v1/billing/plans/${encodeURIComponent(sub.plan_id)}`);
  if (!plan.quantity_supported) return; // a flat plan has nothing to change
  const site = Deno.env.get("SITE_URL") ?? "http://localhost:5180";
  const r = await paypal<{ links?: Link[] }>(appCreds(), `/v1/billing/subscriptions/${encodeURIComponent(sub.paypal_subscription_id)}/revise`, {
    method: "POST",
    body: { plan_id: sub.plan_id, quantity: String(seats), application_context: { return_url: `${site}/?subscription=updated`, cancel_url: `${site}/` } },
  });
  const approve = r.links?.find((l) => l.rel === "approve")?.href ?? null;
  if (approve) {
    await db.from("subscriptions").update({ pending_quantity: seats, approve_url: approve, updated_at: new Date().toISOString() }).eq("company_id", companyId);
  } else {
    await db.from("subscriptions").update({ quantity: seats, pending_quantity: null, approve_url: null, updated_at: new Date().toISOString() }).eq("company_id", companyId);
  }
}

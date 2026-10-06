// The company admin connects the company's own PayPal Business account (a REST app's client ID
// and secret). We check the credentials with PayPal, register this app's webhook URL on the
// company's app (so payout results come back to us), and store the secret encrypted.
//   { action: "connect", clientId, secret } | { action: "status" } | { action: "disconnect" }
import { decrypt, encrypt } from "../_shared/crypto.ts";
import { caller, HttpError, serve } from "../_shared/http.ts";
import { paypal } from "../_shared/paypal.ts";

const PAYOUT_EVENTS = [
  "PAYMENT.PAYOUTSBATCH.SUCCESS", "PAYMENT.PAYOUTSBATCH.DENIED", "PAYMENT.PAYOUTSBATCH.PROCESSING",
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", "PAYMENT.PAYOUTS-ITEM.FAILED", "PAYMENT.PAYOUTS-ITEM.RETURNED", "PAYMENT.PAYOUTS-ITEM.BLOCKED",
  "PAYMENT.PAYOUTS-ITEM.CANCELED", "PAYMENT.PAYOUTS-ITEM.DENIED", "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
];

serve(async (req, body, db) => {
  const me = await caller(req, db, "admin");

  if (body.action === "status") {
    const { data } = await db.from("paypal_connections").select("client_id, secret_enc, merchant_email, verified_at").eq("company_id", me.companyId).maybeSingle();
    if (!data) return { connected: false };
    // Balance of the company's PayPal account (needs the app's reporting permission; optional)
    const creds = { clientId: data.client_id, secret: await decrypt(data.secret_enc) };
    const bal = await paypal<{ balances?: { currency: string; available_balance?: { value: string } }[] }>(creds, "/v1/reporting/balances?currency_code=JPY").catch(() => null);
    const jpy = bal?.balances?.find((b) => b.currency === "JPY")?.available_balance?.value;
    return { connected: true, clientId: `${data.client_id.slice(0, 6)}…`, merchantEmail: data.merchant_email, verifiedAt: data.verified_at, balance: jpy ? Number(jpy) : null };
  }
  if (body.action === "disconnect") {
    await db.from("paypal_connections").delete().eq("company_id", me.companyId);
    return {};
  }
  if (body.action !== "connect") throw new HttpError(400, "action");

  const creds = { clientId: String(body.clientId ?? "").trim(), secret: String(body.secret ?? "").trim() };
  if (!creds.clientId || !creds.secret) throw new HttpError(400, "clientId and secret are required");
  // Fails here if the credentials are wrong
  const info = await paypal<{ email?: string; payer_id?: string }>(creds, "/v1/identity/oauth2/userinfo?schema=paypalv1.1").catch(() => ({} as { email?: string }));

  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/paypal-webhook?company=${me.companyId}`;
  const existing = await paypal<{ webhooks: { id: string; url: string }[] }>(creds, "/v1/notifications/webhooks");
  const hook = existing.webhooks.find((w) => w.url === url)
    ?? await paypal<{ id: string }>(creds, "/v1/notifications/webhooks", { method: "POST", body: { url, event_types: PAYOUT_EVENTS.map((name) => ({ name })) } });

  await db.from("paypal_connections").upsert({
    company_id: me.companyId, client_id: creds.clientId, secret_enc: await encrypt(creds.secret),
    merchant_email: info.email ?? null, webhook_id: hook.id, verified_at: new Date().toISOString(),
  });
  return { connected: true, merchantEmail: info.email ?? null };
});

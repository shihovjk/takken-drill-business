// "Log in with PayPal" for employees: the browser gets an authorization code from PayPal and sends
// it here. We exchange it with this app's credentials and keep the verified PayPal account ID,
// so payouts go to the right person (recipient_type PAYPAL_ID), not to a mistyped email.
import { caller, HttpError, serve } from "../_shared/http.ts";
import { appCreds, PAYPAL_API } from "../_shared/paypal.ts";

serve(async (req, body, db) => {
  const me = await caller(req, db);
  const code = String(body.code ?? "");
  if (!code) throw new HttpError(400, "code");
  const c = appCreds();
  const tok = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${c.clientId}:${c.secret}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code }),
  });
  if (!tok.ok) throw new HttpError(400, "PayPal login was not completed");
  const { access_token } = await tok.json();
  const ui = await fetch(`${PAYPAL_API}/v1/identity/openidconnect/userinfo?schema=openid`, { headers: { Authorization: `Bearer ${access_token}` } });
  if (!ui.ok) throw new HttpError(400, "could not read the PayPal account");
  const info = await ui.json();
  // payer_id needs the "paypalattributes" scope; fall back to the verified email
  const payerId = info.payer_id ?? null;
  const email = info.email ?? info.emails?.find((e: { primary?: boolean }) => e.primary)?.value ?? null;
  if (!payerId && !email) throw new HttpError(400, "no PayPal account ID or email returned");
  await db.from("payees").upsert({ user_id: me.userId, paypal_payer_id: payerId, paypal_email: email, verified_at: new Date().toISOString() });
  return { email };
});

// Minimal PayPal REST client (sandbox by default). Used with two sets of credentials:
//  - the company's own app (Payouts: money goes from the company's account to employees)
//  - this app's own app (Log in with PayPal, Subscriptions for the monthly fee)
export const PAYPAL_API = Deno.env.get("PAYPAL_API") ?? "https://api-m.sandbox.paypal.com";

export type Creds = { clientId: string; secret: string };
export const appCreds = (): Creds => ({ clientId: Deno.env.get("PAYPAL_CLIENT_ID")!, secret: Deno.env.get("PAYPAL_CLIENT_SECRET")! });

const basic = (c: Creds) => `Basic ${btoa(`${c.clientId}:${c.secret}`)}`;

export async function accessToken(c: Creds): Promise<string> {
  const r = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: basic(c), "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new Error(`PayPal auth failed (${r.status})`);
  return (await r.json()).access_token;
}

export async function paypal<T = Record<string, unknown>>(c: Creds, path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  const r = await fetch(`${PAYPAL_API}${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${await accessToken(c)}`, "Content-Type": "application/json", ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await r.text();
  const json = text ? JSON.parse(text) : {};
  if (!r.ok) throw new Error(`PayPal ${path} ${r.status}: ${json.name ?? ""} ${json.message ?? text.slice(0, 200)}`);
  return json as T;
}

// Ask PayPal whether a webhook really came from PayPal for this webhook ID
export async function verifyWebhook(c: Creds, webhookId: string, req: Request, rawBody: string): Promise<boolean> {
  const h = (k: string) => req.headers.get(k) ?? "";
  const res = await paypal<{ verification_status: string }>(c, "/v1/notifications/verify-webhook-signature", {
    method: "POST",
    body: {
      auth_algo: h("paypal-auth-algo"), cert_url: h("paypal-cert-url"), transmission_id: h("paypal-transmission-id"),
      transmission_sig: h("paypal-transmission-sig"), transmission_time: h("paypal-transmission-time"),
      webhook_id: webhookId, webhook_event: JSON.parse(rawBody),
    },
  });
  return res.verification_status === "SUCCESS";
}

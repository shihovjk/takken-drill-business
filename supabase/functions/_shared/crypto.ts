// AES-GCM for the company's PayPal secret. The key (PAYPAL_CRED_KEY, 32 random bytes in base64)
// exists only in the Edge Function secrets, so the database alone cannot reveal the secret.
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function key() {
  return crypto.subtle.importKey("raw", unb64(Deno.env.get("PAYPAL_CRED_KEY")!), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encrypt(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(plain)));
  return `${b64(iv)}.${b64(ct)}`;
}

export async function decrypt(enc: string): Promise<string> {
  const [iv, ct] = enc.split(".").map(unb64);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await key(), ct));
}

export async function sha256(s: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
}

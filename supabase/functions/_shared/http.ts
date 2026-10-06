// Shared request handling for the Edge Functions: CORS, JSON replies, and "who is calling".
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "http://localhost:5180").split(",").map((s) => s.trim());

export function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ORIGINS.includes(origin) ? origin : ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

export const admin = (): SupabaseClient =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export type Caller = { userId: string; email: string | undefined; companyId: string; role: "admin" | "employee" };

// Wraps a handler: answers preflight, parses JSON, turns thrown HttpErrors into replies
export function serve(handler: (req: Request, body: Record<string, unknown>, db: SupabaseClient) => Promise<unknown>) {
  Deno.serve(async (req) => {
    const headers = { ...cors(req.headers.get("origin")), "Content-Type": "application/json" };
    if (req.method === "OPTIONS") return new Response("ok", { headers });
    if (req.method !== "POST") return new Response(JSON.stringify({ error: "method" }), { status: 405, headers });
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* empty body is fine */ }
    try {
      return new Response(JSON.stringify(await handler(req, body, admin()) ?? { ok: true }), { headers });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status, headers });
    }
  });
}

// The signed-in user and their company membership (from the JWT the browser sends)
export async function caller(req: Request, db: SupabaseClient, need?: "admin"): Promise<Caller> {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  const { data: { user } } = await db.auth.getUser(jwt);
  if (!user) throw new HttpError(401, "login");
  const { data: m } = await db.from("company_members").select("company_id, role").eq("user_id", user.id).limit(1).maybeSingle();
  if (!m) throw new HttpError(403, "no company");
  if (need === "admin" && m.role !== "admin") throw new HttpError(403, "admin only");
  return { userId: user.id, email: user.email, companyId: m.company_id, role: m.role };
}

export const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 500) : []);

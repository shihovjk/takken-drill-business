// Inviting employees and joining a company.
//   { action: "create", email, name, department?, role? } (admin): sends Supabase's invite email
//   { action: "accept", token }                         (the invited user, after signing in)
import { caller, HttpError, serve } from "../_shared/http.ts";

serve(async (req, body, db) => {
  if (body.action === "create") {
    const me = await caller(req, db, "admin");
    const email = String(body.email ?? "").trim().toLowerCase();
    const name = String(body.name ?? "").trim().slice(0, 100);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name) throw new HttpError(400, "email and name are required");
    const { data: inv, error } = await db.from("invitations").insert({
      company_id: me.companyId, email, display_name: name, department: String(body.department ?? "").slice(0, 100) || null,
      role: body.role === "admin" ? "admin" : "employee", created_by: me.userId,
    }).select("token").single();
    if (error) throw error;
    const site = Deno.env.get("SITE_URL") ?? "http://localhost:5180";
    const { error: mailError } = await db.auth.admin.inviteUserByEmail(email, { redirectTo: `${site}/?invite=${inv.token}` });
    // An existing account cannot be "invited" again; they can still join with the link
    return { link: `${site}/?invite=${inv.token}`, emailed: !mailError };
  }

  if (body.action === "accept") {
    const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
    const { data: { user } } = await db.auth.getUser(jwt);
    if (!user) throw new HttpError(401, "login");
    const { data: inv } = await db.from("invitations").select("*").eq("token", String(body.token ?? "")).is("accepted_at", null).maybeSingle();
    if (!inv || new Date(inv.expires_at) < new Date()) throw new HttpError(404, "invitation not found or expired");
    if (inv.email !== user.email?.toLowerCase()) throw new HttpError(403, "this invitation is for another email address");
    await db.from("company_members").upsert({ company_id: inv.company_id, user_id: user.id, role: inv.role, display_name: inv.display_name, department: inv.department });
    await db.from("invitations").update({ accepted_at: new Date().toISOString() }).eq("id", inv.id);
    return { companyId: inv.company_id };
  }
  throw new HttpError(400, "action");
});

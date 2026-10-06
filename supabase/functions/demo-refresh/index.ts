// Upkeep for the public demo company.
//   Daily cron (header x-cron-secret = CRON_SECRET): keep the study log current; also keeps the
//   free Supabase project from pausing during the judging period.
//   Admin of the demo company ({ action: "reset" }): undo everyone's clicks.
import { caller, HttpError, serve } from "../_shared/http.ts";

serve(async (req, body, db) => {
  const { data: demos } = await db.from("companies").select("id").eq("is_demo", true);
  if (req.headers.get("x-cron-secret") && req.headers.get("x-cron-secret") === Deno.env.get("CRON_SECRET")) {
    for (const c of demos ?? []) await db.rpc("demo_shift_time", { cid: c.id });
    return { shifted: demos?.length ?? 0 };
  }
  const me = await caller(req, db, "admin");
  if (body.action !== "reset" || !(demos ?? []).some((c) => c.id === me.companyId)) throw new HttpError(403, "demo company only");
  await db.rpc("demo_shift_time", { cid: me.companyId });
  await db.rpc("demo_reset", { cid: me.companyId });
  return { reset: true };
});

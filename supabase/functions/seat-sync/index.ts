// Daily cron (header x-cron-secret = CRON_SECRET): match every active subscription's billed
// quantity to the company's employee count. Catches employees removed outside the app.
import { HttpError, serve } from "../_shared/http.ts";
import { syncSeats } from "../_shared/seats.ts";

serve(async (req, _body, db) => {
  if (!req.headers.get("x-cron-secret") || req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) throw new HttpError(403, "cron only");
  const { data: subs } = await db.from("subscriptions").select("company_id").eq("status", "active").not("quantity", "is", null);
  let failed = 0;
  for (const s of subs ?? []) await syncSeats(db, s.company_id).catch((e) => { failed++; console.error(s.company_id, e); });
  return { checked: subs?.length ?? 0, failed };
});

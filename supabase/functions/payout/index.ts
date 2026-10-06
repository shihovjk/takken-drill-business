// Pay approved awards with the company's payout provider (admin only).
// Awards move approved -> processing (PayPal; the webhook finishes them) or -> exported (CSV).
import { caller, HttpError, ids, serve } from "../_shared/http.ts";
import { providerFor, type PayItem } from "../_shared/payout/provider.ts";

const DEMO_MAX = 3;

serve(async (req, body, db) => {
  const me = await caller(req, db, "admin");
  const { data: company } = await db.from("companies").select("payout_provider, is_demo").eq("id", me.companyId).single();
  // The public demo shares one sandbox balance: keep each click small
  if (company!.is_demo && ids(body.ids).length > DEMO_MAX) throw new HttpError(400, `demo: up to ${DEMO_MAX} employees per payout`);
  const provider = await providerFor(company!.payout_provider);

  const { data: awards } = await db.from("awards").select("id, user_id, exam_fee, pass_bonus, currency")
    .eq("company_id", me.companyId).in("user_id", ids(body.ids)).in("status", ["approved", "failed"]);
  if (!awards?.length) throw new HttpError(400, "nothing approved to pay");
  const userIds = awards.map((a) => a.user_id);
  const [{ data: payees }, { data: members }] = await Promise.all([
    db.from("payees").select("user_id, paypal_payer_id, paypal_email").in("user_id", userIds),
    db.from("company_members").select("user_id, display_name").eq("company_id", me.companyId).in("user_id", userIds),
  ]);
  const payee = Object.fromEntries((payees ?? []).map((p) => [p.user_id, p]));
  const name = Object.fromEntries((members ?? []).map((m) => [m.user_id, m.display_name]));

  const items: PayItem[] = awards
    .map((a) => ({ awardId: a.id, userId: a.user_id, name: name[a.user_id] ?? "", amount: a.exam_fee + a.pass_bonus, currency: a.currency, payerId: payee[a.user_id]?.paypal_payer_id ?? null, email: payee[a.user_id]?.paypal_email ?? null }))
    .filter((i) => i.amount > 0 && (provider.id !== "paypal_payouts" || i.payerId || i.email));
  if (!items.length) throw new HttpError(400, "no employee has a PayPal account registered");

  // Lock the awards first so a double click cannot start a second batch
  const { data: locked } = await db.from("awards").update({ status: "processing", provider: provider.id, updated_at: new Date().toISOString() })
    .in("id", items.map((i) => i.awardId)).in("status", ["approved", "failed"]).select("id");
  const lockedIds = new Set((locked ?? []).map((x) => x.id));
  const toPay = items.filter((i) => lockedIds.has(i.awardId));
  if (!toPay.length) throw new HttpError(409, "already being paid");

  const senderBatchId = `tdb-${crypto.randomUUID()}`;
  const total = toPay.reduce((s, i) => s + i.amount, 0);
  const { data: batch } = await db.from("payout_batches").insert({
    company_id: me.companyId, provider: provider.id, sender_batch_id: senderBatchId, total, currency: toPay[0].currency, created_by: me.userId,
  }).select("id").single();

  try {
    const res = await provider.send(toPay, { db, companyId: me.companyId, senderBatchId });
    await db.from("payout_batches").update({ provider_batch_id: res.providerBatchId, status: res.status === "exported" ? "SUCCESS" : "PENDING" }).eq("id", batch!.id);
    await db.from("payout_items").insert(res.items.map((i) => ({ batch_id: batch!.id, award_id: i.awardId, amount: toPay.find((p) => p.awardId === i.awardId)!.amount, provider_item_id: i.providerItemId, status: res.status === "exported" ? "EXPORTED" : "PENDING", error: i.error ?? null })));
    if (res.status === "exported") {
      await db.from("awards").update({ status: "exported", paid_at: new Date().toISOString() }).in("id", toPay.map((i) => i.awardId));
    }
    return { batch: batch!.id, count: toPay.length, total, status: res.status, file: res.file };
  } catch (e) {
    // Mark as failed (not approved): if PayPal did receive the request, its webhook still settles it,
    // and the admin sees the failure before deciding to retry
    await db.from("awards").update({ status: "failed" }).in("id", toPay.map((i) => i.awardId));
    await db.from("payout_batches").update({ status: "ERROR" }).eq("id", batch!.id);
    throw e;
  }
});

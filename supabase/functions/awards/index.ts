// Admin decisions on awards. Independent of how money is sent (see payout/).
//   confirm     { ids, edit? }  : accept the AI amount (or an edited one, clamped to the rules)
//   self_pay    { ids }         : confirm that the employee pays the exam fee themselves
//   exam_result { id, result }  : record pass / fail (the pass bonus depends on it)
//   follow_up   { id, message } : send a message to the employee
import { clampAward, DEFAULT_RULES } from "../_shared/core/award.ts";
import { caller, HttpError, ids, serve } from "../_shared/http.ts";

const CONFIRMABLE = ["proposed", "follow_up", "self_pay"];

serve(async (req, body, db) => {
  const me = await caller(req, db, "admin");
  const now = new Date().toISOString();
  const { data: company } = await db.from("companies").select("rules").eq("id", me.companyId).single();
  const rules = { ...DEFAULT_RULES, ...company!.rules };

  switch (body.action) {
    case "confirm": {
      const list = ids(body.ids);
      const edit = body.edit as { examFee: number; passBonus: number; note?: string } | undefined;
      const { data: rows } = await db.from("awards").select("id, user_id, exam_fee, pass_bonus, status")
        .eq("company_id", me.companyId).in("user_id", list).in("status", CONFIRMABLE);
      const { data: members } = await db.from("company_members").select("user_id, exam_result").eq("company_id", me.companyId).in("user_id", list);
      const result = Object.fromEntries((members ?? []).map((m) => [m.user_id, m.exam_result]));
      for (const a of rows ?? []) {
        const passed = result[a.user_id] === "passed" ? true : result[a.user_id] === "failed" ? false : null;
        const amt = edit ? clampAward(edit, rules, passed) : { examFee: a.exam_fee, passBonus: a.pass_bonus };
        await db.from("awards").update({
          exam_fee: amt.examFee, pass_bonus: amt.passBonus,
          status: amt.examFee + amt.passBonus > 0 ? "approved" : "self_pay",
          edited_note: edit ? String(edit.note ?? "").slice(0, 500) || null : null,
          confirmed_by: me.userId, confirmed_at: now, updated_at: now,
        }).eq("id", a.id);
      }
      return { confirmed: rows?.length ?? 0 };
    }
    case "self_pay": {
      const { data } = await db.from("awards").update({ status: "self_pay", exam_fee: 0, pass_bonus: 0, confirmed_by: me.userId, confirmed_at: now, updated_at: now })
        .eq("company_id", me.companyId).in("user_id", ids(body.ids)).in("status", CONFIRMABLE).select("id");
      return { updated: data?.length ?? 0 };
    }
    case "exam_result": {
      if (!["pending", "passed", "failed"].includes(String(body.result))) throw new HttpError(400, "result");
      await db.from("company_members").update({ exam_result: body.result }).eq("company_id", me.companyId).eq("user_id", String(body.id));
      return {};
    }
    case "follow_up": {
      const message = String(body.message ?? "").trim().slice(0, 2000);
      if (!message) throw new HttpError(400, "message");
      await db.from("messages").insert({ company_id: me.companyId, user_id: String(body.id), sender_id: me.userId, body: message });
      return {};
    }
    default:
      throw new HttpError(400, "action");
  }
});

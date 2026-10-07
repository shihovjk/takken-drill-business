// Runs after app.js. Turns the study app into the company version and reports every answer
// (question, category, right/wrong, seconds) to the surrounding app, which records it.
(function () {
  // The company pays: every member feature is on, and there is nothing to buy or sign in to
  if (!store.member) { store.member = { plan: "exam", since: dayKey(), company: true }; save(); }
  VIEWS.plans = VIEWS.home;
  VIEWS.account = VIEWS.home;
  VIEWS.advertise = VIEWS.home;

  // app.js calls, for each answered question: recordSpeed (drill only) -> recordChoice -> recordCategory
  var last = { qid: null, mode: null, secs: null };
  var _speed = recordSpeed, _choice = recordChoice, _category = recordCategory;
  window.recordSpeed = function (mode, cat, secs) { last.mode = mode; last.secs = secs; return _speed.apply(this, arguments); };
  window.recordChoice = function (qid) { last.qid = qid; return _choice.apply(this, arguments); };
  window.recordCategory = function (cat, correct) {
    var r = _category.apply(this, arguments);
    if (last.qid) {
      parent.postMessage({
        type: "tdb-attempt",
        attempt: {
          question_id: last.qid, category: cat, correct: !!correct,
          mode: last.mode || "mock", // mock exams have no per-question timer
          ms: last.secs == null ? null : Math.round(last.secs * 1000),
        },
      }, location.origin);
    }
    last = { qid: null, mode: null, secs: null };
    return r;
  };

  // ---------- 「支給」tab: exam fee, pass bonus, the AI's reasons, PayPal receiving account ----------
  // The data lives in the surrounding app (it holds the login); ask it and render here in the app's style.
  var YEN = '<path d="M6 3l6 8 6-8"/><path d="M12 11v10M7 13h10M7 17h10"/>';
  var stats = document.querySelector('nav button[data-go="stats"]');
  if (stats && !document.querySelector('nav button[data-go="award"]')) {
    stats.insertAdjacentHTML("afterend", '<button data-go="award">' + svgIcon(YEN) + "<span>支給</span></button>");
  }
  VIEWS.award = renderAward;

  // The 支給 tab can be read in English (shared setting with the surrounding app: same origin, same key)
  var lang = function () { try { return localStorage.getItem("tdb-lang") === "en" ? "en" : "ja"; } catch (e) { return "ja"; } };
  var T = {
    ja: {
      loading: "読み込んでいます…", message: "会社からのメッセージ", title: "受験費用・合格奨励金",
      notYet: "会社の確認が終わると、ここに支給額とAIの判定理由が表示されます。勉強を続けて、受験費用の支給をめざしましょう。",
      examFee: "受験費用", passBonus: "合格奨励金", total: "合計", paidOn: "支払日", confirmedOn: "承認日", method: "支払い方法", ai: "AIの判定理由",
      effort: "真剣度", pass: "合格可能性", receive: "受け取り先", registered: "PayPalに登録済み",
      direct: "支給は会社のPayPalから、あなたのPayPalへ直接送金されます。", connect: "PayPalでログインして受け取り先を登録", signout: "ログアウト",
      status: { proposed: "会社で確認中", follow_up: "会社で確認中", approved: "支払い準備中", processing: "支払い処理中", paid: "支払済", failed: "支払いエラー", exported: "給与で支給", self_pay: "自己負担" },
      steps: ["学習中", "会社が承認", "支払い手続き", "支払済"],
      rulesTitle: "会社の支給ルール", upTo: "最大", feeAny: "真剣に勉強した人に、合否にかかわらず", feePassed: "真剣に勉強して合格した人に", bonusWhen: "合格した人に",
      adjusted: "会社が金額を調整しました", aiProposed: "AIの提案", failedNote: "PayPalへの送金がうまくいきませんでした。会社の担当者が確認しています。",
      selfPayNote: "今回は受験費用が自己負担になりました。理由は下のAIの判定理由と、会社からのメッセージを確認してください。",
      viaPayPal: "PayPal", viaPayroll: "給与と一緒に支給",
      studyTitle: "あなたの学習（直近8週間）", minutes: "学習時間", goal: "目安", days: "学習した日", answered: "解いた問題", accuracy: "正答率", speed: "1問あたりの時間",
      unitMin: "分", unitDay: "日", unitQ: "問", unitSec: "秒", weekly: "週ごとの学習時間（左が8週前）",
      howJudged: "支給額は、学習時間だけでなく、正答率と1問あたりの時間の組み合わせや、その変化をAIが読んで提案し、会社の担当者が確認して決めます。",
      flags: "AIが気づいたこと",
    },
    en: {
      loading: "Loading…", message: "Message from your company", title: "Exam fee & pass bonus",
      notYet: "Once your company has reviewed your study, your award and the AI's reasoning appear here. Keep studying to get your exam fee covered.",
      examFee: "Exam fee", passBonus: "Pass bonus", total: "Total", paidOn: "Paid on", confirmedOn: "Approved on", method: "Paid by", ai: "Why the AI decided this",
      effort: "Effort", pass: "Pass chance", receive: "Receive to", registered: "PayPal registered",
      direct: "Your company pays you directly from its PayPal account to yours.", connect: "Log in with PayPal to receive payments", signout: "Sign out",
      status: { proposed: "Under review", follow_up: "Under review", approved: "Approved", processing: "Paying…", paid: "Paid", failed: "Payment error", exported: "Paid with salary", self_pay: "Self-pay" },
      steps: ["Studying", "Approved", "Paying", "Paid"],
      rulesTitle: "Your company's award rules", upTo: "up to", feeAny: "for genuine study, pass or fail", feePassed: "for genuine study, if you pass", bonusWhen: "if you pass",
      adjusted: "Your company adjusted the amount", aiProposed: "AI proposal", failedNote: "The PayPal payment did not go through. Your company is looking into it.",
      selfPayNote: "This time you pay the exam fee yourself. See the AI's reasons below and any message from your company.",
      viaPayPal: "PayPal", viaPayroll: "With your salary",
      studyTitle: "Your study (last 8 weeks)", minutes: "Study time", goal: "goal", days: "Study days", answered: "Questions answered", accuracy: "Accuracy", speed: "Time per question",
      unitMin: " min", unitDay: " days", unitQ: "", unitSec: " s", weekly: "Study time per week (oldest on the left)",
      howJudged: "The AI proposes your award from more than study time: it reads accuracy and time per question together, and how they change. A person at your company reviews it and decides.",
      flags: "What the AI noticed",
    },
  };
  var TONE = { proposed: "warn", follow_up: "warn", approved: "ok", processing: "ok", paid: "ok", failed: "ng", exported: "ok", self_pay: "" };
  var STEP = { approved: 1, processing: 2, failed: 2, paid: 3, exported: 3 };
  var lastMe = null;

  function renderAward() {
    setNav("award");
    view.innerHTML = '<div class="card"><p class="muted">' + T[lang()].loading + "</p></div>";
    parent.postMessage({ type: "tdb-get-award" }, location.origin);
  }

  function paint(me) {
    lastMe = me;
    var L = lang(), t = T[L];
    var num = function (n) { return Number(n || 0).toLocaleString(L === "ja" ? "ja-JP" : "en-US"); };
    var yen = function (n) { return L === "ja" ? num(n) + "円" : "¥" + num(n); };
    var day = function (s) { return new Date(s).toLocaleDateString(L === "ja" ? "ja-JP" : "en-US"); };
    var row = function (k, v) { return "<tr><th>" + k + '</th><td class="num">' + v + "</td></tr>"; };
    var a = me.award, j = me.judgement, r = me.rules, p = me.progress;
    var html = '<div style="display:flex;justify-content:flex-end;margin-bottom:12px"><div class="seg" role="group" aria-label="Language">' +
      '<button class="btn' + (L === "ja" ? " btn-primary" : "") + '" data-lang="ja" style="padding:4px 12px;min-height:0">日本語</button> ' +
      '<button class="btn' + (L === "en" ? " btn-primary" : "") + '" data-lang="en" style="padding:4px 12px;min-height:0">EN</button></div></div>';
    (me.messages || []).forEach(function (m) {
      html += '<div class="card" style="margin-bottom:16px;border-left:4px solid var(--primary)"><h2>' + t.message + '</h2><p style="white-space:pre-wrap;margin:0">' + esc(m.body) + "</p></div>";
    });

    // Award: where it stands, how much, and when
    html += '<div class="card" style="margin-bottom:16px"><h2>' + t.title + (a ? ' <span class="status ' + (TONE[a.status] || "") + '">' + (t.status[a.status] || a.status) + "</span>" : "") + "</h2>";
    if (!a || a.status !== "self_pay") {
      var at = a ? STEP[a.status] || 0 : 0;
      html += '<div class="stepper" style="--n:4;--done:' + Math.round((at / 3) * 100) + '">' + t.steps.map(function (s, i) {
        var date = i === 1 && a && a.confirmedAt ? day(a.confirmedAt) : i === 3 && a && a.paidAt ? day(a.paidAt) : "";
        return '<span class="' + (i < at ? "past" : i === at ? "current" : "") + '"><i class="dot"></i><span class="lbl">' + s + (date ? "<em>" + date + "</em>" : "") + "</span></span>";
      }).join("") + "</div>";
    }
    if (!a) {
      html += '<p class="source-note" style="margin:0">' + t.notYet + "</p>";
    } else {
      if (a.status === "self_pay") html += '<p class="source-note" style="margin:0 0 10px">' + t.selfPayNote + "</p>";
      if (a.status === "failed") html += '<p class="source-note" style="margin:0 0 10px;color:var(--red)">' + t.failedNote + "</p>";
      html += '<table class="pace"><tbody>' + row(t.examFee, yen(a.examFee)) + row(t.passBonus, yen(a.passBonus)) +
        row(t.total, "<b>" + yen(a.examFee + a.passBonus) + "</b>");
      if (a.confirmedAt) html += row(t.confirmedOn, day(a.confirmedAt));
      if (a.paidAt) html += row(t.paidOn, day(a.paidAt));
      if (a.provider) html += row(t.method, a.provider === "payroll_csv" ? t.viaPayroll : t.viaPayPal);
      html += "</tbody></table>";
      if (a.examFee !== a.aiExamFee || a.passBonus !== a.aiPassBonus) {
        html += '<p class="source-note" style="margin:10px 0 0">' + t.adjusted + "（" + t.aiProposed + " " + yen(a.aiExamFee + a.aiPassBonus) + "）" +
          (a.editedNote ? "<br>" + esc(a.editedNote) : "") + "</p>";
      }
    }
    html += "</div>";

    // The company's rules, so the employee knows what the award depends on
    if (r) {
      html += '<div class="card" style="margin-bottom:16px"><h2>' + t.rulesTitle + '</h2><table class="pace"><tbody>' +
        row(t.examFee + '<br><small class="muted">' + (r.examFeeOnlyIfPassed ? t.feePassed : t.feeAny) + "</small>", t.upTo + " " + yen(r.examFee)) +
        row(t.passBonus + '<br><small class="muted">' + t.bonusWhen + "</small>", t.upTo + " " + yen(r.passBonus)) +
        '</tbody></table><p class="source-note" style="margin:10px 0 0">' + t.howJudged + "</p></div>";
    }

    // The employee's own study over the window the AI reads
    if (p) {
      var mins = Math.round(p.minutes), goal = r ? r.minMinutes : 0;
      html += '<div class="card" style="margin-bottom:16px"><h2>' + t.studyTitle + "</h2>";
      html += '<p style="margin:0 0 6px;display:flex;justify-content:space-between"><span>' + t.minutes + " <b>" + num(mins) + t.unitMin + "</b></span>" +
        (goal ? '<span class="muted">' + t.goal + " " + num(goal) + t.unitMin + "</span>" : "") + "</p>";
      if (goal) html += '<div class="progress" style="height:8px;border-radius:4px"><i style="width:' + Math.min(100, (mins / goal) * 100) + '%"></i></div>';
      var max = Math.max.apply(null, (p.weeks || []).concat([1]));
      html += '<div aria-label="' + t.weekly + '" style="display:flex;align-items:flex-end;gap:4px;height:48px;margin:4px 0 4px">' + (p.weeks || []).map(function (w) {
        return '<i title="' + Math.round(w) + t.unitMin + '" style="flex:1;border-radius:3px 3px 0 0;background:var(--primary);opacity:' + (w ? 1 : .15) + ";height:" + Math.max(4, (w / max) * 100) + '%"></i>';
      }).join("") + '</div><p class="source-note" style="margin:0 0 10px">' + t.weekly + "</p>";
      html += '<table class="pace"><tbody>' + row(t.days, num(p.studyDays) + t.unitDay) + row(t.answered, num(p.n) + t.unitQ) +
        row(t.accuracy, p.accuracy == null ? "—" : p.accuracy + "%") + row(t.speed, p.medianSec == null ? "—" : Math.round(p.medianSec) + t.unitSec) + "</tbody></table></div>";
    }

    if (j) {
      html += '<div class="card" style="margin-bottom:16px"><h2>' + t.ai + "</h2>" +
        '<p style="margin:0 0 10px">' + t.effort + " <b>" + j.seriousness + "</b>　" + t.pass + " <b>" + j.pass_probability + "%</b></p>" +
        '<p style="margin:0">' + esc(L === "ja" ? j.reason_ja : j.reason_en) + "</p>";
      if (j.flags && j.flags.length) {
        html += '<h3 style="font-size:13px;margin:14px 0 6px">' + t.flags + '</h3><ul style="margin:0;padding-left:18px">' + j.flags.map(function (f) {
          return "<li>" + esc(L === "ja" ? f.evidence_ja : f.evidence_en) + "</li>";
        }).join("") + "</ul>";
      }
      html += "</div>";
    }
    html += '<div class="card" style="margin-bottom:16px"><h2>' + t.receive + "</h2>" + (me.payee.verified
      ? '<p style="margin:0"><span class="status ok">' + t.registered + '</span> <span class="source-note">' + esc(me.payee.email || "") + "</span></p>"
      : '<p class="source-note" style="margin:0 0 10px">' + t.direct + '</p><button class="btn btn-primary btn-block" data-action="tdb-paypal">' + t.connect + "</button>") +
      "</div>";
    html += '<p style="text-align:center"><button class="link-inline" data-action="tdb-signout">' + t.signout + "</button></p>";
    view.innerHTML = html;
  }

  document.addEventListener("click", function (e) {
    if (e.target.closest("[data-action=tdb-paypal]")) parent.postMessage({ type: "tdb-connect-paypal" }, location.origin);
    if (e.target.closest("[data-action=tdb-signout]")) parent.postMessage({ type: "tdb-signout" }, location.origin);
    var l = e.target.closest("[data-lang]");
    if (l && lastMe) { try { localStorage.setItem("tdb-lang", l.dataset.lang); } catch (err) { /* private mode */ } paint(lastMe); }
  });
  window.addEventListener("message", function (e) {
    if (e.origin !== location.origin || e.source !== parent) return;
    if (e.data && e.data.type === "tdb-award" && document.querySelector('nav button[data-go="award"].active')) paint(e.data.me);
  });
})();

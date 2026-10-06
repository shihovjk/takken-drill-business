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
      examFee: "受験費用", passBonus: "合格奨励金", total: "合計", paidOn: "支払日", ai: "AIの判定理由",
      effort: "真剣度", pass: "合格可能性", receive: "受け取り先", registered: "PayPalに登録済み",
      direct: "支給は会社のPayPalから、あなたのPayPalへ直接送金されます。", connect: "PayPalでログインして受け取り先を登録", signout: "ログアウト",
      status: { proposed: "会社で確認中", follow_up: "会社で確認中", approved: "支払い準備中", processing: "支払い処理中", paid: "支払済", failed: "支払いエラー", exported: "給与で支給", self_pay: "自己負担" },
    },
    en: {
      loading: "Loading…", message: "Message from your company", title: "Exam fee & pass bonus",
      notYet: "Once your company has reviewed your study, your award and the AI's reasoning appear here. Keep studying to get your exam fee covered.",
      examFee: "Exam fee", passBonus: "Pass bonus", total: "Total", paidOn: "Paid on", ai: "Why the AI decided this",
      effort: "Effort", pass: "Pass chance", receive: "Receive to", registered: "PayPal registered",
      direct: "Your company pays you directly from its PayPal account to yours.", connect: "Log in with PayPal to receive payments", signout: "Sign out",
      status: { proposed: "Under review", follow_up: "Under review", approved: "Approved", processing: "Paying…", paid: "Paid", failed: "Payment error", exported: "Paid with salary", self_pay: "Self-pay" },
    },
  };
  var TONE = { proposed: "warn", follow_up: "warn", approved: "ok", processing: "ok", paid: "ok", failed: "ng", exported: "ok", self_pay: "" };
  var lastMe = null;

  function renderAward() {
    setNav("award");
    view.innerHTML = '<div class="card"><p class="muted">' + T[lang()].loading + "</p></div>";
    parent.postMessage({ type: "tdb-get-award" }, location.origin);
  }

  function paint(me) {
    lastMe = me;
    var L = lang(), t = T[L];
    var yen = function (n) { return L === "ja" ? Number(n || 0).toLocaleString("ja-JP") + "円" : "¥" + Number(n || 0).toLocaleString("en-US"); };
    var a = me.award, j = me.judgement;
    var html = '<div style="display:flex;justify-content:flex-end;margin-bottom:12px"><div class="seg" role="group" aria-label="Language">' +
      '<button class="btn' + (L === "ja" ? " btn-primary" : "") + '" data-lang="ja" style="padding:4px 12px;min-height:0">日本語</button> ' +
      '<button class="btn' + (L === "en" ? " btn-primary" : "") + '" data-lang="en" style="padding:4px 12px;min-height:0">EN</button></div></div>';
    (me.messages || []).forEach(function (m) {
      html += '<div class="card" style="margin-bottom:16px;border-left:4px solid var(--primary)"><h2>' + t.message + '</h2><p style="white-space:pre-wrap;margin:0">' + esc(m.body) + "</p></div>";
    });
    html += '<div class="card" style="margin-bottom:16px"><h2>' + t.title + (a ? ' <span class="status ' + (TONE[a.status] || "") + '">' + (t.status[a.status] || a.status) + "</span>" : "") + "</h2>";
    if (!a) {
      html += '<p class="source-note" style="margin:0">' + t.notYet + "</p>";
    } else {
      html += '<table class="pace"><tbody>' +
        "<tr><th>" + t.examFee + '</th><td class="num">' + yen(a.examFee) + "</td></tr>" +
        "<tr><th>" + t.passBonus + '</th><td class="num">' + yen(a.passBonus) + "</td></tr>" +
        "<tr><th>" + t.total + '</th><td class="num"><b>' + yen(a.examFee + a.passBonus) + "</b></td></tr></tbody></table>";
      if (a.paidAt) html += '<p class="source-note">' + t.paidOn + "：" + new Date(a.paidAt).toLocaleString(L === "ja" ? "ja-JP" : "en-US") + "（PayPal）</p>";
    }
    html += "</div>";
    if (j) {
      html += '<div class="card" style="margin-bottom:16px"><h2>' + t.ai + "</h2>" +
        '<p style="margin:0 0 10px">' + t.effort + " <b>" + j.seriousness + "</b>　" + t.pass + " <b>" + j.pass_probability + "%</b></p>" +
        '<p style="margin:0">' + esc(L === "ja" ? j.reason_ja : j.reason_en) + "</p></div>";
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

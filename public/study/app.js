// 宅建過去問ドリル 試作版
// 学習記録はブラウザ（localStorage）に保存する。本番ではログインして端末間で同期する予定。

const STORE_KEY = window.TAKKEN_STORE_KEY || "takken-drill-v1";
const DAY = 24 * 60 * 60 * 1000;
// 正解が続くたびに復習の間隔を伸ばす（簡易版。本番はFSRSに置き換える）
const INTERVAL_DAYS = [1, 3, 7, 14, 30];
const SESSION_SIZE = 10;

const view = document.getElementById("view");
// 模試だけで出すオリジナル問題（mock_questions.js）も、解説・復習で引けるようにここに入れる（ドリルの出題には使わない）
const qById = Object.fromEntries([...QUESTIONS, ...(window.MOCK_QUESTIONS || [])].map((q) => [q.id, q]));
// くわしい解説（data/exp/<年度>.js）を問題に合流させる。問題ごとのポイント・図表と、選択肢ごとの detail
function mergeExplain() {
  Object.entries(window.EXPLAIN || {}).forEach(([id, x]) => {
    const q = qById[id];
    if (!q) return;
    if (x.point) q.point = x.point;
    if (x.figures) q.figures = x.figures;
    (x.choices || []).forEach((d, i) => { if (d && q.choices[i]) q.choices[i].detail = d; });
  });
  window.EXPLAIN = {};
}
mergeExplain();
// 過去問は約2,000問あり、くわしい解説まで最初に読むと重いので、解説は解く問題の年度の分だけ後から読む。
// 年度の短い名前（r7、h30、r2-10 など）は問題の ID から取る。EXP_VER は data/all.js にある各年度の版
const examSlug = (q) => q.id.replace(/-\d+$/, "");
const expState = {}; // 年度 → "loading" | "done"（読めなかったときも done にして、解説なしで進める）
function loadExplain(slugs) {
  // くわしい解説のファイルがまだ無い年度は、読み込みを待たずに進める（待つと「次へ」で止まってしまう）
  slugs.forEach((s) => { if (!(window.EXP_VER || {})[s]) expState[s] = "done"; });
  const need = [...new Set(slugs)].filter((s) => (window.EXP_VER || {})[s] && !expState[s]);
  return Promise.all(need.map((s) => new Promise((ok) => {
    expState[s] = "loading";
    const el = document.createElement("script");
    el.src = `${window.TAKKEN_DATA_BASE || ""}data/exp/${s}.js?v=${window.EXP_VER[s]}`;
    el.onload = el.onerror = () => { expState[s] = "done"; mergeExplain(); ok(); };
    document.head.appendChild(el);
  })));
}
const catName = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.name]));

// ---------- 保存 ----------
function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { ...emptyStore(), ...JSON.parse(raw) };
  } catch (e) { /* 保存できない環境でも動かす */ }
  return emptyStore();
}
function emptyStore() {
  return { mode: "four", items: {}, memos: {}, cats: {}, daily: {}, reviewed: {}, overcome: {}, speed: { four: {}, ox: {} }, qCount: {}, oxCount: {}, plan: null, paused: null, share: null, user: null, member: null };
}
let store = loadStore();
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* noop */ }
  cloudSave(); // ログイン中はアカウントにも保存する（cloud.js）
}

const itemKey = (qid, idx) => `${qid}#${idx}`;

function recordChoice(qid, idx, correct) {
  const k = itemKey(qid, idx);
  const it = store.items[k] || { box: 0, due: 0, right: 0, wrong: 0 };
  if (correct) {
    it.right++;
    it.box = Math.min(it.box + 1, INTERVAL_DAYS.length);
    it.due = Date.now() + INTERVAL_DAYS[it.box - 1] * DAY;
  } else {
    it.wrong++;
    it.box = 0;
    it.due = Date.now(); // 間違えた肢は今日の復習に入れる
  }
  it.last = Date.now();
  store.items[k] = it;
}

// 日ごとの解答数（連続学習日数と今日の目標に使う）
const dayKey = (t = Date.now()) => new Date(t - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
function recordDaily() {
  const k = dayKey();
  store.daily[k] = (store.daily[k] || 0) + 1;
}
function streakDays() {
  let n = 0;
  let t = Date.now();
  if (!store.daily[dayKey(t)]) t -= DAY; // 今日まだ解いていなくても、昨日まで続いていれば途切れていない
  while (store.daily[dayKey(t)]) { n++; t -= DAY; }
  return n;
}

// 解答にかかった時間を分野ごとに記録する（本試験ペース＝4択1問120秒、○×1肢30秒）
function recordSpeed(mode, cat, secs) {
  const limit = mode === "four" ? SEC_PER_Q : SEC_PER_OX;
  const t = Math.min(secs, limit * 5); // 放置していた時間で平均が崩れないよう上限を設ける
  const m = store.speed[mode] || (store.speed[mode] = {});
  const r = m[cat] || (m[cat] = { sum: 0, n: 0, inTime: 0 });
  r.sum += t; r.n++; if (secs <= limit) r.inTime++;
}

function recordCategory(cat, correct) {
  recordDaily();
  const c = store.cats[cat] || { right: 0, wrong: 0 };
  correct ? c.right++ : c.wrong++;
  store.cats[cat] = c;
}

function dueItems() {
  const now = Date.now();
  return Object.entries(store.items)
    .filter(([, it]) => it.wrong > 0 && it.due <= now)
    .map(([k]) => {
      const [qid, idx] = k.split("#");
      return { qid, idx: Number(idx) };
    })
    .filter((x) => qById[x.qid]);
}

// ---------- 共通 ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const NUMS = ["1", "2", "3", "4"];
function shuffle(a) {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}
function setNav(name) {
  stopTimer();
  stopMockClock(); // 模試の画面を離れたら、模試の時間を止める
  expireMember();
  document.body.classList.remove("in-drill", "on-login");
  document.body.classList.toggle("is-member", !!store.member); // 会員はバナー広告（AdSense）と会員紹介を出さない（おすすめのカードは出す）
  fillSideAd();
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("active", b.dataset.go === name));
  const due = dueItems().length;
  document.getElementById("review-badge").textContent = due ? String(due) : "";
  renderExamCount();
  renderSideAd();
  renderAccount();
  window.scrollTo(0, 0);
}
// メニューから開く画面。ブラウザの「戻る」で戻るときにも使う
const VIEWS = {
  home: () => renderHome(), review: () => renderReviewHome(), stats: () => renderStats(),
  schedule: () => renderSchedule(), plans: () => renderPlans(), advertise: () => renderAdvertise(),
  mock: () => renderMockHome(), account: () => (store.user ? renderAccountPage() : renderLogin()),
};
// ブラウザの「戻る」「進む」：履歴に残した画面を開き直す。案内・法務のページ（#privacy など）は hashchange で開くので、ここでは何もしない
window.addEventListener("popstate", (e) => {
  if (hashPage()) return;
  // 問題を解いている途中なら、画面は変えずに「戻りますか？」の確認を出す
  if (document.body.classList.contains("in-drill") && session) {
    history.pushState(history.state, "", location.pathname + location.search);
    return quitSession();
  }
  (VIEWS[(e.state || {}).view] || VIEWS.home)();
});
document.addEventListener("click", (e) => {
  const go = e.target.closest("[data-go]");
  if (go) {
    const to = go.dataset.go;
    // 案内・法務のページはアドレスの末尾を変えて開く（hashchange で表示される）。それ以外へ移るときは末尾を消す
    if (HASH_PAGES[to]) { if (location.hash === `#${to}`) HASH_PAGES[to](); else location.hash = to; return; }
    if (hashPage()) history.replaceState(null, "", location.pathname + location.search);
    if (to === "review-start") startReview();
    if (VIEWS[to]) {
      VIEWS[to]();
      // ブラウザの「戻る」で前の画面に戻れるよう、画面を移るたびに履歴に残す（同じ画面を続けて開いたときは残さない）
      if ((history.state || {}).view !== to) history.pushState({ view: to }, "", location.pathname + location.search);
    }
  }
  if (e.target.closest("[data-action=quit]")) quitSession();
  if (e.target.closest("[data-action=timer-info]")) openTimerInfo();
  if (e.target.closest("[data-action=mock-list]")) openMockSheet("list");
  if (e.target.closest("[data-action=mock-pause]")) {
    stopMockClock();
    toast("中断しました。模試の一覧の「続きから」で再開できます");
    renderMockHome();
  }
  const tb = e.target.closest("[data-action=timer]");
  if (tb) {
    // 問題画面の上でタイマーの表示・非表示を切り替える（計測自体は続けているので、オンにするとすぐ今の経過時間が出る）
    store.timerOff = !store.timerOff; save();
    tb.outerHTML = timerHtml();
    if (!store.timerOff && timerState) startTimer(timerState.startedAt, timerState.limit);
  }
  const sc = e.target.closest("[data-scroll]");
  if (sc) document.getElementById(sc.dataset.scroll)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const aff = e.target.closest("[data-aff]");
  if (aff) {
    // どの紹介がどれだけ押されたかを数える（本番はアクセス解析のイベントに置き換える）
    store.affClicks = store.affClicks || {};
    store.affClicks[aff.dataset.aff] = (store.affClicks[aff.dataset.aff] || 0) + 1;
    save();
  }
});

// ---------- ホーム ----------
const CAT_ICON = {
  gyoho: '<path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 9h1M14 9h1M9 13h1M14 13h1M10 21v-4h4v4"/>',
  kenri: '<path d="M12 3v18M7 21h10"/><path d="M5 7h14"/><path d="m5 7-3 7a3 3 0 0 0 6 0Z"/><path d="m19 7-3 7a3 3 0 0 0 6 0Z"/>',
  seigen: '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3Z"/><path d="M9 3v15M15 6v15"/>',
  zei: '<path d="M6 3l6 8 6-8"/><path d="M12 11v10M7 13h10M7 17h10"/>',
  all: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
};
const svgIcon = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

// 分野ごとの進み具合（解いたことのある肢の割合）と正答率
function catProgress(cat) {
  const qs = QUESTIONS.filter((q) => cat === "all" || q.category === cat);
  const total = qs.reduce((n, q) => n + q.choices.length, 0);
  let seen = 0;
  qs.forEach((q) => q.choices.forEach((_, i) => { if (store.items[itemKey(q.id, i)]) seen++; }));
  const cs = cat === "all"
    ? Object.values(store.cats).reduce((a, c) => ({ right: a.right + c.right, wrong: a.wrong + c.wrong }), { right: 0, wrong: 0 })
    : store.cats[cat] || { right: 0, wrong: 0 };
  const answered = cs.right + cs.wrong;
  return { q: qs.length, pct: total ? Math.round((seen / total) * 100) : 0, acc: answered ? Math.round((cs.right / answered) * 100) : null };
}

// 試験までの残り日数に合わせて、その時期にやるべきことを伝える
function phaseMessage(left, due) {
  if (left === 0) return { chip: "本試験当日", text: "今日までの積み重ねは本物です。落ち着いて、いつもどおり解きましょう。" };
  if (left <= 7) return { chip: "直前期", text: `本試験まであと${left}日。新しい問題より、間違えた問題の最終確認を。ここまでの努力を点数に変えましょう。` };
  if (left <= 30) return { chip: "直前期", text: `あと${left}日。模擬試験で時間配分を確かめ、苦手な論点をつぶす時期です。${due ? `まずは復習の${due}問から。` : ""}` };
  if (left <= 90) return { chip: "仕上げ期", text: `あと${left}日。過去問を3周して、解けない問題を解ける問題に変える時期です。${due ? `復習${due}問を最優先に。` : ""}` };
  if (left <= 150) return { chip: "演習期", text: "問題集をくり返し解いて、知識を得点に変える時期です。間違えた問題は復習で確実に克服しましょう。" };
  return { chip: "基礎期", text: "テキストを読んで全体をつかむ時期です。読んだ範囲の問題を少しずつ解くと、記憶に残りやすくなります。" };
}

function ring(value, max) {
  const r = 34, c = 2 * Math.PI * r;
  const p = Math.min(1, max ? value / max : 0);
  return `<svg class="ring" viewBox="0 0 80 80" aria-hidden="true">
    <circle cx="40" cy="40" r="${r}" class="ring-bg"/>
    <circle cx="40" cy="40" r="${r}" class="ring-fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p)}"/>
  </svg>`;
}

function weekDots() {
  const names = ["日", "月", "火", "水", "木", "金", "土"];
  let html = "";
  for (let i = 6; i >= 0; i--) {
    const t = Date.now() - i * DAY;
    const done = (store.daily[dayKey(t)] || 0) > 0;
    html += `<span class="wd ${done ? "done" : ""} ${i === 0 ? "today" : ""}"><i></i>${names[new Date(t).getDay()]}</span>`;
  }
  return html;
}

function renderHome() {
  setNav("home");
  const due = dueItems().length;
  const todayCount = store.daily[dayKey()] || 0;
  const goal = dailyGoal();
  const streak = streakDays();
  const done = todayCount >= goal;
  const phase = phaseMessage(examInfo().left, due);

  view.innerHTML = `
    <section class="hero">
      <div class="hero-top">
        <span class="phase-chip">${phase.chip}</span>
        ${store.user
          ? `<span class="save-pill">${svgIcon('<path d="M20 6 9 17l-5-5"/>')}記録を保存中</span>`
          : `<button class="save-pill" id="hero-login" title="今の記録はこの端末だけに保存されています">${svgIcon('<path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 0 1 0 9Z"/>')}ログインして記録を残す</button>`}
      </div>
      <p class="cheer">${phase.text}</p>
      <div class="hero-stats">
        <div class="ring-wrap">
          ${ring(todayCount, goal)}
          <div class="ring-num"><b>${todayCount}</b><small>/ ${goal}問</small></div>
        </div>
        <div class="hero-side">
          <div class="streak-big">${svgIcon('<path d="M12 22c4 0 7-3 7-7 0-3-2-5-3-7-1 2-2 3-4 3 1-3 0-6-3-9 0 4-4 7-4 13 0 4 3 7 7 7Z"/>')}<b>${streak}</b><span>日連続</span></div>
          <div class="week">${weekDots()}</div>
        </div>
      </div>
      <button class="hero-cta" id="today-start">${done ? "もう少し解く" : "今日の学習を始める"}${due ? `<small>復習${due}問から</small>` : ""}</button>
    </section>

    ${store.paused ? `
    <div class="resume-card">
      <div><div class="k">中断中のドリル</div><b>${esc(store.paused.title)}</b>　${store.paused.i + 1} / ${store.paused.list.length}問目から</div>
      <div style="display:flex;gap:8px"><button class="btn" id="discard">やめる</button><button class="btn btn-primary" id="resume">続きから再開</button></div>
    </div>` : ""}

    <p class="section-title">出題形式</p>
    <div class="mode-tabs" role="radiogroup" aria-label="出題形式">
      <button role="radio" data-mode="four" aria-checked="${store.mode === "four"}">4択<small>本試験と同じ形式</small></button>
      <button role="radio" data-mode="ox" aria-checked="${store.mode === "ox"}">一問一答<small>○×でテンポよく</small></button>
    </div>

    <p class="section-title">分野を選んで解く</p>
    <div class="cat-list">
      ${[{ id: "all", name: "全分野" }, ...CATEGORIES].map((c) => {
        const p = catProgress(c.id);
        return `<div class="cat-item" data-item="${c.id}">
          <button class="cat-card cat-${c.id}" data-cat="${c.id}" ${c.groups ? `aria-expanded="false" aria-controls="picker-${c.id}"` : ""}>
            <span class="cat-icon">${svgIcon(CAT_ICON[c.id])}</span>
            <span class="cat-body">
              <b>${esc(c.name)}</b>
              <span class="cat-meta">${c.groups ? `${c.groups.length}科目 ・ ` : ""}${p.q}問 ・ 進み具合 ${p.pct}%${p.acc !== null ? ` ・ 正答率 ${p.acc}%` : ""}</span>
              <span class="cat-bar"><i style="width:${p.pct}%"></i></span>
            </span>
            <span class="cat-go" aria-hidden="true">${c.groups ? "▾" : "›"}</span>
          </button>
          ${c.groups ? `<div class="picker" id="picker-${c.id}" hidden></div>` : ""}
        </div>`;
      }).join("")}
    </div>

    ${mockCard()}
  `;
  // 選ぶだけ。問題は分野を押したときに始まる
  view.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => {
    store.mode = b.dataset.mode; save();
    view.querySelectorAll("[data-mode]").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
  }));
  // 分野を押すと、その下に科目の選択が開く（画面は切り替えない）
  view.querySelectorAll("[data-cat]").forEach((b) => b.addEventListener("click", () => {
    const c = b.dataset.cat;
    if (c === "all") return startSession("all");
    const item = b.closest(".cat-item");
    const willOpen = !item.classList.contains("open");
    view.querySelectorAll(".cat-item.open").forEach((it) => {
      it.classList.remove("open");
      it.querySelector(".picker").hidden = true;
      it.querySelector("[data-cat]").setAttribute("aria-expanded", "false");
    });
    if (willOpen) {
      item.classList.add("open");
      b.setAttribute("aria-expanded", "true");
      const el = item.querySelector(".picker");
      el.hidden = false;
      drawPicker(c, el);
    }
  }));
  view.querySelector("#hero-login")?.addEventListener("click", renderLogin);
  view.querySelector("#today-start").addEventListener("click", () => (due ? startReview() : startSession("all")));
  view.querySelector("#resume")?.addEventListener("click", resumeSession);
  view.querySelector("#discard")?.addEventListener("click", () => { store.paused = null; save(); renderHome(); });
}

// ドリル画面の模試の入口（分野の一覧の下）。会員の機能なので「会員」の印を付ける。
// 解いている途中なら続きから、受けたことがあれば前回の点数を出す
function mockCard() {
  if (!MOCKS.length) return "";
  const run = store.mockRun;
  const taken = Object.values(store.mockResults || {}).flat().sort((a, b) => a.at - b.at);
  const last = taken[taken.length - 1];
  const sub = run ? `${mockById[run.id].name}の途中です（${run.picks.filter((p) => p !== null).length}/50問）`
    : last ? `前回 ${last.score}点・全${MOCK_ROUNDS}回`
    : `本試験と同じ50問・2時間を${MOCK_ROUNDS}回分`;
  return `<button class="mock-entry" data-go="mock">
    <span class="me-icon">${svgIcon('<path d="M9 3h6l1 2h3v16H5V5h3Z"/><path d="M9 12l2 2 4-4"/>')}</span>
    <span class="me-body"><b>本番形式の模試<span class="member-badge">会員</span></b><small>${sub}</small></span>
    <span class="me-go" aria-hidden="true">›</span>
  </button>`;
}

// ---------- 科目・項目の選択（分野カードの下に開く） ----------
const pickerState = {}; // 分野ごとに、選んだ項目と開いている科目を覚えておく

function drawPicker(catId, el) {
  const cat = CATEGORIES.find((c) => c.id === catId);
  const count = (topic) => QUESTIONS.filter((q) => q.category === catId && q.sub === topic).length;
  const available = cat.groups.flatMap((g) => g.topics).filter((t) => count(t) > 0);
  if (!pickerState[catId]) pickerState[catId] = { chosen: new Set(available), open: new Set() };
  const { chosen, open } = pickerState[catId];
  const n = QUESTIONS.filter((q) => q.category === catId && chosen.has(q.sub)).length;

  el.innerHTML = `
    <div class="check-head">
      <span>${chosen.size}項目を選択中</span>
      <button class="link-btn" data-act="all">${chosen.size === available.length ? "すべて外す" : "すべて選ぶ"}</button>
    </div>
    <ul class="group-list">
      ${cat.groups.map((g, gi) => {
        const avail = g.topics.filter((t) => count(t) > 0);
        const qn = g.topics.reduce((a, t) => a + count(t), 0);
        const sel = avail.filter((t) => chosen.has(t)).length;
        const state = !avail.length ? "" : sel === avail.length ? "checked" : sel ? "mixed" : "";
        const isOpen = open.has(gi);
        return `<li class="group ${isOpen ? "open" : ""}">
          <div class="group-row">
            <label class="check ${avail.length ? "" : "disabled"}">
              <input type="checkbox" data-group="${gi}" ${state === "checked" ? "checked" : ""} ${avail.length ? "" : "disabled"}>
              <span class="box ${state === "mixed" ? "mixed" : ""}" aria-hidden="true"></span>
              <span class="check-text">${esc(g.name)}<small>${qn ? `${qn}問` : "準備中"}</small></span>
            </label>
            <button class="expand" data-expand="${gi}" aria-expanded="${isOpen}" aria-label="${esc(g.name)}の項目を${isOpen ? "閉じる" : "開く"}">▾</button>
          </div>
          ${isOpen ? `<ul class="topic-list">
            ${g.topics.map((t) => {
              const c = count(t);
              return `<li><label class="check small ${c ? "" : "disabled"}">
                <input type="checkbox" data-topic="${esc(t)}" ${chosen.has(t) ? "checked" : ""} ${c ? "" : "disabled"}>
                <span class="box" aria-hidden="true"></span>
                <span class="check-text">${esc(t)}</span>
                <span class="check-count">${c ? `${c}問` : "準備中"}</span>
              </label></li>`;
            }).join("")}
          </ul>` : ""}
        </li>`;
      }).join("")}
    </ul>
    <button class="btn btn-primary btn-block" data-act="start" ${n ? "" : "disabled"}>選んだ科目で解く（${n}問・${store.mode === "four" ? "4択" : "一問一答"}）</button>`;

  const redraw = () => drawPicker(catId, el);
  el.querySelectorAll("[data-group]").forEach((inp) => inp.addEventListener("change", () => {
    const avail = cat.groups[Number(inp.dataset.group)].topics.filter((t) => count(t) > 0);
    const allOn = avail.every((t) => chosen.has(t));
    avail.forEach((t) => (allOn ? chosen.delete(t) : chosen.add(t)));
    redraw();
  }));
  el.querySelectorAll("[data-topic]").forEach((inp) => inp.addEventListener("change", () => {
    inp.checked ? chosen.add(inp.dataset.topic) : chosen.delete(inp.dataset.topic);
    redraw();
  }));
  el.querySelectorAll("[data-expand]").forEach((b) => b.addEventListener("click", () => {
    const gi = Number(b.dataset.expand);
    open.has(gi) ? open.delete(gi) : open.add(gi);
    redraw();
  }));
  el.querySelector("[data-act=all]").addEventListener("click", () => {
    if (chosen.size === available.length) chosen.clear(); else available.forEach((t) => chosen.add(t));
    redraw();
  });
  el.querySelector("[data-act=start]").addEventListener("click", () => {
    const subs = [...chosen];
    startSession(catId, subs.length === available.length ? null : subs);
  });
}

// ---------- 出題セッション ----------
let session = null;

// subs を渡すと、その論点（細かい分野）だけから出題する
function startSession(cat, subs = null) {
  store.paused = null; save(); // 新しく始めたら、中断中のドリルは破棄する
  const qs = shuffle(QUESTIONS.filter((q) => (cat === "all" || q.category === cat) && (!subs || subs.includes(q.sub))));
  let title = cat === "all" ? "全分野" : catName[cat];
  if (subs) title += `：${subs.length <= 2 ? subs.join("・") : `${subs[0]} ほか${subs.length - 1}項目`}`;
  if (store.mode === "four") {
    session = { kind: "four", title, list: qs.slice(0, SESSION_SIZE).map((q) => ({ qid: q.id })), i: 0, right: 0 };
  } else {
    const items = shuffle(qs.flatMap((q) => q.choices.map((_, idx) => ({ qid: q.id, idx }))));
    session = { kind: "ox", title, list: items.slice(0, SESSION_SIZE), i: 0, right: 0 };
  }
  renderCurrent();
}

function startReview() {
  const items = shuffle(dueItems());
  if (!items.length) return renderReviewHome();
  session = { kind: "ox", title: "今日の復習", list: items, i: 0, right: 0, review: true };
  renderCurrent();
}

// ---------- 復習 ----------
function renderReviewHome() {
  setNav("review");
  const due = dueItems().length;
  const doneToday = store.reviewed[dayKey()] || 0;
  const targets = Object.values(store.items).filter((it) => it.wrong > 0);
  // 最後に間違えたまま＝要復習、その後の復習で正解できた＝克服した
  const lv = { weak: 0, strong: 0 };
  targets.forEach((it) => (it.box >= 1 ? lv.strong++ : lv.weak++));
  const total = targets.length || 1;
  // 間違えた肢を科目ごとにまとめる（まだ定着していないもの）
  const bySub = {};
  Object.entries(store.items).forEach(([k, it]) => {
    if (!it.wrong || it.box >= 1) return; // 要復習のものだけ
    const [qid, idx] = k.split("#");
    const q = qById[qid];
    if (!q) return;
    const key = q.sub || q.topic;
    (bySub[key] = bySub[key] || { cat: q.category, items: [] }).items.push({ qid, idx: Number(idx) });
  });
  const weakSubs = Object.entries(bySub).sort((a, b) => b[1].items.length - a[1].items.length);

  const msg = due === 0 && doneToday > 0 ? "今日の復習はすべて完了。記憶がしっかり積み上がっています。"
    : due === 0 ? "今日の復習はありません。間違えた問題は、忘れかけた頃にここへ戻ってきます。"
    : doneToday > 0 ? `あと${due}問で今日の復習が完了します。`
    : "忘れかけた今が、いちばん覚えられるタイミングです。";

  view.innerHTML = `
    <section class="hero review-hero">
      <p class="cheer">${msg}</p>
      <div class="hero-stats">
        <div class="ring-wrap">
          ${ring(doneToday, doneToday + due)}
          <div class="ring-num">${due === 0 && doneToday > 0 ? `<b class="done-mark">${svgIcon('<path d="M20 6 9 17l-5-5"/>')}</b><small>完了</small>` : `<b>${due}</b><small>問 残り</small>`}</div>
        </div>
        <div class="hero-side">
          <div class="rv-kpi"><span>今日克服した問題</span><b>${store.overcome[dayKey()] || 0}</b></div>
        </div>
      </div>
      ${due
        ? `<button class="hero-cta" data-go="review-start">復習を始める<small>約${Math.max(1, Math.round(due * 0.5))}分</small></button>`
        : `<button class="hero-cta" data-go="home">新しい問題を解く</button>`}
    </section>

    <div class="card" style="margin-bottom:16px">
      <h2>間違えた科目 <small class="h-sub">まだ覚えきれていない問題の数・タップでその科目だけ復習</small></h2>
      ${weakSubs.length ? `<ul class="weak-list">
        ${weakSubs.map(([name, v]) => `
          <li><button class="weak-row" data-weak="${esc(name)}">
            <span class="cat-icon sm">${svgIcon(CAT_ICON[v.cat])}</span>
            <span class="weak-body">
              <span class="weak-name"><small>${esc(catName[v.cat])}</small>${esc(name)}</span>
            </span>
            <span class="weak-n">${v.items.length}<small>問</small></span>
          </button></li>`).join("")}
      </ul>` : `<p class="empty" style="margin:0">間違えた問題はまだありません。</p>`}
    </div>

    <div class="card" style="margin-bottom:16px">
      <h2>記憶の定着</h2>
      ${targets.length ? `
        <div class="stack">
          <i class="weak" style="flex:${lv.weak}"></i><i class="strong" style="flex:${lv.strong}"></i>
        </div>
        <div class="stack-legend">
          <span><i class="weak"></i>要復習 <b>${lv.weak}</b></span>
          <span><i class="strong"></i>克服した <b>${lv.strong}</b></span>
        </div>` : `<p class="empty" style="margin:0">まだありません。</p>`}
      <p class="source-note">正解するたびに、次の復習が 1→3→7→14→30日後 と伸びていきます。</p>
    </div>`;
  view.querySelectorAll("[data-weak]").forEach((b) => b.addEventListener("click", () => {
    const name = b.dataset.weak;
    session = { kind: "ox", title: `復習：${name}`, list: shuffle(bySub[name].items), i: 0, right: 0, review: true };
    renderCurrent();
  }));
}

function header() {
  const n = session.list.length;
  const shown = session.at ?? session.i;
  return `
    <div class="drill-head">
      <div class="quiz-top"><span class="left">${session.i >= n ? `<button class="back-btn" data-action="quit">‹ 結果に戻る</button>` : `<button class="back-btn" data-action="quit" aria-label="解くのをやめる">中断する</button>`}<span class="quiz-title">${esc(session.title)}</span></span><span class="right">${timerHtml()}<span>${shown + 1} / ${n}</span></span></div>
      <div class="progress"><i style="width:${(session.i / n) * 100}%"></i></div>
    </div>`;
}

// ---------- 解答スピードのタイマー（会員） ----------
// 目安（4択1問2分・一問一答1問30秒）に対する経過時間を、小さく控えめに表示する。
// 目安を過ぎても赤くしたり点滅させたりはせず、落ち着いた色で「+0:12」と出すだけ。押すと隠せる
let qTimer = null;
let timerState = null; // 今の問題の開始時刻と目安（表示を切り替えても計測は続ける）
const CLOCK = '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5"/><path d="M9 2h6"/>';
function timerHtml() {
  if (session && session.picks?.[session.at ?? session.i]) return "";
  // 会員でない人にも時計のアイコンは出し、押すと会員機能の案内を出す
  if (!store.member) return `<button class="q-timer off locked" data-action="timer-info" aria-label="解答タイマー（会員機能）">${svgIcon(CLOCK)}</button>`;
  // オフのときは時計のアイコンだけ出す。押すとその場でオンにできる
  if (store.timerOff) return `<button class="q-timer off" id="q-timer" data-action="timer" aria-pressed="false" aria-label="解答タイマーを表示する">${svgIcon(CLOCK)}</button>`;
  return `<button class="q-timer" id="q-timer" data-action="timer" aria-pressed="true" aria-label="解答タイマー（押すと隠す）">${svgIcon(CLOCK)}<i><b></b></i><span>0:00</span></button>`;
}
// 会員でない人が時計を押したときの案内（下から出るシート）
function openTimerInfo() {
  const dlg = document.getElementById("sheet");
  dlg.innerHTML = `
    <div class="sheet-head"><h2>解答タイマー<span class="member-badge">会員</span></h2><button class="sheet-close" aria-label="閉じる">×</button></div>
    <p style="margin:0 0 8px">本試験は50問を2時間。1問にかけられるのは約2分です。</p>
    <div class="timer-preview" aria-hidden="true">
      <span class="tp-caption">使っているときのイメージ</span>
      <div class="tp-screen">
        <div class="tp-bar"><span>宅建業法</span><span class="tp-right"><span class="q-timer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${CLOCK}</svg><i><b style="width:70%"></b></i><span>1:24 / 2:00</span></span><span>3 / 10</span></span></div>
        <div class="tp-q"></div><div class="tp-q short"></div>
        <span class="tp-note">目安の2分以内は、青いバーで経過時間を表示</span>
      </div>
      <div class="tp-screen">
        <div class="tp-bar"><span>宅建業法</span><span class="tp-right"><span class="q-timer over"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${CLOCK}</svg><i><b style="width:100%"></b></i><span>+0:18</span></span><span>3 / 10</span></span></div>
        <div class="tp-q"></div><div class="tp-q short"></div>
        <span class="tp-note">2分を過ぎたら、オレンジで超えた時間をお知らせ</span>
      </div>
    </div>
    <ul class="mp-list" style="margin-bottom:12px">
      <li>解いている問題の経過時間を、画面の上に小さく表示</li>
      <li>1問2分（一問一答は30秒）の目安を過ぎたら、そっとお知らせ</li>
      <li>分野ごとの平均時間を成績画面で確認</li>
    </ul>
    <p class="mp-price" style="margin-bottom:10px">月580円から・7日間の返金保証つき</p>
    <div class="login-btns" style="margin:0">
      <button class="btn btn-primary btn-block" id="ti-plans">会員プランを見る</button>
      <button class="btn btn-block" id="ti-close">問題に戻る</button>
    </div>
    <p class="source-note" style="text-align:center">プランを見ても、このドリルは「続きから再開」で戻れます。</p>`;
  const close = () => dlg.close();
  dlg.querySelector(".sheet-close").addEventListener("click", close);
  dlg.querySelector("#ti-close").addEventListener("click", close);
  dlg.querySelector("#ti-plans").addEventListener("click", () => {
    dlg.close();
    if (session) savePaused(); // 解いている途中のドリルは保存しておく
    renderPlans();
  });
  dlg.showModal();
}

function fmtSec(sec) { return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`; }
function startTimer(startedAt, limit) {
  stopTimer();
  timerState = { startedAt, limit };
  const tick = () => {
    const el = document.getElementById("q-timer");
    if (!el || el.classList.contains("off")) return;
    const sec = (Date.now() - startedAt) / 1000;
    el.querySelector("b").style.width = `${Math.min(100, (sec / limit) * 100)}%`;
    el.querySelector("span").textContent = sec <= limit ? `${fmtSec(sec)} / ${fmtSec(limit)}` : `+${fmtSec(sec - limit)}`;
    el.classList.toggle("over", sec > limit);
  };
  tick();
  qTimer = setInterval(tick, 1000);
}
function stopTimer() { clearInterval(qTimer); qTimer = null; }

// 正解・不正解を指先にも伝える（対応端末のみ）
function buzz(ok) {
  try { navigator.vibrate?.(ok ? 15 : [30, 50, 30]); } catch (e) { /* noop */ }
}

function renderCurrent() {
  // 表示する問題の年度の解説がまだなら、このドリルで出る年度の分をまとめて読んでから表示する
  // （模試の見返しは50問が多くの年度にまたがるので、開いた問題の年度だけ読む）
  const shownQ = qById[(session.list[session.at ?? session.i] || {}).qid];
  const slugs = (session.mock ? [shownQ] : session.list.map((it) => qById[it.qid])).filter((q) => q && q.source === "retio").map(examSlug);
  if (shownQ && shownQ.source === "retio" && expState[examSlug(shownQ)] !== "done") {
    loadExplain(slugs).then(() => { if (qById[(session.list[session.at ?? session.i] || {}).qid] === shownQ) renderCurrent(); });
    if (expState[examSlug(shownQ)] !== "done") return;
  }
  loadExplain(slugs);
  setNav(session.review ? "review" : "home");
  session.picks = session.picks || []; // 1問ごとの答え（見返し用）。前の版で中断したドリルには無い
  if (session.at === undefined && session.i >= session.list.length) return session.mock ? renderMockResult(session.mock.id, session.mock.idx) : renderSummary();
  // スマホでは解いている間、メニュー・広告を隠して問題だけに集中できる画面にする
  document.body.classList.add("in-drill");
  session.kind === "four" ? renderFour() : renderOx();
}

function next() { session.i++; session.answered = false; renderCurrent(); }

// ---------- 解いた問題を見返す ----------
// session.at に番号が入っている間は、解き終わった問題を答えた状態で表示する（読むだけで、記録は変えない）。
// undefined なら今解いている問題（解き終わった後なら結果の画面）
function prevButton() {
  const shown = session.at ?? session.i;
  return shown > 0 && session.picks[shown - 1] ? `<button class="btn" id="prev" aria-label="前の問題に戻る">‹ 戻る</button>` : "";
}
function navActions() {
  let label = "次へ";
  if (session.at !== undefined) {
    if (session.at + 1 < session.i) label = "次の問題 ›";
    else label = session.i >= session.list.length ? "結果に戻る" : "今の問題に戻る";
  }
  return `<div class="actions">${prevButton()}<button class="btn btn-primary" id="next">${label}</button></div>`;
}
function bindNav(onNext) {
  view.querySelector("#prev")?.addEventListener("click", () => { session.at = (session.at ?? session.i) - 1; renderCurrent(); });
  view.querySelector("#next")?.addEventListener("click", () => {
    if (session.at === undefined) return onNext();
    session.at = session.at + 1 >= session.i ? undefined : session.at + 1;
    renderCurrent();
  });
}

// ---------- 一時中断 ----------
// 回答は1問ごとに保存済み。ここでは「どこまで進んだか」を保存し、ログインを勧める。
// 今のドリルの続きを保存して抜ける（ドリル画面の「続きから再開」で戻れる）
function savePaused() {
  const resumeAt = session.answered ? session.i + 1 : session.i;
  store.paused = resumeAt < session.list.length ? { ...session, i: resumeAt, at: undefined, answered: false, pausedAt: Date.now() } : null;
  save();
  session = null;
}

function pauseSession() {
  savePaused();
  renderPaused();
}

// 途中の位置は保存せずに、始める前の画面へ戻る（解いた問題の正誤は1問ごとに記録済み）
// 確認はブラウザの confirm() ではなくシートで出す（LINEなどのアプリ内ブラウザでは confirm() が出ずに何も起きないことがあるため）
function quitSession() {
  if (!session) return;
  if (session.i >= session.list.length) { session.at = undefined; return renderCurrent(); }
  if (session.i > 0 || session.answered) return openQuitSheet();
  leaveSession();
}

function openQuitSheet() {
  const dlg = document.getElementById("sheet");
  dlg.innerHTML = `
    <div class="sheet-head"><h2>戻りますか？</h2><button class="sheet-close" aria-label="閉じる">×</button></div>
    <p style="margin:0 0 12px">保存して中断すると、あとで「続きから再開」できます。解いた問題の正誤は、どちらを選んでも記録済みです。</p>
    <div class="login-btns" style="margin:0">
      <button class="btn btn-primary btn-block" id="qs-pause">保存して中断する</button>
      <button class="btn btn-block" id="qs-quit">保存せずに戻る</button>
      <button class="btn btn-block" id="qs-close">問題に戻る</button>
    </div>`;
  const close = () => dlg.close();
  dlg.querySelector(".sheet-close").addEventListener("click", close);
  dlg.querySelector("#qs-close").addEventListener("click", close);
  dlg.querySelector("#qs-pause").addEventListener("click", () => { close(); if (session) pauseSession(); });
  dlg.querySelector("#qs-quit").addEventListener("click", () => { close(); leaveSession(); });
  dlg.showModal();
}

function leaveSession() {
  if (!session) return;
  const toReview = session.review;
  session = null;
  toReview ? renderReviewHome() : renderHome();
}

function renderPaused() {
  setNav("home");
  const p = store.paused;
  const where = p ? `「${esc(p.title)}」の ${p.i + 1}問目から再開できます。` : "";
  if (store.user) {
    view.innerHTML = `
      <h1>中断しました</h1>
      <div class="card">
        <p>回答はアカウントに保存しました。${where}スマホやPCなど、どの端末からでも続きを解けます。</p>
        <button class="btn btn-primary btn-block" data-go="home">ドリルに戻る</button>
      </div>`;
    return;
  }
  view.innerHTML = `
    <h1>回答を保存して中断しますか？</h1>
    <div class="card">
      <p>ここまでの回答は、この端末に一時保存しました。${where}</p>
      <p><b>ログインすると</b>、スマホやPCなど別の端末でも続きから再開でき、間違えた問題や復習の記録も消えません。</p>
      <div class="login-btns">
        ${loginButtons("でログインして保存")}
      </div>
      <div style="text-align:center"><button class="link-btn" data-go="home">ログインせずに中断する</button></div>
      ${cloudReady() ? "" : `<p class="source-note">試作版のため、ログインは画面の流れだけを再現しています。</p>`}
    </div>`;
  view.querySelectorAll("[data-login]").forEach((b) => b.addEventListener("click", () => startLogin("paused")));
}

// ログインはGoogleだけ。ボタンの見た目はGoogleのガイドラインに合わせる（白地にロゴ）
const GOOGLE_LOGO = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.8l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>';
function loginButtons(suffix) {
  return `<button class="btn btn-block btn-google" data-login="google">${GOOGLE_LOGO}Google${suffix}</button>`;
}

// ヘッダー右端のボタン：未ログインなら「ログイン」、ログイン中はアカウント
function renderAccount() {
  const b = document.getElementById("account-btn");
  const userIcon = svgIcon('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>');
  if (store.user) {
    b.className = "account-btn in";
    b.innerHTML = `${userIcon}<span>マイページ</span>`;
    b.setAttribute("aria-label", "マイページ（ログイン中）");
  } else {
    b.className = "account-btn";
    b.innerHTML = "ログイン";
    b.setAttribute("aria-label", "ログイン");
  }
}
document.getElementById("account-btn").addEventListener("click", () => (store.user ? renderAccountPage() : renderLogin()));

function renderAccountPage() {
  setNav("");
  view.innerHTML = `
    <button class="back-link" data-go="home">‹ ドリルに戻る</button>
    <h1>マイページ</h1>
    ${store.member ? memberCard() : ""}
    <div class="card account-card">
      <p style="margin-top:0">Googleアカウントでログイン中です。学習の記録はアカウントに保存され、どの端末からでも続きを解けます。</p>
      <div class="login-btns">
        ${store.member ? "" : `<button class="btn btn-primary btn-block" data-go="plans">会員プランを見る</button>`}
        <button class="btn btn-block" id="logout">ログアウト</button>
      </div>
      ${cloudReady() ? "" : `<p class="source-note">試作版のため、ログインは画面の流れだけを再現しています。</p>`}
    </div>`;
  view.querySelector("#logout").addEventListener("click", async () => {
    await cloudSignOut();
    store.user = null; store.member = null; save(); renderHome();
  });
  view.querySelector("#cancel-plan")?.addEventListener("click", renderCancelPlan);
  view.querySelector("#resume-plan")?.addEventListener("click", async (e) => {
    if (billingReady()) {
      e.target.disabled = true;
      try { await billingCall("resume"); await cloudLoadMember(); }
      catch (err) { e.target.disabled = false; return toast("解約を取り消せませんでした。時間をおいてもう一度お試しください"); }
    } else { delete store.member.canceled; delete store.member.until; save(); }
    toast("解約を取り消しました。このまま使い続けられます");
    renderAccountPage();
  });
  // カードの変更・領収書は Stripe の画面で行う
  view.querySelector("#billing-portal")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    try { location.href = (await billingCall("portal")).url; }
    catch (err) { e.target.disabled = false; toast("お支払いの画面を開けませんでした。時間をおいてもう一度お試しください"); }
  });
}

// ---------- 会員プランの解約 ----------
// 月額プランは毎月、申込日と同じ日に更新する。解約しても、次の更新日の前日まで使える
const fmtMD = (key) => { const [, m, d] = key.split("-").map(Number); return `${m}/${d}`; };
function nextRenewal(since) {
  const [y, m, d] = since.split("-").map(Number);
  const today = dayKey();
  for (let i = 1; ; i++) {
    const t = new Date(y, m - 1 + i, d);
    const key = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    if (key > today) return key;
  }
}
const lastDayBefore = (key) => dayKey(new Date(key + "T00:00:00").getTime() - DAY);
// 申込から7日以内なら全額返金できる。返金できる最後の日を返す（過ぎていれば null）
function refundUntil(since) {
  const last = dayKey(new Date(since + "T00:00:00").getTime() + 7 * DAY);
  return last >= dayKey() ? last : null;
}
// 解約した月額プランは、使える期間を過ぎたら無料に戻す
function expireMember() {
  if (store.member?.canceled && store.member.until < dayKey()) { store.member = null; save(); }
}

function memberCard() {
  const m = store.member;
  const plan = PLANS.find((p) => p.id === m.plan);
  const refund = refundUntil(m.since);
  const status = m.plan === "exam" ? "本試験の日まで使えます。自動の更新はありません。"
    : m.canceled ? `解約済みです。<b>${fmtMD(m.until)}</b>まで会員の機能を使えます。`
    : `次の更新日は<b>${fmtMD(m.renews || nextRenewal(m.since))}</b>です（${plan.price.toLocaleString()}円）。`;
  return `
    <div class="card member-card">
      <div class="card-head"><h2>会員プラン</h2><span class="status ${m.canceled ? "" : "ok"}">${m.canceled ? "解約済み" : "登録中"}</span></div>
      <p class="mc-plan"><b>${plan.name}</b>${plan.price.toLocaleString()}${plan.unit}</p>
      <p class="mc-status">${status}</p>
      ${refund ? `<p class="mc-refund">申込から7日以内のため、${fmtMD(refund)}までは全額返金を受けられます。<button class="link-inline" data-go="contact">お問い合わせ</button>からお申し出ください。</p>` : ""}
      <div class="login-btns" style="margin-bottom:0">
        <button class="btn btn-block" data-go="plans">プランの内容を見る</button>
        ${billingReady() ? `<button class="btn btn-block" id="billing-portal">カードの変更・領収書</button>` : ""}
      </div>
      ${m.plan === "monthly" ? `
      <div class="mc-cancel">
        <h3>解約</h3>
        ${m.canceled
          ? `<p>解約の手続きは済んでいます。${fmtMD(m.until)}までに取り消せば、このまま使い続けられます。</p>
             <button class="btn btn-primary btn-block" id="resume-plan">解約を取り消す</button>`
          : `<p>いつでも解約できます。解約しても、支払い済みの${fmtMD(lastDayBefore(m.renews || nextRenewal(m.since)))}までは会員の機能を使えます。</p>
             <button class="btn btn-block btn-danger" id="cancel-plan">月額プランを解約する</button>`}
      </div>` : ""}
    </div>`;
}

function renderCancelPlan() {
  setNav("");
  const m = store.member;
  const until = lastDayBefore(m.renews || nextRenewal(m.since));
  const refund = refundUntil(m.since);
  view.innerHTML = `
    <button class="back-link" id="cancel-back">‹ マイページに戻る</button>
    <h1>月額プランを解約しますか？</h1>
    <div class="card">
      <p style="margin-top:0">解約しても、支払い済みの<b>${fmtMD(until)}まで</b>は会員の機能を使えます。その後は無料のまま使い続けられます。</p>
      <p>解約すると、${fmtMD(until)}の翌日から次の機能が使えなくなります。</p>
      <ul class="cancel-list">
        <li>合格ペース診断（時期ごとの判定・予想得点）</li>
        <li>解答スピードのタイマーと分析</li>
        <li>本番形式の模試</li>
        <li>バナー広告の非表示</li>
      </ul>
      <p class="source-note">過去問の演習・復習・学習の記録はそのまま残り、無料で使い続けられます。${refund ? `申込から7日以内のため、${fmtMD(refund)}までは全額返金も受けられます（お問い合わせからお申し出ください）。` : ""}</p>
      <div class="login-btns" style="margin-bottom:0">
        <button class="btn btn-block btn-danger" id="cancel-confirm">解約する</button>
        <button class="btn btn-primary btn-block" id="cancel-keep">会員を続ける</button>
      </div>
    </div>`;
  const back = () => renderAccountPage();
  view.querySelector("#cancel-back").addEventListener("click", back);
  view.querySelector("#cancel-keep").addEventListener("click", back);
  view.querySelector("#cancel-confirm").addEventListener("click", async (e) => {
    if (billingReady()) {
      // Stripe のサブスクリプションを、支払い済みの期間の終わりで止める
      e.target.disabled = true;
      try { await billingCall("cancel"); await cloudLoadMember(); }
      catch (err) { e.target.disabled = false; return toast("解約できませんでした。時間をおいてもう一度お試しください"); }
    } else {
      // 試作版：画面の流れだけ
      store.member = { ...m, canceled: true, until };
      save();
    }
    toast(`解約しました。${fmtMD(until)}まで会員の機能を使えます`);
    renderAccountPage();
  });
}

// ---------- 会員プラン ----------
// 料金は相場から設定（競合の過去問道場：月490円・年3,900円、オンスク：月1,078円〜）。
// 合格ペース診断・解答スピードのぶん競合より少し高くし、試験までプランは月額6か月分で頭打ちにする。決済は本番でStripeに置き換える
const PLANS = [
  { id: "monthly", name: "月額プラン", price: 580, unit: "円 / 月（税込）", note: "マイページからいつでも簡単に解約できます" },
  { id: "exam", name: "試験までプラン", price: 3480, unit: "円（税込・一括）", note: "本試験の日まで使えます" },
];
// 案内に出す模試の回数（全5回）。MOCKS がそろう前から5回分として案内する（会員プランの表・ドリル画面の入口・おすすめ欄）
const MOCK_ROUNDS = 5;
const FEATURES = [
  ["過去問の演習（4択・一問一答）", true, true],
  ["くわしい解説（ひっかけポイント・関連論点）", true, true],
  ["復習（間違えた問題が自動で戻ってくる）", true, true],
  ["学習カレンダー・分野ごとの正答率", true, true],
  ["合格スケジュール", true, true],
  ["合格ペース診断（時期ごとの判定・予想得点）", false, true],
  ["解答スピードのタイマーと分析（1問2分が目安）", false, true],
  ["本番形式の模試（50問・2時間・オリジナル問題）", false, `${MOCK_ROUNDS}回分`],
  ["バナー広告の非表示", false, true],
];
let selectedPlan = null;

function renderPlans() {
  setNav("");
  const mark = (v) => (typeof v === "string" ? `<span class="yes txt">${v}</span>` : v ? `<span class="yes">○</span>` : `<span class="no">—</span>`);
  const { left } = examInfo();
  const months = Math.max(1, Math.ceil(left / 30));
  const monthlyTotal = PLANS[0].price * months;
  const examPlan = PLANS[1];
  // 試験までの月数で安くなる方をおすすめにする
  const recommended = monthlyTotal > examPlan.price ? "exam" : "monthly";
  if (!selectedPlan) selectedPlan = recommended;
  view.innerHTML = `
    <button class="back-link" data-go="home">‹ ドリルに戻る</button>
    <div class="plan-hero">
      <h1>会員プラン</h1>
      <p>過去問と復習は、これからもずっと無料です。<br>合格までの最短ルートを知りたい人のための追加機能です。</p>
    </div>
    ${store.member ? `<div class="member-on">${svgIcon('<path d="M20 6 9 17l-5-5"/>')}<span>${PLANS.find((p) => p.id === store.member.plan).name}に登録中です</span><button class="link-inline" data-go="account">${store.member.plan === "monthly" ? "解約・お支払いの管理" : "登録内容の確認"}</button></div>` : ""}
    <div class="plans" role="radiogroup">
      ${PLANS.map((p) => `
        <button class="plan-card" role="radio" aria-checked="${p.id === selectedPlan}" data-plan="${p.id}">
          ${p.id === recommended ? `<span class="pc-tag">おすすめ</span>` : ""}
          <span class="pc-name">${p.name}</span>
          <span class="pc-price">${p.price.toLocaleString()}<small>${p.unit}</small></span>
          <span class="pc-note">${p.note}${p.id === "exam" && monthlyTotal > p.price ? `。試験まで月額で使うより ${(monthlyTotal - p.price).toLocaleString()}円お得` : ""}${p.id === "monthly" && recommended === "monthly" ? `。試験まであと${months}か月なら ${monthlyTotal.toLocaleString()}円` : ""}</span>
        </button>`).join("")}
    </div>
    <div class="card">
      <table class="compare">
        <thead><tr><th>機能</th><th class="c">無料</th><th class="c mem">会員</th></tr></thead>
        <tbody>${FEATURES.map(([n, f, m]) => `<tr><td>${n}</td><td class="c">${mark(f)}</td><td class="c mem">${mark(m)}</td></tr>`).join("")}</tbody>
      </table>
    </div>
    ${store.member ? "" : `
    <div class="plan-cta">
      <button class="btn btn-primary btn-block" id="subscribe">${PLANS.find((p) => p.id === selectedPlan).name}で会員になる</button>
      <small>7日間の返金保証つき。${store.user ? "" : "登録にはログインが必要です。"}${billingReady() ? "お支払いはクレジットカード（Stripe）です。" : "試作版のため、実際の決済は行われません。"}</small>
    </div>`}`;
  view.querySelectorAll("[data-plan]").forEach((b) => b.addEventListener("click", () => {
    selectedPlan = b.dataset.plan;
    const y = window.scrollY; renderPlans(); window.scrollTo(0, y);
  }));
  view.querySelector("#subscribe")?.addEventListener("click", () => {
    if (!store.user) { afterLogin = "plans"; return renderLogin(); }
    renderCheckout();
  });
}

function renderCheckout() {
  setNav("");
  const p = PLANS.find((x) => x.id === selectedPlan);
  view.innerHTML = `
    <button class="back-link" data-go="plans">‹ プランに戻る</button>
    <h1>お申し込み内容の確認</h1>
    <div class="card">
      <p style="margin-top:0"><b>${p.name}</b>　${p.price.toLocaleString()}${p.unit}</p>
      <p class="source-note">${billingReady()
        ? `ボタンを押すと、決済サービス Stripe のお支払い画面に移ります。カード番号は Stripe が受け取り、当サイトには保存されません。${p.id === "monthly" ? "毎月、申込日と同じ日に自動で更新されます。" : "本試験の日まで使えます。自動の更新はありません。"}<button class="link-inline" data-go="tokushoho">特定商取引法に基づく表記</button>・<button class="link-inline" data-go="terms">利用規約</button>に同意のうえお申し込みください。`
        : "本番では、ここからStripeの決済画面に移ります。試作版のため、ボタンを押すと決済なしで会員になります。"}</p>
      <button class="btn btn-primary btn-block" id="pay">${billingReady() ? "お支払いへ進む" : "申し込む"}</button>
    </div>`;
  view.querySelector("#pay").addEventListener("click", async (e) => {
    if (billingReady()) {
      e.target.disabled = true;
      try { location.href = (await billingCall("checkout", { plan: p.id })).url; }
      catch (err) { e.target.disabled = false; toast("お支払いの画面を開けませんでした。時間をおいてもう一度お試しください"); }
      return;
    }
    store.member = { plan: p.id, since: dayKey() };
    save();
    renderPlans();
  });
}

// ログイン後に戻る画面の名前（会員登録の途中でログインした場合は "plans"）
let afterLogin = null;

function renderLogin() {
  setNav("home");
  document.body.classList.add("on-login"); // ログイン画面の中に会員プランの案内があるので、サイドの会員紹介は出さない
  view.innerHTML = `
    <button class="back-link" data-go="home">‹ ドリルに戻る</button>
    <h1>ログインして記録を残す</h1>
    <div class="card">
      <p>ログインすると、連続学習の日数、間違えた問題、復習の予定がアカウントに保存されます。スマホとPCで同じ記録を使え、機種変更しても消えません。</p>
      <p class="source-note" style="margin-top:0">ログインは無料です。今この端末にある記録も、そのまま引き継がれます。</p>
      <div class="login-btns">
        ${loginButtons("でログイン")}
      </div>
      ${cloudReady() ? "" : `<p class="source-note">試作版のため、ログインは画面の流れだけを再現しています。</p>`}
    </div>
    ${store.member ? "" : `
    <div class="member-promo login-plan">
      <span class="mp-eyebrow">会員プラン</span>
      <p class="lp-text">ログインすると、<b>月580円から</b>会員プランも使えます。合格ペース診断・解答スピードの分析・本番形式の模試で、合格までの道のりがもっとはっきりします。</p>
      <button class="btn btn-block mp-btn" data-go="plans">会員プランを見る</button>
      <p class="mp-free">7日間の返金保証つき。過去問と復習はずっと無料です</p>
    </div>`}`;
  view.querySelectorAll("[data-login]").forEach((b) => b.addEventListener("click", () => startLogin(afterLogin || "home")));
}

// ログインを始める。Supabaseの設定があればGoogleの画面へ移り、なければ試作の動き（その場でログインしたことにする）
function startLogin(returnTo) {
  afterLogin = null;
  if (cloudReady()) return cloudSignIn(returnTo);
  store.user = { name: "demo", via: "google" };
  save();
  finishLogin(returnTo);
}

// ログインが終わったら、ログインを始めた画面の続きに戻る（会員登録の途中なら会員プランへ、中断中ならその画面へ）
function finishLogin(returnTo) {
  toast("ログインしました。記録はアカウントに保存されます");
  renderAccount();
  if (returnTo === "plans") return renderPlans();
  if (returnTo === "paused") return renderPaused();
  renderHome();
}

// 画面下に短いお知らせを数秒だけ出す
function toast(msg) {
  document.querySelector(".toast")?.remove();
  const t = document.createElement("div");
  t.className = "toast";
  t.setAttribute("role", "status");
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add("out"), 2600);
  setTimeout(() => t.remove(), 3000);
}

function resumeSession() {
  session = store.paused;
  store.paused = null;
  save();
  renderCurrent();
}

// 4択
function renderFour() {
  const shown = session.at ?? session.i;
  const done = session.picks[shown]; // 解答済みなら、そのときの答えで表示する
  const q = qById[session.list[shown].qid];
  const memos = store.memos[q.id] || ["", "", "", ""];
  let picked = done ? done.p : null;
  const startedAt = Date.now();

  const answer = answerOf(q);
  // 「いくつあるか」「組合せ」の問題：ア〜エの記述を読んで、下の選択肢（一つ・二つ…）から選ぶ
  const statements = (answered) => `
        <p class="memo-cap" aria-hidden="true">メモ</p>
        <ul class="choices statements">
          ${q.choices.map((c, i) => `<li class="choice-row">
              <span class="memo" role="group" aria-label="記述${LABELS[i]}のメモ（採点されません）">
                <button class="mk o ${memos[i] === "o" ? "on" : ""}" data-memo="${i}" data-set="o" aria-pressed="${memos[i] === "o"}" aria-label="○のメモ">○</button>
                <button class="mk x ${memos[i] === "x" ? "on" : ""}" data-memo="${i}" data-set="x" aria-pressed="${memos[i] === "x"}" aria-label="×のメモ">×</button>
              </span>
              <div class="choice stmt ${answered ? (c.isTrue ? "is-correct" : "is-wrong") : ""}"><span class="num">${LABELS[i]}</span><span class="body">${esc(c.text)}</span></div>
            </li>`).join("")}
        </ul>
        <ul class="choices options">
          ${q.options.map((o, i) => {
            let cls = "choice";
            if (!answered && picked === i) cls += " selected";
            if (answered && i === answer) cls += " is-correct";
            if (answered && i === picked && i !== answer) cls += " is-wrong";
            return `<li><button class="${cls}" data-pick="${i}" ${answered ? "disabled" : ""}><span class="num">${NUMS[i]}</span><span class="body">${esc(o)}</span></button></li>`;
          }).join("")}
        </ul>`;

  const draw = (answered) => {
    view.innerHTML = `
      ${header()}
      <div class="card ${answered ? "answered" : ""}">
        <span class="tag">${esc(catName[q.category])}</span><span class="tag">${esc(q.topic)}</span>${q.source === "retio" ? `<span class="tag src">${esc(examLabel(q))}</span>` : ""}
        ${revBlock(q)}
        <p class="stem">${esc(q.stem)}</p>
        ${q.options ? statements(answered) : `
        <p class="memo-cap" aria-hidden="true">メモ</p>
        <ul class="choices">
          ${q.choices.map((c, i) => {
            let cls = "choice";
            if (!answered && picked === i) cls += " selected";
            if (answered && i === answer) cls += " is-correct";
            if (answered && i === picked && i !== answer) cls += " is-wrong";
            const memoLabel = memos[i] === "o" ? "○" : memos[i] === "x" ? "×" : "";
            return `<li class="choice-row">
              <span class="memo" role="group" aria-label="選択肢${i + 1}のメモ（採点されません）">
                <button class="mk o ${memos[i] === "o" ? "on" : ""}" data-memo="${i}" data-set="o" aria-pressed="${memos[i] === "o"}" aria-label="○のメモ">○</button>
                <button class="mk x ${memos[i] === "x" ? "on" : ""}" data-memo="${i}" data-set="x" aria-pressed="${memos[i] === "x"}" aria-label="×のメモ">×</button>
              </span>
              <button class="${cls}" data-pick="${i}" ${answered ? "disabled" : ""}><span class="num">${NUMS[i]}</span><span class="body">${esc(c.text)}</span></button>
            </li>`;
          }).join("")}
        </ul>`}
        ${answered ? explanation(q, picked === answer, answer) : `
          <div class="actions">${prevButton()}<button class="btn btn-primary" id="submit" ${picked === null ? "disabled" : ""}>解答する</button></div>`}
      </div>`;
    if (answered) fillAnswerAd(`four:${q.id}`);

    // 消去法メモ：縦に並んだ ○ と × のどちらかを押す。同じものをもう一度押すと消える
    if (session.at === undefined) view.querySelectorAll("[data-memo]").forEach((b) => b.addEventListener("click", () => {
      const i = Number(b.dataset.memo), v = b.dataset.set;
      memos[i] = memos[i] === v ? "" : v;
      store.memos[q.id] = memos; save();
      if (!answered) return draw(false);
      // 解答した後は画面を作り直さず、メモの印だけ変える（広告を読み込み直さないため）
      b.parentElement.querySelectorAll(".mk").forEach((m) => {
        const on = memos[i] === m.dataset.set;
        m.classList.toggle("on", on); m.setAttribute("aria-pressed", on);
      });
    }));
    if (!answered) {
      view.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => { picked = Number(b.dataset.pick); draw(false); }));
      const submit = view.querySelector("#submit");
      if (submit) submit.addEventListener("click", () => {
        const ok = picked === answer;
        stopTimer();
        recordSpeed("four", q.category, (Date.now() - startedAt) / 1000);
        store.qCount[q.id] = (store.qCount[q.id] || 0) + 1; // 周回数の記録
        if (q.options) {
          // 「いくつあるか」などは記述を全部見分ける必要があるので、間違えたらア〜エをすべて復習に入れる
          if (!ok) q.choices.forEach((_, i) => recordChoice(q.id, i, false));
        } else {
          recordChoice(q.id, answer, ok);
          if (!ok) recordChoice(q.id, picked, false);
        }
        recordCategory(q.category, ok);
        if (ok) session.right++;
        session.picks[session.i] = { p: picked, ok };
        session.answered = true;
        buzz(ok);
        save(); draw(true);
        view.querySelector(".result")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      bindNav();
    } else {
      bindNav(() => {
        delete store.memos[q.id]; save(); next(); // 解き終わった問題のメモは消す
      });
    }
  };
  draw(!!done);
  if (!done) startTimer(startedAt, SEC_PER_Q);
}

// くわしい解説（全員に表示）。公開前に作って保存しておいたものを出すだけで、AIは呼ばない
function detailBlock(c) {
  if (!c.detail || !(c.detail.trap || c.detail.related)) return "";
  return `<dl class="detail">
    ${c.detail.trap ? `<dt>ひっかけポイント</dt><dd>${esc(c.detail.trap)}</dd>` : ""}
    ${c.detail.related ? `<dt>あわせて覚える</dt><dd>${esc(c.detail.related)}</dd>` : ""}
  </dl>`;
}

// 問題ごとのポイントと図表。図表は表（table）と、人や手続きの流れ（flow）の2種類
function pointBlock(q) {
  if (!q.point && !q.figures) return "";
  return `<section class="point">
    <h3>この問題のポイント</h3>
    ${q.point ? q.point.split("\n").map((t) => `<p>${esc(t)}</p>`).join("") : ""}
    ${(q.figures || []).map(figureHtml).join("")}
  </section>`;
}
function figureHtml(f) {
  const cap = f.title ? `<figcaption>${esc(f.title)}</figcaption>` : "";
  const note = f.note ? `<p class="fig-note">${esc(f.note)}</p>` : "";
  // セルは文字列か { t: 文字列, hl: true }（強調）
  const cell = (c, tag) => {
    const o = typeof c === "string" ? { t: c } : c;
    return `<${tag}${o.hl ? ' class="hl"' : ""}>${esc(o.t)}</${tag}>`;
  };
  if (f.type === "table") {
    return `<figure class="fig">${cap}
      <div class="fig-scroll"><table class="fig-table">
        ${f.head ? `<thead><tr>${f.head.map((c) => cell(c, "th")).join("")}</tr></thead>` : ""}
        <tbody>${f.rows.map((r) => `<tr>${r.map((c, i) => cell(c, i === 0 && f.rowHead !== false ? "th" : "td")).join("")}</tr>`).join("")}</tbody>
      </table></div>${note}</figure>`;
  }
  if (f.type === "flow") {
    // nodes を左から順に並べ、あいだに links[i]（矢印の上の言葉）を置く
    return `<figure class="fig">${cap}
      <div class="fig-flow">
        ${f.nodes.map((n, i) => `
          ${i ? `<div class="fig-link"><span>${esc(f.links?.[i - 1] || "")}</span><i aria-hidden="true">→</i></div>` : ""}
          <div class="fig-node ${n.tone || ""}"><b>${esc(n.label)}</b>${n.sub ? `<small>${esc(n.sub)}</small>` : ""}</div>`).join("")}
      </div>${note}</figure>`;
  }
  return "";
}

// ---------- 解答のすぐ下の広告（AdSense・細い横長。出せないときは講座・転職の紹介） ----------
// 正解・不正解の表示のすぐ下に1つだけ出す。会員には出さない。config.js に AdSense の ID を入れるまでは何も出ない
// （手元の確認用に、localhost では ID が空でも位置だけ枠で見せる）
const AD = { client: (window.TAKKEN_CONFIG || {}).adsenseClient, slot: (window.TAKKEN_CONFIG || {}).adsenseSlotAnswer, side: (window.TAKKEN_CONFIG || {}).adsenseSlotSide };
const AD_LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
let adShown = { key: "", at: 0 };
function answerAd() {
  if (store.member) return "";
  if (!AD.client || !AD.slot) return AD_LOCAL ? `<div class="ad-answer"><span class="ad-label">広告</span><div class="ad-dummy">広告枠（仮）</div></div>` : "";
  return `<div class="ad-answer"><span class="ad-label">広告</span><ins class="adsbygoogle" data-ad-client="${AD.client}" data-ad-slot="${AD.slot}"${AD_LOCAL ? ' data-adtest="on"' : ""}></ins></div>`;
}
// 画面を作った後に呼ぶ。広告は「問題を進めたとき」にだけ読み込み、同じ問題の描き直しでは読み込み直さない（AdSense は自動の再読み込みを禁じている）
function fillAnswerAd(key) {
  const ins = view.querySelector(".ad-answer ins");
  if (!ins) return;
  if (adShown.key === key && Date.now() - adShown.at < 30000) return ins.parentElement.remove();
  adShown = { key, at: Date.now() };
  if (!document.querySelector('script[src*="adsbygoogle.js"]')) { // ふつうは index.html の <head> で読み込み済み
    const sc = document.createElement("script");
    sc.id = "adsense-js"; sc.async = true; sc.crossOrigin = "anonymous";
    sc.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${AD.client}`;
    document.head.appendChild(sc);
  }
  try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { return answerAff(ins.parentElement); }
  // AdSense に出せる広告がなかったとき（data-ad-status="unfilled"）は、代わりに講座・転職の紹介を1件出す
  new MutationObserver((_, ob) => {
    if (ins.dataset.adStatus === "unfilled") { ob.disconnect(); answerAff(ins.parentElement); }
  }).observe(ins, { attributes: true, attributeFilter: ["data-ad-status"] });
}
// 解答の下の枠に出す紹介（PR）。サイドの広告枠と同じもの（side: true）を、問題を進めるたびに順番に出す
let answerAffTurn = 0;
function answerAff(box) {
  const list = liveAffiliates().filter((a) => a.side);
  if (!list.length) return box.remove();
  const a = list[answerAffTurn++ % list.length];
  const px = a.pixel ? `<img src="${a.pixel}" width="1" height="1" alt="" style="border:0">` : "";
  box.classList.add("aff");
  box.innerHTML = `<span class="ad-label">広告（PR）</span><span class="aa-note">${a.tag ? `<em class="aff-tag">${esc(a.tag)}</em>` : ""}${esc(a.note)}</span>
    <a href="${a.url}" target="_blank" rel="nofollow sponsored noopener" referrerpolicy="no-referrer-when-downgrade" data-aff="${a.id}">${esc(a.link)}${a.pixelIn ? px : ""}</a>${a.pixelIn ? "" : px}`;
}

// ---------- 問題と会員紹介のあいだの広告（AdSense） ----------
// サイド（スマホ・タブレットではページの下）のいちばん上に1つ。ページを開いてから1回だけ読み込み、会員には出さない。
// 見えていない間（スマホで解いている最中など）は読み込まず、次に見えたときに読み込む
let sideAdDone = false;
function fillSideAd() {
  const box = document.getElementById("gad-side");
  if (sideAdDone || store.member || !AD.client || !AD.side) return;
  box.hidden = false;
  if (!box.offsetWidth) { box.hidden = true; return; }
  sideAdDone = true;
  // PC（右の列・幅280px）は四角、それより狭い画面（横いっぱい）は横長
  const shape = matchMedia("(min-width: 900px)").matches ? "rectangle" : "horizontal";
  box.insertAdjacentHTML("beforeend", `<ins class="adsbygoogle" style="display:block" data-ad-client="${AD.client}" data-ad-slot="${AD.side}" data-ad-format="${shape}" data-full-width-responsive="false"${AD_LOCAL ? ' data-adtest="on"' : ""}></ins>`);
  try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { box.hidden = true; }
}

function explanation(q, ok, answer) {
  const labels = q.options ? LABELS : NUMS;
  return `
    <div class="result ${ok ? "ok" : "ng"}">
      <span class="verdict">${ok ? "正解！" : "不正解"}</span>
      <span class="answer">正解は<b class="ans-badge">${NUMS[answer]}</b></span>
    </div>
    ${answerAd()}
    ${q.note && !q.revised ? `<p class="q-note">${esc(q.note)}</p>` : ""}
    ${pointBlock(q)}
    <ul class="exp-list">
      ${q.choices.map((c, i) => `
        <li>
          <div class="exp-head">${labels[i]}　${c.isTrue ? '<span class="t">○ 正しい</span>' : '<span class="f">× 誤り</span>'}</div>
          <div>${esc(c.detail ? c.detail.why : c.exp)}</div>
          <div class="law">${esc(c.law)}</div>
          ${detailBlock(c)}
        </li>`).join("")}
    </ul>
    ${navActions()}
    ${pageLink(q)}
    <p class="source-note">${sourceNote(q)}</p>`;
}

// 過去問には1問ずつのページ（/kakomon/r7/1/ など）がある。解説をあとで読み返したり、人に送ったりするときに使う
const pageLink = (q) => q.source === "retio"
  ? `<p class="page-link"><a href="/kakomon/${examSlug(q)}/${q.no}/" target="_blank" rel="noopener">この問題と解説のページを開く</a></p>` : "";

// 過去問（RETIO）の出典の表示。法改正に合わせて直した問題には「改題」と添える
const LABELS = ["ア", "イ", "ウ", "エ", "オ"];
// 法改正に合わせて改題した問題は、解く前に分かるよう問題文の上に改題の理由を出す
const revBlock = (q) => q.revised ? `<p class="rev-note"><b>法改正により改題</b>${esc(q.note || "")}</p>` : "";
const examLabel = (q) => `${q.exam}${q.no ? ` 問${q.no}` : ""}${q.revised ? "（改）" : ""}`;
// RETIO から明記するよう求められた出典ページと注1・注2も添える。返すのは HTML
const RETIO_URL = "https://www.retio.or.jp/exam/past_ques_ans/other/";
function sourceNote(q) {
  if (q.source !== "retio") return "出典：当サイトオリジナル問題";
  return `出典：一般財団法人 不動産適正取引推進機構 ${esc(q.exam)} 宅地建物取引士資格試験 問${esc(q.no)}${q.revised ? "（法改正に合わせて一部改題）" : ""}。解説は当サイト独自のものです。`
    + `<br>過去問題の出典ページ：<a href="${RETIO_URL}" rel="noopener" target="_blank">${RETIO_URL}</a>`
    + "<br>注1　試験問題及び解答内容に関するお問合せには、一切お答えしません。"
    + "<br>注2　法改正により、現在の法律と一致しない場合があります。";
}
// 4択の正解の番号。過去問は「誤っているもの」「いくつあるか」もあるので answer を持つ。オリジナルは正しい記述が正解
const answerOf = (q) => q.answer ?? q.choices.findIndex((c) => c.isTrue);

// 一問一答（選択肢1つずつ○×で答える）
function renderOx() {
  const shown = session.at ?? session.i;
  const done = session.picks[shown]; // 解答済みなら、そのときの答えで表示する
  const { qid, idx } = session.list[shown];
  const q = qById[qid];
  const c = q.choices[idx];
  const startedAt = Date.now();

  const answer = (p) => {
    const good = p === c.isTrue;
    stopTimer();
    recordSpeed("ox", q.category, (Date.now() - startedAt) / 1000);
    const k = itemKey(qid, idx);
    store.oxCount[k] = (store.oxCount[k] || 0) + 1; // 4肢すべて解くと1問ぶんの周回
    recordChoice(qid, idx, good);
    recordCategory(q.category, good);
    if (good) session.right++;
    session.picks[session.i] = { p, ok: good };
    if (session.review) {
      store.reviewed[dayKey()] = (store.reviewed[dayKey()] || 0) + 1;
      if (good) store.overcome[dayKey()] = (store.overcome[dayKey()] || 0) + 1; // 復習で正解できた＝克服
    }
    session.answered = true;
    buzz(good);
    save(); draw(p);
  };

  const draw = (pickedTrue) => {
    const answered = pickedTrue !== undefined;
    const ok = answered && pickedTrue === c.isTrue;
    view.innerHTML = `
      ${header()}
      <div class="card ${answered ? "answered" : ""}">
        <span class="tag">${esc(catName[q.category])}</span><span class="tag">${esc(q.topic)}</span>${q.source === "retio" ? `<span class="tag src">${esc(examLabel(q))}</span>` : ""}
        ${revBlock(q)}
        <p class="ox-context">${esc(q.oxContext || q.stem.replace(/次の(アからエまでの|アからウの)?記述のうち、.*$/, "次の記述は正しいか。"))}</p>
        <div class="swipe-card ${answered ? (ok ? "done ok" : "done ng") : ""}" id="swipe">
          <span class="swipe-hint o">○ 正しい</span><span class="swipe-hint x">× 誤り</span>
          <p class="ox-statement">${esc(c.ox || c.text)}</p>
        </div>
        ${answered ? "" : `<p class="swipe-help">カードを右へスワイプで ○、左へスワイプで ×</p>`}
        <div class="ox-buttons">
          <button class="x ${answered && !pickedTrue ? "picked" : ""}" data-ox="0" ${answered ? "disabled" : ""} aria-label="誤り">×</button>
          <button class="o ${answered && pickedTrue ? "picked" : ""}" data-ox="1" ${answered ? "disabled" : ""} aria-label="正しい">○</button>
        </div>
        ${!answered && prevButton() ? `<div class="prev-row">${prevButton()}</div>` : ""}
        ${answered ? `
          <div class="result ${ok ? "ok" : "ng"}">
            <span class="verdict">${ok ? "正解！" : "不正解"}</span>
            <span class="answer">正解は<b class="ans-badge ${c.isTrue ? "o" : "x"}">${c.isTrue ? "○" : "×"}</b>${c.isTrue ? "正しい" : "誤り"}</span>
          </div>
          ${answerAd()}
          <p>${esc(c.detail ? c.detail.why : c.exp)}</p>
          <p class="law">${esc(c.law)}</p>
          ${detailBlock(c)}
          ${pointBlock(q)}
          ${navActions()}
          <p class="source-note">${sourceNote(q)}</p>` : ""}
      </div>`;
    if (answered) fillAnswerAd(`ox:${qid}:${idx}`);
    if (!answered) {
      view.querySelectorAll("[data-ox]").forEach((b) => b.addEventListener("click", () => answer(b.dataset.ox === "1")));
      attachSwipe(view.querySelector("#swipe"), answer);
      bindNav();
    } else {
      bindNav(next);
    }
  };
  draw(done ? done.p : undefined);
  if (!done) startTimer(startedAt, SEC_PER_OX);
}

// カードを左右にスワイプして答える（右＝○、左＝×）
function attachSwipe(card, onAnswer) {
  let startX = null, dx = 0;
  const reset = () => { card.style.transform = ""; card.style.setProperty("--o", 0); card.style.setProperty("--x", 0); };
  card.addEventListener("pointerdown", (e) => { startX = e.clientX; dx = 0; card.setPointerCapture(e.pointerId); card.classList.add("dragging"); });
  card.addEventListener("pointermove", (e) => {
    if (startX === null) return;
    dx = e.clientX - startX;
    card.style.transform = `translateX(${dx}px) rotate(${dx / 25}deg)`;
    card.style.setProperty("--o", Math.max(0, Math.min(1, dx / 90)));
    card.style.setProperty("--x", Math.max(0, Math.min(1, -dx / 90)));
  });
  const end = () => {
    if (startX === null) return;
    startX = null;
    card.classList.remove("dragging");
    if (Math.abs(dx) > 90) onAnswer(dx > 0);
    else reset();
  };
  card.addEventListener("pointerup", end);
  card.addEventListener("pointercancel", () => { startX = null; card.classList.remove("dragging"); reset(); });
}

function renderSummary() {
  const n = session.list.length;
  const due = dueItems().length;
  view.innerHTML = `
    <h1>おつかれさまでした</h1>
    <div class="card">
      <p style="font-size:32px;font-weight:700;color:var(--navy);margin:0">${session.right} <small style="font-size:16px;color:var(--muted)">/ ${n} 正解</small></p>
      <p class="lead">間違えた問題は「今日の復習」に入りました（現在 ${due}問）。正解が続くと、復習の間隔が 1→3→7→14→30日 と伸びていきます。</p>
      <div class="actions">
        <button class="btn" data-go="stats">成績を見る</button>
        ${due ? `<button class="btn btn-primary" data-go="review-start">復習する</button>` : `<button class="btn btn-primary" data-go="home">ホームへ</button>`}
      </div>
      <button class="share-result" id="share-result" aria-haspopup="dialog">${svgIcon('<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/>')}今日の成果をシェア</button>
    </div>

    <div class="card" style="margin-top:16px">
      <h2>解いた問題を見返す</h2>
      <ol class="done-list">
        ${session.list.map((it, k) => {
          const q = qById[it.qid];
          const r = session.picks[k];
          const text = session.kind === "four" ? q.stem : (q.choices[it.idx].ox || q.choices[it.idx].text);
          return `<li><button class="done-row" data-at="${k}" ${r ? "" : "disabled"}>
            <span class="done-mark ${r ? (r.ok ? "ok" : "ng") : ""}" aria-label="${r ? (r.ok ? "正解" : "不正解") : "記録なし"}">${r ? (r.ok ? "○" : "×") : "–"}</span>
            <span class="done-body"><small>${k + 1}問目・${esc(catName[q.category])}</small>${esc(text)}</span>
            <span class="done-go" aria-hidden="true">›</span>
          </button></li>`;
        }).join("")}
      </ol>
    </div>`;
  view.querySelectorAll("[data-at]").forEach((b) => b.addEventListener("click", () => { session.at = Number(b.dataset.at); renderCurrent(); }));
  const result = { right: session.right, n, title: session.title };
  view.querySelector("#share-result").addEventListener("click", () => openShareSheet({ session: result }));
}

// ---------- 本番形式の模試 ----------
// 50問を2時間で、本試験と同じ並び（問1〜50）で解く。解いている間は正解を出さず、最後にまとめて採点する。
// 会員が受けられる。問題の組み合わせは mocks.js（tools/build_mocks.js が作る）
const MOCK_SECONDS = 120 * 60;
const MOCKS = window.MOCKS || [];
const mockById = Object.fromEntries(MOCKS.map((m) => [m.id, m]));
const mockOpen = () => !!store.member;
const fmtHMS = (sec) => `${Math.floor(sec / 3600)}:${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
const mockRemain = (run) => MOCK_SECONDS - Math.floor(run.elapsed / 1000);

// 経過時間は模試の画面を開いているあいだだけ数える（中断して閉じている間は止まる）
let mockClock = null, mockTick = 0, mockTicks = 0;
function addMockElapsed() {
  const now = Date.now();
  if (store.mockRun) store.mockRun.elapsed += now - mockTick;
  mockTick = now;
}
function startMockClock() {
  stopMockClock();
  mockTick = Date.now();
  mockClock = setInterval(() => {
    addMockElapsed();
    paintMockTime();
    if (++mockTicks % 15 === 0) save(); // 端末が急に閉じても、15秒より前までの時間は残る
  }, 1000);
  paintMockTime();
}
function stopMockClock() {
  if (!mockClock) return;
  addMockElapsed();
  clearInterval(mockClock); mockClock = null;
  save();
}
function paintMockTime() {
  const run = store.mockRun, el = document.getElementById("mock-time");
  if (!run || !el) return;
  const left = mockRemain(run);
  el.textContent = left >= 0 ? `残り ${fmtHMS(left)}` : `+${fmtHMS(-left)}`;
  el.classList.toggle("warn", left >= 0 && left < 10 * 60);
  el.classList.toggle("over", left < 0);
  if (left < 0 && !run.overShown) { run.overShown = true; save(); openMockSheet("timeup"); }
}

// 模試の一覧
function renderMockHome() {
  setNav("mock");
  const run = store.mockRun;
  const results = store.mockResults || {};
  view.innerHTML = `
    <button class="back-link" data-go="home">‹ ドリルに戻る</button>
    <div class="mock-hero">
      <span class="mh-eyebrow">本番形式の模試</span>
      <h1>50問・2時間で、本番の時間配分を確かめる</h1>
      <p>問題の数と並び（権利関係14問→法令上の制限8問→税・価格3問→宅建業法20問→免除科目5問）は本試験と同じです。問題はすべて当サイトのオリジナルです。採点が終わると、分野ごとの得点と全問の解説を見られます。</p>
    </div>
    <ul class="mock-list">
      ${MOCKS.map((m) => {
        const rs = results[m.id] || [];
        const best = rs.length ? Math.max(...rs.map((r) => r.score)) : null;
        const last = rs[rs.length - 1];
        const going = run && run.id === m.id;
        const open = mockOpen(m);
        const meta = going ? `解答中：${run.picks.filter((p) => p !== null).length}/50問・残り ${fmtHMS(Math.max(0, mockRemain(run)))}`
          : last ? `前回 ${last.score}点（${fmtMD(dayKey(last.at))}）・最高 ${best}点・${rs.length}回受験`
          : "未受験";
        return `<li class="mock-row ${open ? "" : "locked"}">
          <div class="mr-body">
            <b>${m.name}<span class="member-badge">会員</span></b>
            <span class="mr-meta">${meta}</span>
          </div>
          ${best !== null && !going ? `<span class="mr-score ${best >= PASS_SCORE ? "ok" : ""}">${best}<small>点</small></span>` : ""}
          <div class="mr-btns">
            ${!open ? `<button class="btn" data-go="plans">${svgIcon('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>')}会員プランを見る</button>`
              : going ? `<button class="btn btn-primary" data-mock-resume="${m.id}">続きから</button>`
              : `${last ? `<button class="btn" data-mock-result="${m.id}">結果</button>` : ""}<button class="btn ${last ? "" : "btn-primary"}" data-mock-start="${m.id}">${last ? "もう一度" : "受ける"}</button>`}
          </div>
        </li>`;
      }).join("")}
    </ul>
    <div class="card">
      <h2>受け方</h2>
      <ul class="mock-how">
        <li>時間は2時間。画面の上に残り時間が出ます。時間を過ぎても続けて解けますが、超えた時間も表示されます。</li>
        <li>答えはあとから何度でも変えられます。迷った問題は「見直す」の印を付けておくと、解答一覧で見つけやすくなります。</li>
        <li>途中でやめても、解答と経過時間は保存されます。閉じている間は時間が止まります。</li>
        <li>合格の目安は${PASS_SCORE}点です（本試験の合格点は例年35〜38点）。</li>
        <li>本試験の問48（統計）は毎年の数字で出題されるため、模試では代わりに土地の問題を入れています。</li>
        <li>採点した結果は、ドリルと同じように正答率と復習に記録されます。</li>
      </ul>
    </div>`;
  view.querySelectorAll("[data-mock-start]").forEach((b) => b.addEventListener("click", () => startMock(b.dataset.mockStart)));
  view.querySelectorAll("[data-mock-resume]").forEach((b) => b.addEventListener("click", () => renderMockQ()));
  view.querySelectorAll("[data-mock-result]").forEach((b) => b.addEventListener("click", () => {
    const id = b.dataset.mockResult;
    renderMockResult(id, results[id].length - 1);
  }));
}

function startMock(id, force = false) {
  const m = mockById[id];
  if (!m || !mockOpen(m)) return renderPlans();
  const run = store.mockRun;
  // 別の回を解いている途中なら、消してよいか先に確かめる
  if (run && run.id !== id && !force) return openMockSheet("replace", id);
  store.mockRun = { id, picks: m.items.map(() => null), flags: [], at: 0, elapsed: 0, startedAt: Date.now() };
  save();
  renderMockQ();
}

// 模試の1問。答えを選ぶだけで、正解は出さない
function renderMockQ() {
  const run = store.mockRun;
  const m = mockById[run.id];
  setNav("mock");
  document.body.classList.add("in-drill");
  const k = run.at;
  const q = qById[m.items[k]];
  const pick = run.picks[k];
  const done = run.picks.filter((p) => p !== null).length;
  const choiceBtn = (text, i, label) => `<li><button class="choice ${pick === i ? "selected" : ""}" data-mpick="${i}" aria-pressed="${pick === i}"><span class="num">${label}</span><span class="body">${esc(text)}</span></button></li>`;
  view.innerHTML = `
    <div class="drill-head">
      <div class="quiz-top">
        <span class="left"><button class="back-btn" data-action="mock-pause">中断する</button><span class="quiz-title">${m.name} 模試</span></span>
        <span class="right"><span class="mock-time" id="mock-time" role="timer"></span><button class="mock-count" data-action="mock-list" aria-label="解答一覧を開く">${done}/50</button></span>
      </div>
      <div class="progress"><i style="width:${(done / 50) * 100}%"></i></div>
    </div>
    <div class="card">
      <span class="tag mq-no">問${k + 1}</span><span class="tag">${esc(catName[q.category])}</span>${q.source === "retio" ? `<span class="tag src">${esc(examLabel(q))}</span>` : ""}
      ${revBlock(q)}
      <p class="stem">${esc(q.stem)}</p>
      ${q.options ? `
        <ul class="choices statements">
          ${q.choices.map((c, i) => `<li><div class="choice stmt"><span class="num">${LABELS[i]}</span><span class="body">${esc(c.text)}</span></div></li>`).join("")}
        </ul>
        <ul class="choices options">${q.options.map((o, i) => choiceBtn(o, i, NUMS[i])).join("")}</ul>`
      : `<ul class="choices">${q.choices.map((c, i) => choiceBtn(c.text, i, NUMS[i])).join("")}</ul>`}
      <div class="mock-nav">
        <button class="btn" id="m-prev" ${k ? "" : "disabled"}>‹ 前へ</button>
        <button class="btn mock-flag ${run.flags[k] ? "on" : ""}" id="m-flag" aria-pressed="${!!run.flags[k]}">${svgIcon('<path d="M5 21V4h11l-2 4 2 4H5"/>')}見直す</button>
        <button class="btn btn-primary" id="m-next">${k === m.items.length - 1 ? "解答一覧へ" : "次へ ›"}</button>
      </div>
    </div>
    <button class="btn btn-block mock-finish" data-action="mock-list">解答一覧・採点する</button>`;
  const go = (to) => { run.at = to; save(); renderMockQ(); };
  view.querySelectorAll("[data-mpick]").forEach((b) => b.addEventListener("click", () => {
    const i = Number(b.dataset.mpick);
    run.picks[k] = pick === i ? null : i; // 同じ選択肢をもう一度押すと選び直せる
    save();
    const y = window.scrollY; renderMockQ(); window.scrollTo(0, y);
  }));
  view.querySelector("#m-prev").addEventListener("click", () => go(k - 1));
  view.querySelector("#m-next").addEventListener("click", () => (k === m.items.length - 1 ? openMockSheet("list") : go(k + 1)));
  view.querySelector("#m-flag").addEventListener("click", () => {
    run.flags[k] = !run.flags[k]; save();
    const y = window.scrollY; renderMockQ(); window.scrollTo(0, y);
  });
  if (!mockClock) startMockClock(); else paintMockTime();
}

// 下から出るシート：解答一覧（list）・時間切れ（timeup）・別の回に切り替える確認（replace）
function openMockSheet(kind, arg) {
  const dlg = document.getElementById("sheet");
  const run = store.mockRun;
  if (kind === "replace") {
    const cur = mockById[run.id];
    dlg.innerHTML = `
      <div class="sheet-head"><h2>${cur.name}の途中です</h2><button class="sheet-close" aria-label="閉じる">×</button></div>
      <p style="margin:0 0 12px">${mockById[arg].name}を始めると、${cur.name}の途中の解答（${run.picks.filter((p) => p !== null).length}問）は消えます。</p>
      <div class="login-btns" style="margin:0">
        <button class="btn btn-primary btn-block" id="ms-resume">${cur.name}の続きを解く</button>
        <button class="btn btn-block" id="ms-replace">消して${mockById[arg].name}を始める</button>
      </div>`;
    dlg.querySelector("#ms-resume").addEventListener("click", () => { dlg.close(); renderMockQ(); });
    dlg.querySelector("#ms-replace").addEventListener("click", () => { dlg.close(); startMock(arg, true); });
  } else {
    const m = mockById[run.id];
    const blank = run.picks.filter((p) => p === null).length;
    const flagged = run.flags.filter(Boolean).length;
    const timeup = kind === "timeup";
    dlg.innerHTML = `
      <div class="sheet-head"><h2>${timeup ? "2時間が経ちました" : "解答一覧"}</h2><button class="sheet-close" aria-label="閉じる">×</button></div>
      ${timeup ? `<p style="margin:0 0 8px">本試験ならここで終了です。採点するか、時間を超えて最後まで解くかを選べます（超えた時間は結果に表示されます）。</p>` : ""}
      <p class="mock-legend"><span><i class="done"></i>解答済み ${50 - blank}</span><span><i></i>未解答 ${blank}</span><span><i class="flag"></i>見直す ${flagged}</span></p>
      <div class="mock-grid">
        ${m.items.map((_, n) => `<button class="${run.picks[n] !== null ? "done" : ""} ${run.flags[n] ? "flag" : ""} ${n === run.at ? "cur" : ""}" data-mjump="${n}" aria-label="問${n + 1}${run.picks[n] !== null ? "（解答済み）" : "（未解答）"}${run.flags[n] ? "・見直す" : ""}">${n + 1}</button>`).join("")}
      </div>
      ${blank ? `<p class="source-note" style="margin:8px 0 0">未解答の問題は不正解として採点します。</p>` : ""}
      <div class="login-btns" style="margin:12px 0 0">
        <button class="btn btn-primary btn-block" id="ms-grade">採点する</button>
        <button class="btn btn-block" id="ms-close">${timeup ? "時間を超えて続ける" : "問題に戻る"}</button>
      </div>`;
    dlg.querySelectorAll("[data-mjump]").forEach((b) => b.addEventListener("click", () => {
      dlg.close(); run.at = Number(b.dataset.mjump); save(); renderMockQ();
    }));
    dlg.querySelector("#ms-close").addEventListener("click", () => dlg.close());
    dlg.querySelector("#ms-grade").addEventListener("click", () => { dlg.close(); gradeMock(); });
  }
  dlg.querySelector(".sheet-close").addEventListener("click", () => dlg.close());
  if (!dlg.open) dlg.showModal();
}

// 採点して、ドリルと同じように正答率・復習に記録する
function gradeMock() {
  stopMockClock();
  const run = store.mockRun;
  const m = mockById[run.id];
  const cats = {};
  let score = 0;
  m.items.forEach((qid, k) => {
    const q = qById[qid];
    const p = run.picks[k];
    const answer = answerOf(q);
    const ok = p === answer;
    const c = cats[q.category] || (cats[q.category] = [0, 0]);
    c[1]++;
    if (ok) { c[0]++; score++; }
    store.qCount[qid] = (store.qCount[qid] || 0) + 1;
    if (q.options) { if (!ok) q.choices.forEach((_, i) => recordChoice(qid, i, false)); }
    else {
      recordChoice(qid, answer, ok);
      if (!ok && p !== null) recordChoice(qid, p, false);
    }
    recordCategory(q.category, ok);
  });
  const result = { at: Date.now(), score, cats, secs: Math.round(run.elapsed / 1000), picks: run.picks };
  store.mockResults = store.mockResults || {};
  store.mockResults[m.id] = [...(store.mockResults[m.id] || []), result].slice(-10);
  // 合格スケジュールの「模擬試験」の回数も進める（3回以上は同じ）
  if (store.plan) store.plan.progress = { ...(store.plan.progress || {}), mock: Math.min(3, ((store.plan.progress || {}).mock || 0) + 1) };
  store.mockRun = null;
  save();
  renderMockResult(m.id, store.mockResults[m.id].length - 1);
}

function renderMockResult(id, idx) {
  session = null;
  setNav("mock");
  const m = mockById[id];
  const rs = store.mockResults[id];
  const r = rs[idx];
  const prev = rs[idx - 1];
  const gap = PASS_SCORE - r.score;
  const over = r.secs - MOCK_SECONDS;
  view.innerHTML = `
    <button class="back-link" data-go="mock">‹ 模試の一覧</button>
    <h1>${m.name} 模試の結果</h1>
    <div class="card mock-score">
      <div class="ms-top">
        <p class="ms-num"><b>${r.score}</b><small>/ 50点</small></p>
        <span class="status ${gap <= 0 ? "ok" : "ng"}">${gap <= 0 ? `合格目安（${PASS_SCORE}点）に到達` : `合格目安（${PASS_SCORE}点）まで あと${gap}点`}</span>
      </div>
      <p class="ms-sub">解答時間 ${fmtHMS(r.secs)}${over > 0 ? `<span class="ms-over">（2時間を${fmtHMS(over)}超過）</span>` : ""}${prev ? `　前回 ${prev.score}点（${r.score - prev.score >= 0 ? "+" : ""}${r.score - prev.score}）` : ""}</p>
      <table class="pace mock-cats">
        <thead><tr><th></th><th class="num">得点</th><th></th><th class="num">目標</th></tr></thead>
        <tbody>${CATEGORIES.map((c) => {
          const [ok, n] = r.cats[c.id] || [0, 0];
          const goal = Math.round((n * TARGET[c.id]) / 100);
          return `<tr><th>${esc(c.name)}</th><td class="num"><b>${ok}</b>/${n}</td>
            <td class="spd-cell"><span class="spd-bar"><i class="${ok < goal ? "slow" : ""}" style="width:${n ? (ok / n) * 100 : 0}%"></i><em style="left:${TARGET[c.id]}%"></em></span></td>
            <td class="num muted">${goal}点</td></tr>`;
        }).join("")}</tbody>
      </table>
      <p class="source-note">目標は、合格者に多い得点の取り方（宅建業法${TARGET.gyoho}%・権利関係${TARGET.kenri}%など）から出した分野ごとの目安です。バーの縦線が目標です。間違えた問題は「復習」に入りました。</p>
      <div class="actions">
        <button class="btn" data-mock-again>もう一度受ける</button>
        <button class="btn btn-primary" data-go="review-start">間違えた問題を復習</button>
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <h2>解答と解説 <small class="h-sub">タップで解説を表示</small></h2>
      <ol class="done-list">
        ${m.items.map((qid, k) => {
          const q = qById[qid];
          const p = r.picks[k];
          const ok = p === answerOf(q);
          return `<li><button class="done-row" data-mreview="${k}">
            <span class="done-mark ${ok ? "ok" : "ng"}" aria-label="${ok ? "正解" : p === null ? "未解答" : "不正解"}">${ok ? "○" : p === null ? "–" : "×"}</span>
            <span class="done-body"><small>問${k + 1}・${esc(catName[q.category])}</small>${esc(q.stem)}</span>
            <span class="done-go" aria-hidden="true">›</span>
          </button></li>`;
        }).join("")}
      </ol>
    </div>`;
  view.querySelector("[data-mock-again]").addEventListener("click", () => startMock(id));
  // 見返しは、ドリルの「解いた問題を見返す」と同じ画面を使う（答えた状態で解説を出す）
  view.querySelectorAll("[data-mreview]").forEach((b) => b.addEventListener("click", () => {
    session = {
      kind: "four", title: `${m.name} 模試`, list: m.items.map((qid) => ({ qid })), i: m.items.length, right: r.score,
      picks: m.items.map((qid, k) => ({ p: r.picks[k], ok: r.picks[k] === answerOf(qById[qid]) })),
      at: Number(b.dataset.mreview), mock: { id, idx },
    };
    renderCurrent();
  }));
}

// ---------- 成績 ----------
// 本試験の配点（免除科目5問は「税・その他」に含める）
const EXAM_POINTS = { gyoho: 20, kenri: 14, seigen: 8, zei: 8 };
// 分野ごとの目標正答率（%）。合格者に多い得点の取り方に合わせ、配点が大きく得点しやすい宅建業法は高めにする
// 宅建業法 18/20点、権利関係 8〜9/14点、法令上の制限 6/8点、税・その他 6/8点 が目安
const TARGET = { gyoho: 90, kenri: 60, seigen: 75, zei: 75 };

const MILESTONES = [
  { id: "first", name: "はじめの1問", need: (t) => [t.total, 1], unit: "問" },
  { id: "c50", name: "50問突破", need: (t) => [t.total, 50], unit: "問" },
  { id: "c200", name: "200問突破", need: (t) => [t.total, 200], unit: "問" },
  { id: "c1000", name: "1000問突破", need: (t) => [t.total, 1000], unit: "問" },
  { id: "s3", name: "3日連続", need: (t) => [t.best, 3], unit: "日" },
  { id: "s7", name: "7日連続", need: (t) => [t.best, 7], unit: "日" },
  { id: "s30", name: "30日連続", need: (t) => [t.best, 30], unit: "日" },
  { id: "all4", name: "全分野デビュー", need: (t) => [t.catsTried, 4], unit: "分野" },
];

function bestStreak() {
  const days = Object.keys(store.daily).filter((k) => store.daily[k] > 0).sort();
  let best = 0, run = 0, prev = null;
  days.forEach((k) => {
    const t = new Date(k + "T00:00:00").getTime();
    run = prev !== null && Math.round((t - prev) / DAY) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  });
  return best;
}

function sumDays(fromDaysAgo, toDaysAgo) {
  let n = 0;
  for (let i = fromDaysAgo; i >= toDaysAgo; i--) n += store.daily[dayKey(Date.now() - i * DAY)] || 0;
  return n;
}

function heatmap() {
  // カレンダー形式で直近5週。日曜はじまり、今日に枠
  const todayDow = new Date().getDay();
  const start = 28 + todayDow; // 4週前の日曜日
  let cells = "日月火水木金土".split("").map((w) => `<span class="dow">${w}</span>`).join("");
  for (let i = start; i > start - 35; i--) {
    if (i < 0) { cells += `<i class="future"></i>`; continue; }
    const t = Date.now() - i * DAY;
    const n = store.daily[dayKey(t)] || 0;
    const lv = n === 0 ? 0 : n < 10 ? 1 : n < 20 ? 2 : n < 40 ? 3 : 4;
    cells += `<i class="lv${lv} ${i === 0 ? "today" : ""}" title="${dayKey(t)}：${n}問"></i>`;
  }
  return cells;
}

// シートの外側（背景）を押したら閉じる
document.getElementById("sheet").addEventListener("click", (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  if (!inside) e.currentTarget.close();
});

// 達成バッジの詳細（下から出るシート）
function openBadgeSheet(list, medal) {
  const dlg = document.getElementById("sheet");
  const got = list.filter((b) => b.got).length;
  dlg.innerHTML = `
    <div class="sheet-head"><h2>達成バッジ <small class="h-sub">${got} / ${list.length}</small></h2><button class="sheet-close" aria-label="閉じる">×</button></div>
    <ul class="badge-list">
      ${list.map((b) => `
        <li class="${b.got ? "got" : ""}">
          <span class="bl-medal">${svgIcon(medal)}</span>
          <span class="bl-body">
            <b>${b.name}</b>
            <span class="bl-bar"><i style="width:${(b.have / b.need) * 100}%"></i></span>
          </span>
          <span class="bl-state">${b.got ? "達成" : `あと${(b.need - b.have).toLocaleString()}${b.unit}`}</span>
        </li>`).join("")}
    </ul>`;
  dlg.querySelector(".sheet-close").addEventListener("click", () => dlg.close());
  dlg.showModal();
}

// 成績画面と共有画面で使う数字
function shareStats() {
  const totals = Object.values(store.cats).reduce((a, c) => ({ right: a.right + c.right, wrong: a.wrong + c.wrong }), { right: 0, wrong: 0 });
  const answered = totals.right + totals.wrong;
  return {
    answered,
    acc: answered ? Math.round((totals.right / answered) * 100) : null,
    total: Object.values(store.daily).reduce((a, n) => a + n, 0),
    today: store.daily[dayKey()] || 0,
    streak: streakDays(),
    left: examInfo().left,
    exam: examInfo().d,
    cats: CATEGORIES.map((c) => {
      const s = store.cats[c.id] || { right: 0, wrong: 0 };
      const n = s.right + s.wrong;
      return { id: c.id, name: c.name, n, pct: n ? Math.round((s.right / n) * 100) : null };
    }),
  };
}

function renderStats() {
  setNav("stats");
  const st = shareStats();
  const { answered, total } = st;
  const acc = st.acc ?? 0;
  const thisWeek = sumDays(6, 0);
  const lastWeek = sumDays(13, 7);
  let studyDaysThisWeek = 0;
  for (let i = 6; i >= 0; i--) if (store.daily[dayKey(Date.now() - i * DAY)]) studyDaysThisWeek++;
  const t = { total, best: Math.max(bestStreak(), streakDays()), catsTried: Object.keys(store.cats).length };
  const mastered = Object.values(store.items).filter((it) => it.box >= 3).length;

  const weekDiff = thisWeek - lastWeek;
  const weekMsg = !thisWeek ? "今週はまだこれから。1問から始めましょう。"
    : weekDiff > 0 ? `先週より ${weekDiff}問 多く解いています。いいペースです。`
    : weekDiff === 0 ? "先週と同じペースをキープしています。"
    : "先週より少なめ。今日の数問で取り返しましょう。";

  const cats = CATEGORIES.map((c, i) => {
    const { n, pct } = st.cats[i];
    const label = pct === null ? `<span class="pill">未着手</span>` : pct >= TARGET[c.id] ? `<span class="pill good">得意</span>` : `<span class="pill weak">伸びしろ</span>`;
    return `
      <div class="cat-stat">
        <span class="cat-icon">${svgIcon(CAT_ICON[c.id])}</span>
        <div class="cat-stat-body">
          <div class="cat-stat-top"><b>${esc(c.name)}</b>${label}<span class="pts">配点 ${EXAM_POINTS[c.id]}点</span></div>
          <div class="acc-bar"><i style="width:${pct ?? 0}%"></i><span class="line" style="left:${TARGET[c.id]}%" title="目標 ${TARGET[c.id]}%"></span></div>
          <div class="cat-stat-meta">${pct === null ? "まだ解いていません" : `正答率 <b>${pct}%</b>（${n}回解答）`}<span class="goal">目標 ${TARGET[c.id]}%（${Math.round((EXAM_POINTS[c.id] * TARGET[c.id]) / 100)}点）</span></div>
        </div>
      </div>`;
  }).join("");

  // 達成バッジは成績のまとめの中に小さく並べ、押すと一覧の詳細を開く
  const badgeState = MILESTONES.map((m) => {
    const [have, need] = m.need(t);
    return { ...m, have: Math.min(have, need), need, got: have >= need };
  });
  const medal = '<circle cx="12" cy="9" r="6"/><path d="m9 14-2 7 5-3 5 3-2-7"/>';
  const badges = badgeState.map((b, i) => `<span class="mb ${b.got ? "got" : ""}">${svgIcon(medal)}</span>`).join("");
  const gotCount = MILESTONES.filter((m) => { const [h, n] = m.need(t); return h >= n; }).length;

  view.innerHTML = `
    <h1>成績</h1>
    <section class="stats-hero">
      <div class="hero-top sh-top">
        <span class="sh-title">これまでの学習</span>
        <span class="sh-top-right">
        <button class="save-pill share-pill" id="open-share" aria-haspopup="dialog">${svgIcon('<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/>')}シェア</button>
        ${store.user
          ? `<span class="save-pill">${svgIcon('<path d="M20 6 9 17l-5-5"/>')}記録を保存中</span>`
          : `<button class="save-pill" data-action="login" title="今の記録はこの端末だけに保存されています">${svgIcon('<path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 0 1 0 9Z"/>')}ログインして記録を残す</button>`}
        </span>
      </div>
      <div class="ring-wrap">
        ${ring(acc, 100)}
        <div class="ring-num"><b>${answered ? acc : "—"}<small style="font-size:14px">${answered ? "%" : ""}</small></b><small>正答率</small></div>
      </div>
      <div class="kpis">
        <div><span class="k">解いた数</span><b>${total.toLocaleString()}</b></div>
        <div><span class="k">覚えた数</span><b>${mastered}</b></div>
        <div><span class="k">最長連続</span><b>${t.best}<small>日</small></b></div>
      </div>
      <button class="mini-badges" id="open-badges" aria-haspopup="dialog" aria-label="達成バッジ ${gotCount}/${MILESTONES.length}（押すと詳細）">${badges}<span class="mb-label">${gotCount}/${MILESTONES.length} ›</span></button>
      <div class="sh-cal">
        <div class="heat">${heatmap()}</div>
        <div class="sh-week">
          <div><span>今週の学習日</span><b>${studyDaysThisWeek}<small>/7日</small></b></div>
          <div><span>今週の解答数</span><b>${thisWeek}<small>問</small></b></div>
          <div><span>先週の解答数</span><b>${lastWeek}<small>問</small></b></div>
        </div>
      </div>
      <p class="week-msg">${weekMsg}</p>
    </section>


    <div class="card" style="margin-bottom:16px">
      <h2>分野ごとの正答率 <small class="h-sub">縦線は分野ごとの目標</small></h2>
      <p class="source-note" style="margin:-4px 0 12px">配点が大きく得点しやすい宅建業法で9割、ほかの分野で6〜7割を取るのが合格への定番の作戦です。</p>
      <div class="cat-stats">${cats}</div>
    </div>

    ${store.member ? paceDiagnosis() + speedReport() : memberTeaser()}`;
  view.querySelector("[data-action=login]")?.addEventListener("click", renderLogin);
  view.querySelector("#open-badges").addEventListener("click", () => openBadgeSheet(badgeState, medal));
  view.querySelector("#open-share").addEventListener("click", () => openShareSheet());
}

// ---------- 成績のシェア ----------
const SITE_NAME = "宅建過去問ドリル";
const SITE_URL = "https://takken-drill.com/";
const CAT_SHORT = { gyoho: "業法", kenri: "権利", seigen: "法令制限", zei: "税その他" };

// のせる項目。on はそのときの数字で、初期状態でONにしてよいか（0の項目は出さない）
const SHARE_ITEMS = [
  { id: "session", label: "今回の結果", has: (s) => !!s.session },
  { id: "today", label: "今日解いた数", has: (s) => s.today > 0 },
  { id: "total", label: "これまでの解答数", has: (s) => s.total > 0 },
  { id: "acc", label: "全体の正答率", has: (s) => s.acc !== null },
  { id: "cats", label: "分野ごとの正答率", has: (s) => s.cats.some((c) => c.pct !== null) },
];

// 文章に使う1行ずつ。wide は分野ごとを1行ずつ書く（Threads・Instagram）
function shareLines(s, on, wide) {
  const L = [];
  if (on.session) L.push(`✅ ${s.session.title}で${s.session.n}問中${s.session.right}問正解`);
  if (on.today) L.push(`✏️ 今日は${s.today}問 解きました`);
  if (on.total) L.push(`📚 これまでに${s.total.toLocaleString()}問`);
  if (on.acc) L.push(`🎯 正答率 ${s.acc}%`);
  if (on.cats) {
    const cs = s.cats.filter((c) => c.pct !== null);
    if (wide) cs.forEach((c) => L.push(`・${c.name} ${c.pct}%`));
    else L.push(`📊 ${cs.map((c) => `${CAT_SHORT[c.id]}${c.pct}%`).join(" ")}`);
  }
  return L;
}

// 本試験までの日数はだれにでも同じなので、成績の項目ではなく見出しに添える
const examNote = (s) => (s.left ? `本試験まであと${s.left}日` : "今日は本試験！");

// SNSごとの画像の大きさ・文章・送り先。intent を持つものは投稿画面をURLで開ける
const SHARE_SNS = {
  x: {
    icon: '<svg viewBox="0 0 24 24"><path fill="#fff" d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/></svg>',
    name: "X", size: () => [1200, 675],
    text: (s, on) => [`宅建の勉強記録｜${examNote(s)}`, ...shareLines(s, on, false), "", "#宅建 #宅建勉強垢 #宅建過去問ドリル"].join("\n"),
    intent: (text) => `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(SITE_URL)}`,
    note: "画像を付けるときは「画像を保存」してから、投稿画面で添付してください。",
  },
  instagram: {
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5.5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.5" cy="6.5" r="1.2" fill="#fff" stroke="none"/></svg>',
    name: "Instagram", size: () => [1080, 1920], // ストーリー用の縦長
    text: (s, on) => [`宅建の勉強記録 📝｜${examNote(s)}`, ...shareLines(s, on, true), "", `${SITE_NAME}（takken-drill.com）で勉強中`, "", "#宅建 #宅建勉強垢 #宅建過去問ドリル #宅建試験 #宅建士 #資格勉強"].join("\n"),
    note: "Instagramはブラウザから直接投稿できません。画像を保存して、Instagramのアプリから投稿してください。キャプションは「文章をコピー」で貼り付けられます。",
    noteMobile: "「Instagramに送る」を押して、出てきたメニューからInstagramを選んでください。キャプションはコピーされるので、投稿画面に貼り付けてください。",
  },
  line: {
    icon: '<svg viewBox="0 0 24 24"><path fill="#fff" d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/></svg>', // 公式ロゴ（Simple Icons）
    name: "LINE", size: () => [1200, 675],
    text: (s, on) => ["宅建の勉強、今日もやったよ！", `（${examNote(s)}）`, ...shareLines(s, on, true), "", "一緒にやろう👇", SITE_URL].join("\n"),
    intent: (text) => `https://line.me/R/share?text=${encodeURIComponent(text)}`,
    note: "画像も送るときは「画像を保存」してから、トークに添付してください。",
  },
  threads: {
    icon: '<svg viewBox="0 0 24 24"><path fill="#fff" d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.783 3.631 2.698 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.361-.218-3.259-.801-1.063-.689-1.685-1.74-1.752-2.964-.065-1.19.408-2.285 1.33-3.082.88-.76 2.119-1.207 3.583-1.291a13.853 13.853 0 0 1 3.02.142c-.126-.742-.375-1.332-.75-1.757-.513-.586-1.308-.883-2.359-.89h-.029c-.844 0-1.992.232-2.721 1.32L7.734 7.847c.98-1.454 2.568-2.256 4.478-2.256h.044c3.194.02 5.097 1.975 5.287 5.388.108.046.216.094.321.142 1.49.7 2.58 1.761 3.154 3.07.797 1.82.871 4.79-1.548 7.158-1.85 1.81-4.094 2.628-7.277 2.65Zm1.003-11.69c-.242 0-.487.007-.739.021-1.836.103-2.98.946-2.916 2.143.067 1.256 1.452 1.839 2.784 1.767 1.224-.065 2.818-.543 3.086-3.71a10.5 10.5 0 0 0-2.215-.221z"/></svg>', // 公式ロゴ（Simple Icons）
    name: "Threads", size: () => [1200, 675],
    text: (s, on) => [`宅建の勉強記録｜${examNote(s)}`, ...shareLines(s, on, true), "", SITE_URL, "#宅建 #宅建過去問ドリル"].join("\n"),
    intent: (text) => `https://www.threads.net/intent/post?text=${encodeURIComponent(text)}`,
    note: "画像を付けるときは「画像を保存」してから、投稿画面で添付してください。",
  },
};

// Xの文字数の数え方（日本語・絵文字は2、URLは23）。上限は280＝全角140字
function xLength(text) {
  let n = 23 + 1; // 投稿画面で付く URL と区切りの空白
  for (const ch of text) n += ch.codePointAt(0) < 0x1100 ? 1 : 2;
  return n;
}

let shareIcon = null;
function loadShareIcon() {
  if (!shareIcon) shareIcon = new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = "icon.svg"; });
  return shareIcon;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// 画像カードの配色。サイトと同じ紺・青・アンバー（--navy #1E3A8A、--primary #2563EB、--accent #F59E0B）で作る
// glow は背景に置く光のにじみ（位置は幅・高さに対する割合、r は長い辺に対する割合）
const CARD_THEMES = {
  navy: { name: "ネイビー", bg: ["#1E3A8A", "#0F1E4D"], ink: "#FFFFFF", sub: "rgba(255,255,255,.62)", accent: "#FBBF24", ghost: "rgba(255,255,255,.05)", bar: "rgba(255,255,255,.16)", line: "rgba(255,255,255,.18)",
    glow: [{ x: 1, y: 0, r: 0.7, c: "rgba(59,130,246,.55)" }, { x: 0, y: 1, r: 0.5, c: "rgba(245,158,11,.14)" }] },
  blue: { name: "ブルー", bg: ["#2563EB", "#1E3A8A"], ink: "#FFFFFF", sub: "rgba(255,255,255,.7)", accent: "#FBBF24", ghost: "rgba(255,255,255,.07)", bar: "rgba(255,255,255,.22)", line: "rgba(255,255,255,.24)",
    glow: [{ x: 0.9, y: 0.1, r: 0.6, c: "rgba(96,165,250,.6)" }] },
  white: { name: "ホワイト", bg: ["#FFFFFF", "#EAF1FF"], ink: "#1E3A8A", sub: "rgba(30,41,59,.55)", accent: "#2563EB", ghost: "rgba(37,99,235,.06)", bar: "rgba(30,58,138,.1)", line: "rgba(30,58,138,.14)",
    glow: [{ x: 1, y: 0, r: 0.55, c: "rgba(245,158,11,.14)" }] },
};

// 共有する画像カード。正答率があれば成績画面と同じ円グラフで大きく見せ、なければ数字を1つ大きく見せる。
// 残りの数字は小さく並べる
async function drawShareCard(s, on, w, h, themeId = "navy") {
  const T = CARD_THEMES[themeId] || CARD_THEMES.navy;
  const JP = '"Noto Sans JP", sans-serif';
  const NUM = 'Anton, "Noto Sans JP", sans-serif';
  const landscape = w > h * 1.2;
  const tall = h > w * 1.2;
  const cats = on.cats ? s.cats : null;
  const ss = s.session;
  const examDay = s.left === 0;

  // 円グラフにする正答率：解き終わった直後なら今回の結果、そうでなければ全体
  const RING = {
    session: ss && { id: "session", pct: ss.n ? Math.round((ss.right / ss.n) * 100) : 0, jp: `${ss.n}問中${ss.right}問正解`, note: ss.title },
    acc: { id: "acc", pct: s.acc, jp: "全体の正答率", note: `${s.answered.toLocaleString()}回解答` },
  };
  const ringIt = on.session && ss ? RING.session : on.acc && s.acc !== null ? RING.acc : null;
  const NUM_ORDER = ["today", "total"];
  const numHero = ringIt ? null : NUM_ORDER.find((id) => on[id]) || null;
  const BIG = {
    today: { e: "TODAY", v: String(s.today), jp: "問を解きました" },
    total: { e: "TOTAL", v: s.total.toLocaleString(), jp: "問を解いてきた" },
  };
  const SMALL = {
    session: ss && { k: "今回", v: `${ss.right}/${ss.n}`, u: "問" },
    today: { k: "今日解いた数", v: String(s.today), u: "問" },
    total: { k: "累計", v: s.total.toLocaleString(), u: "問" },
    acc: { k: "全体の正答率", v: String(s.acc), u: "%" },
  };
  const small = ["session", "acc", "today", "total"].filter((id) => on[id] && SMALL[id] && id !== ringIt?.id && id !== numHero).map((id) => SMALL[id]);
  const now = new Date();
  const p2 = (n) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}.${p2(now.getMonth() + 1)}.${p2(now.getDate())}`;

  // 使う文字だけ Webフォントを読み込んでから描く（読み込めなくても手元の字体で描く）
  const jpText = [SITE_NAME, "分野ごとの正答率 正答率 本試験まで あと日 今日は本試験 項目を選んでください —", ...Object.values(RING).flatMap((r) => [r?.jp, r?.note]), ...Object.values(BIG).map((b) => b.jp), ...Object.values(SMALL).flatMap((x) => [x?.k, x?.u]), ...s.cats.map((c) => c.name)].filter(Boolean).join("");
  const numText = `takken-drill.com ${date} 0123456789/%,. TODAY TOTAL`;
  try {
    await Promise.all([document.fonts.load(`900 40px ${JP}`, jpText), document.fonts.load(`700 40px ${JP}`, jpText), document.fonts.load(`400 40px ${NUM}`, numText)]);
  } catch (e) { /* noop */ }
  const icon = await loadShareIcon();

  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d");
  const u = Math.min(w, h) / 675; // 横長カードの高さを基準にした倍率
  const P = 56 * u;
  const spacing = (px) => { if ("letterSpacing" in ctx) ctx.letterSpacing = `${px}px`; };
  const text = (str, x, y, { wt = 900, px, color = T.ink, align = "left", fam = JP, ls = 0 } = {}) => {
    spacing(ls);
    ctx.font = `${wt} ${px}px ${fam}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(str, x, y);
    const m = ctx.measureText(str).width;
    spacing(0);
    return m;
  };
  const measure = (str, wt, px, fam = JP, ls = 0) => { spacing(ls); ctx.font = `${wt} ${px}px ${fam}`; const m = ctx.measureText(str).width; spacing(0); return m; };
  // Anton の数字の高さ（文字の大きさに対する割合）。字体が読み込めなかったときも実際の高さで測る
  ctx.font = `400 100px ${NUM}`;
  const CAP = (ctx.measureText("0").actualBoundingBoxAscent || 74) / 100;

  const top = P + 64 * u;
  const bottom = h - P - 48 * u;
  const W = w - P * 2;
  const gap = 32 * u;
  const ops = []; // 背景を描いてから中身を描くので、配置を決めながら描く手順をためておく
  let center = { x: w * 0.82, y: h * 0.22, r: 90 * u }; // 背景の同心円の中心（円グラフがあればその中心）

  // ---- 円グラフ ----
  const drawRing = (cx, cy, D, pct) => {
    const r = D / 2, sw = D * 0.085;
    ctx.lineWidth = sw;
    ctx.strokeStyle = T.bar;
    ctx.beginPath(); ctx.arc(cx, cy, r - sw / 2, 0, Math.PI * 2); ctx.stroke();
    ctx.save();
    ctx.shadowColor = T.accent;
    ctx.shadowBlur = 24 * u;
    ctx.strokeStyle = T.accent;
    ctx.lineCap = "round";
    ctx.beginPath();
    const a0 = -Math.PI / 2;
    ctx.arc(cx, cy, r - sw / 2, a0, a0 + (Math.PI * 2 * Math.max(pct, 0.5)) / 100);
    ctx.stroke();
    ctx.restore();
    const nPx = D * 0.36, pPx = D * 0.13, lPx = D * 0.07;
    const nw = measure(String(pct), 400, nPx, NUM), pw = measure("%", 400, pPx, NUM);
    const base = cy + (nPx * CAP) / 2 - lPx * 0.4;
    const x0 = cx - (nw + 4 * u + pw) / 2;
    text(String(pct), x0, base, { wt: 400, px: nPx, fam: NUM });
    text("%", x0 + nw + 4 * u, base, { wt: 400, px: pPx, fam: NUM, color: T.sub });
    text("正答率", cx, base + lPx * 1.7, { wt: 900, px: lPx, color: T.sub, align: "center", ls: 2 * u });
  };
  // 円グラフの横（または下）に置く見出し
  const RT_JP = 40 * u, RT_NOTE = 21 * u;
  const ringTextH = (it) => RT_JP + (it.note ? 12 * u + RT_NOTE : 0);
  const drawRingText = (it, x, y, align = "left", maxW = W) => {
    let px = RT_JP;
    while (measure(it.jp, 900, px) > maxW && px > 18 * u) px *= 0.95;
    text(it.jp, x, y + px * 0.88, { wt: 900, px, align });
    if (it.note) text(it.note, x, y + ringTextH(it) - 4 * u, { wt: 700, px: RT_NOTE, color: T.sub, align });
  };

  // ---- 数字を大きく（正答率を出さないとき） ----
  const heroParts = (numPx) => {
    const jpPx = Math.min(Math.max(numPx * 0.15, 30 * u), 60 * u);
    return { jpPx, h: 24 * u + 18 * u + numPx * CAP + 22 * u + jpPx };
  };
  const fitHero = (it, maxW, maxH, maxPx) => {
    let px = maxPx;
    while ((heroParts(px).h > maxH || measure(it.v, 400, px, NUM) > maxW) && px > 40 * u) px *= 0.96;
    return px;
  };
  const drawHero = (it, x, y, numPx) => {
    const { jpPx } = heroParts(numPx);
    let yy = y + 24 * u;
    text(it.e, x, yy, { wt: 400, px: 24 * u, fam: NUM, color: T.accent, ls: 3 * u });
    yy += 18 * u + numPx * CAP;
    text(it.v, x - numPx * 0.02, yy, { wt: 400, px: numPx, fam: NUM, ls: -numPx * 0.01 });
    text(it.jp, x, yy + 22 * u + jpPx * 0.9, { wt: 900, px: jpPx });
  };

  // ---- 小さな数字（横に並べる） ----
  const ROW_H = 96 * u;
  const drawRow = (items, x, y, wd) => {
    ctx.fillStyle = T.line;
    ctx.fillRect(x, y, wd, Math.max(1, 1.5 * u));
    const cw = wd / items.length;
    items.forEach((it, i) => {
      const cx = x + i * cw;
      text(it.k, cx, y + 34 * u, { wt: 700, px: 17 * u, color: T.sub });
      let V = 56 * u;
      const room = cw - 14 * u;
      while (measure(it.v, 400, V, NUM) + 5 * u + measure(it.u, 900, 18 * u) > room && V > 20 * u) V *= 0.94;
      const vw = text(it.v, cx, y + 90 * u, { wt: 400, px: V, fam: NUM });
      text(it.u, cx + vw + 5 * u, y + 90 * u, { wt: 900, px: 18 * u, color: T.sub });
    });
  };
  const rowsOf = (items, per) => { const r = []; for (let i = 0; i < items.length; i += per) r.push(items.slice(i, i + per)); return r; };
  const rowsH = (rows) => (rows.length ? rows.length * ROW_H + (rows.length - 1) * 8 * u : 0);
  const drawRows = (rows, x, y, wd) => rows.forEach((r, i) => drawRow(r, x, y + i * (ROW_H + 8 * u), wd));

  // ---- 分野ごとの正答率 ----
  const catH = (row) => 44 * u + 4 * row;
  const drawCats = (x, y, wd, row = 50 * u) => {
    text("分野ごとの正答率", x, y + 20 * u, { wt: 700, px: 17 * u, color: T.sub });
    cats.forEach((c, i) => {
      const ry = y + 44 * u + i * row;
      text(c.name, x, ry + 20 * u, { wt: 900, px: 19 * u });
      text(c.pct === null ? "—" : `${c.pct}%`, x + wd, ry + 22 * u, { wt: 400, px: 26 * u, fam: NUM, align: "right", color: c.pct === null ? T.sub : T.ink });
      const by = ry + 30 * u, bh = 6 * u;
      ctx.fillStyle = T.bar;
      roundRect(ctx, x, by, wd, bh, bh / 2);
      ctx.fill();
      if (c.pct) {
        ctx.fillStyle = T.accent;
        roundRect(ctx, x, by, Math.max(bh, (wd * c.pct) / 100), bh, bh / 2);
        ctx.fill();
      }
      ctx.fillStyle = T.ink;
      ctx.fillRect(x + (wd * TARGET[c.id]) / 100 - 1.25 * u, by - 5 * u, 2.5 * u, bh + 10 * u);
    });
  };

  // ---- 配置を決める ----
  if (!ringIt && !numHero && !cats && !small.length) {
    ops.push(() => text("項目を選んでください", w / 2, (top + bottom) / 2, { wt: 700, px: 28 * u, color: T.sub, align: "center" }));
  } else if (ringIt && landscape) {
    // 横長：左に円グラフ、右に見出し・小さな数字・分野
    const D = Math.min(bottom - top, W * 0.4);
    const rx = P + D + 56 * u, rw = W - D - 56 * u;
    const rows = rowsOf(small, 3);
    const catRow = small.length ? 42 * u : 50 * u;
    const need = ringTextH(ringIt) + (rows.length ? gap * 0.75 + rowsH(rows) : 0) + (cats ? gap * 0.75 + catH(catRow) : 0);
    // 入りきらないときは、分野の上の小さな数字をやめる
    const useRows = need <= bottom - top ? rows : [];
    const need2 = ringTextH(ringIt) + (useRows.length ? gap * 0.75 + rowsH(useRows) : 0) + (cats ? gap * 0.75 + catH(catRow) : 0);
    let y = top + Math.max(0, (bottom - top - need2) / 2);
    center = { x: P + D / 2, y: (top + bottom) / 2, r: D / 2 };
    const yy = y;
    ops.push(() => {
      drawRing(center.x, center.y, D, ringIt.pct);
      let y2 = yy;
      drawRingText(ringIt, rx, y2, "left", rw); y2 += ringTextH(ringIt);
      if (useRows.length) { y2 += gap * 0.75; drawRows(useRows, rx, y2, rw); y2 += rowsH(useRows); }
      if (cats) { y2 += gap * 0.75; drawCats(rx, y2, rw, catRow); }
    });
  } else if (ringIt) {
    // 正方形・縦長：下に小さな数字と分野、上の残りに円グラフ
    const rows = rowsOf(small, tall ? 3 : Math.min(small.length, 4) || 1);
    let y = bottom;
    const below = [];
    if (cats) { y -= catH(50 * u); below.push([drawCats, y]); y -= gap; }
    if (rows.length) { y -= rowsH(rows); const ry = y; below.push([() => drawRows(rows, P, ry, W)]); y -= gap; }
    const avail = y - top;
    if (tall) {
      // 縦長：円グラフを真ん中に大きく、見出しはその下に中央ぞろえ
      const D = Math.min(W * 0.82, avail - ringTextH(ringIt) - 40 * u);
      const blockH = D + 40 * u + ringTextH(ringIt);
      const y0 = top + (avail - blockH) * 0.45;
      center = { x: w / 2, y: y0 + D / 2, r: D / 2 };
      ops.push(() => { drawRing(center.x, center.y, D, ringIt.pct); drawRingText(ringIt, w / 2, y0 + D + 40 * u, "center"); });
    } else {
      // 正方形：左に円グラフ、右に見出し
      const D = Math.max(Math.min(avail, W * 0.5), 120 * u);
      center = { x: P + D / 2, y: top + Math.max(D, avail) / 2, r: D / 2 };
      const tx = P + D + 40 * u;
      ops.push(() => { drawRing(center.x, center.y, D, ringIt.pct); drawRingText(ringIt, tx, center.y - ringTextH(ringIt) / 2, "left", w - P - tx); });
    }
    below.forEach(([f, yy]) => ops.push(() => (yy === undefined ? f() : f(P, yy, W))));
  } else if (landscape) {
    // 横長で正答率なし：左に大きな数字、右に小さな数字や分野
    const hero = BIG[numHero];
    const lw = cats || small.length ? W * 0.52 : W;
    const rx = P + lw + 48 * u, rw = W - lw - 48 * u;
    if (hero) {
      const px = fitHero(hero, lw, bottom - top, 360 * u);
      const hy = top + (bottom - top - heroParts(px).h) / 2;
      center = { x: P + lw * 0.3, y: (top + bottom) / 2, r: 120 * u };
      ops.push(() => drawHero(hero, P, hy, px));
    }
    const rows = rowsOf(small, 2);
    const need = (cats ? catH(small.length ? 42 * u : 50 * u) : 0) + (rows.length ? rowsH(rows) + (cats ? gap : 0) : 0);
    const y0 = top + Math.max(0, (bottom - top - need) / 2);
    ops.push(() => {
      let y = y0;
      if (rows.length) { drawRows(rows, rx, y, rw); y += rowsH(rows) + gap; }
      if (cats) drawCats(rx, y, rw, small.length ? 42 * u : 50 * u);
    });
  } else {
    // 正方形・縦長で正答率なし：上に大きな数字、下に小さな数字と分野
    const hero = BIG[numHero];
    const rows = rowsOf(small, tall ? 3 : Math.min(small.length, 4) || 1);
    let y = bottom;
    if (cats) { y -= catH(50 * u); const cy = y; ops.push(() => drawCats(P, cy, W)); y -= gap; }
    if (rows.length) { y -= rowsH(rows); const ry = y; ops.push(() => drawRows(rows, P, ry, W)); y -= gap; }
    if (hero) {
      const px = fitHero(hero, W, y - top, (tall ? 560 : 420) * u);
      const hy = top + Math.max(0, (y - top - heroParts(px).h) * (tall ? 0.35 : 0.5));
      center = { x: P + W * 0.35, y: hy + heroParts(px).h * 0.45, r: 130 * u };
      ops.push(() => drawHero(hero, P, hy, px));
    }
  }

  // ---- 背景：色の流れ＋光のにじみ＋円グラフから広がる同心円 ----
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, T.bg[0]); g.addColorStop(1, T.bg[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  T.glow.forEach((o) => {
    const r = Math.max(w, h) * o.r;
    const rg = ctx.createRadialGradient(w * o.x, h * o.y, 0, w * o.x, h * o.y, r);
    rg.addColorStop(0, o.c); rg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, w, h);
  });
  const far = Math.hypot(Math.max(center.x, w - center.x), Math.max(center.y, h - center.y));
  const step = Math.max(center.r * 0.34, 34 * u);
  ctx.strokeStyle = T.line;
  ctx.lineWidth = Math.max(1, 1.6 * u);
  for (let r = center.r * 1.22, i = 0; r < far; r += step, i++) {
    ctx.globalAlpha = 0.7 * Math.max(0.12, 1 - (r - center.r) / (far - center.r));
    ctx.setLineDash(i % 3 === 2 ? [2 * u, 8 * u] : []);
    ctx.beginPath(); ctx.arc(center.x, center.y, r, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  // 上：アイコンとサイト名、右に日付
  if (icon) ctx.drawImage(icon, P, P - 4 * u, 34 * u, 34 * u);
  text(SITE_NAME, P + 46 * u, P + 24 * u, { wt: 900, px: 22 * u, ls: 1 * u });
  // 右上：本試験までの日数（だれにでも同じ情報なので、成績とは分けて小さな札にする）
  {
    const lbl = examDay ? "今日は本試験" : "本試験まで あと";
    const lp = 17 * u, np = 30 * u, dp = 17 * u;
    const lw = measure(lbl, 900, lp), nw = examDay ? 0 : measure(String(s.left), 400, np, NUM), dw = examDay ? 0 : measure("日", 900, dp);
    const pw = lw + (examDay ? 0 : 6 * u + nw + 4 * u + dw) + 32 * u, ph = 44 * u;
    const px0 = w - P - pw, py0 = P + 18 * u - ph / 2;
    ctx.strokeStyle = T.line;
    ctx.lineWidth = Math.max(1, 1.5 * u);
    roundRect(ctx, px0, py0, pw, ph, ph / 2);
    ctx.stroke();
    let x = px0 + 16 * u;
    const by = py0 + ph / 2 + 9 * u;
    x += text(lbl, x, by - 2 * u, { wt: 900, px: lp, color: T.sub });
    if (!examDay) {
      x += 6 * u;
      x += text(String(s.left), x, by + 2 * u, { wt: 400, px: np, fam: NUM, color: T.accent }) + 4 * u;
      text("日", x, by - 2 * u, { wt: 900, px: dp, color: T.sub });
    }
  }
  // 下：日付とURL
  text(date, P, h - P, { wt: 400, px: 20 * u, fam: NUM, color: T.sub, ls: 1.5 * u });
  text("takken-drill.com", w - P, h - P, { wt: 400, px: 20 * u, fam: NUM, color: T.sub, align: "right", ls: 1.5 * u });

  ops.forEach((f) => f());
  ctx.textAlign = "left";
  return cv;
}

// 成績のシェア（下から出るシート）
// opts.session を渡すと、解き終わった直後の結果（今回の正解数）ものせられる
function openShareSheet(opts = {}) {
  const dlg = document.getElementById("sheet");
  const s = { ...shareStats(), session: opts.session || null };
  const saved = store.share || {};
  let sns = SHARE_SNS[saved.sns] ? saved.sns : "x";
  let theme = CARD_THEMES[saved.theme] ? saved.theme : "navy";
  // 保存した選び方を使う。ただし今0の項目は出さない
  const on = {};
  // 開いたときは、のせられる項目をすべてチェックしておく
  SHARE_ITEMS.forEach((it) => { on[it.id] = it.has(s); });
  let edited = false;
  let file = null;
  let drawSeq = 0;
  const coarse = matchMedia("(pointer: coarse)").matches; // スマホ・タブレット

  dlg.innerHTML = `
    <div class="sheet-head"><h2>成績をシェア</h2><button class="sheet-close" aria-label="閉じる">×</button></div>
    <div class="share-apps" role="tablist" aria-label="シェアするSNS">
      ${Object.entries(SHARE_SNS).map(([id, c]) => `<button role="tab" data-sns="${id}"><span class="app-icon app-${id}">${c.icon}</span><span class="app-name">${c.name}</span></button>`).join("")}
    </div>
    <div class="share-preview"><img alt="シェアする画像のプレビュー"></div>
    <p class="share-label">デザイン</p>
    <div class="share-themes" role="radiogroup" aria-label="デザイン">
      ${Object.entries(CARD_THEMES).map(([id, t]) => `<button data-theme="${id}"><i style="background:linear-gradient(135deg, ${t.bg[0]}, ${t.bg[1]})"><b style="background:${t.accent}"></b></i>${t.name}</button>`).join("")}
    </div>
    <p class="share-label">のせる項目</p>
    <div class="share-items">
      ${SHARE_ITEMS.filter((it) => it.id !== "session" || s.session).map((it) => `<label class="${it.has(s) ? "" : "off"}"><input type="checkbox" data-item="${it.id}" ${on[it.id] ? "checked" : ""} ${it.has(s) ? "" : "disabled"}>${it.label}</label>`).join("")}
    </div>
    <p class="share-label">投稿する文章 <span class="share-count"></span></p>
    <textarea class="share-text" rows="7" aria-label="投稿する文章"></textarea>
    <p class="share-note source-note"></p>
    <div class="share-actions">
      <button class="btn btn-primary btn-block share-go"></button>
      <button class="btn btn-block share-files" hidden>画像つきで共有（アプリを選ぶ）</button>
      <div class="share-sub"><button class="btn share-save">画像を保存</button><button class="btn share-copy">文章をコピー</button></div>
    </div>`;
  const $ = (q) => dlg.querySelector(q);
  const ta = $(".share-text");

  const remember = () => { const { session: _, ...items } = on; store.share = { sns, theme, items }; save(); };
  const updateCount = () => {
    const c = $(".share-count");
    if (sns !== "x") { c.textContent = ""; return; }
    const n = Math.ceil(xLength(ta.value) / 2);
    c.textContent = `全角 ${n} / 140字`;
    c.classList.toggle("over", n > 140);
  };
  const rewrite = (ask) => {
    if (edited && ask && !confirm("手で直した文章を、選んだ内容に合わせて作り直しますか？")) return;
    ta.value = SHARE_SNS[sns].text(s, on);
    edited = false;
    updateCount();
  };
  const redraw = async () => {
    const seq = ++drawSeq;
    const [w, h] = SHARE_SNS[sns].size();
    const cv = await drawShareCard(s, on, w, h, theme);
    if (seq !== drawSeq) return; // 続けて切り替えたときは最後のものだけ使う
    $(".share-preview img").src = cv.toDataURL("image/png");
    $(".share-preview").classList.toggle("tall", h > w);
    file = null;
    cv.toBlob((b) => { if (seq === drawSeq && b) file = new File([b], `takken-${dayKey()}.png`, { type: "image/png" }); }, "image/png");
  };
  const canShareFile = () => coarse && file && navigator.canShare && navigator.canShare({ files: [file] });
  const refreshSns = () => {
    const c = SHARE_SNS[sns];
    dlg.querySelectorAll("[data-sns]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.sns === sns)));
    dlg.querySelectorAll("[data-theme]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.theme === theme)));
    $(".share-note").textContent = coarse ? c.noteMobile || "" : c.note;
    const go = $(".share-go");
    // Instagram は投稿画面をURLで開けないので、スマホでは画像を共有メニューで渡し、PCでは保存を主にする
    if (sns === "instagram") { go.textContent = coarse ? "Instagramに送る" : "画像を保存"; }
    else go.textContent = `${c.name}で${sns === "line" ? "送る" : "投稿する"}`;
    $(".share-files").hidden = !(coarse && sns !== "instagram" && navigator.canShare);
    $(".share-save").hidden = sns === "instagram" && !coarse;
  };

  const download = () => {
    if (!file) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const copy = async (btn) => {
    try { await navigator.clipboard.writeText(ta.value); } catch (e) { ta.select(); document.execCommand("copy"); }
    if (btn) { const t = btn.textContent; btn.textContent = "コピーしました"; setTimeout(() => { btn.textContent = t; }, 1500); }
  };
  const shareFile = async (text) => {
    try { await navigator.share({ files: [file], text }); } catch (e) { /* 閉じただけのときは何もしない */ }
  };

  dlg.querySelector(".sheet-close").addEventListener("click", () => dlg.close());
  dlg.querySelectorAll("[data-sns]").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.sns === sns) return;
    sns = b.dataset.sns; remember(); refreshSns(); rewrite(true); redraw();
  }));
  dlg.querySelectorAll("[data-theme]").forEach((b) => b.addEventListener("click", () => {
    theme = b.dataset.theme; remember(); refreshSns(); redraw();
  }));
  dlg.querySelectorAll("[data-item]").forEach((cb) => cb.addEventListener("change", () => {
    on[cb.dataset.item] = cb.checked; remember(); rewrite(true); redraw();
  }));
  ta.addEventListener("input", () => { edited = true; updateCount(); });
  $(".share-go").addEventListener("click", () => {
    const c = SHARE_SNS[sns];
    if (sns === "instagram") {
      if (!canShareFile()) { download(); return; }
      copy(); // Instagram は共有メニューから文章を受け取らないので、先にコピーしておく
      shareFile(ta.value);
      return;
    }
    // X は投稿画面で URL を付けるので、文章には入れない
    window.open(c.intent(ta.value), "_blank", "noopener");
  });
  $(".share-files").addEventListener("click", () => {
    if (!canShareFile()) { download(); return; }
    shareFile(sns === "x" ? `${ta.value}\n${SITE_URL}` : ta.value);
  });
  $(".share-save").addEventListener("click", download);
  $(".share-copy").addEventListener("click", (e) => copy(e.currentTarget));

  refreshSns();
  rewrite(false);
  redraw();
  dlg.showModal();
}

// ---------- 会員機能：合格ペース診断・解答スピード ----------
// 時期ごとに、分野の最終目標（TARGET）の何割まで来ていればよいか
const PHASE_FACTOR = [
  { upTo: 30, name: "直前期", f: 1.0 },
  { upTo: 90, name: "仕上げ期", f: 0.95 },
  { upTo: 150, name: "演習期", f: 0.85 },
  { upTo: Infinity, name: "基礎期", f: 0.75 },
];
const PASS_SCORE = 37; // 合格点は例年35〜38点。少し余裕を持たせた目安

// 会員でない人には、会員向けの分析をぼかして少しだけ見せる。
// ぼかした中身は見本の数字で作り、本人の分析結果はページに入れない
const SAMPLE_CATS = { gyoho: { right: 82, wrong: 18 }, kenri: { right: 52, wrong: 48 }, seigen: { right: 61, wrong: 39 }, zei: { right: 70, wrong: 30 } };
const SAMPLE_SPEED = {
  four: { gyoho: { sum: 9500, n: 100, inTime: 88 }, kenri: { sum: 15200, n: 100, inTime: 55 }, seigen: { sum: 11000, n: 100, inTime: 76 }, zei: { sum: 10200, n: 100, inTime: 81 } },
  ox: { gyoho: { sum: 2200, n: 100, inTime: 85 }, kenri: { sum: 3600, n: 100, inTime: 48 }, seigen: { sum: 2700, n: 100, inTime: 70 }, zei: { sum: 2500, n: 100, inTime: 79 } },
};
function memberTeaser() {
  return paceDiagnosis(SAMPLE_CATS, true) + speedReport(SAMPLE_SPEED, true);
}
// ぼかしたカードの下に置く案内
const lockBar = (what) => `
  <div class="ml-bar">
    <span class="ml-icon">${svgIcon('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>')}</span>
    <span class="ml-text">会員になると、あなたの${what}が表示されます</span>
    <button class="btn btn-primary" data-go="plans">会員プランを見る</button>
  </div>`;
// locked のときは、分野名や目安は見せて、本人の数字（正答率・判定・予想得点）だけぼかす
function paceDiagnosis(catsData = store.cats, locked = false) {
  const lk = locked ? ' lk" aria-hidden="true' : "";
  const { left } = examInfo();
  const ph = PHASE_FACTOR.find((p) => left <= p.upTo);
  let predicted = 0, answeredCats = 0;
  const rows = CATEGORIES.map((c) => {
    const s = catsData[c.id] || { right: 0, wrong: 0 };
    const n = s.right + s.wrong;
    const acc = n ? Math.round((s.right / n) * 100) : null;
    const need = Math.round(TARGET[c.id] * ph.f);
    if (acc !== null) { predicted += (EXAM_POINTS[c.id] * acc) / 100; answeredCats++; }
    const st = acc === null ? ["", "未着手"] : acc >= need ? ["ok", "順調"] : acc >= need - 10 ? ["warn", "注意"] : ["ng", "危険"];
    return `<tr>
      <th>${esc(c.name)}</th>
      <td class="num${lk}">${acc === null ? "—" : acc + "%"}</td>
      <td class="num muted">${need}%</td>
      <td><span class="status ${st[0]}${lk}">${st[1]}</span></td>
    </tr>`;
  }).join("");
  const score = Math.round(predicted);
  const gap = PASS_SCORE - score;

  return `
    <div class="card" style="margin-bottom:16px">
      <h2>合格ペース診断<span class="member-badge link" data-go="plans">会員</span></h2>
      <p class="source-note" style="margin:-4px 0 12px">今は<b>${ph.name}</b>（あと${left}日）。この時期に必要な正答率と比べて判定します。</p>
      <table class="pace">
        <thead><tr><th></th><th class="num">正答率</th><th class="num">この時期の目安</th><th>判定</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="predict">
        <div><span class="k">今の実力での予想得点</span><b class="${lk}">${answeredCats ? score : "—"}<small> / 50点</small></b></div>
        <div class="predict-msg ${answeredCats ? (gap <= 0 ? "ok" : "ng") : ""}${lk}">${!answeredCats ? "問題を解くと表示されます" : gap <= 0 ? `合格目安（${PASS_SCORE}点）に届いています` : `合格目安（${PASS_SCORE}点）まで あと${gap}点`}</div>
      </div>
      <p class="source-note">予想得点は、分野ごとの正答率 × 本試験の配点で計算しています。未着手の分野は0点として数えます。</p>
      ${locked ? lockBar("判定と予想得点") : ""}
    </div>`;
}

function speedReport(speedData = store.speed, locked = false) {
  const lk = locked ? ' lk" aria-hidden="true' : "";
  const row = (mode, c) => {
    const r = (speedData[mode] || {})[c.id];
    const limit = mode === "four" ? SEC_PER_Q : SEC_PER_OX;
    if (!r || !r.n) return `<tr><th>${esc(c.name)}</th><td class="num muted">—</td><td></td><td class="num muted">—</td></tr>`;
    const avg = Math.round(r.sum / r.n);
    const pct = Math.min(100, (avg / (limit * 2)) * 100);
    return `<tr>
      <th>${esc(c.name)}</th>
      <td class="num ${avg > limit ? "slow" : ""}${lk}">${avg}秒</td>
      <td class="spd-cell"><span class="spd-bar${lk}"><i class="${avg > limit ? "slow" : ""}" style="width:${pct}%"></i><em style="left:50%"></em></span></td>
      <td class="num muted${lk}">${Math.round((r.inTime / r.n) * 100)}%</td>
    </tr>`;
  };
  const table = (mode, title, limit) => `
    <p class="mini" style="margin-top:12px"><b>${title}</b>　目安 ${limit >= 60 ? `${limit / 60}分` : `${limit}秒`}</p>
    <table class="pace speed">
      <thead><tr><th></th><th class="num">平均</th><th></th><th class="num">目安内</th></tr></thead>
      <tbody>${CATEGORIES.map((c) => row(mode, c)).join("")}</tbody>
    </table>`;
  return `
    <div class="card" style="margin-bottom:16px">
      <h2>解答スピード<span class="member-badge link" data-go="plans">会員</span></h2>
      <p class="source-note" style="margin:-4px 0 0">本試験は50問を120分。見直しの時間を残すには、<b>1問2分以内</b>で解けるのが目安です。バーの縦線が目安の時間です。</p>
      ${table("four", "4択（1問あたり）", SEC_PER_Q)}
      ${table("ox", "一問一答（1問あたり）", SEC_PER_OX)}
      ${locked ? lockBar("解答時間") : ""}
    </div>`;
}

// ---------- 合格スケジュール ----------
// 宅建試験は例年10月の第3日曜日。受験年だけ選べばよい
function examDateFor(year) {
  const d = new Date(year, 9, 1);
  const first = 1 + ((7 - d.getDay()) % 7);
  return dayKey(new Date(year, 9, first + 14).getTime());
}
function defaultExamDate() {
  const y = new Date().getFullYear();
  return new Date(examDateFor(y) + "T23:59:59") < new Date() ? examDateFor(y + 1) : examDateFor(y);
}
function examInfo() {
  const exam = store.plan ? store.plan.exam : defaultExamDate();
  const d = new Date(exam + "T00:00:00");
  const today = new Date(dayKey() + "T00:00:00");
  return { d, left: Math.max(0, Math.round((d - today) / DAY)) };
}
// 試験までの残り日数に応じた色の段階
function urgencyClass(left) {
  return left > 180 ? "cd-blue" : left > 90 ? "cd-purple" : left > 30 ? "cd-orange" : "cd-red";
}
function renderExamCount() {
  const { d, left } = examInfo();
  const w = "日月火水木金土"[d.getDay()];
  document.getElementById("exam-count").innerHTML =
    `<span class="ec-date"><span class="ec-label">本試験 </span>${d.getMonth() + 1}/${d.getDate()}(${w})</span><span class="ec-left">あと<b class="${urgencyClass(left)}">${left}</b>日</span>`;
}
// 1日の目標（ドリルの問題数）は「あなたの学習段階」から自動で決める。
// 過去問の段階なら提案の問題数、それより前の段階でも習慣づけに1日10問
function dailyGoal() {
  if (!store.plan) return 20;
  return stageProposal(store.plan).pastPerDay || MIN_PER_DAY;
}
// 過去問はネットで公開されている約17年分（1年50問）。合格者の定番は「10年分以上を3周」で、
// 2周目からは全問ではなく間違えた問題を中心に解くのが一般的。
// 1周目は解説と根拠の確認に時間がかかるので1問5分（解く2分＋解説3分）、2周目からは1問3分で見積もる
const TOTAL_QUESTIONS = 17 * 50;
const PAST_LAPS = [
  { q: TOTAL_QUESTIONS, min: 5 }, // 1周目：全問
  { q: Math.round(TOTAL_QUESTIONS * 0.5), min: 3 }, // 2周目：間違えた問題を中心に約半分
  { q: 10 * 50, min: 3 }, // 3周目：直近10年分を本番形式で
];
// 本試験は50問を120分。見直しの時間を残すため、1問あたり2分（120秒）で解けるのが目安
const SEC_PER_Q = 120;
const SEC_PER_OX = 30; // 一問一答は1問（1肢）30秒が目安（4肢で4択1問ぶん）
// 試験までの残り日数で区切った学習の流れ（ドリル画面のメッセージと同じ区切り）
// 学習の4段階（試験までの残り日数で区切る）。ドリル・計画・成績の各画面で同じ区切りを使う
const PHASES = [
  { name: "基礎", from: 999, to: 151, text: "テキストで全体をつかむ" },
  { name: "演習", from: 150, to: 91, text: "問題集をくり返す" },
  { name: "仕上げ", from: 90, to: 31, text: "過去問を3周（2周目からは間違えた問題中心）" },
  { name: "直前", from: 30, to: 0, text: "模試と総復習" },
];

// 1日の目標は「時間」か「問題数」で決める。時間なら1問3分（解く2分＋解説1分）で問題数に直す
function makePlan(exam, basis = "time", value = 30) {
  const left = Math.max(1, Math.round((new Date(exam + "T00:00:00") - new Date(dayKey() + "T00:00:00")) / DAY));
  const goal = basis === "time" ? Math.max(5, Math.floor(value / MIN_PER_Q)) : value;
  // 参考：残り90日より前なら、仕上げ期（残り60日）までに過去問を1周できるペース
  const needed = left > 90 ? Math.ceil(TOTAL_QUESTIONS / (left - 60)) : 0;
  const prev = store.plan || {};
  const startedAt = prev.startedAt || dayKey();
  return { exam, basis, value, goal, needed, startedAt, progress: prev.progress };
}

// 選び直しても画面の位置がずれないよう、スクロール位置を保ったまま描き直す
function renderScheduleKeepScroll() {
  const y = window.scrollY;
  renderSchedule();
  window.scrollTo(0, y);
}

// ---------- 今の段階から逆算した提案 ----------
// 「テキストを何周読んだか」「問題集・過去問を何周解いたか」を選ぶと、段階を自動で判定し、
// 試験の1週間前までに残りを終えるのに必要な1日の量を出す
const STAGES = [
  { id: "kiso", name: "基礎", sub: "テキスト" },
  { id: "enshu", name: "演習", sub: "問題集" },
  { id: "shiage", name: "仕上げ", sub: "過去問" },
  { id: "chokuzen", name: "直前", sub: "模擬試験" },
];
const PROGRESS_QS = [
  { key: "text", label: "テキスト", opts: [["未読", 0], ["1周", 1], ["2周以上", 2]] },
  { key: "drill", label: "問題集", opts: [["未着手", 0], ["1周", 1], ["2周", 2], ["3周", 3], ["4周以上", 4]] },
  { key: "past", label: "過去問", opts: [["未着手", 0], ["1周", 1], ["2周", 2], ["3周以上", 3]] },
  { key: "mock", label: "模擬試験", opts: [["未受験", 0], ["1回", 1], ["2回", 2], ["3回以上", 3]] },
];
// 各教材の目標と、1周（1回）あたりの時間の目安
const MIN_PER_Q = 3; // 過去問1問＝解く2分＋解説1分
const MAX_MIN_PER_DAY = 240; // 1日4時間を超える計画は現実的ではないとみなす
const MIN_PER_DAY = 10;
// 合格に必要な勉強時間の目安：初学者は300〜400時間（ここでは400時間）、法律の学習経験がある人は約200時間。
// 過去問は周ごとの問題数×1問の時間、模試は3回×3時間で見積もり、残りの時間をテキストと問題集に下の比率で割り振る。
// 合計がちょうど目安の時間になるようにする
const TOTAL_HOURS = [400, 200];
const TEXT_SHARE = [0.13, 0.07]; // テキスト：1周目、2周目
const DRILL_SHARE = [0.15, 0.10, 0.07, 0.03]; // 問題集：1周目〜3周目、4周目以上
const MOCK_HOURS = 3; // 模擬試験：2時間＋見直し1時間。3回が目標

function fmtMin(min) {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? `${h}時間${m ? `${m}分` : ""}` : `${m}分`;
}

// どの教材まで終わったかで段階を決める
function stageFrom(pr) {
  if (pr.text < 1) return "kiso";
  if (pr.drill < 3) return "enshu";
  if (pr.past < 3) return "shiage";
  return "chokuzen";
}
function expectedStage(left) {
  return left > 150 ? "kiso" : left > 90 ? "enshu" : left > 30 ? "shiage" : "chokuzen";
}

// 教材ごとの期限：テキスト＝基礎期の終わり、問題集＝演習期の終わり、過去問＝仕上げ期の終わり、模試＝試験3日前
const MATERIAL_DEADLINE = [150, 90, 30, 3];
const MIN_CURRENT = 20; // 今の段階の教材は、1日20分以上は進める

function stageProposal(plan) {
  const { left } = examInfo();
  // 法律の学習経験は聞かなくなったので、全員を初学者（350時間）として計算する
  const pr = { text: 0, drill: 0, past: 0, mock: 0, ...(plan.progress || {}), law: 0 };
  pr.past = Math.floor(pr.past); // 以前あった「途中（0.5周）」は未着手として扱う
  pr.drill = Math.min(pr.drill, 4); // 以前あった「5周以上」は「4周以上」として扱う
  const stage = stageFrom(pr);
  const cur = STAGES.findIndex((x) => x.id === stage);
  const T = TOTAL_HOURS[pr.law];
  const sumFrom = (arr, done) => arr.slice(done).reduce((a, h) => a + h, 0);
  // 過去問：周ごとに、まだ終わっていない割合×問題数（と時間）を足す。「2周」なら1・2周目が済んだ扱い
  const lapLeft = PAST_LAPS.map((l, i) => Math.max(0, Math.min(1, i + 1 - pr.past)));
  const pastQLeft = Math.ceil(PAST_LAPS.reduce((a, l, i) => a + l.q * lapLeft[i], 0));
  const pastMinLeft = PAST_LAPS.reduce((a, l, i) => a + l.q * l.min * lapLeft[i], 0);
  const pastMinPerQ = pastQLeft ? pastMinLeft / pastQLeft : MIN_PER_Q; // 残りの過去問の1問あたりの平均時間
  const pastTotal = PAST_LAPS.reduce((a, l) => a + l.q * l.min, 0) / 60;
  const rest = T - pastTotal - 3 * MOCK_HOURS; // テキストと問題集に使える時間
  const shareSum = [...TEXT_SHARE, ...DRILL_SHARE].reduce((a, x) => a + x, 0);
  const TEXT_HOURS = TEXT_SHARE.map((x) => Math.round((x / shareSum) * rest));
  const DRILL_HOURS = DRILL_SHARE.map((x) => Math.round((x / shareSum) * rest));
  DRILL_HOURS[DRILL_HOURS.length - 1] += Math.round(rest) - sumFrom(TEXT_HOURS, 0) - sumFrom(DRILL_HOURS, 0); // 端数を合わせる
  const remain = [
    sumFrom(TEXT_HOURS, pr.text) * 60, // 分
    sumFrom(DRILL_HOURS, pr.drill) * 60, // 「4周以上」で問題集はすべて完了
    pastQLeft, // 問
    Math.max(0, 3 - pr.mock) * MOCK_HOURS * 60,
  ];
  const remainAll = [...remain]; // 時間が足りずに計画を縮める前の量（「残り◯時間」の表示に使う）
  const exam = new Date(plan.exam + "T00:00:00").getTime();
  const fmtD = (daysBefore) => { const d = new Date(exam - daysBefore * DAY); return `${d.getMonth() + 1}/${d.getDate()}`; };
  const items = STAGES.map((st, k) => {
    if (!remain[k]) return null;
    const startBefore = k === 0 ? Infinity : MATERIAL_DEADLINE[k - 1];
    // 前の教材の期限が来ていない、かつ今の段階より先の教材は「◯/◯から」
    if (k > cur && left > startBefore) return { k, name: st.sub, future: true, from: fmtD(startBefore) };
    const overdue = left <= MATERIAL_DEADLINE[k];
    // 期限を過ぎた教材は、最低限（テキスト・問題集とも1周）が済んでいれば省いて、過去問と模試に時間を回す
    if (overdue && ((k === 0 && pr.text >= 1) || (k === 1 && pr.drill >= 1))) return { k, name: st.sub, skip: true };
    if (overdue && k === 0) remain[0] = TEXT_HOURS[0] * 60; // テキスト未読なら1周だけ
    if (overdue && k === 1) remain[1] = DRILL_HOURS[0] * 60;
    // もう次の段階に進んでいて最低限は済んでいる教材（テキスト2周目など）は「余裕があれば」
    if (k < cur && ((k === 0 && pr.text >= 1) || (k === 1 && pr.drill >= 1))) return { k, name: st.sub, optional: true };
    const deadline = overdue ? 3 : MATERIAL_DEADLINE[k]; // 期限を過ぎていたら試験3日前まで
    const days = Math.max(1, left - deadline);
    if (k === 2) {
      const q = Math.max(MIN_PER_DAY, Math.ceil(remain[k] / days));
      return { k, name: st.sub, perDay: `${q}問`, min: Math.ceil(q * pastMinPerQ), q, rest: `残り${remain[k].toLocaleString()}問`, by: fmtD(deadline) };
    }
    if (k === 3) {
      // 模試は1回2時間＋見直しなので、1日あたりではなく「週◯回」で示す
      const times = remain[k] / 60 / MOCK_HOURS;
      const perWeek = Math.max(1, Math.ceil(times / Math.max(1, days / 7)));
      return { k, name: st.sub, perDay: `週${perWeek}回`, min: Math.ceil(remain[k] / days), rest: `あと${times}回`, by: fmtD(deadline), weekly: true };
    }
    const m = Math.max(k === cur ? MIN_CURRENT : 0, Math.ceil(remain[k] / days));
    return { k, name: st.sub, perDay: fmtMin(m), min: m, rest: k === 3 ? `あと${remain[k] / 60 / MOCK_HOURS}回` : `残り${Math.round(remain[k] / 60)}時間`, by: fmtD(deadline) };
  }).filter(Boolean);
  let minutes = items.filter((i) => i.min).reduce((a, i) => a + i.min, 0);
  // 全体のペース（残りの総時間 ÷ 残り日数）の方が多ければ、今やる教材に上乗せする
  const leftAll = remain[0] + remain[1] + remain[2] * pastMinPerQ + remain[3];
  const overall = Math.ceil(leftAll / Math.max(1, left - 3));
  if (overall > minutes && minutes > 0) {
    const f = overall / minutes;
    items.forEach((i) => {
      if (!i.min || i.weekly) return;
      i.min = Math.ceil(i.min * f);
      if (i.k === 2) { i.q = Math.ceil(i.min / pastMinPerQ); i.perDay = `${i.q}問`; } else i.perDay = fmtMin(i.min);
    });
    minutes = items.filter((i) => i.min).reduce((a, i) => a + i.min, 0);
  }
  // 1日4時間を超える場合は、4時間に収まるように縮めた量を目標にする（本来必要な時間も残しておく）
  const needMinutes = minutes;
  const tooMuch = minutes > MAX_MIN_PER_DAY;
  if (tooMuch) {
    // 模試（週◯回）はそのまま残し、残りの時間で他の教材を縮める
    const weeklyMin = items.filter((i) => i.weekly).reduce((a, i) => a + i.min, 0);
    const f = Math.max(0, MAX_MIN_PER_DAY - weeklyMin) / Math.max(1, minutes - weeklyMin);
    items.forEach((i) => {
      if (!i.min || i.weekly) return;
      i.min = Math.floor(i.min * f);
      if (i.k === 2) { i.q = Math.floor(i.min / pastMinPerQ); i.perDay = `${i.q}問`; } else i.perDay = fmtMin(i.min);
    });
    minutes = items.filter((i) => i.min).reduce((a, i) => a + i.min, 0);
  }
  const pastItem = items.find((i) => i.k === 2 && !i.future);
  const expected = expectedStage(left);
  const gapStages = STAGES.findIndex((x) => x.id === expected) - cur;
  // 合格までの総量のうち、どこまで終わったか（時間換算）
  const planTotal = sumFrom(TEXT_HOURS, 0) + sumFrom(DRILL_HOURS, 0) + pastTotal + 3 * MOCK_HOURS;
  const leftHours = remainAll[0] / 60 + remainAll[1] / 60 + pastMinLeft / 60 + remainAll[3] / 60;
  const doneHours = Math.max(0, planTotal - leftHours);
  // バーの区間：テキスト→問題集→過去問→模試を、各教材の時間の長さで並べ、終わった割合だけ塗る
  const hourParts = [
    ["text", sumFrom(TEXT_HOURS, 0), remainAll[0] / 60],
    ["drill", sumFrom(DRILL_HOURS, 0), remainAll[1] / 60],
    ["past", pastTotal, pastMinLeft / 60],
    ["mock", 3 * MOCK_HOURS, remainAll[3] / 60],
  ].map(([key, hours, left]) => ({ key, hours, done: hours ? Math.max(0, Math.min(1, 1 - left / hours)) : 1 }));
  return { pr, stage, items, minutes, needMinutes, pastPerDay: pastItem ? pastItem.q : 0, tooMuch, expected, gapStages, left, T, planTotal: Math.round(planTotal), doneHours: Math.round(doneHours), leftHours: Math.round(leftHours), hourParts };
}

// 量が足りている人（今日やる教材が残っていない、または直前期で必要な量が少ない）には、
// 数字の目標ではなく、今の時期にやるべきことをアドバイスとして出す。数字の目標を出すときは null
function todayAdvice(p) {
  const noWork = !p.items.length || p.minutes === 0;
  const nearAndEnough = p.left <= 30 && p.minutes < 60;
  if (!noWork && !nearAndEnough) return null;
  const mockLeft = p.pr.mock < 3;
  if (p.left <= 7) {
    return {
      headline: "今日は<b>これまで解いた問題の総復習</b>をしよう",
      todo: [
        "新しい問題より、間違えた問題を「復習」タブで解き直す",
        "数字や期間の暗記事項（8日間・10分の2など）を見直す",
        "法改正と統計問題（問48）の最新の数字を確認する",
        "睡眠と体調を整えて、本番と同じ時間帯に頭を動かす",
      ],
    };
  }
  if (p.left <= 30) {
    return {
      headline: mockLeft ? "今日は<b>模擬試験で本番の時間配分</b>を確かめよう" : "今日は<b>間違えた問題の見直し</b>をしよう",
      todo: [
        ...(mockLeft ? [`模擬試験を本番と同じ2時間で解き、時間配分を確かめる <button class="adv-link" data-go="mock">このサイトの模試を受ける ›</button>${affiliateItems(p).length ? ` <button class="adv-link" data-scroll="pr-card">おすすめの公開模試を見る ›</button>` : ""}`] : []),
        "間違えた問題を「復習」タブで解き直す",
        "法改正と統計問題（問48）の最新の数字を確認する",
        "数字や期間の暗記事項（8日間・10分の2など）をまとめて見直す",
      ],
    };
  }
  return {
    headline: "今日は<b>苦手な分野の復習</b>をしよう",
    todo: [
      "成績画面で正答率の低い分野を確かめ、その分野を解き直す",
      "間違えた問題を「復習」タブで解き直す",
      "得点源の宅建業法で取りこぼしがないか確認する",
    ],
  };
}

// 数字の目標がある人の今日のタスク：今やる教材ごとの量と、間違えた問題の復習
function planTasks(p) {
  const todo = p.items.filter((i) => !i.future && !i.skip && !i.optional && i.min).map((i) =>
    i.k === 0 ? `テキストを${i.perDay}読み進める`
      : i.k === 1 ? `問題集を${i.perDay}解く`
      : i.k === 2 ? `過去問を${i.q}問解く`
      : `模擬試験を解く（${i.perDay}のペース）`);
  if (dueItems().length) todo.push("間違えた問題を「復習」タブで解き直す");
  return { headline: `今日は<b>${fmtMin(p.minutes)}</b>${p.pastPerDay ? `・<b>過去問${p.pastPerDay}問</b>` : ""}を目標にしよう`, todo };
}

// ---------- この時期のおすすめ（PR・アフィリエイト） ----------
// 今の段階で必要になる教材だけを最大3件。学習の案内として会員にも出す（会員が消えるのはバナー広告だけ）。PR表示は必ず付ける（ステマ規制）
// 教材の欄から、その教材のおすすめ（PR）を開く。どの紹介を出すかは affiliates.js の stage で決める
const MATERIAL_STAGE = { text: "kiso", drill: "enshu", past: "shiage", mock: "chokuzen" };
// 今出せる紹介だけを、affiliates.js の並び順（＝優先順位）のまま返す。url が空（提携の審査中）のものと、期間外のものは除く
function liveAffiliates(stage) {
  const today = dayKey();
  return AFFILIATES.filter((a) => a.url && (!stage || a.stage === stage) && (!a.from || a.from <= today) && (!a.to || today <= a.to)
    && (!a.pref || a.pref.includes(geoRegion)));
}
// 地域を限った紹介（affiliates.js の pref）のために、接続元のおおよその都道府県を調べる（/api/geo＝worker.js。Cloudflare が IP アドレスから推定した番号だけを受け取る）。
// 地域を限った紹介が出せる状態のときだけ、1回だけ問い合わせる。分からなかったときは、地域を限った紹介は出さない
let geoRegion = sessionStorage.getItem("geo-region") || "";
const geoReady = (!geoRegion && AFFILIATES.some((a) => a.url && a.pref)
  ? fetch("/api/geo").then((r) => r.json()).then((g) => { geoRegion = g.country === "JP" ? g.region : ""; sessionStorage.setItem("geo-region", geoRegion || "-"); })
  : Promise.resolve()).catch(() => {});
// 紹介1件ぶん。リンクはASPが発行したものをそのまま使い、表示回数を数える1×1の画像（pixel）を一緒に置く
function affiliateLi(a) {
  const px = a.pixel ? `<img src="${a.pixel}" width="1" height="1" alt="" style="border:0">` : "";
  return `
    <li>
      <div class="aff-body">
        <span class="aff-kind">${a.kind}</span>
        <b>${esc(a.name)}${a.tag ? `<em class="aff-tag">${esc(a.tag)}</em>` : ""}</b>
        <span class="aff-note">${esc(a.note)}</span>
        ${a.merits ? `<ul class="aff-merits">${a.merits.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>` : ""}
        ${a.tag ? "" : `<span class="aff-price">価格の目安：${esc(a.price)}</span>`}
      </div>
      <a class="btn aff-btn" href="${a.url}" target="_blank" rel="nofollow sponsored noopener" referrerpolicy="no-referrer-when-downgrade" data-aff="${a.id}">${esc(a.link || "詳しく見る")}${a.pixelIn ? px : ""}</a>${a.pixelIn ? "" : px}
    </li>`;
}
function openMaterialRecs(key) {
  const list = liveAffiliates(MATERIAL_STAGE[key]);
  const label = PROGRESS_QS.find((q) => q.key === key).label;
  const dlg = document.getElementById("sheet");
  dlg.innerHTML = `
    <div class="sheet-head"><h2>${label}のおすすめ</h2><span class="sheet-head-right"><button class="pr-badge" data-go="aff-policy" title="PR（広告）について">PR</button><button class="sheet-close" aria-label="閉じる">×</button></span></div>
    ${ownMockTop(key === "mock" ? ownMockNote() : "")}<ul class="aff-list">
      ${list.map(affiliateLi).join("") || `<li><span class="aff-note">今はご紹介できるものがありません。</span></li>`}
    </ul>`;
  dlg.querySelector(".sheet-close").addEventListener("click", () => dlg.close());
  dlg.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => dlg.close()));
  dlg.showModal();
}
// 模試のおすすめの下に、このサイトの会員向け模試も案内する（広告ではないので PR の紹介とは線で分ける）。会員は模試の一覧へ、会員でない人は会員プランへ
// 会員でない人には、月額プランの料金で全回受けられることを出して、公開模試と比べやすくする
function ownMockNote() {
  if (!MOCKS.length) return "";
  const n = MOCK_ROUNDS, price = PLANS[0].price;
  const sub = store.member ? `本試験と同じ50問・2時間を${n}回分。すべてオリジナル問題です`
    : `オリジナル模試${n}回分が、たったの<em class="own-mock-price">月${price}円</em>。本試験と同じ50問・2時間で受けられます`;
  return `
    <button class="mock-entry own-mock" data-go="${store.member ? "mock" : "plans"}">
      <span class="me-icon">${svgIcon('<path d="M9 3h6l1 2h3v16H5V5h3Z"/><path d="M9 12l2 2 4-4"/>')}</span>
      <span class="me-body"><b>本番形式の模試<span class="member-badge">会員</span></b><small>${sub}</small></span>
      <span class="me-go" aria-hidden="true">${store.member ? "受ける ›" : "会員プランを見る ›"}</span>
    </button>`;
}
// このサイトの模試を公開模試（PR）より先に出し、その下に「公開模試」の見出しを付けて分ける
const ownMockTop = (own) => own ? `<div class="own-first">${own}</div><p class="own-mock-head">公開模試</p>` : "";

// 計画画面の「この時期のおすすめ」。試験の当日から2月末ごろまでは、合格後の準備（転職・登録実務講習）を先に出す
const AFTER_DAYS = 135;
function afterSeason() {
  const y = new Date().getFullYear(), today = dayKey();
  const last = examDateFor(y) <= today ? examDateFor(y) : examDateFor(y - 1); // いちばん最近の試験日
  return (new Date(today + "T00:00:00") - new Date(last + "T00:00:00")) / DAY <= AFTER_DAYS;
}
// 転職を3件まで、登録実務講習を1件（転職の紹介が増えても、講習が押し出されないように分けて数える）
function afterItems() {
  if (!afterSeason()) return [];
  const list = liveAffiliates("after");
  return [...list.filter((a) => a.kind !== "講習").slice(0, 3), ...list.filter((a) => a.kind === "講習").slice(0, 1)];
}
// 学習の段階に合わせた教材・講座・模試。試験日を過ぎた計画（受け終わった人）には出さない
function affiliateItems(p) {
  if (store.plan && dayKey() >= store.plan.exam) return [];
  if (p.stage === "chokuzen" && p.pr.mock >= 3) return []; // 模試まで済んだ人には出さない
  return liveAffiliates(p.stage).slice(0, 3);
}

function affiliateCard(p) {
  // 直前期は、このサイトの模試を公開模試（PR）より先に出す
  const card = (id, title, list, lead, own = "") => !list.length ? "" : `
    <div class="card aff-card" id="${id}" style="margin-bottom:16px">
      <div class="card-head"><h2>この時期のおすすめ<small class="h-sub">${title}</small></h2><button class="pr-badge" data-go="aff-policy" title="PR（広告）について">PR</button></div>
      <p class="aff-lead">${lead}</p>${ownMockTop(own)}
      <ul class="aff-list">
        ${list.map(affiliateLi).join("")}
      </ul>
    </div>`;
  const title = { kiso: "テキスト・講座", enshu: "問題集", shiage: "直前の仕上げ", chokuzen: "公開模試" }[p.stage];
  const lead = {
    kiso: "テキストを読むだけでは分かりにくいところは、講義で聞くと早く理解できます。月額制で安く始められる講座もあります。",
    enshu: "問題を解いて分からなかったところは、講義で確かめると早く身につきます。",
    shiage: "法改正と統計は、直前期にまとめて確かめると効率的です。",
    chokuzen: "本番と同じ2時間で解いて、時間配分を確かめましょう。",
  }[p.stage];
  return card("pr-after", "合格後の準備", afterItems(), "宅建を活かせる求人を、担当者が無料で紹介してくれます。登録の手続きに必要な講習も、早めに日程を確かめましょう。")
    + card("pr-card", title, affiliateItems(p), lead, p.stage === "chokuzen" ? ownMockNote() : "");
}

// ---------- サイドの広告枠 ----------
// 講座と転職を1件ずつ、優先順位の高いものから出す（affiliates.js で side: true のもの）。学習の案内として会員にも出す。
// 見た目は計画画面の「この時期のおすすめ」と同じカード。広告であることは右上の「PR」で示す
function renderSideAd() {
  const box = document.getElementById("side-ad");
  if (!box || box.dataset.done) return; // 画面を移るたびに描き直すと表示回数が増えてしまうので、1回だけ
  box.dataset.done = "1";
  geoReady.then(() => fillSideAff(box));
}
function fillSideAff(box) {
  const side = liveAffiliates().filter((a) => a.side);
  const list = [side.find((a) => a.stage !== "after"), side.find((a) => a.stage === "after")].filter(Boolean);
  box.hidden = !list.length;
  box.innerHTML = `
    <div class="card-head"><h2>おすすめ<small class="h-sub">講座・転職</small></h2><button class="pr-badge" data-go="aff-policy" title="PR（広告）について">PR</button></div>
    <ul class="aff-list">${list.map(affiliateLi).join("")}</ul>`;
}

// ---------- 広告掲載のご案内（資格スクール・教材会社向け） ----------
function renderAdvertise() {
  setNav("");
  view.innerHTML = `
    <button class="back-link" data-go="home">‹ ドリルに戻る</button>
    <section class="adv-hero">
      <span class="eyebrow">資格スクール・教材会社さま向け 広告掲載のご案内</span>
      <h1>宅建の受験生に、<br>必要なときに届く広告を。</h1>
      <p>宅建過去問ドリルは、宅建試験の受験生だけが毎日使う学習サイトです。学習の段階に合わせて、講座・教材・模試をご紹介できます。</p>
    </section>

    <div class="adv-points">
      <div class="adv-point"><b>利用者は全員が宅建の受験生</b><span>過去問を解くために来る人だけなので、関心の外れた表示がほとんどありません。</span></div>
      <div class="adv-point"><b>学習の段階に合わせて表示</b><span>利用者が選んだ段階（基礎・演習・仕上げ・直前）に合わせ、講座は基礎期、模試は直前期など、必要な時期にだけ表示します。</span></div>
      <div class="adv-point"><b>毎日開かれる画面に掲載</b><span>ドリル・復習・計画の画面は、受験生が毎日の学習で開く場所です。</span></div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <h2>掲載できる場所</h2>
      <table class="adv-table">
        <tr><th>計画画面「この時期のおすすめ」</th><td>学習段階に合わせて表示する紹介枠（最大3件）。講座・教材・模試の紹介に向いています。</td></tr>
        <tr><th>サイドバー／ページ下部</th><td>全画面に表示するバナー枠。ブランドの認知に向いています。</td></tr>
        <tr><th>直前期の模試の紹介</th><td>本試験30日前からの「やることリスト」から案内します。公開模試の申込に向いています。</td></tr>
      </table>
      <p class="source-note">広告には「PR」の表示を付けます。</p>
    </div>

    <div class="card" style="margin-bottom:16px">
      <h2>料金の目安</h2>
      <table class="adv-table price-table">
        <tr><th>サイドバー／ページ下部のバナー</th><td><b>月額 20,000円〜</b>全画面に表示。1枠</td></tr>
        <tr><th>計画画面「この時期のおすすめ」</th><td><b>月額 30,000円〜</b>表示する学習段階（基礎・演習・仕上げ・直前）を選べます</td></tr>
        <tr><th>直前期の模試の紹介</th><td><b>1か月 50,000円〜</b>8〜10月の本試験前に限定。1社のみ</td></tr>
        <tr><th>成果報酬（アフィリエイト）</th><td><b>ご相談</b>申込1件あたりの報酬でお受けします</td></tr>
      </table>
      <p class="source-note">金額は税別です。公開初期の料金で、表示回数が増えたら見直します。3か月以上のご掲載や、複数の枠の組み合わせはご相談ください。</p>
    </div>

    <div class="card" style="margin-bottom:16px">
      <h2>利用者の数字</h2>
      <p class="empty" style="margin:0">公開後に、月間の利用者数・表示回数・学習段階ごとの割合を掲載します。</p>
    </div>

    <div class="card" id="adv-form-card">
      <h2>お問い合わせ</h2>
      <form class="form-grid" id="adv-form">
        ${honeypot()}
        <label>会社名<span class="req">必須</span><input name="company" required autocomplete="organization"></label>
        <label>ご担当者名<span class="req">必須</span><input name="name" required autocomplete="name"></label>
        <label>メールアドレス<span class="req">必須</span><input name="email" type="email" required autocomplete="email"></label>
        <label>ご希望の掲載方法
          <select name="type"><option>月額掲載</option><option>成果報酬（アフィリエイト）</option><option>まだ決めていない</option></select>
        </label>
        <label>ご質問・ご要望<textarea name="message" placeholder="紹介したい講座・模試、掲載したい時期など"></textarea></label>
        <button class="btn btn-primary btn-block" type="submit">送信する</button>
        ${cloudReady() ? "" : `<p class="source-note" style="margin:0">試作版のため、送信しても実際には送られません。</p>`}
      </form>
    </div>`;
  view.querySelector("#adv-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    submitInquiry(f, { kind: "広告掲載", company: f.elements.company.value, name: f.elements.name.value, email: f.elements.email.value, topic: f.elements.type.value, message: f.elements.message.value, website: f.elements.website.value },
      (html) => { view.querySelector("#adv-form-card").innerHTML = html; }, "2営業日");
  });
}

function renderAffPolicy() {
  setNav("");
  view.innerHTML = `
    <button class="back-link" data-go="schedule">‹ 計画に戻る</button>
    <h1>アフィリエイトについて</h1>
    <div class="card">
      <p style="margin-top:0">当サイトでは、学習の時期に合わせて教材・講座・模試や、合格後の転職支援サービスを紹介しています。一部のリンクはアフィリエイトプログラム（成果報酬型の広告）を利用しており、リンク先で購入や申込があると、当サイトに報酬が支払われることがあります。</p>
      <p>紹介する教材は、学習の段階に合うかどうかで選んでいます。報酬の有無で問題の内容や解説、成績の判定が変わることはありません。</p>
      <p class="source-note">広告であることが分かるよう、紹介には「PR」または「広告」と表示しています。会員の方にも、学習の段階に合った紹介として表示します（会員の方に表示しないのは、バナー広告です）。</p>
    </div>`;
}

// 各段階の期限（試験までの残り日数の区切り）を「〜5/20」の形で返す。直前期は本試験の日
function stagePeriod(plan, i) {
  const exam = new Date(plan.exam + "T00:00:00").getTime();
  const ph = PHASES[i];
  const d = new Date(exam - ph.to * DAY);
  return `〜${d.getMonth() + 1}/${d.getDate()}`;
}

// 合格までの道のり：テキスト→問題集→過去問→模試を1本のバーに繋げ、各区間は終わった割合だけ塗る。
// 区間の下に教材名と期限、時期として本来いる区間には「今の時期」の印を付ける
function stageRoadmap(plan) {
  const p = stageProposal(plan);
  const expIdx = STAGES.findIndex((x) => x.id === p.expected);
  return `
    <div class="card sched-steps">
      <div class="th-top"><span>合格までの勉強時間の目安 <b>${p.planTotal}時間</b></span><span>残り <b>${p.leftHours}時間</b></span></div>
      <div class="roadmap">
        ${p.hourParts.map((h, i) => `
          <div class="rm-seg pc-${h.key} ${i === expIdx ? "now" : ""}">
            <span class="rm-bar"><i style="width:${(h.done * 100).toFixed(1)}%"></i></span>
            <span class="rm-lbl">${STAGES[i].sub}<em>${stagePeriod(plan, i)}</em>${i === expIdx ? `<b class="rm-now">今の時期</b>` : ""}</span>
          </div>`).join("")}
      </div>
    </div>`;
}

function stageCard(plan) {
  const p = stageProposal(plan);
  const badge = p.gapStages > 0 ? `<span class="status ng">${p.gapStages}段階遅れ</span>`
    : p.gapStages < 0 ? `<span class="status ok">先行中</span>` : `<span class="status ok">時期どおり</span>`;
  const items = p.items;
  const advice = todayAdvice(p);
  return `
    <div class="card" style="margin-bottom:16px">
      <div class="card-head"><h2>あなたの学習段階</h2>${badge}</div>
      <div class="progress-sliders">
        ${PROGRESS_QS.map((q) => {
          const idx = Math.max(0, q.opts.findIndex(([, v]) => v === p.pr[q.key]));
          return `
          <div class="ps-row pc-${q.key}">
            <span class="ps-label">${q.label}${MATERIAL_STAGE[q.key] && q.key !== "past" && liveAffiliates(MATERIAL_STAGE[q.key]).length ? `<button type="button" class="pg-rec" data-rec="${q.key}">おすすめ ›</button>` : ""}</span>
            <div class="ps-track">
              <span class="ps-segs">${q.opts.slice(1).map((_, i) => `<b class="${i < idx ? "on" : ""}"></b>`).join("")}</span>
              <input type="range" min="0" max="${q.opts.length - 1}" step="1" value="${idx}" data-pq="${q.key}" aria-label="${q.label}" aria-valuetext="${q.opts[idx][0]}">
            </div>
            <span class="ps-val" id="ps-${q.key}">${q.opts[idx][0]}</span>
          </div>`;
        }).join("")}
      </div>
      ${todayTaskCard(advice || planTasks(p))}
      ${advice ? "" : `
        <div class="proposal" style="margin-top:12px">
          <p class="pr-today">教材ごとの1日の目安</p>
          <p class="pr-note">過去問は1周目1問5分（解く2分＋解説3分）、2周目から1問3分で計算</p>
          <ul class="pr-items">
            ${items.map((i) => i.future
              ? `<li class="future"><span>${i.name}</span><b>—</b><small>${i.from}から</small></li>`
              : i.skip
                ? `<li class="future"><span>${i.name}</span><b>省略</b><small>時間がないので過去問を優先</small></li>`
              : i.optional
                ? `<li class="future"><span>${i.name}</span><b>余裕があれば</b><small>もう1周</small></li>`
                : `<li><span>${i.name}</span><b>${i.weekly ? i.perDay : `1日${i.perDay}`}</b><small>${i.k === 2 ? `約${fmtMin(i.min)}` : i.weekly ? `1回${MOCK_HOURS}時間・${i.rest}` : i.rest}・${i.by}まで</small></li>`).join("")}
          </ul>
          ${p.tooMuch ? `<span class="pr-alert">全部終えるには1日${fmtMin(p.needMinutes)}必要です。無理のない4時間に収まるよう、宅建業法と苦手な分野を優先した量にしています。</span>` : ""}
        </div>
        <p class="source-note">ドリル画面の「今日の目標」は、過去問${p.pastPerDay || MIN_PER_DAY}問で自動設定しています。</p>`}
    </div>`;
}

// 今日のタスク：アドバイスをチェックできるリストにする。チェックはその日のぶんだけ保存する
const taskKey = (t) => t.replace(/<[^>]+>/g, "").trim();
function todayTaskCard(advice) {
  const doneList = (store.tasks || {})[dayKey()] || [];
  const done = advice.todo.filter((t) => doneList.includes(taskKey(t))).length;
  const n = advice.todo.length;
  return `
    <div class="today-task ${done === n ? "all-done" : ""}" id="today-task" data-n="${n}">
      <div class="tt-head">
        <span class="tt-chip">今日のタスク</span>
        <span class="tt-count"><b id="tt-done">${done}</b> / ${n} 完了</span>
      </div>
      <p class="tt-title">${advice.headline}</p>
      <div class="tt-bar"><i id="tt-bar" style="width:${(done / n) * 100}%"></i></div>
      <ul class="tt-list">
        ${advice.todo.map((t) => {
          const on = doneList.includes(taskKey(t));
          return `<li><label class="tt-item ${on ? "done" : ""}"><input type="checkbox" data-task="${esc(taskKey(t))}" ${on ? "checked" : ""}><span class="tt-check" aria-hidden="true"></span><span class="tt-text">${t}</span></label></li>`;
        }).join("")}
      </ul>
      <p class="tt-cheer">今日のタスクはすべて完了！この調子でいこう</p>
    </div>`;
}

function renderSchedule() {
  setNav("schedule");
  // 古い形式の計画（時間だけ）は作り直す
  if (!store.plan || !store.plan.basis) { store.plan = makePlan(defaultExamDate(), "time", 60); save(); }
  const plan = store.plan;
  const exam = new Date(plan.exam + "T00:00:00");
  const { left } = examInfo();
  const thisYear = new Date().getFullYear();
  const years = [thisYear, thisYear + 1].map(examDateFor).filter((d) => new Date(d + "T23:59:59") >= new Date());

  view.innerHTML = `
    <div class="sched-head">
      <h1>合格スケジュール</h1>
      ${years.length > 1 ? `<span class="year-pick">${years.map((y) => `<button data-exam="${y}" class="${y === plan.exam ? "on" : ""}">${y.slice(0, 4)}年</button>`).join("")}</span>` : ""}
    </div>
    ${liveAffiliates().length ? `<p class="pr-notice">このページには広告（PR）が含まれます。<button class="link-inline" data-go="aff-policy">くわしく</button></p>` : ""}

    <div class="sched-top">
      ${stageRoadmap(plan)}
      <div class="countdown ${urgencyClass(left)}">
        <span class="cd-date">本試験 <br>${exam.getMonth() + 1}/${exam.getDate()}（日）</span>
        <div class="days">あと<b>${left}</b>日</div>
      </div>
    </div>

    ${stageCard(plan)}

    ${affiliateCard(stageProposal(plan))}`;

  // 今日のタスクのチェック。描き直さずに、その場で数と見た目だけ変える
  view.querySelectorAll("[data-task]").forEach((c) => c.addEventListener("change", () => {
    const day = dayKey();
    const list = new Set(((store.tasks || {})[day]) || []);
    c.checked ? list.add(c.dataset.task) : list.delete(c.dataset.task);
    store.tasks = { [day]: [...list] }; // 前の日のぶんは残さない
    save();
    c.closest(".tt-item").classList.toggle("done", c.checked);
    const card = view.querySelector("#today-task");
    const n = Number(card.dataset.n);
    const done = card.querySelectorAll("[data-task]:checked").length;
    card.querySelector("#tt-done").textContent = done;
    card.querySelector("#tt-bar").style.width = `${(done / n) * 100}%`;
    card.classList.toggle("all-done", done === n);
  }));

  // スライダー：動かしている間は値の表示だけ変え、指を離したら計画を計算し直す
  view.querySelectorAll("input[data-pq]").forEach((r) => {
    const q = PROGRESS_QS.find((x) => x.key === r.dataset.pq);
    r.addEventListener("input", () => {
      const [text] = q.opts[Number(r.value)];
      view.querySelector(`#ps-${q.key}`).textContent = text;
      const track = r.closest(".ps-track");
      track.querySelectorAll(".ps-segs b").forEach((b, i) => b.classList.toggle("on", i < Number(r.value)));
    });
    r.addEventListener("change", () => {
      store.plan.progress = { ...(store.plan.progress || {}), [q.key]: q.opts[Number(r.value)][1] };
      save(); renderScheduleKeepScroll();
    });
  });
  view.querySelectorAll("[data-rec]").forEach((b) => b.addEventListener("click", (e) => {
    e.preventDefault(); // ラベルの中のボタンなので、セレクトが開かないようにする
    openMaterialRecs(b.dataset.rec);
  }));
  view.querySelectorAll("[data-exam]").forEach((b) => b.addEventListener("click", () => {
    store.plan = makePlan(b.dataset.exam, plan.basis, plan.value); save(); renderSchedule();
  }));
}

// ---------- 宅建コラム（ページの下の読みものの枠） ----------
// 種類ごとのタブで切り替え、選んだ種類を6本まで、イラストのカードで並べる（columns.js は tools/build_pages.py が作る）
const COL_TABS = [["試験の情報", "info"], ["資格の基本", "kiso"], ["勉強法", "study"], ["教材・講座", "kyozai"], ["論点まとめ", "ronten"], ["合格後", "after"]];
function renderColumns(group = COL_TABS[0][0]) {
  const list = window.COLUMNS || [];
  if (!list.length) return;
  const cls = Object.fromEntries(COL_TABS)[group];
  const mine = list.filter((c) => c.group === group);
  const tabs = document.getElementById("col-tabs");
  tabs.innerHTML = COL_TABS.map(([g]) => `
    <button type="button" role="tab" aria-selected="${g === group}" data-group="${g}">${g}<small>${list.filter((c) => c.group === g).length}</small></button>`).join("");
  tabs.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    renderColumns(b.dataset.group);
    document.querySelector(`#col-tabs [aria-selected="true"]`).focus();
  }));
  const cards = document.getElementById("col-cards");
  cards.innerHTML = mine.slice(0, 6).map((c) => `
    <a class="col-card" href="/articles/${c.slug}/">
      <img src="https://takken-drill.com/articles/${c.slug}/cover.svg" alt="" width="320" height="180" loading="lazy">
      <span><em><b class="${cls}">${esc(c.group)}</b>約${c.min}分で読めます</em><strong>${esc(c.title)}</strong></span>
    </a>`).join("");
  cards.scrollLeft = 0;
  const all = document.getElementById("col-all");
  all.href = `/articles/#${cls}`;
  all.textContent = "もっと見る ›";
  document.getElementById("columns").hidden = false;
}

// コラムなどから「戻る」で帰ってきたときは、前に開いていた画面を開き直す
if (!routeHash()) (VIEWS[(history.state || {}).view] || VIEWS.home)();
renderColumns();
cloudStart();

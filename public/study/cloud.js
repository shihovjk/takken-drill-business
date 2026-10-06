// Supabase：Googleでのログインと、学習の記録をアカウントに保存する処理
// config.js に接続情報がないときは何もしない（試作の動きのまま）

const CLOUD = (() => {
  const cfg = window.TAKKEN_CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase) return null;
  return window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
})();
const cloudReady = () => !!CLOUD;
const AFTER_LOGIN_KEY = "takken-after-login"; // Googleの画面から戻ってきたときに開く画面
let cloudUserId = null;
let pushTimer = null;

// Googleのログイン画面へ移る。戻ってきたら cloudStart() で続きを行う
async function cloudSignIn(returnTo) {
  localStorage.setItem(AFTER_LOGIN_KEY, returnTo);
  const { error } = await CLOUD.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: location.origin + location.pathname },
  });
  if (error) { localStorage.removeItem(AFTER_LOGIN_KEY); toast("ログインを始められませんでした。時間をおいてもう一度お試しください"); }
}

async function cloudSignOut() {
  await cloudPush(); // ログアウトする前に、まだ送っていない記録を送る
  cloudUserId = null;
  if (CLOUD) await CLOUD.auth.signOut();
}

// 記録が変わるたびに呼ばれる。続けて解いているあいだは送らず、少し止まったらまとめて送る
function cloudSave() {
  if (!cloudUserId) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(cloudPush, 1500);
}

async function cloudPush() {
  clearTimeout(pushTimer);
  pushTimer = null;
  if (!cloudUserId) return;
  const { error } = await CLOUD.from("progress").upsert({ user_id: cloudUserId, data: syncable(store), updated_at: new Date().toISOString() });
  if (error) console.warn("記録を保存できませんでした", error.message);
}
// 画面を閉じたり別のアプリに切り替えたりしたときは、待たずに送る
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && pushTimer) cloudPush(); });

// アカウントに保存しないもの：ログイン状態と、会員の状態（会員は決済の記録をもとにサーバー側で決める）
function syncable(s) {
  const { user, member, ...rest } = s;
  return rest;
}

// 模試の結果は、両方の端末の受験をすべて残す（同じ受験は採点した時刻で見分ける）
function mergeMockResults(x = {}, y = {}) {
  const r = {};
  for (const id of new Set([...Object.keys(x), ...Object.keys(y)])) {
    const seen = new Map();
    [...(x[id] || []), ...(y[id] || [])].forEach((a) => seen.set(a.at, a));
    r[id] = [...seen.values()].sort((a, b) => a.at - b.at).slice(-10);
  }
  return r;
}

// この端末の記録とアカウントの記録をまとめる。同じ問題の記録は、最後に解いた方を使う
function mergeStore(local, remote) {
  const maxMap = (x = {}, y = {}) => { const r = { ...x }; for (const k in y) r[k] = Math.max(r[k] || 0, y[k] || 0); return r; };
  const pick = (x = {}, y = {}, score) => { const r = { ...x }; for (const k in y) if (!r[k] || score(y[k]) > score(r[k])) r[k] = y[k]; return r; };
  const today = dayKey();
  return {
    ...remote,
    ...local,
    items: pick(local.items, remote.items, (it) => it.last || 0),
    cats: pick(local.cats, remote.cats, (c) => (c.right || 0) + (c.wrong || 0)),
    speed: {
      four: pick(local.speed?.four, remote.speed?.four, (r) => r.n || 0),
      ox: pick(local.speed?.ox, remote.speed?.ox, (r) => r.n || 0),
    },
    daily: maxMap(local.daily, remote.daily),
    reviewed: maxMap(local.reviewed, remote.reviewed),
    overcome: maxMap(local.overcome, remote.overcome),
    qCount: maxMap(local.qCount, remote.qCount),
    oxCount: maxMap(local.oxCount, remote.oxCount),
    affClicks: maxMap(local.affClicks, remote.affClicks),
    memos: { ...remote.memos, ...local.memos },
    plan: remote.plan || local.plan, // 学習計画は、先に使っていた端末の設定を残す
    paused: local.paused || remote.paused, // 別の端末で中断したドリルも続きから再開できる
    mockRun: local.mockRun || remote.mockRun, // 模試の途中も同じ
    mockResults: mergeMockResults(local.mockResults, remote.mockResults),
    tasks: { [today]: [...new Set([...((local.tasks || {})[today] || []), ...((remote.tasks || {})[today] || [])])] },
    user: local.user,
    member: local.member,
  };
}

// ページを開いたときに呼ぶ。ログイン中なら、アカウントの記録を読み込んでこの端末の記録とまとめる
async function cloudStart() {
  if (!CLOUD) return;
  const { data: { session } } = await CLOUD.auth.getSession();
  // Googleから戻ってきたときの ?code=…、決済画面から戻ってきたときの ?checkout=… をアドレスから消す
  const checkout = new URLSearchParams(location.search).get("checkout");
  if (location.search.includes("code=") || checkout) history.replaceState(null, "", location.pathname + location.hash);
  const returnTo = localStorage.getItem(AFTER_LOGIN_KEY);
  localStorage.removeItem(AFTER_LOGIN_KEY);
  if (!session) {
    // 別の端末でログアウトした、期限が切れた など。決済を使うときは、ログインしていなければ会員でもない
    if (store.user || (billingReady() && store.member)) { store.user = null; if (billingReady()) store.member = null; save(); renderAccount(); }
    return;
  }
  const u = session.user;
  cloudUserId = u.id;
  store.user = { name: u.user_metadata?.full_name || u.email, email: u.email, via: "google", id: u.id };
  const { data: row, error } = await CLOUD.from("progress").select("data").eq("user_id", u.id).maybeSingle();
  if (error) console.warn("記録を読み込めませんでした", error.message);
  else if (row?.data) store = mergeStore(store, row.data);
  save(); // まとめた記録をこの端末とアカウントの両方に保存する
  await cloudLoadMember();
  if (checkout && billingReady()) return finishCheckout(checkout);
  if (returnTo) return finishLogin(returnTo);
  renderAccount();
  if (!document.body.classList.contains("in-drill") && !hashPage()) renderHome();
}

// ---------- 会員プラン（Stripe） ----------
// 会員かどうかは、Stripe からの知らせをもとにサーバー側で書いた memberships テーブルで決める（この端末では書き換えない）
const billingReady = () => !!CLOUD && !!(window.TAKKEN_CONFIG || {}).stripeReady;

// アカウントの会員情報を読み、画面で使う形（store.member）にする。会員でなければ null
async function cloudLoadMember() {
  if (!billingReady() || !cloudUserId) return;
  const { data: row, error } = await CLOUD.from("memberships").select("*").eq("user_id", cloudUserId).maybeSingle();
  if (error) return console.warn("会員の情報を読み込めませんでした", error.message);
  const ok = row?.status === "active" && row.period_end && new Date(row.period_end) > new Date();
  if (!ok) store.member = null;
  else if (row.plan === "exam") store.member = { plan: "exam", since: row.since, until: dayKey(new Date(row.period_end).getTime()) };
  else {
    const renews = dayKey(new Date(row.period_end).getTime());
    store.member = { plan: "monthly", since: row.since, renews, ...(row.cancel_at_period_end ? { canceled: true, until: lastDayBefore(renews) } : {}) };
  }
  save();
}

// Edge Function「billing」を呼ぶ（checkout・cancel・resume・portal）
async function billingCall(action, extra = {}) {
  const { data: { session } } = await CLOUD.auth.getSession();
  const { data, error } = await CLOUD.functions.invoke("billing", {
    body: { action, ...extra },
    headers: session ? { Authorization: `Bearer ${session.access_token}` } : {},
  });
  if (error) throw error;
  return data;
}

// 決済画面から戻ってきたとき（?checkout=success / cancel）。支払いの知らせが届くまで少し待ってから会員の画面を出す
async function finishCheckout(result) {
  if (result === "cancel") { toast("お申し込みを取りやめました"); return renderPlans(); }
  toast("お支払いを確認しています…");
  for (let i = 0; i < 10 && !store.member; i++) {
    await cloudLoadMember();
    if (!store.member) await new Promise((r) => setTimeout(r, 1500));
  }
  toast(store.member ? "会員プランに登録しました。ありがとうございます" : "お支払いの確認に時間がかかっています。少したってから開き直してください");
  store.member ? renderAccountPage() : renderPlans();
}

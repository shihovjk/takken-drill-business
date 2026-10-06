// サイトの一番下からリンクする案内・法務のページ（利用規約、プライバシーポリシー、特商法の表記、よくある質問、お問い合わせ、アプリとして使う）
// 公開前に専門家の確認を受けること

// 運営者の情報（特商法の表記・お問い合わせで使う）
// 個人で運営するため、住所は特商法第11条のただし書きにもとづき表示を省略し、請求があれば開示する。電話番号は事業用の050番号を表示する
const OPERATOR = {
  name: "宅建過去問ドリル 運営者",
  owner: "川喜多 史帆", // 販売事業者（個人事業者の氏名）・運営責任者
  disclose: "請求があった場合には遅滞なく開示いたします",
  email: "support@takken-drill.com",
  phone: "050-6870-5742", // 事業用（My 050）。Stripe の「サポート部門の電話番号」と同じ
};
const LEGAL_UPDATED = "2026年10月6日";

// 各ページの共通の枠：戻るリンク、見出し、本文、最終更新日
function legalPage(title, body, { updated = true } = {}) {
  setNav("");
  view.innerHTML = `
    <button class="back-link" data-go="home">‹ ドリルに戻る</button>
    <h1>${title}</h1>
    <div class="card legal">
      ${body}
      ${updated ? `<p class="source-note">最終更新日：${LEGAL_UPDATED}</p>` : ""}
    </div>`;
}

function renderTerms() {
  legalPage("このサイトの利用について", `
    <p>宅建過去問ドリル（以下「当サイト」）をご利用いただく前に、以下をお読みください。当サイトを利用した時点で、この内容に同意したものとみなします。</p>
    <h2>1. サービスの内容</h2>
    <p>当サイトは、宅地建物取引士試験の学習のために、問題演習・復習・学習計画・成績の記録を提供します。問題演習と復習は無料で使えます。合格ペース診断・解答スピードの分析・本番形式の模試などは、有料の会員プランで使えます。</p>
    <h2>2. アカウント</h2>
    <p>Googleアカウントでログインすると、学習の記録をアカウントに保存し、複数の端末で使えます。ログインしない場合、記録はお使いの端末（ブラウザ）にだけ保存され、ブラウザのデータを消すと失われます。アカウントの管理は、ご自身の責任で行ってください。</p>
    <h2>3. 会員プランと支払い</h2>
    <p>料金・支払方法・解約・返金は<button class="link-inline" data-go="tokushoho">特定商取引法に基づく表記</button>のとおりです。</p>
    <h2>4. 禁止事項</h2>
    <ul>
      <li>問題・解説・画面などの内容を、許可なく複製・転載・販売すること</li>
      <li>自動化された手段で大量にアクセスし、内容を取得すること</li>
      <li>サーバーに過度な負荷をかける行為や、運営を妨げる行為</li>
      <li>他人のアカウントを使うこと、法令や公序良俗に反する行為</li>
    </ul>
    <h2>5. 問題と解説について</h2>
    <p>問題と解説は、作成時点の法令にもとづいています。正確さには注意していますが、内容の完全さや、試験の合格を保証するものではありません。法改正により内容が古くなる場合があります。過去問は一般財団法人 不動産適正取引推進機構が実施した試験の問題ですが、法改正により現在の法律と一致しない場合があります。過去問の正解や解説についてのお問い合わせは、機構ではなく当サイトにお寄せください（機構では試験問題及び解答内容に関するお問合せには一切お答えしていません）。誤りに気づいた場合は<button class="link-inline" data-go="contact">お問い合わせ</button>からお知らせください。</p>
    <h2>6. 広告と紹介</h2>
    <p>当サイトには広告と、アフィリエイトプログラムを利用した教材などの紹介が含まれます。詳しくは<button class="link-inline" data-go="aff-policy">アフィリエイトについて</button>をご覧ください。</p>
    <h2>7. サービスの変更・停止</h2>
    <p>内容の追加・変更や、保守・障害のためにサービスを一時的に止めることがあります。やむを得ない場合は、事前にお知らせしたうえでサービスを終了することがあります。</p>
    <h2>8. 免責</h2>
    <p>当サイトの利用によって生じた損害について、運営者に故意または重大な過失がある場合を除き、責任を負いません。</p>
    <h2>9. この内容の変更</h2>
    <p>この内容を変更する場合は、当サイト上でお知らせします。変更後に利用を続けた場合、変更に同意したものとみなします。</p>
    <h2>10. 準拠法と管轄</h2>
    <p>この内容は日本の法律にもとづいて解釈します。当サイトに関する紛争は、東京地方裁判所を第一審の専属的合意管轄裁判所とします。</p>`);
}

function renderPrivacy() {
  legalPage("プライバシーポリシー", `
    <p>宅建過去問ドリル（以下「当サイト」）は、利用者の情報を次のとおり取り扱います。</p>
    <h2>1. 集める情報</h2>
    <ul>
      <li><b>学習の記録</b>：解いた問題、正解・不正解、復習の予定、解答にかかった時間、学習計画の設定など</li>
      <li><b>アカウントの情報</b>：Googleでログインした場合の、メールアドレス・名前と、Googleから受け取る利用者を識別するための情報</li>
      <li><b>支払いの情報</b>：会員プランの申込状況。クレジットカードの番号は決済代行会社が管理し、当サイトでは保存しません</li>
      <li><b>お問い合わせの内容</b>：お名前、メールアドレス、お問い合わせの本文</li>
      <li><b>アクセスの情報</b>：閲覧したページ、端末やブラウザの種類など</li>
    </ul>
    <h2>2. 使う目的</h2>
    <ul>
      <li>学習の記録を保存し、復習や学習計画を表示するため</li>
      <li>ログインした端末どうしで記録を共有するため</li>
      <li>会員プランの提供と、料金の請求のため</li>
      <li>お問い合わせに回答するため</li>
      <li>サービスの改善と、不正な利用を防ぐため</li>
    </ul>
    <h2>3. ログインしない場合の保存先</h2>
    <p>ログインしない場合、学習の記録はお使いのブラウザ（端末内）にだけ保存され、当サイトのサーバーには送りません。</p>
    <h2>4. 外部のサービス</h2>
    <p>当サイトは次の外部サービスを利用し、必要な範囲で情報を預けます。</p>
    <ul>
      <li>ログイン：Google</li>
      <li>サイトの配信：Cloudflare, Inc.</li>
      <li>データの保存・ログイン：Supabase, Inc.</li>
      <li>決済：Stripe, Inc.</li>
      <li>広告の配信：Google LLC（Google AdSense）</li>
      <li>アフィリエイト：紹介リンク先の教材・講座の提供会社と、各アフィリエイトサービス</li>
    </ul>
    <h2>5. 広告とクッキー</h2>
    <p>当サイトは広告の配信やアクセス解析のため、クッキーなどを使う場合があります。クッキーはブラウザの設定で無効にできます。アフィリエイトの紹介リンクを押したかどうかは、紹介の改善のために数えています。</p>
    <p>対象の地域が決まっている紹介を出し分けるため、接続元のおおよその地域（都道府県）を、IPアドレスから推定して使うことがあります。IPアドレスそのものは保存しません。</p>
    <p>当サイトは、第三者配信の広告サービス「Google AdSense」を利用しています。Google などの広告配信事業者は、クッキーを使って、利用者が当サイトやほかのサイトを以前に見たときの情報にもとづいた広告を表示します。こうした広告（パーソナライズ広告）は、Google の<a href="https://adssettings.google.com/" target="_blank" rel="noopener">広告設定</a>で無効にできます。Google が情報をどう使うかは、<a href="https://policies.google.com/technologies/partner-sites?hl=ja" target="_blank" rel="noopener">Google のサービスを使用するサイトやアプリから収集した情報の Google による使用</a>をご覧ください。</p>
    <h2>6. 第三者への提供</h2>
    <p>法令にもとづく場合を除き、ご本人の同意なく個人情報を第三者に提供しません。</p>
    <h2>7. 開示・訂正・削除</h2>
    <p>ご自身の情報の開示・訂正・削除や、アカウントの削除を希望する場合は、<button class="link-inline" data-go="contact">お問い合わせ</button>からご連絡ください。ご本人であることを確認したうえで対応します。</p>
    <h2>8. 安全管理</h2>
    <p>情報の漏えい・紛失を防ぐため、通信の暗号化やアクセスの制限など、必要な対策を行います。</p>
    <h2>9. 変更</h2>
    <p>この内容を変更する場合は、当サイト上でお知らせします。</p>
    <h2>10. お問い合わせ先</h2>
    <p>${OPERATOR.name}<br>${OPERATOR.email}</p>`);
}

function renderTokushoho() {
  const rows = [
    ["販売事業者", OPERATOR.owner],
    ["運営責任者", `${OPERATOR.owner}（宅地建物取引士。<a href="/about/">運営者・執筆者のプロフィール</a>）`],
    ["所在地", OPERATOR.disclose],
    ["電話番号", `${OPERATOR.phone}<br>お問い合わせは、なるべくメールまたは<button class="link-inline" data-go="contact">お問い合わせフォーム</button>からお願いします`],
    ["メールアドレス", `<a href="mailto:${OPERATOR.email}">${OPERATOR.email}</a>`],
    ["販売価格", `月額プラン：${PLANS[0].price.toLocaleString()}円 / 月<br>試験までプラン：${PLANS[1].price.toLocaleString()}円（一括）<br>表示価格はすべて税込みです`],
    ["商品代金以外の必要料金", "インターネットの通信料はお客様のご負担です"],
    ["支払方法", "クレジットカード"],
    ["支払時期", "月額プラン：申込時に初月分、以後は毎月の更新日に請求します<br>試験までプラン：申込時に一括で請求します"],
    ["提供時期", "お支払いの手続きが終わった直後から使えます"],
    ["解約", "月額プランは、<button class='link-inline' data-go='account'>マイページ</button>の「会員プラン」からいつでも解約できます。解約後も、支払い済みの期間の終わりまで使えます。試験までプランは、本試験の日まで使えます"],
    ["返金", "申込から7日以内であれば、理由を問わず全額を返金します（返金保証）。お問い合わせからお申し出ください。7日を過ぎた後は、デジタルサービスの性質上、返金には応じられません"],
    ["動作環境", "最新版の Chrome・Safari・Edge・Firefox（スマホ・PC）"],
  ];
  legalPage("特定商取引法に基づく表記", `
    <table class="legal-table">
      ${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("")}
    </table>
    <p class="source-note">所在地の開示をご希望の場合は、${OPERATOR.email} までご連絡ください。</p>`);
}

const FAQ = [
  ["無料でどこまで使えますか？", "過去問の演習（4択・一問一答）、ひっかけポイントまで分かる解説、間違えた問題の復習、合格スケジュール、成績は無料で使えます。合格ペース診断、解答スピードの分析、本番形式の模試は会員プランの機能です。"],
  ["ログインしないと使えませんか？", "ログインしなくても使えます。記録はお使いのブラウザに保存されます。ブラウザのデータを消したり機種変更したりすると記録が消えるので、続けて使う場合はログインをおすすめします。"],
  ["スマホとPCで同じ記録を使えますか？", "Googleアカウントでログインすると、どの端末からでも同じ記録で続きを解けます。"],
  ["問題は本物の過去問ですか？", "はい。令和5〜7年度の宅建試験の問題は、一般財団法人 不動産適正取引推進機構が実施した試験の過去問です（出典は各問題の下に表示しています）。解説は当サイト独自のものです。過去問の正解は法改正により現在の法律と一致しない場合があり、機構では試験問題や解答内容についての問い合わせには一切答えていません。内容の誤りは当サイトのお問い合わせからお知らせください。"],
  ["法改正には対応していますか？", "問題と解説は作成時点の法令にもとづいています。法改正があった場合は、順次見直します。誤りに気づいた場合はお問い合わせからお知らせください。"],
  ["一問一答と4択はどう違いますか？", "4択は本試験と同じ形式で、1問を2分で解くのが目安です。一問一答は4択の選択肢を1つずつ○×で答える形式で、スキマ時間にテンポよく解けます。"],
  ["間違えた問題はいつ復習に出てきますか？", "間違えた選択肢は翌日の復習に入ります。正解するたびに、次の復習が1→3→7→14→30日後と伸びていきます。"],
  ["会員プランはいつでも解約できますか？", "月額プランは、<button class='link-inline' data-go='account'>マイページ</button>の「会員プラン」からいつでも解約できます。支払い済みの期間の終わりまで使えます。申込から7日以内なら全額を返金します。"],
  ["アプリはありますか？", "専用のアプリはありませんが、ホーム画面に追加するとアプリと同じように使えます。「アプリとして使う」のページで手順を紹介しています。"],
];

function renderFaq() {
  legalPage("よくある質問", `
    <div class="faq">
      ${FAQ.map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join("")}
    </div>
    <p class="source-note">ここにない質問は、<button class="link-inline" data-go="contact">お問い合わせ</button>からどうぞ。</p>`, { updated: false });
}

function renderContact() {
  legalPage("お問い合わせ", `
    <p style="margin-top:0">サービスについてのご質問、問題や解説の誤り、会員プランの解約・返金のご相談は、こちらからどうぞ。よくある質問は<button class="link-inline" data-go="faq">こちら</button>にまとめています。</p>
    <form class="form-grid" id="contact-form">
      ${honeypot()}
      <label>お名前<span class="req">必須</span><input name="name" required autocomplete="name"></label>
      <label>メールアドレス<span class="req">必須</span><input name="email" type="email" required autocomplete="email"></label>
      <label>お問い合わせの種類
        <select name="type"><option>サービスについて</option><option>問題・解説の誤り</option><option>会員プラン・支払い</option><option>アカウント・記録の削除</option><option>その他</option></select>
      </label>
      <label>内容<span class="req">必須</span><textarea name="message" required placeholder="問題の誤りの場合は、分野と問題文の一部を書いてください"></textarea></label>
      <button class="btn btn-primary btn-block" type="submit">送信する</button>
      <p class="source-note" style="margin:0">送信すると、<button class="link-inline" data-go="privacy">プライバシーポリシー</button>に同意したものとみなします。メールで直接送る場合は <a href="mailto:${OPERATOR.email}">${OPERATOR.email}</a> へどうぞ。${cloudReady() ? "" : "試作版のため、送信しても実際には送られません。"}</p>
    </form>`, { updated: false });
  view.querySelector("#contact-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    submitInquiry(f, { kind: "お問い合わせ", name: f.elements.name.value, email: f.elements.email.value, topic: f.elements.type.value, message: f.elements.message.value, website: f.elements.website.value },
      (html) => { view.querySelector(".legal").innerHTML = html; }, "3営業日");
  });
}

// ---------- お問い合わせの送信 ----------
// Supabase の Edge Function「contact」に送り、内容の保存と support@ へのメールを行う（リポジトリの supabase/functions/contact）
// 人には見えない欄。自動で何でも入力するロボットだけが埋めるので、埋まっていたら迷惑な送信とみなす
const honeypot = () => `<label class="hp" aria-hidden="true">ウェブサイト<input name="website" tabindex="-1" autocomplete="off"></label>`;

async function submitInquiry(form, data, done, days) {
  const btn = form.querySelector('[type="submit"]');
  const thanks = `<h2 style="margin-top:0">お問い合わせありがとうございます</h2><p style="margin:0">内容を確認のうえ、${days}以内に ${esc(data.email)} へメールでご連絡します。</p>`;
  if (!cloudReady()) return done(`${thanks}<p class="source-note">試作版のため、実際には送信されていません。</p>`);
  btn.disabled = true;
  btn.textContent = "送信しています…";
  const { error } = await CLOUD.functions.invoke("contact", { body: data });
  if (!error) return done(thanks);
  btn.disabled = false;
  btn.textContent = "もう一度送信する";
  form.querySelector(".form-error")?.remove();
  btn.insertAdjacentHTML("afterend", `<p class="form-error">送信できませんでした。時間をおいてもう一度お試しいただくか、<a href="mailto:${OPERATOR.email}">${OPERATOR.email}</a> へ直接メールでお送りください。</p>`);
}

// 案内・法務のページは、アドレスの末尾（#privacy など）で直接開けるようにする。
// Googleのログイン設定にプライバシーポリシーのアドレスを登録したり、リンクを共有したりするため
const HASH_PAGES = {
  terms: () => renderTerms(),
  privacy: () => renderPrivacy(),
  tokushoho: () => renderTokushoho(),
  faq: () => renderFaq(),
  contact: () => renderContact(),
  install: () => renderInstall(),
  "aff-policy": () => renderAffPolicy(),
};
const hashPage = () => HASH_PAGES[location.hash.slice(1)] ? location.hash.slice(1) : null;
function routeHash() {
  const key = hashPage();
  if (key) HASH_PAGES[key]();
  return !!key;
}
window.addEventListener("hashchange", routeHash);

// ホーム画面に追加してアプリのように使う（PWA）。Android・PCのChromeなどは、その場でインストールできる
let installPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; });

function renderInstall() {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  legalPage("アプリとして使う", `
    <p style="margin-top:0">宅建過去問ドリルは、ホーム画面に追加するとアプリと同じように使えます。アプリストアからのダウンロードは不要です。</p>
    <ul>
      <li>ホーム画面のアイコンから、すぐに開ける</li>
      <li>画面いっぱいに表示され、問題に集中できる</li>
      <li>電波の弱い場所でも、一度開いた画面は表示できる</li>
    </ul>
    ${standalone ? `<p class="install-done">いまアプリとして開いています。</p>` : `
      ${installPrompt ? `<button class="btn btn-primary btn-block" id="install-btn">ホーム画面に追加する</button>` : ""}
      <h2>iPhone・iPad（Safari）</h2>
      <ol>
        <li>画面下（iPadは上）の共有ボタン（四角から矢印が出たアイコン）を押す</li>
        <li>「ホーム画面に追加」を選ぶ</li>
        <li>右上の「追加」を押す</li>
      </ol>
      <h2>Android（Chrome）</h2>
      <ol>
        <li>右上の︙（メニュー）を押す</li>
        <li>「ホーム画面に追加」または「アプリをインストール」を選ぶ</li>
      </ol>
      <h2>PC（Chrome・Edge）</h2>
      <ol>
        <li>アドレスバーの右にあるインストールのアイコンを押す</li>
        <li>「インストール」を選ぶ</li>
      </ol>`}`, { updated: false });
  view.querySelector("#install-btn")?.addEventListener("click", async () => {
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    renderInstall();
  });
}

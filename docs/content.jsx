/* global React, Copyable, CodeBlock, Callout, Pitfall, StepSection, Section, FaqItem, LoginCheckGrid, StepImage */

// Helpers
const M = ({ children }) => <code>{children}</code>; // menu / inline code

// Step 0
function Step0({ done, onToggle }) {
  const loginCards = [
    {
      href: "https://accounts.google.com",
      badge: "G",
      badgeBg: "linear-gradient(135deg,#ea4335 0%,#fbbc04 50%,#34a853 100%)",
      title: "Googleアカウント",
      sub: "スプシ・Drive 用 / 個人・業務どちらでもOK",
    },
    {
      href: "https://www.instagram.com/",
      badge: "IG",
      badgeBg: "linear-gradient(135deg,#feda75 0%,#fa7e1e 30%,#d62976 60%,#962fbf 90%,#4f5bd5 100%)",
      title: "Instagramアカウント",
      sub: "ビジネス／クリエイター必須(個人アカウント不可)",
    },
    {
      href: "https://www.facebook.com/",
      badge: "f",
      badgeBg: "#1877F2",
      title: "Facebookアカウント",
      sub: "Meta Developer 登録 + IG ビジネス連携用",
    },
    {
      href: "https://discord.com/login",
      badge: "D",
      badgeBg: "#5865F2",
      title: "Discordアカウント",
      sub: "個別サポート部屋のログイン確認(サーバー作成不要・こちらで用意)",
    },
    {
      badge: "TEL",
      badgeBg: "var(--mint, #2ea882)",
      title: "電話番号(SMS受信可)",
      sub: "Facebook連携必須・IP電話/050不可",
    },
  ];
  return (
    <StepSection id="step-0" num="00" title="進め方・必要なもの" subtitle="まず全体像とゴールの確認・ログイン確認"
      done={done} onToggleDone={onToggle} completeLabel="準備が整ったらチェック">
      <h3>この手順書について</h3>
      <ul>
        <li><strong>Step 1 から順番</strong>に進めればOK</li>
        <li>完了まで <strong>最短30分程度</strong></li>
        <li>詰まったら購入後の Discord <strong>あなた専用の相談部屋</strong> で質問可能（入室と同時に自動作成）</li>
      </ul>

      <h3>ログイン環境の確認</h3>
      <ul>
        <li>下のカードをクリックして、各アカウントにログイン済みか確認</li>
        <li>ログインしたタブは<strong>そのまま開いておく</strong>（後で使う）</li>
      </ul>
      <LoginCheckGrid cards={loginCards} />
      <Callout kind="info">
        <p><strong>新しいタブが開かない場合（Windows・特定ブラウザ）</strong>：カードをクリックしても新タブが開かないことがあります。その場合は<strong>右クリック→「新しいタブで開く」</strong>か、URLバーに直接URLを貼り付けてください。Googleでログイン中にInstagramカードを押した時に特に発生しやすいです。</p>
      </Callout>

      <Callout kind="warn">
        <p>
          電話番号は <strong>Facebookアカウントと連携している番号</strong> をご用意ください。
          Step 2 の Meta 開発者登録で、SMS による本人認証がこの番号宛に届く場合があります(IP電話・050番号は不可)。
        </p>
      </Callout>
    </StepSection>
  );
}

function Step1({ done, onToggle }) {
  return (
    <StepSection id="step-1" num="01" title="マスタースプレッドシートをコピー" subtitle="所要 約2分"
      done={done} onToggleDone={onToggle}>
      <ol>
        <li><a href="https://docs.google.com/spreadsheets/d/1GLuLebQH6z8hpEzODAucqhOkCzUVKG2OMaZOnA2Uy5c/copy" target="_blank" rel="noreferrer">マスタースプシのコピーURL</a> を開く</li>
        <li>「コピーを作成」をクリック</li>
      </ol>
      <StepImage slot="1-A" src="images/setup-guide/spreadsheet-setup/01-copy-document.png" alt="Google Sheetsのドキュメントのコピー画面（「コピーを作成」ボタン）" />
      <ol start="3">
        <li>複製されたスプシを開く</li>
        <li>「アクセスを許可」をクリック</li>
      </ol>
      <StepImage slot="1-B" src="images/setup-guide/spreadsheet-setup/02-grant-access.png" alt="複製直後のスプシで表示される「アクセスを許可」ダイアログ" />
      <ol start="5">
        <li>メニュー <Copyable>📊 Instagram Insights → 🔧 初回セットアップ（シート作成）</Copyable> を実行</li>
      </ol>
      <StepImage slot="1-C" alt="スプシ上部メニュー「📊 Instagram Insights → 🔧 初回セットアップ」を展開した状態" />
      <ol start="6">
        <li>初回のみ権限承認ダイアログが出る →「許可」</li>
      </ol>
      <StepImage slot="1-D" alt="権限承認ダイアログの「許可」ボタンを赤枠で示したスクショ" />
    </StepSection>
  );
}

function Step2({ done, onToggle }) {
  return (
    <StepSection id="step-2" num="02" title="Meta Developer 登録 + アプリ作成（ユースケース含む）" subtitle="所要 約10分（SMS認証で +5分）"
      done={done} onToggleDone={onToggle}>
      <Callout kind="info">
        <p><strong>5ステップウィザード</strong>：アプリの詳細 → ユースケース → ビジネス → 要件 → 概要。本Stepで全部を通しで完了させます。</p>
      </Callout>
      <ol>
        <li><a href="https://developers.facebook.com" target="_blank" rel="noreferrer">developers.facebook.com</a> にFacebookでログイン</li>
        <li>右上「マイアプリ」→「アプリを作成」</li>
      </ol>
      <StepImage slot="2-A" src="images/setup-guide/meta-developers-signup/05-myapps-empty.png" alt="マイアプリ画面（初回はアプリ未作成状態）" />

      <h3>2-1. アプリの詳細（ステップ1）</h3>
      <ol>
        <li>アプリ名（例: <Copyable>insights-自分の名前</Copyable>）と連絡先メールを入力</li>
        <li>「次へ」</li>
      </ol>

      <h3>2-2. ユースケース選択（ステップ2）</h3>
      <ol>
        <li>左フィルターで「<strong>コンテンツ管理 (5)</strong>」を選択</li>
        <li>「<strong>Instagramでメッセージとコンテンツを管理</strong>」にチェック</li>
        <li>右下「<strong>次へ</strong>」をクリック</li>
      </ol>
      <StepImage slot="2-D" src="images/setup-guide/app-permissions/05-content-mgmt-instagram-selected.png" alt="コンテンツ管理タブで「Instagramでメッセージとコンテンツを管理」をチェック済みの状態" />
      <Callout kind="info">
        <p><strong>このユースケースで入る権限</strong>：<code>instagram_basic</code> / <code>instagram_manage_insights</code> 等の Instagram 系。残る <code>pages_read_engagement</code> / <code>pages_show_list</code> / <code>business_management</code> は Step 3 で追加します。</p>
      </Callout>
      <Pitfall title="別ルート：「その他」→「他」（going away soon）を選ぶ古い方法">
        <p>UIによっては「その他」フィルター最下部の「<strong>他</strong>」（This option is going away soon）を選んで、空のアプリを作成後にアプリレビュー画面で個別追加する旧仕様も使えます。ただし将来廃止予定のため、上記の「コンテンツ管理」経路が推奨です。</p>
        <StepImage slot="3-A" src="images/setup-guide/app-permissions/03-creation-other-tab.png" alt="「その他」フィルター最下部の「他」（going away soon）" />
      </Pitfall>

      <h3>2-3. ビジネス・要件・概要（ステップ3〜5）</h3>
      <ol>
        <li>「ビジネス」「要件」「概要」の各画面を確認して「次へ」で進める</li>
        <li>「アプリを作成」→ パスワード再入力 →（必要時のみ）SMS認証 → ダッシュボードに遷移</li>
      </ol>
      <StepImage slot="2-C" src="images/setup-guide/app-permissions/04-post-creation-dashboard.png" alt="アプリ作成完了直後のダッシュボード" />

      <Pitfall title="アプリ名で使えない単語">
        <p>Metaの商標ポリシーで <strong>ig / fb / face / book / insta / gram / rift</strong> などはアプリ名に使えません。例の「insights」や「analytics」のような一般語＋自分の名前で命名してください。</p>
      </Pitfall>
      <Pitfall title="新規FBアカウントの場合">
        <p>作成直後のFacebookアカウントはアプリ作成がブロックされることがあります。数日使い込んでから再挑戦してください。</p>
      </Pitfall>
      <Pitfall title="developers.facebook.com 初回ログイン時に Meta for Developers 登録を求められた場合">
        <p>「Meta for Developersへようこそ」ダイアログが出たら、Register → Contact info（メール認証）→ About you（役割選択：<strong>「開発者」</strong>がおすすめ）→ 登録完了、の順に進めてください。マイアプリ画面（<code>developers.facebook.com/apps/</code>）に遷移すれば登録完了です。</p>
      </Pitfall>
      <Pitfall title="同名のアプリを複数作ってしまった場合">
        <p>マイアプリ画面に同じ名前のアプリが2つ以上あると、Step 4・Step 5 で <strong>違うアプリのID/SECRETを混ぜてしまい長期トークン変換が失敗</strong>します。<strong>不要な方は削除</strong>するか、Step 4以降では<strong>アプリIDを必ず確認</strong>してから操作してください。</p>
      </Pitfall>
    </StepSection>
  );
}

function Step3({ done, onToggle }) {
  const perms = [
    ["instagram_business_basic", "基本情報・メディア取得"],
    ["instagram_business_manage_insights", "インサイト数値取得"],
    ["pages_read_engagement", "FBページ経由でIG接続"],
    ["pages_show_list", "ページ一覧取得"],
    ["business_management", "ビジネスアカウント管理"],
  ];
  return (
    <StepSection id="step-3" num="03" title="Instagram製品追加 + 権限確認" subtitle="所要 約3分"
      done={done} onToggleDone={onToggle}>
      <p>Step 2 でアプリを作成した直後のダッシュボード画面から、Instagram 製品を追加して 5 権限が揃っているか確認します。</p>

      <h3>3-1. Instagram製品を追加</h3>
      <ol>
        <li>アプリダッシュボード本文の「<strong>アプリに製品を追加</strong>」セクションまでスクロール</li>
        <li><strong>Instagram</strong> カードの「<strong>設定</strong>」をクリック → 左メニューに <strong>「Instagram グラフ API」</strong> が追加される</li>
      </ol>

      <h3>3-2. 権限が揃っているか確認</h3>
      <p>「他（going away soon）」ユースケースで作ったアプリは、必要な権限が <strong>自動でStandard accessとして付与されている</strong>ため、追加操作は基本不要です。</p>
      <ol>
        <li>左メニューの「<strong>Instagram グラフ API</strong>」を開く（または商品ページ）</li>
        <li>関連する権限一覧で、下記5つが <strong>Standard access</strong> として表示されているか確認 <span className="hint">（クリックでコピー）</span></li>
      </ol>
      <ul className="plain">
        {perms.map(([k, v]) => (
          <li key={k}><Copyable>{k}</Copyable> — {v}</li>
        ))}
      </ul>
      <Callout kind="success">
        <p><strong>「Standard access」= 開発モードで即使える</strong>。クリックや申請は不要。横の「アドバンスアクセスをリクエスト」ボタンは<strong>絶対に押さない</strong>（押すとMetaの審査が走り想定外）。</p>
      </Callout>
      <Callout kind="info">
        <p><strong>5権限が画面上に出ていなくてもOK</strong>：実際の動作確認は Step 6 の接続テストで行います。Step 5 で短期トークンが取得できれば権限は問題なく付いています。</p>
      </Callout>
      <Pitfall title="権限が見つからない場合">
        <p>旧名（<code>instagram_basic</code> / <code>instagram_manage_insights</code>）で検索すると出ません。新名（<code>_business_</code> 付き）で検索してください。pagesとbusiness系は旧名のままで OK。</p>
      </Pitfall>
      <Pitfall title="UI構成がドキュメントと違う場合">
        <p>Metaのダッシュボードは頻繁にUI変更されます。表示が違っても <strong>左メニューに「Instagramグラフ API」「アプリレビュー」のいずれか</strong> が存在し、そこから関連権限の状態が見られればOKです。最終確認は Step 6 の接続テスト結果で判断してください。</p>
      </Pitfall>
    </StepSection>
  );
}

function Step4({ done, onToggle }) {
  return (
    <StepSection id="step-4" num="04" title="APP_ID / APP_SECRET 登録" subtitle="所要 約3分"
      done={done} onToggleDone={onToggle}>
      <ol>
        <li>アプリダッシュボード左メニュー「設定」→「基本設定」を開く</li>
        <li><strong>「アプリID」</strong>（15〜17桁の数字）をコピー</li>
      </ol>
      <StepImage slot="4-A" alt="基本設定画面で「アプリID」を赤枠で示したスクショ" />
      <ol start="3">
        <li>スプシのメニュー <Copyable>📊 Instagram Insights → 🔐 シークレット入力</Copyable> を実行</li>
        <li>最初のダイアログ「Facebook アプリID」に貼り付け → OK</li>
        <li>Meta画面に戻り <strong>「アプリシークレット」</strong> 欄の「表示」→ FBパスワード入力 → コピー</li>
      </ol>
      <StepImage slot="4-B" alt="「アプリシークレット」の「表示」ボタンを赤枠で示したスクショ" />
      <ol start="6">
        <li>次のダイアログ「Facebook アプリシークレット」に貼り付け → OK</li>
        <li>残り（Instagramトークン・Gemini・Discord）は空のままOKでスキップ</li>
      </ol>
      <Callout kind="success">
        <p><strong>シークレットはScript Propertiesに直接保存</strong>。スプシのセルや履歴には残らず、共有しても漏れません。</p>
      </Callout>
      <Callout kind="danger">
        <p><strong>アプリシークレットは「アプリのパスワード」</strong>。他人に見せない・SNSに貼らない・スクショ投稿しない。漏れたらMetaの設定画面から「アプリシークレットをリセット」で即失効。</p>
      </Callout>
    </StepSection>
  );
}

function Step5({ done, onToggle }) {
  const perms = ["instagram_basic", "instagram_manage_insights", "pages_read_engagement", "pages_show_list", "business_management"];
  return (
    <StepSection id="step-5" num="05" title="短期アクセストークン取得（Graph API Explorer）" subtitle="所要 約5分"
      done={done} onToggleDone={onToggle}>
      <Callout kind="warn">
        <p><strong>⚠️ Step 3 と Step 5 の違い（同じ権限名が出てきますが別作業です）</strong></p>
        <p>Step 3 と Step 5 は <strong>同じ5つの権限名</strong>（<code>instagram_basic</code> 等）を扱うため「同じ作業を2回している？」と感じやすいですが、<strong>別の作業</strong>です。両方完了して初めて API を呼べる状態になります。</p>
        <ul>
          <li><strong>Step 3</strong>（アプリ管理画面）：アプリが「この権限を使います」と<strong>宣言</strong> — 求人票に「Excel使います」と書くイメージ</li>
          <li><strong>Step 5</strong>（Graph API Explorer）：自分のアカウントから「この権限を<strong>渡す</strong>」と承認してトークンを発行 — Excelのライセンス鍵を実際に受け取るイメージ</li>
        </ul>
        <p>Step 3 だけだとトークンが無く API を呼べない／Step 5 だけだと Step 3 で宣言してない権限はドロップダウンに出ない、という関係です。</p>
      </Callout>
      <ol>
        <li><a href="https://developers.facebook.com/tools/explorer" target="_blank" rel="noreferrer">developers.facebook.com/tools/explorer</a> を開く</li>
        <li>「<strong>Metaアプリ</strong>」のドロップダウンで、Step 2 で作成した自分のアプリを選択</li>
        <li>「<strong>ユーザーまたはページ</strong>」のドロップダウンを開き、「<strong>ユーザーアクセストークンを取得</strong>」をクリック</li>
      </ol>
      <StepImage slot="5-A" src="images/setup-guide/graph-api-explorer/02-explorer-initial.png" alt="Graph API Explorer 初期状態（Metaアプリ選択直後）" />
      <ol start="4">
        <li>「アクセス許可」欄の「許可を追加」をクリック → カテゴリ（Events Groups Pages / Other など）が表示される</li>
      </ol>
      <StepImage slot="5-B" src="images/setup-guide/graph-api-explorer/04-permission-categories.png" alt="許可を追加ドロップダウンのカテゴリ一覧" />
      <ol start="5">
        <li><Copyable>insta</Copyable> や <Copyable>pages</Copyable> と<strong>部分入力すると候補が絞られます</strong>。下記5つをそれぞれクリックして追加：
          <ul>{perms.map(p => <li key={p}><Copyable>{p}</Copyable></li>)}</ul>
          <p className="hint" style={{marginTop: 6}}>※ Graph API Explorer では<strong>旧名のまま</strong>表示されます（Step 3 で見た新名 <code>instagram_business_basic</code> 等とは別表記）。これでOK、Meta側で内部的にマッピングされます。</p>
        </li>
      </ol>
      <StepImage slot="5-C" src="images/setup-guide/graph-api-explorer/05-adding-permissions.png" alt="権限を複数追加中の状態" />
      <StepImage slot="5-D" src="images/setup-guide/graph-api-explorer/06-all-permissions-added.png" alt="5つの権限すべて追加完了" />
      <ol start="6">
        <li>「<strong>Generate Access Token</strong>」（アクセストークンを生成）をクリック → Facebook承認画面でFBページとIGアカウントが「1件を選択中」になっているか確認 →「保存」</li>
        <li>「<strong>Access Token</strong>」（アクセストークン）欄に表示される長い文字列をコピー</li>
      </ol>
      <ol start="7">
        <li>スプシのメニュー <Copyable>📊 Instagram Insights → 🔐 シークレット入力</Copyable> を実行</li>
        <li>FBアプリID・SECRETは現状維持で空のままOK</li>
        <li>「Instagram アクセストークン」のダイアログでコピー値を貼り付け → OK</li>
        <li>残りは空のままOKでスキップ</li>
      </ol>
      <Callout kind="warn">
        <p><strong>短期トークンは1時間で切れます</strong>。貼付後はすぐにStep 6（接続テスト）へ。失効したらStep 5をやり直すだけでOK。</p>
      </Callout>
      <Pitfall title="権限選択画面が出ない場合">
        <p>広告ブロッカーやポップアップブロックを一時的に無効化、またはシークレットウィンドウで再試行。</p>
      </Pitfall>
    </StepSection>
  );
}

function Step6({ done, onToggle }) {
  return (
    <StepSection id="step-6" num="06" title="接続テスト → 自動で長期化" subtitle="所要 約30秒・本テンプレートの「肝」"
      done={done} onToggleDone={onToggle}>
      <p>
        このステップが本テンプレートの「肝」です。メニューを 1 回クリックするだけで、
        (1) Graph API への接続確認、(2) 短期トークンを 60 日長期トークンへ自動交換、(3) IG_USER_ID の自動取得・自動保存、
        までを内部で一気に処理します。
      </p>
      <h3>手順</h3>
      <ol>
        <li>スプシのメニュー <Copyable>📊 Instagram Insights → 🔗 接続テスト</Copyable> を実行</li>
        <li>処理が走り始めると、内部で以下が自動実行されます：
          <ul>
            <li>① 短期トークンで Graph API 接続 → 自分の IG ユーザー名・投稿数を取得</li>
            <li>② FB_APP_ID と FB_APP_SECRET を使って <strong>短期トークン → 60 日長期トークン</strong> へ自動交換</li>
            <li>③ 取得した IG_USER_ID を Script Properties に自動保存</li>
            <li>④ 設定シートの該当欄にも自動で値を書き戻し</li>
          </ul>
        </li>
        <li>「✅ 接続成功！ ユーザー名: ◯◯ / 投稿数: ◯件」のアラートが出れば完了</li>
      </ol>
      <Callout kind="success">
        <p><strong>🎉 ここまで来れば認証系は完了です</strong></p>
        <p>
          このあと 60 日間はトークン更新を意識しなくて OK。さらに Step 11 でトリガーを設置すれば、
          毎週日曜にトークンが自動でリフレッシュされ続けます。
        </p>
      </Callout>
      <Pitfall title="失敗時のチェックポイント">
        <ul>
          <li><strong>「Instagram API Error」</strong> → Step 3 の権限が不足。5 つすべて付いているか、Step 5 で 5 つすべてチェックしたかを確認</li>
          <li><strong>「長期トークン変換失敗」</strong> → Step 4 の FB_APP_ID / FB_APP_SECRET が未設定または値が間違い。<Copyable>🔐 シークレット入力</Copyable> で再登録</li>
          <li><strong>「IG_USER_ID が取れない」</strong> → IG アカウントが Facebook ページと連携されていない可能性。Meta Business Suite で連携状態を確認</li>
          <li><strong>「アクセストークン期限切れ」</strong> → 短期トークン取得から 1 時間以上経過。Step 5 をやり直し → 即 Step 6 を再実行</li>
        </ul>
      </Pitfall>
    </StepSection>
  );
}

function Step7({ done, onToggle }) {
  return (
    <StepSection id="step-7" num="07" title="IG_USER_ID 確認（任意）" subtitle="所要 約30秒・スキップ可"
      done={done} onToggleDone={onToggle}>
      <Callout kind="info">
        <p><strong>このステップはオプションです</strong>。Step 6 の接続テストが成功していれば IG_USER_ID は自動保存済みなので、<strong>スキップしてStep 8へ進んでOK</strong>です。心配な人だけ下記の確認手順を実施してください。</p>
      </Callout>
      <h3>確認手順（任意）</h3>
      <ol>
        <li>スプシ下部のタブ「<strong>⚙️ 設定</strong>」をクリックして開く</li>
        <li>「Instagram ユーザー ID」欄の B 列に <strong>15〜17 桁の長い数字</strong> が入っていることを確認（例: <Copyable>17841401234567890</Copyable>）</li>
        <li>空欄のままなら Step 6 の接続テストが正常完了していない → Step 6 を再実行</li>
      </ol>
    </StepSection>
  );
}

function Step8({ done, onToggle }) {
  return (
    <StepSection id="step-8" num="08" title="Drive 画像保存フォルダ自動作成" subtitle="所要 約30秒"
      done={done} onToggleDone={onToggle}>
      <p>
        Instagram の画像・動画サムネイル URL は Meta 側で時間経過とともに失効します（CDN URL のため）。
        本テンプレートでは投稿取得時に画像実体を <strong>自分の Google Drive にコピー保存</strong> し、永久に手元に残るようにします。
        そのための保存先フォルダをこのステップで自動作成します。
      </p>
      <h3>手順</h3>
      <ol>
        <li>スプシのメニュー <Copyable>📊 Instagram Insights → 📁 Drive画像保存フォルダを準備</Copyable> を実行</li>
        <li>処理が走ると以下が自動実行されます：
          <ul>
            <li>① 自分の Google Drive 直下に「<strong>IG インサイト画像保存</strong>」フォルダを新規作成</li>
            <li>② フォルダの URL とフォルダ ID をアラートで表示</li>
            <li>③ 設定シート「Google ドライブ フォルダ ID」欄に自動で値を書き込み</li>
            <li>④ Script Properties にも自動保存</li>
          </ul>
        </li>
        <li>「📁 フォルダを作成しました」アラートが出れば完了</li>
      </ol>
      <p>フォルダ内の構造（取得実行時に自動生成されます）：</p>
      <pre className="tree">{`IGインサイト画像保存/
  ├── feed/      ← フィード投稿の画像
  ├── reels/     ← リールのサムネイル
  └── stories/   ← ストーリーズの画像`}</pre>
      <Callout kind="info">
        <p><strong>容量の目安</strong></p>
        <p>1投稿あたり画像 1〜2MB、月30投稿で年間 約1GB。Google Drive の無料枠（15GB）でも数年分は収まります。</p>
      </Callout>
      <Pitfall>
        <p>
          既に「IG インサイト画像保存」フォルダが手動で作られていた場合、本機能はそのフォルダを上書きせず、新しく別フォルダを作って ID をそちらに書き換えます。
          重複が気になる場合は古いフォルダを Drive 上で削除してください。
        </p>
      </Pitfall>
    </StepSection>
  );
}

function Step9({ done, onToggle }) {
  return (
    <StepSection id="step-9" num="09" title="Gemini API キー（OCR用・任意）" subtitle="任意 — 所要 約5分"
      done={done} onToggleDone={onToggle}>
      <p>
        Gemini を登録すると、<strong>新着ストーリーズ取得時に画像内のテキストを自動OCR</strong>します（1日数件レベルなので無料枠で十分）。
      </p>
      <h3>手順</h3>
      <ol>
        <li><a href="https://aistudio.google.com" target="_blank" rel="noreferrer">aistudio.google.com</a> にGoogleアカウントでログイン</li>
        <li>左サイドバー「Get API key」→「Create API key」</li>
        <li>「Create API key in new project」で新規作成。プロジェクト名を聞かれたら例: <Copyable>ig-insights-gemini</Copyable> など分かりやすい名前を入れる</li>
        <li>発行された <Copyable>AIza...</Copyable> で始まる文字列をコピー</li>
        <li>スプシのメニュー <Copyable>📊 Instagram Insights → 🔐 シークレット入力</Copyable> を実行</li>
        <li>「Gemini APIキー」のダイアログまで進み貼り付け → OK</li>
      </ol>
      <Callout kind="info">
        <p><strong>OCRが走るタイミング</strong>：30分ごとの自動取得で「新規ストーリーズ」を検出した時だけ。過去分のバッチOCRはありません。</p>
      </Callout>
      <Callout kind="info">
        <p><strong>動画ストーリーのサムネ</strong>：Auto-fetchは Instagram Graph API の <code>thumbnail_url</code>（公式自動生成静止画）を使うので、動画でもキレイにサムネが入ります。OCRも同サムネに対して実行されます。</p>
      </Callout>
      <Callout kind="info">
        <p><strong>月額試算</strong>：新着 月100件 OCR でも約 <strong>$0.05（≒7円）</strong>。Gemini無料枠（1,500回/日）に余裕で収まります。</p>
      </Callout>
      <Callout kind="warn">
        <p><strong>OCR 不要なら Step 9 スキップでOK</strong>。基本数値（リーチ・閲覧数・反応数）は Gemini なしでも問題なく取得・記録されます。</p>
      </Callout>
      <Callout kind="danger">
        <p><strong>APIキーの取り扱い</strong>：Step 4 のシークレットと同じく機密情報。公開リポジトリ・SNS・スクショ共有は厳禁。漏洩したら AI Studio から即時失効＆再発行。</p>
      </Callout>
    </StepSection>
  );
}

function Step10({ done, onToggle }) {
  return (
    <StepSection id="step-10" num="10" title="Discord Webhook 設定（通知用・任意）" subtitle="任意 — 所要 約5分"
      done={done} onToggleDone={onToggle}>
      <p>
        30 分ごとの自動取得や週次のトークン更新で何が起きたかを、自分の Discord チャンネルに通知する設定です。
        エラーがあった時にすぐ気づけるようになります。
        <strong>Discord を使わない場合は Step 10 をスキップしても OK</strong>（テンプレート本体の動作に影響なし）。
      </p>
      <h3>手順</h3>
      <ol>
        <li>自分のDiscordサーバーを開く（ない場合は左下「+」で新規作成）</li>
        <li>通知用チャンネルを作成（例: <Copyable>#ig-insights-通知</Copyable>）</li>
        <li>チャンネル名の右の歯車アイコン → 「連携サービス」→「ウェブフック」→「ウェブフックを作成」</li>
        <li>「ウェブフックURLをコピー」をクリック</li>
        <li>スプシのメニュー <Copyable>📊 Instagram Insights → 🔐 シークレット入力</Copyable> を実行</li>
        <li>「Discord Webhook URL」のダイアログまで進み貼り付け → OK</li>
      </ol>
      <Callout kind="info">
        <p><strong>受信される通知の種類</strong></p>
        <ul>
          <li>✅ トークン自動更新成功（毎週日曜・成功時）</li>
          <li>⚠️ トークン更新失敗（要対応のシグナル）</li>
          <li>⚠️ 取得エラー（API レート制限・権限不足等）</li>
        </ul>
      </Callout>
      <Callout kind="danger">
        <p><strong>Webhook URL の取り扱い</strong></p>
        <p>
          Webhook URL を知っている人は誰でも、そのチャンネルに任意の投稿ができます。公開しない・共有しないのが基本。
          漏洩した場合はチャンネル設定から該当 Webhook を削除して再作成してください。
        </p>
      </Callout>
      <Pitfall title="Discord 不要な場合">
        <p>
          通知が無くても、エラーは Apps Script のログ（拡張機能 → Apps Script → 実行数）で確認できます。
          スプシだけで完結したい人は Step 10 をスキップしてください。
        </p>
      </Pitfall>
    </StepSection>
  );
}

function Step11({ done, onToggle }) {
  return (
    <StepSection id="step-11" num="11" title="トリガー設置（自動取得開始）" subtitle="所要 約30秒・最後の仕上げ"
      done={done} onToggleDone={onToggle}>
      <p>30分ごとの自動インサイト取得 + 週次の長期トークン更新、を一括設置します。</p>
      <ol>
        <li>メニュー <Copyable>📊 Instagram Insights → ⏰ トリガーをインストール</Copyable> を実行</li>
        <li>「トリガーをインストールしました」アラートが表示されたら設置完了
          <ul>
            <li><Copyable>autoFetch</Copyable>: 30分ごと（インサイト自動取得）</li>
            <li><Copyable>refreshTokenJob</Copyable>: 毎週日曜9時（トークン更新）</li>
          </ul>
        </li>
        <li>30分後にスプシを開いて、フィード・リール・ストーリーズの行が自動更新されているか確認</li>
      </ol>
      <h3>トリガーの管理</h3>
      <ul>
        <li>現在のトリガー確認: メニュー <Copyable>📋 トリガー一覧</Copyable></li>
        <li>停止: メニュー <Copyable>🗑 トリガーを削除</Copyable></li>
        <li>再開: <Copyable>⏰ トリガーをインストール</Copyable> を再実行</li>
      </ul>
      <Callout kind="success">
        <p><strong>🎉 セットアップ完了です</strong></p>
        <p>
          これで Instagram の全インサイトが 30 分ごとに自動でスプシに保存され、週次でトークンも自動更新されます。
          アカウント BAN 対策のバックアップとして機能します。
        </p>
      </Callout>
    </StepSection>
  );
}

function DailyOps() {
  return (
    <Section id="daily-ops" title="日々の運用">
      <h3>基本方針</h3>
      <ul>
        <li>セットアップ後は基本「触らない運用」で OK。30 分ごとに自動でデータが追記されます</li>
        <li>週 1 回、ダッシュボードシートで「伸びた投稿」「初速良好」「曜日 × 時間帯ヒートマップ」を確認 → 投稿戦略にフィードバック</li>
        <li>月 1 回はスプシを開く（30 日以上開かないとトークン失効リスク）</li>
      </ul>
      <h3>トラブル時のセルフチェック</h3>
      <ol>
        <li><Copyable>🔍 設定状況を確認</Copyable> で各 PROPS が入っているか</li>
        <li><Copyable>🔗 接続テスト</Copyable> で Graph API が応答するか</li>
        <li><Copyable>📋 トリガー一覧</Copyable> で <code>autoFetch</code> と <code>refreshTokenJob</code> が登録されているか</li>
        <li>Discord 通知で何かエラーが出ていないか</li>
        <li>解決しない場合は Discord の個別相談部屋で質問（購入後に自動作成されたあなた専用チャンネル）</li>
      </ol>
    </Section>
  );
}

function Compliance() {
  return (
    <Section id="compliance" title="規約・データの扱い（重要）">
      <p>
        本テンプレートは <strong>Meta 公式 Instagram Graph API のみ</strong> を使用し、HTML スクレイピングは一切行いません。
        BYO 型（Bring Your Own credentials）で各利用者が自分の Meta App・自分のトークン・自分の Google アカウント・自分の Drive フォルダで完結する設計のため、
        配布元（クリエイター）は利用者のトークンや投稿データを一切預かりません。
      </p>
      <Callout kind="success" icon="🟢">
        <p><strong>できること（白）</strong></p>
        <ul>
          <li>Instagram Graph API（Meta 公式）の正規利用</li>
          <li>自分のビジネス／クリエイターアカウントのデータを自分のスプシ・自分の Drive に保存</li>
          <li>Meta 公式「アカウントセンター → 情報をダウンロード」zip の正規エクスポートのパース</li>
          <li>BYO 型でトークンを自分で管理</li>
        </ul>
      </Callout>
      <Callout kind="danger" icon="🔴">
        <p><strong>やらないこと（黒）</strong></p>
        <ul>
          <li>HTML スクレイピング（instagram.com 直接叩き）— 規約違反 + 不正アクセス禁止法 + IP BAN</li>
          <li>第三者の非公開アカウントデータ取得</li>
          <li>アクセストークン集中管理（プラットフォーム規約違反）</li>
          <li>自動コメント・自動 DM スパム — 本テンプレは <strong>読み取り専用</strong></li>
        </ul>
      </Callout>
      <p>詳細・グレーゾーンの整理は <a href="./onboarding-expectations.html">できる / 条件付き / できない一覧</a> を必ず確認してください。</p>
    </Section>
  );
}

function Faq() {
  return (
    <Section id="faq" title="FAQ">
      <FaqItem q="接続テストで「Instagram API Error」が出る">
        <p>
          アクセストークンの権限不足が大半です。<code>instagram_basic</code> / <code>instagram_manage_insights</code> / <code>pages_read_engagement</code> / <code>pages_show_list</code> の 4 つが付いているか確認してください。
          短期トークンの期限切れ（1 時間）も多いので、Graph API Explorer で再取得して短期トークンを再貼り付け → 接続テスト。
        </p>
      </FaqItem>
      <FaqItem q="ストーリーズが取れない">
        <p>API 仕様で <strong>24 時間以内のみ</strong>取得可能です。設定後のストーリーズは自動取得されます。設定より前の<strong>過去ストーリーズの復元</strong>は、購入者特典「過去データ取り寄せガイド」を参照してください。また、IG アカウントが「個人」の場合は不可（ビジネス／クリエイターに切替必須）。</p>
      </FaqItem>
      <FaqItem q="トークンが期限切れになった（60日超過）">
        <p><Copyable>🔄 トークン手動更新</Copyable> を実行 → 失敗する場合は短期トークンから取り直し（Step 5）。30 日以上スプシを開かない期間があると失効リスクが高まるため、月 1 回以上は開く運用を推奨します。</p>
      </FaqItem>
      <FaqItem q="OCR が動かない">
        <p>GEMINI_API_KEY が未設定の場合は OCR がスキップされます。<a href="https://aistudio.google.com" target="_blank" rel="noreferrer">AI Studio</a> で発行後、メニュー <Copyable>🔐 シークレット入力</Copyable> で登録してください。無料枠で月数百件は処理可能です。</p>
      </FaqItem>
      <FaqItem q="取得したデータを再販してもいい？">
        <p>自分のアカウントの統計データを <strong>自分のサービス内で使う</strong>のは問題ありません。データを <strong>第三者に再販</strong>する場合は Meta 規約・個人情報保護法の確認が別途必要です（クライアントワーク等）。</p>
      </FaqItem>
      <FaqItem q="複数アカウント運用したい">
        <p>1 スプシ = 1 IG アカウント設計です。複数アカウント分のスプシをコピーすれば対応可能です。同一購入者が複数アカウント運用する場合は問題ありません（追加購入不要）。</p>
      </FaqItem>
    </Section>
  );
}

function AfterCare() {
  return (
    <Section id="aftercare" title="購入後サポート・お問い合わせ">
      <p>
        購入確認後、Discord サーバーにご招待します。サーバーに参加すると
        <strong>あなた専用の個別相談チャンネル</strong>が自動作成され、本人と運営だけが見える非公開部屋でセットアップ・運用の相談ができます。
      </p>
      <h3>サポート内容</h3>
      <ul>
        <li>セットアップでつまずいた箇所の個別サポート</li>
        <li>Meta／Instagram API 仕様変更時のテンプレ追随</li>
        <li>運用 Tips の共有（投稿時間帯分析・初速判定ロジック等）</li>
        <li>月 1 回の Q&amp;A タイム（不定期開催）</li>
      </ul>
      <Callout kind="info">
        <p><strong>参加手順</strong></p>
        <ol>
          <li>購入完了画面または購入確認メールに記載の Discord 招待リンクから参加</li>
          <li>入室と同時に <Copyable>#相談-あなたのアカウント名</Copyable> 形式のチャンネルが自動作成</li>
          <li>そのチャンネルに質問を書き込み → 運営から回答</li>
        </ol>
      </Callout>
      <Callout kind="warn">
        <p><strong>販売開始準備中</strong></p>
        <p>
          現在 Stripe 決済の準備中につき、購入リンクは近日公開予定です。先行で詳細を確認したい方は、
          公式 X（<a href="https://x.com/tamago_app" target="_blank" rel="noreferrer">@tamago_app</a>）の DM か、
          <a href="./index.html">トップページ</a> のお問い合わせフォームからご連絡ください。
        </p>
      </Callout>
    </Section>
  );
}

Object.assign(window, {
  Step0, Step1, Step2, Step3, Step4, Step5, Step6, Step7, Step8, Step9, Step10, Step11,
  DailyOps, Compliance, Faq, AfterCare,
});

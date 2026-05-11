/* global React, Copyable, CodeBlock, Callout, Pitfall, StepSection, Section, FaqItem */

// Helpers
const M = ({ children }) => <code>{children}</code>; // menu / inline code

// Step 0
function Step0({ done, onToggle }) {
  return (
    <StepSection id="step-0" num="00" title="進め方・必要なもの" subtitle="まず全体像とゴールの確認"
      done={done} onToggleDone={onToggle} completeLabel="読み終わったらチェック">
      <p>
        本手順書は <strong>Step 1 から順番に進めれば</strong>、Instagram の全投稿インサイトを自分のスプシに自動保存する仕組みが完成します。
        Zoom 同伴セットアップなら約 <strong>90 分</strong>、自分で進める場合は <strong>60〜120 分</strong> が目安です。
      </p>
      <p>途中で詰まったら Discord コミュニティ（アフターフォロー加入者）でご質問ください。</p>
      <Callout kind="info">
        <p><strong>必要なもの</strong></p>
        <ul>
          <li>Google アカウント（スプシ・Drive 用）</li>
          <li>Instagram ビジネス／クリエイターアカウント（個人アカウントは不可）</li>
          <li>Facebook ページ（IG ビジネスアカウントと連携済みのもの）</li>
          <li>Meta 開発者アカウント（無料・本手順内で作成）</li>
          <li>Discord アカウント（通知用 Webhook と購入者認証で使用）</li>
          <li>（任意）Gemini API キー — ストーリーズ OCR を使う場合のみ</li>
        </ul>
      </Callout>
    </StepSection>
  );
}

function Step1({ done, onToggle }) {
  return (
    <StepSection id="step-1" num="01" title="マスタースプレッドシートをコピー" subtitle="所要 約2分"
      done={done} onToggleDone={onToggle}>
      <ol>
        <li>購入後にお送りした「マスタースプシ <Copyable>?copy</Copyable> URL」をブラウザで開く</li>
        <li>「コピーを作成」ボタンをクリック → 自分の Google ドライブに複製される</li>
        <li>複製されたスプシを開く（ファイル名はそのままで OK）</li>
        <li>初回のみ「拡張機能 → Apps Script」の権限承認ダイアログが出る場合があります → 「許可」を選択</li>
        <li>スプシのメニューバーに <Copyable>📊 Instagram Insights</Copyable> が表示されていることを確認</li>
        <li>メニュー <Copyable>📊 Instagram Insights → 🔧 初回セットアップ（シート作成）</Copyable> を実行 → 全シートが自動生成されます</li>
      </ol>
    </StepSection>
  );
}

function Step2({ done, onToggle }) {
  return (
    <StepSection id="step-2" num="02" title="Meta Developer 登録 + アプリ作成" subtitle="所要 約10分（SMS認証で +5分）"
      done={done} onToggleDone={onToggle}>
      <p>
        Instagram Graph API を使うために、まず Meta（旧 Facebook）の開発者アカウントを作成し、その配下に専用のアプリを 1 つ作ります。
        ここで作るアプリは「自分専用のデータ取得窓口」であって、世間に公開するものではありません。
      </p>
      <h3>手順</h3>
      <ol>
        <li><a href="https://developers.facebook.com" target="_blank" rel="noreferrer">developers.facebook.com</a> を開いて、自分の Facebook アカウントでログイン</li>
        <li>右上「マイアプリ」→「アプリを作成」をクリック</li>
        <li>「アプリの種類」で <strong>「ビジネス」</strong> を選択 →「次へ」
          <ul><li>※「なし」「消費者」では Instagram Graph API の権限が付けられないので必ず「ビジネス」を選択</li></ul>
        </li>
        <li>「アプリ名」（例: <Copyable>ig-insights-自分のアカウント名</Copyable>）と「連絡先メールアドレス」を入力</li>
        <li>「ビジネスアカウント」欄は、すでに Meta Business Suite を使っているなら該当アカウントを選択。未作成ならその場で新規作成も可能</li>
        <li>「アプリを作成」→ パスワード再入力 → 場合により電話番号での SMS 認証 → アプリダッシュボードに遷移すれば完了</li>
      </ol>
      <Pitfall>
        <p>個人 Facebook アカウントだけでも作成できますが、後で別の運用者と共有する可能性があるならビジネスアカウント連携を推奨します。</p>
        <p>また、Facebook 本体のアカウント自体が新規作成直後だとアプリ作成がブロックされることがあります。その場合は数日アカウントを使い込んでから再挑戦してください。</p>
      </Pitfall>
    </StepSection>
  );
}

function Step3({ done, onToggle }) {
  const perms = [
    ["instagram_basic", "基本情報・メディア取得"],
    ["instagram_manage_insights", "インサイト数値取得"],
    ["pages_read_engagement", "Facebook ページ経由での IG 接続"],
    ["pages_show_list", "ページ一覧取得"],
    ["business_management", "ビジネスアカウント管理"],
  ];
  return (
    <StepSection id="step-3" num="03" title="権限追加" subtitle="所要 約5分"
      done={done} onToggleDone={onToggle}>
      <p>
        作成したアプリに、Instagram のインサイトを取るために必要な権限（Permission）を追加します。
        Meta の管理画面では <strong>「ユースケース」</strong> という単位でまとめて追加します。
      </p>
      <h3>手順</h3>
      <ol>
        <li>アプリダッシュボード左メニュー「ユースケースを追加」をクリック</li>
        <li>表示された候補から「<strong>カスタマイズ</strong>」（Customize）を選択 →「カスタマイズ」ボタンで進む</li>
        <li>左メニュー「権限とアクセスを追加」（Permissions and Features）を開く</li>
        <li>下記 5 つの権限について、それぞれ右側の「追加」（Add）をクリック</li>
      </ol>
      <h3>必要な権限（5 つすべて追加）</h3>
      <ul className="plain">
        {perms.map(([k, v]) => (
          <li key={k}><Copyable>{k}</Copyable> — {v}</li>
        ))}
      </ul>
      <Callout kind="success">
        <p><strong>アプリ審査は不要です</strong></p>
        <p>
          自分の IG アカウントのみを取得対象とする「開発モード（テスター追加）」で運用するため、Meta のアプリ審査（App Review）も本番モードへの切り替えも不要です。
          「開発モード」のままで本テンプレートの全機能が動作します。第三者のアカウントは取得しません。
        </p>
      </Callout>
      <Pitfall>
        <p>権限名の右側に「Standard Access」や「Advanced Access」の表示がありますが、開発モード運用なら <strong>Standard Access のままで OK</strong> です。</p>
        <p>Advanced Access に上げようとするとアプリ審査が必要になり、本テンプレートの想定外になります。</p>
      </Pitfall>
    </StepSection>
  );
}

function Step4({ done, onToggle }) {
  return (
    <StepSection id="step-4" num="04" title="APP_ID / APP_SECRET 取得 → スプシ登録" subtitle="所要 約3分"
      done={done} onToggleDone={onToggle}>
      <p>
        アプリの「身分証明書」にあたる 2 つの値（アプリ ID と アプリシークレット）を取得し、自分のスプシに登録します。
        この 2 つは Step 6 で短期トークンを 60 日長期トークンに自動変換するときに必要になります。
      </p>
      <h3>手順</h3>
      <ol>
        <li>アプリダッシュボード左メニュー「設定」→「基本設定」を開く</li>
        <li>画面上部の <strong>「アプリ ID」</strong>（公開値・15〜17 桁の数字）をコピー</li>
        <li>その下の <strong>「アプリシークレット」</strong> 欄で「表示」ボタンをクリック → Facebook パスワード再入力 → 表示されたシークレットをコピー</li>
        <li>自分のスプシを開いて「⚙️ 設定」シートを表示</li>
        <li>「Facebook アプリ ID」の B 列にアプリ ID を貼り付け</li>
        <li>「Facebook アプリシークレット」の B 列にアプリシークレットを貼り付け</li>
        <li>スプシのメニュー <Copyable>📊 Instagram Insights → 💾 設定シートからPropertiesに保存</Copyable> を実行</li>
        <li>「保存しました」アラートが出れば Script Properties への反映完了</li>
      </ol>
      <Callout kind="danger">
        <p><strong>アプリシークレットの取り扱い</strong></p>
        <p>アプリシークレットは「アプリのパスワード」に相当する機密情報です。以下を厳守してください：</p>
        <ul>
          <li>公開リポジトリ（GitHub 等）にコミットしない</li>
          <li>Discord・Slack・チャット等にそのまま貼り付けない</li>
          <li>スクリーンショットを SNS にアップしない（特に質問投稿時）</li>
          <li>スプシを第三者と共有する場合は、設定シートを非表示またはアクセス制限する</li>
        </ul>
        <p>万が一漏洩した場合は、Meta のアプリ設定画面から「アプリシークレットをリセット」して即時失効させてください。</p>
      </Callout>
    </StepSection>
  );
}

function Step5({ done, onToggle }) {
  const perms = ["instagram_basic", "instagram_manage_insights", "pages_read_engagement", "pages_show_list", "business_management"];
  return (
    <StepSection id="step-5" num="05" title="短期アクセストークン取得（Graph API Explorer）" subtitle="所要 約5分"
      done={done} onToggleDone={onToggle}>
      <p>
        Meta が提供する「Graph API Explorer」というブラウザツールで、まず <strong>1 時間有効の短期アクセストークン</strong> を取得します。
        次の Step 6 で、このトークンが自動的に 60 日有効の長期トークンに変換されます。
      </p>
      <h3>手順</h3>
      <ol>
        <li><a href="https://developers.facebook.com/tools/explorer" target="_blank" rel="noreferrer">developers.facebook.com/tools/explorer</a> を開く</li>
        <li>右上「Meta App」のドロップダウンで、Step 2 で作成した自分のアプリを選択</li>
        <li>「User or Page」のドロップダウンで「Get User Access Token」をクリック</li>
        <li>表示された権限選択ダイアログで、以下 5 つの権限を <strong>すべてチェック</strong>：
          <ul>{perms.map(p => <li key={p}><Copyable>{p}</Copyable></li>)}</ul>
        </li>
        <li>「Generate Access Token」をクリック → Facebook ログイン承認画面が開く</li>
        <li>承認画面で「対象の Facebook ページ」と「対象の Instagram ビジネスアカウント」がチェックされていることを確認 →「次へ」→「保存」</li>
        <li>Graph API Explorer の「Access Token」欄に長い文字列が表示されたらコピー</li>
        <li>自分のスプシ「⚙️ 設定」シートの「Instagram アクセストークン」B 列に貼り付け</li>
        <li>メニュー <Copyable>📊 Instagram Insights → 💾 設定シートからPropertiesに保存</Copyable> を実行</li>
      </ol>
      <Callout kind="warn">
        <p><strong>短期トークンは 1 時間で切れます</strong></p>
        <p>
          このトークンは取得から 1 時間で失効します。短期トークン貼付後は <strong>すぐに次の Step 6（接続テスト）</strong> に進んで、
          60 日長期トークンへの自動変換まで一気に終わらせてください。1 時間以内に Step 6 を実行できなかった場合は、
          Step 5 をやり直して短期トークンを取り直すだけで OK です（やり直しは何度でも無料）。
        </p>
      </Callout>
      <Pitfall title="権限選択画面が出ない場合">
        <p>ブラウザの広告ブロッカーやポップアップブロックを一時的に無効化してください。それでも出ない場合はシークレットウィンドウで再試行が確実です。</p>
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
        <li>初回のみ Apps Script の権限承認ダイアログが出る → 「許可」</li>
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
          このあと 60 日間はトークン更新を意識しなくて OK。さらに Step 13 でトリガーを設置すれば、
          毎週日曜にトークンが自動でリフレッシュされ続けます。
        </p>
      </Callout>
      <Pitfall title="失敗時のチェックポイント">
        <ul>
          <li><strong>「Instagram API Error」</strong> → Step 3 の権限が不足。5 つすべて付いているか、Step 5 で 5 つすべてチェックしたかを確認</li>
          <li><strong>「長期トークン変換失敗」</strong> → Step 4 の FB_APP_ID / FB_APP_SECRET が未設定または値が間違い。設定シートを再確認 → 💾 で再保存</li>
          <li><strong>「IG_USER_ID が取れない」</strong> → IG アカウントが Facebook ページと連携されていない可能性。Meta Business Suite で連携状態を確認</li>
          <li><strong>「アクセストークン期限切れ」</strong> → 短期トークン取得から 1 時間以上経過。Step 5 をやり直し → 即 Step 6 を再実行</li>
        </ul>
      </Pitfall>
    </StepSection>
  );
}

function Step7({ done, onToggle }) {
  return (
    <StepSection id="step-7" num="07" title="IG_USER_ID 自動取得・自動保存" subtitle="所要 約30秒（確認のみ）"
      done={done} onToggleDone={onToggle}>
      <p>
        IG_USER_ID は Instagram ビジネスアカウントを Graph API 上で識別するための数字 15〜17 桁の ID です。
        本テンプレートでは <strong>Step 6 の接続テストの中で自動取得・自動保存される</strong> ため、
        このステップで利用者が手動操作することは基本ありません。
      </p>
      <Callout kind="info">
        <p><strong>このステップは「確認のみ」</strong></p>
        <p>Step 6 を実行済みであれば、すでに IG_USER_ID は Script Properties と設定シートの両方に書き込まれています。新しく操作することは何もありません。</p>
      </Callout>
      <h3>確認手順</h3>
      <ol>
        <li>スプシ「⚙️ 設定」シートを開く</li>
        <li>「Instagram ユーザー ID」欄の B 列に <strong>15〜17 桁の長い数字</strong> が入っていることを確認（例: <Copyable>17841401234567890</Copyable>）</li>
        <li>もし空欄のままなら Step 6 の接続テストが正常に完了していない可能性 → Step 6 をもう一度実行</li>
      </ol>
      <Pitfall>
        <p>
          IG_USER_ID は Instagram の表示用ユーザー名（<code>@your_account</code>）とは <strong>別物</strong> です。
          長い数字列が入っていれば正常。アルファベット混じりの場合や桁数が極端に少ない場合は、別の値が誤って入っている可能性があるので Step 6 から再実行してください。
        </p>
      </Pitfall>
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
        <li>初回のみ Drive 関連の権限承認ダイアログ → 「許可」</li>
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
        <p>
          1 投稿あたり画像 1〜2MB、月 30 投稿なら年間で約 1GB 程度。Google Drive の無料枠（15GB）でも数年分は収まります。
          容量が気になる場合は、設定シートの「画像保存をスキップ」フラグを ON にすれば URL のみ記録モードに切り替えられます。
        </p>
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
        ストーリーズに焼き込まれたテキスト（手書き風キャプション・スタンプ文字・スクショ内の文字など）を、
        Google の Gemini Vision で自動 OCR してスプシに記録する機能のセットアップです。
        <strong>OCR が不要なら Step 9 はまるごとスキップして OK</strong> です（テンプレート本体の動作に影響なし）。
      </p>
      <h3>手順</h3>
      <ol>
        <li><a href="https://aistudio.google.com" target="_blank" rel="noreferrer">aistudio.google.com</a> を開いて Google アカウントでログイン</li>
        <li>左サイドバー「Get API key」をクリック</li>
        <li>「Create API key」ボタンをクリック</li>
        <li>「Select Google Cloud project」で既存プロジェクトを選ぶか、「Create API key in new project」で新規作成</li>
        <li>発行された API キー（<Copyable>AIza...</Copyable> で始まる文字列）をコピー</li>
        <li>自分のスプシ「⚙️ 設定」シートを開く</li>
        <li>「Gemini API キー」B 列に貼り付け</li>
        <li>メニュー <Copyable>📊 Instagram Insights → 💾 設定シートからPropertiesに保存</Copyable> を実行</li>
      </ol>
      <Callout kind="info">
        <p><strong>月額試算</strong></p>
        <p>ストーリーズ 100 件／月の OCR で <strong>約 $0.05（≒ 7 円）</strong>。Gemini API の無料枠でほぼカバーできるレンジなので、個人運用なら実質ゼロ円で運用可能です。</p>
      </Callout>
      <Callout kind="warn">
        <p><strong>OCR 不要な場合</strong></p>
        <p>
          ストーリーズ画像内のテキスト抽出を行わなくても、画像実体は Step 8 の Drive フォルダに保存され、
          ストーリーズの基本数値（リーチ・閲覧数・反応数等）も問題なく取得できます。
          OCR は「あとで検索したい」「テキスト分析したい」場合の <strong>追加機能</strong> という位置付けです。
        </p>
      </Callout>
      <Callout kind="danger">
        <p><strong>API キーの取り扱い</strong></p>
        <p>
          Gemini API キーも Step 4 のアプリシークレットと同じく機密情報です。公開リポジトリにコミット・チャットへの貼付・スクショ共有は厳禁。
          漏洩した場合は AI Studio から該当キーを即時失効させて再発行してください。
        </p>
      </Callout>
      <h3>Gemini API が呼ばれるのはどのメニュー？</h3>
      <table>
        <thead>
          <tr><th>メニュー</th><th>Gemini 使用</th></tr>
        </thead>
        <tbody>
          <tr><td>📚 過去全件取り込み（API）</td><td>❌ 使わない</td></tr>
          <tr><td>📸 フィード+リールのみ取得 / 📖 ストーリーズのみ取得</td><td>❌ 取得時は使わない</td></tr>
          <tr><td>🔍 ストーリーズ OCR 一括 / バッチ</td><td>✅ 使う</td></tr>
          <tr><td>🤖 自動 OCR 開始</td><td>✅ 5 分ごと最大 100 件まで使う</td></tr>
        </tbody>
      </table>
      <p>
        過去全件取り込みやインサイト取得では Gemini が呼ばれないので、<strong>無料枠の上限を気にせず大量取り込みできます</strong>。
        Gemini を使うのは「OCR」と名前のついたメニューを明示的に実行した時だけ。
      </p>
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
        <li>自分の Discord サーバーを開く（ない場合は Discord アプリ左下「+」で新規作成）</li>
        <li>通知用チャンネルを作成（例: <Copyable>#ig-insights-通知</Copyable>）</li>
        <li>チャンネル名の右にある歯車アイコン → チャンネル設定を開く</li>
        <li>左メニュー「連携サービス」→「ウェブフック」→「ウェブフックを作成」</li>
        <li>名前を設定（例: <Copyable>IG Insights Bot</Copyable>）→ アイコンも任意で設定</li>
        <li>「ウェブフック URL をコピー」ボタンをクリック</li>
        <li>自分のスプシ「⚙️ 設定」シートを開く</li>
        <li>「Discord Webhook URL」B 列に貼り付け</li>
        <li>メニュー <Copyable>📊 Instagram Insights → 💾 設定シートからPropertiesに保存</Copyable> を実行</li>
      </ol>
      <Callout kind="info">
        <p><strong>受信される通知の種類</strong></p>
        <ul>
          <li>✅ トークン自動更新成功（毎週日曜・成功時）</li>
          <li>⚠️ トークン更新失敗（要対応のシグナル）</li>
          <li>✅ 過去全件取り込み完了</li>
          <li>⚠️ 取得エラー（API レート制限・権限不足等）</li>
          <li>✅ Meta zip アップロード完了サマリ</li>
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
    <StepSection id="step-11" num="11" title="過去全件取り込み（API）" subtitle="所要 投稿1000件で15〜25分（複数回実行）"
      done={done} onToggleDone={onToggle}>
      <p>
        フィード・リールの過去投稿をすべて遡って取得します。Instagram Graph API のページング機能で 1 ページ 50 件ずつ取得し、
        5 分の Apps Script 実行制限に達したら自動でカーソルを保存して中断します。
      </p>
      <h3>手順</h3>
      <ol>
        <li>メニュー <Copyable>📊 Instagram Insights → 📚 過去全件取り込み（API）</Copyable> を実行</li>
        <li>確認ダイアログで「OK」 → 取得開始</li>
        <li>5 分以内に終わった場合: 「✅ 過去全件取り込み完了」アラート + Discord 通知</li>
        <li>5 分制限到達した場合: 「⏸️ 5 分制限に達したため中断しました」アラートが出る → <strong>もう一度同じメニューを実行</strong>すると、続きから自動で再開</li>
        <li>累積件数が「フィード ◯◯件 / リール ◯◯件」と表示されたら全件完了</li>
      </ol>
      <Callout kind="warn">
        <p>
          <strong>ストーリーズは API 上 24 時間以内のみ取得可能</strong> — 過去のストーリーズを復元したい場合は、次の Step 12（Meta 公式 zip アップロード）を必ず実施してください。
        </p>
      </Callout>
      <Callout kind="info">
        <p><strong>もし途中でおかしくなったら</strong></p>
        <p>メニュー <Copyable>🔁 取り込みカーソルをリセット</Copyable> で最初からやり直せます。シートに既に追加された行は重複防止機能で再追加されません。</p>
      </Callout>
      <Callout kind="info">
        <p><strong>Gemini API は使いません</strong></p>
        <p>
          このメニューはフィード／リールのみ対象で、Gemini は一切呼びません。過去数千件の取り込みでも Gemini 無料枠の上限を気にせず実行できます。
          OCR は別メニュー（🔍 ストーリーズ OCR 系）でのみ動作。
        </p>
      </Callout>
      <Pitfall title="初回データ取得時にスプシ上部へ黄色の警告バーが出ます">
        <p>「警告: 一部の数式で、外部関係者とのデータ送受信が行われようとしています」と表示されたら、右側の「<strong>アクセスを許可</strong>」をクリックしてください。</p>
        <p><strong>原因</strong>: 各シートのサムネ列に <code>=IMAGE("https://drive.google.com/thumbnail?id=...")</code> という数式が入っており、自分の Drive に保存した画像 URL をスプシ内で表示するために外部参照を行います。Google がこれを「外部とのデータ送受信」として警告します。</p>
        <p><strong>安全性</strong>: 自分の Drive の自分の画像を自分のスプシで表示するための承認です。データ漏洩リスクはありません。一度許可すれば次回以降は表示されません。</p>
      </Pitfall>
    </StepSection>
  );
}

function Step12({ done, onToggle }) {
  return (
    <StepSection id="step-12" num="12" title="Meta 公式 zip アップロード（過去ストーリーズ用）" subtitle="ダウンロード待ちで数時間〜24時間"
      done={done} onToggleDone={onToggle}>
      <p>
        Instagram の過去ストーリーズは Graph API では取得できません。Meta 公式の「アカウントセンター → 情報をダウンロード」機能で取得した正規エクスポート zip をアップロードして、過去のストーリーズを履歴シートに復元します。
      </p>
      <h3>12-1. Meta から zip をダウンロード（24 時間〜数日かかります）</h3>
      <ol>
        <li>ブラウザで <a href="https://accountscenter.facebook.com/info_and_permissions/dyi" target="_blank" rel="noreferrer">アカウントセンター → 情報をダウンロード</a> を開く（要ログイン）</li>
        <li>「情報をダウンロード」を選択</li>
        <li>対象アカウントとして該当の Instagram アカウントをチェック</li>
        <li>「情報の種類」: 「すべて」または「コンテンツ」（投稿・ストーリー・リール・メディア）</li>
        <li>「形式」: <strong>JSON</strong> を選択（HTML では取り込めません）</li>
        <li>「期間」: <strong>すべて</strong></li>
        <li>「品質」: 推奨設定のまま</li>
        <li>「リクエストを送信」 → メールで通知 → 数時間〜24 時間後にダウンロードリンクが届く</li>
        <li>リンクから zip ファイルを PC に保存</li>
      </ol>
      <Pitfall title="サイズが大きい場合">
        <p>zip が 50MB を超える場合は、Apps Script の制約上アップロードできません。Meta 側で「期間」を半年単位で分割してエクスポートし、複数回アップロードしてください。</p>
      </Pitfall>
      <h3>12-2. スプシにアップロード</h3>
      <ol>
        <li>メニュー <Copyable>📊 Instagram Insights → 📦 Meta公式zipアップロード</Copyable> を実行</li>
        <li>ダイアログで zip ファイルを選択 → 「アップロード開始」</li>
        <li>処理が完了すると以下のサマリが表示されます：
          <ul>
            <li>📸 フィード追加: ◯件</li>
            <li>🎬 リール追加: ◯件</li>
            <li>📖 ストーリーズ追加: ◯件</li>
            <li>🖼 画像保存: ◯件</li>
            <li>⏭ 既存スキップ: ◯件</li>
          </ul>
        </li>
        <li>「📖 ストーリーズ履歴」シートに <Copyable>source = meta_zip</Copyable> として行が追加されているか確認</li>
      </ol>
      <Callout kind="warn">
        <p><strong>注意</strong></p>
        <p>
          Meta zip にはストーリーズの画像・キャプション・タイムスタンプが含まれますが、
          <strong>過去のリーチ・閲覧数・反応数の数値は欠落している場合があります</strong>。
          zip に無い数値は空欄として保存されます。これは Meta 側の仕様であり、本テンプレートで補完することはできません。
        </p>
      </Callout>
    </StepSection>
  );
}

function Step13({ done, onToggle }) {
  return (
    <StepSection id="step-13" num="13" title="トリガー設置（自動取得開始）" subtitle="所要 約30秒・最後の仕上げ"
      done={done} onToggleDone={onToggle}>
      <p>30 分ごとの自動インサイト取得 + 週次の長期トークン自動更新トリガーを設置します。</p>
      <ol>
        <li>メニュー <Copyable>📊 Instagram Insights → ⏰ トリガーをインストール</Copyable> を実行</li>
        <li>初回のみ Apps Script の権限承認ダイアログが出る → 「許可」</li>
        <li>「トリガーをインストールしました」アラートが表示されたら設置完了
          <ul>
            <li><Copyable>autoFetch</Copyable>: 30 分ごと（インサイト自動取得）</li>
            <li><Copyable>refreshTokenJob</Copyable>: 毎週日曜 9 時（トークン更新）</li>
          </ul>
        </li>
        <li>30 分後にスプシを開いて、フィード・リール・ストーリーズの行が自動更新されているか確認</li>
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
        <li>2〜3 ヶ月に 1 回、Meta 公式 zip を再エクスポート → アップロード（過去ストーリーズの追加分を取り込み）</li>
      </ul>
      <h3>トラブル時のセルフチェック</h3>
      <ol>
        <li><Copyable>🔍 設定状況を確認</Copyable> で各 PROPS が入っているか</li>
        <li><Copyable>🔗 接続テスト</Copyable> で Graph API が応答するか</li>
        <li><Copyable>📋 トリガー一覧</Copyable> で <code>autoFetch</code> と <code>refreshTokenJob</code> が登録されているか</li>
        <li>Discord 通知で何かエラーが出ていないか</li>
        <li>解決しない場合は Discord コミュニティで質問（アフターフォロー加入者）</li>
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
        <p>API 仕様で <strong>24 時間以内のみ</strong>取得可能です。過去分は Step 12 の Meta 公式 zip アップロードを使ってください。また、IG アカウントが「個人」の場合は不可（ビジネス／クリエイターに切替必須）。</p>
      </FaqItem>
      <FaqItem q="トークンが期限切れになった（60日超過）">
        <p><Copyable>🔄 トークン手動更新</Copyable> を実行 → 失敗する場合は短期トークンから取り直し（Step 5）。30 日以上スプシを開かない期間があると失効リスクが高まるため、月 1 回以上は開く運用を推奨します。</p>
      </FaqItem>
      <FaqItem q="Meta zip が 50MB を超える">
        <p>Apps Script の制約で 50MB 以内推奨です。Meta 側で「期間」を半年単位などで分割エクスポートし、複数回アップロードで対応してください。</p>
      </FaqItem>
      <FaqItem q="OCR が動かない">
        <p>GEMINI_API_KEY が未設定の場合は OCR がスキップされます。<a href="https://aistudio.google.com" target="_blank" rel="noreferrer">AI Studio</a> で発行・設定シートに貼付してください。無料枠で月数百件は処理可能です。</p>
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
    <Section id="aftercare" title="アフターフォロー">
      <p>月額 ¥500 のアフターフォローで Discord コミュニティ参加・API 変更時の追随サポート対応。詳しくは <a href="./index.html">トップページ</a> を参照。</p>
    </Section>
  );
}

Object.assign(window, {
  Step0, Step1, Step2, Step3, Step4, Step5, Step6, Step7, Step8, Step9, Step10, Step11, Step12, Step13,
  DailyOps, Compliance, Faq, AfterCare,
});

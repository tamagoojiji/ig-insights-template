# コンシェルジュ動画変換サービス 運用フロー

過去ストーリーズの動画(.mp4)を Apps Script では静止画化できないため、運営側で代行する手順。

## 全体像

```
ユーザー → ギガファイル便 → 運営 → ffmpeg変換 → ギガファイル便 → ユーザー → スプシ取込
```

## 1. ユーザー側の操作

### ユーザーへの案内テンプレ（Discord個別チャンネル）

```
過去動画のサムネ復元、対応します。以下の手順でお願いします：

1. アカウントセンター → 情報をダウンロード
   https://accountscenter.facebook.com/info_and_permissions/dyi

   設定:
   - エクスポート先: デバイスにエクスポート
   - 情報をカスタマイズ: ストーリーズのみ
   - 期間: 全期間
   - フォーマット: JSON (HTMLにしないで)
   - メディア画質: 高画質

2. メールで通知 → 数時間〜24h後にDLリンク
   ※ リンクの有効期限: 4日間

3. zipをDL後、そのまま [ギガファイル便](https://gigafile.nu/) にアップ
   - サイズ無制限・パスワード保護を推奨
   - URLとパスワードをこのチャンネルに貼ってください

4. 数日内に変換済みzipのURLを返します
   → そのzipを `📦 Meta公式zipアップロード` に取り込めば過去動画もサムネ付きで反映されます
```

### 動画サムネの限界（事前に伝える）

- 動画再生はできません（静止画として保存）
- 本文/キャプションは Business Suite CSV が取れる**直近3ヶ月**のみ復元可
- それ以前の動画は画像と日時のみ復元

## 2. 運営側の処理

### 前提
- macOS / Linux
- ffmpeg がインストール済み（`brew install ffmpeg`）
- Claude Code（このリポジトリで `~/.claude/...` 等）

### 手順

```bash
# 1. ギガファイル便のリンクからDL
# ブラウザで開いて ~/Downloads/ に保存

# 2. 変換実行（1コマンド）
cd ~/.superset/worktrees/ig-insights-template/wandering-sagittarius
python3 scripts/process-ig-zip.py ~/Downloads/instagram-xxx-yyyymmdd-*.zip

# 出力: ~/processed/instagram-xxx-yyyymmdd-*_processed.zip

# 3. Claudeに依頼するなら（複数zipまとめ処理）
# 「~/Downloads/instagram-* の全zipを処理して」

# 4. 出力された _processed.zip をギガファイル便にアップ → URLをユーザーに返す
```

### 所要時間目安

| 動画件数 | M1/M2 Mac |
|---|---|
| 100 | ~2分 |
| 500 | ~10分 |
| 2000 | ~40分 |
| 5000 | ~100分 |

### スクリプトが何をしているか

1. zip 展開（一時フォルダ）
2. `media/stories/`, `media/posts/`, `media/reels/` 内の `.mp4`/`.mov` を全部 ffmpeg で先頭フレーム抽出 → 同名 `.jpg`
3. `your_instagram_activity/content/stories.json` 等のJSON内の `uri` を `.mp4` → `.jpg` に書き換え
4. `.mp4` 本体は削除（容量節約）
5. 全体を再zip → `~/processed/<元の名前>_processed.zip` に出力

## 3. ユーザーへ返却

```
処理完了しました。下記のzipをDLして、スプシのメニュー
「📊 Instagram Insights → 📦 Meta公式zipアップロード」
から取り込んでください。

[ギガファイル便URL]
パスワード: xxxx

注意:
- 動画のサムネは静止画として表示されます
- キャプション(本文)は直近3ヶ月のものだけ取得できる仕様です
- 取り込み後は「📤 Business Suite CSVインポート」で過去CSVもアップすると、リーチ・視聴数等の数値も埋まります
```

## 4. 料金設計（参考）

| プラン | 料金 | 含まれる対応 |
|---|---|---|
| 無料セルフ | 0円 | 動画はサムネなしのまま運用 |
| 動画変換代行 | ¥xxxx | 1回（全期間zip）の変換代行 |
| プレミアムサポート | ¥xxxx/月 | 月次のzip + CSV代行 + Discord優先サポート |

## 5. 注意事項

### プライバシー
- ユーザーの私的データを一時的に扱う
- 処理完了後は速やかに元zipと中間ファイル削除
- 利用規約に明記する

### ディスク容量
- 大きい場合: 一時 ~5GB+
- 処理後は `~/processed/` に出力のみ残す
- 月次でクリーンアップ: `rm -rf ~/processed/*_processed.zip`（送付後）

### スケール限界
- 1人で対応するなら月20件程度が現実的
- 自動化したいなら ffmpeg.wasm + ブラウザ完結も検討

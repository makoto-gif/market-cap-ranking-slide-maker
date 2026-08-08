# 公開手順（他の人にも使ってもらう方法）

このサイトはビルド不要の静的サイトです。以下のどちらか（両方でも可）で公開できます。
どちらも、GitHub Actions が毎日コミットする最新データで自動的に更新され続けます。

## 方法1: GitHub Pages（無料・GitHubだけで完結）

1. リポジトリの **Settings → Pages** を開く
2. 「Build and deployment」の **Branch** で `main` を選び **Save**
3. 1〜2分後に次のURLで公開されます:
   `https://makoto-gif.github.io/market-cap-ranking-slide-maker/`

## 方法2: Vercel（無料・独自ドメインも簡単）

1. https://vercel.com にアクセスし、**Continue with GitHub** でログイン
2. **Add New… → Project** をクリック
3. リポジトリ一覧から `market-cap-ranking-slide-maker` の **Import** をクリック
   （一覧に出ない場合は「Adjust GitHub App Permissions」からリポジトリへのアクセスを許可）
4. 設定は何も変えずにそのまま **Deploy** をクリック
5. 1分ほどで `https://market-cap-ranking-slide-maker.vercel.app` のようなURLが発行されます

以後は GitHub に変更が入るたび（毎日のデータ自動更新を含む）に Vercel が自動で再デプロイします。

## 公開後にやること（1回だけ）

- リポジトリの **Actions タブ → 「時価総額データの自動更新」→ Run workflow** を実行
  → Yahoo Finance から日次・月次の実データが取得され、グラフが実データになります
  （以後は毎朝6時に自動実行）

## うまくいかないとき

- ページが404: Pages/Vercel の反映まで数分かかることがあります
- グラフが年次のまま: Actions が一度も実行されていません（上記を実行）
- Actions が失敗: Actions タブのログを確認。Yahoo Finance の一時的な障害なら翌日の自動実行で回復します

# 時価総額ランキングサイト

日本・世界の時価総額ランキングを「最新データで見る」「スライドにして配布する」ための静的サイトです。

## 2つのページ

### 📈 ランキング推移ビュー（index.html）
- 折れ線チャートとランキングバーで推移を表示
- **▶ 再生ボタン**で 2016年→現在 の推移がアニメーションで動く
- スライダーで任意の時点（年月）にジャンプ
- チャートにマウスを乗せると各年の数値をドル・円の両方で表示
- ヘッダーに**データの更新日（何月何日時点か）**を常時表示

### 🖼 スライド作成（slide.html）
- 「日本 時価総額トップ5の推移と、これから」形式のスライドを生成
- PNG（3840×2160）/ PPTX（16:9 PowerPoint）でダウンロード
- オプション:
  - 市場: 日本 / 世界
  - 企業: 上位3・5・7・10社、または個別選択
  - 期間: 2016〜最新の範囲で指定
  - 単位: **ドル / 円 / 両方**
  - 未来ゾーンの表示 ON/OFF
  - **「次の覇者は？」の文言を入れる/入れない**
- 「現在」マーカーは最新データの年月に応じてグラフ上の正確な位置に表示

## 最新データの自動更新

GitHub Actions（`.github/workflows/update-data.yml`）が**毎日 6:00 JST** に
Yahoo Finance から株価と為替（USD/JPY）を取得し、次の2ファイルを更新します。

- `data/latest.json` — 最新の時価総額と為替。「何年何月何日時点か」の表示に使用
- `data/history.json` — **2016年以降の月次時価総額**。グラフはこれがあると月単位の実データで描画され、ない場合は年末値の補間で描画される

- 手動実行: GitHub の Actions タブ → 「時価総額データの自動更新」 → Run workflow
- 仕組み: 基準時点の時価総額に株価変動率と為替変動率を掛けた概算（`scripts/update-data.mjs`）
- `data/latest.json` が読めない環境（file:// 直開きなど）では同梱データで動作

## 使い方

ビルド不要です。ローカルで確認する場合:

```bash
python3 -m http.server 8000
# → http://localhost:8000 を開く
```

GitHub Pages で公開する場合: Settings → Pages → Branch を `main` にして Save。

## ファイル構成

```
index.html                       # ランキング推移ビュー
slide.html                       # スライド作成
css/style.css                    # 共通スタイル（ライト/ダーク対応）
js/data.js                       # 年次データ（2016〜、単位: 10億USD）
js/latest.js                     # data/latest.json の読み込みと単位変換
js/chart.js                      # スライド描画エンジン
js/app.js                        # スライド作成ページのロジック
js/view.js                       # 推移ビューのロジック（アニメーション）
js/vendor/pptxgen.bundle.js      # PPTX生成ライブラリ（同梱）
data/latest.json                 # 最新の時価総額（Actionsが毎日更新）
scripts/update-data.mjs          # データ更新スクリプト
.github/workflows/update-data.yml # 毎日実行のワークフロー
```

## データについて

- 年次データ（2016〜2025）は各年末、最新値は `data/latest.json` の更新日時点です。
- 出典: CompaniesMarketCap／Yahoo Finance をもとにした概算値です。
- 発行株数の変動は反映しない簡易推計のため、投資判断には利用しないでください。
- 円表示は最新の USD/JPY レートでの換算です。

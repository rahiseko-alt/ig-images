# ig-images

Instagram 投稿用の画像を日次で生成し、公開 URL として配信するリポジトリ。

## なぜ公開リポなのか

Buffer は投稿予約時に画像 URL へ**サーバー側から**アクセスする。private リポの
`raw.githubusercontent.com` は 404 を返すため、画像だけを公開リポに置く。
**このリポジトリに秘匿情報を置かないこと。** API キーは GitHub Secrets にのみ存在する。

## 仕組み

```
GitHub Actions（毎日 02:30 UTC / 手動実行も可）
  ├ themes.json から当日のテーマを選ぶ（日付ベースのローテーション）
  ├ OpenAI GPT Image で背景画像を生成（テキストは描かせない）
  ├ sharp + NotoSansJP で日本語見出しを合成
  ├ images/ig-YYYYMMDD.jpg を commit
  └ latest.json を更新
        ↓
buffer-refill routine（毎日 03:03 UTC）
  └ latest.json を読み、imageUrl を Buffer の createPost に渡す
```

routine 側は画像を生成しない。API キーも持たない。

## ファイル

| パス | 役割 |
|---|---|
| `scripts/generate-ig-image.mjs` | 画像生成 CLI。`--bg-prompt` / `--headline` / `--out` を取る |
| `themes.json` | テーマ・英語背景プロンプト・日本語見出しの固定ローテーション表 |
| `assets/fonts/` | NotoSansJP（見出し合成用） |
| `images/` | 生成済み画像（日次追記。既存ファイルは変更・削除しない） |
| `latest.json` | 最新画像の公開 URL とメタ情報。routine が読む唯一の口 |

## モデル設定の由来

`gpt-image-2` / `quality: 'medium'` は 2026-07-18 の実機比較で確定した値。
`quality: 'low'` は合成前の背景品質が落ちて見出しが読みにくくなるため使わない。
理由の詳細は vibe-base の `docs/session-reports/2026-07-18-checkout-5.md` を参照。

## 運用メモ

- 画像は 1 枚あたり数百 KB。年間 200MB 程度まで増えるため、1 年後を目安に古い画像の剪定を検討する。
- テーマを増やすときは `themes.json` に追記する。並び順がそのままローテーション順になる。

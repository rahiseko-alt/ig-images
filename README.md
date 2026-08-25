# ig-images

Instagram 用の画像を日次生成していたリポジトリ。

## 生成パイプラインは 2026-08-25 に廃止した

OpenAI GPT Image で背景を生成し、sharp で日本語見出しを焼き込んで
毎日 17:30 UTC に commit する構成だったが、**出力品質が要求水準に達しないため
生成を停止し、生成器一式を削除した**。

削除したもの:

- `.github/workflows/generate-ig-image.yml` — 日次生成ワークフロー
- `scripts/generate-ig-image.mjs`, `scripts/run-daily.mjs` — 生成本体
- `assets/fonts/` — 見出し合成用フォント
- `themes.json` — テーマとプロンプトの回転表
- `package.json` — sharp 依存
- `latest.json` — buffer-refill が読んでいた受け渡し契約

`images/` は残してある。過去に Buffer のキューへ投入済みの投稿が
公開されるまで raw URL を参照しているため。参照が切れたあとは削除してよい。

## 後続への影響

buffer-refill の日次ルーチンは `latest.json` を起点に Instagram 投稿を
組み立てていた。この契約が無くなったため、**Instagram への投稿は画像の
供給元が決まるまで停止する**。X と Threads は影響を受けない。

GitHub Secrets の `OPENAI_API_KEY` はこのリポジトリでは未使用になった。

// Instagram投稿用の画像を生成する CLI。
//
// 設計方針（2026-07-18 マスター指示に基づく）:
// - 画像生成モデル（OpenAI GPT Image）にはテキストを一切描かせない（テキストなし背景/シーンのみ生成）。
//   モデルによる日本語テキストレンダリングは太字・短い見出し以外では精度が不安定なため。
// - テキストは生成後に sharp + SVG + NotoSansJP フォントで確実に合成する（100%正確）。
// - 呼び出し元（想定）: buffer-refill cloud routine（無人日次実行・claude.ai Remote Trigger）。
//   routine は本スクリプトを直接 node 実行し、stdout の [IMAGE_PATH] 行から
//   生成されたローカルファイルパスを受け取る。そのファイルは routine 側で
//   git add/commit/push し、raw.githubusercontent.com の公開URLとして
//   Buffer createPost mutation の assets に渡す想定。
//
// 依存: OPENAI_API_KEY（環境変数 or .env）、sharp、assets/fonts/NotoSansJP-*.ttf
//
// 使い方:
//   node scripts/generate-ig-image.mjs \
//     --bg-prompt "候補: 5要素フレームワーク（被写体+光源+レンズ/カメラ+環境+構図）で書いた英語プロンプト。テキスト厳禁の一文を末尾に必ず含める" \
//     --headline "画像に入れる日本語見出し（1行、太字で焼き込む）" \
//     --out out.jpg

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function loadEnvFile(envPath) {
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, 'utf-8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const idx = line.indexOf('=');
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadEnvFile(path.join(REPO_ROOT, '.env'));

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) args[a.slice(2)] = argv[(i += 1)];
  }
  return args;
}

const NO_TEXT_GUARD =
  'IMPORTANT: Do not include any text, letters, words, logos, numbers, or writing anywhere in the image. No signage, no menu text, no labels. Pure photo/illustration, zero text.';

async function generateBackground(bgPrompt, apiKey) {
  const fullPrompt = bgPrompt.includes(NO_TEXT_GUARD) ? bgPrompt : `${bgPrompt}\n\n${NO_TEXT_GUARD}`;
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-image-2',
      prompt: fullPrompt,
      size: '1024x1536',
      quality: 'medium',
      n: 1,
    }),
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`OpenAI画像生成APIエラー (${res.status}): ${bodyText.slice(0, 500)}`);
  }

  const json = await res.json();
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error('レスポンスに画像データがありません');
  return Buffer.from(b64, 'base64');
}

function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function compositeHeadline(bgBuf, headline, { width = 1024, height = 1536 } = {}) {
  const fontBoldPath = path.join(REPO_ROOT, 'assets/fonts/NotoSansJP-Bold.ttf').replace(/\\/g, '/');
  const lines = headline.split('\n').filter(Boolean);

  const lineHeight = 66;
  const startY = 130;
  const textEls = lines
    .map((line, i) => {
      const y = startY + i * lineHeight;
      return `<text x="60" y="${y}" font-family="NotoSansJPBold" font-size="56" font-weight="700" fill="white" filter="url(#shadow)">${escapeXml(line)}</text>`;
    })
    .join('\n  ');

  const svg = `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      @font-face {
        font-family: 'NotoSansJPBold';
        src: url('file:///${fontBoldPath}');
      }
    </style>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="rgba(0,0,0,0.5)"/>
    </filter>
  </defs>
  ${textEls}
</svg>
`;

  return sharp(bgBuf)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args['bg-prompt'] || !args['bg-prompt'].trim()) {
    console.error('[ERROR] --bg-prompt は必須です（英語、5要素フレームワーク推奨、テキスト厳禁指示は自動付与）');
    process.exit(2);
  }
  if (!args.headline || !args.headline.trim()) {
    console.error('[ERROR] --headline は必須です（画像に焼き込む日本語見出し、1〜3行程度）');
    process.exit(2);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('[ERROR] OPENAI_API_KEY が設定されていません');
    process.exit(2);
  }

  console.log('[STEP1] 背景画像生成中（テキストなし）...');
  const bgBuf = await generateBackground(args['bg-prompt'], apiKey);
  console.log('[STEP1] 完了');

  console.log('[STEP2] テキスト合成中...');
  const finalBuf = await compositeHeadline(bgBuf, args.headline);
  console.log('[STEP2] 完了');

  const outPath = args.out
    ? path.isAbsolute(args.out)
      ? args.out
      : path.join(REPO_ROOT, args.out)
    : path.join(REPO_ROOT, `ig-image-${Date.now()}.jpg`);
  writeFileSync(outPath, finalBuf);
  console.log(`[IMAGE_PATH] ${outPath}`);
  console.log('[DONE]');
}

main().catch((err) => {
  console.error(`[FATAL] ${err.message}`);
  process.exit(1);
});

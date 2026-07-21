// 日次実行のオーケストレーター（GitHub Actions から呼ばれる）。
//
// 役割:
//   1. themes.json から当日のテーマを選ぶ（日付ベースのローテーション）
//   2. generate-ig-image.mjs を子プロセスで実行して画像を作る
//   3. latest.json を更新する（routine が読む唯一の口）
//
// generate-ig-image.mjs 本体は 2026-07-18 の品質比較で確定した実装であり、
// 改造しない（sha256 で同一性を検証している）。そのため import ではなく子プロセス実行にしている。

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const RAW_BASE = 'https://raw.githubusercontent.com/rahiseko-alt/ig-images/main';

function pickTheme(themes) {
  const explicit = (process.env.THEME_INDEX || '').trim();
  if (explicit !== '') {
    const i = Number(explicit);
    if (!Number.isInteger(i) || i < 0 || i >= themes.length) {
      throw new Error(`THEME_INDEX が範囲外です: ${explicit}（有効範囲 0〜${themes.length - 1}）`);
    }
    return { theme: themes[i], index: i };
  }
  // UTC の経過日数でローテーションする。テーマを増やすと自動的に周期が伸びる。
  const daysSinceEpoch = Math.floor(Date.now() / 86400000);
  const i = daysSinceEpoch % themes.length;
  return { theme: themes[i], index: i };
}

function main() {
  const themesPath = path.join(REPO_ROOT, 'themes.json');
  const themes = JSON.parse(readFileSync(themesPath, 'utf-8'));
  if (!Array.isArray(themes) || themes.length === 0) {
    throw new Error('themes.json が空か配列ではありません');
  }

  const { theme, index } = pickTheme(themes);
  for (const key of ['theme', 'headline', 'bgPrompt']) {
    if (!theme[key] || !String(theme[key]).trim()) {
      throw new Error(`themes.json[${index}] に ${key} がありません`);
    }
  }
  console.log(`[THEME] index=${index} theme=${theme.theme}`);

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const relOut = `images/ig-${stamp}.jpg`;
  mkdirSync(path.join(REPO_ROOT, 'images'), { recursive: true });

  const res = spawnSync(
    process.execPath,
    [
      path.join(REPO_ROOT, 'scripts/generate-ig-image.mjs'),
      '--bg-prompt', theme.bgPrompt,
      '--headline', theme.headline,
      '--out', relOut,
    ],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  );
  if (res.status !== 0) {
    throw new Error(`画像生成に失敗しました（exit ${res.status}）`);
  }

  const outAbs = path.join(REPO_ROOT, relOut);
  if (!existsSync(outAbs)) {
    throw new Error(`画像が生成されていません: ${relOut}`);
  }

  const latest = {
    imageUrl: `${RAW_BASE}/${relOut}`,
    headline: theme.headline,
    theme: theme.theme,
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(path.join(REPO_ROOT, 'latest.json'), `${JSON.stringify(latest, null, 2)}\n`, 'utf-8');
  console.log(`[LATEST] ${latest.imageUrl}`);
  console.log('[DONE]');
}

try {
  main();
} catch (err) {
  console.error(`[FATAL] ${err.message}`);
  process.exit(1);
}

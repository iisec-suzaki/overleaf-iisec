// PR#15で、LLMSettingsController.mjs のスプライス事故（ヘッダを失った
// update処理体の溶着＝userId/merged の多重宣言）が、このモジュールの
// .mjs を LLM_ENABLED=true の環境でしか ESM として読み込まないために
// ビルド・テストを素通りした。このテストは有効化とは独立に、モジュール
// 配下の全 .mjs を node --check で構文検証し、起動 smoke（RUNBOOK ゲート）
// の前段として CI・手元実行の両方で機能事故を先に落とす。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src'
)

function collectMjs(dir) {
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) found.push(...collectMjs(full))
    else if (entry.name.endsWith('.mjs')) found.push(full)
  }
  return found.sort()
}

test('llmモジュールの全ESMソースが構文解釈できる（有効化時のみ読まれるファイルの構文事故を先取り検出）', () => {
  const files = collectMjs(SRC_DIR)
  // ルーター・コントローラ・モデル一式が揃っていること（見落としの保険）。
  assert.ok(files.length >= 15, `expected the llm sources, found ${files.length}`)

  const broken = []
  for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], {
      encoding: 'utf8',
    })
    if (result.status !== 0) {
      const firstLine = (result.stderr || '')
        .split('\n')
        .find(line => line.trim() !== '')
      broken.push(`${path.relative(SRC_DIR, file)}: ${firstLine}`)
    }
  }
  assert.deepEqual(broken, [])
})

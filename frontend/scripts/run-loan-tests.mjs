/**
 * 领域测试运行器：用 esbuild（vite 的依赖，无需额外安装）把 *.test.ts 打成
 * 临时 ESM 文件，再交给 node:test 执行。运行：node scripts/run-loan-tests.mjs
 */
import { build } from 'esbuild'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = fileURLToPath(new URL('.', import.meta.url))
const entry = join(here, '..', 'src', 'data', 'loan', 'ledger.test.ts')
const dir = mkdtempSync(join(tmpdir(), 'loan-tests-'))
const bundle = join(dir, 'bundle.mjs')

await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: bundle,
})

// 用子进程跑 node --test，退出码透传，避免 import.meta 相关干扰。
const result = spawnSync(process.execPath, ['--test', bundle], { stdio: 'inherit' })
rmSync(dir, { recursive: true, force: true })
process.exit(result.status ?? 1)

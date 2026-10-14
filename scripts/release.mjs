/**
 * 发布脚本：node scripts/release.mjs [patch|minor|major] [--notes "说明"]
 * 流程：升版本 → 构建 → npm pack → commit+tag → push → gh release create 上传产物 tgz
 * 依赖：gh CLI 已授权；git 远程已配置。
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { execSync } from 'node:child_process'

const args = process.argv.slice(2)
const bump = args.find((a) => ['patch', 'minor', 'major'].includes(a)) ?? 'patch'
const notesIdx = args.indexOf('--notes')
const notes = notesIdx >= 0 ? args[notesIdx + 1] : undefined

const sh = (cmd) => execSync(cmd, { stdio: 'inherit' })
const quiet = (cmd) => { try { return execSync(cmd).toString().trim() } catch { return null } }

// 1) 升版本
const pkgPath = 'package.json'
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const [a, b, c] = pkg.version.split('.').map(Number)
const next =
  bump === 'major' ? `${a + 1}.0.0` : bump === 'minor' ? `${a}.${b + 1}.0` : `${a}.${b}.${c + 1}`
pkg.version = next
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
console.log(`version: ${pkg.version} -> ${next}`)

// 2) 构建
sh('node scripts/build.mjs')

// 3) commit + tag（无改动时提交跳过）
if (quiet('git status --porcelain')) {
  sh(`git add -A`)
  sh(`git commit -m "v${next}"`)
}
quiet(`git tag v${next}`) ?? console.log(`tag v${next} already exists`)

// 4) push
sh('git push')
sh(`git push origin v${next}`)

// 5) npm pack（prepack 自动构建）
sh('npm pack')
const tgz = `dsh-skill-market-${next}.tgz`
if (!existsSync(tgz)) throw new Error(`pack 产物不存在: ${tgz}`)

// 6) GitHub Release
sh(`gh release create v${next} --title "v${next}" ${notes ? `--notes "${notes}"` : '--generate-notes'} "${tgz}"`)
unlinkSync(tgz)
console.log(`release v${next} done: ${tgz} 上传完成`)

/**
 * 本地预览服务器：mock 宿主外壳之外的"真实层"——
 * - 用真实插件服务端（lib/index.js）处理 /api/dsh-skill-market/* 请求
 * - DSH_HOME 指向 preview/.dsh-home 沙箱，不碰用户真实环境
 * - 静态服务 preview/（index.html + preview.js）
 * 用法：node scripts/preview.mjs [port]
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, extname } from 'node:path'

import dns from 'node:dns'
try {
  dns.setDefaultResultOrder('ipv4first')
} catch {}
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const port = Number(process.argv[2] ?? 4399)

// 预览沙箱：技能/登记/缓存全部落在这里
process.env.DSH_HOME = join(root, 'preview', '.dsh-home')

const plugin = await import(join(root, 'lib', 'index.js'))
let apiHandler = null
plugin.apply({
  effect: (cb) => cb(),
  emit: () => {},
  webServer: {
    register: (options) => {
      apiHandler = options.handler
    },
  },
})
if (!apiHandler) {
  console.error('插件未注册 API handler，先跑 node scripts/build.mjs')
  process.exit(1)
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
  if (url.pathname.startsWith('/api/')) {
    try {
      await apiHandler(req, res)
    } catch (error) {
      console.error('[preview] api error', error)
      if (!res.writableEnded) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: String(error) }))
      }
    }
    return
  }
  const file = url.pathname === '/' ? '/preview/index.html' : url.pathname
  const abs = join(root, file.replace(/^\/+/, ''))
  if (!abs.startsWith(root)) {
    res.writeHead(403).end('forbidden')
    return
  }
  try {
    const body = await readFile(abs)
    res.writeHead(200, { 'content-type': MIME[extname(abs)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404).end(`not found: ${file}`)
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`preview: http://127.0.0.1:${port}`)
  console.log(`DSH_HOME sandbox: ${process.env.DSH_HOME}`)
})

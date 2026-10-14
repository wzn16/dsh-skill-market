/**
 * 构建脚本：esbuild 打包服务端与客户端产物。
 * - lib/index.js：服务端（ESM、自含、零运行时依赖）
 * - client/client.js：客户端（__ModuleLoader__ 工厂包装，react 走宿主模块表）
 */
import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'

const SERVER_BANNER = `// dsh-skill-market server bundle (esbuild)`

const CLIENT_WRAPPER_OPEN = `window.__ModuleLoader__.load({ id: "dsh-skill-market", factory: (require) => {
var module = { exports: {} };
var exports = module.exports;
`
const CLIENT_WRAPPER_CLOSE = `
return module.exports;
}});`

await mkdir('lib', { recursive: true })

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  banner: { js: SERVER_BANNER },
  logLevel: 'info',
})

await build({
  entryPoints: ['client/index.tsx'],
  outfile: 'client/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
  banner: { js: CLIENT_WRAPPER_OPEN },
  footer: { js: CLIENT_WRAPPER_CLOSE },
  logLevel: 'info',
})

console.log('build done.')

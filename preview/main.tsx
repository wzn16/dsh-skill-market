/**
 * 本地预览引导：mock 宿主外壳（slots/locale 服务），真实加载插件客户端 bundle。
 * 三个容器分别渲染：主区面板（main）、设置内视图（settings.section）、
 * 插件管理页配置卡（plugins.bundle.config / settings.plugins.tab），
 * 侧边栏入口行（sidebar.panellist）插进模拟 rail。
 * 数据来自 scripts/preview.mjs 桥接的真实服务端（DSH_HOME 指向预览沙箱）。
 */
import { createElement as h, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { apply } from '../client/index.tsx'

type Comp = (props: unknown) => unknown

const railSlots: Array<{ label: () => string; icon: Comp }> = []
const mainPanels: Comp[] = []
const settingViews: Comp[] = []
const configCards: Comp[] = []

const readySlots = new Set<string>()

const slots = {
  inject(name: string, register: () => unknown): unknown {
    readySlots.add(name)
    try {
      return register()
    } catch (error) {
      console.error('[preview] slot inject failed:', name, error)
      return undefined
    }
  },
  register(meta: Record<string, unknown>, component: Comp): unknown {
    const name = String(meta.name ?? '')
    if (name === 'main') mainPanels.push(component)
    else if (name === 'settings.section') settingViews.push(component)
    else if (name === 'sidebar.panellist') {
      railSlots.push({ label: () => String((meta.label as () => string)?.() ?? '技能商店'), icon: component })
    } else if (name === 'plugins.bundle.config' || name === 'settings.plugins.tab' || name === 'settings.plugin.item') {
      configCards.push(component)
    }
    return () => {}
  },
  /** 让面板 probe 通过（真实宿主声明了这两个槽位） */
  spec(name: string): unknown {
    if (name === 'main' || name === 'sidebar.panellist') return { name }
    return readySlots.has(name) ? { name } : undefined
  },
}

const locale = {
  register(_ns: string, _dicts: unknown): unknown {
    return {}
  },
  subscribe(): () => void {
    return () => {}
  },
  getSnapshot(): { active: string } {
    return { active: 'zh' }
  },
}

const ctx = {
  effect(cb: () => unknown): unknown {
    return cb()
  },
  get(name: string): unknown {
    return name === 'slots' ? slots : undefined
  },
  slots,
  locale,
}

function render(): void {
  // 侧边栏入口行
  const railHost = document.getElementById('rail-panellist')
  if (railHost) {
    createRoot(railHost).render(
      h(
        StrictMode,
        null,
        railSlots.map((entry, index) =>
          h(
            'div',
            { key: index, className: 'rail-row active', title: entry.label() },
            h('span', { style: { display: 'inline-flex', width: 16, height: 16 } }, entry.icon({ size: 16 }) as never),
            h('span', null, entry.label()),
          ),
        ),
      ),
    )
  }
  const panelHost = document.getElementById('panel-host')
  if (panelHost) {
    createRoot(panelHost).render(
      h(StrictMode, null, mainPanels.map((Comp, index) => h('div', { key: index }, Comp({}) as never))),
    )
  }
  const settingsHost = document.getElementById('settings-frame')
  if (settingsHost) {
    createRoot(settingsHost).render(
      h(
        StrictMode,
        null,
        settingViews.map((Comp, index) => h('div', { key: `s${index}` }, Comp({}) as never)),
        configCards.map((Comp, index) => h('div', { key: `c${index}`, style: { marginTop: 16 } }, Comp({}) as never)),
      ),
    )
  }
  const meta = document.getElementById('meta')
  if (meta) {
    meta.textContent = `slots: ${[...readySlots].join(', ') || 'none'} · main×${mainPanels.length} · section×${settingViews.length} · config×${configCards.length} · rail×${railSlots.length}`
  }
  // 几何量化诊断（等 React 提交后采集，持续刷新以便对比切页前后）
  const collectDiag = (): void => {
    const diag = document.getElementById('diag')
    if (!diag) return
    const size = (el: Element | null): string => {
      if (!el) return 'none'
      const r = el.getBoundingClientRect()
      return `${Math.round(r.width)}x${Math.round(r.height)}`
    }
    const grid = document.querySelector('#panel-host .dsm-grid')
    const cols = grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0
    const card = document.querySelector('#panel-host .dsm-card')
    const featured = document.querySelector('#panel-host .dsm-featured')
    const panelRoot = document.querySelector('#panel-host .dsm-panel-root')
    const dsmRootMain = document.querySelector('#panel-host .dsm-root')
    const dsmRootSection = document.querySelector('#settings-frame .dsm-root')
    const mainEl = document.getElementById('main')
    const overflowX = mainEl && mainEl.scrollWidth > mainEl.clientWidth
    const canScroll = document.documentElement.scrollHeight > window.innerHeight
    const lines = [
      '几何诊断',
      `panel-root=${size(panelRoot)} main-root=${size(dsmRootMain)} section-root=${size(dsmRootSection)}`,
      `grid列数=${cols} 卡片=${size(card)} 卡片数=${document.querySelectorAll('#panel-host .dsm-card').length}`,
      `featured=${size(featured)} scrollW=${featured?.scrollWidth ?? 0} clientW=${featured?.clientWidth ?? 0}`,
      `水平溢出=${overflowX ? 'YES' : 'no'} 可滚动=${canScroll ? 'yes' : 'no'} 内容高=${document.documentElement.scrollHeight}`,
    ]
    diag.textContent = lines.join('\n')
    document.title = `[diag] cols=${cols} card=${size(card)} panel=${size(panelRoot)} mainRoot=${size(dsmRootMain)} secRoot=${size(dsmRootSection)} overflowX=${overflowX ? 'YES' : 'no'} scroll=${canScroll ? 'yes' : 'no'}`
  }
  setTimeout(collectDiag, 600)
  setInterval(collectDiag, 1000)
}

try {
  apply(ctx as never)
  render()
  console.info('[preview] boot ok')
} catch (error) {
  const box = document.getElementById('boot-error')
  if (box) {
    box.hidden = false
    box.textContent = `boot failed:\n${String(error)}\n${(error as Error)?.stack ?? ''}`
  }
  console.error('[preview] boot failed', error)
}

document.getElementById('theme-toggle')?.addEventListener('click', () => {
  const body = document.body
  body.dataset.theme = body.dataset.theme === 'dark' ? 'light' : 'dark'
})
document.getElementById('reload')?.addEventListener('click', () => location.reload())

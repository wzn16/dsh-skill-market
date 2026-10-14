/**
 * 设置对话框侧边栏导航图标：宿主 settings.section 槽位不提供 icon 字段，
 * 所有第三方 section 都显示齿轮兜底。挂一个 MutationObserver，
 * 找到自己的导航行（按可见文本匹配）后隐藏原 svg 并插入商店图标。
 * 语言切换导致 label 变化时由 observer 持续重新认领。
 */
import { zh, en } from './locales.ts'

const NAV_MARKER = 'data-dsm-nav-icon'
const NAV_ROW_SELECTOR = '[role="dialog"] nav button'

const SHOP_SVG = `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M2.5 5.2c0-.66.54-1.2 1.2-1.2h8.6c.66 0 1.2.54 1.2 1.2v7.1a1.2 1.2 0 0 1-1.2 1.2H3.7a1.2 1.2 0 0 1-1.2-1.2V5.2Z" stroke="currentColor" stroke-width="1.3"/>
<path d="M5.6 5V4a2.4 2.4 0 0 1 4.8 0v1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
<path d="M2.5 8h11" stroke="currentColor" stroke-width="1.3"/>
<path d="M6.2 7.4v1.2M9.8 7.4v1.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
</svg>`

function claimRows(): void {
  const labels = new Set([zh.nav, en.nav])
  const rows = document.querySelectorAll<HTMLButtonElement>(NAV_ROW_SELECTOR)
  for (const row of rows) {
    if (row.getAttribute(NAV_MARKER) === '1') continue
    const text = (row.textContent ?? '').trim()
    if (!labels.has(text)) continue
    const original = row.querySelector('svg')
    if (!original) continue
    original.style.display = 'none'
    const glyph = document.createElement('span')
    glyph.className = 'dsm-nav-glyph'
    glyph.innerHTML = SHOP_SVG
    row.prepend(glyph)
    row.setAttribute(NAV_MARKER, '1')
  }
}

/** 挂载导航图标认领器；返回清理函数（observer + 样式 + 标记还原） */
export function mountNavIcon(getLabel: () => string): () => void {
  if (typeof document === 'undefined') return () => {}
  const style = document.createElement('style')
  style.textContent = `.dsm-nav-glyph svg { color: currentColor; }`
  document.head.appendChild(style)

  const observer = new MutationObserver(() => {
    // label 用不到（双语言都认），保留 getLabel 以备未来单语言匹配
    void getLabel
    claimRows()
  })
  observer.observe(document.body, { childList: true, subtree: true })
  claimRows()

  return () => {
    observer.disconnect()
    style.remove()
    document.querySelectorAll(`[${NAV_MARKER}]`).forEach((row) => {
      row.removeAttribute(NAV_MARKER)
      row.querySelector('.dsm-nav-glyph')?.remove()
      const svg = row.querySelector('svg')
      if (svg) svg.style.display = ''
    })
  }
}

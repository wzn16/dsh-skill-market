const STYLE_ID = 'dsh-skill-market-styles'

/**
 * 自绘样式：不依赖宿主 ui-primitives，用中性半透明色适配深浅主题，
 * 类名统一 dsm- 前缀避免与宿主冲突。
 */
const CSS = `
.dsm-root { width: 100%; box-sizing: border-box; font-size: 13px; line-height: 1.5; color: inherit; min-height: 55vh; }
.dsm-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; grid-auto-rows: min-content; }
@media (max-width: 1100px) { .dsm-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 860px) { .dsm-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 560px) { .dsm-grid { grid-template-columns: 1fr; } }
.dsm-toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
.dsm-tabs { display: flex; gap: 4px; }
.dsm-tab { border: none; background: transparent; color: inherit; opacity: .65; padding: 5px 10px; border-radius: 8px; cursor: pointer; font-size: 13px; transition: background .15s, opacity .15s; }
.dsm-tab:hover { opacity: .9; background: rgba(127,127,127,.1); }
.dsm-tab[data-active="true"] { opacity: 1; background: rgba(127,127,127,.16); font-weight: 600; }
.dsm-search { flex: 1 1 160px; min-width: 140px; border: 1px solid rgba(127,127,127,.35); background: transparent; color: inherit; border-radius: 8px; padding: 5px 10px; font-size: 13px; transition: border-color .15s; }
.dsm-search:focus { outline: none; border-color: rgba(127,127,127,.7); }
.dsm-btn { border: 1px solid rgba(127,127,127,.35); background: transparent; color: inherit; border-radius: 8px; padding: 4px 10px; cursor: pointer; font-size: 12.5px; transition: background .15s, transform .1s; }
.dsm-btn:hover { background: rgba(127,127,127,.12); }
.dsm-btn:active { transform: scale(.97); }
.dsm-chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
.dsm-chip { border: 1px solid rgba(127,127,127,.3); background: transparent; color: inherit; opacity: .75; border-radius: 999px; padding: 3px 11px; cursor: pointer; font-size: 12.5px; }
.dsm-chip[data-active="true"] { opacity: 1; background: rgba(127,127,127,.18); font-weight: 600; }

.dsm-card { min-height: 150px; border: 1px solid rgba(127,127,127,.25); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 6px; cursor: pointer; transition: transform .15s, box-shadow .15s, border-color .15s; }
.dsm-card:hover { transform: translateY(-2px); border-color: rgba(127,127,127,.55); box-shadow: 0 6px 18px rgba(0,0,0,.09); }
.dsm-card-head { display: flex; align-items: center; gap: 10px; }
.dsm-icon-wrap { width: 38px; height: 38px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 21px; flex-shrink: 0; }
.dsm-cat-docs { background: rgba(230,72,77,.13); }
.dsm-cat-office { background: rgba(60,130,246,.14); }
.dsm-cat-dev { background: rgba(150,90,240,.16); }
.dsm-cat-content { background: rgba(240,140,40,.16); }
.dsm-cat-meta { background: rgba(70,170,110,.15); }
.dsm-icon { font-size: 22px; line-height: 1; }
.dsm-name { font-weight: 600; font-size: 13.5px; }
.dsm-repo { opacity: .55; font-size: 11.5px; }
.dsm-desc { opacity: .8; font-size: 12.5px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 2.6em; }
.dsm-card-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 2px; }
.dsm-badge { font-size: 11px; border-radius: 999px; padding: 2px 8px; background: rgba(127,127,127,.16); opacity: .85; }
.dsm-notice { font-size: 12px; opacity: .55; margin: 4px 0 10px; }
.dsm-empty { opacity: .55; text-align: center; padding: 36px 0; }
.dsm-error { border: 1px solid rgba(229,72,77,.4); color: #e5484d; border-radius: 10px; padding: 10px 12px; margin-bottom: 10px; font-size: 12.5px; display: flex; gap: 10px; align-items: center; }
.dsm-detail { border: 1px solid rgba(127,127,127,.3); border-radius: 12px; padding: 16px; }
.dsm-detail-head { display: flex; align-items: flex-start; gap: 12px; }
.dsm-detail-title { display: flex; flex-direction: column; gap: 2px; flex: 1; }
.dsm-detail-name { font-size: 16px; font-weight: 700; }
.dsm-kv { font-size: 12.5px; opacity: .75; margin-top: 10px; display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; }
.dsm-kv b { font-weight: 600; opacity: .8; }
.dsm-body { margin-top: 12px; border-top: 1px solid rgba(127,127,127,.2); padding-top: 10px; font-size: 12.5px; opacity: .85; white-space: pre-wrap; max-height: 260px; overflow: auto; }
.dsm-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; border: 1px solid rgba(127,127,127,.25); border-radius: 10px; padding: 10px 12px; margin-bottom: 8px; transition: border-color .15s; }
.dsm-row:hover { border-color: rgba(127,127,127,.5); }
.dsm-row-main { flex: 1; min-width: 0; }
.dsm-row-name { font-weight: 600; }
.dsm-row-desc { opacity: .7; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsm-row-actions { display: flex; gap: 6px; flex-shrink: 0; }
.dsm-toast { position: fixed; right: 18px; bottom: 18px; background: rgba(30,30,30,.92); color: #fff; border-radius: 10px; padding: 9px 14px; font-size: 12.5px; z-index: 9999; max-width: 380px; }
.dsm-section-title { font-weight: 700; font-size: 13.5px; margin: 4px 0 8px; }
.dsm-featured-wrap { margin-bottom: 14px; }
.dsm-featured { display: grid; grid-auto-flow: column; grid-auto-columns: 260px; gap: 10px; overflow-x: auto; padding-bottom: 6px; }
.dsm-featured-card { border: 1px solid rgba(127,127,127,.3); border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 8px; cursor: pointer; background: linear-gradient(160deg, rgba(127,127,127,.07), rgba(127,127,127,.02)); transition: transform .15s, box-shadow .15s, border-color .15s; }
.dsm-featured-card:hover { transform: translateY(-2px); border-color: rgba(127,127,127,.6); box-shadow: 0 6px 18px rgba(0,0,0,.1); }
.dsm-catbar { display: flex; gap: 2px; flex-wrap: wrap; margin-bottom: 12px; border-bottom: 1px solid rgba(127,127,127,.18); padding-bottom: 8px; }
.dsm-cat { border: none; background: transparent; color: inherit; opacity: .6; padding: 6px 12px; border-radius: 8px; cursor: pointer; font-size: 13px; }
.dsm-cat:hover { opacity: .9; }
.dsm-cat[data-active="true"] { opacity: 1; font-weight: 700; background: rgba(127,127,127,.14); }
.dsm-repobar { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
.dsm-badge[data-kind="on"] { background: rgba(70,160,90,.22); opacity: 1; }
.dsm-badge[data-kind="off"] { background: rgba(127,127,127,.22); opacity: .7; }
.dsm-badge[data-kind="update"] { background: rgba(230,150,40,.25); opacity: 1; }
.dsm-badge[data-kind="star"] { background: rgba(240,180,40,.2); opacity: 1; }
.dsm-issues { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; font-size: 11.5px; color: #c2841a; }
.dsm-link { color: inherit; text-decoration: underline; text-decoration-color: rgba(127,127,127,.4); text-underline-offset: 3px; }
.dsm-link:hover { text-decoration-color: currentColor; }
.dsm-source-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; width: 100%; }
.dsm-source-row { display: flex; align-items: center; gap: 10px; border: 1px solid rgba(127,127,127,.22); border-radius: 10px; padding: 8px 12px; flex-wrap: wrap; width: 100%; box-sizing: border-box; }
.dsm-source-row .dsm-repo { flex: 1; min-width: 0; }
.dsm-setting-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 4px 0; }
.dsm-setting-main { flex: 1; min-width: 0; }
.dsm-switch { position: relative; width: 40px; height: 22px; border-radius: 999px; border: none; background: rgba(127,127,127,.3); cursor: pointer; transition: background .15s; flex-shrink: 0; padding: 0; }
.dsm-switch[data-on="true"] { background: rgba(70,160,90,.85); }
.dsm-switch[disabled] { opacity: .5; cursor: default; }
.dsm-switch-knob { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.25); transition: left .15s; }
.dsm-switch[data-on="true"] .dsm-switch-knob { left: 20px; }
/* 侧边栏导航图标（替换宿主齿轮兜底） */
.dsm-nav-glyph { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; flex-shrink: 0; }
.dsm-nav-glyph svg { width: 16px; height: 16px; display: block; }
.dsm-panel-root { padding: 28px 32px; max-width: 1080px; margin: 0 auto; }
`

export function mountStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = CSS
    document.head.appendChild(style)
  }
  return () => {
    style?.remove()
  }
}

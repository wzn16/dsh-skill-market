import { createElement as h, useEffect, useState } from 'react'
import { getJSON, postJSON } from './api.ts'
import { zh } from './locales.ts'

/**
 * 插件管理页的自有配置卡片（侧边栏「插件」→ dsh-skill-market）。
 * 目前提供：设置侧边栏「技能商店」入口开关。
 */
export function SettingsCard({ onShowEntryChange }: { onShowEntryChange: (show: boolean) => void }): React.ReactElement {
  const d = zh
  const [showEntry, setShowEntry] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    getJSON<{ showEntry: boolean }>('api/dsh-skill-market/config')
      .then((config) => {
        setShowEntry(config.showEntry !== false)
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])

  const flip = async (): Promise<void> => {
    const next = !showEntry
    setShowEntry(next)
    onShowEntryChange(next)
    try {
      await postJSON('api/dsh-skill-market/config', { showEntry: next })
      setSaveError('')
    } catch (error) {
      // 反馈闭环：失败必须可见，且回滚到真实状态
      setSaveError(String((error as Error).message ?? error))
      setShowEntry(!next)
      onShowEntryChange(!next)
    }
  }

  return h(
    'div',
    { className: 'dsm-root' },
    h('div', { className: 'dsm-setting-row' },
      h('div', { className: 'dsm-setting-main' },
        h('div', { className: 'dsm-row-name' }, d.settingEntryTitle),
        h('div', { className: 'dsm-row-desc' }, d.settingEntryDesc),
      ),
      saveError ? h('div', { className: 'dsm-issues', role: 'alert' }, `⚠ ${saveError}`) : null,
      h('button', {
        className: 'dsm-switch',
        role: 'switch',
        'aria-checked': showEntry,
        'data-on': showEntry,
        disabled: !loaded,
        onClick: () => void flip(),
      }, h('span', { className: 'dsm-switch-knob' })),
    ),
  )
}

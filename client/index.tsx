/**
 * dsh-skill-market client：注册设置页「技能商店」section + 插件管理页配置卡片。
 * 依赖宿主 slots/locale 服务与 react（经 loader 模块表解析），UI 自绘样式，
 * 不依赖 ui-primitives，老宿主降级友好。
 *
 * 入口显隐：读服务端 config.showEntry，配置卡片切换后实时 mount/unmount
 * （slots.register 可能不返回 disposer，gate 做了防护）。
 *
 * 配置卡片与 dsh-market 同构三 seat（对齐宿主不同版本的槽位契约）：
 * - settings.plugin.item（旧线，嵌套 settingsScope）
 * - plugins.bundle.config（0.1.7+，key=bundle 包名，view==='summary' 时不渲染）
 * - settings.plugins.tab（0.1.7 线，设置→插件 里的一个 tab）
 */
import { createElement as h } from 'react'
import { App } from './App.tsx'
import { mountNavIcon } from './nav-icon.ts'
import { SettingsCard } from './SettingsCard.tsx'
import { NS, en, zh } from './locales.ts'
import { mountStyles } from './styles.ts'

interface LocaleService {
  register(
    namespace: string,
    dicts: { zh: Record<string, unknown>; en: Record<string, unknown> },
  ): unknown
  subscribe(callback: () => void): () => void
  getSnapshot(): { active: string }
}

interface SlotsService {
  inject(slot: string, register: () => unknown): void
  register(meta: Record<string, unknown>, component: (props: unknown) => unknown): unknown
}

export interface ClientContext {
  effect(callback: () => unknown, label?: string): unknown
  /** 嵌套服务注入（cordis 对象式；旧宿主无此方法时相应功能跳过） */
  inject?(services: string[], callback: (scoped: unknown) => void): void
  locale: LocaleService
  slots: SlotsService
}

interface SettingsScopeHost {
  slots: SlotsService
}

/** bundle 包名（dsh plugin add 的名字；plugins.bundle.config 槽位按它 dispatch） */
const PACKAGE_NAME = 'dsh-skill-market'

export const name = PACKAGE_NAME
export const inject = ['slots', 'locale']

function snapshotLang(locale: LocaleService): 'zh' | 'en' {
  try {
    return locale.getSnapshot()?.active?.startsWith('zh') ? 'zh' : 'en'
  } catch {
    return 'zh'
  }
}

/** section 显隐 gate：register 可能不返回 disposer，全部做防护 */
function createSectionGate(ctx: ClientContext) {
  let disposer: unknown = null
  let mounted = false
  return {
    mount(): void {
      if (mounted) return
      mounted = true
      disposer = ctx.slots.register(
        {
          name: 'settings.section',
          id: 'skill-market',
          order: 55,
          label: () => (snapshotLang(ctx.locale) === 'zh' ? zh.nav : en.nav),
          locale: NS,
          inject: () => ({}),
        },
        () => h(App, { locale: ctx.locale }),
      )
    },
    unmount(): void {
      if (!mounted) return
      if (typeof disposer === 'function') (disposer as () => void)()
      disposer = null
      mounted = false
    },
  }
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), `${NS}: dictionaries`)
  ctx.effect(() => mountStyles(), `${NS}: styles`)
  ctx.effect(() => mountNavIcon(() => (snapshotLang(ctx.locale) === 'zh' ? zh.nav : en.nav)), `${NS}: nav icon`)

  const gate = createSectionGate(ctx)
  // 默认先挂上（与 config 默认值一致），配置读回后校正
  ctx.slots.inject('settings.section', () => gate.mount())
  void import('./api.ts')
    .then(({ getJSON }) => getJSON<{ showEntry: boolean }>('api/dsh-skill-market/config'))
    .then((config) => {
      if (config.showEntry === false) gate.unmount()
    })
    .catch(() => {})

  const card = () => h(SettingsCard, { onShowEntryChange: (show: boolean) => (show ? gate.mount() : gate.unmount()) })

  // seat 1（旧线）：settings.plugin.item，嵌套 settingsScope
  if (typeof ctx.inject === 'function') {
    ctx.inject(['settingsScope'], (scopedUnknown) => {
      const scoped = scopedUnknown as SettingsScopeHost
      scoped.slots.inject('settings.plugin.item', () =>
        scoped.slots.register(
          { name: 'settings.plugin.item', key: NS, locale: NS, inject: () => ({}) },
          card,
        ),
      )
    })
  }

  // seat 2（0.1.7+）：plugins.bundle.config —— 插件管理页 bundle 详情页的配置卡
  ctx.slots.inject('plugins.bundle.config', () =>
    ctx.slots.register(
      { name: 'plugins.bundle.config', key: PACKAGE_NAME, locale: NS, inject: () => ({}) },
      (ownerPropsUnknown: unknown) => {
        const ownerProps = (ownerPropsUnknown ?? {}) as { view?: string }
        return ownerProps.view === 'summary' ? null : card()
      },
    ),
  )

  // seat 3（0.1.7 线）：settings.plugins.tab —— 设置→插件 section 里的 tab
  ctx.slots.inject('settings.plugins.tab', () =>
    ctx.slots.register(
      {
        name: 'settings.plugins.tab',
        id: NS,
        order: 60,
        label: () => (snapshotLang(ctx.locale) === 'zh' ? zh.nav : en.nav),
        locale: NS,
        inject: () => ({}),
      },
      card,
    ),
  )
}

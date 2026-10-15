import { useCallback, useEffect, useState } from 'react'
import { getJSON, postJSON } from './api.ts'
import { en, zh, type Dict } from './locales.ts'

interface LocaleService {
  subscribe(callback: () => void): () => void
  getSnapshot(): { active: string }
}

export interface RepoRef {
  owner: string
  name: string
  ref: string
  path: string
}

export interface RegistryEntry {
  name: string
  description: string
  category: string
  tags: string[]
  repo: RepoRef
  icon?: string
  featured?: boolean
  stars?: number
}

export interface Registry {
  version: number
  updatedAt: string
  categories: { id: string; label: string }[]
  skills: RegistryEntry[]
}

export interface InstalledSkill {
  name: string
  description: string
  hasFrontmatter: boolean
  enabled: boolean
  fromMarket: boolean
  issues: string[]
  repo?: RepoRef
  commitSha?: string
  installedAt?: string
}

export interface TrashItem {
  trashId: string
  name: string
  removedAt: string
}

export interface UpdateStatus {
  name: string
  updateAvailable: boolean
  checkFailed: boolean
}

export interface SourceRecord {
  id: string
  owner: string
  name: string
  ref: string
  addedAt: string
}

/** browse-repo 返回的仓库内扫描技能 */
export interface RepoSkill {
  path: string
  name: string
  description: string
  fileCount: number
}

type Tab = 'browse' | 'sources' | 'installed' | 'trash'

interface ConfirmState {
  text: string
  danger?: boolean
  run: () => void
}

function snapshotLang(locale: LocaleService | undefined): 'zh' | 'en' {
  try {
    return locale?.getSnapshot()?.active?.startsWith('zh') === true ? 'zh' : 'en'
  } catch {
    return 'zh'
  }
}

function IconWrap({ category, icon, big }: { category: string; icon?: string; big?: boolean }): React.ReactElement {
  return (
    <span
      className={'dsm-icon-wrap dsm-cat-' + (category || 'meta')}
      style={big ? { width: 48, height: 48, fontSize: 27, borderRadius: 13 } : undefined}
    >
      <span className="dsm-icon">{icon ?? '🧩'}</span>
    </span>
  )
}

/** star 数人性化：181006 → 18.1w，2980 → 2.9k */
function fmtStars(n: number): string {
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + 'w'
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(n)
}

const ISSUE_TEXT: Record<string, (d: Dict) => string> = {
  'missing-frontmatter': (d) => d.issueMissingFrontmatter,
  'name-mismatch': (d) => d.issueNameMismatch,
  'missing-description': (d) => d.issueMissingDescription,
  'short-description': (d) => d.issueShortDescription,
}

function issueText(d: Dict, code: string): string {
  return ISSUE_TEXT[code]?.(d) ?? code
}

export function App({ locale }: { locale?: LocaleService }): React.ReactElement {
  const [lang, setLang] = useState<'zh' | 'en'>(() => snapshotLang(locale))
  useEffect(() => {
    if (!locale?.subscribe) return
    return locale.subscribe(() => setLang(snapshotLang(locale)))
  }, [locale])
  const d: Dict = lang === 'zh' ? zh : en

  const [tab, setTab] = useState<Tab>('browse')
  const [registry, setRegistry] = useState<Registry | null>(null)
  const [registrySource, setRegistrySource] = useState('')
  const [installed, setInstalled] = useState<InstalledSkill[]>([])
  const [trash, setTrash] = useState<TrashItem[]>([])
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [toast, setToast] = useState('')
  const [detail, setDetail] = useState<RegistryEntry | null>(null)
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)
  const [updates, setUpdates] = useState<Map<string, UpdateStatus>>(new Map())
  const [checking, setChecking] = useState(false)
  const [repoInput, setRepoInput] = useState('')
  const [repoSkills, setRepoSkills] = useState<RepoSkill[] | null>(null)
  const [repoLoading, setRepoLoading] = useState(false)
  const [repoRef, setRepoRef] = useState<{ owner: string; name: string } | null>(null)
  const [sources, setSources] = useState<SourceRecord[] | null>(null)
  const [builtinSources, setBuiltinSources] = useState<
    { owner: string; name: string; label: string }[] | null
  >(null)
  const [hiddenBuiltins, setHiddenBuiltins] = useState<string[]>([])

  const loadAll = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      const [reg, inst, tr, src] = await Promise.all([
        getJSON<{ registry: Registry; source: string }>('api/dsh-skill-market/registry'),
        getJSON<InstalledSkill[]>('api/dsh-skill-market/installed'),
        getJSON<TrashItem[]>('api/dsh-skill-market/trash'),
        getJSON<{
          builtin: { owner: string; name: string; label: string }[]
          hiddenBuiltins?: string[]
          custom: SourceRecord[]
        }>('api/dsh-skill-market/sources').catch(() => null),
      ])
      setRegistry(reg.registry)
      setRegistrySource(reg.source)
      setInstalled(inst)
      setTrash(tr)
      if (src) {
        setSources(src.custom)
        setBuiltinSources(src.builtin)
        setHiddenBuiltins(src.hiddenBuiltins ?? [])
      }
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(''), 2600)
    return () => clearTimeout(id)
  }, [toast])

  const installedNames = new Set(installed.map((s) => s.name.toLowerCase()))

  const install = async (repo: RepoRef, displayName: string): Promise<void> => {
    setBusy(displayName)
    setError('')
    try {
      const result = await postJSON<{ name: string; fileCount: number }>(
        'api/dsh-skill-market/install',
        repo,
      )
      setToast(`${d.installedBadge} · ${result.name} (${d.detailFiles(result.fileCount)})`)
      setInstalled(await getJSON<InstalledSkill[]>('api/dsh-skill-market/installed'))
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setBusy('')
    }
  }

  const uninstall = async (name: string): Promise<void> => {
    setBusy(name)
    setError('')
    try {
      await postJSON('api/dsh-skill-market/uninstall', { name })
      setInstalled(await getJSON<InstalledSkill[]>('api/dsh-skill-market/installed'))
      setTrash(await getJSON<TrashItem[]>('api/dsh-skill-market/trash'))
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setBusy('')
    }
  }

  const toggle = async (name: string, enabled: boolean): Promise<void> => {
    setBusy(name)
    setError('')
    try {
      await postJSON('api/dsh-skill-market/toggle', { name, enabled })
      setInstalled(await getJSON<InstalledSkill[]>('api/dsh-skill-market/installed'))
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setBusy('')
    }
  }

  const checkUpdates = async (): Promise<void> => {
    setChecking(true)
    setError('')
    try {
      const statuses = await getJSON<UpdateStatus[]>('api/dsh-skill-market/check-updates')
      setUpdates(new Map(statuses.map((s) => [s.name, s])))
      const available = statuses.filter((s) => s.updateAvailable).length
      const failed = statuses.filter((s) => s.checkFailed).length
      if (failed > 0) setToast(d.updateFailCheck)
      else setToast(available > 0 ? `${d.updateAvailable} × ${available}` : d.upToDateToast)
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setChecking(false)
    }
  }

  const updateSkill = async (name: string): Promise<void> => {
    setBusy(name)
    setError('')
    try {
      const result = await postJSON<{ updated: boolean; fileCount?: number; reason?: string }>(
        'api/dsh-skill-market/update',
        { name },
      )
      setToast(result.updated ? `${d.updateDone} · ${name}` : `${name}: ${result.reason}`)
      setInstalled(await getJSON<InstalledSkill[]>('api/dsh-skill-market/installed'))
      setUpdates((prev) => {
        const next = new Map(prev)
        next.delete(name)
        return next
      })
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setBusy('')
    }
  }

  const browseSource = async (owner: string, name: string, ref = 'main'): Promise<void> => {
    setRepoLoading(true)
    setError('')
    try {
      const result = await getJSON<{ skills: RepoSkill[] }>(
        `api/dsh-skill-market/browse-repo?owner=${encodeURIComponent(owner)}&name=${encodeURIComponent(name)}&ref=${encodeURIComponent(ref)}`,
      )
      setRepoSkills(result.skills)
      setRepoRef({ owner, name })
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setRepoLoading(false)
    }
  }

  const addSource = async (): Promise<void> => {
    const input = repoInput.trim()
    if (!input) {
      setError(d.sourcesAddPlaceholder)
      return
    }
    setRepoLoading(true)
    setError('')
    try {
      const added = await postJSON<SourceRecord & { skillCount: number }>(
        'api/dsh-skill-market/sources/add',
        { repo: input },
      )
      setToast(`${d.sourcesAdd} · ${added.owner}/${added.name} (${d.sourcesCount(added.skillCount)})`)
      setRepoInput('')
      const src = await getJSON<{ custom: SourceRecord[] }>('api/dsh-skill-market/sources')
      setSources(src.custom)
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setRepoLoading(false)
    }
  }

  const hideBuiltin = async (owner: string, name: string): Promise<void> => {
    setBusy(name)
    setError('')
    try {
      await postJSON('api/dsh-skill-market/sources/builtin/hide', { owner, name })
      const src = await getJSON<{ builtin: typeof builtinSources; hiddenBuiltins: string[]; custom: SourceRecord[] }>(
        'api/dsh-skill-market/sources',
      )
      setBuiltinSources(src.builtin)
      setHiddenBuiltins(src.hiddenBuiltins ?? [])
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setBusy('')
    }
  }

  const restoreBuiltin = async (owner: string, name: string): Promise<void> => {
    setBusy(name)
    setError('')
    try {
      await postJSON('api/dsh-skill-market/sources/builtin/restore', { owner, name })
      const src = await getJSON<{ builtin: typeof builtinSources; hiddenBuiltins: string[] }>(
        'api/dsh-skill-market/sources',
      )
      setBuiltinSources(src.builtin)
      setHiddenBuiltins(src.hiddenBuiltins ?? [])
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setBusy('')
    }
  }

  const removeSource = async (owner: string, name: string): Promise<void> => {
    setBusy(name)
    setError('')
    try {
      await postJSON('api/dsh-skill-market/sources/remove', { owner, name })
      const src = await getJSON<{ custom: SourceRecord[] }>('api/dsh-skill-market/sources')
      setSources(src.custom)
      if (repoRef?.owner === owner && repoRef.name === name) {
        setRepoSkills(null)
        setRepoRef(null)
      }
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setBusy('')
    }
  }

  const restore = async (trashId: string): Promise<void> => {
    setBusy(trashId)
    setError('')
    try {
      await postJSON('api/dsh-skill-market/trash-restore', { trashId })
      setInstalled(await getJSON<InstalledSkill[]>('api/dsh-skill-market/installed'))
      setTrash(await getJSON<TrashItem[]>('api/dsh-skill-market/trash'))
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setBusy('')
    }
  }

  const purge = async (trashId: string): Promise<void> => {
    setBusy(trashId)
    setError('')
    try {
      await postJSON('api/dsh-skill-market/trash-purge', { trashId })
      setTrash(await getJSON<TrashItem[]>('api/dsh-skill-market/trash'))
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setBusy('')
    }
  }

  const q = query.trim().toLowerCase()
  const all = registry?.skills ?? []
  const featured = all.filter((s) => s.featured)
  const filtered = all
    .filter(
      (s) =>
        (category === 'all' || s.category === category) &&
        (!q ||
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.tags.some((tag) => tag.toLowerCase().includes(q))),
    )
    .sort((a, b) => Number(b.featured ?? false) - Number(a.featured ?? false))

  const categories = [
    { id: 'all', label: d.all },
    ...(registry?.categories ?? []).map((c) => ({ id: c.id, label: lang === 'zh' ? c.label : c.id })),
  ]

  return (
    <div className="dsm-root">
      <div className="dsm-toolbar">
        <div className="dsm-tabs">
          {(
            [
              ['browse', d.tabBrowse],
              ['sources', d.tabSources],
              ['installed', d.tabInstalled],
              ['trash', d.tabTrash],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              className="dsm-tab"
              data-active={tab === id}
              onClick={() => {
                setTab(id)
                setDetail(null)
              }}
            >
              {label}
              {id === 'installed' && installed.length > 0 ? ` (${installed.length})` : ''}
              {id === 'trash' && trash.length > 0 ? ` (${trash.length})` : ''}
            </button>
          ))}
        </div>
        {tab === 'browse' && (
          <input
            className="dsm-search"
            placeholder={d.searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
        <button className="dsm-btn" onClick={() => void loadAll()} disabled={loading}>
          {d.refresh}
        </button>
      </div>

      {error ? (
        <div className="dsm-error">
          <span>
            {d.errorTitle}: {error}
          </span>
          <button className="dsm-btn" onClick={() => void loadAll()}>
            {d.retry}
          </button>
        </div>
      ) : null}

      {confirmState ? (
        <div className="dsm-error" style={{ color: 'inherit', borderColor: 'rgba(127,127,127,.5)' }}>
          <span style={{ flex: 1 }}>{confirmState.text}</span>
          <button
            className="dsm-btn"
            data-danger={confirmState.danger}
            onClick={() => {
              confirmState.run()
              setConfirmState(null)
            }}
          >
            {confirmState.danger ? d.purge : d.uninstall}
          </button>
          <button className="dsm-btn" onClick={() => setConfirmState(null)}>
            {d.close}
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="dsm-empty">…</div>
      ) : tab === 'browse' ? (
        detail ? (
          <DetailPanel
            entry={detail}
            d={d}
            busy={busy === detail.name}
            alreadyInstalled={installedNames.has(detail.name.toLowerCase())}
            onBack={() => setDetail(null)}
            onInstall={() => void install(detail.repo, detail.name)}
          />
        ) : (
          <>
            {registrySource === 'seed' ? <div className="dsm-notice">{d.registrySeedNotice}</div> : null}

            {/* 精选横排大卡（WorkBuddy 式） */}
            {category === 'all' && !q && featured.length > 0 ? (
              <div className="dsm-featured-wrap">
                <div className="dsm-section-title">★ {d.featured}</div>
                <div className="dsm-featured">
                  {featured.map((entry) => {
                    const isIn = installedNames.has(entry.name.toLowerCase())
                    return (
                      <div
                        key={`f-${entry.name}`}
                        className="dsm-featured-card"
                        onClick={() => setDetail(entry)}
                      >
                        <div className="dsm-card-head">
                          <IconWrap category={entry.category} icon={entry.icon} />
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <div className="dsm-name">{entry.name}</div>
                            <div className="dsm-repo">
                              {entry.repo.owner}/{entry.repo.name}
                              {typeof entry.stars === 'number' ? ` · ★ ${fmtStars(entry.stars)}` : ''}
                            </div>
                          </span>
                        </div>
                        <div className="dsm-desc">{entry.description || d.noDescription}</div>
                        <div className="dsm-card-foot">
                          <span className="dsm-badge">
                            {categoryLabel(registry, entry.category, lang)}
                          </span>
                          {isIn ? (
                            <span className="dsm-badge">{d.installedBadge}</span>
                          ) : (
                            <button
                              className="dsm-btn"
                              data-primary="true"
                              disabled={busy !== ''}
                              onClick={(e) => {
                                e.stopPropagation()
                                void install(entry.repo, entry.name)
                              }}
                            >
                              {busy === entry.name ? d.installing : d.install}
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : null}

            {/* 分类 tab 条 */}
            <div className="dsm-catbar">
              {categories.map((c) => (
                <button
                  key={c.id}
                  className="dsm-cat"
                  data-active={category === c.id}
                  onClick={() => setCategory(c.id)}
                >
                  {c.label}
                </button>
              ))}
            </div>

            {/* 全部技能网格 */}
            {filtered.length === 0 ? (
              <div className="dsm-empty">{d.emptyBrowse}</div>
            ) : (
              <div className="dsm-grid">
                {filtered.map((entry) => {
                  const isIn = installedNames.has(entry.name.toLowerCase())
                  return (
                    <div key={entry.name + entry.repo.path} className="dsm-card" onClick={() => setDetail(entry)}>
                      <div className="dsm-card-head">
                        <IconWrap category={entry.category} icon={entry.icon} />
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <div className="dsm-name">{entry.name}</div>
                          <div className="dsm-repo">
                            {entry.repo.owner}/{entry.repo.name}
                            {typeof entry.stars === 'number' ? ` · ★ ${fmtStars(entry.stars)}` : ''}
                          </div>
                        </span>
                        {entry.featured ? <span className="dsm-badge">★ {d.featured}</span> : null}
                      </div>
                      <div className="dsm-desc">{entry.description || d.noDescription}</div>
                      <div className="dsm-card-foot">
                        <span className="dsm-badge">
                          {categoryLabel(registry, entry.category, lang)}
                        </span>
                        {isIn ? (
                          <span className="dsm-badge">{d.installedBadge}</span>
                        ) : (
                          <button
                            className="dsm-btn"
                            data-primary="true"
                            disabled={busy !== ''}
                            onClick={(e) => {
                              e.stopPropagation()
                              void install(entry.repo, entry.name)
                            }}
                          >
                            {busy === entry.name ? d.installing : d.install}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )
      ) : tab === 'sources' ? (
        <>
            {/* 货架来源（透明化 + 自定义源管理） */}
            <div className="dsm-section-title">{d.sourcesTitle}</div>
            <div className="dsm-source-list">
              {(builtinSources ?? []).map((b) => (
                <div key={b.owner + b.name} className="dsm-source-row">
                  <span className="dsm-badge">{d.sourcesBuiltin}</span>
                  <a
                    className="dsm-link"
                    href={`https://github.com/${b.owner}/${b.name}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {b.owner}/{b.name}
                  </a>
                  <span className="dsm-repo">{b.label}</span>
                  <div className="dsm-row-actions">
                    <button
                      className="dsm-btn"
                      onClick={() => void browseSource(b.owner, b.name)}
                      disabled={repoLoading}
                    >
                      {d.browse}
                    </button>
                    <button
                      className="dsm-btn"
                      data-danger="true"
                      disabled={busy !== ''}
                      onClick={() => void hideBuiltin(b.owner, b.name)}
                    >
                      {d.sourcesRemove}
                    </button>
                  </div>
                </div>
              ))}
              {(hiddenBuiltins ?? []).length > 0
                ? hiddenBuiltins.map((key) => {
                    const [owner, name] = key.split('/')
                    return (
                      <div key={`h-${key}`} className="dsm-source-row" style={{ opacity: 0.55 }}>
                        <span className="dsm-badge">{d.sourcesHidden}</span>
                        <span className="dsm-link">{key}</span>
                        <div className="dsm-row-actions">
                          <button
                            className="dsm-btn"
                            disabled={busy !== ''}
                            onClick={() => void restoreBuiltin(owner, name)}
                          >
                            {d.sourcesRestore}
                          </button>
                        </div>
                      </div>
                    )
                  })
                : null}
              {(sources ?? []).map((s) => (
                <div key={s.id} className="dsm-source-row">
                  <span className="dsm-badge">{d.sourcesCustom}</span>
                  <a
                    className="dsm-link"
                    href={`https://github.com/${s.owner}/${s.name}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {s.owner}/{s.name}
                  </a>
                  <div className="dsm-row-actions">
                    <button
                      className="dsm-btn"
                      onClick={() => void browseSource(s.owner, s.name, s.ref)}
                      disabled={repoLoading}
                    >
                      {d.browse}
                    </button>
                    <button
                      className="dsm-btn"
                      data-danger="true"
                      disabled={busy !== ''}
                      onClick={() => void removeSource(s.owner, s.name)}
                    >
                      {d.sourcesRemove}
                    </button>
                  </div>
                </div>
              ))}
              {sources !== null && sources.length === 0 ? (
                <div className="dsm-notice">{d.sourcesEmpty}</div>
              ) : null}
            </div>
            <div className="dsm-repobar">
              <input
                className="dsm-search"
                style={{ flex: '0 1 280px' }}
                placeholder={d.sourcesAddPlaceholder}
                value={repoInput}
                onChange={(e) => setRepoInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void addSource()
                }}
              />
              <button className="dsm-btn" onClick={() => void addSource()} disabled={repoLoading}>
                {repoLoading ? '…' : d.sourcesAdd}
              </button>
              {repoRef && repoSkills ? (
                <button
                  className="dsm-btn"
                  onClick={() => {
                    setRepoSkills(null)
                    setRepoRef(null)
                  }}
                >
                  {d.back}
                </button>
              ) : null}
            </div>
            {repoRef && repoSkills ? (
              repoSkills.length === 0 ? (
                <div className="dsm-notice">{d.noSkillsInRepo}</div>
              ) : (
                <div style={{ marginBottom: 14 }}>
                  <div className="dsm-notice">
                    {repoRef?.owner}/{repoRef?.name} · {d.repoSkills(repoSkills.length)}
                  </div>
                  {repoSkills.map((rs) => {
                    const isIn = installedNames.has(rs.name.toLowerCase())
                    return (
                      <div key={rs.path || rs.name} className="dsm-row">
                        <div className="dsm-row-main">
                          <div className="dsm-row-name">{rs.name || rs.path || '(root)'}</div>
                          <div className="dsm-row-desc">{rs.description || d.noDescription}</div>
                        </div>
                        <div className="dsm-row-actions">
                          {isIn ? (
                            <span className="dsm-badge">{d.installedBadge}</span>
                          ) : (
                            <button
                              className="dsm-btn"
                              data-primary="true"
                              disabled={busy !== ''}
                              onClick={() =>
                                void install(
                                  {
                                    owner: repoRef!.owner,
                                    name: repoRef!.name,
                                    ref: 'main',
                                    path: rs.path,
                                  },
                                  rs.name || rs.path,
                                )
                              }
                            >
                              {busy === (rs.name || rs.path) ? d.installing : d.install}
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            ) : null}

        </>
      ) : tab === 'installed' ? (
        <>
          <div className="dsm-toolbar">
            <button className="dsm-btn" onClick={() => void checkUpdates()} disabled={checking}>
              {checking ? d.checking : d.checkUpdates}
            </button>
            {updates.size > 0 ? (
              <span className="dsm-badge">
                {d.updateAvailable} × {Array.from(updates.values()).filter((s) => s.updateAvailable).length}
              </span>
            ) : null}
          </div>
          {installed.length === 0 ? (
            <div className="dsm-empty">{d.emptyInstalled}</div>
          ) : (
            installed.map((s) => {
              const st = updates.get(s.name)
              return (
                <div key={s.name} className="dsm-row">
                  <div className="dsm-row-main">
                    <div className="dsm-row-name">
                      {s.name}{' '}
                      <span className="dsm-badge" data-kind={s.enabled ? 'on' : 'off'}>
                        {s.enabled ? d.enabledBadge : d.disabledBadge}
                      </span>{' '}
                      <span className="dsm-badge">{s.fromMarket ? d.fromMarket : d.localSkill}</span>{' '}
                      {st?.updateAvailable ? <span className="dsm-badge" data-kind="update">↑ {d.updateAvailable}</span> : null}
                    </div>
                    <div className="dsm-row-desc">{s.description || d.noDescription}</div>
                    {s.issues.length > 0 ? (
                      <div className="dsm-issues">
                        {s.issues.map((code) => (
                          <span key={code}>⚠ {issueText(d, code)}</span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="dsm-row-actions">
                    <button
                      className="dsm-btn"
                      disabled={busy !== ''}
                      onClick={() => void toggle(s.name, !s.enabled)}
                    >
                      {busy === s.name ? '…' : s.enabled ? d.disable : d.enable}
                    </button>
                    {s.fromMarket && st?.updateAvailable ? (
                      <button
                        className="dsm-btn"
                        data-primary="true"
                        disabled={busy !== ''}
                        onClick={() => void updateSkill(s.name)}
                      >
                        {busy === s.name ? '…' : d.update}
                      </button>
                    ) : null}
                    <button
                      className="dsm-btn"
                      data-danger="true"
                      disabled={busy !== ''}
                      onClick={() =>
                        setConfirmState({
                          text: d.confirmUninstall(s.name),
                          run: () => void uninstall(s.name),
                        })
                      }
                    >
                      {d.uninstall}
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </>
      ) : trash.length === 0 ? (
        <div className="dsm-empty">{d.emptyTrash}</div>
      ) : (
        trash.map((item) => (
          <div key={item.trashId} className="dsm-row">
            <div className="dsm-row-main">
              <div className="dsm-row-name">{item.name}</div>
              <div className="dsm-row-desc">{item.removedAt.slice(0, 19).replace('T', ' ')}</div>
            </div>
            <div className="dsm-row-actions">
              <button className="dsm-btn" disabled={busy !== ''} onClick={() => void restore(item.trashId)}>
                {d.restore}
              </button>
              <button
                className="dsm-btn"
                data-danger="true"
                disabled={busy !== ''}
                onClick={() =>
                  setConfirmState({
                    text: d.confirmPurge,
                    danger: true,
                    run: () => void purge(item.trashId),
                  })
                }
              >
                {d.purge}
              </button>
            </div>
          </div>
        ))
      )}

      {toast ? <div className="dsm-toast">{toast}</div> : null}
    </div>
  )
}

function categoryLabel(registry: Registry | null, id: string, lang: 'zh' | 'en'): string {
  const found = registry?.categories.find((c) => c.id === id)
  if (!found) return id
  return lang === 'zh' ? found.label : id
}

function DetailPanel(props: {
  entry: RegistryEntry
  d: Dict
  busy: boolean
  alreadyInstalled: boolean
  onBack: () => void
  onInstall: () => void
}): React.ReactElement {
  const { entry, d, busy, alreadyInstalled, onBack, onInstall } = props
  return (
    <div className="dsm-detail">
      <div className="dsm-detail-head">
        <IconWrap category={entry.category} icon={entry.icon} big />
        <div className="dsm-detail-title">
          <div className="dsm-detail-name">{entry.name}</div>
          <div className="dsm-repo">
            {entry.repo.owner}/{entry.repo.name} · {entry.repo.path}
            {typeof entry.stars === 'number' ? ` · ★ ${fmtStars(entry.stars)}` : ''}
          </div>
        </div>
        <div className="dsm-row-actions">
          <button className="dsm-btn" onClick={onBack}>
            {d.back}
          </button>
          {alreadyInstalled ? (
            <span className="dsm-badge">{d.installedBadge}</span>
          ) : (
            <button className="dsm-btn" data-primary="true" disabled={busy} onClick={onInstall}>
              {busy ? d.installing : d.install}
            </button>
          )}
        </div>
      </div>
      <div style={{ marginTop: 10 }}>{entry.description || d.noDescription}</div>
      <div className="dsm-kv">
        <b>{d.source}</b>
        <a
          className="dsm-link"
          href={`https://github.com/${entry.repo.owner}/${entry.repo.name}/tree/${entry.repo.ref}/${entry.repo.path}`.replace(/\/$/, '')}
          target="_blank"
          rel="noreferrer"
        >
          github.com/{entry.repo.owner}/{entry.repo.name} ({entry.repo.ref})
        </a>
        <b>{d.viewOnGithub}</b>
        <a
          className="dsm-link"
          href={`https://github.com/${entry.repo.owner}/${entry.repo.name}/tree/${entry.repo.ref}/${entry.repo.path}`.replace(/\/$/, '')}
          target="_blank"
          rel="noreferrer"
        >
          {entry.repo.path || '/'} →
        </a>
      </div>
    </div>
  )
}

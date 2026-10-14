/** API 路径构造：DSH web UI 无 path routing，以 baseURI 的 pathname 为挂载点 */
export function api(path: string): string {
  const relative = path.replace(/^\/+/, '')
  if (typeof document === 'undefined') return `/${relative}`
  return new URL(relative, document.baseURI).pathname
}

export interface ApiEnvelope<T> {
  ok: boolean
  data?: T
  error?: string
  code?: string
}

export async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(api(path), { cache: 'no-store' })
  const body = (await res.json().catch(() => null)) as ApiEnvelope<T> | null
  if (!res.ok || !body || body.ok !== true) {
    throw new Error(String(body?.error ?? `HTTP ${res.status}`))
  }
  return body.data as T
}

export async function postJSON<T>(path: string, payload: unknown): Promise<T> {
  const res = await fetch(api(path), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-dsh-skill-market': '1',
    },
    body: JSON.stringify(payload ?? {}),
  })
  const body = (await res.json().catch(() => null)) as ApiEnvelope<T> | null
  if (!res.ok || !body || body.ok !== true) {
    throw new Error(String(body?.error ?? `HTTP ${res.status}`))
  }
  return body.data as T
}

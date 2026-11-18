export async function api<T>(route: string, options?: RequestInit): Promise<T> {
  const res = await fetch('/api' + route, options)
  let value
  try { value = await res.json() } catch { throw new Error('无法读取工作台服务响应。') }
  if (!res.ok) throw new Error(value.error || '工作台请求失败，请重试。')
  return value as T
}

export function post<T>(route: string, value?: unknown) {
  return api<T>(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value ?? {}) })
}

const dateFormat = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })
export const displayDate = (value: string | null) => value ? dateFormat.format(new Date(value)) : '时间未提供'

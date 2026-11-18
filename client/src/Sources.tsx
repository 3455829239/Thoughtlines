import { useEffect, useState, type ReactNode } from 'react'
import { api, displayDate, post } from './api'
import type { Chat, EvidenceMessage, Message } from './types'

export function MessageCard({ message, title, link, previewText }: { message: Message; title?: string; link?: string | null; previewText?: boolean }) {
  return <details className="message">
    <summary>
      <span className={'role ' + message.role}>{message.role === 'user' ? '用户' : '助手'}</span>
      <span className="message-preview">{previewText ? message.text : title ?? message.text}</span>
    </summary>
    <div className="message-body">
      <div className="message-meta">{previewText && title && title + ' · '}{displayDate(message.timestamp)} · {message.message_id_is_local ? '本地来源 ID' : '原始消息 ID'}</div>
      <div className="message-id">{message.message_id}</div>
      <pre>{message.text}</pre>
      {link && <a href={link} target="_blank" rel="noreferrer">打开原始聊天 ↗</a>}
    </div>
  </details>
}

export function Evidence({ ids, previewText }: { ids: string[]; previewText?: boolean }) {
  const key = JSON.stringify(ids)
  const [result, setResult] = useState<{ key: string; messages?: EvidenceMessage[]; error?: string }>()
  useEffect(() => {
    let active = true
    const source_ids = JSON.parse(key) as string[]
    if (source_ids.length) post<EvidenceMessage[]>('/evidence', { source_ids })
      .then((messages) => { if (active) setResult({ key, messages }) })
      .catch((error: Error) => { if (active) setResult({ key, error: error.message }) })
    return () => { active = false }
  }, [key])
  if (!ids.length) return <p className="muted">此节点没有来源。</p>
  if (result?.key !== key) return <p className="muted">正在读取本地来源…</p>
  if (result.error) return <p className="notice error">{result.error}</p>
  return <div className="messages">{result.messages?.map((message) =>
    <MessageCard key={message.source_id} message={message} title={message.title} link={message.link} previewText={previewText} />)}</div>
}

export function ChatView({ id, back }: { id: string; back: ReactNode }) {
  const [chat, setChat] = useState<Chat>()
  const [error, setError] = useState('')
  const [path, setPath] = useState(0)
  const [page, setPage] = useState(0)
  useEffect(() => {
    let active = true
    api<Chat>('/chats/' + encodeURIComponent(id))
      .then((value) => { if (active) setChat(value) })
      .catch((err: Error) => { if (active) setError(err.message) })
    return () => { active = false }
  }, [id])
  const paths = chat?.paths
  const ids = paths?.[path]?.source_ids ?? []
  const byId = new Map(chat?.messages.map((message) => [message.source_id, message]))
  const size = 16
  return <div className="chat-view">
    {back}
    {error && <p className="notice error">{error}</p>}
    {!chat && !error && <p className="muted">正在读取聊天…</p>}
    {chat && <>
      <h3>{chat.title}</h3>
      <label className="field compact">对话路径
        <select value={path} onChange={(event) => { setPath(Number(event.target.value)); setPage(0) }}>
          {paths?.map((entry, index) => <option key={entry.id} value={index}>
            {entry.kind === 'current' ? '当前路径' : '备选路径 ' + index} · {entry.source_ids.length} 条</option>)}
        </select>
      </label>
      {chat.format === 'linear' && <p className="muted">此导出提供线性消息记录。消息使用本地来源 ID。</p>}
      <div className="messages">{ids.slice(page * size, (page + 1) * size).map((sourceId, index) => {
        const message = byId.get(sourceId)
        return message && <MessageCard key={sourceId + index} message={message} link={chat.link} />
      })}</div>
      {ids.length > size && <div className="paging">
        <button className="button small" type="button" disabled={!page} onClick={() => setPage(page - 1)}>上一页</button>
        <span>{page + 1} / {Math.ceil(ids.length / size)}</span>
        <button className="button small" type="button" disabled={(page + 1) * size >= ids.length} onClick={() => setPage(page + 1)}>下一页</button>
      </div>}
    </>}
  </div>
}

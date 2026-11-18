import { useEffect, useRef, useState } from 'react'
import { api, post } from './api'
import { ChatView, Evidence } from './Sources'
import type { Match, Run, Workspace } from './types'

const statsLabels: Record<string, string> = {
  conversations: '对话', messages: '文本消息', alternate_paths: '备选路径',
  invalid_conversation: '不支持的记录', empty_message: '空消息', non_text_message: '非文本消息',
  non_text_part: '非文本片段', unsupported_role: '不支持的角色', hidden_message: '隐藏消息',
  missing_message: '无消息的节点', missing_message_id: '使用本地 ID',
  invalid_path: '路径异常', empty_conversation: '无有效文本的对话',
}

export function Scope({ workspace, refresh, onClose, onRun, libraryOnly = false }: {
  workspace: Workspace; refresh: () => Promise<Workspace>; onClose: () => void; onRun: (run: Run) => void; libraryOnly?: boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [report, setReport] = useState<{ file: string; text: string; error?: boolean }[]>([])
  const [selected, setSelected] = useState(new Set<string>())
  const [matches, setMatches] = useState<Match[]>([])
  const [didRecall, setDidRecall] = useState(false)
  const [filter, setFilter] = useState('')
  const [page, setPage] = useState(0)
  const [reading, setReading] = useState<string>()
  const { limits } = workspace
  const pageSize = 12
  useEffect(() => { dialog.current?.showModal() }, [])

  async function upload(files: FileList | null) {
    if (!files?.length) return
    setBusy('正在解析聊天…')
    setError('')
    const results = []
    for (const file of Array.from(files)) {
      try {
        if (file.size > limits.uploadMb * 1024 * 1024) throw new Error('文件超过 ' + limits.uploadMb + ' MB。')
        const { stats } = await api<{ stats: Record<string, number> }>('/import', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: file,
        })
        const summary = Object.entries(stats).filter(([key, count]) => count || ['conversations', 'messages'].includes(key))
          .map(([key, count]) => count + ' ' + (statsLabels[key] ?? key)).join(' · ')
        results.push({ file: file.name, text: summary })
      } catch (err) { results.push({ file: file.name, text: (err as Error).message, error: true }) }
    }
    setReport(results)
    try { await refresh() } catch (err) { setError((err as Error).message) }
    finally { setBusy(''); if (fileInput.current) fileInput.current.value = '' }
  }

  async function retrieve(withModel: boolean) {
    setBusy(withModel ? '模型正在判断相关性…' : '正在本地检索…')
    setError('')
    setPage(0)
    try {
      const local = await api<Match[]>('/relevance')
      setMatches(local)
      setDidRecall(true)
      if (withModel && local.length) {
        const ranked = await post<Match[]>('/relevance')
        setMatches(ranked)
        if (!selected.size) {
          setSelected(new Set(ranked.filter((m) => m.relevant).slice(0, limits.selection).map((m) => m.conversation_id)))
        }
      }
    } catch (err) { setError((err as Error).message) }
    finally { setBusy('') }
  }

  async function analyzeScope() {
    setBusy('正在提取分支、思考节点和合并建议…')
    setError('')
    try {
      const run = await post<Run>('/analyze', { conversation_ids: [...selected] })
      await refresh()
      onRun(run)
    } catch (err) { setError((err as Error).message) }
    finally { setBusy('') }
  }

  const matchById = new Map(matches.map((match) => [match.conversation_id, match]))
  const scopeOrder = new Map(matches.map((match, index) => [match.conversation_id, index]))
  const chats = workspace.chats.filter((chat) => chat.title.toLowerCase().includes(filter.trim().toLowerCase()))
    .sort((a, b) => {
      const rank = (id: string) => matchById.get(id)?.relevant === true ? 0 : scopeOrder.has(id) ? 1 : 2
      return rank(a.id) - rank(b.id) || (scopeOrder.get(a.id) ?? 99) - (scopeOrder.get(b.id) ?? 99)
    })
  const maxPage = Math.max(0, Math.ceil(chats.length / pageSize) - 1)
  const currentPage = Math.min(page, maxPage)
  return <dialog ref={dialog} className="scope-dialog" aria-labelledby="scope-title"
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose() }}>
    <div className="dialog-head">
      <div><h2 id="scope-title">{libraryOnly ? '来源聊天' : '聊天与分析范围'}</h2>
        <p>{libraryOnly ? '查看已从两份本地 JSON 导入的原始消息。' : '从本地导出导入聊天，选择与当前项目有关的讨论。'}</p></div>
      <button type="button" className="icon-button" aria-label="关闭" onClick={onClose} disabled={!!busy}>×</button>
    </div>
    <div className="dialog-scroll">
      {reading ? <ChatView key={reading} id={reading} back={<button className="button small" onClick={() => setReading(undefined)}>← 返回聊天列表</button>} /> : <>
        {!libraryOnly && <div className="upload-card">
          <div><strong>导入 ChatGPT JSON</strong><p>支持多文件，每个最多 {limits.uploadMb} MB。</p></div>
          <input ref={fileInput} type="file" accept=".json,application/json" multiple hidden
            aria-label="导入聊天文件" onChange={(event) => void upload(event.target.files)} />
          <button className="button" type="button" onClick={() => fileInput.current?.click()} disabled={!!busy}>↑ 选择文件</button>
        </div>}
        {report.map((item, index) => <p key={item.file + index} className={'notice' + (item.error ? ' error' : '')}>
          <strong>{item.file}</strong><br />{item.text}</p>)}
        <div className="scope-tools">
          <input aria-label="搜索聊天标题" placeholder="搜索聊天标题" value={filter}
            onChange={(event) => { setFilter(event.target.value); setPage(0) }} />
          {!libraryOnly && <><button className="button" disabled={!!busy || !workspace.project || !workspace.chats.length}
            onClick={() => void retrieve(false)}>本地召回</button>
          <button className="button" disabled={!!busy || !workspace.project || !workspace.model_ready || !workspace.chats.length}
            onClick={() => void retrieve(true)}>AI 判断相关性</button></>}
        </div>
        {!workspace.project && <p className="notice">设置项目目标后即可检索并确认分析范围。</p>}
        {!libraryOnly && !workspace.model_ready && <p className="notice">AI 分析不可用。可在本机浏览已导入聊天和使用本地召回。</p>}
        {didRecall && !matches.length && <p className="muted">本地召回未发现匹配项，可从下方手动补充。</p>}
        <div className="chat-list">{chats.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map((chat) => {
          const match = matchById.get(chat.id)
          return <div className="chat-row" key={chat.id}>
            {!libraryOnly && <input type="checkbox" aria-label={'纳入 ' + chat.title} checked={selected.has(chat.id)}
              disabled={!!busy || (!selected.has(chat.id) && selected.size >= limits.selection)}
              onChange={(e) => { const next = new Set(selected); if (e.target.checked) next.add(chat.id); else next.delete(chat.id); setSelected(next) }} />}
            <div className="chat-copy">
              <strong>{chat.title}</strong>
              <div className="muted">{chat.message_count} 条消息 · {chat.path_count} 条路径
                {match && ' · ' + (match.relevant === true ? 'AI 推荐' : match.relevant === false ? 'AI 未推荐' : '本地匹配')}</div>
              {match?.terms.length ? <div className="term-list">{match.terms.join(' / ')}</div> : null}
              {match?.reason && <details className="reason"><summary>{match.reason}</summary>
                <Evidence ids={match.source_ids ?? []} /></details>}
            </div>
            <button className="button small" disabled={!!busy} onClick={() => setReading(chat.id)}>查看</button>
          </div>
        })}</div>
        {!chats.length && <p className="muted">{workspace.chats.length ? '未找到匹配标题。' : '导入后，聊天会出现在这里。'}</p>}
        {maxPage > 0 && <div className="paging">
          <button className="button small" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>上一页</button>
          <span>{currentPage + 1} / {maxPage + 1}</span>
          <button className="button small" disabled={currentPage >= maxPage} onClick={() => setPage(currentPage + 1)}>下一页</button>
        </div>}
      </>}
    </div>
    {!reading && !libraryOnly && <div className="dialog-footer">
      {error && <p className="notice error" role="alert">{error}</p>}
      {busy && <p className="busy-label" role="status">{busy}</p>}
      <p className="privacy">AI 判断和分析会将项目目标及相关聊天片段发送给所配置的模型服务。分析还会发送 Main 的近期条目。判断最多 {limits.candidates} 段 × {limits.relevanceCharsPerChat} 字符，分析最多 {limits.selection} 段 × {limits.analysisCharsPerChat} 字符。每次操作最多调用模型 {limits.callsPerAction} 次。</p>
      <div className="footer-actions">
        <span>已选 {selected.size} / {limits.selection} 段</span>
        <button className="button primary" disabled={!!busy || !workspace.project || !workspace.model_ready || !selected.size}
          onClick={() => void analyzeScope()}>确认范围并分析</button>
      </div>
    </div>}
  </dialog>
}

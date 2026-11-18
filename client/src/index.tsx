import { useCallback, useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { api, displayDate, post } from './api'
import { Graph, colors, kinds, mergeTitle, statuses } from './Graph'
import { Scope } from './Scope'
import { Evidence } from './Sources'
import type { Candidate, MainVersion, PriorThought, Run, Section, Selection, Workspace } from './types'
import '@xyflow/react/dist/style.css'
import './style.css'

const sections: Record<Section, string> = { plan: '项目方案', confirmed_decisions: '已确认决策', unresolved_questions: '未解决问题' }
const operations = { add: '新增', replace: '修改', resolve: '关闭' }
const candidateStatuses = { pending: '待确认', confirmed: '已合并', rejected: '已拒绝' }
const sectionKeys = Object.keys(sections) as Section[]
const followupLabels = { verification: '已决定 · 待验证', action: '已明确 · 待执行' }

function Mark() { return <span className="mark" aria-hidden="true"><i /><b /></span> }

function MainContents({ version, run, select }: { version: MainVersion; run?: Run; select?: (item: Selection) => void }) {
  const plan = [...new Set([...version.plan, ...version.confirmed_decisions].map((item) => item.text))]
  const pending = run?.followups?.filter((item) => item.status === 'pending') ?? []
  const verification = pending.filter((item) => item.kind === 'verification')
  const actions = pending.filter((item) => item.kind === 'action')
  const questionRecommendation = run?.recommendation
  const next = pending.find((item) => item.priority) ?? actions[0] ?? verification[0]
  const questions = run?.questions.filter((item) => !version.unresolved_questions.some((official) => official.text === item.question)) ?? []
  const hasQuestions = version.unresolved_questions.length > 0 || questions.length > 0
  return <div className="main-contents">
    <section><h3>当前项目目标</h3><p className="main-goal">{version.project_goal}</p></section>
    <section><h3>已确定的方案 <span className="count">{plan.length}</span></h3>
      {plan.length ? <ul className="main-items">{plan.map((text) => <li key={text}>{text}</li>)}</ul>
        : <p className="muted">暂无已确定的方案。</p>}
    </section>
    <section><h3>仍待确定的部分</h3>
      <h4 className="progress-label">尚未回答的问题</h4>
      {hasQuestions ? <>
        {!!version.unresolved_questions.length && <ul className="main-items">{version.unresolved_questions.map((item) => <li key={item.id}>{item.text}</li>)}</ul>}
        {questions.map((item) => <button className="question-row" key={item.id} onClick={() => select?.({ kind: 'question', id: item.id })}>
          {item.question}{!!item.depends_on.length && <small>依赖 {item.depends_on.length} 个前置问题</small>}</button>)}
      </> : <p className="muted">暂无待回答的问题。</p>}
      {!!verification.length && <><h4 className="progress-label">{followupLabels.verification}</h4>
        {verification.map((item) => <button className="question-row" key={item.id}
          onClick={() => select?.({ kind: 'followup', id: item.id })}>{item.title}</button>)}</>}
    </section>
    {run && <section><h3>下一步</h3>
      {next ? <div className="recommend"><strong>{followupLabels[next.kind]}</strong><p>{next.title}</p><small>{next.reason}</small>
        <button className="text-button" onClick={() => select?.({ kind: 'followup', id: next.id })}>查看事项 →</button></div>
        : questionRecommendation ? <div className="recommend"><strong>优先回答</strong><p>{questionRecommendation.action}</p>
          <small>{questionRecommendation.reason}</small><button className="text-button"
            onClick={() => select?.({ kind: 'question', id: questionRecommendation.question_id })}>查看依据 →</button></div>
          : <p className="muted">暂无可推荐的待办。</p>}
      {actions.some((item) => item.id !== next?.id) && <h4 className="progress-label">{followupLabels.action}</h4>}
      {actions.filter((item) => item.id !== next?.id).map((item) => <button className="question-row" key={item.id}
        onClick={() => select?.({ kind: 'followup', id: item.id })}>{item.title}</button>)}
    </section>}
  </div>
}

function VersionChanges({ version, previous }: { version: MainVersion; previous?: MainVersion }) {
  if (!previous) return <div className="detail-block"><h4>版本差异</h4><p className="muted">这是初始版本。</p></div>
  const changes: { key: string; section: string; before?: string; after?: string }[] = []
  if (previous.project_goal !== version.project_goal) {
    changes.push({ key: 'goal', section: '项目目标', before: previous.project_goal, after: version.project_goal })
  }
  for (const section of sectionKeys) {
    const before = new Map(previous[section].map((item) => [item.id, item.text]))
    const after = new Map(version[section].map((item) => [item.id, item.text]))
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      if (before.get(id) !== after.get(id)) changes.push({ key: section + id, section: sections[section], before: before.get(id), after: after.get(id) })
    }
  }
  return <div className="detail-block"><h4>对比 Main v{previous.version_number} → v{version.version_number}</h4>
    {changes.length ? changes.map((change) => <div className="version-diff" key={change.key}>
      <strong>{change.section}</strong>
      <p className="diff-before"><span>变更前</span>{change.before ?? '该条目尚不存在'}</p>
      <p className="diff-after"><span>变更后</span>{change.after ?? '本次移除该条目'}</p>
    </div>) : <p className="muted">这一版没有方案内容变更。</p>}
  </div>
}

function ThoughtChange({ item }: {
  item: { prior?: PriorThought; summary: string; reason: string; source_ids: string[] }
}) {
  return <div className="thought-change">
    {item.prior && <section className="detail-block"><h4>此前的想法</h4><p>{item.prior.text}</p></section>}
    <section className="detail-block current-thought"><h4>{item.prior ? '这次发生的变化' : '新增信息'}</h4><p><strong>{item.summary}</strong></p></section>
    <section className="detail-block"><h4>{item.prior ? '为什么改变？' : '为什么记录这条信息？'}</h4><p>{item.reason}</p></section>
    <section className="detail-block"><h4>原始证据</h4>
      {item.prior && <div className="thought-evidence"><h5>此前 · 聊天片段</h5><Evidence ids={item.prior.source_ids} previewText /></div>}
      <div className="thought-evidence"><h5>{item.prior ? '变化后 · 聊天片段' : '本次 · 聊天片段'}</h5><Evidence ids={item.source_ids} previewText /></div>
    </section>
  </div>
}

function Setup({ create, busy }: { create: (name: string, goal: string) => Promise<void>; busy: boolean }) {
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')
  const submit = (event: FormEvent) => { event.preventDefault(); void create(name.trim(), goal.trim()) }
  return <form className="setup-card" onSubmit={submit}>
    <Mark />
    <h2>从项目目标开始</h2>
    <p>先定义你想推进的项目，再导入相关的历史聊天。</p>
    <label className="field">项目名称<input required maxLength={80} value={name}
      placeholder="例如：对话信息整理工具" onChange={(e) => setName(e.target.value)} /></label>
    <label className="field">项目目标<textarea required maxLength={1800} rows={4} value={goal}
      placeholder="描述你希望解决的问题和要交付的结果" onChange={(e) => setGoal(e.target.value)} /></label>
    <button className="button primary" type="submit" disabled={busy || !name.trim() || !goal.trim()}>
      {busy ? '正在保存…' : '创建单项目工作台'} <span aria-hidden="true">→</span>
    </button>
  </form>
}

function Inspector({ workspace, run, selection, select, act, complete, busy }: {
  workspace: Workspace; run?: Run; selection: Selection | null; select: (item: Selection) => void
  act: (id: string, status: 'confirmed' | 'rejected') => Promise<void>; busy: boolean
  complete: (id: string) => Promise<void>
}) {
  const commit = selection?.kind === 'commit' ? run?.commits.find((item) => item.id === selection.id) : undefined
  const version = selection?.kind === 'version' ? workspace.versions.find((item) => item.id === selection.id) : undefined
  const mainEvent = selection?.kind === 'main-event' ? run?.main_events?.find((item) => item.id === selection.id) : undefined
  const candidate = selection?.kind === 'candidate' ? run?.candidates.find((item) => item.id === selection.id) : undefined
  const question = selection?.kind === 'question' ? run?.questions.find((item) => item.id === selection.id) : undefined
  const followup = selection?.kind === 'followup' ? run?.followups?.find((item) => item.id === selection.id) : undefined
  const branch = run?.branches.find((item) => item.id === (commit?.branch_id ?? candidate?.branch_id ?? question?.branch_id ?? selection?.id))
  const openCandidate = (item: Candidate) => select({ kind: 'candidate', id: item.id })
  const branchLink = branch && <button className="text-button branch-link" onClick={() => select({ kind: 'branch', id: branch.id })}>{branch.question} →</button>
  const theme = branch?.theme
  const themeColor = colors[(run?.branches.findIndex((item) => item.id === branch?.id) ?? -1) % colors.length]
  const branchTheme = theme && <div className="branch-theme" style={{ '--theme-color': themeColor } as CSSProperties}>
    <h4><span aria-hidden="true" />{theme.label}</h4>
    <p>{theme.summary}</p>
    <ul aria-label="分支关键词">{theme.keywords.map((word) => <li key={word}>{word}</li>)}</ul>
    {selection?.kind === 'branch' && <details><summary>归类依据</summary><Evidence ids={theme.source_ids} /></details>}
  </div>
  let detail: ReactNode
  if (candidate) {
    detail = <div className="detail">
      <div className="detail-tags"><span className={'pill ' + candidate.status}>{candidateStatuses[candidate.status]}</span>
        <span className="pill">{operations[candidate.operation]} · {sections[candidate.target_section]}</span></div>
      <h3>{candidate.title ?? candidate.proposed_change}</h3>
      {candidate.title && <p>{candidate.proposed_change}</p>}
      {branchLink}
      {branchTheme}
      {candidate.expected_text && <div className="detail-block"><h4>当前提案所针对的内容</h4><p>{candidate.expected_text}</p></div>}
      <div className="detail-block"><h4>{run?.origin === 'local' ? '建议理由' : 'AI 建议理由'}</h4><p>{candidate.reason}</p></div>
      <div className="detail-block"><h4>原始聊天证据</h4><Evidence ids={candidate.source_ids} /></div>
      {candidate.status === 'pending' && <div className="candidate-actions">
        <button className="button" disabled={busy} onClick={() => void act(candidate.id, 'rejected')}>拒绝</button>
        <button className="button primary" disabled={busy} onClick={() => void act(candidate.id, 'confirmed')}>确认合并</button>
      </div>}
      {candidate.merged_version && <p className="notice">已写入 Main v{candidate.merged_version}。</p>}
    </div>
  } else if (commit) {
    detail = <div className="detail">
      <div className="detail-tags"><span className="pill pending">{commit.prior ? '思考变化' : '新增信息'}</span>
        <span className="pill">{kinds[commit.type]}</span></div>
      <h3>{commit.title}</h3>{branchLink}{branchTheme}
      <ThoughtChange item={commit} />
      {commit.timestamp && <p className="muted">{displayDate(commit.timestamp)}</p>}
    </div>
  } else if (followup) {
    detail = <div className="detail">
      <span className={'pill ' + (followup.status === 'done' ? 'confirmed' : 'pending')}>
        {followup.status === 'done' ? '已完成' : followupLabels[followup.kind]}</span>
      <h3>{followup.title}</h3>
      <div className="detail-block"><h4>为什么做这一步？</h4><p>{followup.reason}</p></div>
      <div className="detail-block"><h4>原始证据</h4><Evidence ids={followup.source_ids} /></div>
      {followup.status === 'pending' && <div className="candidate-actions">
        <button className="button primary" disabled={busy} onClick={() => void complete(followup.id)}>标记完成</button>
      </div>}
    </div>
  } else if (question) {
    detail = <div className="detail">
      <div className="detail-tags"><span className="pill">未解决</span>{question.blocking && <span className="pill pending">阻塞推进</span>}</div>
      <h3>{question.question}</h3>{branchLink}{branchTheme}
      <div className="detail-block"><h4>前置问题</h4>
        {question.depends_on.length ? question.depends_on.map((id) => <button key={id} className="text-button"
          onClick={() => select({ kind: 'question', id })}>{run?.questions.find((item) => item.id === id)?.question} →</button>)
          : <p className="muted">暂无前置依赖。</p>}</div>
      <div className="detail-block"><h4>验证建议</h4><p>{question.next_action}</p><p className="muted">{question.reason}</p></div>
      <div className="detail-block"><h4>原始聊天证据</h4><Evidence ids={question.source_ids} /></div>
    </div>
  } else if (mainEvent) {
    const contributing = run?.branches.filter((entry) => entry.commit_ids.some((id) => mainEvent.from_commit_ids.includes(id))) ?? []
    detail = <div className="detail">
      <span className="pill">Main · 讨论记录</span><h3>{(mainEvent.prior && mainEvent.change_label) || mainEvent.title}</h3>
      <ThoughtChange item={mainEvent} />
      {!!contributing.length && <div className="detail-block"><h4>承接的探索分支</h4>
        <div className="inline-list">{contributing.map((entry) => <button className="text-button" key={entry.id}
          onClick={() => select({ kind: 'branch', id: entry.id })}>{entry.question} →</button>)}</div>
      </div>}
    </div>
  } else if (version) {
    const previous = workspace.runs.flatMap((entry) => entry.candidates)
    const predecessor = workspace.versions.filter((item) => item.version_number < version.version_number).at(-1)
    const mergedTitles = previous.filter((item) => version.merged_candidate_ids.includes(item.id))
    detail = <div className="detail">
      <span className="pill">{version.merged_candidate_ids.length ? '正式合并' : '版本快照'}</span>
      <h3>{mergedTitles[0] ? mergeTitle(mergedTitles[0]) : 'Main v' + version.version_number}</h3>
      <p className="muted">Main v{version.version_number} · {displayDate(version.created_at)}</p>
      <VersionChanges version={version} previous={predecessor} />
      <MainContents version={version} />
      {version.confirmed_decisions.some((item) => item.source_ids?.length) && <div className="detail-block">
        <h4>已确认决策的原文</h4>
        <Evidence ids={[...new Set(version.confirmed_decisions.flatMap((item) => item.source_ids ?? []))]} />
      </div>}
      {version.merged_candidate_ids.map((id) => {
        const merged = previous.find((item) => item.id === id)
        return merged && <div className="detail-block" key={id}><h4>本次合并</h4>
          <p>{merged.proposed_change}</p><p className="muted">{merged.reason}</p><Evidence ids={merged.source_ids} /></div>
      })}
    </div>
  } else if (branch) {
    const first = run?.commits.find((item) => item.id === branch.commit_ids[0])
    detail = <div className="detail">
      <div className="detail-tags"><span className="pill">分支问题</span><span className="pill pending">{statuses[branch.status]}</span></div><h3>{branch.question}</h3>
      <p className="muted">{branch.commit_ids.length} 个思考节点 · {branch.source_ids.length} 个来源</p>
      {branchTheme}
      {first && <div className="detail-block"><h4>为什么从这里分支</h4><p>{first.reason}</p><Evidence ids={first.source_ids} /></div>}
      <div className="detail-block"><h4>思考节点</h4><div className="inline-list">{branch.commit_ids.map((id) =>
        <button className="text-button" key={id} onClick={() => select({ kind: 'commit', id })}>
          {run?.commits.find((item) => item.id === id)?.title} →</button>)}</div></div>
    </div>
  } else {
    detail = <div className="inspector-empty">
      <div className="inspector-symbol" aria-hidden="true">◎</div>
      <h3>查看讨论证据</h3><p>选择图中的节点，查看思考变化、原始聊天和对应的合并建议。</p>
    </div>
  }
  const related = followup ? [] : run?.candidates.filter((item) => !branch || (item.branch_id === branch.id && (!commit || item.commit_ids.includes(commit.id)))) ?? []
  return <aside id="node-details" className="panel inspector" aria-label="节点详情">
    <div className="panel-heading"><h2>节点详情</h2><span className="panel-glyph" aria-hidden="true">◫</span></div>
    {detail}
    {run && !followup && <section className="candidate-list">
      <h3>合并草稿 <span className="count">{related.length}</span></h3>
      {!related.length && <p className="muted">暂无相关合并建议。</p>}
      {related.map((item) => <button type="button" className={'candidate-row' + (candidate?.id === item.id ? ' active' : '')}
        key={item.id} onClick={() => openCandidate(item)}>
        <span className={'pill ' + item.status}>{candidateStatuses[item.status]}</span>
        <span>{item.title ?? item.proposed_change}</span>
      </button>)}
    </section>}
  </aside>
}

function App() {
  const [workspace, setWorkspace] = useState<Workspace>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [scope, setScope] = useState(false)
  const [runId, setRunId] = useState<string>()
  const [selection, setSelection] = useState<Selection | null>(null)
  const openGraphNode = useCallback((item: Selection) => {
    setSelection(item)
    const details = document.getElementById('node-details')
    if (!details) return
    details.scrollTop = 0
    if (window.matchMedia('(max-width: 1040px)').matches) {
      requestAnimationFrame(() => details.scrollIntoView({ block: 'start' }))
    }
  }, [])

  async function refresh() {
    const data = await api<Workspace>('/workspace')
    setWorkspace(data)
    const last = data.runs.at(-1)
    const mainEvent = last?.main_events?.find((item) => item.from_commit_ids.length)
    const first = last?.origin === 'local'
      ? last.commits.find((item) => last.candidates[0]?.commit_ids.includes(item.id)) ?? last.commits[0] : undefined
    if (mainEvent) setSelection((current) => current ?? { kind: 'main-event', id: mainEvent.id })
    else if (first) setSelection((current) => current ?? { kind: 'commit', id: first.id })
    return data
  }
  useEffect(() => { refresh().catch((err: Error) => setError(err.message)) }, [])

  async function create(name: string, goal: string) {
    setBusy(true); setError('')
    try {
      await post('/project', { name, goal })
      await refresh()
      setScope(true)
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  async function act(id: string, status: 'confirmed' | 'rejected') {
    setBusy(true); setError('')
    try {
      await post('/merges/' + encodeURIComponent(id), { status })
      await refresh()
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  async function complete(id: string) {
    setBusy(true); setError('')
    try {
      await post('/followups/' + encodeURIComponent(id) + '/complete')
      await refresh()
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  const project = workspace?.project
  const main = workspace?.versions.at(-1)
  const latestRun = workspace?.runs.at(-1)
  const run = workspace?.runs.find((item) => item.id === runId) ?? latestRun
  const localDemo = workspace?.runs.some((item) => item.origin === 'local') ?? false

  return <>
    <header className="topbar">
      <a className="brand" href="/" aria-label="Thought Radar 首页"><Mark /><span>Thought Radar</span></a>
      <div className="top-actions">
        <span className={'model-indicator' + (workspace?.model_ready ? ' ready' : '')}>
          {workspace ? (workspace.model_ready ? '模型已配置' : '本地模式') : '正在连接'}
        </span>
        <button className="button primary top-upload" disabled={!workspace || busy} onClick={() => setScope(true)}>
          {localDemo ? '查看来源聊天' : <><span aria-hidden="true">↑</span> 导入聊天</>}
        </button>
      </div>
    </header>
    <main className="shell">
      <div className="project-head">
        <div>
          <div className="project-kicker"><span className="small-line" />单项目工作台</div>
          <h1>{project?.name ?? '项目探索工作台'}</h1>
          <p>{project?.goal ?? '从历史聊天追溯思考变化，把有证据的结论合并回项目主线。'}</p>
        </div>
        {!!workspace && <div className="project-actions">
          <button disabled={!main} className="button" onClick={() => main && setSelection({ kind: 'version', id: main.id })}>
            <i className="main-dot" /> Main {main ? 'v' + main.version_number : '待创建'}
          </button>
          <button className="button" onClick={() => setScope(true)}>{workspace.chats.length} 段聊天</button>
        </div>}
      </div>
      {error && <div className="notice error global-error" role="alert">
        <span>{error}</span><button className="text-button" onClick={() => {
          setError(''); if (!workspace) refresh().catch((err: Error) => setError(err.message))
        }}>{workspace ? '关闭' : '重试'}</button>
      </div>}
      {workspace ? <div className="workbench">
        <aside className="panel sidebar" aria-label="项目主线与问题">
          <div className="panel-heading"><h2>项目主线</h2><span className="pill">{main ? 'v' + main.version_number : 'Main'}</span></div>
          {main ? <MainContents version={main} run={latestRun} select={(item) => {
            setRunId(latestRun?.id)
            openGraphNode(item)
          }} /> : <div className="sidebar-empty">
            <h3>从目标建立 Main</h3><p>项目方案、已确认决策和未解决问题将在这里集中显示。</p>
          </div>}
          <section className="sidebar-section">
            <h3>探索问题 <span className="count">{run?.branches.length ?? 0}</span></h3>
            {!run?.branches.length && <p className="muted">完成聊天分析后显示。</p>}
            {run?.branches.map((branch, i) => <button key={branch.id}
              className={'branch-row' + (selection?.id === branch.id ? ' active' : '')}
              onClick={() => openGraphNode({ kind: 'branch', id: branch.id })}>
              <span style={{ background: colors[i % colors.length] }} />{branch.question}</button>)}
          </section>
        </aside>
        <section className="panel graph-panel" aria-label="探索分支图">
          <div className="panel-heading graph-heading">
            <div><h2>探索分支图</h2><p>{run?.origin === 'local' ? '已从本地导出整理。点击节点查看原始消息。'
              : run ? '点击节点查看细节，拖动或缩放画布。' : '沿 Main 追踪探索、思考变化与合并。'}</p></div>
            {workspace.runs.length > 0 && <select className="run-select" aria-label="分析历史"
              value={run?.id} onChange={(event) => { setRunId(event.target.value); setSelection(null) }}>
              {workspace.runs.slice().reverse().map((item, index) =>
                <option key={item.id} value={item.id}>{item.origin === 'local'
                  ? item.main_events?.length ? '本地整理 · 比赛项目时间线' : '本地整理 · 初版'
                  : index ? displayDate(item.created_at) : '最新分析'}</option>)}</select>}
          </div>
          <Graph run={run} versions={workspace.versions} mergeRecords={workspace.runs.flatMap((item) => item.candidates)}
            selected={selection} onSelect={openGraphNode} empty={
            !project ? <Setup create={create} busy={busy} /> : <div className="setup-card graph-start">
              <Mark /><h2>{workspace.chats.length ? '选择与你项目相关的聊天' : '导入项目的历史聊天'}</h2>
              <p>{workspace.chats.length ? '从本地召回候选聊天，确认范围后生成探索分支和合并草稿。' : '上传 ChatGPT 导出文件，恢复聊天路径和消息来源。'}</p>
              <button className="button primary" onClick={() => setScope(true)}>{workspace.chats.length ? '选择分析范围' : '导入聊天'} →</button>
              {!workspace.model_ready && <p className="local-banner">AI 分析不可用。已导入聊天可在本机查看。</p>}
            </div>
          } />
          <div className="graph-footer">
            <div className="legend"><span><i className="line-main" /> Main</span><span><i className="line-branch" /> 探索分支</span>
              {run?.main_events?.some((item) => item.from_commit_ids.length) && <span><i className="line-return" /> 讨论回到 Main</span>}
              <span><i className="line-merge" /> 已确认合并</span></div>
            {run ? <details className="run-summary">
              <summary>{run.conversation_ids.length} 段聊天 · {run.commits.length} 个思考节点</summary>
              <div className="run-scope">
                <strong>{run.origin === 'local' ? '本地整理所用的来源' : '本次发送给模型的聊天片段'}</strong>
                {run.origin === 'local' && run.conversation_ids.map((id) => {
                  const chat = workspace.chats.find((item) => item.id === id)
                  return <p key={id}>{chat?.title ?? id} · {chat?.message_count ?? 0} 条消息</p>
                })}
                {run.excerpts.map((entry) => <p key={entry.conversation_id}>
                  {workspace.chats.find((chat) => chat.id === entry.conversation_id)?.title ?? entry.conversation_id}
                  <br /><span className="muted">{entry.message_count} 条片段 · {entry.characters} 字符</span>
                </p>)}
                {!run.branches.length && <p>本次片段未能支持可提取的探索分支。</p>}
              </div>
            </details> : <span>等待分析</span>}
          </div>
        </section>
        <Inspector workspace={workspace} run={run} selection={selection} select={setSelection} act={act} complete={complete} busy={busy} />
      </div> : !error && <p className="notice">正在读取本地工作台…</p>}
    </main>
    {scope && workspace && <Scope workspace={workspace} refresh={refresh} onClose={() => setScope(false)} libraryOnly={localDemo}
      onRun={(result) => {
        setRunId(result.id)
        setScope(false)
        const first = result.commits[0]
        setSelection(first ? { kind: 'commit', id: first.id } : null)
      }} />}
  </>
}

createRoot(document.getElementById('root')!).render(<App />)

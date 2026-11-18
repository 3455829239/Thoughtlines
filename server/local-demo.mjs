import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { materializeAnalysis, setBranchTheme } from './analysis.mjs'
import { mergeImported, parseExport } from './import.mjs'
import { createProject } from './store.mjs'

const files = [
  'ChatGPT-信息整理问题总结-20261118-2055.json',
  'ChatGPT-分支 · 信息整理问题总结-20261118-2056.json',
]
const timelineId = 'local-competition-timeline-v2'
const currentTimeline = (state) => state.runs.find((run) => run.id === timelineId)
const canLoadTimeline = (state) => {
  const timeline = currentTimeline(state)
  return timeline ? !timeline.followups || timeline.branches.some((branch) => !branch.theme)
    : !state.project || state.runs.some((run) => run.origin === 'local')
}

export async function loadLocalDemo(store, root) {
  if (!canLoadTimeline(store.read())) return
  let chats
  try {
    chats = await Promise.all(files.map(async (file) => {
      const text = await readFile(join(root, file), 'utf8')
      return parseExport(JSON.parse(text.replace(/^\uFEFF/, ''))).conversations[0]
    }))
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw new Error('无法读取本地演示导出文件，请检查 JSON 格式。')
  }
  if (chats.some((chat) => !chat)) return
  const [original, followup] = chats
  const find = (chat, phrase) => chat.messages.find((m) => m.role === 'user' && m.text.includes(phrase))
  const earlyGoal = find(followup, '聊天记录太多没法找')
  const boards = find(original, '我收集的一些比较喜欢的看板样式')
  const git = find(original, 'git合并冲突也很像思考迭代过程')
  const visual = find(original, '主界面：Git 式思考演变')
  const relations = find(followup, '谁跟某一个观点有联系')
  const responsibilities = find(followup, '哪些根据数据库代码就可以完成')
  const fixtures = find(followup, '作为测试的数据库')
  const shortlist = find(followup, '收敛到一张表上')
  const eventScope = find(followup, '黑客松三个小时之内')
  const focus = find(followup, '还要回到主线上来')
  const choices = find(followup, '每个独立问题是一个分支')
  const final = find(followup, '自动更新草稿，确认后合并')
  if (![earlyGoal, boards, git, visual, relations, responsibilities, fixtures, shortlist, eventScope, focus, choices, final].every(Boolean)) {
    throw new Error('本地演示导出的原始消息已变化，无法校验演示证据。')
  }
  const entry = (key, type, title, summary, reason, ...messages) => ({
    key, type, title, summary, reason, source_ids: messages.map((message) => message.source_id),
  })
  const previous = (text, ...messages) => ({ text, source_ids: messages.map((message) => message.source_id) })
  const planTheme = {
    label: '内容与项目策划',
    summary: '讨论项目要做什么、怎样用历史对话组织观点和例子，以及三小时内如何把想法做成可验证的 Demo。',
    keywords: ['观点与实例', '数据与工作流', '功能优先级'],
    source_ids: [relations.source_id, fixtures.source_id, eventScope.source_id],
  }
  const boardTheme = {
    label: '看板 · UI · 视觉表达',
    summary: '讨论界面怎么呈现思考的演变和想法的素材状态，以及看板该突出哪些可以继续推进的内容。',
    keywords: ['看板与界面', 'Git 分支图', '素材雷达图', '下一步提示'],
    source_ids: [boards.source_id, visual.source_id, shortlist.source_id],
  }
  const draft = {
    branches: [
      { key: 'plan', question: '如何把历史对话变成可运行的工作流？', status: 'exploring', theme: planTheme, commits: [
        { ...entry('workflow', 'exploration', '从整理聊天转向追溯观点与实例',
          '围绕观点查找相关讨论、原始上下文和支持观点的实例。', '只知道信息散落还不能指导工具实现，因此开始追问具体的数据结构和流程。', relations),
          prior: previous('把散落的聊天和灵感整理起来，帮助后续写作和输出。', earlyGoal) },
        entry('implementation', 'refinement', '先用本地 JSON 做 Demo',
          '先使用本地 JSON 验证 Demo，并区分可直接编码完成的工作和需要模型判断的工作。', '原文提出先用已经准备的测试数据直接看到效果。', responsibilities, fixtures),
        entry('constraint', 'evidence', '加入三小时比赛约束',
          '列出功能、呈现方式和运行逻辑，找出三小时内优先验证的流程。', '这一轮增加了实现时限，也提出了功能过多和优先级未定的问题。', eventScope),
      ] },
      { key: 'board', question: '怎样呈现思考演变和素材状态？', status: 'exploring', theme: boardTheme, commits: [
        entry('reference', 'exploration', '拆解看板参考，提取可复用的表达',
          '分析参考看板解决的问题和使用场景，再判断哪些形式适合整理思路与灵感。', '这一轮关注信息怎样呈现，形成独立的可视化看板分支。', boards),
        { ...entry('formats', 'refinement', '用 Git 图看演变，雷达图看素材',
          '探索 Git 图展示思考分支和合并，雷达图展示素材准备状态，并用行动入口提示缺项。', '这些界面形式回答不同的问题，原文建议用 Demo 验证它们是否适用。', git, visual),
          prior: previous('先拆解收集的参考看板，以找到可以迁移的图表和布局。', boards) },
        entry('shortlist', 'refinement', '看板聚焦仍可推进的想法',
          '优先呈现进行中、有发展空间、与最近讨论有关的内容，探索用讨论和关联数量提供下一步提示。', '这一轮明确了看板筛选哪些信息，仍属于呈现方案的细化。', shortlist),
      ] },
    ],
    main_events: [
      {
        title: '从个人思考收敛到单个比赛项目',
        change_label: '方向收敛',
        prior: previous('希望整理个人思考、灵感和大量历史对话，让它们能支持后续输出。', earlyGoal),
        summary: '从管理所有思考，收敛为管理单个项目的探索过程。',
        reason: '三小时黑客松需要明确的使用场景和可以验证的核心功能。把范围定为当前比赛项目，就能聚焦于分支探索和把有用结论带回主线。',
        source_ids: [eventScope.source_id, focus.source_id],
        after: [{ branch_key: 'plan', commit_key: 'constraint' }, { branch_key: 'board', commit_key: 'shortlist' }],
      },
      {
        title: '从自动更新 Main 改成确认后合并',
        prior: previous('只要有新的有用信息就自动更新主线。', choices),
        summary: '系统自动生成草稿，由人确认之后才合并到 Main。范围同时明确为单个项目。',
        reason: '最终补充选择明确区分了草稿与合并。原文没有另列修改理由。',
        source_ids: [final.source_id], after: [],
      },
    ],
    candidates: [{
      title: '确定 Git 式探索交互方案',
      branch_key: 'board', commit_keys: ['formats'], source_ids: [visual.source_id],
      operation: 'add', target_section: 'plan', target_item_id: null,
      proposed_change: '主视图采用 Git 式探索图；后续用详情视图试验素材就绪状态和下一步提示。',
      reason: '原文对主视图、详情和行动入口给出了不同用途。详情方案仍需验证，先保留为提案。',
    }],
    questions: [{
      key: 'linking', branch_key: 'plan', question: '如何找到支持某个观点的历史讨论和实例？',
      source_ids: [relations.source_id], depends_on: [], blocking: true, quick_check: true,
      next_action: '选一个观点，回查这两段聊天，验证能否找到一条例子及其上下文。',
      reason: '这一步可直接验证用户提出的回查诉求，样本只需一个观点。',
    }],
    followups: [
      { kind: 'verification', title: '验证 Git 图能否讲清分支和回主线',
        reason: '已确定 Demo 使用探索图。请让一位观众试读并复述一次方向收敛，验证这种图能否说明思路怎么变了。',
        source_ids: [visual.source_id, final.source_id], priority: false },
      { kind: 'action', title: '为演示选一个观点，找齐实例与上下文',
        reason: '只回查一个观点就能准备演示素材，也能检验相关聊天和原文能否支持判断。',
        source_ids: [relations.source_id, eventScope.source_id], priority: true },
    ],
  }
  await store.update((state) => {
    if (!canLoadTimeline(state)) return
    const timeline = currentTimeline(state)
    if (timeline) {
      const revised = materializeAnalysis(draft, state.project, state.versions[0], chats)
      for (const [index, branch] of timeline.branches.entries()) {
        const replacement = revised.branches[index]
        branch.question = replacement.question
        if (!branch.theme) setBranchTheme(branch, replacement.theme)
        branch.commit_ids.forEach((id, i) => {
          const item = timeline.commits.find((commit) => commit.id === id)
          const value = revised.commits.find((commit) => commit.id === replacement.commit_ids[i])
          if (item && value) {
            const { title, summary, reason, prior, source_ids } = value
            Object.assign(item, { title, summary, reason, prior, source_ids })
          }
        })
      }
      for (const [index, event] of timeline.main_events.entries()) {
        const { title, summary, reason, prior, source_ids, change_label } = revised.main_events[index]
        Object.assign(event, { title, summary, reason, prior, source_ids, change_label })
      }
      for (const candidate of timeline.candidates) {
        const replacement = revised.candidates.find((item) => item.proposed_change === candidate.proposed_change)
        if (replacement) candidate.title = replacement.title
      }
      timeline.followups ??= revised.followups
      return
    }
    state.conversations = mergeImported(state.conversations, chats)
    const project = state.project ?? createProject(state, { name: 'Thought Radar',
      goal: '整理当前黑客松项目的多段历史对话，追踪各个问题的探索过程，将有用的结论合并回项目主线。' })
    const version = state.versions[0]
    if (state.runs.length === 0) {
      const lines = final.text.split(/\r?\n/).map((line) => line.trim())
      version.confirmed_decisions = ['项目范围：', '主线更新：', 'Demo 入口：']
        .map((prefix, index) => ({ id: 'local-decision-' + index, text: lines.find((line) => line.startsWith(prefix)),
          source_ids: [final.source_id] })).filter((item) => item.text)
    }
    state.runs.push({ ...materializeAnalysis(draft, project, version, chats), id: timelineId })
  })
}

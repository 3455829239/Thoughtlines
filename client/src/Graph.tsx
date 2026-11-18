import { useEffect, useMemo, useRef, useState } from 'react'
import { BaseEdge, Controls, Handle, Position, ReactFlow, type Edge, type EdgeProps, type Node, type NodeProps } from '@xyflow/react'
import type { CSSProperties, ReactNode } from 'react'
import type { Candidate, MainVersion, Run, Selection } from './types'

export const colors = ['#397fc5', '#238d84', '#b65b35', '#6155b2', '#a13b75', '#64752a', '#446a7d', '#9a5f15']
export const kinds = { exploration: '探索', refinement: '细化', evidence: '证据', decision: '决策', revision: '修正' }
export const statuses = { open: '未解决', exploring: '探索中', concluded: '已有结论' }
export const mergeTitle = (candidate: Candidate) => candidate.title ?? candidate.proposed_change.split(/[。；\n]/u)[0]

type RadarNode = Node<{
  title: string; caption: string; tone: string; item: Selection; lane: number; gutter: number; kind: string;
  open: (item: Selection) => void
}, 'radar'>
type RadarEdge = Edge<{ bend?: 'source' | 'target' }, 'track'>

function Row({ data, selected }: NodeProps<RadarNode>) {
  const style = { '--tone': data.tone, '--lane': data.lane + 'px', '--gutter': data.gutter + 'px' } as CSSProperties
  return <div className="git-row" style={style} data-kind={data.kind}>
    <Handle type="target" position={Position.Bottom} id="in" />
    <Handle type="source" position={Position.Top} id="out" />
    <button type="button" className="git-row-button nodrag nopan" aria-pressed={!!selected}
      aria-controls="node-details" title={data.title} onClick={() => data.open(data.item)}>
      <span className="git-dot" aria-hidden="true" />
      <span className="git-title">{data.title}</span>
      <span className="git-caption">{data.caption}</span>
    </button>
  </div>
}
const nodeTypes = { radar: Row }

function Track({ id, sourceX, sourceY, targetX, targetY, style, data }: EdgeProps<RadarEdge>) {
  const turn = Math.min(25, Math.abs(sourceY - targetY))
  const bendAtSource = data?.bend === 'source'
  const start = bendAtSource ? sourceY : targetY + turn
  const end = bendAtSource ? sourceY - turn : targetY
  const path = sourceX === targetX ? `M ${sourceX} ${sourceY} V ${targetY}`
    : `M ${sourceX} ${sourceY} V ${start} C ${sourceX} ${start - turn / 2} ${targetX} ${end + turn / 2} ${targetX} ${end} V ${targetY}`
  return <BaseEdge id={id} path={path} style={style} interactionWidth={0} />
}
const edgeTypes = { track: Track }

function layout(versions: MainVersion[], run: Run, mergeRecords: Candidate[], width: number, open: (item: Selection) => void) {
  const nodes: RadarNode[] = []
  const edges: RadarEdge[] = []
  const laneGap = Math.min(20, 82 / Math.max(run.branches.length, 1))
  const gutter = 31 + run.branches.length * laneGap
  const mainColor = '#6c7683'
  const addNode = (item: Selection, title: string, caption: string, tone: string, lane: number, kind: string = item.kind) => {
    nodes.push({ id: item.id, type: 'radar', position: { x: 0, y: 0 }, style: { width },
      data: { item, title, caption, tone, lane: 14 + lane * laneGap, gutter, kind, open } })
  }
  const addEdge = (source: string, target: string, tone: string, bend?: 'source' | 'target') => {
    edges.push({ id: source + '>' + target, source, target, type: 'track', data: { bend },
      sourceHandle: 'out', targetHandle: 'in', focusable: false, selectable: false,
      style: { stroke: tone, opacity: 0.54, strokeWidth: 1.35, strokeDasharray: bend === 'target' ? '4 3' : undefined } })
  }

  const base = versions.find((version) => version.version_number === run.base_version) ?? versions[0]
  const commits = new Map(run.commits.map((commit) => [commit.id, commit]))
  let parentMain: string | undefined
  versions.forEach((version) => {
    const merged = mergeRecords.find((item) => version.merged_candidate_ids.includes(item.id))
    addNode({ kind: 'version', id: version.id }, merged ? mergeTitle(merged) : '建立项目基线',
      (merged ? '正式合并 · v' : 'Main v') + version.version_number, mainColor, 0, merged ? 'merge' : 'version')
    if (parentMain) addEdge(parentMain, version.id, '#9ca5ae')
    parentMain = version.id
    if (version.id !== base?.id) return

    run.branches.forEach((branch, index) => {
      const tone = colors[index % colors.length]
      const lane = index + 1
      addNode({ kind: 'branch', id: branch.id }, branch.question, '分支问题', tone, lane)
      addEdge(version.id, branch.id, tone, 'source')
      let parent = branch.id
      for (const id of branch.commit_ids) {
        const commit = commits.get(id)
        if (!commit) continue
        addNode({ kind: 'commit', id }, commit.title, commit.prior ? '思考变化' : '新增信息', tone, lane)
        addEdge(parent, id, tone)
        parent = id
      }
    })
    for (const event of run.main_events ?? []) {
      addNode({ kind: 'main-event', id: event.id }, event.title,
        event.from_commit_ids.length ? '回到 Main' : 'Main · 讨论', mainColor, 0)
      addEdge(parentMain, event.id, '#9ca5ae')
      parentMain = event.id
      for (const id of event.from_commit_ids) addEdge(id, event.id, mainColor, 'target')
    }
  })

  for (const version of versions) {
    const candidate = run.candidates.find((item) => version.merged_candidate_ids.includes(item.id))
    if (!candidate) continue
    const index = run.branches.findIndex((branch) => branch.id === candidate.branch_id)
    const last = run.branches[index]?.commit_ids.filter((id) => candidate.commit_ids.includes(id)).at(-1)
    if (last) addEdge(last, version.id, colors[index % colors.length], 'target')
  }

  return { nodes: nodes.reverse().map((node, index) => ({ ...node, position: { x: 12, y: 12 + index * 39 } })), edges }
}

export function Graph({ run, versions, mergeRecords, selected, onSelect, empty }: {
  run?: Run; versions: MainVersion[]; mergeRecords: Candidate[]; selected: Selection | null; onSelect: (item: Selection) => void; empty: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(320)
  useEffect(() => {
    const element = panel.current
    if (!element) return
    const measure = () => setWidth(Math.max(1, element.clientWidth - 24))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [!!run])
  const graph = useMemo(() => run && layout(versions, run, mergeRecords, width, onSelect), [versions, run, mergeRecords, width, onSelect])
  if (!run || !graph) return <div className="graph-grid graph-empty">{empty}</div>
  return <div ref={panel} className="graph-grid graph-flow"
    style={{ height: Math.min(510, Math.max(235, graph.nodes.length * 39 + 49)) }}>
    <ReactFlow<RadarNode, RadarEdge> key={run.id}
      nodes={graph.nodes.map((node) => ({ ...node, selected: node.id === selected?.id }))}
      edges={graph.edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
      defaultViewport={{ x: 0, y: 0, zoom: 1 }} fitViewOptions={{ padding: 0.06, maxZoom: 1 }}
      minZoom={0.2} maxZoom={2} panOnScroll zoomOnScroll={false} zoomOnDoubleClick={false}
      nodesDraggable={false} nodesConnectable={false} nodesFocusable={false} elementsSelectable={false}
      proOptions={{ hideAttribution: true }}>
      <Controls position="bottom-right" showInteractive={false} />
    </ReactFlow>
  </div>
}

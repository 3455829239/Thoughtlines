export type Project = { id: string; name: string; goal: string; current_version: number }
export type ChatInfo = {
  id: string; title: string; format: 'official' | 'linear'; created_at: string | null
  updated_at: string | null; message_count: number; path_count: number
}
export type Message = {
  source_id: string; message_id: string; conversation_id: string; role: 'user' | 'assistant'
  text: string; timestamp: string | null; message_id_is_local: boolean
}
export type Chat = Pick<ChatInfo, 'id' | 'title' | 'format'> & {
  link: string | null; messages: Message[]
  paths: { id: string; kind: 'current' | 'alternate'; source_ids: string[] }[]
}
export type EvidenceMessage = Message & { title: string; link: string | null }
export type Match = {
  conversation_id: string; score: number; terms: string[]
  relevant?: boolean; reason?: string; source_ids?: string[]
}
export type Branch = {
  id: string; question: string; status: 'open' | 'exploring' | 'concluded'; source_ids: string[]; commit_ids: string[]
  theme?: { label: string; summary: string; keywords: string[]; source_ids: string[] }
}
export type PriorThought = { text: string; source_ids: string[] }
export type Commit = {
  id: string; branch_id: string; type: 'exploration' | 'refinement' | 'evidence' | 'decision' | 'revision'
  title: string; summary: string; reason: string; timestamp: string | null; confidence: number | null; source_ids: string[]
  prior?: PriorThought
}
export type Section = 'plan' | 'confirmed_decisions' | 'unresolved_questions'
export type Candidate = {
  title?: string
  id: string; branch_id: string; commit_ids: string[]; source_ids: string[]; reason: string
  target_section: Section; target_item_id: string | null; expected_text: string | null; operation: 'add' | 'replace' | 'resolve'
  proposed_change: string; status: 'pending' | 'confirmed' | 'rejected'; merged_version: number | null
}
export type MainVersion = {
  id: string; version_number: number; project_goal: string; created_at: string; merged_candidate_ids: string[]
} & Record<Section, { id: string; text: string; source_ids?: string[] }[]>
export type Question = {
  id: string; branch_id: string; question: string; source_ids: string[]; depends_on: string[]
  next_action: string; reason: string; blocking: boolean; quick_check: boolean
}
export type MainEvent = {
  id: string; title: string; summary: string; reason: string; source_ids: string[]; from_commit_ids: string[]
  prior?: PriorThought; change_label?: string
}
export type Followup = {
  id: string; kind: 'verification' | 'action'; status: 'pending' | 'done'; title: string; reason: string
  priority: boolean; source_ids: string[]
}
export type Run = {
  id: string; created_at: string; base_version: number; conversation_ids: string[]
  origin?: 'local' | 'model'
  excerpts: { conversation_id: string; message_count: number; characters: number }[]
  branches: Branch[]; commits: Commit[]; candidates: Candidate[]; questions: Question[]
  main_events?: MainEvent[]
  followups?: Followup[]
  recommendation: { question_id: string; action: string; reason: string; source_ids: string[] } | null
}
export type Workspace = {
  project: Project | null; chats: ChatInfo[]; runs: Run[]; versions: MainVersion[]; model_ready: boolean
  limits: { candidates: number; selection: number; relevanceCharsPerChat: number; analysisCharsPerChat: number; uploadMb: number; callsPerAction: number }
}
export type Selection = { kind: 'branch' | 'commit' | 'version' | 'main-event' | 'candidate' | 'question' | 'followup'; id: string }

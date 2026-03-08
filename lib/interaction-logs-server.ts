export type InteractionEventType =
  | "initial_draft"
  | "analyze_clicked"
  | "suggestion_revealed"
  | "edit_detected"
  | "final_submission"
  | "revision_insights_viewed"
  | "pdf_exported"
  | "revision_insights_read_time"

export type SessionCondition = "baseline" | "multilevel"
export type DraftStage = "initial" | "after_edit" | "final"
export type FeedbackLevel = 1 | 2 | 3

export interface SessionRow {
  id: string
  condition: string
  started_at: string
  submitted_at: string | null
  student_name?: string | null
  student_id?: string | null
}

export interface IssueRow {
  id: string
  session_id: string
  element_type: string
  issue_index: number
  corrected_text: string | null
  initial_text: string | null
  original_text: string | null
  suggested_correction: string | null
}

export interface InteractionLogRow {
  id: string
  session_id: string
  issue_id: string | null
  event_type: InteractionEventType
  feedback_level: FeedbackLevel | null
  timestamp: string
  metadata: Record<string, unknown> | null
}

export interface DraftSnapshotRow {
  id: string
  session_id: string
  issue_id: string | null
  stage: DraftStage
  draft_text: string
  timestamp: string
}

interface InsertInteractionLogInput {
  session_id: string
  issue_id?: string | null
  event_type: InteractionEventType
  feedback_level?: FeedbackLevel | null
  metadata?: Record<string, unknown> | null
  timestamp?: string
}

interface InsertDraftSnapshotInput {
  session_id: string
  issue_id?: string | null
  stage: DraftStage
  draft_text: string
  timestamp?: string
}

interface InsertIssueInput {
  session_id: string
  element_type: string
  issue_index: number
  initial_text?: string | null
  original_text?: string | null
  corrected_text?: string | null
   suggested_correction?: string | null
}

function getSupabaseConfig() {
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Supabase environment is missing. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    )
  }

  return { supabaseUrl, serviceRoleKey }
}

export async function upsertSession(
  sessionId: string,
  condition: SessionCondition = "multilevel",
  options?: {
    studentName?: string
    studentId?: string
    startedAt?: string
  },
): Promise<SessionRow> {  
  const { supabaseUrl, serviceRoleKey } = getSupabaseConfig()
  const startedAt = options?.startedAt ?? new Date().toISOString()

  const response = await fetch(`${supabaseUrl}/rest/v1/sessions`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify({
      id: sessionId,
      condition,
      started_at: startedAt,
      submitted_at: null,
      ...(options?.studentName !== undefined && { student_name: options.studentName.trim() || null }),
      ...(options?.studentId !== undefined && { student_id: options.studentId.trim() || null }),
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Failed to upsert session: ${response.status} ${body}`)
  }

  const rows = (await response.json()) as SessionRow[]
  return rows[0]
}

export async function updateSessionSubmittedAt(sessionId: string): Promise<SessionRow> {
  const { supabaseUrl, serviceRoleKey } = getSupabaseConfig()

  const url = new URL(`${supabaseUrl}/rest/v1/sessions`)
  url.searchParams.set("id", `eq.${sessionId}`)

  const response = await fetch(url.toString(), {
    method: "PATCH",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({ submitted_at: new Date().toISOString() }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Failed to update session submitted_at: ${response.status} ${body}`)
  }

  const rows = (await response.json()) as SessionRow[]
  return rows[0]
}

export async function updateSessionReflectiveSummary(sessionId: string, reflectiveSummary: string): Promise<SessionRow> {
  const { supabaseUrl, serviceRoleKey } = getSupabaseConfig()

  const url = new URL(`${supabaseUrl}/rest/v1/sessions`)
  url.searchParams.set("id", `eq.${sessionId}`)

  const response = await fetch(url.toString(), {
    method: "PATCH",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({ reflective_summary: reflectiveSummary }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Failed to update session reflective_summary: ${response.status} ${body}`)
  }

  const rows = (await response.json()) as SessionRow[]
  return rows[0]
}

export async function insertIssues(inputs: InsertIssueInput[]): Promise<IssueRow[]> {
  if (inputs.length === 0) return []

  const { supabaseUrl, serviceRoleKey } = getSupabaseConfig()
  const uniqueSessionIds = [...new Set(inputs.map((input) => input.session_id))]
  await Promise.all(uniqueSessionIds.map((sessionId) => upsertSession(sessionId, "baseline")))

  const payload = inputs.map((input) => ({
    ...input,
    suggested_correction: input.suggested_correction ?? null,
  }))

  const response = await fetch(`${supabaseUrl}/rest/v1/issues`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  })

  const text = await response.text()

  if (!response.ok) {
    throw new Error(`Failed to insert issues: ${response.status} ${text}`)
  }

  const rows = JSON.parse(text) as IssueRow[]
  return rows
}

export async function insertInteractionLog(
  input: InsertInteractionLogInput
): Promise<InteractionLogRow> {
  const { supabaseUrl, serviceRoleKey } = getSupabaseConfig()
  await upsertSession(input.session_id, "baseline")

  const eventToFeedbackLevel: Partial<Record<InteractionEventType, FeedbackLevel>> = {
    initial_draft: 1,
    suggestion_revealed: 3,
  }

  const computedFeedbackLevel =
    eventToFeedbackLevel[input.event_type] ??
    input.feedback_level ??
    null

  const payload = {
    session_id: input.session_id,
    issue_id: input.issue_id ?? null,
    event_type: input.event_type,
    feedback_level: computedFeedbackLevel,
    metadata: input.metadata ?? null,
    timestamp: input.timestamp ?? new Date().toISOString(),
  }

  const response = await fetch(
    `${supabaseUrl}/rest/v1/interaction_logs`,
    {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(payload),
    }
  )

  const text = await response.text()

  if (!response.ok) {
    throw new Error(
      `Failed to insert interaction log: ${response.status} ${text}`
    )
  }

  const rows = JSON.parse(text) as InteractionLogRow[]
  return rows[0]
}

export async function insertDraftSnapshot(input: InsertDraftSnapshotInput): Promise<DraftSnapshotRow> {
  const { supabaseUrl, serviceRoleKey } = getSupabaseConfig()
  await upsertSession(input.session_id, "baseline")

  const response = await fetch(`${supabaseUrl}/rest/v1/draft_snapshots`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      session_id: input.session_id,
      issue_id: input.issue_id ?? null,
      stage: input.stage,
      draft_text: input.draft_text,
      timestamp: input.timestamp ?? new Date().toISOString(),
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    const isUniqueViolation = response.status === 409 && body.includes(`"code":"23505"`)
    const isDuplicateInitial = isUniqueViolation && input.stage === "initial"
    if (isDuplicateInitial) {
      console.warn("Duplicate initial draft snapshot detected; returning existing snapshot", {
        session_id: input.session_id,
        stage: input.stage,
      })
      const existing = await getDraftSnapshotBySessionAndStage(input.session_id, "initial")
      if (existing) {
        return existing
      }
      throw new Error(
        `Duplicate initial draft snapshot detected but no existing row found for session ${input.session_id}`,
      )
    }
    throw new Error(`Failed to insert draft snapshot: ${response.status} ${body}`)
  }

  const rows = (await response.json()) as DraftSnapshotRow[]
  return rows[0]
}

export async function updateDraftSnapshotById(
  id: string,
  input: {
    draft_text?: string
    issue_id?: string | null
    stage?: DraftStage
    timestamp?: string
  },
): Promise<DraftSnapshotRow> {
  const { supabaseUrl, serviceRoleKey } = getSupabaseConfig()

  const url = new URL(`${supabaseUrl}/rest/v1/draft_snapshots`)
  url.searchParams.set("id", `eq.${id}`)

  const response = await fetch(url.toString(), {
    method: "PATCH",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      draft_text: input.draft_text,
      issue_id: input.issue_id ?? null,
      stage: input.stage,
      timestamp: input.timestamp ?? new Date().toISOString(),
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Failed to update draft snapshot: ${response.status} ${body}`)
  }

  const rows = (await response.json()) as DraftSnapshotRow[]
  return rows[0]
}

export async function getSessionLogs(sessionId: string): Promise<InteractionLogRow[]> {
  const { supabaseUrl, serviceRoleKey } = getSupabaseConfig()

  const url = new URL(`${supabaseUrl}/rest/v1/interaction_logs`)
  url.searchParams.set("session_id", `eq.${sessionId}`)
  url.searchParams.set("select", "id,session_id,issue_id,event_type,feedback_level,timestamp,metadata")
  url.searchParams.set("order", "timestamp.asc")

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Failed to fetch interaction logs: ${response.status} ${body}`)
  }

  return (await response.json()) as InteractionLogRow[]
}

export async function getInteractionLogBySessionAndEvent(
  sessionId: string,
  eventType: InteractionEventType,
): Promise<InteractionLogRow | null> {
  const { supabaseUrl, serviceRoleKey } = getSupabaseConfig()

  const url = new URL(`${supabaseUrl}/rest/v1/interaction_logs`)
  url.searchParams.set("session_id", `eq.${sessionId}`)
  url.searchParams.set("event_type", `eq.${eventType}`)
  url.searchParams.set("select", "id,session_id,issue_id,event_type,feedback_level,timestamp,metadata")
  url.searchParams.set("order", "timestamp.asc")
  url.searchParams.set("limit", "1")

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Failed to fetch interaction log by event: ${response.status} ${body}`)
  }

  const rows = (await response.json()) as InteractionLogRow[]
  return rows[0] ?? null
}

export async function getSessionDraftSnapshots(sessionId: string): Promise<DraftSnapshotRow[]> {
  const { supabaseUrl, serviceRoleKey } = getSupabaseConfig()

  const url = new URL(`${supabaseUrl}/rest/v1/draft_snapshots`)
  url.searchParams.set("session_id", `eq.${sessionId}`)
  url.searchParams.set("select", "id,session_id,issue_id,stage,draft_text,timestamp")
  url.searchParams.set("order", "timestamp.asc")

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Failed to fetch draft snapshots: ${response.status} ${body}`)
  }

  return (await response.json()) as DraftSnapshotRow[]
}

export async function getDraftSnapshotBySessionAndStage(
  sessionId: string,
  stage: DraftStage,
): Promise<DraftSnapshotRow | null> {
  const { supabaseUrl, serviceRoleKey } = getSupabaseConfig()

  const url = new URL(`${supabaseUrl}/rest/v1/draft_snapshots`)
  url.searchParams.set("session_id", `eq.${sessionId}`)
  url.searchParams.set("stage", `eq.${stage}`)
  url.searchParams.set("select", "id,session_id,issue_id,stage,draft_text,timestamp")
  url.searchParams.set("order", "timestamp.asc")
  url.searchParams.set("limit", "1")

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Failed to fetch draft snapshot by stage: ${response.status} ${body}`)
  }

  const rows = (await response.json()) as DraftSnapshotRow[]
  return rows[0] ?? null
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

export interface RevisionBehaviorData {
  totalEditsAfterAnalyze: number
  feedbackLevelCounts: {
    level1: number
    level2: number
    level3: number
  }
  revisionWindowMinutes: number
  thesisChangedSignificantly: boolean
  claimEvidenceStructureChanged: boolean
  mostRevisedSections: string[]
  firstDraftWordCount: number
  finalDraftWordCount: number
  firstToFinalWordDelta: number
  totalLogsAnalyzed: number
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
}

function textChangeMagnitude(a: string, b: string): number {
  const aTokens = a.toLowerCase().match(/[a-z0-9']+/g) ?? []
  const bTokens = b.toLowerCase().match(/[a-z0-9']+/g) ?? []
  const aSet = new Set(aTokens)
  const bSet = new Set(bTokens)
  let diff = Math.abs(aTokens.length - bTokens.length)
  for (const t of aSet) if (!bSet.has(t)) diff += 1
  for (const t of bSet) if (!aSet.has(t)) diff += 1
  return diff
}

export function buildRevisionBehaviorData(logs: InteractionLogRow[], snapshots: DraftSnapshotRow[]): RevisionBehaviorData {
  const initialDraftEvent = logs.find((log) => log.event_type === "initial_draft")
  const analyzeClickedEvent = logs.find((log) => log.event_type === "analyze_clicked")
  const finalSubmissionEvent = [...logs].reverse().find((log) => log.event_type === "final_submission")
  const initialDraftSnapshot = snapshots.find((snapshot) => snapshot.stage === "initial")
  const finalDraftSnapshot = [...snapshots].reverse().find((snapshot) => snapshot.stage === "final")

  const startMs = analyzeClickedEvent
    ? Date.parse(analyzeClickedEvent.timestamp)
    : initialDraftEvent
      ? Date.parse(initialDraftEvent.timestamp)
      : Date.now()
  const endMs = finalSubmissionEvent ? Date.parse(finalSubmissionEvent.timestamp) : Date.now()
  const logsInWindow = logs.filter((log) => Date.parse(log.timestamp) >= startMs && Date.parse(log.timestamp) <= endMs)
  const snapshotsInWindow = snapshots.filter(
    (snapshot) => Date.parse(snapshot.timestamp) >= startMs && Date.parse(snapshot.timestamp) <= endMs,
  )

  const feedbackLevelCounts = {
    level1: logsInWindow.filter((log) => log.feedback_level === 1).length,
    level2: logsInWindow.filter((log) => log.feedback_level === 2).length,
    level3: logsInWindow.filter((log) => log.feedback_level === 3).length,
  }

  const firstDraftText = initialDraftSnapshot?.draft_text ?? ""
  const finalDraftText = finalDraftSnapshot?.draft_text ?? ""
  const sectionScores = new Map<string, number>()
  for (let i = 1; i < snapshotsInWindow.length; i += 1) {
    const prev = splitParagraphs(snapshotsInWindow[i - 1]?.draft_text ?? "")
    const next = splitParagraphs(snapshotsInWindow[i]?.draft_text ?? "")
    const maxLen = Math.max(prev.length, next.length)
    for (let p = 0; p < maxLen; p += 1) {
      const change = textChangeMagnitude(prev[p] ?? "", next[p] ?? "")
      if (!change) continue
      const key = p === 0 ? "introduction" : `paragraph_${p + 1}`
      sectionScores.set(key, (sectionScores.get(key) ?? 0) + change)
    }
  }
  const mostRevisedSections = [...sectionScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([label]) => label)

  return {
    totalEditsAfterAnalyze: logsInWindow.filter((log) => log.event_type === "edit_detected").length,
    feedbackLevelCounts,
    revisionWindowMinutes: Math.max(0, Math.round((endMs - startMs) / 60000)),
    thesisChangedSignificantly: false,
    claimEvidenceStructureChanged: false,
    mostRevisedSections,
    firstDraftWordCount: wordCount(firstDraftText),
    finalDraftWordCount: wordCount(finalDraftText),
    firstToFinalWordDelta: wordCount(finalDraftText) - wordCount(firstDraftText),
    totalLogsAnalyzed: logsInWindow.length,
  }
}

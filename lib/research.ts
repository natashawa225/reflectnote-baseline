import type { AnalysisResult, ArgumentElement } from "@/lib/types"
import { assertSupabaseClientConfig, supabase } from "@/lib/supabaseClient"

export type InteractionEventType =
  | "initial_draft"
  | "corrected_viewed"
  | "edit_detected"
  | "final_submission"

export type DraftStage = "initial" | "after_edit" | "final"

type IssueElementType = "claim" | "evidence" | "rebuttal"

export interface SessionIssue {
  id: string
  key: string
  elementType: IssueElementType
  issueIndex: number
  originalText: string
  correctedText: string
}

export async function ensureSession(sessionId: string): Promise<void> {
  assertSupabaseClientConfig()
  const { data, error } = await supabase.from("sessions").select("id").eq("id", sessionId).limit(1)

  if (error) {
    throw error
  }

  if (data && data.length > 0) {
    return
  }

  const { error: insertError } = await supabase.from("sessions").insert({ id: sessionId, condition: "baseline" })

  if (insertError) {
    throw insertError
  }
}

export async function hasInitialDraftLog(sessionId: string): Promise<boolean> {
  assertSupabaseClientConfig()
  const { data } = await supabase
    .from("interaction_logs")
    .select("id")
    .eq("session_id", sessionId)
    .eq("event_type", "initial_draft")
    .limit(1)

  return !!data?.length
}

export async function logEvent(params: {
  sessionId: string
  eventType: InteractionEventType
  issueId?: string | null
  metadata?: Record<string, unknown>
}): Promise<void> {
  assertSupabaseClientConfig()
  const { sessionId, eventType, issueId, metadata } = params
  const feedbackLevel = eventType === "corrected_viewed" ? 3 : null

  if (eventType === "corrected_viewed" && !issueId) {
    throw new Error("issueId is required when eventType is corrected_viewed")
  }

  const { error } = await supabase.from("interaction_logs").insert({
    session_id: sessionId,
    issue_id: issueId ?? null,
    event_type: eventType,
    feedback_level: feedbackLevel,
    metadata: metadata ?? null,
  })

  if (error) {
    throw error
  }
}

export async function saveDraftSnapshot(params: {
  sessionId: string
  stage: DraftStage
  draftText: string
}): Promise<void> {
  assertSupabaseClientConfig()
  const { sessionId, stage, draftText } = params
  const { error } = await supabase.from("draft_snapshots").insert({
    session_id: sessionId,
    stage,
    draft_text: draftText,
  })

  if (error) {
    throw error
  }
}

function normalizeIssueText(text?: string): string {
  return (text ?? "").trim()
}

function pushIssue(
  issues: Omit<SessionIssue, "id">[],
  issue: {
    key: string
    elementType: IssueElementType
    issueIndex: number
    element: ArgumentElement
  },
): boolean {
  const originalText = normalizeIssueText(issue.element.text)
  const correctedText = normalizeIssueText(issue.element.suggestion)

  if (!originalText || !correctedText) return false

  issues.push({
    key: issue.key,
    elementType: issue.elementType,
    issueIndex: issue.issueIndex,
    originalText,
    correctedText,
  })

  return true
}

function buildIssues(analysis: AnalysisResult): Omit<SessionIssue, "id">[] {
  const built: Omit<SessionIssue, "id">[] = []
  let nextIssueIndex = 1

  analysis.elements.claims.forEach((claim, index) => {
    const pushed = pushIssue(built, {
      key: `claim-${index}`,
      elementType: "claim",
      issueIndex: nextIssueIndex,
      element: claim,
    })
    if (pushed) nextIssueIndex += 1
  })

  analysis.elements.evidence.forEach((evidence, index) => {
    const pushed = pushIssue(built, {
      key: `evidence-${index}`,
      elementType: "evidence",
      issueIndex: nextIssueIndex,
      element: evidence,
    })
    if (pushed) nextIssueIndex += 1
  })

  pushIssue(built, {
    key: "rebuttal",
    elementType: "rebuttal",
    issueIndex: nextIssueIndex,
    element: analysis.elements.rebuttal,
  })

  return built
}

export async function replaceSessionIssues(
  sessionId: string,
  analysis: AnalysisResult,
): Promise<Record<string, SessionIssue>> {
  assertSupabaseClientConfig()
  const issueRows = buildIssues(analysis)

  const { error: deleteError } = await supabase.from("issues").delete().eq("session_id", sessionId)
  if (deleteError) {
    throw deleteError
  }

  if (!issueRows.length) return {}

  const { data, error } = await supabase
    .from("issues")
    .insert(
      issueRows.map((issue) => ({
        session_id: sessionId,
        element_type: issue.elementType,
        issue_index: issue.issueIndex,
        original_text: issue.originalText,
        corrected_text: issue.correctedText,
      })),
    )
    .select("id, element_type, issue_index, original_text, corrected_text")

  if (error) {
    throw error
  }

  const map: Record<string, SessionIssue> = {}
  for (const row of data ?? []) {
    const key = issueRows.find(
      (issue) =>
        issue.elementType === row.element_type &&
        issue.issueIndex === row.issue_index &&
        issue.originalText === row.original_text &&
        issue.correctedText === row.corrected_text,
    )?.key

    if (!key) continue

    map[key] = {
      id: row.id,
      key,
      elementType: row.element_type,
      issueIndex: row.issue_index,
      originalText: row.original_text,
      correctedText: row.corrected_text,
    }
  }

  return map
}

export async function markSessionSubmitted(sessionId: string): Promise<void> {
  assertSupabaseClientConfig()
  const { error } = await supabase
    .from("sessions")
    .update({ submitted_at: new Date().toISOString() })
    .eq("id", sessionId)

  if (error) {
    throw error
  }
}

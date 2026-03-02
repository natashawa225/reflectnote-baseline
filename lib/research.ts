import type { AnalysisResult, ArgumentElement } from "@/lib/types"

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

async function researchRequest<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  let response: Response
  try {
    response = await fetch("/api/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, payload }),
    })
  } catch (error) {
    console.error(`[researchRequest] network error during ${action}:`, error)
    throw new Error(`Research API ${action} network error`)
  }

  const json = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(json?.error || `Research API ${action} failed`)
  }

  return json as T
}

export async function ensureSession(sessionId: string): Promise<void> {
  await researchRequest("ensureSession", { sessionId })
}

export async function hasInitialDraftLog(sessionId: string): Promise<boolean> {
  const data = await researchRequest<{ exists: boolean }>("hasInitialDraftLog", { sessionId })
  return data.exists
}

export async function logEvent(params: {
  sessionId: string
  eventType: InteractionEventType
  issueId?: string | null
  metadata?: Record<string, unknown>
}): Promise<void> {
  const { sessionId, eventType, issueId, metadata } = params
  await researchRequest("logEvent", { sessionId, eventType, issueId: issueId ?? null, metadata: metadata ?? null })
}

export async function saveDraftSnapshot(params: {
  sessionId: string
  stage: DraftStage
  draftText: string
}): Promise<void> {
  const { sessionId, stage, draftText } = params
  await researchRequest("saveDraftSnapshot", { sessionId, stage, draftText })
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
  const issueRows = buildIssues(analysis)
  const data = await researchRequest<{ issuesByKey: Record<string, SessionIssue> }>("replaceSessionIssues", {
    sessionId,
    issues: issueRows,
  })
  return data.issuesByKey
}

export async function markSessionSubmitted(sessionId: string): Promise<void> {
  await researchRequest("markSessionSubmitted", { sessionId })
}

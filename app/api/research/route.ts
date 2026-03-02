import { NextResponse } from "next/server"
import { assertSupabaseAdminConfig, supabaseAdmin } from "@/lib/supabaseAdmin"

type InteractionEventType = "initial_draft" | "corrected_viewed" | "edit_detected" | "final_submission"
type DraftStage = "initial" | "after_edit" | "final"
type IssueElementType = "claim" | "evidence" | "rebuttal"

type IssuePayload = {
  key: string
  elementType: IssueElementType
  issueIndex: number
  originalText: string
  correctedText: string
}

export async function POST(req: Request) {
  try {
    assertSupabaseAdminConfig()
    const { action, payload } = await req.json()

    if (!action) {
      return NextResponse.json({ error: "action is required" }, { status: 400 })
    }

    if (action === "ensureSession") {
      const sessionId = String(payload?.sessionId ?? "")
      if (!sessionId) return NextResponse.json({ error: "sessionId is required" }, { status: 400 })

      const { data, error } = await supabaseAdmin.from("sessions").select("id").eq("id", sessionId).limit(1)
      if (error) throw error

      if (!data?.length) {
        const { error: insertError } = await supabaseAdmin
          .from("sessions")
          .insert({ id: sessionId, condition: "baseline" })
        if (insertError) throw insertError
      }

      return NextResponse.json({ ok: true })
    }

    if (action === "hasInitialDraftLog") {
      const sessionId = String(payload?.sessionId ?? "")
      if (!sessionId) return NextResponse.json({ error: "sessionId is required" }, { status: 400 })

      const { data, error } = await supabaseAdmin
        .from("interaction_logs")
        .select("id")
        .eq("session_id", sessionId)
        .eq("event_type", "initial_draft")
        .limit(1)
      if (error) throw error

      return NextResponse.json({ exists: Boolean(data?.length) })
    }

    if (action === "logEvent") {
      const sessionId = String(payload?.sessionId ?? "")
      const eventType = payload?.eventType as InteractionEventType
      const issueId = payload?.issueId ? String(payload.issueId) : null
      const metadata = payload?.metadata && typeof payload.metadata === "object" ? payload.metadata : null

      if (!sessionId || !eventType) {
        return NextResponse.json({ error: "sessionId and eventType are required" }, { status: 400 })
      }

      const feedbackLevel = eventType === "corrected_viewed" ? 3 : null
      if (eventType === "corrected_viewed" && !issueId) {
        return NextResponse.json({ error: "issueId is required for corrected_viewed" }, { status: 400 })
      }

      const { error } = await supabaseAdmin.from("interaction_logs").insert({
        session_id: sessionId,
        issue_id: issueId,
        event_type: eventType,
        feedback_level: feedbackLevel,
        metadata,
      })
      if (error) throw error

      return NextResponse.json({ ok: true })
    }

    if (action === "saveDraftSnapshot") {
      const sessionId = String(payload?.sessionId ?? "")
      const stage = payload?.stage as DraftStage
      const draftText = typeof payload?.draftText === "string" ? payload.draftText : ""

      if (!sessionId || !stage) {
        return NextResponse.json({ error: "sessionId and stage are required" }, { status: 400 })
      }

      const { error } = await supabaseAdmin.from("draft_snapshots").insert({
        session_id: sessionId,
        stage,
        draft_text: draftText,
      })
      if (error) throw error

      return NextResponse.json({ ok: true })
    }

    if (action === "replaceSessionIssues") {
      const sessionId = String(payload?.sessionId ?? "")
      const issues = (payload?.issues ?? []) as IssuePayload[]
      if (!sessionId) return NextResponse.json({ error: "sessionId is required" }, { status: 400 })

      const { error: deleteError } = await supabaseAdmin.from("issues").delete().eq("session_id", sessionId)
      if (deleteError) throw deleteError

      if (!issues.length) {
        return NextResponse.json({ issuesByKey: {} })
      }

      const { data, error } = await supabaseAdmin
        .from("issues")
        .insert(
          issues.map((issue) => ({
            session_id: sessionId,
            element_type: issue.elementType,
            issue_index: issue.issueIndex,
            original_text: issue.originalText,
            corrected_text: issue.correctedText,
          })),
        )
        .select("id, element_type, issue_index, original_text, corrected_text")

      if (error) throw error

      const issuesByKey: Record<string, unknown> = {}
      for (const row of data ?? []) {
        const key = issues.find(
          (issue) =>
            issue.elementType === row.element_type &&
            issue.issueIndex === row.issue_index &&
            issue.originalText === row.original_text &&
            issue.correctedText === row.corrected_text,
        )?.key

        if (!key) continue

        issuesByKey[key] = {
          id: row.id,
          key,
          elementType: row.element_type,
          issueIndex: row.issue_index,
          originalText: row.original_text,
          correctedText: row.corrected_text,
        }
      }

      return NextResponse.json({ issuesByKey })
    }

    if (action === "markSessionSubmitted") {
      const sessionId = String(payload?.sessionId ?? "")
      if (!sessionId) return NextResponse.json({ error: "sessionId is required" }, { status: 400 })

      const { error } = await supabaseAdmin
        .from("sessions")
        .update({ submitted_at: new Date().toISOString() })
        .eq("id", sessionId)
      if (error) throw error

      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  } catch (error) {
    console.error("[/api/research] error:", error)
    return NextResponse.json({ error: "Research API request failed" }, { status: 500 })
  }
}

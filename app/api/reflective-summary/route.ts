import { NextResponse } from "next/server"
import { openai } from "@/lib/openai"
import { assertSupabaseAdminConfig, supabaseAdmin } from "@/lib/supabaseAdmin"

type IssueElementType = "claim" | "evidence" | "rebuttal"

function countByType<T extends string>(values: T[]): Record<T, number> {
  return values.reduce(
    (acc, value) => {
      acc[value] = (acc[value] ?? 0) + 1
      return acc
    },
    {} as Record<T, number>,
  )
}

export async function POST(req: Request) {
  try {
    assertSupabaseAdminConfig()
    const { sessionId } = await req.json()

    if (!sessionId) {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 })
    }

    const [logsResult, issuesResult, draftsResult] = await Promise.all([
      supabaseAdmin
        .from("interaction_logs")
        .select("event_type, issue_id, timestamp, metadata")
        .eq("session_id", sessionId)
        .order("timestamp", { ascending: true }),
      supabaseAdmin
        .from("issues")
        .select("id, element_type, issue_index, original_text, corrected_text")
        .eq("session_id", sessionId),
      supabaseAdmin
        .from("draft_snapshots")
        .select("stage, draft_text, timestamp")
        .eq("session_id", sessionId)
        .in("stage", ["initial", "final"])
        .order("timestamp", { ascending: true }),
    ])

    if (logsResult.error) throw logsResult.error
    if (issuesResult.error) throw issuesResult.error
    if (draftsResult.error) throw draftsResult.error

    const logs = logsResult.data ?? []
    const issues = issuesResult.data ?? []
    const drafts = draftsResult.data ?? []

    const initialDraft = drafts.find((d) => d.stage === "initial")?.draft_text ?? ""
    const finalDraft = drafts.filter((d) => d.stage === "final").at(-1)?.draft_text ?? ""

    const correctedViewedLogs = logs.filter((log) => log.event_type === "corrected_viewed")
    const editDetectedLogs = logs.filter((log) => log.event_type === "edit_detected")
    const initialDraftLog = logs.find((log) => log.event_type === "initial_draft")
    const finalSubmissionLog = logs.find((log) => log.event_type === "final_submission")
    const issueTypeById = new Map(issues.map((issue) => [issue.id, issue.element_type as IssueElementType]))
    const viewedTypesByEvent = correctedViewedLogs
      .map((log) => (log.issue_id ? issueTypeById.get(log.issue_id) : null))
      .filter((value): value is IssueElementType => Boolean(value))
    const viewedTypeCounts = countByType(viewedTypesByEvent)
    const mostViewedElementTypes = Object.entries(viewedTypeCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({ type, count }))

    const firstEditAt = editDetectedLogs[0]?.timestamp ? new Date(editDetectedLogs[0].timestamp) : null
    const firstViewedAt = correctedViewedLogs[0]?.timestamp ? new Date(correctedViewedLogs[0].timestamp) : null
    const initialAt = initialDraftLog?.timestamp ? new Date(initialDraftLog.timestamp) : null
    const finalAt = finalSubmissionLog?.timestamp ? new Date(finalSubmissionLog.timestamp) : null
    const revisionWindowMinutes =
      initialAt && finalAt ? Math.max(0, Math.round((finalAt.getTime() - initialAt.getTime()) / 60000)) : 0
    const viewedCorrectionsBeforeEditing =
      firstViewedAt && firstEditAt ? firstViewedAt.getTime() <= firstEditAt.getTime() : false

    const prompt = [
      "You are analyzing a student's revision behavior in a baseline argumentative writing tool. Based on the interaction data below, summarize how they revised their essay, what they focused on, and what behavioral patterns are visible.",
      "",
      "Interaction data:",
      JSON.stringify(
        {
          corrected_viewed_count: correctedViewedLogs.length,
          edit_detected_count: editDetectedLogs.length,
          element_type_engagement_distribution: viewedTypeCounts,
          time_between_initial_and_final_minutes: revisionWindowMinutes,
          viewed_corrections_before_editing: viewedCorrectionsBeforeEditing,
          most_viewed_element_types: mostViewedElementTypes,
          initial_draft: initialDraft,
          final_draft: finalDraft,
          timeline: logs,
        },
        null,
        2,
      ),
      "",
      "Guidelines:",
      "- Focus on revision patterns, not raw statistics.",
      "- Describe what the student seemed to prioritize (e.g., claims, evidence, structure, clarity).",
      "- Identify one noticeable revision behavior (e.g., careful reviewing before editing, quick surface changes, focused structural improvement).",
      "- Offer one constructive suggestion for future revisions.",
      "- Keep the tone reflective and supportive.",
      "- Do not list raw counts unless they clearly support a behavioral insight.",
      "- Use this title exactly: Your Revision Insights",
    ].join("\n")

    const completion = await openai.responses.create({
      model: "gpt-4o",
      input: prompt,
      temperature: 0.4,
    })

    const summary = completion.output_text?.trim() || "Your Revision Insights\n\nYou completed your revision session."

    const { error: updateError } = await supabaseAdmin
      .from("sessions")
      .update({ reflective_summary: summary })
      .eq("id", sessionId)

    if (updateError) throw updateError

    return NextResponse.json({
      summary,
      revisionData: {
        totalEditsAfterAnalyze: editDetectedLogs.length,
        totalCorrectedViewed: correctedViewedLogs.length,
        elementTypeEngagement: viewedTypeCounts,
        revisionWindowMinutes,
        viewedCorrectionsBeforeEditing,
        feedbackLevelCounts: {
          level1: 0,
          level2: 0,
          level3: correctedViewedLogs.length,
        },
      },
    })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: "Failed to generate reflective summary" }, { status: 500 })
  }
}

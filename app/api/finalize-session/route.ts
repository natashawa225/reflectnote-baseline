import { NextResponse } from "next/server"
import { z } from "zod"
import { getOpenAIClient } from "@/lib/openai"
import {
  buildRevisionBehaviorData,
  getSessionDraftSnapshots,
  getSessionLogs,
  insertDraftSnapshot,
  insertInteractionLog,
  updateSessionReflectiveSummary,
  updateSessionSubmittedAt,
} from "@/lib/interaction-logs-server"

const bodySchema = z.object({
  session_id: z.string().uuid(),
  final_essay_text: z.string().min(1),
})

export async function POST(request: Request) {
  try {
    const parsed = bodySchema.safeParse(await request.json())

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body", details: parsed.error.issues }, { status: 400 })
    }

    const { session_id, final_essay_text } = parsed.data

    const finalLog = await insertInteractionLog({
      session_id,
      event_type: "final_submission",
      feedback_level: null,
      metadata: { source: "submit_button" },
    })

    await insertDraftSnapshot({
      session_id,
      issue_id: null,
      stage: "final",
      draft_text: final_essay_text,
    })

    const sessionRow = await updateSessionSubmittedAt(session_id)

    const allLogs = await getSessionLogs(session_id)
    const allSnapshots = await getSessionDraftSnapshots(session_id)
    const revisionData = buildRevisionBehaviorData(allLogs, allSnapshots)

    const suggestionRevealedCount = allLogs.filter((log) => log.event_type === "suggestion_revealed").length
    const editDetectedCount = allLogs.filter((log) => log.event_type === "edit_detected").length

    const issueElementViews = new Map<string, number>()
    allLogs
      .filter((log) => log.event_type === "suggestion_revealed")
      .forEach((log) => {
        const elementType = typeof log.metadata?.elementType === "string" ? log.metadata.elementType : null
        if (!elementType) return
        issueElementViews.set(elementType, (issueElementViews.get(elementType) ?? 0) + 1)
      })

    const mostViewedElementType = [...issueElementViews.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "none"

    const prompt = [
      "You are analyzing a student's revision behavior in a baseline argumentative writing tool. Based on the interaction data below, summarize how they revised their essay, what they focused on, and what behavioral patterns are visible.",
      "",
      "Interaction data:",
      JSON.stringify(
        {
          suggestion_revealed_count: suggestionRevealedCount,
          edit_detected_count: editDetectedCount,
          most_viewed_element_type: mostViewedElementType,
          revision_behavior_data: revisionData,
        },
        null,
        2,
      ),
    ].join("\n")

    let summary = "Your Revision Insights\n\nYou completed your revision session."
    try {
      const completion = await getOpenAIClient().responses.create({
        model: "gpt-4o",
        input: prompt,
        temperature: 0.4,
      })
      summary = completion.output_text?.trim() || summary
    } catch (openAiError) {
      console.error("OpenAI summary generation failed; keeping fallback summary", openAiError)
    }

    await updateSessionReflectiveSummary(session_id, summary)

    return NextResponse.json({
      success: true,
      final_submission_log_id: finalLog.id,
      revision_data: revisionData,
      summary,
      submitted_at: sessionRow.submitted_at,
    })
  } catch (error) {
    console.error("finalize-session POST failed", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to finalize session" },
      { status: 500 },
    )
  }
}

import { NextResponse } from "next/server"
import { z } from "zod"
import { openai } from "@/lib/openai"
import {
  buildRevisionBehaviorData,
  getDraftSnapshotBySessionAndStage,
  getInteractionLogBySessionAndEvent,
  getSessionDraftSnapshots,
  getSessionLogs,
  insertDraftSnapshot,
  insertInteractionLog,
  updateDraftSnapshotById,
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

    const finalLog =
      (await getInteractionLogBySessionAndEvent(session_id, "final_submission")) ??
      (await insertInteractionLog({
        session_id,
        event_type: "final_submission",
        metadata: { source: "submit_button" },
      }))

    const existingFinalSnapshot = await getDraftSnapshotBySessionAndStage(session_id, "final")
    if (!existingFinalSnapshot) {
      await insertDraftSnapshot({
        session_id,
        issue_id: null,
        stage: "final",
        draft_text: final_essay_text,
      })
    } else {
      await updateDraftSnapshotById(existingFinalSnapshot.id, {
        draft_text: final_essay_text,
        issue_id: null,
        stage: "final",
      })
    }

    const sessionRow = await updateSessionSubmittedAt(session_id)

    const allLogs = await getSessionLogs(session_id)
    const allSnapshots = await getSessionDraftSnapshots(session_id)
    const revisionData = buildRevisionBehaviorData(allLogs, allSnapshots)
    const initialSnapshot = allSnapshots.find((snapshot) => snapshot.stage === "initial")
    const latestFinalSnapshot = [...allSnapshots].reverse().find((snapshot) => snapshot.stage === "final")
    const latestSnapshot = allSnapshots[allSnapshots.length - 1]
    const initialDraft = initialSnapshot?.draft_text ?? allSnapshots[0]?.draft_text ?? ""
    const revisedDraft = latestFinalSnapshot?.draft_text ?? latestSnapshot?.draft_text ?? final_essay_text

    const fallbackSummary = `Revision Insights

Revision Activity Overview
- Total revisions after analysis: ${revisionData.totalEditsAfterAnalyze}
- Revision window: ${revisionData.revisionWindowMinutes} minutes
- Draft length change: ${revisionData.firstDraftWordCount} -> ${revisionData.finalDraftWordCount} words (${revisionData.firstToFinalWordDelta >= 0 ? "+" : ""}${revisionData.firstToFinalWordDelta})

Feedback Escalation Pattern
- Level 1 views: ${revisionData.feedbackLevelCounts.level1}
- Level 2 views: ${revisionData.feedbackLevelCounts.level2}
- Level 3 views: ${revisionData.feedbackLevelCounts.level3}

Structural Changes Observed
- Most revised sections: ${revisionData.mostRevisedSections.join(", ") || "none detected"}

Suggested Focus for Future Revision
- Continue escalating to deeper feedback levels when revising key argument sections.
- Make one final cohesion pass after substantive edits to stabilize structure.
- Track revision goals per paragraph before editing to improve efficiency.`

    let summary = fallbackSummary
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.4,
        messages: [
          {
            role: "system",
            content:
            "You are an expert writing tutor. Focus on providing **clear, student-friendly revision insights**. Do NOT discuss internal revision logs or technical feedback data. Only analyze the essay itself. Provide actionable advice students can use to improve their writing."
          },
          {
            role: "user",       content: `

Generate a \"Revision Insights\" report for a student. Use ONLY the initial and revised drafts provided below.

Structure the report with these sections:

1) Overall Writing Improvement
- Highlight how the essay improved after revision (clarity, flow, structure).

2) Argument Element Performance
- Note which claims, evidence, or counterarguments improved or still need work.

3) Revision Changes
- Summarize the main additions or improvements made in this revision.

4) Next Revision Suggestions
- Give 2–4 concrete steps for the student’s next revision.
- Use clear, actionable advice (e.g., "add a rebuttal to the counterargument" instead of "improve argument").

5) Learning Insight
- One short reflection on what this revision shows about the student’s developing writing skills.

Initial Draft:
${initialDraft}

Revised Draft:
${revisedDraft}
`
            ,
          },
        ],
      })
      summary = completion.choices[0]?.message?.content?.trim() || fallbackSummary
    } catch (openAiError) {
      console.error("OpenAI summary generation failed, returning fallback summary", openAiError)
    }

    try {
      await updateSessionReflectiveSummary(session_id, summary)
    } catch (persistError) {
      console.error("Failed to persist reflective_summary", persistError)
    }

    return NextResponse.json({
      success: true,
      final_submission_log_id: finalLog.id,
      revision_data: revisionData,
      summary,
      submitted_at: sessionRow.submitted_at,
    })
  } catch (error) {
    console.error("finalize-session POST failed", error)
    return NextResponse.json({ error: "Failed to finalize session" }, { status: 500 })
  }
}

// Revision behavior data:
// ${JSON.stringify(revisionData, null, 2)}

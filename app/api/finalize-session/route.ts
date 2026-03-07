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

    const existingInitialSnapshot = await getDraftSnapshotBySessionAndStage(session_id, "initial")
    if (!existingInitialSnapshot) {
      const existingSnapshots = await getSessionDraftSnapshots(session_id)
      const earliestAvailableDraft = existingSnapshots[0]?.draft_text?.trim() ? existingSnapshots[0].draft_text : final_essay_text
      await insertDraftSnapshot({
        session_id,
        issue_id: null,
        stage: "initial",
        draft_text: earliestAvailableDraft,
      })
    }

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
    const initialSnapshot =
      allSnapshots.find((snapshot) => snapshot.stage === "initial") ??
      (await getDraftSnapshotBySessionAndStage(session_id, "initial"))
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

Generate a **“Revision Insights” (修订洞察)** report for a student.

IMPORTANT RULES:
- Write the entire report in **Mandarin Chinese**.
- Use **third-person narration** (e.g., “该学生…”, “学生在本次修订中…”).
- Do NOT address the student directly using “你”.
- Focus on describing **what the student did, what improved, and what the student learned from the revision**.
- Use a reflective tone appropriate for a **learning history / revision record**.

Structure the report with these sections:

1) 整体写作提升（Overall Writing Improvement）
- 描述修订后文章在**清晰度、结构或连贯性**方面的整体变化。
- 说明该学生在本次修改中如何改进文章表达或组织。

2) 论证要素表现（Argument Element Performance）
- 分析论文中的**论点、证据、反方观点或反驳**是否得到加强。
- 说明哪些论证要素有所改进，哪些仍有提升空间。

3) 本次修订的主要变化（Revision Changes）
- 总结学生在本次修改中**新增、调整或强化**的内容。
- 以客观方式描述学生的修改行为，例如：
  - 增加了新的证据
  - 调整了论点表达
  - 改写了部分句子以提高清晰度

4) 下一步修改建议（Next Revision Suggestions）
- 提供 **2–4条具体、可执行的修改建议**。
- 建议应清晰具体，例如：
  - “可以增加一个反驳来回应反方观点”
  - “可以补充具体例子来支持第二个论点”

5) 学习洞察（Learning Insight）
- 用 **1–2句话总结本次修订反映出的写作学习进展**。
- 描述学生在写作发展中的一个学习点，例如：
  - 该学生开始更有意识地补充证据
  - 该学生正在逐渐形成更完整的论证结构

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

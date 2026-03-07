import { NextResponse } from "next/server"
import { z } from "zod"
import { getDraftSnapshotBySessionAndStage, insertDraftSnapshot } from "@/lib/interaction-logs-server"

const bodySchema = z.object({
  session_id: z.string().uuid(),
  issue_id: z.string().uuid().optional().nullable(),
  stage: z.enum(["initial", "after_edit", "final"]),
  draft_text: z.string(),
  timestamp: z.string().datetime().optional(),
})

export async function POST(request: Request) {
  try {
    const parsed = bodySchema.safeParse(await request.json())

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body", details: parsed.error.issues }, { status: 400 })
    }

    const sessionId = parsed.data.session_id
    const stage = parsed.data.stage
    const dedupeStage = stage === "initial" || stage === "final"

    let row = dedupeStage ? await getDraftSnapshotBySessionAndStage(sessionId, stage) : null

    if (!row) {
      row = await insertDraftSnapshot({
        session_id: sessionId,
        issue_id: parsed.data.issue_id ?? null,
        stage,
        draft_text: parsed.data.draft_text,
        timestamp: parsed.data.timestamp,
      })
    }

    return NextResponse.json({ success: true, row })
  } catch (error) {
    console.error("draft-snapshot POST failed", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save draft snapshot" },
      { status: 500 },
    )
  }
}


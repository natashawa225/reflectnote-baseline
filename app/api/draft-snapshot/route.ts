import { NextResponse } from "next/server"
import { z } from "zod"
import { insertDraftSnapshot } from "@/lib/interaction-logs-server"

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

    const row = await insertDraftSnapshot({
      session_id: parsed.data.session_id,
      issue_id: parsed.data.issue_id ?? null,
      stage: parsed.data.stage,
      draft_text: parsed.data.draft_text,
      timestamp: parsed.data.timestamp,
    })

    return NextResponse.json({ success: true, row })
  } catch (error) {
    console.error("draft-snapshot POST failed", error)
    return NextResponse.json({ error: "Failed to save draft snapshot" }, { status: 500 })
  }
}

import { NextResponse } from "next/server"
import { z } from "zod"
import { insertInteractionLog, type FeedbackLevel, type InteractionEventType } from "@/lib/interaction-logs-server"

const interactionEvents = [
  "initial_draft",
  "analyze_clicked",
  "suggestion_revealed",
  "edit_detected",
  "final_submission",
] as const

const bodySchema = z.object({
  session_id: z.string().uuid(),
  issue_id: z.string().uuid().optional().nullable(),
  event_type: z.enum(interactionEvents),
  feedback_level: z.number().int().min(1).max(3).optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
  timestamp: z.string().datetime().optional(),
})

export async function POST(request: Request) {
  try {
    const parsed = bodySchema.safeParse(await request.json())

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body", details: parsed.error.issues }, { status: 400 })
    }

    const { event_type, feedback_level } = parsed.data

    let enforcedFeedbackLevel: FeedbackLevel | null = (feedback_level as FeedbackLevel | null) ?? null

    if (event_type === "initial_draft") {
      enforcedFeedbackLevel = 1
    }

    if (event_type === "suggestion_revealed") {
      enforcedFeedbackLevel = 3
    }

    const row = await insertInteractionLog({
      session_id: parsed.data.session_id,
      issue_id: parsed.data.issue_id ?? null,
      event_type: event_type as InteractionEventType,
      feedback_level: enforcedFeedbackLevel,
      metadata: parsed.data.metadata ?? null,
      timestamp: parsed.data.timestamp,
    })

    return NextResponse.json({ success: true, row })
  } catch (error) {
    console.error("interaction-log POST failed", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to log interaction" },
      { status: 500 },
    )
  }
}

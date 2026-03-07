import { NextResponse } from "next/server"
import { z } from "zod"
import { upsertSession, type SessionCondition } from "@/lib/interaction-logs-server"

const bodySchema = z.object({
  session_id: z.string().uuid(),
  condition: z.literal("baseline").default("baseline"),
  student_name: z.string().trim().min(1),
  student_id: z.string().trim().min(1),
})

export async function POST(request: Request) {
  try {
    const parsed = bodySchema.safeParse(await request.json())

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body", details: parsed.error.issues }, { status: 400 })
    }

    // const row = await upsertSession(parsed.data.session_id, "baseline" as SessionCondition)
    const row = await upsertSession(parsed.data.session_id, parsed.data.condition as SessionCondition, {
      studentName: parsed.data.student_name,
      studentId: parsed.data.student_id,
      startedAt: new Date().toISOString(),
    })

    return NextResponse.json({ success: true, row })
  } catch (error) {
    console.error("session/start POST failed", error)
    return NextResponse.json({ error: "Failed to start session" }, { status: 500 })
  }
}

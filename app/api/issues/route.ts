import { NextResponse } from "next/server"
import { z } from "zod"
import { insertIssues } from "@/lib/interaction-logs-server"

const issueSchema = z.object({
  client_key: z.string().min(1),
  element_type: z.string().min(1),
  issue_index: z.number().int().min(1),
  initial_text: z.string().optional().nullable(),
  original_text: z.string().optional().nullable(),
  corrected_text: z.string().optional().nullable(),
})

const bodySchema = z.object({
  session_id: z.string().uuid(),
  issues: z.array(issueSchema),
})

function normalizeElementType(raw: string): string {
  const value = raw.trim().toLowerCase()
  if (value === "claims") return "claim"
  if (value === "evidence" || value === "evidences") return "evidence"
  if (value === "counterclaims") return "counterclaim"
  return value
}

export async function POST(request: Request) {
  try {
    const parsed = bodySchema.safeParse(await request.json())

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body", details: parsed.error.issues }, { status: 400 })
    }

    const payload = parsed.data.issues.map((issue) => ({
      session_id: parsed.data.session_id,
      element_type: normalizeElementType(issue.element_type),
      issue_index: issue.issue_index,
      initial_text: issue.initial_text ?? null,
      original_text: issue.original_text ?? null,
      corrected_text: issue.corrected_text ?? null,
    }))

    const rows = await insertIssues(payload)

    const withClientKeys = rows.map((row, index) => ({
      ...row,
      client_key: parsed.data.issues[index]?.client_key ?? "",
    }))

    return NextResponse.json({ success: true, rows: withClientKeys })
  } catch (error) {
    console.error("issues POST failed", error)
    return NextResponse.json({ error: "Failed to create issues" }, { status: 500 })
  }
}

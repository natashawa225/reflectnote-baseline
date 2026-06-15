import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { openai } from "@/lib/openai"

const ReasonSchema = z.union([
  z.string(),
  z.object({
    rhetorical_function: z.string().optional(),
    reader_impact: z.string().optional(),
    text_quality: z.string().optional(),
  }).transform((obj) =>
    [obj.rhetorical_function, obj.reader_impact, obj.text_quality]
      .filter(Boolean)
      .join(" ")
  ),
]).default("")

const ArgumentElementSchema = z.object({
  id: z.string().optional(),
  parentClaimId: z.string().optional(),
  text: z.string().default(""),
  effectiveness: z.enum(["Effective", "Adequate", "Ineffective", "Missing"]).default("Missing"),
  feedback: z.array(z.string()).default([]),
  suggestion: z.string().default(""),
  reason: ReasonSchema,  // <-- was z.string().default("")
})

const AnalysisResultSchema = z.object({
  elements: z.object({
    lead: ArgumentElementSchema,
    position: ArgumentElementSchema,
    claims: z.array(ArgumentElementSchema).default([]),
    counterclaim: ArgumentElementSchema,
    counterclaim_evidence: ArgumentElementSchema,
    rebuttal: ArgumentElementSchema,
    rebuttal_evidence: ArgumentElementSchema,
    evidence: z.array(ArgumentElementSchema).default([]),
    conclusion: ArgumentElementSchema,
  }),
})

const FeedbackResultSchema = AnalysisResultSchema

// ============================================================================
// XML PARSING — matches the new fine-tuned model's output format
// ============================================================================

const TAG_MAP: Record<string, string> = {
  L1:   "lead",
  P1:   "position",
  C1:   "claims",
  D1:   "evidence",
  CT1:  "counterclaims",
  CD1:  "counterclaim_evidence",
  R1:   "rebuttals",
  RD1:  "rebuttal_evidence",
  S1:   "conclusion",
}

type ParsedElement = { text: string; effectiveness: string; id?: string; parentClaimId?: string }
type ParsedXML = {
  lead?: ParsedElement
  position?: ParsedElement
  claims: ParsedElement[]
  evidence: ParsedElement[]
  counterclaims: ParsedElement[]
  counterclaim_evidence: ParsedElement[]
  rebuttals: ParsedElement[]
  rebuttal_evidence: ParsedElement[]
  conclusion?: ParsedElement
}

type XMLNode = {
  tag: keyof typeof TAG_MAP
  attributes: string
  inner: string
}

function getAttributeValue(attributes: string, name: string): string | undefined {
  return attributes.match(new RegExp(`${name}="([^"]+)"`, "i"))?.[1]
}

function normalizeTextContent(value: string): string {
  return value.replace(/<[^>]+>/g, "").trim()
}

function isMissingElementText(text?: string): boolean {
  return !text || text.trim().length === 0
}

function extractTopLevelNodes(input: string): XMLNode[] {
  const nodes: XMLNode[] = []
  const openTagPattern = /<(L1|P1|C1|D1|CT1|CD1|R1|RD1|S1)([^>]*)>/g
  let match: RegExpExecArray | null

  while ((match = openTagPattern.exec(input)) !== null) {
    const tag = match[1] as keyof typeof TAG_MAP
    const attributes = match[2] ?? ""
    const openTagStart = match.index
    const openTagEnd = openTagPattern.lastIndex

    const sameTagPattern = new RegExp(`<${tag}(?:\\s[^>]*)?>|</${tag}>`, "g")
    sameTagPattern.lastIndex = openTagEnd
    let depth = 1
    let closeTagEnd = -1
    let closeTagStart = -1
    let sameTagMatch: RegExpExecArray | null

    while ((sameTagMatch = sameTagPattern.exec(input)) !== null) {
      if (sameTagMatch[0].startsWith(`</${tag}`)) {
        depth -= 1
      } else {
        depth += 1
      }
      if (depth === 0) {
        closeTagStart = sameTagMatch.index
        closeTagEnd = sameTagPattern.lastIndex
        break
      }
    }

    if (closeTagEnd === -1 || closeTagStart === -1) {
      continue
    }

    const inner = input.slice(openTagEnd, closeTagStart)
    nodes.push({ tag, attributes, inner })

    openTagPattern.lastIndex = closeTagEnd
    if (openTagPattern.lastIndex <= openTagStart) {
      break
    }
  }

  return nodes
}

function parseXMLOutput(xml: string): ParsedXML {
  const result: ParsedXML = {
    claims: [],
    evidence: [],
    counterclaims: [],
    counterclaim_evidence: [],
    rebuttals: [],
    rebuttal_evidence: [],
  }

  const walk = (fragment: string, claimContextId?: string) => {
    const nodes = extractTopLevelNodes(fragment)

    nodes.forEach(({ tag, attributes, inner }) => {
    const key = TAG_MAP[tag]
    if (!key) return
    const rawEffectiveness = getAttributeValue(attributes, "effectiveness") ?? "Adequate"
    const id = getAttributeValue(attributes, "id")
    const parentClaimId = getAttributeValue(attributes, "parentClaimId") ?? getAttributeValue(attributes, "parent")
    const text = normalizeTextContent(inner)
    let effectiveness = normalizeEffectiveness(rawEffectiveness)
    if (isMissingElementText(text)) {
      effectiveness = "Missing"
    }

    const element: ParsedElement = {
      text,
      effectiveness,
      ...(id ? { id } : {}),
      ...(tag === "D1" && (parentClaimId || claimContextId)
        ? { parentClaimId: parentClaimId ?? claimContextId }
        : {}),
    }

    const arrayKeys = ["claims", "evidence", "counterclaims", "counterclaim_evidence", "rebuttals", "rebuttal_evidence"]
    if (arrayKeys.includes(key)) {
      (result as any)[key].push(element)
    } else {
      (result as any)[key] = element
    }

    const nextClaimContextId = tag === "C1" ? (id ?? claimContextId) : claimContextId
    if (inner.includes("<")) {
      walk(inner, nextClaimContextId)
    }
    })
  }

  walk(xml)

  return result
}

function normalizeEffectiveness(raw: string): "Effective" | "Adequate" | "Ineffective" | "Missing" {
  const map: Record<string, "Effective" | "Adequate" | "Ineffective" | "Missing"> = {
    effective: "Effective",
    adequate: "Adequate",
    ineffective: "Ineffective",
    missing: "Missing",
  }
  return map[raw.toLowerCase()] ?? "Adequate"
}

// ============================================================================
// ENRICHMENT — normalises parsed XML into the internal structure
// ============================================================================

function makeEmpty() {
  return {
    id: undefined,
    parentClaimId: undefined,
    text: "",
    effectiveness: "Missing" as const,
    feedback: [],
    suggestion: "",
    reason: "",
  }
}

function toElement(el: ParsedElement | undefined, id?: string, parentClaimId?: string) {
  if (!el) {
    return {
      ...makeEmpty(),
      ...(id ? { id } : {}),
      ...(parentClaimId ? { parentClaimId } : {}),
    }
  }
  const normalizedText = typeof el.text === "string" ? el.text.trim() : ""
  const normalizedEffectiveness = isMissingElementText(normalizedText) ? "Missing" : (el.effectiveness as any)

  return {
    id: id ?? (el as any).id,
    parentClaimId: parentClaimId ?? (el as any).parentClaimId,
    text: normalizedText,
    effectiveness: normalizedEffectiveness,
    feedback: [],
    suggestion: "",
    reason: "",
  }
}

function enrichElements(parsed: ParsedXML) {
  const claimIds = ["claim-1", "claim-2"] as const

  const parsedClaimsById = new Map<string, ParsedElement>()
  parsed.claims.forEach((claim) => {
    const rawId = (claim as any).id
    if (typeof rawId === "string" && rawId.trim()) {
      parsedClaimsById.set(rawId, claim)
    }
  })

  const usedClaimRefs = new Set<ParsedElement>()
  const pickClaimByIdOrOrder = (targetId: (typeof claimIds)[number], orderIndex: number): ParsedElement | undefined => {
    const byId = parsedClaimsById.get(targetId)
    if (byId) {
      usedClaimRefs.add(byId)
      return byId
    }

    const fallback = parsed.claims.find((c) => !usedClaimRefs.has(c)) ?? parsed.claims[orderIndex]
    if (fallback) {
      usedClaimRefs.add(fallback)
      return fallback
    }
    return undefined
  }

  const selectedClaims = claimIds.map((claimId, i) => pickClaimByIdOrOrder(claimId, i))
  const normalizedClaims = claimIds.map((claimId, i) => toElement(selectedClaims[i], claimId))

  const claimAliasToCanonical = new Map<string, string>()
  claimIds.forEach((id) => claimAliasToCanonical.set(id, id))
  selectedClaims.forEach((claim, i) => {
    const canonical = claimIds[i]
    const rawId = (claim as any)?.id
    if (typeof rawId === "string" && rawId.trim()) {
      claimAliasToCanonical.set(rawId, canonical)
    }
  })

  const normalizeParentClaimId = (rawParent?: string): string | undefined => {
    if (!rawParent) return undefined
    return claimAliasToCanonical.get(rawParent)
  }

  const evidenceByClaim = new Map<string, Array<ReturnType<typeof toElement>>>()
  claimIds.forEach((claimId) => evidenceByClaim.set(claimId, []))

  parsed.evidence.forEach((ev, i) => {
    const rawParent = (ev as any).parentClaimId as string | undefined
    const parent = normalizeParentClaimId(rawParent)
    if (!parent) return

    const rawEvidenceId = (ev as any).id as string | undefined
    const evidenceId = rawEvidenceId && rawEvidenceId.trim() ? rawEvidenceId : `evidence-${i + 1}`
    const bucket = evidenceByClaim.get(parent)
    bucket?.push(toElement(ev, evidenceId, parent))
  })

  if ((evidenceByClaim.get("claim-1") ?? []).length === 0) {
    evidenceByClaim.get("claim-1")?.push(toElement(undefined, "evidence-1", "claim-1"))
  }
  if ((evidenceByClaim.get("claim-2") ?? []).length === 0) {
    evidenceByClaim.get("claim-2")?.push(toElement(undefined, "evidence-2", "claim-2"))
  }

  const normalizedEvidence = [
    ...(evidenceByClaim.get("claim-1") ?? []),
    ...(evidenceByClaim.get("claim-2") ?? []),
  ]

  return {
    elements: {
      lead:                 toElement(parsed.lead, "lead-1"),
      position:             toElement(parsed.position, "position-1"),
      claims:               normalizedClaims,
      counterclaim:         toElement(parsed.counterclaims[0], "counterclaim-1"),
      counterclaim_evidence:toElement(parsed.counterclaim_evidence[0], "counterclaim-evidence-1"),
      rebuttal:             toElement(parsed.rebuttals[0], "rebuttal-1"),
      rebuttal_evidence:    toElement(parsed.rebuttal_evidence[0], "rebuttal-evidence-1"),
      evidence:             normalizedEvidence,
      conclusion:           toElement(parsed.conclusion, "conclusion-1"),
    },
  }
}
function countMatches(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length
}

function shouldSplitEvidenceCandidate(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false

  const citationSignals =
    countMatches(trimmed, /\b\d{4}\b/g) +
    countMatches(trimmed, /%/g) +
    countMatches(trimmed, /\b(study|research|according to|report|survey|data|statistic)\b/gi)

  const discourseSignals = countMatches(
    trimmed,
    /\b(first|second|third|also|moreover|however|furthermore|in addition|for example|for instance)\b|;/gi,
  )

  const isLong = trimmed.length > 220 || trimmed.split(/\s+/).length > 40

  return citationSignals >= 2 || discourseSignals >= 2 || isLong
}

function dedupeEvidenceParts(parts: string[]): string[] {
  const normalized = new Set<string>()
  const result: string[] = []
  for (const part of parts.map((p) => p.trim()).filter(Boolean)) {
    const key = part.toLowerCase().replace(/\s+/g, " ")
    if (key.length < 8) continue
    if (normalized.has(key)) continue
    normalized.add(key)
    result.push(part)
  }
  return result
}

async function conditionalSplitEvidence(parsed: ParsedXML): Promise<ParsedXML> {
  if (parsed.evidence.length === 0) return parsed

  const firstEvidence = parsed.evidence[0]
  if (!firstEvidence || !shouldSplitEvidenceCandidate(firstEvidence.text)) {
    return parsed
  }

  type SplitResponse = { split: boolean; parts: string[] }
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            'Return valid json only with exact shape {"split": boolean, "parts": string[]}. If split=true, return at most 2 parts.',
        },
        {
          role: "user",
          content: `Analyze ONLY this first evidence chunk. Decide whether it should be split into at most two parts.\n\nEvidence:\n${firstEvidence.text}`,
        },
      ],
    })

    const raw = completion.choices[0]?.message?.content ?? '{"split": false, "parts": []}'
    const parsedJson = JSON.parse(raw) as SplitResponse
    const parts = dedupeEvidenceParts(Array.isArray(parsedJson.parts) ? parsedJson.parts : []).slice(0, 2)
    const shouldSplit = Boolean(parsedJson.split) && parts.length === 2

    if (!shouldSplit) return parsed

    const replacement: ParsedElement[] = [
      { ...firstEvidence, text: parts[0], id: `${(firstEvidence as any).id ?? "evidence-1"}-part-1` },
      { ...firstEvidence, text: parts[1], id: `${(firstEvidence as any).id ?? "evidence-1"}-part-2` },
    ]

    return {
      ...parsed,
      evidence: [...replacement, ...parsed.evidence.slice(1)],
    }
  } catch {
    return parsed
  }
}

// ============================================================================
// ELEMENT COLLECTION / RECONSTRUCTION
// ============================================================================

type ElementEntry = { element: any; path: string; name: string; elementId: string; index?: number }

function collectElements(enriched: ReturnType<typeof enrichElements>): ElementEntry[] {
  const out: ElementEntry[] = []

  for (const name of ["lead","position","counterclaim","counterclaim_evidence","rebuttal","rebuttal_evidence","conclusion"] as const) {
    out.push({ element: enriched.elements[name], path: `elements.${name}`, name, elementId: name })
  }
  enriched.elements.claims.forEach((el, i) =>
    out.push({ element: el, path: `elements.claims[${i}]`, name: "claim", elementId: el.id?.trim() || `claim-${i + 1}`, index: i }))
  enriched.elements.evidence.forEach((el, i) =>
    out.push({ element: el, path: `elements.evidence[${i}]`, name: "evidence", elementId: el.id?.trim() || `evidence-${i + 1}`, index: i }))

  return out
}

function isMissingLikeElement(element: { text?: string; effectiveness?: string }) {
  return !element?.text?.trim() || element.effectiveness === "Missing"
}

function fallbackSuggestionForMissing(entry: ElementEntry): string {
  const n = entry.index !== undefined ? entry.index + 1 : null
  switch (entry.name) {
    case "position":
      return "You should add a clear position statement that directly answers the prompt and states your main viewpoint."
    case "claim":
      return `You should introduce ${n === 2 ? "a second claim" : "a clear claim"} that presents another reason supporting your position.`
    case "evidence":
      return `You should add ${n === 2 ? "a second piece of evidence" : "a piece of evidence"} (for example, a fact, statistic, or concrete example) to support this claim.`
    case "counterclaim":
      return "You should include a counterclaim that presents a reasonable opposing viewpoint."
    case "counterclaim_evidence":
      return "You should add evidence for the counterclaim so the opposing side is presented fairly and concretely."
    case "rebuttal":
      return "You should add a rebuttal that directly responds to the counterclaim and reinforces your position."
    case "rebuttal_evidence":
      return "You should add evidence for your rebuttal to show why your response is credible."
    case "lead":
      return "You should add a lead that introduces the topic and prepares the reader for your argument."
    case "conclusion":
      return "You should add a concluding summary that restates your position and final takeaway."
    default:
      return "You should add this missing argumentative element to make your essay more complete."
  }
}

function fallbackReasonForMissing(entry: ElementEntry): string {
  switch (entry.name) {
    case "claim":
      return "Additional claims strengthen your argument by adding depth and covering more than one aspect of the issue. Without enough claims, the essay can feel underdeveloped."
    case "evidence":
      return "Evidence makes a claim convincing by showing concrete support. Without evidence, readers may see the point as an unsupported opinion."
    case "position":
      return "A clear position anchors the whole essay and tells readers exactly what you are arguing. Without it, the argument can feel unclear."
    case "counterclaim":
      return "A counterclaim improves balance and shows you understand other perspectives. Without it, the argument may appear one-sided."
    case "rebuttal":
      return "A rebuttal shows why your position still stands after considering the opposing view. Without it, persuasion is weaker."
    default:
      return "This element improves structure, clarity, and persuasiveness by making your reasoning complete and easier for readers to follow."
  }
}

function setValueByPath(target: Record<string, any>, path: string, value: any) {
  const segments = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean)

  if (segments.length === 0) return

  let cursor: any = target
  for (let i = 0; i < segments.length - 1; i += 1) {
    const key = segments[i]
    cursor = cursor?.[key]
    if (cursor == null) return
  }

  const finalKey = segments[segments.length - 1]
  if (finalKey == null) return
  cursor[finalKey] = value
}

function reconstructStructure(enriched: ReturnType<typeof enrichElements>, entries: ElementEntry[], processed: any[]) {
  const result = JSON.parse(JSON.stringify(enriched))
  entries.forEach((entry, i) => {
    setValueByPath(result as Record<string, any>, entry.path, processed[i])
  })
  return result
}

// ============================================================================
// STEP 1 — Feedback for EFFECTIVE elements ONLY
// ============================================================================
async function batchFeedbackAll(elements: ElementEntry[], prompt: string): Promise<string[][]> {
  const effective = elements
    .map((e, i) => ({ ...e, originalIndex: i }))
    .filter(e => e.element.effectiveness === "Effective")

  const fullFeedbacks = new Array(elements.length).fill([])

  if (effective.length === 0) {
    console.log("   ℹ️ No Effective elements — skipping feedback")
    return fullFeedbacks
  }

  const list = effective.map((e, i) => {
    const label = e.index !== undefined ? `${e.name} #${e.index + 1}` : e.name
    return `${i}. ${label}\n   Element ID: ${e.elementId}\n   Text: "${e.element.text}"\n   Effectiveness: ${e.element.effectiveness}`
  }).join("\n\n")

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `Provide positive, constructive feedback on effective argumentative essay elements.

Essay prompt: """${prompt}"""

Language requirement:
- The feedback content MUST be written in Simplified Chinese.
- Do NOT write English explanations.

Feedback style:
- Use simple, student-friendly language.
- Use a supportive, teacher-like tone.

Your explanation may implicitly reflect ONE of the following:
- rhetorical function
- reader impact
- text quality

Rules:
  * Give positive reinforcement and explain why the element works well.
  * Suggest how it could be developed further


Return JSON: {"feedback": [["point1", "point2", "point3"], ...]}`
      },
      {
        role: "user",
        content: `Effective elements:\n\n${list}\n\nProvide feedback for each element in order:`,
      },
    ],
  })

  const result = JSON.parse(completion.choices[0].message.content || '{"feedback":[]}')
  const items: string[][] = result.feedback || []

  effective.forEach((e, i) => {
    fullFeedbacks[e.originalIndex] = Array.isArray(items[i]) ? items[i] : []
  })

  return fullFeedbacks
}

// ============================================================================
// STEP 2 — Suggestions + Reasons for ALL non-Effective elements (one call)
// ============================================================================

async function batchSuggestionsAndReasonsAll(
  elements: ElementEntry[],
  prompt: string,
): Promise<{ suggestions: string[]; reasons: string[] }> {
  const needs = elements
    .map((e, i) => ({ ...e, originalIndex: i }))
    .filter(e => ["Adequate", "Ineffective", "Missing"].includes(e.element.effectiveness))

  const fullSuggestions = new Array(elements.length).fill("")
  const fullReasons = new Array(elements.length).fill("")

  if (needs.length === 0) {
    console.log("   ℹ️ All elements are Effective — skipping suggestions & reasons")
    return { suggestions: fullSuggestions, reasons: fullReasons }
  }

  const list = needs.map((e, i) => {
    const label = e.index !== undefined ? `${e.name} #${e.index + 1}` : e.name
    return `${i}. ${label}\n   Element ID: ${e.elementId}\n   Original: "${e.element.text}"\n   Effectiveness: ${e.element.effectiveness}`
  }).join("\n\n")

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are a supportive writing teacher helping students improve their argumentative essays.
For EACH element below, provide TWO parts:

1. Suggestion (ENGLISH ONLY)
Essay prompt: """${prompt}"""
Write ONE concise revision that could appear in the student's essay. The revision should improve the element’s argumentative function, not only grammar or vocabulary.

Element focus: - Lead: engage the reader and connect to the position. - Position: state a clear stance related to the prompt. - Claim: give a clear reason supporting the position. - Evidence: support the claim with a clear reason, explanation, or simple example. - Counterclaim: present a reasonable opposing view. - Rebuttal: answer the counterclaim with a reason, solution, or limitation. - Concluding summary: restate the position and main claims without new ideas.
Revision strategy by effectiveness:
- If effectiveness is "Effective":
  * Make only a small improvement.
  * Do not rewrite the element heavily.
  * Keep the student’s original idea and structure.
  * The revision should polish, clarify, or slightly extend the element.

- If effectiveness is "Adequate":
  * Strengthen the existing element.
  * Make the idea clearer, more specific, better connected, or more convincing.
  * Keep the student’s main idea, but improve how well the element performs its argumentative function.

- If effectiveness is "Ineffective":
  * Rebuild the element more substantially.
  * Keep the student’s general position if possible.
  * Make the element perform its correct argumentative function.
  * The revision may change the sentence structure or add a clearer reason, example, response, or summary.

- If effectiveness is "Missing":
  * Provide a short sentence or phrase that could fill the missing element.
  * The revision should add the basic argumentative function that is absent.
  * Keep the added element short and direct.

Requirements for Suggestion:
- MUST be written in English.
- This should be a revision that could appear in the student's essay.
- Prefer rewriting the sentence or a concise portion of it rather than giving a general instruction.
- The revision should improve the student’s original writing by one small step, while still being understandable and imitable for IELTS Writing Band 5–6 learners.
- Be concise and natural.

2. Reason
Explain why the revision improves the argument.

Requirements for Reason:
- Use clear, student-friendly language.
- Mention the argumentative function being improved, such as clearer position, more specific claim, stronger evidence, clearer counterclaim, more direct rebuttal, or better conclusion.

You MUST return every key exactly once.
Do not skip keys.

Return JSON:
{
  "items": [
    {"elementId": "...", "suggestion": "...", "reason": "..."},
    ...
  ]
}
Return valid json only.
`,
      },
      {
        role: "user",
        content: `Elements to improve:\n\n${list}`,
      },
    ],
  })

  const result = JSON.parse(completion.choices[0].message.content || '{"items":[]}')
  const items: Array<{ elementId?: string; suggestion: string; reason: string | Record<string, string> }> = result.items || []
  const itemsById = new Map<string, { suggestion: string; reason: string | Record<string, string> }>()
  items.forEach((item) => {
    const id = typeof item.elementId === "string" ? item.elementId.trim() : ""
    if (!id) return
    itemsById.set(id, item)
  })

  needs.forEach((e, i) => {
    const responseItem = itemsById.get(e.elementId) ?? items[i]
    fullSuggestions[e.originalIndex] = responseItem?.suggestion || ""

    // FIX: handle reason as either a plain string or an object with sub-fields
    const rawReason = responseItem?.reason
    if (rawReason && typeof rawReason === "object") {
      const r = rawReason as { rhetorical_function?: string; reader_impact?: string; text_quality?: string }
      fullReasons[e.originalIndex] = [
        r.rhetorical_function,
        r.reader_impact,
        r.text_quality,
      ]
        .filter(Boolean)
        .join(" ")
    } else {
      fullReasons[e.originalIndex] = typeof rawReason === "string" ? rawReason : ""
    }

    if (isMissingLikeElement(e.element)) {
      if (!fullSuggestions[e.originalIndex]) {
        fullSuggestions[e.originalIndex] = fallbackSuggestionForMissing(e)
      }
      if (!fullReasons[e.originalIndex]) {
        fullReasons[e.originalIndex] = fallbackReasonForMissing(e)
      }
    }
  })

  return { suggestions: fullSuggestions, reasons: fullReasons }
}

// ============================================================================
// MAIN CHAIN — 2 LLM calls total (after FT model)
// ============================================================================
async function runFeedbackChain(elements: ElementEntry[], prompt: string): Promise<any[]> {
  const start = Date.now()
  console.log(`\n🔗 Starting parallel 2-step feedback chain for ${elements.length} elements`)

  // Run both steps IN PARALLEL — they operate on different subsets
  console.log("📍 Running feedback (Effective) + suggestions (non-Effective) in parallel...")
  const [feedbacks, { suggestions, reasons }] = await Promise.all([
    batchFeedbackAll(elements, prompt),
    batchSuggestionsAndReasonsAll(elements, prompt),
  ])

  console.log(`🎉 Chain complete in ${Date.now() - start}ms`)

  return elements.map((e, i) => ({
    ...e.element,
    feedback: Array.isArray(feedbacks[i]) ? feedbacks[i] : [],
    suggestion: suggestions[i] || "",
    reason: reasons[i] || "",
  }))
}

// ============================================================================
// FINE-TUNED MODEL SYSTEM PROMPT (XML output format)
// ============================================================================

const FT_SYSTEM_PROMPT = `Parse the following L2 argumentative essay into argumentative elements using XML tags.

Tag definitions:
L1 = Lead
P1 = Position
C1 = Claim
D1 = Evidence
CT1 = Counterclaim
CD1 = Counterargument_Evidence
R1 = Rebuttal
RD1 = Rebuttal_Evidence
S1 = Concluding Statement

Instructions:
- Wrap each argumentative element in its correct XML tag and include an effectiveness attribute.
- For each claim (C1), include id="claim-N".
- For each evidence (D1), include id="evidence-N" and parentClaimId="claim-N" referencing the claim it supports.
- Do not modify the original wording.
- Output only the tagged essay.`

// ============================================================================
// ROUTE HANDLER
// ============================================================================

export async function POST(request: NextRequest) {
  const totalStart = Date.now()

  try {
    const { essay, prompt } = await request.json()
    const FT_MODEL = process.env.FT_MODEL ?? "gpt-4o-mini"

    // ── FT Model: structure + effectiveness via XML ──────────────────────────
    let rawXML: string
    let modelUsed = FT_MODEL

    try {
      console.log("⚡ Using FT model:", modelUsed)
      const completion = await openai.chat.completions.create({
        model: modelUsed,
        messages: [
          { role: "system", content: FT_SYSTEM_PROMPT },
          { role: "user", content: `Prompt: ${prompt ?? ""}\n\nEssay:\n${essay}` },
        ],
      })
      rawXML = completion.choices[0].message.content ?? ""
    } catch (err: any) {
      console.warn("⚠️ FT model unavailable, falling back to gpt-4o-mini:", err.message)
      modelUsed = "gpt-4o-mini"
      const completion = await openai.chat.completions.create({
        model: modelUsed,
        messages: [
          { role: "system", content: FT_SYSTEM_PROMPT },
          { role: "user", content: `Prompt: ${prompt ?? ""}\n\nEssay:\n${essay}` },
        ],
      })
      rawXML = completion.choices[0].message.content ?? ""
    }

    console.log("🔍 Raw FT XML output:\n", rawXML)
    console.log(`⏱️ FT model: ${Date.now() - totalStart}ms`)

    // ── Parse XML → internal structure ──────────────────────────────────────
    const parsed = parseXMLOutput(rawXML)
    const parsedWithConditionalEvidenceSplit = await conditionalSplitEvidence(parsed)
    const enriched = enrichElements(parsedWithConditionalEvidenceSplit)

    // ── Run 2-step feedback chain ────────────────────────────────────────────
    const allElements = collectElements(enriched)
    const processedElements = await runFeedbackChain(allElements, prompt ?? "")
    const finalResult = reconstructStructure(enriched, allElements, processedElements)

    // ── Validate with Zod ────────────────────────────────────────────────────
    const validated = FeedbackResultSchema.safeParse(finalResult)
    if (!validated.success) {
      console.error("❌ Zod validation failed", validated.error.format())
      return NextResponse.json(
        { error: "Schema validation failed", issues: validated.error.format() },
        { status: 400 }
      )
    }

    console.log(`🎉 TOTAL TIME: ${Date.now() - totalStart}ms`)
    return NextResponse.json(validated.data)
  } catch (error) {
    console.error("Error analyzing argumentative structure:", error)
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Failed to analyze essay"
    return NextResponse.json({ error: message }, { status: 500 })
  } 
}
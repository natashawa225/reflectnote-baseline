import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { openai } from "@/lib/openai"


const ArgumentElementSchema = z.object({
  text: z.string().default(""),
  effectiveness: z.enum(["Effective", "Adequate", "Ineffective", "Missing"]).default("Missing"),
  feedback: z.array(z.string()).default([]),
  suggestion: z.string().default(""),
  reason: z.string().default(""),
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

type ParsedElement = { text: string; effectiveness: string }
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

function parseXMLOutput(xml: string): ParsedXML {
  const result: ParsedXML = {
    claims: [],
    evidence: [],
    counterclaims: [],
    counterclaim_evidence: [],
    rebuttals: [],
    rebuttal_evidence: [],
  }

  const tagPattern = /<(L1|P1|C1|D1|CT1|CD1|R1|RD1|S1)\s+effectiveness="([^"]+)">([\s\S]*?)<\/\1>/g
  let match: RegExpExecArray | null

  while ((match = tagPattern.exec(xml)) !== null) {
    const [, tag, effectiveness, rawText] = match
    const key = TAG_MAP[tag]
    if (!key) continue

    const element: ParsedElement = {
      text: rawText.trim(),
      effectiveness: normalizeEffectiveness(effectiveness),
    }

    const arrayKeys = ["claims", "evidence", "counterclaims", "counterclaim_evidence", "rebuttals", "rebuttal_evidence"]
    if (arrayKeys.includes(key)) {
      (result as any)[key].push(element)
    } else {
      (result as any)[key] = element
    }
  }

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
  return { text: "", effectiveness: "Missing" as const, feedback: [], suggestion: "", reason: "" }
}

function toElement(el: ParsedElement | undefined) {
  if (!el) return makeEmpty()
  return { text: el.text, effectiveness: el.effectiveness as any, feedback: [], suggestion: "", reason: "" }
}

function padArray<T>(arr: T[], target: number, fill: () => T): T[] {
  const out = [...arr]
  while (out.length < target) out.push(fill())
  return out
}

function enrichElements(parsed: ParsedXML) {
  return {
    elements: {
      lead:                 toElement(parsed.lead),
      position:             toElement(parsed.position),
      claims:               padArray(parsed.claims.map(toElement), 2, makeEmpty),
      counterclaim:         toElement(parsed.counterclaims[0]),
      counterclaim_evidence:toElement(parsed.counterclaim_evidence[0]),
      rebuttal:             toElement(parsed.rebuttals[0]),
      rebuttal_evidence:    toElement(parsed.rebuttal_evidence[0]),
      evidence:             padArray(parsed.evidence.map(toElement), 3, makeEmpty),
      conclusion:           toElement(parsed.conclusion),
    },
  }
}

// ============================================================================
// ELEMENT COLLECTION / RECONSTRUCTION
// ============================================================================

type ElementEntry = { element: any; path: string; name: string; index?: number }

function collectElements(enriched: ReturnType<typeof enrichElements>): ElementEntry[] {
  const out: ElementEntry[] = []

  for (const name of ["lead","position","counterclaim","counterclaim_evidence","rebuttal","rebuttal_evidence","conclusion"] as const) {
    out.push({ element: enriched.elements[name], path: `elements.${name}`, name })
  }
  enriched.elements.claims.forEach((el, i) =>
    out.push({ element: el, path: `elements.claims[${i}]`, name: "claim", index: i }))
  enriched.elements.evidence.forEach((el, i) =>
    out.push({ element: el, path: `elements.evidence[${i}]`, name: "evidence", index: i }))

  return out
}

function reconstructStructure(enriched: ReturnType<typeof enrichElements>, processed: any[]) {
  const result = JSON.parse(JSON.stringify(enriched))
  let idx = 0
  for (const name of ["lead","position","counterclaim","counterclaim_evidence","rebuttal","rebuttal_evidence","conclusion"]) {
    result.elements[name] = processed[idx++]
  }
  result.elements.claims.forEach((_: any, i: number) => { result.elements.claims[i] = processed[idx++] })
  result.elements.evidence.forEach((_: any, i: number) => { result.elements.evidence[i] = processed[idx++] })
  return result
}

// ============================================================================
// STEP 1 — Feedback for ALL elements (one call)
// ============================================================================
// STEP 1 — Feedback for EFFECTIVE elements ONLY
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
    return `${i}. ${label}\n   Text: "${e.element.text}"\n   Effectiveness: ${e.element.effectiveness}`
  }).join("\n\n")

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `Provide positive, constructive feedback on effective argumentative essay elements.

Essay prompt: """${prompt}"""

Rules:
- Give positive reinforcement and explain what makes it strong
- Suggest how to push it even further

Use simple, student-friendly language.
Keep the tone supportive and encouraging.
Focus only on the selected element.

Output exactly in this format:

Issue: ...
Reflection: ...
Hint: ...

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
// async function batchFeedbackAll(elements: ElementEntry[], prompt: string): Promise<string[][]> {
//   const list = elements.map((e, i) => {
//     const label = e.index !== undefined ? `${e.name} #${e.index + 1}` : e.name
//     return `${i}. ${label}\n   Text: "${e.element.text}"\n   Effectiveness: ${e.element.effectiveness}`
//   }).join("\n\n")

//   const completion = await openai.chat.completions.create({
//     model: "gpt-4o",
//     response_format: { type: "json_object" },
//     messages: [
//       {
//         role: "system",
//         content: `Provide indirecta and constructive feedback on argumentative essay elements.

// Essay prompt: """${prompt}"""

// Rules:
// - If effectiveness is "Effective":
//   * Give positive reinforcement and explain what makes it strong
//   * Suggest how to push it even further

// Use simple, student-friendly language.
// Keep the tone supportive and encouraging.
// Focus only on the selected element.

// Avoid:
// - Rewriting the student’s sentence
// - Giving a full corrected version
// - Being overly vague

// Output exactly in this format:

// Issue: ...
// Reflection: ...
// Hint: ...

// Return JSON: {"feedback": [["point1", "point2", "point3"], ...]}`
//       },
//       {
//         role: "user",
//         content: `Elements:\n\n${list}\n\nProvide feedback for each element in order:`,
//       },
//     ],
//   })

//   const result = JSON.parse(completion.choices[0].message.content || '{"feedback":[]}')
//   return result.feedback || []
// }

// ============================================================================
// STEP 2 — Suggestions + Reasons for ALL non-Effective elements (one call)
// ============================================================================

async function batchSuggestionsAndReasonsAll(
  elements: ElementEntry[]
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
    return `${i}. ${label}\n   Original: "${e.element.text}"\n   Effectiveness: ${e.element.effectiveness}`
  }).join("\n\n")

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are a supportive writing teacher helping students improve their argumentative essays.

For EACH element below, provide:
1. A suggestion: One clear, specific revision. You may rewrite or suggest a sentence. Keep it concise, student-friendly, and use a natural teacher-like tone. Focus only on the selected element.
2. A reason with three aspects:
   - Rhetorical function: What this element does in an argument and how it works
   - Reader impact: How it affects the reader's understanding or engagement, and what may happen if it is missing
   - Text quality: How it improves writing quality (e.g., coherence, clarity) with a cause-effect explanation

Avoid vague statements like "it improves clarity" without explanation.

Example output for one element:
{
  "suggestion": "You could add an opening sentence such as 'In many cities today, transportation problems are becoming increasingly serious' before your main point.",
  "reason": {
    "rhetorical_function": "A lead introduces the topic and works as a bridge into your argument, helping the reader move smoothly from a general idea to your specific position.",
    "reader_impact": "Without a lead, the essay may feel too abrupt and the reader may not have enough context to fully engage with your point.",
    "text_quality": "Adding a lead creates a clearer progression from general to specific ideas, which improves coherence and overall flow."
  }
}
Return JSON:
{
  "items": [
    {"suggestion": "...", "reason": "..."},
    ...
  ]
}`,
      },
      {
        role: "user",
        content: `Elements to improve:\n\n${list}`,
      },
    ],
  })

  const result = JSON.parse(completion.choices[0].message.content || '{"items":[]}')
  const items: Array<{ suggestion: string; reason: string }> = result.items || []

  needs.forEach((e, i) => {
    fullSuggestions[e.originalIndex] = items[i]?.suggestion || ""
    fullReasons[e.originalIndex] = items[i]?.reason || ""
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
    batchSuggestionsAndReasonsAll(elements),
  ])

  console.log(`🎉 Chain complete in ${Date.now() - start}ms`)

  return elements.map((e, i) => ({
    ...e.element,
    feedback: Array.isArray(feedbacks[i]) ? feedbacks[i] : [],
    suggestion: suggestions[i] || "",
    reason: reasons[i] || "",
  }))
}
// async function runFeedbackChain(elements: ElementEntry[], prompt: string): Promise<any[]> {
//   const start = Date.now()
//   console.log(`\n🔗 Starting 2-step feedback chain for ${elements.length} elements`)

//   const effectiveCounts = elements.reduce((acc, e) => {
//     acc[e.element.effectiveness] = (acc[e.element.effectiveness] || 0) + 1
//     return acc
//   }, {} as Record<string, number>)
//   console.log("📊 Effectiveness distribution:", effectiveCounts)

//   // STEP 1: Feedback for ALL (1 call)
//   console.log("\n📍 Step 1/2: Generating feedback for ALL elements...")
//   const feedbacks = await batchFeedbackAll(elements, prompt)
//   console.log(`✅ Step 1/2 complete (${Date.now() - start}ms)`)

//   // STEP 2: Suggestions + Reasons for non-Effective (1 call)
//   console.log("📍 Step 2/2: Generating suggestions + reasons for non-Effective elements...")
//   const { suggestions, reasons } = await batchSuggestionsAndReasonsAll(elements)
//   console.log(`✅ Step 2/2 complete (${Date.now() - start}ms)`)

//   console.log(`\n🎉 Chain complete in ${Date.now() - start}ms`)

//   return elements.map((e, i) => ({
//     ...e.element,
//     feedback: Array.isArray(feedbacks[i]) ? feedbacks[i] : [],
//     suggestion: suggestions[i] || "",
//     reason: reasons[i] || "",
//   }))
// }

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
    const enriched = enrichElements(parsed)

    // ── Run 2-step feedback chain ────────────────────────────────────────────
    const allElements = collectElements(enriched)
    const processedElements = await runFeedbackChain(allElements, prompt ?? "")
    const finalResult = reconstructStructure(enriched, processedElements)

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
    return NextResponse.json({ error: "Failed to analyze essay" }, { status: 500 })
  }
}


// import { type NextRequest, NextResponse } from "next/server"
// import { z } from "zod"
// import { getOpenAIClient } from "@/lib/openai"

// const ArgumentElementSchema = z.object({
//   text: z.string().default(""),
//   effectiveness: z.enum(["Effective", "Adequate", "Ineffective", "Missing"]).default("Missing"),
//   diagnosis: z.string().default(""),
//   feedback: z.array(z.string()).default([]),
//   suggestion: z.string().default(""),
//   reason: z.string().default(""),
// })

// const AnalysisResultSchema = z.object({
//   elements: z.object({
//     lead: ArgumentElementSchema,
//     position: ArgumentElementSchema,
//     claims: z.array(ArgumentElementSchema).default([]),
//     counterclaim: ArgumentElementSchema,
//     counterclaim_evidence: ArgumentElementSchema,
//     rebuttal: ArgumentElementSchema,
//     rebuttal_evidence: ArgumentElementSchema,
//     evidence: z.array(ArgumentElementSchema).default([]),
//     conclusion: ArgumentElementSchema,
//   }),
// })

// const FeedbackResultSchema = AnalysisResultSchema

// function normalizeFeedback(data: any): any {
//   function walk(obj: any): any {
//     if (Array.isArray(obj)) {
//       return obj.map(walk)
//     }
//     if (obj && typeof obj === "object") {
//       const out: any = {}
//       for (const k of Object.keys(obj)) {
//         if (k === "feedback") {
//           out[k] = Array.isArray(obj[k])
//             ? obj[k]
//             : obj[k]
//             ? [obj[k]]
//             : []
//         } else {
//           out[k] = walk(obj[k])
//         }
//       }
//       return out
//     }
//     return obj
//   }
//   return walk(data)
// }

// function enrichElements(raw: any): any {
//   function enrich(el: any) {
//     if (!el) {
//       return { 
//         text: "", 
//         effectiveness: "Missing", 
//         diagnosis: "", 
//         feedback: [], 
//         suggestion: "", 
//         reason: "" 
//       }
//     }

//     let text = ""
//     if (typeof el === "string") {
//       text = el
//     } else {
//       text = el.text ?? el.sentence ?? ""
//     }

//     return {
//       text,
//       effectiveness: el.effectiveness ?? "Missing",
//       diagnosis: "",
//       feedback: [],
//       suggestion: "",
//       reason: "",
//     }
//   }

//   const data = raw.elements ?? raw
//   const getFirstOrEmpty = (item: any) => {
//     if (Array.isArray(item)) return item.length > 0 ? item[0] : null
//     return item || null
//   }

//   function padArray(arr: any[], targetLength: number) {
//     const result = [...arr]
//     while (result.length < targetLength) {
//       result.push(enrich(null))
//     }
//     return result
//   }

//   return {
//     elements: {
//       lead: enrich(data.lead),
//       position: enrich(data.position),
//       claims: padArray(Array.isArray(data.claims) ? data.claims.map(enrich) : [], 2),
//       counterclaim: enrich(getFirstOrEmpty(data.counterclaims)),
//       counterclaim_evidence: enrich(getFirstOrEmpty(data.counterclaim_evidence)),
//       rebuttal: enrich(getFirstOrEmpty(data.rebuttals)),
//       rebuttal_evidence: enrich(getFirstOrEmpty(data.rebuttal_evidence)),
//       evidence: padArray(Array.isArray(data.evidence) ? data.evidence.map(enrich) : [], 3),
//       conclusion: enrich(data.conclusion),
//     },
//   }
// }

// function collectElements(enriched: any): Array<{element: any, path: string, name: string, index?: number}> {
//   const elements: Array<{element: any, path: string, name: string, index?: number}> = []
  
//   const singleElements = ['lead', 'position', 'counterclaim', 'counterclaim_evidence', 'rebuttal', 'rebuttal_evidence', 'conclusion']
//   for (const name of singleElements) {
//     elements.push({
//       element: enriched.elements[name],
//       path: `elements.${name}`,
//       name
//     })
//   }
  
//   enriched.elements.claims.forEach((claim: any, index: number) => {
//     elements.push({
//       element: claim,
//       path: `elements.claims[${index}]`,
//       name: 'claim',
//       index
//     })
//   })
  
//   enriched.elements.evidence.forEach((evidence: any, index: number) => {
//     elements.push({
//       element: evidence,
//       path: `elements.evidence[${index}]`,
//       name: 'evidence',
//       index
//     })
//   })
  
//   return elements
// }

// function reconstructStructure(enriched: any, processedElements: any[]): any {
//   const result = JSON.parse(JSON.stringify(enriched))
  
//   let elementIndex = 0
  
//   const singleElements = ['lead', 'position', 'counterclaim', 'counterclaim_evidence', 'rebuttal', 'rebuttal_evidence', 'conclusion']
//   for (const name of singleElements) {
//     result.elements[name] = processedElements[elementIndex++]
//   }
  
//   for (let i = 0; i < result.elements.claims.length; i++) {
//     result.elements.claims[i] = processedElements[elementIndex++]
//   }
  
//   for (let i = 0; i < result.elements.evidence.length; i++) {
//     result.elements.evidence[i] = processedElements[elementIndex++]
//   }
  
//   return result
// }

// // ============================================================================
// // ✅ OPTIMIZED 4-STEP LLM CHAIN - Works with Fine-Tuned Model Output
// // ============================================================================
// // Your fine-tuned model ALREADY provides: text + effectiveness
// // The 4-step chain adds: diagnosis + feedback + suggestion + reason
// // ============================================================================

// // STEP 1: Diagnose ALL elements in ONE call
// async function batchDiagnoseAll(
//   elements: Array<{element: any, name: string, index?: number}>,
//   prompt: string
// ): Promise<string[]> {
  
//   // Build a numbered list of all elements with their FT-model effectiveness
//   const elementsList = elements.map((e, i) => {
//     const displayName = e.index !== undefined 
//       ? `${e.name} #${e.index + 1}` 
//       : e.name
//     return `${i}. ${displayName}
//    Text: "${e.element.text}"
//    Effectiveness (from fine-tuned model): ${e.element.effectiveness}`
//   }).join('\n\n')

//   const completion = await getOpenAIClient().chat.completions.create({
//     model: "gpt-4.1-mini",
//     response_format: { type: "json_object" },
//     messages: [
//       {
//         role: "system",
//         content: `You are an expert writing coach analyzing argumentative essay elements.

// Essay prompt: """${prompt}"""

// A fine-tuned model has already classified each element's effectiveness. Your job is to provide DIAGNOSIS for each element.

// For EACH element, provide a diagnosis that:
// 1. Explains the role of this element in argumentative writing
// 2. Evaluates how well it serves the essay prompt
// 3. Considers the effectiveness rating from the fine-tuned model

// Be specific and direct. Do not provide suggestions or feedback yet - only diagnose.

// Return JSON: {"diagnoses": ["diagnosis for element 0", "diagnosis for element 1", ...]}`
//       },
//       {
//         role: "user",
//         content: `Elements to diagnose:\n\n${elementsList}\n\nProvide diagnosis for each element in order:`
//       }
//     ]
//   })
  
//   const result = JSON.parse(completion.choices[0].message.content || '{"diagnoses": []}')
//   return result.diagnoses || []
// }

// // STEP 2: Generate feedback for ALL elements in ONE call
// async function batchFeedbackAll(
//   elements: Array<{element: any, name: string, index?: number}>,
//   diagnoses: string[]
// ): Promise<string[][]> {
  
//   const elementsList = elements.map((e, i) => {
//     const displayName = e.index !== undefined 
//       ? `${e.name} #${e.index + 1}` 
//       : e.name
//     return `${i}. ${displayName}
//    Text: "${e.element.text}"
//    Effectiveness: ${e.element.effectiveness}
//    Diagnosis: ${diagnoses[i]}`
//   }).join('\n\n')

//   const completion = await getOpenAIClient().chat.completions.create({
//     model: "gpt-4.1-mini",
//     response_format: { type: "json_object" },
//     messages: [
//       {
//         role: "system",
//         content: `
// You are a writing coach for L2 English learners.
// Give clear, specific feedback in simple academic English.
// Explain why it works and how to improve.
// If "Effective", explain strength and add one improvement tip.
// No markdown. Only <strong></strong> for emphasis.
// Return STRICT JSON:
// {"feedback": [["point1","point2","point3"], ...]}
// `
//       },
//       {
//         role: "user",
//         content: `Elements with diagnoses:\n\n${elementsList}\n\nProvide feedback for each element in order:`
//       }
//     ]
//   })
  
//   const result = JSON.parse(completion.choices[0].message.content || '{"feedback": []}')
//   return result.feedback || []

// }

// // STEP 3: Generate suggestions AND reasons for ALL non-effective elements in ONE call
// async function batchSuggestionsAndReasonsAll(
//   elements: Array<{element: any, name: string, index?: number}>
// ): Promise<{ suggestions: string[], reasons: string[] }> {
  
//   const needsWork = elements.map((e, i) => ({ ...e, originalIndex: i }))
//     .filter(e => e.element.effectiveness !== "Effective")
  
//   if (needsWork.length === 0) {
//     console.log('   ℹ️ All elements are Effective - skipping suggestions & reasons')
//     return { suggestions: elements.map(() => ""), reasons: elements.map(() => "") }
//   }
  
//   const elementsList = needsWork.map((e, i) => {
//     const displayName = e.index !== undefined 
//       ? `${e.name} #${e.index + 1}` 
//       : e.name
//     return `${i}. ${displayName}
//    Original text: "${e.element.text}"
//    Effectiveness: ${e.element.effectiveness}`
//   }).join('\n\n')

//   const completion = await getOpenAIClient().chat.completions.create({
//     model: "gpt-4o-mini",
//     response_format: { type: "json_object" },
//     messages: [
//       {
//         role: "system",
//         content: `You are a supportive writing teacher helping students improve their argumentative essays.

// For EACH element below, provide:
// 1. A suggestion: One clear, specific revision. You may rewrite or suggest a sentence. Keep it concise, student-friendly, and use a natural teacher-like tone. Focus only on the selected element.
// 2. A reason with three aspects:
//    - Rhetorical function: What this element does in an argument and how it works
//    - Reader impact: How it affects the reader's understanding or engagement, and what may happen if it is missing
//    - Text quality: How it improves writing quality (e.g., coherence, clarity) with a cause-effect explanation

// Avoid vague statements like "it improves clarity" without explanation.

// Example output for one element:
// {
//   "suggestion": "You could add an opening sentence such as 'In many cities today, transportation problems are becoming increasingly serious' before your main point.",
//   "reason": {
//     "rhetorical_function": "A lead introduces the topic and works as a bridge into your argument, helping the reader move smoothly from a general idea to your specific position.",
//     "reader_impact": "Without a lead, the essay may feel too abrupt and the reader may not have enough context to fully engage with your point.",
//     "text_quality": "Adding a lead creates a clearer progression from general to specific ideas, which improves coherence and overall flow."
//   }
// }

// Return JSON: {
//   "results": [
//     {
//       "suggestion": "...",
//       "reason": {
//         "rhetorical_function": "...",
//         "reader_impact": "...",
//         "text_quality": "..."
//       }
//     }
//   ]
// }`
//       },
//       {
//         role: "user",
//         content: `Elements to improve:\n\n${elementsList}\n\nProvide suggestion and reason for each:`
//       }
//     ]
//   })
  
//   const result = JSON.parse(completion.choices[0].message.content || '{"results": []}')
//   const results = result.results || []
  
//   const fullSuggestions = new Array(elements.length).fill("")
//   const fullReasons = new Array(elements.length).fill("")
  
//   needsWork.forEach((e, i) => {
//     const r = results[i] || {}
//     fullSuggestions[e.originalIndex] = r.suggestion || ""
    
//     // Format reason into a structured string
//     if (r.reason) {
//       fullReasons[e.originalIndex] = [
//         `${r.reason.rhetorical_function || ""}`,
//         `${r.reason.reader_impact || ""}`,
//         `${r.reason.text_quality || ""}`
//       ].join('\n')
//     }
//   })
  
//   return { suggestions: fullSuggestions, reasons: fullReasons }
// }
// // MAIN OPTIMIZED CHAIN: 44 seconds!
// async function optimizedProcess4StepChain(
//   elements: Array<{element: any, path: string, name: string, index?: number}>,
//   prompt: string
// ): Promise<any[]> {
  
//   const startTime = Date.now()
//   console.log(`\n🔗 Starting PARALLELIZED chain for ${elements.length} elements`)
  
//   const effectiveCounts = elements.reduce((acc, e) => {
//     acc[e.element.effectiveness] = (acc[e.element.effectiveness] || 0) + 1
//     return acc
//   }, {} as Record<string, number>)
//   console.log('📊 Element effectiveness:', effectiveCounts)
  
//   // 🚀 PARALLEL: Diagnose + Suggestions&Reasons run simultaneously
//   console.log('\n📍 Steps 1 & 2 running IN PARALLEL (diagnose + suggestions+reasons)...')
//   const [diagnoses, { suggestions, reasons }] = await Promise.all([
//     batchDiagnoseAll(elements, prompt),
//     batchSuggestionsAndReasonsAll(elements)
//   ])
//   console.log(`✅ Steps 1 & 2 complete in parallel (${Date.now() - startTime}ms)`)
  
//   // Feedback runs after diagnoses are ready (depends on diagnoses)
//   console.log('📍 Step 3: Generating feedback (uses diagnoses)...')
//   const feedbacks = await batchFeedbackAll(elements, diagnoses)
//   console.log(`✅ Step 3 complete (${Date.now() - startTime}ms)`)
  
//   console.log(`\n🎉 Total chain time: ${Date.now() - startTime}ms\n`)
  
//   return elements.map((e, i) => ({
//     ...e.element,
//     diagnosis: diagnoses[i] || "",
//     feedback: feedbacks[i] || [],
//     suggestion: suggestions[i] || "",
//     reason: reasons[i] || ""
//   }))
// }

// // Updated system prompt for the fine-tuned model
// const FINE_TUNED_SYSTEM_PROMPT = `You are an argument-mining classifier for argumentative essays. 

// Return JSON with this EXACT structure:
// {
//   "lead": {"text": "...", "effectiveness": "Effective|Adequate|Ineffective|Missing"},
//   "position": {"text": "...", "effectiveness": "Effective|Adequate|Ineffective|Missing"},
//   "claims": [{"text": "...", "effectiveness": "Effective|Adequate|Ineffective|Missing"}],
//   "evidence": [{"text": "...", "effectiveness": "Effective|Adequate|Ineffective|Missing"}],
//   "counterclaims": [{"text": "...", "effectiveness": "Effective|Adequate|Ineffective|Missing"}],
//   "counterclaim_evidence": [{"text": "...", "effectiveness": "Effective|Adequate|Ineffective|Missing"}],
//   "rebuttals": [{"text": "...", "effectiveness": "Effective|Adequate|Ineffective|Missing"}],
//   "rebuttal_evidence": [{"text": "...", "effectiveness": "Effective|Adequate|Ineffective|Missing"}],
//   "conclusion": {"text": "...", "effectiveness": "Effective|Adequate|Ineffective|Missing"}
// }

// CRITICAL: Each element must have both "text" and "effectiveness" fields. Do not include a top-level "effectiveness" field.`

// export async function POST(request: NextRequest) {
//   const totalStartTime = Date.now()
  
//   try {
//     const { essay, prompt } = await request.json()
//     const essayText = typeof essay === "string" ? essay : String(essay ?? "")
//     if (!process.env.OPENAI_API_KEY) {
//       const errorMessage = "Server configuration error: OPENAI_API_KEY is missing"
//       console.error(errorMessage, {
//         route: "/api/analyze-argument",
//         timestamp: new Date().toISOString(),
//       })
//       return NextResponse.json({ error: errorMessage }, { status: 500 })
//     }

//     const FT_MODEL = process.env.FT_MODEL

//     let completion
//     let modelUsed = FT_MODEL ?? "gpt-4o-mini"

//     try {
//       console.log("⚡ Using model:", modelUsed)

//       // STEP 1 → Fine-tuned model gives structure + effectiveness
//       completion = await getOpenAIClient().chat.completions.create({
//         model: modelUsed,
//         messages: [
//           { role: "system", content: FINE_TUNED_SYSTEM_PROMPT },
//           { role: "user", content: essayText },
//         ],
//         response_format: { type: "json_object" },
//       })
//     } catch (err: any) {
//       console.warn("⚠️ FT model unavailable, falling back to gpt-4o-mini:", err.message)
//       modelUsed = "gpt-4o-mini"
//       console.log("⚡ Using model:", modelUsed)

//       completion = await getOpenAIClient().chat.completions.create({
//         model: modelUsed,
//         messages: [
//           { role: "system", content: FINE_TUNED_SYSTEM_PROMPT },
//           { role: "user", content: essayText },
//         ],
//         response_format: { type: "json_object" },
//       })
//     }

//     const rawContent = completion.choices[0].message.content
//     const analysis = JSON.parse(rawContent ?? "{}")

//     console.log("🔍 Raw FT analysis:", JSON.stringify(analysis, null, 2))

//     // Check if we got the old format and need to assign default effectiveness
//     if ('effectiveness' in analysis && typeof analysis.effectiveness === 'string') {
//       console.warn("⚠️ Model returned old format with top-level effectiveness. Assigning 'Adequate' to all elements.")
      
//       const convertElement = (text: any) => {
//         if (typeof text === 'string') {
//           return { text, effectiveness: text ? 'Adequate' : 'Missing' }
//         }
//         return text
//       }

//       analysis.lead = convertElement(analysis.lead)
//       analysis.position = convertElement(analysis.position)
//       analysis.claims = (analysis.claims || []).map(convertElement)
//       analysis.evidence = (analysis.evidence || []).map(convertElement)
//       analysis.counterclaims = (analysis.counterclaims || []).map(convertElement)
//       analysis.counterclaim_evidence = (analysis.counterclaim_evidence || []).map(convertElement)
//       analysis.rebuttals = (analysis.rebuttals || []).map(convertElement)
//       analysis.rebuttal_evidence = (analysis.rebuttal_evidence || []).map(convertElement)
//       analysis.conclusion = convertElement(analysis.conclusion)
      
//       delete analysis.effectiveness
//     }

//     function lockEffectiveness(
//       original: Record<string, any>,
//       updated: Record<string, any>
//     ): Record<string, any> {
//       const lock = (o: Record<string, any>, u: Record<string, any>) => {
//         if (!o || !u) return u
//         u.effectiveness = o.effectiveness
//         for (const key of Object.keys(o)) {
//           if (Array.isArray(o[key]) && Array.isArray(u[key])) {
//             for (let i = 0; i < o[key].length; i++) lock(o[key][i], u[key][i])
//           } else if (
//             typeof o[key] === "object" &&
//             o[key] !== null &&
//             typeof u[key] === "object" &&
//             u[key] !== null
//           ) {
//             lock(o[key], u[key])
//           }
//         }
//       }
//       lock(original, updated)
//       return updated
//     }
    
//     console.log(`⏱️ Structure detection: ${Date.now() - totalStartTime}ms`)
    
//     // STEP 2 → Enrich with empty fields
//     const enriched = enrichElements(analysis)

//     // STEP 3 → OPTIMIZED 4-Step Chain (4 calls instead of 48+!)
//     console.log("🔄 Starting OPTIMIZED 4-step GPT chain processing...")
    
//     const allElements = collectElements(enriched)
//     const processedElements = await optimizedProcess4StepChain(allElements, prompt || "")
    
//     const finalFeedback = reconstructStructure(enriched, processedElements)

//     // STEP 4 → Lock element-level effectiveness (preserve from FT model)
//     const lockedFeedback = lockEffectiveness(enriched, finalFeedback)

//     // STEP 5 → Normalize feedback field
//     const normalized = normalizeFeedback(lockedFeedback)

//     // STEP 6 → Validate with Zod
//     const parsed = FeedbackResultSchema.safeParse(normalized)
//     if (!parsed.success) {
//       console.error("❌ Zod validation failed", parsed.error.format())
//       return NextResponse.json(
//         { error: "Schema validation failed", issues: parsed.error.format() },
//         { status: 400 },
//       )
//     }

//     console.log(`🎉 TOTAL TIME: ${Date.now() - totalStartTime}ms`)
//     console.log(`✅ Successfully completed with optimized LLM chaining!`)

//     // STEP 7 → Return normalized version
//     return NextResponse.json(normalized)
//   } catch (error) {
//     const message = error instanceof Error ? error.message : "Failed to analyze essay"
//     console.error("Error analyzing argumentative structure:", {
//       message,
//       error,
//       route: "/api/analyze-argument",
//       timestamp: new Date().toISOString(),
//     })
//     return NextResponse.json({ error: message }, { status: 500 })
//   }
// }

import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getOpenAIClient } from "@/lib/openai"

const ArgumentElementSchema = z.object({
  text: z.string().default(""),
  effectiveness: z.enum(["Effective", "Adequate", "Ineffective", "Missing"]).default("Missing"),
  diagnosis: z.string().default(""),
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

function normalizeFeedback(data: any): any {
  function walk(obj: any): any {
    if (Array.isArray(obj)) {
      return obj.map(walk)
    }
    if (obj && typeof obj === "object") {
      const out: any = {}
      for (const k of Object.keys(obj)) {
        if (k === "feedback") {
          out[k] = Array.isArray(obj[k])
            ? obj[k]
            : obj[k]
            ? [obj[k]]
            : []
        } else {
          out[k] = walk(obj[k])
        }
      }
      return out
    }
    return obj
  }
  return walk(data)
}

function enrichElements(raw: any): any {
  function enrich(el: any) {
    if (!el) {
      return { 
        text: "", 
        effectiveness: "Missing", 
        diagnosis: "", 
        feedback: [], 
        suggestion: "", 
        reason: "" 
      }
    }

    let text = ""
    if (typeof el === "string") {
      text = el
    } else {
      text = el.text ?? el.sentence ?? ""
    }

    return {
      text,
      effectiveness: el.effectiveness ?? "Missing",
      diagnosis: "",
      feedback: [],
      suggestion: "",
      reason: "",
    }
  }

  const data = raw.elements ?? raw
  const getFirstOrEmpty = (item: any) => {
    if (Array.isArray(item)) return item.length > 0 ? item[0] : null
    return item || null
  }

  function padArray(arr: any[], targetLength: number) {
    const result = [...arr]
    while (result.length < targetLength) {
      result.push(enrich(null))
    }
    return result
  }

  return {
    elements: {
      lead: enrich(data.lead),
      position: enrich(data.position),
      claims: padArray(Array.isArray(data.claims) ? data.claims.map(enrich) : [], 2),
      counterclaim: enrich(getFirstOrEmpty(data.counterclaims)),
      counterclaim_evidence: enrich(getFirstOrEmpty(data.counterclaim_evidence)),
      rebuttal: enrich(getFirstOrEmpty(data.rebuttals)),
      rebuttal_evidence: enrich(getFirstOrEmpty(data.rebuttal_evidence)),
      evidence: padArray(Array.isArray(data.evidence) ? data.evidence.map(enrich) : [], 3),
      conclusion: enrich(data.conclusion),
    },
  }
}

function collectElements(enriched: any): Array<{element: any, path: string, name: string, index?: number}> {
  const elements: Array<{element: any, path: string, name: string, index?: number}> = []
  
  const singleElements = ['lead', 'position', 'counterclaim', 'counterclaim_evidence', 'rebuttal', 'rebuttal_evidence', 'conclusion']
  for (const name of singleElements) {
    elements.push({
      element: enriched.elements[name],
      path: `elements.${name}`,
      name
    })
  }
  
  enriched.elements.claims.forEach((claim: any, index: number) => {
    elements.push({
      element: claim,
      path: `elements.claims[${index}]`,
      name: 'claim',
      index
    })
  })
  
  enriched.elements.evidence.forEach((evidence: any, index: number) => {
    elements.push({
      element: evidence,
      path: `elements.evidence[${index}]`,
      name: 'evidence',
      index
    })
  })
  
  return elements
}

function reconstructStructure(enriched: any, processedElements: any[]): any {
  const result = JSON.parse(JSON.stringify(enriched))
  
  let elementIndex = 0
  
  const singleElements = ['lead', 'position', 'counterclaim', 'counterclaim_evidence', 'rebuttal', 'rebuttal_evidence', 'conclusion']
  for (const name of singleElements) {
    result.elements[name] = processedElements[elementIndex++]
  }
  
  for (let i = 0; i < result.elements.claims.length; i++) {
    result.elements.claims[i] = processedElements[elementIndex++]
  }
  
  for (let i = 0; i < result.elements.evidence.length; i++) {
    result.elements.evidence[i] = processedElements[elementIndex++]
  }
  
  return result
}

// ============================================================================
// ✅ OPTIMIZED 4-STEP LLM CHAIN - Works with Fine-Tuned Model Output
// ============================================================================
// Your fine-tuned model ALREADY provides: text + effectiveness
// The 4-step chain adds: diagnosis + feedback + suggestion + reason
// ============================================================================

// STEP 1: Diagnose ALL elements in ONE call
async function batchDiagnoseAll(
  elements: Array<{element: any, name: string, index?: number}>,
  prompt: string
): Promise<string[]> {
  
  // Build a numbered list of all elements with their FT-model effectiveness
  const elementsList = elements.map((e, i) => {
    const displayName = e.index !== undefined 
      ? `${e.name} #${e.index + 1}` 
      : e.name
    return `${i}. ${displayName}
   Text: "${e.element.text}"
   Effectiveness (from fine-tuned model): ${e.element.effectiveness}`
  }).join('\n\n')

  const completion = await getOpenAIClient().chat.completions.create({
    model: "gpt-4.1-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are an expert writing coach analyzing argumentative essay elements.

Essay prompt: """${prompt}"""

A fine-tuned model has already classified each element's effectiveness. Your job is to provide DIAGNOSIS for each element.

For EACH element, provide a diagnosis that:
1. Explains the role of this element in argumentative writing
2. Evaluates how well it serves the essay prompt
3. Considers the effectiveness rating from the fine-tuned model

Be specific and direct. Do not provide suggestions or feedback yet - only diagnose.

Return JSON: {"diagnoses": ["diagnosis for element 0", "diagnosis for element 1", ...]}`
      },
      {
        role: "user",
        content: `Elements to diagnose:\n\n${elementsList}\n\nProvide diagnosis for each element in order:`
      }
    ]
  })
  
  const result = JSON.parse(completion.choices[0].message.content || '{"diagnoses": []}')
  return result.diagnoses || []
}

// STEP 2: Generate feedback for ALL elements in ONE call
async function batchFeedbackAll(
  elements: Array<{element: any, name: string, index?: number}>,
  diagnoses: string[]
): Promise<string[][]> {
  
  const elementsList = elements.map((e, i) => {
    const displayName = e.index !== undefined 
      ? `${e.name} #${e.index + 1}` 
      : e.name
    return `${i}. ${displayName}
   Text: "${e.element.text}"
   Effectiveness: ${e.element.effectiveness}
   Diagnosis: ${diagnoses[i]}`
  }).join('\n\n')

  const completion = await getOpenAIClient().chat.completions.create({
    model: "gpt-4.1-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `
You are a writing coach for L2 English learners.
Give clear, specific feedback in simple academic English.
Explain why it works and how to improve.
If "Effective", explain strength and add one improvement tip.
No markdown. Only <strong></strong> for emphasis.
Return STRICT JSON:
{"feedback": [["point1","point2","point3"], ...]}
`
      },
      {
        role: "user",
        content: `Elements with diagnoses:\n\n${elementsList}\n\nProvide feedback for each element in order:`
      }
    ]
  })
  
  const result = JSON.parse(completion.choices[0].message.content || '{"feedback": []}')
  return result.feedback || []

}

// STEP 3: Generate suggestions AND reasons for ALL non-effective elements in ONE call
async function batchSuggestionsAndReasonsAll(
  elements: Array<{element: any, name: string, index?: number}>
): Promise<{ suggestions: string[], reasons: string[] }> {
  
  const needsWork = elements.map((e, i) => ({ ...e, originalIndex: i }))
    .filter(e => e.element.effectiveness !== "Effective")
  
  if (needsWork.length === 0) {
    console.log('   ℹ️ All elements are Effective - skipping suggestions & reasons')
    return { suggestions: elements.map(() => ""), reasons: elements.map(() => "") }
  }
  
  const elementsList = needsWork.map((e, i) => {
    const displayName = e.index !== undefined 
      ? `${e.name} #${e.index + 1}` 
      : e.name
    return `${i}. ${displayName}
   Original text: "${e.element.text}"
   Effectiveness: ${e.element.effectiveness}`
  }).join('\n\n')

  const completion = await getOpenAIClient().chat.completions.create({
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

Return JSON: {
  "results": [
    {
      "suggestion": "...",
      "reason": {
        "rhetorical_function": "...",
        "reader_impact": "...",
        "text_quality": "..."
      }
    }
  ]
}`
      },
      {
        role: "user",
        content: `Elements to improve:\n\n${elementsList}\n\nProvide suggestion and reason for each:`
      }
    ]
  })
  
  const result = JSON.parse(completion.choices[0].message.content || '{"results": []}')
  const results = result.results || []
  
  const fullSuggestions = new Array(elements.length).fill("")
  const fullReasons = new Array(elements.length).fill("")
  
  needsWork.forEach((e, i) => {
    const r = results[i] || {}
    fullSuggestions[e.originalIndex] = r.suggestion || ""
    
    // Format reason into a structured string
    if (r.reason) {
      fullReasons[e.originalIndex] = [
        `${r.reason.rhetorical_function || ""}`,
        `${r.reason.reader_impact || ""}`,
        `${r.reason.text_quality || ""}`
      ].join('\n')
    }
  })
  
  return { suggestions: fullSuggestions, reasons: fullReasons }
}
// MAIN OPTIMIZED CHAIN: 44 seconds!
async function optimizedProcess4StepChain(
  elements: Array<{element: any, path: string, name: string, index?: number}>,
  prompt: string
): Promise<any[]> {
  
  const startTime = Date.now()
  console.log(`\n🔗 Starting PARALLELIZED chain for ${elements.length} elements`)
  
  const effectiveCounts = elements.reduce((acc, e) => {
    acc[e.element.effectiveness] = (acc[e.element.effectiveness] || 0) + 1
    return acc
  }, {} as Record<string, number>)
  console.log('📊 Element effectiveness:', effectiveCounts)
  
  // 🚀 PARALLEL: Diagnose + Suggestions&Reasons run simultaneously
  console.log('\n📍 Steps 1 & 2 running IN PARALLEL (diagnose + suggestions+reasons)...')
  const [diagnoses, { suggestions, reasons }] = await Promise.all([
    batchDiagnoseAll(elements, prompt),
    batchSuggestionsAndReasonsAll(elements)
  ])
  console.log(`✅ Steps 1 & 2 complete in parallel (${Date.now() - startTime}ms)`)
  
  // Feedback runs after diagnoses are ready (depends on diagnoses)
  console.log('📍 Step 3: Generating feedback (uses diagnoses)...')
  const feedbacks = await batchFeedbackAll(elements, diagnoses)
  console.log(`✅ Step 3 complete (${Date.now() - startTime}ms)`)
  
  console.log(`\n🎉 Total chain time: ${Date.now() - startTime}ms\n`)
  
  return elements.map((e, i) => ({
    ...e.element,
    diagnosis: diagnoses[i] || "",
    feedback: feedbacks[i] || [],
    suggestion: suggestions[i] || "",
    reason: reasons[i] || ""
  }))
}

// Updated system prompt for the fine-tuned model
const FINE_TUNED_SYSTEM_PROMPT = `You are an argument-mining classifier for argumentative essays. 

Return JSON with this EXACT structure:
{
  "lead": {"text": "...", "effectiveness": "Effective|Adequate|Ineffective|Missing"},
  "position": {"text": "...", "effectiveness": "Effective|Adequate|Ineffective|Missing"},
  "claims": [{"text": "...", "effectiveness": "Effective|Adequate|Ineffective|Missing"}],
  "evidence": [{"text": "...", "effectiveness": "Effective|Adequate|Ineffective|Missing"}],
  "counterclaims": [{"text": "...", "effectiveness": "Effective|Adequate|Ineffective|Missing"}],
  "counterclaim_evidence": [{"text": "...", "effectiveness": "Effective|Adequate|Ineffective|Missing"}],
  "rebuttals": [{"text": "...", "effectiveness": "Effective|Adequate|Ineffective|Missing"}],
  "rebuttal_evidence": [{"text": "...", "effectiveness": "Effective|Adequate|Ineffective|Missing"}],
  "conclusion": {"text": "...", "effectiveness": "Effective|Adequate|Ineffective|Missing"}
}

CRITICAL: Each element must have both "text" and "effectiveness" fields. Do not include a top-level "effectiveness" field.`

export async function POST(request: NextRequest) {
  const totalStartTime = Date.now()
  
  try {
    const { essay, prompt } = await request.json()
    const essayText = typeof essay === "string" ? essay : String(essay ?? "")
    if (!process.env.OPENAI_API_KEY) {
      const errorMessage = "Server configuration error: OPENAI_API_KEY is missing"
      console.error(errorMessage, {
        route: "/api/analyze-argument",
        timestamp: new Date().toISOString(),
      })
      return NextResponse.json({ error: errorMessage }, { status: 500 })
    }

    const FT_MODEL = process.env.FT_MODEL

    let completion
    let modelUsed = FT_MODEL ?? "gpt-4o-mini"

    try {
      console.log("⚡ Using model:", modelUsed)

      // STEP 1 → Fine-tuned model gives structure + effectiveness
      completion = await getOpenAIClient().chat.completions.create({
        model: modelUsed,
        messages: [
          { role: "system", content: FINE_TUNED_SYSTEM_PROMPT },
          { role: "user", content: essayText },
        ],
        response_format: { type: "json_object" },
      })
    } catch (err: any) {
      console.warn("⚠️ FT model unavailable, falling back to gpt-4o-mini:", err.message)
      modelUsed = "gpt-4o-mini"
      console.log("⚡ Using model:", modelUsed)

      completion = await getOpenAIClient().chat.completions.create({
        model: modelUsed,
        messages: [
          { role: "system", content: FINE_TUNED_SYSTEM_PROMPT },
          { role: "user", content: essayText },
        ],
        response_format: { type: "json_object" },
      })
    }

    const rawContent = completion.choices[0].message.content
    const analysis = JSON.parse(rawContent ?? "{}")

    console.log("🔍 Raw FT analysis:", JSON.stringify(analysis, null, 2))

    // Check if we got the old format and need to assign default effectiveness
    if ('effectiveness' in analysis && typeof analysis.effectiveness === 'string') {
      console.warn("⚠️ Model returned old format with top-level effectiveness. Assigning 'Adequate' to all elements.")
      
      const convertElement = (text: any) => {
        if (typeof text === 'string') {
          return { text, effectiveness: text ? 'Adequate' : 'Missing' }
        }
        return text
      }

      analysis.lead = convertElement(analysis.lead)
      analysis.position = convertElement(analysis.position)
      analysis.claims = (analysis.claims || []).map(convertElement)
      analysis.evidence = (analysis.evidence || []).map(convertElement)
      analysis.counterclaims = (analysis.counterclaims || []).map(convertElement)
      analysis.counterclaim_evidence = (analysis.counterclaim_evidence || []).map(convertElement)
      analysis.rebuttals = (analysis.rebuttals || []).map(convertElement)
      analysis.rebuttal_evidence = (analysis.rebuttal_evidence || []).map(convertElement)
      analysis.conclusion = convertElement(analysis.conclusion)
      
      delete analysis.effectiveness
    }

    function lockEffectiveness(
      original: Record<string, any>,
      updated: Record<string, any>
    ): Record<string, any> {
      const lock = (o: Record<string, any>, u: Record<string, any>) => {
        if (!o || !u) return u
        u.effectiveness = o.effectiveness
        for (const key of Object.keys(o)) {
          if (Array.isArray(o[key]) && Array.isArray(u[key])) {
            for (let i = 0; i < o[key].length; i++) lock(o[key][i], u[key][i])
          } else if (
            typeof o[key] === "object" &&
            o[key] !== null &&
            typeof u[key] === "object" &&
            u[key] !== null
          ) {
            lock(o[key], u[key])
          }
        }
      }
      lock(original, updated)
      return updated
    }
    
    console.log(`⏱️ Structure detection: ${Date.now() - totalStartTime}ms`)
    
    // STEP 2 → Enrich with empty fields
    const enriched = enrichElements(analysis)

    // STEP 3 → OPTIMIZED 4-Step Chain (4 calls instead of 48+!)
    console.log("🔄 Starting OPTIMIZED 4-step GPT chain processing...")
    
    const allElements = collectElements(enriched)
    const processedElements = await optimizedProcess4StepChain(allElements, prompt || "")
    
    const finalFeedback = reconstructStructure(enriched, processedElements)

    // STEP 4 → Lock element-level effectiveness (preserve from FT model)
    const lockedFeedback = lockEffectiveness(enriched, finalFeedback)

    // STEP 5 → Normalize feedback field
    const normalized = normalizeFeedback(lockedFeedback)

    // STEP 6 → Validate with Zod
    const parsed = FeedbackResultSchema.safeParse(normalized)
    if (!parsed.success) {
      console.error("❌ Zod validation failed", parsed.error.format())
      return NextResponse.json(
        { error: "Schema validation failed", issues: parsed.error.format() },
        { status: 400 },
      )
    }

    console.log(`🎉 TOTAL TIME: ${Date.now() - totalStartTime}ms`)
    console.log(`✅ Successfully completed with optimized LLM chaining!`)

    // STEP 7 → Return normalized version
    return NextResponse.json(normalized)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to analyze essay"
    console.error("Error analyzing argumentative structure:", {
      message,
      error,
      route: "/api/analyze-argument",
      timestamp: new Date().toISOString(),
    })
    return NextResponse.json({ error: message }, { status: 500 })
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

// // ensure every element has feedback/suggestions/reason fields
// // Updated enrichElements function
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

//   // --- helper for padding arrays ---
//   function padArray(arr: any[], targetLength: number) {
//     const result = [...arr]
//     while (result.length < targetLength) {
//       result.push(enrich(null)) // push Missing element
//     }
//     return result
//   }

//   return {
//     elements: {
//       lead: enrich(data.lead),
//       position: enrich(data.position),
//       // ✅ enforce 2 claims
//       claims: padArray(Array.isArray(data.claims) ? data.claims.map(enrich) : [], 2),
//       counterclaim: enrich(getFirstOrEmpty(data.counterclaims)),
//       counterclaim_evidence: enrich(getFirstOrEmpty(data.counterclaim_evidence)),
//       rebuttal: enrich(getFirstOrEmpty(data.rebuttals)),
//       rebuttal_evidence: enrich(getFirstOrEmpty(data.rebuttal_evidence)),
//       // ✅ enforce 3 evidence
//       evidence: padArray(Array.isArray(data.evidence) ? data.evidence.map(enrich) : [], 3),
//       conclusion: enrich(data.conclusion),
//     },
//   }
// }

// // Helper function to collect all elements into a flat array with metadata
// function collectElements(enriched: any): Array<{element: any, path: string, name: string, index?: number}> {
//   const elements: Array<{element: any, path: string, name: string, index?: number}> = []
  
//   // Single elements
//   const singleElements = ['lead', 'position', 'counterclaim', 'counterclaim_evidence', 'rebuttal', 'rebuttal_evidence', 'conclusion']
//   for (const name of singleElements) {
//     elements.push({
//       element: enriched.elements[name],
//       path: `elements.${name}`,
//       name
//     })
//   }
  
//   // Array elements
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

// // Helper function to reconstruct the structure from flat array
// function reconstructStructure(enriched: any, processedElements: any[]): any {
//   const result = JSON.parse(JSON.stringify(enriched)) // Deep clone
  
//   let elementIndex = 0
  
//   // Single elements
//   const singleElements = ['lead', 'position', 'counterclaim', 'counterclaim_evidence', 'rebuttal', 'rebuttal_evidence', 'conclusion']
//   for (const name of singleElements) {
//     result.elements[name] = processedElements[elementIndex++]
//   }
  
//   // Array elements
//   for (let i = 0; i < result.elements.claims.length; i++) {
//     result.elements.claims[i] = processedElements[elementIndex++]
//   }
  
//   for (let i = 0; i < result.elements.evidence.length; i++) {
//     result.elements.evidence[i] = processedElements[elementIndex++]
//   }
  
//   return result
// }

// // 4-Step GPT Chain Functions
// async function generateDiagnosis(element: any, elementName: string, prompt: string): Promise<string> {
//   const completion = await getOpenAIClient().chat.completions.create({
//     model: "gpt-4o",
//     messages: [
//       {
//         role: "system",
//         content: 
//         `You are an expert writing coach analyzing argumentative essay elements.

//         The essay prompt is: """${prompt}"""

//         Provide a diagnosis for the ${elementName} element:
//         1. Explains the role of this element in argumentative writing
//         2. Evaluates how well it serves the essay prompt

//         Be specific and direct. Do not provide suggestions or feedback yet.`
//       },
//       {
//         role: "user", 
//         content: `Element: ${elementName}
// Text: "${element.text}"
// Effectiveness: ${element.effectiveness}

// Provide diagnosis:`
//       }
//     ]
//   })
  
//   return completion.choices[0].message.content?.trim() || ""
// }

// async function generateFeedback(element: any, elementName: string, diagnosis: string): Promise<string[]> {
//   const completion = await getOpenAIClient().chat.completions.create({
//     model: "gpt-4o",
//     response_format: { type: "json_object" },
//     messages: [
//       {
//         role: "system",
//         content: 
//         `You are an expert writing coach providing constructive feedback.

// Based on the diagnosis, provide 3-4 bullet points of Indirect feedback for this ${elementName}.

// Rules:
// If effectiveness is "Effective":
// - give positive reinforcement.
// - Focus on explaining why the element is strong (clarity, persuasiveness, alignment).
// - include suggestions to improve the effective element.

// If effectiveness is "Adequate", "Ineffective", or "Missing": Provide guidance for improvement
// - Use <strong>...</strong> tags to highlight important concepts
// - Be encouraging but specific
// - Focus on actionable insights

// Give reflective prompts that guide the student to revise, 
// but do not supply the exact rewritten sentence or replacement words.

// Example:
// Your <strong>claim is clear</strong>, but instead of <strong>repeating it</strong> in every paragraph, state it once strongly in the introduction and let each body paragraph focus on <strong>one reason</strong> (effectiveness, effort, responsibility).
// <strong>Balance personal anecdotes</strong> with <strong>broader reasoning</strong> so the essay sounds more persuasive and less like a diary.
// <strong>Cut down redundancy</strong>—phrases like “to make sure students are effective during the summer break” can be <strong>shortened or rephrased</strong>.
// Add <strong>smoother transitions</strong> so each paragraph <strong>flows logically</strong> into the next.

// Return JSON format: {"feedback": ["point 1", "point 2", "point 3", "point 4"]}`
//       },
//       {
//         role: "user",
//         content: `Element: ${elementName}
// Text: "${element.text}"
// Effectiveness: ${element.effectiveness}
// Diagnosis: ${diagnosis}

// Provide feedback:`
//       }
//     ]
//   })
  
//   const result = JSON.parse(completion.choices[0].message.content || '{"feedback": []}')
//   return result.feedback || []
// }

// async function generateSuggestion(element: any, elementName: string): Promise<string> {
//   // Only generate suggestions for non-effective elements
//   if (element.effectiveness === "Effective") {
//     return ""
//   }
  
//   const completion = await getOpenAIClient().chat.completions.create({
//     model: "gpt-4o",
//     messages: [
//       {
//         role: "system",
//         content: `You are an expert writing coach providing improved versions of essay elements.

// For this ${elementName}:
// - If "Adequate": rewrite it into a stronger, more precise version while keeping the core meaning, Keep the core idea but make it more compelling, Use stronger academic language, Make it more specific and precise.
// - If "Ineffective": create a clear, specific, academic example that fulfills the role, Keep the core idea but make it more compelling, Use stronger academic language, Make it more specific and precise.
// - If "Missing": create an appropriate example, Keep the core idea but make it more compelling, Use stronger academic language, Make it more specific and precise.
// Always return ONE improved sentence only, no extra text.`
//       },
//       {
//         role: "user",
//         content: `Element: ${elementName}
// Original text: "${element.text}"
// Effectiveness: ${element.effectiveness}

// Provide improved version:`
//       }
//     ]
//   })
  
//   return completion.choices[0].message.content?.trim() || ""
// }

// async function generateReason(element: any, elementName: string, suggestion: string): Promise<string> {
//   // Only generate reasons for non-effective elements
//   if (element.effectiveness === "Effective" || !suggestion) {
//     return ""
//   }
  
//   const completion = await getOpenAIClient().chat.completions.create({
//     model: "gpt-4o",
//     messages: [
//       {
//         role: "system",
//         content: `You are an expert writing coach explaining improvements.

// Explain in 2-4 sentences why the suggested improvement is stronger than the original.
// Focus on clarity, persuasiveness, and argumentative effectiveness.`
//       },
//       {
//         role: "user",
//         content: `Element: ${elementName}
// Original: "${element.text}"
// Suggestion: "${suggestion}"
// Effectiveness: ${element.effectiveness}

// Explain why the suggestion is better:`
//       }
//     ]
//   })
  
//   return completion.choices[0].message.content?.trim() || ""
// }

// // Batch processing function to handle multiple elements efficiently
// async function process4StepChain(elements: Array<{element: any, path: string, name: string, index?: number}>, prompt: string): Promise<any[]> {
//   const results = []
  
//   // Process in batches of 5 to avoid rate limits
//   const BATCH_SIZE = 5
//   for (let i = 0; i < elements.length; i += BATCH_SIZE) {
//     const batch = elements.slice(i, i + BATCH_SIZE)
    
//     // Step 1: Generate all diagnoses for this batch
//     const diagnoses = await Promise.all(
//       batch.map(({element, name}) => generateDiagnosis(element, name, prompt))
//     )
    
//     // Step 2: Generate all feedback for this batch
//     const feedbacks = await Promise.all(
//       batch.map(({element, name}, index) => 
//         generateFeedback(element, name, diagnoses[index])
//       )
//     )
    
//     // Step 3: Generate all suggestions for this batch
//     const suggestions = await Promise.all(
//       batch.map(({element, name}) => generateSuggestion(element, name))
//     )
    
//     // Step 4: Generate all reasons for this batch
//     const reasons = await Promise.all(
//       batch.map(({element, name}, index) => 
//         generateReason(element, name, suggestions[index])
//       )
//     )
    
//     // Combine results for this batch
//     for (let j = 0; j < batch.length; j++) {
//       results.push({
//         ...batch[j].element,
//         diagnosis: diagnoses[j],
//         feedback: feedbacks[j],
//         suggestion: suggestions[j],
//         reason: reasons[j]
//       })
//     }
//   }
  
//   return results
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

// CRITICAL: Each element must have both "text" and "effectiveness" fields. Do not include a top-level "effectiveness" field.`;

// // Updated POST function
// export async function POST(request: NextRequest) {
  
//   try {
//     const { essay, prompt } = await request.json() // 👈 also grab prompt
//     const FT_MODEL = process.env.FT_MODEL

//     let completion
//     let modelUsed = FT_MODEL ?? "gpt-5-mini"

//     try {
//       console.log("⚡ Using model:", modelUsed)

//       // STEP 1 → Fine-tuned model gives structure + effectiveness
//       completion = await getOpenAIClient().chat.completions.create({
//         model: modelUsed,
//         messages: [
//           {
//             role: "system",
//             content: FINE_TUNED_SYSTEM_PROMPT,
//           },
//           { role: "user", content: essay },
//         ],
//         response_format: { type: "json_object" },
//       })
//     } catch (err: any) {
//       console.warn("⚠️ FT model unavailable, falling back to gpt-5-mini:", err.message)
//       modelUsed = "gpt-5-mini"
//       console.log("⚡ Using model:", modelUsed)

//       completion = await getOpenAIClient().chat.completions.create({
//         model: modelUsed,
//         messages: [
//           {
//             role: "system",
//             content: FINE_TUNED_SYSTEM_PROMPT,
//           },
//           { role: "user", content: essay },
//         ],
//         response_format: { type: "json_object" },
//       })
//     }


//     const rawContent = completion.choices[0].message.content
//     const analysis = JSON.parse(rawContent ?? "{}")

//     console.log("🔍 Raw FT analysis:", JSON.stringify(analysis, null, 2))

//     // Check if we got the old format and need to assign default effectiveness
//     if ('effectiveness' in analysis && typeof analysis.effectiveness === 'string') {
//       console.warn("⚠️ Model returned old format with top-level effectiveness. Assigning 'Adequate' to all elements.");
      
//       // Convert old format to new format with default effectiveness
//       const convertElement = (text: any) => {
//         if (typeof text === 'string') {
//           return { text, effectiveness: text ? 'Adequate' : 'Missing' };
//         }
//         return text;
//       };

//       analysis.lead = convertElement(analysis.lead);
//       analysis.position = convertElement(analysis.position);
//       analysis.claims = (analysis.claims || []).map(convertElement);
//       analysis.evidence = (analysis.evidence || []).map(convertElement);
//       analysis.counterclaims = (analysis.counterclaims || []).map(convertElement);
//       analysis.counterclaim_evidence = (analysis.counterclaim_evidence || []).map(convertElement);
//       analysis.rebuttals = (analysis.rebuttals || []).map(convertElement);
//       analysis.rebuttal_evidence = (analysis.rebuttal_evidence || []).map(convertElement);
//       analysis.conclusion = convertElement(analysis.conclusion);
      
//       // Remove the top-level effectiveness
//       delete analysis.effectiveness;
//     }

//     function lockEffectiveness(
//       original: Record<string, any>,
//       updated: Record<string, any>
//     ): Record<string, any> {
//       const lock = (o: Record<string, any>, u: Record<string, any>) => {
//         if (!o || !u) return u;
//         u.effectiveness = o.effectiveness;
//         for (const key of Object.keys(o)) {
//           if (Array.isArray(o[key]) && Array.isArray(u[key])) {
//             for (let i = 0; i < o[key].length; i++) lock(o[key][i], u[key][i]);
//           } else if (
//             typeof o[key] === "object" &&
//             o[key] !== null &&
//             typeof u[key] === "object" &&
//             u[key] !== null
//           ) {
//             lock(o[key], u[key]);
//           }
//         }
//       };
//       lock(original, updated);
//       return updated;
//     }
    
//     // STEP 2 → Enrich with empty fields
//     const enriched = enrichElements(analysis)

//     // STEP 3 → 4-Step GPT Chain Processing
//     console.log("🔄 Starting 4-step GPT chain processing...")
    
//     // Collect all elements
//     const allElements = collectElements(enriched)
    
//     // Process through 4-step chain
//     const processedElements = await process4StepChain(allElements, prompt || "")
    
//     // Reconstruct the structure
//     const finalFeedback = reconstructStructure(enriched, processedElements)

//     // STEP 4 → Lock element-level effectiveness (preserve from FT model)
//     const lockedFeedback = lockEffectiveness(enriched, finalFeedback)

//     // STEP 5 → Normalize feedback field into array form
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

//     // STEP 7 → Return normalized version
//     return NextResponse.json(normalized)
//   } catch (error) {
//     console.error("Error analyzing argumentative structure:", error)
//     return NextResponse.json({ error: "Failed to analyze essay" }, { status: 500 })
//   }
// }

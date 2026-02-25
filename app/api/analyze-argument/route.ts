
import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { openai } from "@/lib/openai"

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

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
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

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `
You are an experienced writing coach giving clear, supportive, and easy-to-understand feedback to an English L2 learner. 

Your feedback must:
- Be constructive, specific, and encouraging.
- Use simple but academic English.
- Explain reasoning clearly (avoid vague comments like "good job").
- Help the student understand *why* something works and *how* to improve it.
- Use <strong> </strong> to highlight important writing concepts (e.g., <strong>clarity</strong>, <strong>evidence</strong>, <strong>reasoning</strong>, <strong>persuasiveness</strong>, <strong>alignment</strong>, <strong>coherence</strong>).

If effectiveness is "Effective":
- Start with positive reinforcement.
- Clearly explain why the element is strong (e.g., strong <strong>alignment</strong> with thesis, clear <strong>reasoning</strong>, relevant <strong>evidence</strong>).
- Provide at least one specific suggestion to make it even stronger.

Style guidelines:
- Avoid overly complex vocabulary.
- Keep feedback focused on learning and improvement.
- Do NOT use markdown formatting.
- Only use <strong> </strong> for emphasis.

Return STRICT JSON only in this format:
{"feedback": [["point1", "point2", "point3"], ["point1", "point2", "point3"], ...]}

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

// STEP 3: Generate suggestions for ALL non-effective elements in ONE call
async function batchSuggestionsAll(
  elements: Array<{element: any, name: string, index?: number}>
): Promise<string[]> {
  
  // Filter elements that need suggestions (not "Effective")
  const needsSuggestion = elements.map((e, i) => ({ ...e, originalIndex: i }))
    .filter(e => e.element.effectiveness !== "Effective")
  
  if (needsSuggestion.length === 0) {
    console.log('   ℹ️ All elements are Effective - skipping suggestions')
    return elements.map(() => "")
  }
  
  const elementsList = needsSuggestion.map((e, i) => {
    const displayName = e.index !== undefined 
      ? `${e.name} #${e.index + 1}` 
      : e.name
    return `${i}. ${displayName}
   Original text: "${e.element.text}"
   Effectiveness: ${e.element.effectiveness}`
  }).join('\n\n')

  const completion = await openai.chat.completions.create({
    model: "gpt-5-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are an expert writing coach providing improved versions of essay elements.

For EACH element below, provide ONE improved sentence that is:
- Stronger and more precise while keeping core meaning
- More compelling with stronger academic language
- More specific and clear

Guidelines by effectiveness level:
- If "Adequate": Rewrite into a stronger, more precise version
- If "Ineffective": Create a clear, specific, academic example that fulfills the role
- If "Missing": Create an appropriate example

Always return ONE improved sentence per element, no extra text.

Return JSON: {"suggestions": ["suggestion 1", "suggestion 2", ...]}`
      },
      {
        role: "user",
        content: `Elements to improve:\n\n${elementsList}\n\nProvide one improved sentence for each:`
      }
    ]
  })
  
  const result = JSON.parse(completion.choices[0].message.content || '{"suggestions": []}')
  const suggestions = result.suggestions || []
  
  // Map suggestions back to original array positions
  const fullSuggestions = new Array(elements.length).fill("")
  needsSuggestion.forEach((e, i) => {
    fullSuggestions[e.originalIndex] = suggestions[i] || ""
  })
  
  return fullSuggestions
}

// STEP 4: Generate reasons for ALL suggestions in ONE call
async function batchReasonsAll(
  elements: Array<{element: any, name: string, index?: number}>,
  suggestions: string[]
): Promise<string[]> {
  
  // Filter elements that need reasons (have suggestions and not "Effective")
  const needsReason = elements.map((e, i) => ({ ...e, suggestion: suggestions[i], originalIndex: i }))
    .filter(e => e.suggestion && e.element.effectiveness !== "Effective")
  
  if (needsReason.length === 0) {
    console.log('   ℹ️ No suggestions generated - skipping reasons')
    return elements.map(() => "")
  }
  
  const elementsList = needsReason.map((e, i) => {
    const displayName = e.index !== undefined 
      ? `${e.name} #${e.index + 1}` 
      : e.name
    return `${i}. ${displayName}
   Original: "${e.element.text}"
   Suggestion: "${e.suggestion}"
   Effectiveness: ${e.element.effectiveness}`
  }).join('\n\n')

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are an expert writing coach explaining improvements.

For EACH element below, explain in 2-4 sentences why the suggested improvement is stronger than the original.
Focus on clarity, persuasiveness, and argumentative effectiveness.

Return JSON: {"reasons": ["reason 1", "reason 2", ...]}`
      },
      {
        role: "user",
        content: `Elements with suggestions:\n\n${elementsList}\n\nExplain why each suggestion is better:`
      }
    ]
  })
  
  const result = JSON.parse(completion.choices[0].message.content || '{"reasons": []}')
  const reasons = result.reasons || []
  
  // Map reasons back to original array positions
  const fullReasons = new Array(elements.length).fill("")
  needsReason.forEach((e, i) => {
    fullReasons[e.originalIndex] = reasons[i] || ""
  })
  
  return fullReasons
}

// MAIN OPTIMIZED CHAIN: 4 calls total instead of 48+!
async function optimizedProcess4StepChain(
  elements: Array<{element: any, path: string, name: string, index?: number}>,
  prompt: string
): Promise<any[]> {
  
  const startTime = Date.now()
  console.log(`\n🔗 Starting optimized 4-step LLM chain for ${elements.length} elements`)
  console.log(`⚡ OLD METHOD: ${elements.length * 4} API calls (one per element per step)`)
  console.log(`⚡ NEW METHOD: 4 API calls (all elements per step)\n`)
  
  // Count elements by effectiveness for logging
  const effectiveCounts = elements.reduce((acc, e) => {
    acc[e.element.effectiveness] = (acc[e.element.effectiveness] || 0) + 1
    return acc
  }, {} as Record<string, number>)
  console.log('📊 Element effectiveness from fine-tuned model:', effectiveCounts)
  
  // STEP 1: Diagnose ALL (1 API call)
  console.log('\n📍 Step 1/4: Diagnosing ALL elements...')
  const diagnoses = await batchDiagnoseAll(elements, prompt)
  console.log(`✅ Step 1/4 complete (${Date.now() - startTime}ms)`)
  
  // STEP 2: Feedback for ALL (1 API call)
  console.log('📍 Step 2/4: Generating feedback for ALL elements...')
  const feedbacks = await batchFeedbackAll(elements, diagnoses)
  console.log(`✅ Step 2/4 complete (${Date.now() - startTime}ms)`)
  
  // STEP 3: Suggestions for ALL non-effective (1 API call)
  console.log('📍 Step 3/4: Generating suggestions for non-Effective elements...')
  const suggestions = await batchSuggestionsAll(elements)
  console.log(`✅ Step 3/4 complete (${Date.now() - startTime}ms)`)
  
  // STEP 4: Reasons for ALL suggestions (1 API call)
  console.log('📍 Step 4/4: Generating reasons for ALL suggestions...')
  const reasons = await batchReasonsAll(elements, suggestions)
  console.log(`✅ Step 4/4 complete (${Date.now() - startTime}ms)`)
  
  console.log(`\n🎉 Total chain time: ${Date.now() - startTime}ms`)
  console.log(`🚀 Estimated speedup: ~${Math.floor((elements.length * 4) / 4)}x faster\n`)
  
  // Combine all results
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
    const FT_MODEL = process.env.FT_MODEL

    let completion
    let modelUsed = FT_MODEL ?? "gpt-4o-mini"

    try {
      console.log("⚡ Using model:", modelUsed)

      // STEP 1 → Fine-tuned model gives structure + effectiveness
      completion = await openai.chat.completions.create({
        model: modelUsed,
        messages: [
          { role: "system", content: FINE_TUNED_SYSTEM_PROMPT },
          { role: "user", content: essay },
        ],
        response_format: { type: "json_object" },
      })
    } catch (err: any) {
      console.warn("⚠️ FT model unavailable, falling back to gpt-4o-mini:", err.message)
      modelUsed = "gpt-4o-mini"
      console.log("⚡ Using model:", modelUsed)

      completion = await openai.chat.completions.create({
        model: modelUsed,
        messages: [
          { role: "system", content: FINE_TUNED_SYSTEM_PROMPT },
          { role: "user", content: essay },
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
    console.error("Error analyzing argumentative structure:", error)
    return NextResponse.json({ error: "Failed to analyze essay" }, { status: 500 })
  }
}

// import { type NextRequest, NextResponse } from "next/server"
// import { z } from "zod"
// import { openai } from "@/lib/openai"

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
//   const completion = await openai.chat.completions.create({
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
//   const completion = await openai.chat.completions.create({
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
  
//   const completion = await openai.chat.completions.create({
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
  
//   const completion = await openai.chat.completions.create({
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
//       completion = await openai.chat.completions.create({
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

//       completion = await openai.chat.completions.create({
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
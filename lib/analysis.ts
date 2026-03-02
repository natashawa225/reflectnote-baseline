import type { AnalysisResult, LexicalAnalysis } from "./types"

async function getErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json()
    if (typeof data?.error === "string" && data.error) {
      return data.error
    }
  } catch {
    // Ignore JSON parse failures and use fallback message.
  }
  return fallback
}

export async function analyzeArgumentativeStructure(essay: string, prompt: string):  Promise<AnalysisResult> {
  try {
    const response = await fetch("/api/analyze-argument", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ essay, prompt }),
    })

    if (!response.ok) {
      const message = await getErrorMessage(response, `Failed to analyze essay (status ${response.status})`)
      throw new Error(message)
    }

    return await response.json()
  } catch (error) {
    console.error("Error analyzing argumentative structure:", error)
    throw error
    // Return mock data for development
    // return getMockAnalysis(essay)
  }
}

export async function analyzeLexicalFeatures(essay: string): Promise<LexicalAnalysis> {
  try {
    const response = await fetch("/api/analyze-lexical", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ essay }),
    })

    if (!response.ok) {
      const message = await getErrorMessage(response, `Failed to analyze lexical features (status ${response.status})`)
      throw new Error(message)
    }

    return await response.json()
  } catch (error) {
    console.error("Error analyzing lexical features:", error)
    throw error
    // Return mock data for development
    // return getMockLexicalAnalysis(essay)
  }
}

export function calculateMATTR(text: string): number {
  const words = text.toLowerCase().match(/\b\w+\b/g) || []
  if (words.length < 50) return 0

  const windowSize = 50
  let totalTTR = 0
  let windowCount = 0

  for (let i = 0; i <= words.length - windowSize; i++) {
    const window = words.slice(i, i + windowSize)
    const uniqueWords = new Set(window)
    const ttr = uniqueWords.size / windowSize
    totalTTR += ttr
    windowCount++
  }

  return windowCount > 0 ? totalTTR / windowCount : 0
}

// function getMockAnalysis(essay: string): AnalysisResult {
//   const sentences = essay.split(/[.!?]+/).filter((s) => s.trim().length > 0)

//   return {
//     elements: {
//       lead: {
//         text: sentences[0] || "",
//         effectiveness: "Adequate",
//         feedback:
//           "Your lead attempts to grab attention but could be more engaging. Consider starting with a compelling question or statistic.",
//       },
//       position: {
//         text: sentences[1] || "",
//         effectiveness: "Effective",
//         feedback: "Consider adding a qualifier (e.g., 'to some extent') to make your stance more nuanced.",
//         suggestions:
//           "Although critics highlight the challenges of the digital revolution, the evidence overwhelmingly demonstrates that technology has enhanced society and continues to propel human progress.",
//       },
//       claims: [
//         {
//           text: sentences[3] || "",
//           effectiveness: "Effective",
//           feedback: "Strong claim that supports your position with specific reasoning.",
//         },
//         {
//           text: sentences[6] || "",
//           effectiveness: "Effective",
//           feedback: "Good supporting claim but could use more specific details.",
//         },
//       ],
//       counterclaim: {
//         text: sentences[7] || "",
//         effectiveness: "Ineffective",
//         feedback:
//           "This counterclaim doesn’t present a real opposing viewpoint. Instead, it continues to support your thesis. A stronger counterclaim should acknowledge criticisms of technology, such as isolation or inequality during the pandemic.",
//         suggestions:
//           "Some observers claimed that the surge in remote work and online learning during COVID-19 deepened the digital divide between those with and without stable internet access. (Better because it highlights a concrete drawback, making your rebuttal more persuasive.)",
//         reason:
//           "Some observers claimed that the surge in remote work and online learning during COVID-19 deepened the digital divide between those with and without stable internet access. (Better because it highlights a concrete drawback, making your rebuttal more persuasive.)",
//       },
//       counterclaim_evidence: {
//         text: sentences[8] || "",
//         effectiveness: "Ineffective",
//         feedback: "No evidence provided to support the counterclaim.",
//       },
//       rebuttal: {
//         text: sentences[9] || "",
//         effectiveness: "Adequate",
//         feedback:
//           "It acknowledges the counterclaim respectfully (showing balance), and it flips the perspective (problems aren’t inherent in tech, they’re solvable). However, it’s general — it doesn’t yet prove how education/responsible use solves anxiety or depression",
//         suggestions:
//           "While these concerns deserve attention, evidence suggests that digital literacy programs and healthy usage habits can significantly reduce the risks of social isolation and anxiety, showing that the problem lies more in how technology is used than in the technology itself.",
//       },
//       rebuttal_evidence: {
//         text: sentences[11] || "",
//         effectiveness: "Effective",
//         feedback: "This is strong, concrete evidence. It gives clear, real-world examples of tech’s positive functions that directly counter the “isolation/mental health” criticism. The examples are varied (social, political, educational), which strengthens persuasiveness.",
//       },

//       evidence: [
//         {
//           text: sentences[4] || "",
//           effectiveness: "Effective",
//           feedback: "Strong evidence with specific examples that support your claim.",
//         },
//         {
//           text: sentences[5] || "",
//           effectiveness: "Adequate",
//           feedback: "Good supporting evidence but could be more detailed.",
//         },
//         {
//           text: sentences[7] || "",
//           effectiveness: "Adequate",
//           feedback: "Good supporting evidence but could be more detailed.",
//         },
//       ],
//       conclusion: {
//         text: sentences[sentences.length - 1] || "",
//         effectiveness: "Adequate",
//         feedback: "Conclusion restates main points but could be more impactful.",
//       },
//     },

//   }
// }

// function getMockLexicalAnalysis(essay: string): LexicalAnalysis {
//   const words = essay.toLowerCase().match(/\b\w+\b/g) || []
//   const uniqueWords = new Set(words)

//   return {

//     awlCoverage: {
//       score: 72,
//       suggestions: [
//         {
//           original: "proved",
//           reason:
//             "Think of a formal academic verb meaning “to show clearly with evidence.” It often appears in research when presenting findings.",
//           suggestion: "demonstrated",
//           sublist: 1,
//           category: "academic vocabulary",
//           explanation:
//             "Demonstrated emphasizes evidence-based confirmation, which is a cornerstone of academic writing. Unlike proved, which can sound absolute and conversational, demonstrated signals that the claim is supported by data or examples.",
//           example: "During the COVID-19 pandemic, these technologies demonstrated their essential role…",
//         },
//         {
//           original: "fearing",
//           reason:
//             "Instead of “fearing change,” think of a more neutral academic word meaning “to oppose or push against.",
//           suggestion: "resisting",
//           sublist: 2,
//           category: "academic vocabulary",
//           explanation:
//             "Resisting conveys deliberate opposition without emotional connotation. Academic writing avoids words like fearing, which suggest psychological states; instead, resisting frames the issue as a rational, observable action that can be studied or debated.",
//           example: "Rather than resisting change, we should embrace technology’s potential…",
//         },
//         {
//           original: "saved",
//           reason:
//             "Instead of “saved,” which is emotional and everyday, what academic word could describe making survival possible?",
//           suggestion: "Preserved",
//           sublist: 3,
//           category: "academic vocabulary",
//           explanation:
//             "Preserved is less emotive and more formal, shifting the claim from heroic/emotional to objective and measurable.",
//           example:
//             "Technological advances in healthcare have preserved lives and improved quality of life for millions",
//         },
//       ],
//     },
//     aflCoverage: {
//       score: 65,
//       suggestions: [
//         {
//           original: "the key lies in",
//           reason:
//             "Instead of “the key lies in,” which sounds metaphorical, what academic phrase is often used to describe the role of something in contributing to outcomes?",
//           suggestion: "plays a crucial role in",
//           value: "Medium Academic Value",
//           explanation:
//             "Removes metaphor (the key) and replaces it with a widely recognized academic collocation. Plays a crucial role in directly expresses importance in a way that is both formal and conventional in scholarly writing.",
//           example: "Technology plays a crucial role in society, so we must learn to use it wisely.",
//         },
//         {
//           original: "overwhelmingly beneficial",
//           reason:
//             "The adverb 'overwhelmingly' is more emotive than analytical, which makes the phrase sound journalistic rather than academic. What alternative wording could present the same idea in a measured and scholarly tone?",
//           suggestion: "highly advantageous",
//           value: "Medium Academic Value",
//           explanation:
//             "Replacing 'overwhelmingly' with 'highly' shifts the tone from exaggerated praise to precise evaluation. 'Advantageous' conveys practical and measurable benefits, which strengthens the analytical voice of the essay.",
//           example:
//             "The adoption of renewable energy has proven to be highly advantageous for reducing long-term environmental costs.",
//         },
//         {
//           original: "plays a big role in shaping society",
//           reason:
//             "“Big role” is vague and conversational. What academic phrase could describe technology’s measurable influence on society?",
//           suggestion: "exerts significant influence on",
//           value: "Medium Academic Value",
//           explanation:
//             "The revised phrase uses more precise and formal wording. 'Exerts significant influence' signals measurable impact, which strengthens academic tone while keeping the meaning clear.",
//           example: "Social media exerts significant influence on political engagement among young adults.",
//         },
//       ],
//     },

//     // academicWordCoverage: {
//     //   awlWords: [
//     //     { word: "analysis", headword: "analyse", sublist: 1 },
//     //     { word: "approach", headword: "approach", sublist: 1 },
//     //   ],
//     //   aflPhrases: [{ phrase: "on the other hand", frequency: 2.84 }],
//     //   coverageScore: 65,
//     // },
//     // lexicalPrevalence: {
//     //   score: 72,
//     //   highFrequencyWords: [
//     //     { word: "the", frequency: 444402 },
//     //     { word: "and", frequency: 200238 },
//     //   ],
//     //   lowFrequencyWords: [
//     //     { word: "sophisticated", frequency: 1250 },
//     //     { word: "paradigm", frequency: 890 },
//     //   ],
//     //   prevalenceScore: 72,
//     //   flaggedWords: [
//     //     {
//     //       word: "sophisticated",
//     //       reason: "This word may be too vague in an academic context, as it does not specify what aspect is advanced or complex.",
//     //       suggestion: "'well-developed'",
//     //       example: "The system is well-developed in its ability to analyze large datasets"
//     //     },
//     //     {
//     //       word: "paradigm",
//     //       reason: "This word is often overused in essays and can sound unnecessarily abstract.",
//     //       suggestion: "framework",
//     //       example: "This marks a new framework in education"
//     //     }
//     //   ]
//     // },
//     lexicalDiversity: {
//       uniqueWords: uniqueWords.size,
//       totalWords: words.length,
//       diversityLevel: "Medium",
//       mattr: 0.68,
//       feedback: "this is the feedback",
//       suggestions: ["Clear position statement", "Good use of evidence", "Logical structure"],
//     },
//   }
// }

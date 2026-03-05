export interface ArgumentElement {
  id?: string
  parentClaimId?: string
  text: string
  effectiveness: "Effective" | "Adequate" | "Ineffective" | "Missing"
  feedback: string
  suggestion?: string
  reason?: string
}

export interface AnalysisResult {
  elements: {
    lead: ArgumentElement
    position: ArgumentElement
    claims: ArgumentElement[]
    counterclaim: ArgumentElement
    counterclaim_evidence: ArgumentElement
    rebuttal: ArgumentElement
    rebuttal_evidence: ArgumentElement
    evidence: ArgumentElement[]
    conclusion: ArgumentElement
  }
}
export type ArgumentElementKey = keyof AnalysisResult["elements"]
export interface LexicalDiversity {
  uniqueWords: number
  totalWords: number
  diversityLevel: "Low" | "Medium" | "High"
  mattr: number
  feedback: string
  suggestions: string[]
  answer: string
  reason: string
  repetitiveWords?: {
    word: string
    count: number
    frequency: number | string
    answer: string
    reason: string
  }[]
}

export interface LexicalAnalysis {

  awlCoverage: {
    score: number
    suggestions: Array<{
      original: string
      reason: string
      suggestion: string
      sublist: number
      category: string
      explanation: string
      example: string
      exampleEssay:string
      exampleMasked:string

    }>
  }
  aflCoverage: {
    score: number
    suggestions: Array<{
      original: string
      reason: string
      suggestion: string
      value: string
      explanation: string
      example: string
      exampleEssay:string
      exampleMasked:string
    }>
  }

  lexicalDiversity: LexicalDiversity
}

export interface Highlight {
  id: string
  elementId: string
  start: number
  end: number
  text?: string // Added optional text property to store actual highlight content
  type: "argument" | "lexical"
  subtype?: string
  color: string
  feedback?: string
  persistent?: boolean
  word?: string
}

export interface HighlightState {
  argumentHighlights: Highlight[]
  lexicalHighlights: Highlight[]
  awlHighlights: Highlight[]
  aflHighlights: Highlight[]
  repetitiveWordHighlights: Highlight[]
  activeTab: string
  showArgumentHighlights: boolean
  showLexicalHighlights: boolean
}
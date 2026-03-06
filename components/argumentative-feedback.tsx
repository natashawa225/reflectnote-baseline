"use client"

import { useState, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Progress } from "@/components/ui/progress"
import { Eye, Lightbulb, Sparkles, Target, TrendingUp, AlertTriangle, CheckCircle, ArrowBigRight, Info, HelpCircle } from "lucide-react"
import { ArgumentDiagram } from "./argument-diagram"
import type { AnalysisResult, ArgumentElement, ArgumentElementKey } from "@/lib/types"
import { SetupGuide } from "@/components/setup-guide"
import ReactMarkdown from "react-markdown"
import rehypeRaw from 'rehype-raw';

interface ArgumentativeFeedbackProps {
  analysis: AnalysisResult | null
  essay: string
  isAnalyzing: boolean
  onHighlightText?: (text: string, effectiveness: string) => void
  onElementSelect?: (elementId: string | null) => void
  onFeedbackEvent?: (payload: {
    eventType: "suggestion_revealed"
    feedbackLevel: 3
    issueClientKey: string
    metadata: {
      source: "show_correction"
      elementId: string
      elementType: string
      elementIndex: number | null
    }
  }) => void
}

export function ArgumentativeFeedback({ analysis, essay, isAnalyzing, onHighlightText, onFeedbackEvent }: ArgumentativeFeedbackProps) {
  const [showDiagram, setShowDiagram] = useState(false)
  const [selectedElement, setSelectedElement] = useState<string | null>(null)
  const [expandedCard, setExpandedCard] = useState<string | null>(null)
  const [showCorrections, setShowCorrections] = useState<Set<string>>(new Set())

  const toggleCorrection = (elementId: string) => {
    const isOpening = !showCorrections.has(elementId)
    if (isOpening) {
      const parsed = parseElementId(elementId)
      const elementType = parsed.elementKey
      const elementIndex = parsed.index ?? null


      onFeedbackEvent?.({
        eventType: "suggestion_revealed",
        feedbackLevel: 3,
        issueClientKey: elementId,
        metadata: {
          source: "show_correction",
          elementId,
          elementType,
          elementIndex,
        },
      })
    }
    setShowCorrections((prev) => {
      const next = new Set(prev)
      if (next.has(elementId)) {
        next.delete(elementId)
      } else {
        next.add(elementId)
      }
      return next
    })
  }

  const getEffectivenessColor = (effectiveness: string) => {
    switch (effectiveness) {
      case "Effective":
        return "bg-green-100 text-green-800 border-green-200"
      case "Adequate":
        return "bg-yellow-100 text-yellow-800 border-yellow-200"
      case "Ineffective":
        return "bg-red-100 text-red-800 border-red-200"
      default:
        return "bg-gray-100 text-gray-800 border-gray-200"
    }
  }

  const getDisplayEffectiveness = (element: ArgumentElement): ArgumentElement["effectiveness"] => {
    if ((element.text ?? "").trim().length === 0) {
      return "Missing"
    }
    return element.effectiveness
  }

  type ParsedElement = {
    elementKey: keyof AnalysisResult["elements"]
    index?: number
    correctionKey: string
  }

  // Parse only indexed claim/evidence IDs; keep single-node IDs exact.
  const parseElementId = (elementId: string): ParsedElement => {
    const indexedMatch = elementId.match(/^(claim|evidence)-(\d+)$/)
    if (indexedMatch) {
      const base = indexedMatch[1]
      const parsedNumber = parseInt(indexedMatch[2], 10)
      return {
        elementKey: base === "claim" ? "claims" : "evidence",
        index: Math.max(0, parsedNumber - 1),
        correctionKey: `${base}-${parsedNumber}`,
      }
    }

    return {
      elementKey: elementId as keyof AnalysisResult["elements"],
      correctionKey: elementId,
    }
  }

  const getElement = (parsed: ParsedElement): ArgumentElement | null => {
    if (!analysis) return null
    const element = analysis.elements[parsed.elementKey]
    if (Array.isArray(element)) {
      if (parsed.index === undefined) return null
      const byElementId = element.find((entry) => entry.id === parsed.correctionKey)
      if (byElementId) return byElementId

      const byExactIndex = element[parsed.index]
      if (byExactIndex) return byExactIndex

      // Accept 1-based IDs from model/parser regressions (e.g., claim-1 for first claim).
      if (parsed.index > 0) {
        const byOneBasedIndex = element[parsed.index - 1]
        if (byOneBasedIndex) return byOneBasedIndex
      }

      return null
    }
    return (element as ArgumentElement) ?? null
  }

  const handleElementClick = (elementId: string) => {
    const parsed = parseElementId(elementId)
    const uniqueId = parsed.correctionKey
    setSelectedElement((prev) => (prev === uniqueId ? null : uniqueId))

    onFeedbackEvent?.({
      eventType: "suggestion_revealed",
      feedbackLevel: 3,
      issueClientKey: uniqueId,
      metadata: {
        source: "show_correction",
        elementId: uniqueId,
        elementType: parsed.elementKey,
        elementIndex: parsed.index ?? null,
      },
    })

    // Highlight text in essay if element has text
    const element = getElement(parsed)
    if (element && element.text.trim().length > 0 && onHighlightText) {
      onHighlightText(element.text, getDisplayEffectiveness(element))
    }
  }

  const handleCardHover = (elementId: string, isHovering: boolean) => {
    if (isHovering) {
      setExpandedCard(elementId)
    } else {
      setExpandedCard(null)
    }
  }

  const selectedParsed = useMemo(
    () => (selectedElement ? parseElementId(selectedElement) : null),
    [selectedElement],
  )
  const currentElement = useMemo(
    () => (selectedParsed ? getElement(selectedParsed) : null),
    [selectedParsed, analysis],
  )
  const currentElementEffectiveness = currentElement ? getDisplayEffectiveness(currentElement) : null
  const isOptionalCounterclaimEvidence = selectedParsed?.elementKey === "counterclaim_evidence"
  const isEvidenceElement = selectedParsed?.elementKey === "evidence"
  const selectedCorrectionKey = selectedElement ?? ""
  const suggestedCorrection =
    ((currentElement as (ArgumentElement & { suggested_correction?: string }) | null)?.suggested_correction ??
      currentElement?.suggestion ??
      "") || ""
  const shouldShowCorrections = isEvidenceElement ? showCorrections.has(selectedCorrectionKey) : true

  if (isAnalyzing) {
    return (
      <div className="p-6 space-y-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-sm text-muted-foreground">Analyzing argumentative structure...</p>
        </div>
      </div>
    )
  }

  if (!analysis) {
    return (
      <div className="p-6 space-y-4">
        <Alert>
          <Target className="h-4 w-4" />
          <AlertDescription>
            Click "Analyze Essay" to get detailed feedback on your argumentative structure.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 space-y-6">
      <SetupGuide />

        {/* Diagram and feedback card */}
          <div className="space-y-4">
            <ArgumentDiagram analysis={analysis} essay={essay} onElementClick={handleElementClick} />
            
            {selectedElement && currentElement && (
              <Card className="border-primary/20">
                <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                    <div className="flex items-center gap-2">
                    <Lightbulb className="h-4 w-4" />
                    <span>
                      {selectedParsed &&
                        selectedParsed.elementKey.charAt(0).toUpperCase() + selectedParsed.elementKey.slice(1)}
                      {selectedParsed?.index !== undefined && ` ${selectedParsed.index + 1}`} Feedback
                    </span>
                  </div>
                  <Badge className={getEffectivenessColor(currentElementEffectiveness ?? "Missing")}>
                    {currentElementEffectiveness ?? "Missing"}
                  </Badge>
                </CardTitle>
                </CardHeader>
                <CardContent>
                  <div>
                    {/* ✅ If Effective → show Why This Works immediately */}
                    {currentElementEffectiveness === "Effective" ? (
                      <div className="mt-3 p-3 rounded-lg bg-green-50 border border-green-200">
                        <h5 className="font-medium mb-2 text-green-800">Why This Works:</h5>

                        {Array.isArray(currentElement.feedback) ? (
                          <ul className="list-disc pl-5 text-sm text-gray-700 mt-1 space-y-1">
                          {currentElement.feedback.map((item: string, i: number) => (
                            <li key={i}>
                              <ReactMarkdown
                                rehypePlugins={[rehypeRaw]} // ← This allows HTML parsing
                                components={{
                                  strong: ({ node, ...props }) => (
                                    <strong 
                                    className="font-semibold text-gray-900" 
                                    {...props} />
                                  ),
                                }}
                              >
                                {item}
                              </ReactMarkdown>
                            </li>
                          ))}
                        </ul>
                        
                        ) : (
                          <p
                            className="text-sm text-green-700"
                            dangerouslySetInnerHTML={{ __html: currentElement.feedback }}
                          />
                        )}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {isOptionalCounterclaimEvidence && (
                          <p className="font-medium text-red-800 mb-2 flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4" />该要素为可选，可根据需要补充。
                          </p>
                        )}

                        {isEvidenceElement && selectedElement && (
                          <div className="flex justify-end mt-2">
                            <Button
                              size="sm"
                              className="bg-white shadow-sm text-primary font-medium hover:bg-white hover:shadow-md hover:text-primary"
                              onClick={() => toggleCorrection(selectedElement)}
                            >
                              {showCorrections.has(selectedElement) ? "Hide Correction" : "Show Correction"}
                            </Button>
                          </div>
                        )}

                        {shouldShowCorrections && (
                          <div className="flex items-start gap-3">
                            <div className="flex-1">
                              {suggestedCorrection && (
                                <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200 animate-in slide-in-from-top-2 duration-200">
                                  <h5 className="font-medium mb-2 text-red-800">优化表达示例:</h5>
                                  <p className="text-sm text-red-700">{suggestedCorrection}</p>
                                </div>
                              )}
                              {currentElement.reason && (
                                <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200 animate-in slide-in-from-top-2 duration-200">
                                  <h5 className="font-medium mb-2 text-amber-800">优化说明:</h5>
                                  <p className="text-sm text-amber-700">{currentElement.reason}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>

              </Card>
            )}
          </div>
      </div>
    </div>
  )
}

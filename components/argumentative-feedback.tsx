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
  const [selectedFeedback, setSelectedFeedback] = useState<FeedbackEntry | null>(null)
  const [expandedCard, setExpandedCard] = useState<string | null>(null)
  const [showCorrections, setShowCorrections] = useState<Set<string>>(new Set())

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

  type FeedbackEntry = {
    elementId: string
    element: ArgumentElement
    elementKey: keyof AnalysisResult["elements"]
    index: number | null
    status: ArgumentElement["effectiveness"]
  }

  const feedbackMap = useMemo(() => {
    const map: Record<string, FeedbackEntry> = {}
    if (!analysis) return map

    const register = (
      id: string,
      element: ArgumentElement,
      elementKey: keyof AnalysisResult["elements"],
      index: number | null
    ) => {
      const normalizedId = id.trim()
      if (!normalizedId) return
      map[normalizedId] = {
        elementId: normalizedId,
        element,
        elementKey,
        index,
        status: getDisplayEffectiveness(element),
      }
    }

    const registerArray = (
      elementKey: "claims" | "evidence",
      prefix: "claim" | "evidence",
      elements: ArgumentElement[],
    ) => {
      elements.forEach((element, i) => {
        const explicitId = (element.id ?? "").trim()
        const elementId = explicitId || `${prefix}-${i + 1}`
        register(elementId, element, elementKey, i)
      })
    }

    registerArray("claims", "claim", analysis.elements.claims ?? [])
    registerArray("evidence", "evidence", analysis.elements.evidence ?? [])

    register("lead", analysis.elements.lead, "lead", null)
    register("position", analysis.elements.position, "position", null)
    register("counterclaim", analysis.elements.counterclaim, "counterclaim", null)
    register("counterclaim_evidence", analysis.elements.counterclaim_evidence, "counterclaim_evidence", null)
    register("rebuttal", analysis.elements.rebuttal, "rebuttal", null)
    register("rebuttal_evidence", analysis.elements.rebuttal_evidence, "rebuttal_evidence", null)
    register("conclusion", analysis.elements.conclusion, "conclusion", null)

    return map
  }, [analysis])

  const handleElementClick = (elementId: string) => {
    const uniqueId = elementId
    const feedback = feedbackMap[uniqueId] ?? null
    const nextSelected = selectedElement === uniqueId ? null : uniqueId
    setSelectedElement(nextSelected)
    setSelectedFeedback(nextSelected ? feedback : null)

    if (feedback) {
      onFeedbackEvent?.({
        eventType: "suggestion_revealed",
        feedbackLevel: 3,
        issueClientKey: uniqueId,
        metadata: {
          source: "show_correction",
          elementId: uniqueId,
          elementType: feedback.elementKey,
          elementIndex: feedback.index,
        },
      })
    }

    console.log("Clicked element:", uniqueId)
    console.log("Feedback retrieved:", feedbackMap[uniqueId])

    // Highlight text in essay if element has text
    if (!feedback) {
      console.warn("Feedback entry missing for diagram element id", { elementId: uniqueId })
      return
    }
    const element = feedback.element
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

  const currentEntry = selectedFeedback
  const currentElement = selectedFeedback?.element ?? null
  const currentElementEffectiveness = currentElement ? getDisplayEffectiveness(currentElement) : null
  const isOptionalCounterclaimEvidence = currentEntry?.elementKey === "counterclaim_evidence"
  const suggestedCorrection =
    ((currentElement as (ArgumentElement & { suggested_correction?: string }) | null)?.suggested_correction ??
      currentElement?.suggestion ??
      "") || ""

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
                      {currentEntry && currentEntry.elementKey.charAt(0).toUpperCase() + currentEntry.elementKey.slice(1)}
                      {currentEntry?.index !== null && currentEntry?.index !== undefined && ` ${currentEntry.index + 1}`} Feedback
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

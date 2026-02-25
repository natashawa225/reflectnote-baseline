"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Progress } from "@/components/ui/progress"
import { Eye, Lightbulb, Sparkles, Target, TrendingUp, AlertTriangle, CheckCircle, ArrowBigRight, Info, HelpCircle } from "lucide-react"
import { ArgumentDiagram } from "./argument-diagram"
import type { AnalysisResult, ArgumentElement } from "@/lib/types"
import { SetupGuide } from "@/components/setup-guide"
import ReactMarkdown from "react-markdown"
import rehypeRaw from 'rehype-raw';

interface ArgumentativeFeedbackProps {
  analysis: AnalysisResult | null
  essay: string
  isAnalyzing: boolean
  onHighlightText?: (text: string, effectiveness: string) => void
  onElementSelect?: (elementId: string | null) => void
}

export function ArgumentativeFeedback({ analysis, essay, isAnalyzing, onHighlightText }: ArgumentativeFeedbackProps) {
  const [showDiagram, setShowDiagram] = useState(false)
  const [selectedElement, setSelectedElement] = useState<string | null>(null)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [expandedCard, setExpandedCard] = useState<string | null>(null)
  const [showCorrections, setShowCorrections] = useState<Set<string>>(new Set())

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

  const toggleCorrection = (elementId: string) => {
    const newShowCorrections = new Set(showCorrections)
    if (newShowCorrections.has(elementId)) {
      newShowCorrections.delete(elementId)
    } else {
      newShowCorrections.add(elementId)
    }
    setShowCorrections(newShowCorrections)
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

  // Helper function to get element by key and index
  const getElement = (elementKey: string, index?: number): ArgumentElement | null => {
    console.log("[ArgumentativeFeedback] getElement called:", { elementKey, index })
    
    // Convert singular diagram IDs to plural analysis keys
    let analysisKey = elementKey
    if (elementKey === 'claim') analysisKey = 'claims'
    if (elementKey === 'evidence') analysisKey = 'evidence'
    
    const element = analysis.elements[analysisKey as keyof typeof analysis.elements]
    console.log("[ArgumentativeFeedback] Raw element from analysis:", element)
    
    if (Array.isArray(element)) {
      const result = index !== undefined ? element[index] || null : null
      console.log("[ArgumentativeFeedback] Array element result:", result)
      return result
    }
    
    console.log("[ArgumentativeFeedback] Single element result:", element)
    return element as ArgumentElement
  }

  const handleElementClick = (elementId: string) => {
    console.log("[ArgumentativeFeedback] Element clicked:", elementId)
    console.log("[ArgumentativeFeedback] Analysis elements:", analysis.elements)
    
    // Parse element ID to extract base name and index
    const match = elementId.match(/^(.*?)-(\d+)$/)
    let baseElementId: string
    let index: number | undefined
    
    if (match) {
      baseElementId = match[1]
      index = parseInt(match[2], 10)
      console.log("[ArgumentativeFeedback] Parsed array element:", { baseElementId, index })
    } else {
      baseElementId = elementId
      index = undefined
      console.log("[ArgumentativeFeedback] Single element:", baseElementId)
    }
    
    // Create unique identifier
    const uniqueId = elementId
    console.log("[ArgumentativeFeedback] Unique ID:", uniqueId)
    
    setSelectedElement(selectedElement === uniqueId ? null : uniqueId)
    setSelectedIndex(index !== undefined ? index : null)

    // Highlight text in essay if element has text
    const element = getElement(baseElementId, index)
    console.log("[ArgumentativeFeedback] Retrieved element:", element)
    
    if (element && element.text && onHighlightText) {
      onHighlightText(element.text, element.effectiveness)
    }
  }

  const handleCardHover = (elementId: string, isHovering: boolean) => {
    if (isHovering) {
      setExpandedCard(elementId)
    } else {
      setExpandedCard(null)
    }
  }

  // Helper function to parse selected element ID
  const parseSelectedElement = () => {
    if (!selectedElement) return { elementKey: null, index: undefined }
    
    const match = selectedElement.match(/^(.*?)-(\d+)$/)
    if (match) {
      const baseKey = match[1]
      const index = parseInt(match[2], 10)
      const elementKey = baseKey === 'claim' ? 'claims' : baseKey === 'evidence' ? 'evidence' : baseKey
      return { elementKey, index }
    } else {
      return { elementKey: selectedElement, index: undefined }
    }
  }


  const { elementKey, index } = parseSelectedElement()
  const currentElement = elementKey ? getElement(elementKey, index) : null

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
                      {elementKey && elementKey.charAt(0).toUpperCase() + elementKey.slice(1)}
                      {index !== undefined && ` ${index + 1}`} Feedback
                    </span>
                  </div>
                  <Badge className={getEffectivenessColor(currentElement.effectiveness)}>
                    {currentElement.effectiveness}
                  </Badge>
                </CardTitle>
                </CardHeader>
                <CardContent>
                  <div>
                    {/* ✅ If Effective → show Why This Works immediately */}
                    {currentElement.effectiveness === "Effective" ? (
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

                        <div className="flex items-start gap-3">
                              <div className="flex-1">
                                <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200 animate-in slide-in-from-top-2 duration-200">
                                  <h5 className="font-medium mb-2 text-red-800">
                                    Suggested Correction:
                                  </h5>
                                  <p className="text-sm text-red-700">
                                    {currentElement.suggestion}
                                  </p>
                                </div>
                                <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200 animate-in slide-in-from-top-2 duration-200">
                                <h5 className="font-medium mb-2 text-amber-800">Reason:</h5>
                                <p className="text-sm text-amber-700">{currentElement.reason}</p>
                                </div>
                              </div>
                        </div>

                        {/* <div className="flex justify-end mt-2">
                          <Button
                            size="sm"
                            className="bg-white shadow-sm text-primary font-medium hover:bg-white hover:shadow-md hover:text-primary"
                            onClick={() => toggleCorrection(selectedElement)}
                          >
                            {showCorrections.has(selectedElement)
                              ? "Hide Correction"
                              : "Show Correction"}
                          </Button>
                        </div>

                        {showCorrections.has(selectedElement) &&
                          currentElement.suggestion && (
                            <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200 animate-in slide-in-from-top-2 duration-200">
                              <h5 className="font-medium mb-2 text-red-800">
                                Suggested Correction:
                              </h5>
                              <p className="text-sm text-red-700">
                                {currentElement.suggestion}
                              </p>
                            </div>
                          )}

                        {showCorrections.has(selectedElement) && currentElement.reason && (
                          <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200 animate-in slide-in-from-top-2 duration-200">
                            <h5 className="font-medium mb-2 text-amber-800">Reason:</h5>
                            <p className="text-sm text-amber-700">{currentElement.reason}</p>
                          </div>
                        )} */}
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
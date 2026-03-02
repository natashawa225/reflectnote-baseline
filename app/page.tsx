"use client"

import { PromptSelector } from "@/components/prompt-selector"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Separator } from "@/components/ui/separator"
import { EssayEditor } from "@/components/essay-editor"
import { FeedbackPanel } from "@/components/feedback-panel"
import { analyzeArgumentativeStructure } from "@/lib/analysis"
import { getOrCreateSessionId } from "@/lib/session"
import {
  ensureSession,
  hasInitialDraftLog,
  logEvent,
  markSessionSubmitted,
  replaceSessionIssues,
  saveDraftSnapshot,
  type SessionIssue,
} from "@/lib/research"
import type { AnalysisResult, Highlight, ArgumentElementKey } from "@/lib/types"
import { Sparkles, BookOpen, AlertCircle } from "lucide-react"

type RevisionData = {
  totalEditsAfterAnalyze: number
  totalCorrectedViewed: number
  feedbackLevelCounts: {
    level1: number
    level2: number
    level3: number
  }
  revisionWindowMinutes: number
  elementTypeEngagement: Record<string, number>
  viewedCorrectionsBeforeEditing: boolean
}

export default function ArgumentativeWritingAssistant() {
  const [essay, setEssay] = useState("")
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [panelWidth, setPanelWidth] = useState(480)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [argumentAnalysis, setArgumentAnalysis] = useState<AnalysisResult | null>(null)
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState("argumentative")
  const [activeSubTab, setActiveSubTab] = useState<string>("")
  const [currentHighlight, setCurrentHighlight] = useState<{
    text: string
    effectiveness: string
  } | null>(null)
  const [selectedPrompt, setSelectedPrompt] = useState<string>("")
  const [sessionId, setSessionId] = useState("")
  const [sessionReady, setSessionReady] = useState(false)
  const [hasSubmittedInitialDraft, setHasSubmittedInitialDraft] = useState(false)
  const [issuesByKey, setIssuesByKey] = useState<Record<string, SessionIssue>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [revisionInsights, setRevisionInsights] = useState("")
  const [revisionData, setRevisionData] = useState<RevisionData | null>(null)
  const [showInsightsModal, setShowInsightsModal] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const lastPersistedEssayRef = useRef("")

  const normalizeForMeaningfulChange = (value: string): string => {
    return value.replace(/\s+/g, " ").trim()
  }

  useEffect(() => {
    const id = getOrCreateSessionId()
    if (!id) return

    const bootstrapSession = async () => {
      try {
        await ensureSession(id)
        const initialLogged = await hasInitialDraftLog(id)
        setHasSubmittedInitialDraft(initialLogged)
        setSessionReady(true)
      } catch (error) {
        console.error("Session bootstrap failed:", error)
        setSessionReady(false)
      }
    }

    setSessionId(id)
    void bootstrapSession()
  }, [])

  const getHighlightColor = (effectiveness: string) => {
    switch (effectiveness) {
      case "Effective":
        return "bg-green-200 border-green-300"
      case "Adequate":
        return "bg-yellow-200 border-yellow-300"
      case "Ineffective":
        return "bg-red-200 border-red-300"
      default:
        return "bg-gray-200 border-gray-300"
    }
  }

  const handleEssayChange = (nextEssay: string) => {
    setEssay(nextEssay)
  }

  useEffect(() => {
    if (!sessionReady || !sessionId || !hasSubmittedInitialDraft) return
    if (isSubmitting) return
    if (!essay.trim()) return

    const normalizedEssay = normalizeForMeaningfulChange(essay)
    if (!normalizedEssay) return
    if (normalizedEssay === lastPersistedEssayRef.current) return

    const timer = setTimeout(() => {
      const settledNormalizedEssay = normalizeForMeaningfulChange(essay)
      if (!settledNormalizedEssay) return
      if (settledNormalizedEssay === lastPersistedEssayRef.current) return

      void (async () => {
        try {
          await Promise.all([
            logEvent({
              sessionId,
              eventType: "edit_detected",
              metadata: { source: "debounced_edit_tracking" },
            }),
            saveDraftSnapshot({
              sessionId,
              stage: "after_edit",
              draftText: essay,
            }),
          ])
          lastPersistedEssayRef.current = settledNormalizedEssay
        } catch (error) {
          console.error("Failed to persist debounced edit", error)
        }
      })()
    }, 1500)

    return () => clearTimeout(timer)
  }, [essay, sessionId, sessionReady, hasSubmittedInitialDraft, isSubmitting])

  const handleAnalyze = async () => {
    setAnalysisError(null)
    setIsAnalyzing(true)
    setIsPanelOpen(true)
    console.log("Analyze Essay clicked", {
      essayLength: essay.length,
      hasPrompt: Boolean(selectedPrompt),
      timestamp: new Date().toISOString(),
    })

    try {
      if (sessionReady && sessionId && !hasSubmittedInitialDraft) {
        void (async () => {
          try {
            await saveDraftSnapshot({
              sessionId,
              stage: "initial",
              draftText: essay,
            })
            await logEvent({
              sessionId,
              eventType: "initial_draft",
            })
            setHasSubmittedInitialDraft(true)
            lastPersistedEssayRef.current = normalizeForMeaningfulChange(essay)
          } catch (telemetryError) {
            console.error("Initial draft telemetry failed. Continuing analysis:", telemetryError)
          }
        })()
      }

      const argResult = await analyzeArgumentativeStructure(essay, selectedPrompt)
      setArgumentAnalysis(argResult)

      if (sessionReady && sessionId) {
        try {
          const mappedIssues = await replaceSessionIssues(sessionId, argResult)
          setIssuesByKey(mappedIssues)
        } catch (telemetryError) {
          console.error("Failed to persist analysis issues. Showing analysis anyway:", telemetryError)
        }
      }

      const newHighlights: Highlight[] = []

      Object.entries(argResult.elements).forEach(([key, element]) => {
        if (Array.isArray(element)) {
          element.forEach((el, index) => {
            if (el.text && el.text.trim()) {
              const start = essay.indexOf(el.text)
              if (start !== -1) {
                newHighlights.push({
                  id: `${key}-${index}`,
                  elementId: key,
                  start,
                  end: start + el.text.length,
                  text: el.text,
                  type: "argument",
                  subtype: key,
                  color: getHighlightColor(el.effectiveness),
                  feedback: el.feedback,
                  persistent: true,
                })
              }
            }
          })
        } else if (element.text && element.text.trim()) {
          const start = essay.indexOf(element.text)
          if (start !== -1) {
            newHighlights.push({
              id: key,
              elementId: key,
              start,
              end: start + element.text.length,
              text: element.text,
              type: "argument",
              subtype: key,
              color: getHighlightColor(element.effectiveness),
              feedback: element.feedback,
              persistent: true,
            })
          }
        }
      })

      setHighlights(newHighlights)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Analysis failed. Please try again."
      console.error("Analysis failed:", error)
      setAnalysisError(message)
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleCorrectionViewed = (params: {
    key: string
    elementType: ArgumentElementKey
    originalText: string
    correctedText: string
  }) => {
    if (!sessionReady || !sessionId) return

    const issue = issuesByKey[params.key]
    if (!issue) return

    void logEvent({
      sessionId,
      eventType: "corrected_viewed",
      issueId: issue.id,
      metadata: {
        element_type: params.elementType,
      },
    })
  }

  const handleSubmitSession = async () => {
    if (!sessionReady || !sessionId || !essay.trim()) return

    setIsSubmitting(true)

    try {
      await saveDraftSnapshot({ sessionId, stage: "final", draftText: essay })
      await markSessionSubmitted(sessionId)
      await logEvent({ sessionId, eventType: "final_submission" })

      const response = await fetch("/api/reflective-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      })

      if (!response.ok) {
        throw new Error("Failed to generate reflective summary")
      }

      const data = await response.json()
      setRevisionInsights(data.summary ?? "")
      setRevisionData(data.revisionData ?? null)
      setShowInsightsModal(true)
    } catch (error) {
      console.error(error)
      alert("Could not submit session. Please try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleHighlightClick = (highlight: Highlight) => {
    setIsPanelOpen(true)
    setSelectedElementId(highlight.elementId)
  }

  const handleHighlightText = (text: string, effectiveness?: string) => {
    setCurrentHighlight({ text, effectiveness: effectiveness ?? "" })
    setSelectedElementId(text)
  }

  const handleElementSelect = (elementId: string | null) => {
    setSelectedElementId(elementId)
  }

  const handleTabChange = (tab: string) => {
    setActiveTab(tab)
    if (tab === "argumentative") {
      setSelectedElementId(null)
      setActiveSubTab("")
    }
  }

  const handleSubTabChange = (subTab: string) => {
    setActiveSubTab(subTab)
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold">ReflectNote</h1>
            </div>

            <div className="flex items-center gap-3">
              <Button
                onClick={handleAnalyze}
                className="flex items-center gap-2"
              >
                <Sparkles className="h-4 w-4" />
                {isAnalyzing ? "Analyzing..." : "Analyze Essay"}
              </Button>

              <Button onClick={handleSubmitSession} disabled={!sessionReady || isSubmitting || !essay.trim()}>
                {isSubmitting ? "Submitting..." : "Finish Session"}
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="flex h-[calc(100vh-73px)]">
        <div
          className="flex-1 flex flex-col h-full p-4 space-y-4"
          style={{ width: isPanelOpen ? `calc(100% - ${panelWidth}px)` : "100%" }}
        >
          {analysisError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Analysis request failed</AlertTitle>
              <AlertDescription>{analysisError}</AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5" />
                Select Essay Prompt
              </CardTitle>
            </CardHeader>
            <CardContent>
              <PromptSelector onPromptSelect={setSelectedPrompt} selectedPrompt={selectedPrompt} />
            </CardContent>
          </Card>

          <EssayEditor
            essay={essay}
            onEssayChange={handleEssayChange}
            highlights={highlights}
            onHighlightClick={handleHighlightClick}
            selectedElementId={selectedElementId}
            activeTab={activeTab}
            activeSubTab={activeSubTab}
            currentHighlight={currentHighlight}
          />

        </div>

        <FeedbackPanel
          isOpen={isPanelOpen}
          onToggle={() => setIsPanelOpen(!isPanelOpen)}
          panelWidth={panelWidth}
          onPanelWidthChange={setPanelWidth}
          argumentAnalysis={argumentAnalysis}
          lexicalAnalysis={null}
          essay={essay}
          isAnalyzing={isAnalyzing}
          onHighlightText={handleHighlightText}
          onElementSelect={handleElementSelect}
          onTabChange={handleTabChange}
          onSubTabChange={handleSubTabChange}
          onCorrectionViewed={handleCorrectionViewed}
        />
      </div>

      <Dialog open={showInsightsModal} onOpenChange={setShowInsightsModal}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Revision Insights</DialogTitle>
          </DialogHeader>
          {revisionData && (
            <div className="text-sm text-muted-foreground space-y-1 mb-4">
              <p>Revisions made: {revisionData.totalEditsAfterAnalyze}</p>
              <p>
                Feedback levels: L1 {revisionData.feedbackLevelCounts.level1}, L2 {revisionData.feedbackLevelCounts.level2},
                L3 {revisionData.feedbackLevelCounts.level3}
              </p>
              <p>Revision window: {revisionData.revisionWindowMinutes} minutes</p>
            </div>
          )}

          <div className="whitespace-pre-wrap text-sm leading-relaxed">
            {revisionInsights}
          </div>
        </DialogContent>
      </Dialog>

      <Separator />
    </div>
  )
}

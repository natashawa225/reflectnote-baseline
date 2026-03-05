"use client"

import { PromptSelector } from "@/components/prompt-selector"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Separator } from "@/components/ui/separator"
import { EssayEditor } from "@/components/essay-editor"
import { FeedbackPanel } from "@/components/feedback-panel"
import type { FeedbackLevel } from "@/lib/interaction-logs-server"
import { getOrCreateSessionId } from "@/lib/deviceId"
import { analyzeArgumentativeStructure } from "@/lib/analysis"
import type { AnalysisResult, Highlight, ArgumentElementKey } from "@/lib/types"
import { Sparkles, BookOpen, AlertCircle, Send } from "lucide-react"
import ReactMarkdown from "react-markdown"
import rehypeRaw from "rehype-raw"

type InteractionEventType =
  | "initial_draft"
  | "analyze_clicked"
  | "suggestion_revealed"
  | "edit_detected"
  | "final_submission"

interface RevisionBehaviorData {
  totalEditsAfterAnalyze: number
  feedbackLevelCounts: {
    level1: number
    level2: number
    level3: number
  }
  revisionWindowMinutes: number
  thesisChangedSignificantly: boolean
  claimEvidenceStructureChanged: boolean
  mostRevisedSections: string[]
  firstDraftWordCount: number
  finalDraftWordCount: number
  firstToFinalWordDelta: number
  totalLogsAnalyzed: number
}

interface IssueRegistryRow {
  issueId: string
  initialText: string
}

function normalizeElementType(raw: string): string {
  const value = raw.trim().toLowerCase()
  if (value === "claims") return "claim"
  if (value === "evidences") return "evidence"
  if (value === "counterclaim" || value === "counterclaims") return "rebuttal"
  return value
}

export default function ArgumentativeWritingAssistant() {
  const [essay, setEssay] = useState("")
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [panelWidth, setPanelWidth] = useState(480)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [hasLoggedInitialDraft, setHasLoggedInitialDraft] = useState(false)

  
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
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessionReady, setSessionReady] = useState(false)
  const [hasSubmittedInitialDraft, setHasSubmittedInitialDraft] = useState(false)
  const [revisionInsights, setRevisionInsights] = useState<string>("")
  const [revisionData, setRevisionData] = useState<RevisionBehaviorData | null>(null)
  const [analyzeClickedAt, setAnalyzeClickedAt] = useState<string | null>(null)

  const [issueRegistry, setIssueRegistry] = useState<Record<string, IssueRegistryRow>>({})

  const editDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  
  const lastEditLoggedEssayRef = useRef("")

  const [showInsightsModal, setShowInsightsModal] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const lastPersistedEssayRef = useRef("")
  const [nowMs, setNowMs] = useState(Date.now())

  useEffect(() => {
    const id = getOrCreateSessionId()
    setSessionId(id)
  }, [])

  useEffect(() => {
    if (!sessionId) return

    void fetch("/api/session/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        condition: "baseline",
      }),
    }).catch((error) => {
      console.error("Failed to initialize session", error)
    })
  }, [sessionId])

  useEffect(() => {
    if (!analyzeClickedAt || isSubmitted) return

    const interval = setInterval(() => {
      setNowMs(Date.now())
    }, 1000)

    return () => clearInterval(interval)
  }, [analyzeClickedAt, isSubmitted])


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

  const logInteraction = useCallback(
    async ({
      eventType,
      issueId,
      feedbackLevel,
      metadata,
    }: {
      eventType: InteractionEventType
      issueId?: string | null
      feedbackLevel?: FeedbackLevel
      metadata?: Record<string, unknown>
    }) => {
      if (!sessionId) return

      try {
        const response = await fetch("/api/interaction-log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            issue_id: issueId ?? null,
            event_type: eventType,
            feedback_level: feedbackLevel ?? null,
            metadata: metadata ?? null,
          }),
        })
        if (!response.ok) {
          const failure = await response.json().catch(() => null)
          throw new Error(failure?.error || `Failed to log interaction (${response.status})`)
        }
      } catch (error) {
        console.error("Failed to log interaction", error)
        throw error
      }
    },
    [sessionId],
  )

  const insertDraftSnapshot = useCallback(
    async ({ stage, draftText, issueId }: { stage: string; draftText: string; issueId?: string | null }) => {
      if (!sessionId) return

      try {
        const response = await fetch("/api/draft-snapshot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            issue_id: issueId ?? null,
            stage,
            draft_text: draftText,
          }),
        })
        if (!response.ok) {
          const failure = await response.json().catch(() => null)
          throw new Error(failure?.error || `Failed to insert draft snapshot (${response.status})`)
        }
      } catch (error) {
        console.error("Failed to insert draft snapshot", error)
        throw error
      }
    },
    [sessionId],
  )

  useEffect(() => {
    if (!sessionId || !analyzeClickedAt || isSubmitted) return
    if (!essay.trim()) return
    if (essay === lastEditLoggedEssayRef.current) return

    if (editDebounceRef.current) {
      clearTimeout(editDebounceRef.current)
    }

    editDebounceRef.current = setTimeout(() => {
      void (async () => {
        try {
          await Promise.all([
            logInteraction({
              eventType: "edit_detected",
              metadata: { source: "debounced_edit_tracking" },
            }),
            insertDraftSnapshot({
              stage: "after_edit",
              draftText: essay,
            }),
          ])
          lastEditLoggedEssayRef.current = essay
        } catch (error) {
          console.error("Failed to persist debounced baseline edit logs", error)
        }
      })()
    }, 1500)

    return () => {
      if (editDebounceRef.current) {
        clearTimeout(editDebounceRef.current)
      }
    }
  }, [analyzeClickedAt, essay, insertDraftSnapshot, isSubmitted, logInteraction, sessionId])

  const handleAnalyze = async () => {
    if (!essay.trim() || isSubmitted) return

    setIsAnalyzing(true)
    setIsPanelOpen(true)

    try {
      if (!hasLoggedInitialDraft) {
        await Promise.all([
          logInteraction({
            eventType: "initial_draft",
            metadata: { source: "analyze_button_first_submission" },
          }),
          insertDraftSnapshot({
            stage: "initial",
            draftText: essay,
          }),
        ])
        setHasLoggedInitialDraft(true)
      }

      if (!analyzeClickedAt) {
        setAnalyzeClickedAt(new Date().toISOString())
      }

      await logInteraction({
        eventType: "analyze_clicked",
        metadata: { source: "analyze_button" },
      })

      lastEditLoggedEssayRef.current = essay

      const argResult = await analyzeArgumentativeStructure(essay, selectedPrompt)
      setArgumentAnalysis(argResult)

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

      if (sessionId && newHighlights.length > 0) {
        const issuesPayload = newHighlights.map((highlight, index) => ({
          client_key: highlight.id,
          element_type: normalizeElementType(highlight.subtype ?? highlight.elementId),
          issue_index: index + 1,
          initial_text: highlight.text,
          original_text: highlight.text,
        }))

        const response = await fetch("/api/issues", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            issues: issuesPayload,
          }),
        })

        if (response.ok) {
          const payload = (await response.json()) as {
            rows: Array<{ id: string; client_key: string; initial_text: string }>
          }

          const nextRegistry: Record<string, IssueRegistryRow> = {}
          payload.rows.forEach((row) => {
            nextRegistry[row.client_key] = {
              issueId: row.id,
              initialText: row.initial_text,
            }
          })

          setIssueRegistry(nextRegistry)
        }
      }
    } catch (error) {
      console.error("Analysis failed", error)
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleSubmit = async () => {
    if (!sessionId || !canSubmit || isSubmitting || isSubmitted) return

    setIsSubmitting(true)

    try {
      const response = await fetch("/api/finalize-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          final_essay_text: essay,
        }),
      })

      if (!response.ok) {
        const failure = await response.json().catch(() => null)
        throw new Error(failure?.error || "Submit failed")
      }

      const payload = await response.json()
      setRevisionInsights(payload.summary ?? "")
      setRevisionData((payload.revision_data as RevisionBehaviorData) ?? null)
      setIsSubmitted(true)
      setShowInsightsModal(true)
    } catch (error) {
      console.error("Final submission failed", error)
      alert(error instanceof Error ? error.message : "Failed to finalize session. Please try again.")
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

  const handleFeedbackEvent = useCallback(
    (payload: {
      eventType: "suggestion_revealed"
      feedbackLevel: 3
      issueClientKey: string
      metadata: {
        source: "show_correction"
        elementId: string
        elementType: string
        elementIndex: number | null
      }
    }) => {
      const issueId = issueRegistry[payload.issueClientKey]?.issueId
      if (!issueId) return

      void logInteraction({
        eventType: payload.eventType,
        issueId,
        feedbackLevel: payload.feedbackLevel,
        metadata: payload.metadata,
      })
    },
    [issueRegistry, logInteraction],
  )

  const wordCount = essay.trim().split(/\s+/).filter(Boolean).length
  const analyzeAtMs = analyzeClickedAt ? Date.parse(analyzeClickedAt) : null
  const submitUnlockAtMs = analyzeAtMs ? analyzeAtMs + 5 * 60 * 1000 : null

  const canSubmit = useMemo(() => {
    if (!submitUnlockAtMs || isSubmitted) return false
    return nowMs >= submitUnlockAtMs
  }, [submitUnlockAtMs, nowMs, isSubmitted])

  const remainingMs = submitUnlockAtMs ? Math.max(0, submitUnlockAtMs - nowMs) : 5 * 60 * 1000
  const remainingMinutes = Math.floor(remainingMs / 60000)
  const remainingSeconds = Math.floor((remainingMs % 60000) / 1000)

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold">Revisage Analytics</h1>
            </div>

            <div className="flex items-center gap-3">
              <Button
                onClick={handleAnalyze}
                className="flex items-center gap-2"
              >
                <Sparkles className="h-4 w-4" />
                {isAnalyzing ? "Analyzing..." : "Analyze Essay"}
              </Button>

              <Button
                onClick={handleSubmit}
                disabled={!canSubmit || isSubmitting || isSubmitted}
                className="flex items-center gap-2"
                variant="default"
              >
                <Send className="h-4 w-4" />
                {isSubmitting ? "Submitting..." : "Submit / Finish Session"}
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
          onFeedbackEvent={handleFeedbackEvent}
        />
      </div>

      <Dialog open={showInsightsModal} onOpenChange={setShowInsightsModal}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Revision Insights</DialogTitle>
          </DialogHeader>

          {revisionData && (
            <div className="text-sm text-muted-foreground space-y-1 mb-1">
              <p>Revisions made: {revisionData.totalEditsAfterAnalyze}</p>
              {/* <p>
                Feedback levels: L1 {revisionData.feedbackLevelCounts.level1}, L2 {revisionData.feedbackLevelCounts.level2},
                L3 {revisionData.feedbackLevelCounts.level3}
              </p> */}
              <p>Revision window: {revisionData.revisionWindowMinutes} minutes</p>
            </div>
          )}

          <div className="text-sm leading-relaxed space-y-2">
            <ReactMarkdown
              rehypePlugins={[rehypeRaw]}
              components={{
                h3: ({ node, ...props }) => <h3 className="text-lg font-semibold my-2" {...props} />,
                strong: ({ node, ...props }) => <strong className="font-semibold" {...props} />,
                li: ({ node, ...props }) => <li className="ml-5 list-disc" {...props} />,
                p: ({ node, ...props }) => <p className="mb-1" {...props} />,
              }}
            >
              {revisionInsights}
            </ReactMarkdown>
          </div>
        </DialogContent>
      </Dialog>

      <Separator />
    </div>
  )
}

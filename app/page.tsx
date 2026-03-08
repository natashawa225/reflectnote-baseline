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
import type { FeedbackLevel, SessionCondition } from "@/lib/interaction-logs-server"
import { getOrCreateSessionId } from "@/lib/deviceId"
import { analyzeArgumentativeStructure } from "@/lib/analysis"
import type { AnalysisResult, Highlight, ArgumentElementKey, ArgumentElement } from "@/lib/types"
import { Sparkles, BookOpen, AlertCircle, Send, FileDown } from "lucide-react"
import ReactMarkdown from "react-markdown"
import rehypeRaw from "rehype-raw"

type InteractionEventType =
  | "initial_draft"
  | "analyze_clicked"
  | "suggestion_revealed"
  | "edit_detected"
  | "final_submission"
  | "revision_insights_viewed"
  | "pdf_exported"
  | "revision_insights_read_time"

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
  initialText: string | null
}

function normalizeElementType(raw: string): string {
  const value = raw.trim().toLowerCase()
  if (value === "claims") return "claim"
  if (value === "evidence" || value === "evidences") return "evidence"
  if (value === "counterclaims") return "counterclaim"
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
  const initialDraftCaptureInFlightRef = useRef<Promise<boolean> | null>(null)
  
  const lastEditLoggedEssayRef = useRef("")

  const [showInsightsModal, setShowInsightsModal] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const lastPersistedEssayRef = useRef("")
  const [nowMs, setNowMs] = useState(Date.now())
  const [studentName, setStudentName] = useState("")
  const [studentId, setStudentId] = useState("")
  const [hasStartedSession, setHasStartedSession] = useState(false)
  const currentCondition: SessionCondition = "baseline"
  const [hasSubmittedInfo, setHasSubmittedInfo] = useState(false)
  const insightsOpenedAtRef = useRef<number | null>(null)


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
    }): Promise<boolean> => {
      if (!sessionId) return false

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
        return true
      } catch (error) {
        console.error("Failed to log interaction", error)
        return false
      }
    },
    [hasStartedSession, sessionId],
  )
    // PDF export function
   const handleExportPDF = () => {
      void logInteraction({
        eventType: "pdf_exported",
        metadata: {
          source: "revision_insights_modal",
        },
      })
      const printContent = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Revision Insights - ${studentName}</title>
            <style>
              body { font-family: Georgia, serif; max-width: 700px; margin: 40px auto; color: #1a1a1a; line-height: 1.6; }
              h1 { font-size: 1.5rem; border-bottom: 2px solid #333; padding-bottom: 8px; }
              .meta { color: #555; font-size: 0.9rem; margin-bottom: 24px; }
              h3 { font-size: 1.1rem; margin-top: 20px; }
              li { margin-left: 20px; margin-bottom: 4px; }
              p { margin-bottom: 8px; }
              .stats { background: #f5f5f5; padding: 12px; border-radius: 4px; margin-bottom: 16px; font-size: 0.9rem; }
            </style>
          </head>
          <body>
            <h1>Revision Insights</h1>
            <div class="meta">
              <strong>Name:</strong> ${studentName} &nbsp;|&nbsp;
              <strong>Student ID:</strong> ${studentId} &nbsp;|&nbsp;
              <strong>D ate:</strong> ${new Date().toLocaleDateString()}
            </div>
            ${revisionData ? `
            <div class="stats">
              <strong>Revisions made:</strong> ${revisionData.totalEditsAfterAnalyze} &nbsp;|&nbsp;
              <strong>Revision window:</strong> ${revisionData.revisionWindowMinutes} minutes
            </div>` : ""}
            <div>${revisionInsights
              .replace(/### (.+)/g, "<h3>$1</h3>")
              .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
              .replace(/\n- /g, "\n<li>")
              .replace(/\n/g, "<br>")
            }</div>
          </body>
        </html>
      `
  
      const printWindow = window.open("", "_blank")
      if (printWindow) {
        printWindow.document.write(printContent)
        printWindow.document.close()
        printWindow.focus()
        printWindow.print()
        printWindow.close()
      }
    }

  const insertDraftSnapshot = useCallback(
    async ({ stage, draftText, issueId }: { stage: string; draftText: string; issueId?: string | null }): Promise<boolean> => {
      if (!sessionId) return false

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
        return true
      } catch (error) {
        console.error("Failed to insert draft snapshot", error)
        return false
      }
    

      // try {
      //   const response = await fetch("/api/draft-snapshot", {
      //     method: "POST",
      //     headers: { "Content-Type": "application/json" },
      //     body: JSON.stringify({
      //       session_id: sessionId,
      //       issue_id: issueId ?? null,
      //       stage,
      //       draft_text: draftText,
      //     }),
      //   })
      //   if (!response.ok) {
      //     const failure = await response.json().catch(() => null)
      //     throw new Error(failure?.error || `Failed to insert draft snapshot (${response.status})`)
      //   }
      //   return true
      // } catch (error) {
      //   console.error("Failed to insert draft snapshot", error)
      //   return false
      // }
    },
    [hasStartedSession, sessionId],
  )

  const ensureInitialDraftCaptured = useCallback(
    async (source: string): Promise<boolean> => {
      if (!sessionId) return false
      const currentDraft = essay.trim()
      if (!currentDraft) return false
      if (hasLoggedInitialDraft) return true

      if (initialDraftCaptureInFlightRef.current) {
        return initialDraftCaptureInFlightRef.current
      }

      const capturePromise = (async () => {
        const [logOk, snapshotOk] = await Promise.all([
          logInteraction({
            eventType: "initial_draft",
            metadata: { source },
          }),
          insertDraftSnapshot({
            stage: "initial",
            draftText: currentDraft,
          }),
        ])
        const success = logOk && snapshotOk
        if (success) {
          setHasLoggedInitialDraft(true)
        } else {
          console.error("Initial draft capture did not complete successfully", { logOk, snapshotOk, source })
        }
        return success
      })()

      initialDraftCaptureInFlightRef.current = capturePromise
      const result = await capturePromise
      initialDraftCaptureInFlightRef.current = null
      return result
    },
    [essay, hasLoggedInitialDraft, hasStartedSession, insertDraftSnapshot, logInteraction, sessionId],
  )
  // useEffect(() => {
  //   if (!sessionId || !hasStartedSession || hasLoggedInitialDraft) return
  //   if (!essay.trim()) return

  //   void ensureInitialDraftCaptured("first_non_empty_draft")
  // }, [ensureInitialDraftCaptured, essay, hasLoggedInitialDraft, hasStartedSession, sessionId])

  useEffect(() => {
    if (!sessionId || !hasStartedSession || !analyzeClickedAt || isSubmitted) return
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
  }, [analyzeClickedAt, essay, hasStartedSession, insertDraftSnapshot, isSubmitted, logInteraction, sessionId])

  const startSessionIfNeeded = useCallback(async () => {
    if (!sessionId) throw new Error("Session ID is unavailable.")
    if (hasStartedSession) return

    const response = await fetch("/api/session/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        condition: currentCondition,
        student_name: studentName,
        student_id: studentId,
      }),
    })

    if (!response.ok) {
      const failure = await response.json().catch(() => null)
      throw new Error(failure?.error || "Failed to start session")
    }

    setHasStartedSession(true)
  }, [currentCondition, hasStartedSession, sessionId, studentId, studentName])

  const handleAnalyze = async () => {
    const firstDraftText = essay.trim()
    const trimmedStudentName = studentName.trim()
    const trimmedStudentId = studentId.trim()
    if (!firstDraftText || isSubmitted || !trimmedStudentName || !trimmedStudentId) return

    setIsAnalyzing(true)
    setIsPanelOpen(true)

    try {
      await startSessionIfNeeded()

      if (!analyzeClickedAt) {
        setAnalyzeClickedAt(new Date().toISOString())
      }

      await logInteraction({
        eventType: "analyze_clicked",
        metadata: { source: "analyze_button" },
      })

      lastEditLoggedEssayRef.current = essay

      if (!hasLoggedInitialDraft) {
        const captured = await ensureInitialDraftCaptured("analyze_button_first_submission")
        if (!captured) {
          console.warn("Initial draft snapshot could not be persisted (check Supabase config and network). Continuing with analysis.")
        }
      }

      const argResult = await analyzeArgumentativeStructure(firstDraftText, selectedPrompt)
      setArgumentAnalysis(argResult)

      const newHighlights: Highlight[] = []

      Object.entries(argResult.elements).forEach(([key, element]) => {
        const feedbackToText = (fb: unknown): string => {
          if (fb == null) return ""
          if (Array.isArray(fb)) {
            return fb
              .map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
              .join(" ")
              .trim()
          }
          if (typeof fb === "object") {
            try {
              return JSON.stringify(fb)
            } catch {
              return ""
            }
          }
          return String(fb)
        }

        if (Array.isArray(element)) {
          element.forEach((el, index) => {
            if (el.text && el.text.trim()) {
              const start = firstDraftText.indexOf(el.text)
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
                  feedback: feedbackToText(el.feedback),
                  persistent: true,
                })
              }
            }
          })
        } else if (element.text && element.text.trim()) {
          const start = firstDraftText.indexOf(element.text)
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
              feedback: feedbackToText(element.feedback),
              persistent: true,
            })
          }
        }
      })

      setHighlights(newHighlights)

      if (sessionId) {
        const issueCandidates: Array<{
          client_key: string
          element_type: string
          initial_text: string | null
          original_text: string | null
          suggested_correction: string | null
        }> = []

        const extractSuggestedCorrection = (
          element: (ArgumentElement & { suggested_correction?: string }) | null | undefined,
        ): string | null => {
          const raw =
            (element as (ArgumentElement & { suggested_correction?: string }) | null)?.suggested_correction ??
            element?.suggestion
          if (typeof raw !== "string") return null
          const trimmed = raw.trim()
          return trimmed ? trimmed : null
        }

        const pushIssueCandidate = (clientKey: string, elementType: string, element: ArgumentElement | undefined) => {
          const normalizedText = element?.text?.trim() ? element.text : null
          const suggestedCorrection = extractSuggestedCorrection(element)
          issueCandidates.push({
            client_key: clientKey,
            element_type: normalizeElementType(elementType),
            initial_text: normalizedText,
            original_text: normalizedText,
            suggested_correction: suggestedCorrection,
          })
        }

        // Use stable IDs that match ArgumentDiagram / ArgumentativeFeedback element IDs
        pushIssueCandidate("lead", "lead", argResult.elements.lead)
        pushIssueCandidate("position", "position", argResult.elements.position)

        argResult.elements.claims.slice(0, 2).forEach((claim, index) => {
          const explicitId = (claim.id ?? "").trim()
          const clientKey = explicitId || `claim-${index + 1}`
          pushIssueCandidate(clientKey, "claim", claim)
        })

        pushIssueCandidate("counterclaim", "counterclaim", argResult.elements.counterclaim)

        argResult.elements.evidence.slice(0, 2).forEach((evidence, index) => {
          const explicitId = (evidence.id ?? "").trim()
          const clientKey = explicitId || `evidence-${index + 1}`
          pushIssueCandidate(clientKey, "evidence", evidence)
        })

        pushIssueCandidate("rebuttal", "rebuttal", argResult.elements.rebuttal)
        pushIssueCandidate("counterclaim_evidence", "counterclaim_evidence", argResult.elements.counterclaim_evidence)
        pushIssueCandidate("rebuttal_evidence", "rebuttal_evidence", argResult.elements.rebuttal_evidence)
        pushIssueCandidate("conclusion", "conclusion", argResult.elements.conclusion)

        const issuesPayload = issueCandidates.map((issue, index) => ({
          ...issue,
          issue_index: index + 1,
        }))

        // const issuesPayload = newHighlights.map((highlight, index) => ({
        //   client_key: highlight.id,
        //   element_type: normalizeElementType(highlight.subtype ?? highlight.elementId),
        //   issue_index: index + 1,
        //   initial_text: highlight.text,
        //   original_text: highlight.text,
        // }))

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
            rows: Array<{ id: string; client_key: string; initial_text: string | null }>
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
    if (!sessionId || !hasStartedSession || !canSubmit || isSubmitting || isSubmitted) return

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
      insightsOpenedAtRef.current = Date.now()
      void logInteraction({
        eventType: "revision_insights_viewed",
        metadata: {
          source: "revision_insights_modal",
        },
      })
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
        source: "argument_element_click"
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
                disabled={isAnalyzing || wordCount < 200 || isSubmitted || !studentName.trim() || !studentId.trim()}
                className="flex items-center gap-2"
              >
                <Sparkles className="h-4 w-4" />
                {isAnalyzing ? "Analyzing..." : "Analyze Essay"}
              </Button>

              <Button
                onClick={handleSubmit}
                disabled={!canSubmit || isSubmitting || isSubmitted || !studentName.trim() || !studentId.trim()}
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
              <div className="flex items-center justify-between gap-4">
                <CardTitle className="flex items-center gap-2 shrink-0">
                  <BookOpen className="h-5 w-5" />
                  Select Essay Prompt
                </CardTitle>
                <div className="flex items-center gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-muted-foreground">
                      Full Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      className={`w-40 rounded-md border-2 bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${
                        !studentName.trim() ? "border-red-400" : "border-green-400"
                      }`}
                      
                      placeholder="Enter Your Name"
                      value={studentName}
                      onChange={(e) => setStudentName(e.target.value)}
                      disabled={isSubmitted}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-muted-foreground">
                      Student ID <span className="text-red-500">*</span>
                    </label>
                    <input
                      className={`w-45 rounded-md border-2 bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${
                        !studentId.trim() ? "border-red-400" : "border-green-400"
                      }`}
                      placeholder="Enter Your Student ID"
                      value={studentId}
                      onChange={(e) => setStudentId(e.target.value)}
                      disabled={isSubmitted}
                    />
                  </div>
                </div>
              </div>
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

      <Dialog
        open={showInsightsModal}
        onOpenChange={(open) => {
          if (!open && insightsOpenedAtRef.current) {
            const seconds = Math.round(
              (Date.now() - insightsOpenedAtRef.current) / 1000
            )

            void logInteraction({
              eventType: "revision_insights_read_time",
              metadata: { seconds_read: seconds },
            })
          }

          setShowInsightsModal(open)
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Revision Insights</DialogTitle>
          </DialogHeader>

          <div className="flex items-center justify-between text-sm text-muted-foreground mb-1">
            <span>{studentName} · {studentId}</span>
            <Button variant="outline" size="sm" onClick={handleExportPDF} className="flex items-center gap-1">
              <FileDown className="h-4 w-4" />
              Export PDF
            </Button>
          </div>

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

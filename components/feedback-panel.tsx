"use client"

import React from "react"

import { useState, useRef, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ChevronLeft, X, GripVertical, Eye, BookOpen } from "lucide-react"
import { ArgumentativeFeedback } from "./argumentative-feedback"
import { LexicalFeedback } from "./lexical-feedback"
import type { AnalysisResult, LexicalAnalysis } from "@/lib/types"

interface FeedbackPanelProps {
  isOpen: boolean
  onToggle: () => void
  panelWidth: number
  onPanelWidthChange: (width: number) => void
  argumentAnalysis: AnalysisResult | null
  lexicalAnalysis: LexicalAnalysis | null
  essay: string
  isAnalyzing: boolean
  onHighlightText: (text: string, effectiveness?: string) => void
  onElementSelect?: (elementId: string | null) => void
  onTabChange?: (tab: string) => void
  onSubTabChange?: (subTab: string) => void
}

export function FeedbackPanel({
  isOpen,
  onToggle,
  panelWidth,
  onPanelWidthChange,
  argumentAnalysis,
  lexicalAnalysis,
  essay,
  isAnalyzing,
  onHighlightText,
  onElementSelect,
  onTabChange,
  onSubTabChange,
}: FeedbackPanelProps) {
  const [activeTab, setActiveTab] = useState("argumentative")
  const [isResizing, setIsResizing] = useState(false)
  const resizeRef = useRef<HTMLDivElement>(null)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsResizing(true)
    e.preventDefault()
  }, [])

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return

      const newWidth = window.innerWidth - e.clientX
      const minWidth = 320
      const maxWidth = window.innerWidth * 0.7

      const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth))
      onPanelWidthChange(clampedWidth)
    },
    [isResizing, onPanelWidthChange],
  )

  const handleMouseUp = useCallback(() => {
    setIsResizing(false)
  }, [])

  React.useEffect(() => {
    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove)
      document.addEventListener("mouseup", handleMouseUp)
      document.body.style.cursor = "col-resize"
      document.body.style.userSelect = "none"
    } else {
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }
  }, [isResizing, handleMouseMove, handleMouseUp])

  const handleTabChange = (tab: string) => {
    setActiveTab(tab)
    onTabChange?.(tab)
  }

  return (
    <div className="relative h-full">
      <AnimatePresence>
        {!isOpen && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 48, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="h-full bg-muted border-l border-border flex flex-col items-center justify-center"
          >
            <Button variant="ghost" size="sm" onClick={onToggle} className="rotate-90 whitespace-nowrap">
              <ChevronLeft className="h-4 w-4 mr-1" />
              Feedback Panel
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: panelWidth, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={isResizing ? { duration: 0 } : { duration: 0.3, ease: "easeInOut" }}
            className="h-full bg-background border-l border-border relative"
            style={{ 
              width: panelWidth ,
              maxWidth: `calc(100vw - 320px)`,

            }}
          >
            <div
              ref={resizeRef}
              className="absolute left-0 top-0 w-1 h-full cursor-col-resize bg-border hover:bg-primary/20 transition-colors z-10 group"
              onMouseDown={handleMouseDown}
            >
              <div className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                <GripVertical className="h-4 w-4 text-muted-foreground" />
              </div>
            </div>

            {/* <div className="h-full flex flex-col"> */}
            <Card className="h-full rounded-none border-0 bg-transparent shadow-none">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between ">
                  <CardTitle className="text-lg">Feedback Panel</CardTitle>
                  <Button variant="ghost" size="sm" onClick={onToggle} className="h-8 w-8 p-0">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="flex-1 p-0 h-[calc(100%-80px)] overflow-hidden">
                <ArgumentativeFeedback
                  analysis={argumentAnalysis}
                  essay={essay}
                  isAnalyzing={isAnalyzing}
                  onHighlightText={onHighlightText}
                  onElementSelect={onElementSelect}
                />
              </CardContent>

              
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

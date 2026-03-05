"use client"

import type React from "react"
import { useState, useRef, useEffect, useCallback,useMemo } from "react"
import { Card } from "@/components/ui/card"
import type { Highlight } from "@/lib/types"

interface EssayEditorProps {
  essay: string
  onEssayChange: (essay: string) => void
  highlights: Highlight[]
  onHighlightClick?: (highlight: Highlight) => void
  selectedElementId?: string | null
  activeTab?: string
  activeSubTab?: string
  currentHighlight?: { text: string; effectiveness: string } | null
  isLocked?: boolean
}

export function EssayEditor({
  essay,
  onEssayChange,
  highlights,
  onHighlightClick,
  selectedElementId,
  activeTab = "argumentative",
  activeSubTab,
  currentHighlight,
  isLocked = false,
}: EssayEditorProps) {
  const textAreaRef = useRef<HTMLTextAreaElement>(null)
  const highlightRef = useRef<HTMLDivElement>(null)
  const [text, setText] = useState(essay)
  const [editingRanges, setEditingRanges] = useState<Array<{ start: number; end: number }>>([])
  const [persistentHighlight, setPersistentHighlight] = useState<{
        text: string
        effectiveness: string
        originalText: string
      } | null>(null)

  useEffect(() => {
    setText(essay)
  }, [essay])
  
  // Update persistent highlight when currentHighlight changes
  useEffect(() => {
    if (currentHighlight) {
      setPersistentHighlight({
        text: currentHighlight.text,
        effectiveness: currentHighlight.effectiveness,
        originalText: currentHighlight.text
      })
    } else {
      setPersistentHighlight(null)
    }
  }, [currentHighlight])

  // Clear highlight if the original text is no longer found in the essay (user edited it)
  useEffect(() => {
    if (persistentHighlight && !text.includes(persistentHighlight.originalText)) {
      setPersistentHighlight(null)
    }
  }, [text, persistentHighlight])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value
    const oldText = text

    if (newText !== oldText) {
      const cursorPos = e.target.selectionStart || 0

      const beforeCursor = newText.substring(0, cursorPos)
      const afterCursor = newText.substring(cursorPos)

      let sentenceStart = 0
      const sentenceStartMatch = beforeCursor.match(/[.!?]\s*[^.!?]*$/)
      if (sentenceStartMatch) {
        sentenceStart =
          beforeCursor.length -
          sentenceStartMatch[0].length +
          sentenceStartMatch[0].indexOf(sentenceStartMatch[0].match(/[^.!?]/)?.[0] || "")
      }

      let sentenceEnd = newText.length
      const sentenceEndMatch = afterCursor.match(/[.!?]/)
      if (sentenceEndMatch) {
        sentenceEnd = cursorPos + sentenceEndMatch.index! + 1
      }

      setEditingRanges([{ start: sentenceStart, end: sentenceEnd }])
    }

    setText(newText)
    onEssayChange(newText)
  }

  const getEffectivenessHighlightColor = (effectiveness: string) => {
    switch (effectiveness) {
      case "Effective":
        return "bg-green-200/60"
      case "Adequate":
        return "bg-yellow-200/60"
      case "Ineffective":
        return "bg-red-200/60"
      default:
        return "bg-gray-200/60"
    }
  }

  const handleScroll = () => {
    if (textAreaRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = textAreaRef.current.scrollTop
      highlightRef.current.scrollLeft = textAreaRef.current.scrollLeft
    }
  }

  const getDynamicHighlights = useCallback(() => {
    if (!highlights || highlights.length === 0 || !text) return []

    const dynamicHighlights: Highlight[] = []
    //Add persistent argumentative highlight if active
    if (activeTab === "argumentative" && persistentHighlight) {
      const searchText = persistentHighlight.text
      const regex = new RegExp(searchText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")
      let match
      while ((match = regex.exec(text)) !== null) {
        dynamicHighlights.push({
          id: `persistent-${selectedElementId || "none"}-${match.index}-${match[0].length}`,
          start: match.index,
          end: match.index + match[0].length,
          text: match[0],
          type: "argument",
          subtype: "persistent",
          color: getEffectivenessHighlightColor(persistentHighlight.effectiveness),
          feedback: `${persistentHighlight.effectiveness} element`,
          elementId: selectedElementId || "",
          word: "",
        })
      }
    }

      highlights.forEach((originalHighlight) => {
      if (!originalHighlight.text && !originalHighlight.word) return

      const isBeingEdited = editingRanges.some(
        (range) => originalHighlight.start < range.end && originalHighlight.end > range.start,
      )

      if (isBeingEdited) return

      if (activeTab === "argumentative" && originalHighlight.type === "argument") {
        if (selectedElementId && originalHighlight.elementId === selectedElementId) {
          const originalText = originalHighlight.text
          if (originalText) {
            const regex = new RegExp(originalText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")
            let match
            while ((match = regex.exec(text)) !== null) {
              dynamicHighlights.push({
                ...originalHighlight,
                start: match.index,
                end: match.index + match[0].length,
                text: match[0],
              })
            }
          }
        }
      } else if (activeTab === "lexical" && originalHighlight.type === "lexical") {
        if (
          activeSubTab === "academic-coverage" &&
          (originalHighlight.subtype === "awl" || originalHighlight.subtype === "afl")
        ) {
          const searchTerm = originalHighlight.word || originalHighlight.text
          if (searchTerm) {
            const regex = new RegExp(`\\b${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi")
            let match
            while ((match = regex.exec(text)) !== null) {
              dynamicHighlights.push({
                ...originalHighlight,
                start: match.index,
                end: match.index + match[0].length,
                text: match[0],
              })
            }
          }
        } else if (activeSubTab === "lexical-diversity" && originalHighlight.subtype === "repetitive") {
          const searchTerm = originalHighlight.word || originalHighlight.text
          if (searchTerm) {
            const regex = new RegExp(`\\b${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi")
            let match
            while ((match = regex.exec(text)) !== null) {
              dynamicHighlights.push({
                ...originalHighlight,
                start: match.index,
                end: match.index + match[0].length,
                text: match[0],
              })
            }
          }
        }
      }
    })

    return dynamicHighlights.sort((a, b) => a.start - b.start)
  }, [highlights, activeTab, activeSubTab, text, selectedElementId, editingRanges, persistentHighlight])

  const visibleHighlights = useMemo(() => getDynamicHighlights(), [getDynamicHighlights])

  useEffect(() => {
    if (!currentHighlight || !highlightRef.current || !textAreaRef.current) return
    if (visibleHighlights.length === 0) return

    const container = highlightRef.current
    const editor = textAreaRef.current

    requestAnimationFrame(() => {
      const target = container.querySelector<HTMLElement>('[data-persistent-highlight="true"]')
      if (!target) return

      const nextTop = Math.max(0, target.offsetTop - container.clientHeight * 0.35)
      container.scrollTop = nextTop
      editor.scrollTop = nextTop
    })
  }, [currentHighlight, visibleHighlights])

  const renderHighlightedText = () => {
    if (visibleHighlights.length === 0) return null

    const segments: Array<{
      start: number
      end: number
      text: string
      highlights: Highlight[]
    }> = []

    let currentPos = 0

    visibleHighlights.forEach((highlight) => {
      if (highlight.start > currentPos) {
        segments.push({
          start: currentPos,
          end: highlight.start,
          text: text.slice(currentPos, highlight.start),
          highlights: [],
        })
      }

      const segmentStart = Math.max(highlight.start, currentPos)
      const segmentEnd = highlight.end

      if (segmentEnd > segmentStart) {
        segments.push({
          start: segmentStart,
          end: segmentEnd,
          text: text.slice(segmentStart, segmentEnd),
          highlights: [highlight],
        })
        currentPos = Math.max(currentPos, segmentEnd)
      }
    })

    if (currentPos < text.length) {
      segments.push({
        start: currentPos,
        end: text.length,
        text: text.slice(currentPos),
        highlights: [],
      })
    }

    return segments.map((segment, index) => {
      if (segment.highlights.length === 0) {
        // Render transparent text to maintain spacing alignment
        return (
          <span
  key={`segment-${index}`}
  style={{
    color: "transparent",
    userSelect: "none",
    pointerEvents: "none",
  }}
>
  {segment.text}
</span>

        )
      }
    
      const highlight = segment.highlights[0]
      const isPersistent = highlight.id.startsWith("persistent-")
      return (
        <span
          key={`highlight-${index}-${segment.start}`}
          className={`${highlight.color} rounded`}
          data-persistent-highlight={isPersistent ? "true" : "false"}
          style={{
            color: "transparent",
            userSelect: "none",
            pointerEvents: "none",
          }}
        >
          {segment.text}
        </span>

      )
    })    
  }

  const getStatusText = () => {
    if (activeTab === "argumentative") {
      if (selectedElementId) {
        const selectedHighlights = highlights.filter((h) => h.type === "argument" && h.elementId === selectedElementId)
        return selectedHighlights.length > 0
          ? `Highlighting selected element (Green: Effective, Yellow: Adequate, Red: Ineffective)`
          : "Selected element has no highlights"
      }
      return "Select an element in the diagram to see highlights"
    } else if (activeTab === "lexical") {
      if (activeSubTab === "academic-coverage") {
        return "Showing AWL and AFL word highlights"
      } else if (activeSubTab === "lexical-diversity") {
        return "Showing repetitive word highlights"
      }
      return "Select a lexical analysis tab to see highlights"
    }
    return "No highlights active"
  }

  return (
    <Card className="h-full">
      <div className="p-6 h-full flex flex-col">
        <div className="mb-4">
          <h2 className="text-xl font-semibold">Essay Editor</h2>
          <p className="text-sm text-muted-foreground">
          Write a 200-300 word essay within 30-40 minutes on the given topic, and then revise it carefully
          </p>
        </div>

        <div className="relative flex-1">
          <div
            ref={highlightRef}
            className="absolute inset-0 w-full h-full p-4 border rounded-lg overflow-auto whitespace-pre-wrap break-words font-sans leading-relaxed"
            style={{
              pointerEvents: "none",
              color: "black",
              scrollbarWidth: "none",
              msOverflowStyle: "none",
            }}
          >
            {renderHighlightedText()}
          </div>

          <textarea
            ref={textAreaRef}
            value={text}
            onChange={handleChange}
            onScroll={handleScroll}
            readOnly={isLocked}
            disabled={isLocked}
            className="absolute inset-0 w-full h-full p-4 border rounded-lg resize-none overflow-auto focus:outline-none focus:ring-2 focus:ring-primary/20 font-sans leading-relaxed"
            style={{
              color: "black",
              caretColor: "black",
              background: "transparent",
              whiteSpace: "pre-wrap",
              overflowWrap: "break-word",
            }}
            placeholder={isLocked ? "Session submitted. Editing is disabled." : "Start writing your argumentative essay..."}
          />
        </div>

        <div className="mt-2 text-xs text-muted-foreground flex items-center justify-between">
          {/* <span>{getStatusText()}</span> */}
          <span>Active: {activeTab === "argumentative" ? "Visual Feedback" : "Lexical Feedback"}</span>
        </div>
      </div>
    </Card>
  )
}

// "use client"

// import type React from "react"
// import { useState, useRef, useEffect, useCallback } from "react"
// import { Card } from "@/components/ui/card"
// import type { Highlight } from "@/lib/types"

// interface EssayEditorProps {
//   essay: string
//   onEssayChange: (essay: string) => void
//   highlights: Highlight[]
//   onHighlightClick?: (highlight: Highlight) => void
//   selectedElementId?: string | null
//   activeTab?: string
//   activeSubTab?: string
//   currentHighlight?: { text: string; effectiveness: string } | null
// }

// export function EssayEditor({
//   essay,
//   onEssayChange,
//   highlights,
//   onHighlightClick,
//   selectedElementId,
//   activeTab = "argumentative",
//   activeSubTab,
//   currentHighlight,
// }: EssayEditorProps) {
//   const textAreaRef = useRef<HTMLTextAreaElement>(null)
//   const highlightRef = useRef<HTMLDivElement>(null)
//   const [text, setText] = useState(essay)
//   const [editingRanges, setEditingRanges] = useState<Array<{ start: number; end: number }>>([])
//   const [persistentHighlight, setPersistentHighlight] = useState<{
//         text: string
//         effectiveness: string
//         originalText: string
//       } | null>(null)

//   useEffect(() => {
//     setText(essay)
//   }, [essay])
  
//   // Update persistent highlight when currentHighlight changes
//   useEffect(() => {
//     if (currentHighlight) {
//       setPersistentHighlight({
//         text: currentHighlight.text,
//         effectiveness: currentHighlight.effectiveness,
//         originalText: currentHighlight.text
//       })
//     } else {
//       setPersistentHighlight(null)
//     }
//   }, [currentHighlight])

//   // Clear highlight if the original text is no longer found in the essay (user edited it)
//   useEffect(() => {
//     if (persistentHighlight && !text.includes(persistentHighlight.originalText)) {
//       setPersistentHighlight(null)
//     }
//   }, [text, persistentHighlight])

//   const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
//     const newText = e.target.value
//     const oldText = text

//     if (newText !== oldText) {
//       const cursorPos = e.target.selectionStart || 0

//       const beforeCursor = newText.substring(0, cursorPos)
//       const afterCursor = newText.substring(cursorPos)

//       let sentenceStart = 0
//       const sentenceStartMatch = beforeCursor.match(/[.!?]\s*[^.!?]*$/)
//       if (sentenceStartMatch) {
//         sentenceStart =
//           beforeCursor.length -
//           sentenceStartMatch[0].length +
//           sentenceStartMatch[0].indexOf(sentenceStartMatch[0].match(/[^.!?]/)?.[0] || "")
//       }

//       let sentenceEnd = newText.length
//       const sentenceEndMatch = afterCursor.match(/[.!?]/)
//       if (sentenceEndMatch) {
//         sentenceEnd = cursorPos + sentenceEndMatch.index! + 1
//       }

//       setEditingRanges([{ start: sentenceStart, end: sentenceEnd }])
//     }

//     setText(newText)
//     onEssayChange(newText)
//   }

//   const getEffectivenessHighlightColor = (effectiveness: string) => {
//     switch (effectiveness) {
//       case "Effective":
//         return "bg-green-200/60"
//       case "Adequate":
//         return "bg-yellow-200/60"
//       case "Ineffective":
//         return "bg-red-200/60"
//       default:
//         return "bg-gray-200/60"
//     }
//   }

//   const handleScroll = () => {
//     if (textAreaRef.current && highlightRef.current) {
//       highlightRef.current.scrollTop = textAreaRef.current.scrollTop
//       highlightRef.current.scrollLeft = textAreaRef.current.scrollLeft
//     }
//   }

//   const getDynamicHighlights = useCallback(() => {
//     if (!highlights || highlights.length === 0 || !text) return []

//     const dynamicHighlights: Highlight[] = []
//     //Add persistent argumentative highlight if active
//     if (activeTab === "argumentative" && persistentHighlight) {
//       const searchText = persistentHighlight.text
//       const regex = new RegExp(searchText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")
//       let match
//       while ((match = regex.exec(text)) !== null) {
//         dynamicHighlights.push({
//           id: `persistent-${selectedElementId || "none"}-${match.index}-${match[0].length}`,
//           start: match.index,
//           end: match.index + match[0].length,
//           text: match[0],
//           type: "argument",
//           subtype: "persistent",
//           color: getEffectivenessHighlightColor(persistentHighlight.effectiveness),
//           feedback: `${persistentHighlight.effectiveness} element`,
//           elementId: selectedElementId || "",
//           word: "",
//         })
//       }
//     }

//       highlights.forEach((originalHighlight) => {
//       if (!originalHighlight.text && !originalHighlight.word) return

//       const isBeingEdited = editingRanges.some(
//         (range) => originalHighlight.start < range.end && originalHighlight.end > range.start,
//       )

//       if (isBeingEdited) return

//       if (activeTab === "argumentative" && originalHighlight.type === "argument") {
//         if (selectedElementId && originalHighlight.elementId === selectedElementId) {
//           const originalText = originalHighlight.text
//           if (originalText) {
//             const regex = new RegExp(originalText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")
//             let match
//             while ((match = regex.exec(text)) !== null) {
//               dynamicHighlights.push({
//                 ...originalHighlight,
//                 start: match.index,
//                 end: match.index + match[0].length,
//                 text: match[0],
//               })
//             }
//           }
//         }
//       } else if (activeTab === "lexical" && originalHighlight.type === "lexical") {
//         if (
//           activeSubTab === "academic-coverage" &&
//           (originalHighlight.subtype === "awl" || originalHighlight.subtype === "afl")
//         ) {
//           const searchTerm = originalHighlight.word || originalHighlight.text
//           if (searchTerm) {
//             const regex = new RegExp(`\\b${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi")
//             let match
//             while ((match = regex.exec(text)) !== null) {
//               dynamicHighlights.push({
//                 ...originalHighlight,
//                 start: match.index,
//                 end: match.index + match[0].length,
//                 text: match[0],
//               })
//             }
//           }
//         } else if (activeSubTab === "lexical-diversity" && originalHighlight.subtype === "repetitive") {
//           const searchTerm = originalHighlight.word || originalHighlight.text
//           if (searchTerm) {
//             const regex = new RegExp(`\\b${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi")
//             let match
//             while ((match = regex.exec(text)) !== null) {
//               dynamicHighlights.push({
//                 ...originalHighlight,
//                 start: match.index,
//                 end: match.index + match[0].length,
//                 text: match[0],
//               })
//             }
//           }
//         }
//       }
//     })

//     return dynamicHighlights.sort((a, b) => a.start - b.start)
//   }, [highlights, activeTab, activeSubTab, text, selectedElementId, editingRanges, persistentHighlight])

//   const renderHighlightedText = () => {
//     const visibleHighlights = getDynamicHighlights()
//     if (visibleHighlights.length === 0) return null

//     const segments: Array<{
//       start: number
//       end: number
//       text: string
//       highlights: Highlight[]
//     }> = []

//     let currentPos = 0

//     visibleHighlights.forEach((highlight) => {
//       if (highlight.start > currentPos) {
//         segments.push({
//           start: currentPos,
//           end: highlight.start,
//           text: text.slice(currentPos, highlight.start),
//           highlights: [],
//         })
//       }

//       const segmentStart = Math.max(highlight.start, currentPos)
//       const segmentEnd = highlight.end

//       if (segmentEnd > segmentStart) {
//         segments.push({
//           start: segmentStart,
//           end: segmentEnd,
//           text: text.slice(segmentStart, segmentEnd),
//           highlights: [highlight],
//         })
//         currentPos = Math.max(currentPos, segmentEnd)
//       }
//     })

//     if (currentPos < text.length) {
//       segments.push({
//         start: currentPos,
//         end: text.length,
//         text: text.slice(currentPos),
//         highlights: [],
//       })
//     }

//     return segments.map((segment, index) => {
//       if (segment.highlights.length === 0) {
//         // Render invisible text so spacing aligns
//         return (
//           <span key={`segment-${index}`} style={{ visibility: "hidden" }}>
//           {segment.text}
//         </span>
//         )
//       }
    
//       const highlight = segment.highlights[0]
//       return (
//         <span
//           key={`highlight-${index}-${segment.start}`}
//           className={`px-1 py-0.5 rounded cursor-pointer transition-all hover:opacity-80 ${highlight.color}`}
//           onClick={(e) => {
//             e.stopPropagation()
//             onHighlightClick?.(highlight)
//           }}
//           title={highlight.feedback}
//         >
//           {segment.text}
//         </span>
//       )
//     })    
//   }

//   const getStatusText = () => {
//     if (activeTab === "argumentative") {
//       if (selectedElementId) {
//         const selectedHighlights = highlights.filter((h) => h.type === "argument" && h.elementId === selectedElementId)
//         return selectedHighlights.length > 0
//           ? `Highlighting selected element (Green: Effective, Yellow: Adequate, Red: Ineffective)`
//           : "Selected element has no highlights"
//       }
//       return "Select an element in the diagram to see highlights"
//     } else if (activeTab === "lexical") {
//       if (activeSubTab === "academic-coverage") {
//         return "Showing AWL and AFL word highlights"
//       } else if (activeSubTab === "lexical-diversity") {
//         return "Showing repetitive word highlights"
//       }
//       return "Select a lexical analysis tab to see highlights"
//     }
//     return "No highlights active"
//   }

//   return (
//     <Card className="h-full">
//       <div className="p-6 h-full flex flex-col">
//         <div className="mb-4">
//           <h2 className="text-xl font-semibold">Essay Editor</h2>
//           <p className="text-sm text-muted-foreground">
//             Edit your essay and receive feedback .
//           </p>
//         </div>

//         <div className="relative flex-1">
//           <div
//             ref={highlightRef}
//             className="absolute inset-0 w-full h-full p-4 border rounded-lg overflow-hidden leading-relaxed whitespace-pre-wrap font-sans leading-relaxed"
//             style={{
//               pointerEvents: persistentHighlight ? "auto" : "none", // ✅ toggle clickability
//             }}
//           >
//             {renderHighlightedText()}
//           </div>

//           <textarea
//             ref={textAreaRef}
//             value={text}
//             onChange={handleChange}
//             onScroll={handleScroll}
//             className="absolute inset-0 w-full h-full p-4 border rounded-lg resize-none bg-transparent text-transparent caret-black focus:outline-none focus:ring-2 focus:ring-primary/20 font-sans leading-relaxed"
//             style={{
//               // ✅ Replace text-transparent with this combo
//               color: "transparent",
//               textShadow: "0 0 0 black", // preserves spacing + caret
//               background: "transparent",
//             }}
//             placeholder="Start writing your argumentative essay..."
//           />
//         </div>

//         <div className="mt-2 text-xs text-muted-foreground flex items-center justify-between">
//           {/* <span>{getStatusText()}</span> */}
//           <span>Active: {activeTab === "argumentative" ? "Visual Feedback" : "Lexical Feedback"}</span>
//         </div>
//       </div>
//     </Card>
//   )
// }
// "use client"

// import type React from "react"
// import { useState, useRef, useEffect, useCallback } from "react"
// import { Card } from "@/components/ui/card"
// import type { Highlight } from "@/lib/types"

// interface EssayEditorProps {
//   essay: string
//   onEssayChange: (essay: string) => void
//   highlights: Highlight[]
//   onHighlightClick?: (highlight: Highlight) => void
//   selectedElementId?: string | null
//   activeTab?: string
//   activeSubTab?: string
//   currentHighlight?: { text: string; effectiveness: string } | null
// }

// export function EssayEditor({
//   essay,
//   onEssayChange,
//   highlights,
//   onHighlightClick,
//   selectedElementId,
//   activeTab = "argumentative",
//   activeSubTab,
//   currentHighlight,
// }: EssayEditorProps) {
//   const textAreaRef = useRef<HTMLTextAreaElement>(null)
//   const highlightRef = useRef<HTMLDivElement>(null)
//   const [text, setText] = useState(essay)
//   const [editingRanges, setEditingRanges] = useState<Array<{ start: number; end: number }>>([])
//   const [persistentHighlight, setPersistentHighlight] = useState<{
//         text: string
//         effectiveness: string
//         originalText: string
//       } | null>(null)

//   useEffect(() => {
//     setText(essay)
//   }, [essay])
//   // Update persistent highlight when currentHighlight changes
//   useEffect(() => {
//     if (currentHighlight) {
//       setPersistentHighlight({
//         text: currentHighlight.text,
//         effectiveness: currentHighlight.effectiveness,
//         originalText: currentHighlight.text
//       })
//     } else {
//       setPersistentHighlight(null)
//     }
//   }, [currentHighlight])

//   // Clear highlight if the original text is no longer found in the essay (user edited it)
//   useEffect(() => {
//     if (persistentHighlight && !text.includes(persistentHighlight.originalText)) {
//       setPersistentHighlight(null)
//     }
//   }, [text, persistentHighlight])

//   const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
//         const newText = e.target.value
//         setText(newText)
//         onEssayChange(newText)
//       }
    

//   const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
//     const newText = e.target.value
//     const oldText = text

//     if (newText !== oldText) {
//       const cursorPos = e.target.selectionStart || 0

//       const beforeCursor = newText.substring(0, cursorPos)
//       const afterCursor = newText.substring(cursorPos)

//       let sentenceStart = 0
//       const sentenceStartMatch = beforeCursor.match(/[.!?]\s*[^.!?]*$/)
//       if (sentenceStartMatch) {
//         sentenceStart =
//           beforeCursor.length -
//           sentenceStartMatch[0].length +
//           sentenceStartMatch[0].indexOf(sentenceStartMatch[0].match(/[^.!?]/)?.[0] || "")
//       }

//       let sentenceEnd = newText.length
//       const sentenceEndMatch = afterCursor.match(/[.!?]/)
//       if (sentenceEndMatch) {
//         sentenceEnd = cursorPos + sentenceEndMatch.index! + 1
//       }

//       setEditingRanges([{ start: sentenceStart, end: sentenceEnd }])
//     }

//     setText(newText)
//     onEssayChange(newText)
//   }

//   const getEffectivenessHighlightColor = (effectiveness: string) => {
//     switch (effectiveness) {
//       case "Effective":
//         return "bg-green-200/60"
//       case "Adequate":
//         return "bg-yellow-200/60"
//       case "Ineffective":
//         return "bg-red-200/60"
//       default:
//         return "bg-gray-200/60"
//     }
//   }

//   const handleScroll = () => {
//     if (textAreaRef.current && highlightRef.current) {
//       highlightRef.current.scrollTop = textAreaRef.current.scrollTop
//       highlightRef.current.scrollLeft = textAreaRef.current.scrollLeft
//     }
//   }

//   const getDynamicHighlights = useCallback(() => {
//     if (!highlights || highlights.length === 0 || !text) return []

//     const dynamicHighlights: Highlight[] = []
//     //Add persistent argumentative highlight if active
//     if (activeTab === "argumentative" && persistentHighlight) {
//       const searchText = persistentHighlight.text
//       const regex = new RegExp(searchText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")
//       let match
//       while ((match = regex.exec(text)) !== null) {
//         dynamicHighlights.push({
//           id: `persistent-${selectedElementId || "none"}-${match.index}-${match[0].length}`,
//           start: match.index,
//           end: match.index + match[0].length,
//           text: match[0],
//           type: "argument",
//           subtype: "persistent",
//           color: getEffectivenessHighlightColor(persistentHighlight.effectiveness),
//           feedback: `${persistentHighlight.effectiveness} element`,
//           elementId: selectedElementId || "",
//           word: "",
//         })
//       }
//     }

//       highlights.forEach((originalHighlight) => {
//       if (!originalHighlight.text && !originalHighlight.word) return

//       const isBeingEdited = editingRanges.some(
//         (range) => originalHighlight.start < range.end && originalHighlight.end > range.start,
//       )

//       if (isBeingEdited) return

//       if (activeTab === "argumentative" && originalHighlight.type === "argument") {
//         if (selectedElementId && originalHighlight.elementId === selectedElementId) {
//           const originalText = originalHighlight.text
//           if (originalText) {
//             const regex = new RegExp(originalText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")
//             let match
//             while ((match = regex.exec(text)) !== null) {
//               dynamicHighlights.push({
//                 ...originalHighlight,
//                 start: match.index,
//                 end: match.index + match[0].length,
//                 text: match[0],
//               })
//             }
//           }
//         }
//       } else if (activeTab === "lexical" && originalHighlight.type === "lexical") {
//         if (
//           activeSubTab === "academic-coverage" &&
//           (originalHighlight.subtype === "awl" || originalHighlight.subtype === "afl")
//         ) {
//           const searchTerm = originalHighlight.word || originalHighlight.text
//           if (searchTerm) {
//             const regex = new RegExp(`\\b${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi")
//             let match
//             while ((match = regex.exec(text)) !== null) {
//               dynamicHighlights.push({
//                 ...originalHighlight,
//                 start: match.index,
//                 end: match.index + match[0].length,
//                 text: match[0],
//               })
//             }
//           }
//         } else if (activeSubTab === "lexical-diversity" && originalHighlight.subtype === "repetitive") {
//           const searchTerm = originalHighlight.word || originalHighlight.text
//           if (searchTerm) {
//             const regex = new RegExp(`\\b${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi")
//             let match
//             while ((match = regex.exec(text)) !== null) {
//               dynamicHighlights.push({
//                 ...originalHighlight,
//                 start: match.index,
//                 end: match.index + match[0].length,
//                 text: match[0],
//               })
//             }
//           }
//         }
//       }
//     })

//     return dynamicHighlights.sort((a, b) => a.start - b.start)
//   }, [highlights, activeTab, activeSubTab, text, selectedElementId, editingRanges])

//   const renderHighlightedText = () => {
//     const visibleHighlights = getDynamicHighlights()

//     if (visibleHighlights.length === 0) {
//       return text
//     }

//     const segments: Array<{
//       start: number
//       end: number
//       text: string
//       highlights: Highlight[]
//     }> = []

//     let currentPos = 0

//     visibleHighlights.forEach((highlight) => {
//       if (highlight.start > currentPos) {
//         segments.push({
//           start: currentPos,
//           end: highlight.start,
//           text: text.slice(currentPos, highlight.start),
//           highlights: [],
//         })
//       }

//       const segmentStart = Math.max(highlight.start, currentPos)
//       const segmentEnd = highlight.end

//       if (segmentEnd > segmentStart) {
//         segments.push({
//           start: segmentStart,
//           end: segmentEnd,
//           text: text.slice(segmentStart, segmentEnd),
//           highlights: [highlight],
//         })
//         currentPos = Math.max(currentPos, segmentEnd)
//       }
//     })

//     if (currentPos < text.length) {
//       segments.push({
//         start: currentPos,
//         end: text.length,
//         text: text.slice(currentPos),
//         highlights: [],
//       })
//     }

//     return segments.map((segment, index) => {
//       if (segment.highlights.length === 0) {
//         return segment.text
//       }

//       const highlight = segment.highlights[0]
//       return (
//         <span
//           key={`highlight-${index}-${segment.start}`}
//           className={`px-1 py-0.5 rounded cursor-pointer transition-all hover:opacity-80 ${highlight.color}`}
//           onClick={(e) => {
//             e.stopPropagation()
//             onHighlightClick?.(highlight)
//           }}
//           title={highlight.feedback}
//           data-highlight-type={highlight.type}
//           data-highlight-subtype={highlight.subtype}
//         >
//           {segment.text}
//         </span>
//       )
//     })
//   }

//   const getStatusText = () => {
//     if (activeTab === "argumentative") {
//       if (selectedElementId) {
//         const selectedHighlights = highlights.filter((h) => h.type === "argument" && h.elementId === selectedElementId)
//         return selectedHighlights.length > 0
//           ? `Highlighting selected element (Green: Effective, Yellow: Adequate, Red: Ineffective)`
//           : "Selected element has no highlights"
//       }
//       return "Select an element in the diagram to see highlights"
//     } else if (activeTab === "lexical") {
//       if (activeSubTab === "academic-coverage") {
//         return "Showing AWL and AFL word highlights"
//       } else if (activeSubTab === "lexical-diversity") {
//         return "Showing repetitive word highlights"
//       }
//       return "Select a lexical analysis tab to see highlights"
//     }
//     return "No highlights active"
//   }

//   return (
//     <Card className="h-full">
//       <div className="p-6 h-full flex flex-col">
//         <div className="mb-4">
//           <h2 className="text-xl font-semibold">Essay Editor</h2>
//           <p className="text-sm text-muted-foreground">
//             Edit your essay with selective highlighting. Select elements in the diagram to highlight associated
//             sentences. Highlights disappear when you edit the sentence.
//           </p>
//         </div>

//         <div className="relative flex-1">
//           <div
//             ref={highlightRef}
//             className="absolute inset-0 w-full h-full p-4 border rounded-lg overflow-hidden leading-relaxed whitespace-pre-wrap font-sans"
//             style={{ pointerEvents: "none" }}
//           >
//             {renderHighlightedText()}
//           </div>

//           <textarea
//             ref={textAreaRef}
//             value={text}
//             onChange={handleChange}
//             onScroll={handleScroll}
//             className="absolute inset-0 w-full h-full p-4 border rounded-lg resize-none bg-transparent text-transparent caret-black focus:outline-none focus:ring-2 focus:ring-primary/20 font-sans leading-relaxed"
//             style={{ color: "transparent", background: "transparent" }}
//             placeholder="Start writing your argumentative essay..."
//           />
//         </div>

//         <div className="mt-2 text-xs text-muted-foreground flex items-center justify-between">
//           {/* <span>{getStatusText()}</span> */}
//           <span>Active: {activeTab === "argumentative" ? "Visual Feedback" : "Lexical Feedback"}</span>
//         </div>
//       </div>
//     </Card>
//   )
// }


// "use client"

// import type React from "react"
// import { useState, useRef, useEffect, useCallback } from "react"
// import { Card } from "@/components/ui/card"
// import type { Highlight } from "@/lib/types"

// interface EssayEditorProps {
//   essay: string
//   onEssayChange: (essay: string) => void
//   highlights: Highlight[]
//   onHighlightClick?: (highlight: Highlight) => void
//   selectedElementId?: string | null
//   activeTab?: string
//   activeSubTab?: string
//   currentHighlight?: { text: string; effectiveness: string } | null
// }

// export function EssayEditor({
//   essay,
//   onEssayChange,
//   highlights,
//   onHighlightClick,
//   selectedElementId,
//   activeTab = "argumentative",
//   activeSubTab,
//   currentHighlight,
// }: EssayEditorProps) {
//   const textAreaRef = useRef<HTMLTextAreaElement>(null)
//   const highlightRef = useRef<HTMLDivElement>(null)
//   const [text, setText] = useState(essay)
//   const [persistentHighlight, setPersistentHighlight] = useState<{
//     text: string
//     effectiveness: string
//     originalText: string
//   } | null>(null)

//   useEffect(() => {
//     setText(essay)
//   }, [essay])

//   // Update persistent highlight when currentHighlight changes
//   useEffect(() => {
//     if (currentHighlight) {
//       setPersistentHighlight({
//         text: currentHighlight.text,
//         effectiveness: currentHighlight.effectiveness,
//         originalText: currentHighlight.text
//       })
//     } else {
//       setPersistentHighlight(null)
//     }
//   }, [currentHighlight])

//   // Clear highlight if the original text is no longer found in the essay (user edited it)
//   useEffect(() => {
//     if (persistentHighlight && !text.includes(persistentHighlight.originalText)) {
//       setPersistentHighlight(null)
//     }
//   }, [text, persistentHighlight])

//   const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
//     const newText = e.target.value
//     setText(newText)
//     onEssayChange(newText)
//   }

//   const handleScroll = () => {
//     if (textAreaRef.current && highlightRef.current) {
//       highlightRef.current.scrollTop = textAreaRef.current.scrollTop
//       highlightRef.current.scrollLeft = textAreaRef.current.scrollLeft
//     }
//   }

//   const getEffectivenessHighlightColor = (effectiveness: string) => {
//     switch (effectiveness) {
//       case "Effective":
//         return "bg-green-200/60"
//       case "Adequate":
//         return "bg-yellow-200/60"
//       case "Ineffective":
//         return "bg-red-200/60"
//       default:
//         return "bg-gray-200/60"
//     }
//   }

//   const getDynamicHighlights = useCallback(() => {
//     const dynamicHighlights: Highlight[] = []

//     // Add persistent argumentative highlight if active
//     if (activeTab === "argumentative" && persistentHighlight) {
//       const searchText = persistentHighlight.text
//       const regex = new RegExp(searchText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")
//       let match
//       while ((match = regex.exec(text)) !== null) {
//         dynamicHighlights.push({
//           id: `persistent-${selectedElementId || "none"}-${match.index}-${match[0].length}`,
//           start: match.index,
//           end: match.index + match[0].length,
//           text: match[0],
//           type: "argument",
//           subtype: "persistent",
//           color: getEffectivenessHighlightColor(persistentHighlight.effectiveness),
//           feedback: `${persistentHighlight.effectiveness} element`,
//           elementId: selectedElementId || "",
//           word: "",
//         })
//       }
//     }

//     // Add lexical highlights if lexical tab is active
//     if (activeTab === "lexical" && highlights && highlights.length > 0) {
//       highlights.forEach((originalHighlight) => {
//         if (!originalHighlight.text && !originalHighlight.word) return

//         if (originalHighlight.type === "lexical") {
//           if (
//             activeSubTab === "academic-coverage" &&
//             (originalHighlight.subtype === "awl" || originalHighlight.subtype === "afl")
//           ) {
//             const searchTerm = originalHighlight.word || originalHighlight.text
//             if (searchTerm) {
//               const regex = new RegExp(`\\b${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi")
//               let match
//               while ((match = regex.exec(text)) !== null) {
//                 dynamicHighlights.push({
//                   ...originalHighlight,
//                   start: match.index,
//                   end: match.index + match[0].length,
//                   text: match[0],
//                 })
//               }
//             }
//           } else if (activeSubTab === "lexical-diversity" && originalHighlight.subtype === "repetitive") {
//             const searchTerm = originalHighlight.word || originalHighlight.text
//             if (searchTerm) {
//               const regex = new RegExp(`\\b${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi")
//               let match
//               while ((match = regex.exec(text)) !== null) {
//                 dynamicHighlights.push({
//                   ...originalHighlight,
//                   start: match.index,
//                   end: match.index + match[0].length,
//                   text: match[0],
//                 })
//               }
//             }
//           }
//         }
//       })
//     }

//     return dynamicHighlights.sort((a, b) => a.start - b.start)
//   }, [highlights, activeTab, activeSubTab, selectedElementId, text, persistentHighlight])

//   const renderHighlightedText = () => {
//     const visibleHighlights = getDynamicHighlights()

//     if (visibleHighlights.length === 0) {
//       return text
//     }

//     // Handle overlapping highlights by creating segments
//     const segments: Array<{
//       start: number
//       end: number
//       text: string
//       highlights: Highlight[]
//     }> = []

//     let currentPos = 0

//     visibleHighlights.forEach((highlight) => {
//       // Add text before highlight if any
//       if (highlight.start > currentPos) {
//         segments.push({
//           start: currentPos,
//           end: highlight.start,
//           text: text.slice(currentPos, highlight.start),
//           highlights: [],
//         })
//       }

//       // Add highlighted segment
//       const segmentStart = Math.max(highlight.start, currentPos)
//       const segmentEnd = highlight.end

//       if (segmentEnd > segmentStart) {
//         segments.push({
//           start: segmentStart,
//           end: segmentEnd,
//           text: text.slice(segmentStart, segmentEnd),
//           highlights: [highlight],
//         })
//         currentPos = Math.max(currentPos, segmentEnd)
//       }
//     })

//     // Add remaining text
//     if (currentPos < text.length) {
//       segments.push({
//         start: currentPos,
//         end: text.length,
//         text: text.slice(currentPos),
//         highlights: [],
//       })
//     }

//     return segments.map((segment, index) => {
//       if (segment.highlights.length === 0) {
//         return segment.text
//       }

//       const highlight = segment.highlights[0]
//       return (
//         <span
//           key={`highlight-${index}-${segment.start}`}
//           className={`px-1 py-0.5 rounded cursor-pointer transition-all hover:opacity-80 ${highlight.color}`}
//           onClick={(e) => {
//             e.stopPropagation()
//             onHighlightClick?.(highlight)
//           }}
//           title={highlight.feedback}
//           data-highlight-type={highlight.type}
//           data-highlight-subtype={highlight.subtype}
//         >
//           {segment.text}
//         </span>
//       )
//     })
//   }

//   const getStatusText = () => {
//     if (activeTab === "argumentative") {
//       if (persistentHighlight) {
//         return `Highlighting: ${persistentHighlight.effectiveness} element (will clear when edited)`
//       }
//       return selectedElementId
//         ? `Selected: ${selectedElementId} (click to highlight)`
//         : "Click diagram elements to highlight sentences"
//     } else if (activeTab === "lexical") {
//       if (activeSubTab === "academic-coverage") {
//         return "Showing AWL and AFL word highlights"
//       } else if (activeSubTab === "lexical-diversity") {
//         return "Showing repetitive word highlights"
//       }
//       return "Select a lexical analysis tab to see highlights"
//     }
//     return "No highlights active"
//   }

//   return (
//     <Card className="h-full">
//       <div className="p-6 h-full flex flex-col">
//         <div className="mb-4">
//           <h2 className="text-xl font-semibold">Essay Editor</h2>
//           <p className="text-sm text-muted-foreground">
//             Edit your essay with selective highlighting. Highlights show based on your analysis selection.
//           </p>
//         </div>

//         <div className="relative flex-1">
//           {/* Highlight layer */}
//           <div
//             ref={highlightRef}
//             className="absolute inset-0 w-full h-full p-4 border rounded-lg overflow-hidden leading-relaxed whitespace-pre-wrap font-sans"
//             style={{ pointerEvents: "none" }}
//           >
//             {renderHighlightedText()}
//           </div>

//           {/* Transparent textarea */}
//           <textarea
//             ref={textAreaRef}
//             value={text}
//             onChange={handleChange}
//             onScroll={handleScroll}
//             className="absolute inset-0 w-full h-full p-4 border rounded-lg resize-none bg-transparent text-transparent caret-black focus:outline-none focus:ring-2 focus:ring-primary/20 font-sans leading-relaxed"
//             style={{ color: "transparent", background: "transparent" }}
//             placeholder="Start writing your argumentative essay..."
//           />
//         </div>

//         <div className="mt-2 text-xs text-muted-foreground flex items-center justify-between">
//           {/* <span>{getStatusText()}</span> */}
//           <span>Active: {activeTab === "argumentative" ? "Visual Feedback" : "Lexical Feedback"}</span>
//         </div>
//       </div>
//     </Card>
//   )
// }
// "use client"

// import type React from "react"
// import { useState, useRef, useEffect, useCallback } from "react"
// import { Card } from "@/components/ui/card"
// import type { Highlight } from "@/lib/types"

// interface EssayEditorProps {
//   essay: string
//   onEssayChange: (essay: string) => void
//   highlights: Highlight[]
//   onHighlightClick?: (highlight: Highlight) => void
//   selectedElementId?: string | null
//   activeTab?: string
//   activeSubTab?: string
// }

// export function EssayEditor({
//   essay,
//   onEssayChange,
//   highlights,
//   onHighlightClick,
//   selectedElementId,
//   activeTab = "argumentative",
//   activeSubTab,
// }: EssayEditorProps) {
//   const textAreaRef = useRef<HTMLTextAreaElement>(null)
//   const highlightRef = useRef<HTMLDivElement>(null)
//   const [text, setText] = useState(essay)

//   useEffect(() => {
//     setText(essay)
//   }, [essay])

//   const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
//     const newText = e.target.value
//     setText(newText)
//     onEssayChange(newText)
//   }

//   const handleScroll = () => {
//     if (textAreaRef.current && highlightRef.current) {
//       highlightRef.current.scrollTop = textAreaRef.current.scrollTop
//       highlightRef.current.scrollLeft = textAreaRef.current.scrollLeft
//     }
//   }

//   const getDynamicHighlights = useCallback(() => {
//     if (!highlights || highlights.length === 0 || !text) return []

//     const dynamicHighlights: Highlight[] = []

//     highlights.forEach((originalHighlight) => {
//       if (!originalHighlight.text && !originalHighlight.word) return

//       if (activeTab === "argumentative" && originalHighlight.type === "argument") {
//         // Only show argument highlights when a specific element is selected
//         if (selectedElementId && originalHighlight.elementId === selectedElementId) {
//           // For argumentative highlights, try to find the sentence in current text
//           const originalText = originalHighlight.text
//           if (originalText) {
//             const regex = new RegExp(originalText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")
//             let match
//             while ((match = regex.exec(text)) !== null) {
//               dynamicHighlights.push({
//                 ...originalHighlight,
//                 start: match.index,
//                 end: match.index + match[0].length,
//                 text: match[0],
//               })
//             }
//           }
//         }
//       } else if (activeTab === "lexical" && originalHighlight.type === "lexical") {
//         if (
//           activeSubTab === "academic-coverage" &&
//           (originalHighlight.subtype === "awl" || originalHighlight.subtype === "afl")
//         ) {
//           const searchTerm = originalHighlight.word || originalHighlight.text
//           if (searchTerm) {
//             const regex = new RegExp(`\\b${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi")
//             let match
//             while ((match = regex.exec(text)) !== null) {
//               dynamicHighlights.push({
//                 ...originalHighlight,
//                 start: match.index,
//                 end: match.index + match[0].length,
//                 text: match[0],
//               })
//             }
//           }
//         } else if (activeSubTab === "lexical-diversity" && originalHighlight.subtype === "repetitive") {
//           const searchTerm = originalHighlight.word || originalHighlight.text
//           if (searchTerm) {
//             const regex = new RegExp(`\\b${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi")
//             let match
//             while ((match = regex.exec(text)) !== null) {
//               dynamicHighlights.push({
//                 ...originalHighlight,
//                 start: match.index,
//                 end: match.index + match[0].length,
//                 text: match[0],
//               })
//             }
//           }
//         }
//       }
//     })

//     return dynamicHighlights.sort((a, b) => a.start - b.start)
//   }, [highlights, activeTab, activeSubTab, selectedElementId, text])

//   const renderHighlightedText = () => {
//     const visibleHighlights = getDynamicHighlights()

//     if (visibleHighlights.length === 0) {
//       return text
//     }

//     // Handle overlapping highlights by creating segments
//     const segments: Array<{
//       start: number
//       end: number
//       text: string
//       highlights: Highlight[]
//     }> = []

//     let currentPos = 0

//     visibleHighlights.forEach((highlight) => {
//       // Add text before highlight if any
//       if (highlight.start > currentPos) {
//         segments.push({
//           start: currentPos,
//           end: highlight.start,
//           text: text.slice(currentPos, highlight.start),
//           highlights: [],
//         })
//       }

//       // Add highlighted segment
//       const segmentStart = Math.max(highlight.start, currentPos)
//       const segmentEnd = highlight.end

//       if (segmentEnd > segmentStart) {
//         segments.push({
//           start: segmentStart,
//           end: segmentEnd,
//           text: text.slice(segmentStart, segmentEnd),
//           highlights: [highlight],
//         })
//         currentPos = Math.max(currentPos, segmentEnd)
//       }
//     })

//     // Add remaining text
//     if (currentPos < text.length) {
//       segments.push({
//         start: currentPos,
//         end: text.length,
//         text: text.slice(currentPos),
//         highlights: [],
//       })
//     }

//     return segments.map((segment, index) => {
//       if (segment.highlights.length === 0) {
//         return segment.text
//       }

//       const highlight = segment.highlights[0]
//       return (
//         <span
//           key={`highlight-${index}-${segment.start}`}
//           className={`px-1 py-0.5 rounded cursor-pointer transition-all hover:opacity-80 ${highlight.color}`}
//           onClick={(e) => {
//             e.stopPropagation()
//             onHighlightClick?.(highlight)
//           }}
//           title={highlight.feedback}
//           data-highlight-type={highlight.type}
//           data-highlight-subtype={highlight.subtype}
//         >
//           {segment.text}
//         </span>
//       )
//     })
//   }

//   const getStatusText = () => {
//     if (activeTab === "argumentative") {
//       return selectedElementId
//         ? `Showing highlights for: ${selectedElementId}`
//         : "Click diagram elements to highlight sentences"
//     } else if (activeTab === "lexical") {
//       if (activeSubTab === "academic-coverage") {
//         return "Showing AWL and AFL word highlights"
//       } else if (activeSubTab === "lexical-diversity") {
//         return "Showing repetitive word highlights"
//       }
//       return "Select a lexical analysis tab to see highlights"
//     }
//     return "No highlights active"
//   }

//   return (
//     <Card className="h-full">
//       <div className="p-6 h-full flex flex-col">
//         <div className="mb-4">
//           <h2 className="text-xl font-semibold">Essay Editor</h2>
//           <p className="text-sm text-muted-foreground">
//             Edit your essay with selective highlighting. Highlights show based on your analysis selection.
//           </p>
//         </div>

//         <div className="relative flex-1">
//           {/* Highlight layer */}
//           <div
//             ref={highlightRef}
//             className="absolute inset-0 w-full h-full p-4 border rounded-lg overflow-hidden leading-relaxed whitespace-pre-wrap font-sans"
//             style={{ pointerEvents: "none" }}
//           >
//             {renderHighlightedText()}
//           </div>

//           {/* Transparent textarea */}
//           <textarea
//             ref={textAreaRef}
//             value={text}
//             onChange={handleChange}
//             onScroll={handleScroll}
//             className="absolute inset-0 w-full h-full p-4 border rounded-lg resize-none bg-transparent text-transparent caret-black focus:outline-none focus:ring-2 focus:ring-primary/20 font-sans leading-relaxed"
//             style={{ color: "transparent", background: "transparent" }}
//             placeholder="Start writing your argumentative essay..."
//           />
//         </div>

//         <div className="mt-2 text-xs text-muted-foreground flex items-center justify-between">
//           <span>{getStatusText()}</span>
//           <span>Active: {activeTab === "argumentative" ? "Visual Feedback" : "Lexical Feedback"}</span>
//         </div>
//       </div>
//     </Card>
//   )
// }

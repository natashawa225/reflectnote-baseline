"use client"
import { PromptSelector } from "@/components/prompt-selector"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getDeviceId } from "@/lib/deviceId"
import { Separator } from "@/components/ui/separator"
import { EssayEditor } from "@/components/essay-editor"
import { FeedbackPanel } from "@/components/feedback-panel"
import { analyzeArgumentativeStructure, analyzeLexicalFeatures } from "@/lib/analysis"
import { EssayStorage, type SavedEssay } from "@/lib/storage"
import { EssayListModal } from "@/components/essay-list-modal"
import type { AnalysisResult, LexicalAnalysis, Highlight } from "@/lib/types"
import { Sparkles, Save, Brain, BookOpen, FolderOpen } from "lucide-react"

// const SAMPLE_ESSAY = `Technology has fundamentally transformed the way we communicate, work, and live our daily lives. While some argue that this digital revolution has created more problems than solutions, I firmly believe that technology has been overwhelmingly beneficial to society and continues to drive human progress forward.

// The most compelling evidence for technology's positive impact lies in its ability to connect people across vast distances. Social media platforms, video conferencing, and instant messaging have eliminated geographical barriers, allowing families to stay connected, businesses to operate globally, and students to access educational resources from anywhere in the world. During the COVID-19 pandemic, these technologies proved essential for maintaining social connections and economic stability.

// Furthermore, technological advances in healthcare have saved countless lives and improved quality of life for millions. Medical imaging, robotic surgery, and telemedicine have revolutionized patient care, while pharmaceutical research powered by artificial intelligence has accelerated drug discovery processes that once took decades.

// Critics argue that technology has created social isolation and mental health issues, particularly among young people. They point to increased rates of anxiety and depression correlating with social media usage and screen time. While these concerns deserve attention, they represent challenges that can be addressed through education and responsible usage rather than fundamental flaws in technology itself.

// However, the benefits of technological connectivity far outweigh these concerns. The same platforms that critics blame for isolation also provide support networks for marginalized communities, enable social movements for positive change, and offer educational opportunities to underserved populations. The key lies not in rejecting technology but in learning to use it wisely.

// In conclusion, technology remains one of humanity's greatest tools for progress. While we must address its challenges responsibly, the evidence clearly shows that technological advancement has improved communication, healthcare, education, and countless other aspects of human life. Rather than fearing change, we should embrace technology's potential while working to mitigate its risks.`

export default function ArgumentativeWritingAssistant() {
  const [essay, setEssay] = useState("")
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [panelWidth, setPanelWidth] = useState(480)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [argumentAnalysis, setArgumentAnalysis] = useState<AnalysisResult | null>(null)
  const [lexicalAnalysis, setLexicalAnalysis] = useState<LexicalAnalysis | null>(null)
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState("argumentative")
  const [activeSubTab, setActiveSubTab] = useState<string>("")
  const [showEssayList, setShowEssayList] = useState(false)
  const [currentEssayId, setCurrentEssayId] = useState<string | null>(null)
  const [currentHighlight, setCurrentHighlight] = useState<{
    text: string
    effectiveness: string
  } | null>(null)
  const [deviceId, setDeviceId] = useState<string | null>(null)

  const [selectedPrompt, setSelectedPrompt] = useState<string>("")


  useEffect(() => {
    const id = getDeviceId()
    setDeviceId(id)
  }, [])

  const handleSelectEssay = (savedEssay: SavedEssay) => {
    setEssay(savedEssay.content)
    setSelectedPrompt(savedEssay.prompt)
    setCurrentEssayId(savedEssay.id)
  }

  const handleSave = async () => {
    if (!essay.trim()) return

    try {
      const title = essay.split("\n")[0].substring(0, 50) || "Untitled Essay"

      if (currentEssayId) {
        // Update existing essay
        EssayStorage.updateEssay(currentEssayId, {
          title,
          content: essay,
          prompt: selectedPrompt,
        })
      } else {
        // Save new essay
        const savedEssay = EssayStorage.saveEssay({
          title,
          content: essay,
          prompt: selectedPrompt,
        })
        setCurrentEssayId(savedEssay.id)
      }

      alert("✅ Essay saved successfully!")
    } catch (err) {
      console.error(err)
      alert("⚠️ Error saving essay")
    }
  }
  const wordCount = essay.trim().split(/\s+/).filter(Boolean).length

  

  const handleAnalyze = async () => {
    setIsAnalyzing(true)
    setIsPanelOpen(true)

    try {
      const [argResult] = await Promise.all([
        analyzeArgumentativeStructure(essay, selectedPrompt), // 👈 pass prompt
      ])

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
                  text: el.text, // Store the actual text content
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
              text: element.text, // Store the actual text content
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
      console.error("Analysis failed:", error)
    } finally {
      setIsAnalyzing(false)
    }
  }

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

  const handleHighlightClick = (highlight: Highlight) => {
    console.log("Highlight clicked:", highlight)
    setIsPanelOpen(true)
    setSelectedElementId(highlight.elementId)
  }

  // const handleHighlightText = (text: string) => {
  //   console.log("Highlighting text in essay:", text)
  // }
  const handleHighlightText = (text: string, effectiveness?: string) => {
    setCurrentHighlight({ text, effectiveness: effectiveness ?? "" })
    setSelectedElementId(text) // optional: track selected sentence
  }

  const handleElementSelect = (elementId: string | null) => {
    setSelectedElementId(elementId)
  }

  const handleTabChange = (tab: string) => {
    setActiveTab(tab)
    if (tab === "argumentative") {
      setSelectedElementId(null)
      setActiveSubTab("")
    } else if (tab === "lexical") {
      setSelectedElementId(null)
      setActiveSubTab("academic-coverage")
    }
  }

  const handleSubTabChange = (subTab: string) => {
    setActiveSubTab(subTab)
  }

  const findRepetitiveWords = (text: string) => {
    const words = text.toLowerCase().match(/\b\w+\b/g) || []
    const wordCounts: { [key: string]: number } = {}

    words.forEach((word) => {
      if (word.length > 3) {
        wordCounts[word] = (wordCounts[word] || 0) + 1
      }
    })

    const totalWords = words.length
    const expectedFrequency = Math.max(2, Math.floor(totalWords / 100))

    return Object.entries(wordCounts)
      .filter(([word, count]) => count > expectedFrequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word, count]) => ({
        word,
        count,
        frequency: ((count / totalWords) * 100).toFixed(1),
      }))
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                {/* <Brain className="h-6 w-6 text-primary" /> */}
                <h1 className="text-xl font-bold">ReflectNote          </h1>
              </div>

            </div>

            <div className="flex items-center gap-3">
              <Button
                onClick={() => setShowEssayList(true)}
                variant="outline"
                size="sm"
                className="flex items-center gap-2 hover:bg-slate-50"
              >
                <FolderOpen className="h-4 w-4" />
                Essays
              </Button>
              <Button
                onClick={handleSave}
                disabled={!essay.trim()}
                variant="outline"
                size="sm"
                className="flex items-center gap-2 hover:bg-slate-50 bg-transparent"
              >
                <Save className="h-4 w-4" />
                Save
              </Button>

              <Button
                onClick={handleAnalyze}
                disabled={isAnalyzing || wordCount < 200}
                className="flex items-center gap-2"
              >
                <Sparkles className="h-4 w-4" />
                {isAnalyzing ? "Analyzing..." : "Analyze Essay"}
              </Button>
            

            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex h-[calc(100vh-73px)]">
        {/* Left Panel - Essay Editor */}
        <div 
          className="flex-1 flex flex-col h-full p-4 space-y-4" 
          style={{ width: isPanelOpen ? `calc(100% - ${panelWidth}px)` : "100%" }}
        >
          {/* Prompt Selection */}
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
            onEssayChange={setEssay}
            highlights={highlights}
            onHighlightClick={handleHighlightClick}
            selectedElementId={selectedElementId}
            activeTab={activeTab}
            activeSubTab={activeSubTab}
            currentHighlight={currentHighlight} // 👈 this powers persistent highlights
          />
        </div>

        {/* Right Panel - Feedback */}
        <FeedbackPanel
          isOpen={isPanelOpen}
          onToggle={() => setIsPanelOpen(!isPanelOpen)}
          panelWidth={panelWidth}
          onPanelWidthChange={setPanelWidth}
          argumentAnalysis={argumentAnalysis}
          lexicalAnalysis={lexicalAnalysis}
          essay={essay}
          isAnalyzing={isAnalyzing}
          onHighlightText={handleHighlightText}
          onElementSelect={handleElementSelect}
          onTabChange={handleTabChange}
          onSubTabChange={handleSubTabChange}
        />
      </div>
      <EssayListModal
        isOpen={showEssayList}
        onClose={() => setShowEssayList(false)}
        onSelectEssay={handleSelectEssay}
      />
    </div>
  )
}

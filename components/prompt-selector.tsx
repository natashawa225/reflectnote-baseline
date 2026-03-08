"use client"

import { BookOpen } from "lucide-react"
import { samplePrompts } from "@/lib/sample-data"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface PromptSelectorProps {
  onPromptSelect: (prompt: string) => void
  selectedPrompt: string   // 👈 add this
}

export function PromptSelector({ onPromptSelect, selectedPrompt }: PromptSelectorProps) {
  const handlePromptSelect = (promptId: string) => {
    const selectedPromptData = samplePrompts.find((p) => p.id.toString() === promptId)
    if (selectedPromptData) {
      onPromptSelect(selectedPromptData.prompt)
    }
  }

  const getSelectedPromptId = () => {
    const selectedPromptData = samplePrompts.find((p) => p.prompt === selectedPrompt)
    return selectedPromptData ? selectedPromptData.id.toString() : undefined
  }

  return (
    <div className="space-y-4">

      <Select onValueChange={handlePromptSelect} value={getSelectedPromptId()}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Select a writing prompt..." />
        </SelectTrigger>
        <SelectContent>
          {samplePrompts.map((promptData) => (
            <SelectItem key={promptData.id} value={promptData.id.toString()}>
              <div className="max-w-[800px]">{promptData.prompt.substring(0, 100)}</div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selectedPrompt && (
        <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <BookOpen className="h-4 w-4 text-green-600" />
            <span className="font-medium text-green-800">Selected Prompt:</span>
          </div>
          <p className="text-sm text-green-700">{selectedPrompt}</p>
        </div>
      )}
    </div>
  )
}



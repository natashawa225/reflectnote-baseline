export interface SavedEssay {
    id: string
    title: string
    content: string
    prompt: string
    createdAt: string
    updatedAt: string
  }
  
  const inMemoryEssays = new Map<string, SavedEssay>()
  
  export class EssayStorage {
    static saveEssay(essay: Omit<SavedEssay, "id" | "createdAt" | "updatedAt">): SavedEssay {
      const now = new Date().toISOString()
      const savedEssay: SavedEssay = {
        ...essay,
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
      }
  
      inMemoryEssays.set(savedEssay.id, savedEssay)
      return savedEssay
    }
  
    static updateEssay(
      id: string,
      updates: Partial<Pick<SavedEssay, "title" | "content" | "prompt">>,
    ): SavedEssay | null {
      const existing = inMemoryEssays.get(id)
      if (!existing) return null
  
      const updated: SavedEssay = {
        ...existing,
        ...updates,
        updatedAt: new Date().toISOString(),
      }
  
      inMemoryEssays.set(id, updated)
      return updated
    }
  
    static deleteEssay(id: string): boolean {
      return inMemoryEssays.delete(id)
    }
  
    static getAllEssays(): SavedEssay[] {
      return [...inMemoryEssays.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    }
  
    static getEssay(id: string): SavedEssay | null {
      return inMemoryEssays.get(id) ?? null
    }
  
    static saveApiKey(_apiKey: string): void {
      // Intentionally disabled: API keys are server-side only.
    }
  
    static getApiKey(): string | null {
      return null
    }
  
    static hasApiKey(): boolean {
      return false
    }
  }
  
import OpenAI from "openai"

let openaiClient: OpenAI | null = null

export function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY environment variable")
  }

  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey })
  }

  return openaiClient
}

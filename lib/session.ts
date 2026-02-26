const SESSION_ID_KEY = "session_id"

export function getOrCreateSessionId(): string {
  if (typeof window === "undefined") return ""

  const existing = localStorage.getItem(SESSION_ID_KEY)
  if (existing) return existing

  const id = crypto.randomUUID()
  localStorage.setItem(SESSION_ID_KEY, id)
  return id
}

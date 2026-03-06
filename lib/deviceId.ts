const SESSION_KEY = "session_id"

function generateUuidV4(): string {
  const cryptoObj = globalThis.crypto

  if (cryptoObj && "randomUUID" in cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID()
  }

  const bytes = new Uint8Array(16)
  if (cryptoObj && "getRandomValues" in cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    cryptoObj.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256)
    }
  }

  // RFC 4122 variant + version 4
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-")
}

export function getOrCreateSessionId(): string | null {
  if (typeof window === "undefined") {
    return null
  }

  try {
    const existing = window.localStorage.getItem(SESSION_KEY)
    if (existing) return existing
  } catch {
    // localStorage can be unavailable in some privacy modes; fall back to an in-memory id.
    return generateUuidV4()
  }

  const nextId = generateUuidV4()
  try {
    window.localStorage.setItem(SESSION_KEY, nextId)
  } catch {
    // Ignore persistence failures; caller still gets a usable id for this page load.
  }
  return nextId
}

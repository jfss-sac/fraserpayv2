import type { ReactNode } from "react"

const activeToasts = new Map<string, string>()

const normalizeToastValue = (value: ReactNode) => {
  if (value === null || value === undefined || typeof value === "boolean") {
    return ""
  }

  if (typeof value === "string" || typeof value === "number") {
    return String(value)
  }

  if (Array.isArray(value)) {
    return value.map(normalizeToastValue).join(" ")
  }

  return String(value)
}

export const getToastKey = (parts: {
  title?: ReactNode
  description?: ReactNode
  message?: ReactNode
}) => {
  const message = normalizeToastValue(
    parts.message ?? `${normalizeToastValue(parts.title)}:${normalizeToastValue(parts.description)}`
  )

  return message.toLowerCase().trim()
}

export const getActiveToastId = (key: string) => activeToasts.get(key)

export const claimToast = (key: string, id: string) => {
  if (activeToasts.has(key)) {
    return false
  }

  activeToasts.set(key, id)
  return true
}

export const releaseToast = (key: string, id?: string) => {
  const activeId = activeToasts.get(key)

  if (activeId && id && activeId !== id) {
    return
  }

  activeToasts.delete(key)
}

export const clearToastRegistry = () => {
  activeToasts.clear()
}

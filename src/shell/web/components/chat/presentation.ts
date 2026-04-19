const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
})

export const uiLabelClass =
  "[font-family:var(--font-ui)] text-[12px] font-medium tracking-[-0.01em]"
export const uiCodeClass =
  "[font-family:var(--font-mono)] text-[12px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
export const uiTitleClass =
  "[font-family:var(--font-display)] text-[24px] font-semibold tracking-[-0.04em] text-foreground"
export const messageAuthorClass =
  "[font-family:var(--font-ui)] text-[16px] font-semibold tracking-[-0.02em] text-foreground"
export const messageBodyClass =
  "[font-family:var(--font-body)] text-[15px] leading-[1.6] tracking-[-0.012em] text-foreground"

export function formatTime(timestamp: string | null | undefined): string {
  if (!timestamp) {
    return "now"
  }
  return timeFormatter.format(new Date(timestamp))
}

export function formatCount(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? "" : "s"}`
}

export function labelFromId(value: string): string {
  return value
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

export function avatarFromLabel(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
}

export function resolveMentionQuery(value: string): string | null {
  const match = value.match(/(?:^|\s)@([\w-]*)$/)
  return match ? (match[1] ?? "") : null
}

export function buildMentionSuggestions(
  value: string,
  participantIds: readonly string[],
): string[] {
  const query = resolveMentionQuery(value)
  if (query === null) {
    return []
  }
  const normalizedQuery = query.trim().toLowerCase()
  return participantIds
    .filter((participantId) => {
      if (!normalizedQuery) {
        return true
      }
      const label = labelFromId(participantId).toLowerCase()
      return (
        participantId.toLowerCase().includes(normalizedQuery) || label.includes(normalizedQuery)
      )
    })
    .slice(0, 5)
}

export function applyMentionSuggestion(value: string, participantId: string): string {
  return value.replace(/(^|\s)@([\w-]*)$/, `$1@${participantId} `)
}

export function cycleSuggestionIndex(currentIndex: number, delta: number, total: number): number {
  if (total <= 0) {
    return -1
  }
  if (currentIndex < 0 || currentIndex >= total) {
    return delta >= 0 ? 0 : total - 1
  }
  return (currentIndex + delta + total) % total
}

export function resolveSuggestionSelection<T extends string>(
  options: readonly T[],
  index: number,
): T | null {
  if (options.length === 0) {
    return null
  }
  return options[index] ?? options[0] ?? null
}

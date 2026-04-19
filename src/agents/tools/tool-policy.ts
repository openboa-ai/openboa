export interface ToolPolicyLike {
  allow?: string[]
  alsoAllow?: string[]
  deny?: string[]
  profile?: string
}

function normalizeList(values: string[] | undefined): string[] | undefined {
  if (!Array.isArray(values) || values.length === 0) {
    return undefined
  }
  const normalized = Array.from(
    new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)),
  )
  return normalized.length > 0 ? normalized : undefined
}

export function resolveEffectiveToolPolicy(policy?: ToolPolicyLike): ToolPolicyLike | undefined {
  if (!policy) {
    return undefined
  }

  const allowBase = normalizeList(policy.allow)
  const alsoAllow = normalizeList(policy.alsoAllow)
  const allow =
    allowBase || alsoAllow
      ? Array.from(new Set([...(allowBase ?? ["*"]), ...(alsoAllow ?? [])]))
      : undefined
  const deny = normalizeList(policy.deny)
  const profile = policy.profile?.trim() || undefined

  if (!allow && !deny && !profile) {
    return undefined
  }

  return { ...(allow ? { allow } : {}), ...(deny ? { deny } : {}), ...(profile ? { profile } : {}) }
}

export function formatToolPolicySummary(policy?: ToolPolicyLike): string | null {
  const resolved = resolveEffectiveToolPolicy(policy)
  if (!resolved) {
    return null
  }

  const parts: string[] = []
  if (resolved.profile) {
    parts.push(`profile=${resolved.profile}`)
  }
  if (resolved.allow?.length) {
    parts.push(`allow=${resolved.allow.join(",")}`)
  }
  if (resolved.deny?.length) {
    parts.push(`deny=${resolved.deny.join(",")}`)
  }

  return parts.length > 0 ? parts.join(" | ") : null
}

export function isToolAllowed(policy: ToolPolicyLike | undefined, toolName: string): boolean {
  const resolved = resolveEffectiveToolPolicy(policy)
  if (!resolved) {
    return true
  }

  if (resolved.deny?.includes(toolName)) {
    return false
  }

  if (!resolved.allow || resolved.allow.length === 0) {
    return true
  }

  return resolved.allow.includes("*") || resolved.allow.includes(toolName)
}

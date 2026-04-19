import type { SkillEntry } from "../skills/agent-skills.js"
import type { AgentRuntimeToolDefinition } from "../tools/runtime-tool.js"
import type { BuiltContext } from "./model.js"

export interface ContextBudgetBootstrapFile {
  name: string
  rawChars: number
  rawTokens: number
  injectedChars: number
  injectedTokens: number
}

export interface ContextBudgetTopEntry {
  name: string
  chars: number
  estimatedTokens: number
}

export interface ContextBudgetToolSchemaEntry extends ContextBudgetTopEntry {
  permissionPolicy: string
  readOnly: boolean
}

export interface ContextBudgetSnapshot {
  contextSelectionBudgetTokens: number
  estimatedSelectedTextTokens: number
  estimatedToolSchemaTokens: number
  estimatedTotalRuntimeTokens: number
  selectionHeadroomTokens: number
  systemPrompt: {
    chars: number
    estimatedTokens: number
    sections: Array<{
      name: string
      chars: number
      estimatedTokens: number
    }>
  }
  sessionMessage: {
    chars: number
    estimatedTokens: number
  }
  history: {
    totalCount: number
    selectedCount: number
    totalConversationCount: number
    conversationCount: number
    totalRuntimeNoteCount: number
    runtimeNoteCount: number
    droppedConversationCount: number
    droppedRuntimeNoteCount: number
    protectedConversationContinuityCount: number
    chars: number
    estimatedTokens: number
  }
  bootstrapFiles: {
    count: number
    totalChars: number
    totalTokens: number
    files: ContextBudgetBootstrapFile[]
  }
  skills: {
    count: number
    promptEntryCount: number
    promptChars: number
    promptTokens: number
    topEntries: ContextBudgetTopEntry[]
  }
  tools: {
    count: number
    schemaChars: number
    schemaTokens: number
    topSchemas: ContextBudgetToolSchemaEntry[]
  }
}

export interface ContextBudgetBootstrapEntry {
  name: string
  content: string
}

export interface ContextPressureSummary {
  level: "low" | "moderate" | "high"
  reasons: string[]
  recommendedTools: string[]
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

function topEntries<T extends { chars: number }>(entries: T[], limit = 5): T[] {
  return [...entries].sort((left, right) => right.chars - left.chars).slice(0, limit)
}

function renderBootstrapSection(name: string, content: string): string {
  return `## ${name}\n\n${content}`
}

function renderSkillPromptEntry(skill: SkillEntry): string {
  return `- ${skill.name}: ${skill.description}`
}

function renderToolSchema(tool: AgentRuntimeToolDefinition): string {
  return JSON.stringify(
    {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema ?? null,
      ownership: tool.ownership,
      permissionPolicy: tool.permissionPolicy,
      effects: tool.effects,
      readOnly: tool.readOnly,
      destructive: tool.destructive,
      interruptBehavior: tool.interruptBehavior,
    },
    null,
    2,
  )
}

export function buildContextBudgetSnapshot(input: {
  tokenBudget: number
  bootstrapEntries: ContextBudgetBootstrapEntry[]
  bootstrapPrompt: string
  runtimeEnvironmentPrompt: string
  harnessAppendix: string
  sessionMessage: string
  builtContext: BuiltContext
  tools: AgentRuntimeToolDefinition[]
  skillEntries: SkillEntry[]
  maxPromptSkillEntries: number
}): ContextBudgetSnapshot {
  const bootstrapFiles = input.bootstrapEntries.map((entry) => {
    const rawChars = entry.content.length
    const injectedChars = renderBootstrapSection(entry.name, entry.content).length
    return {
      name: entry.name,
      rawChars,
      rawTokens: estimateTokens(entry.content),
      injectedChars,
      injectedTokens: estimateTokens(renderBootstrapSection(entry.name, entry.content)),
    }
  })
  const bootstrapFilesTotalChars = bootstrapFiles.reduce(
    (sum, entry) => sum + entry.injectedChars,
    0,
  )
  const bootstrapFilesTotalTokens = bootstrapFiles.reduce(
    (sum, entry) => sum + entry.injectedTokens,
    0,
  )

  const promptSkillEntries = input.skillEntries.slice(0, Math.max(1, input.maxPromptSkillEntries))
  const skillPromptEntries = promptSkillEntries.map((skill) => {
    const rendered = renderSkillPromptEntry(skill)
    return {
      name: skill.name,
      chars: rendered.length,
      estimatedTokens: estimateTokens(rendered),
    }
  })
  const skillPromptChars = skillPromptEntries.reduce((sum, entry) => sum + entry.chars, 0)
  const skillPromptTokens = skillPromptEntries.reduce(
    (sum, entry) => sum + entry.estimatedTokens,
    0,
  )

  const toolSchemas = input.tools.map((tool) => {
    const rendered = renderToolSchema(tool)
    return {
      name: tool.name,
      chars: rendered.length,
      estimatedTokens: estimateTokens(rendered),
      permissionPolicy: tool.permissionPolicy,
      readOnly: tool.readOnly,
    }
  })
  const schemaChars = toolSchemas.reduce((sum, entry) => sum + entry.chars, 0)
  const schemaTokens = toolSchemas.reduce((sum, entry) => sum + entry.estimatedTokens, 0)

  const promptSections = [
    {
      name: "bootstrap",
      chars: input.bootstrapPrompt.length,
      estimatedTokens: estimateTokens(input.bootstrapPrompt),
    },
    {
      name: "runtime_environment",
      chars: input.runtimeEnvironmentPrompt.length,
      estimatedTokens: estimateTokens(input.runtimeEnvironmentPrompt),
    },
    {
      name: "harness_appendix",
      chars: input.harnessAppendix.length,
      estimatedTokens: estimateTokens(input.harnessAppendix),
    },
  ]
  const systemPromptTokens = promptSections.reduce(
    (sum, section) => sum + section.estimatedTokens,
    0,
  )
  const systemPromptChars = promptSections.reduce((sum, section) => sum + section.chars, 0)
  const sessionMessageTokens = estimateTokens(input.sessionMessage)
  const historyChars = input.builtContext.transcript.length
  const historyTokens = input.builtContext.estimatedTokens
  const selectedTextTokens = systemPromptTokens + sessionMessageTokens + historyTokens

  return {
    contextSelectionBudgetTokens: input.tokenBudget,
    estimatedSelectedTextTokens: selectedTextTokens,
    estimatedToolSchemaTokens: schemaTokens,
    estimatedTotalRuntimeTokens: selectedTextTokens + schemaTokens,
    selectionHeadroomTokens: Math.max(0, input.tokenBudget - selectedTextTokens),
    systemPrompt: {
      chars: systemPromptChars,
      estimatedTokens: systemPromptTokens,
      sections: promptSections,
    },
    sessionMessage: {
      chars: input.sessionMessage.length,
      estimatedTokens: sessionMessageTokens,
    },
    history: {
      totalCount: input.builtContext.totalHistoryCount,
      selectedCount: input.builtContext.selectedHistory.length,
      totalConversationCount: input.builtContext.totalConversationCount,
      conversationCount: input.builtContext.conversationHistory.length,
      totalRuntimeNoteCount: input.builtContext.totalRuntimeNoteCount,
      runtimeNoteCount: input.builtContext.runtimeNotes.length,
      droppedConversationCount: input.builtContext.droppedConversationCount,
      droppedRuntimeNoteCount: input.builtContext.droppedRuntimeNoteCount,
      protectedConversationContinuityCount: input.builtContext.protectedConversationContinuityCount,
      chars: historyChars,
      estimatedTokens: historyTokens,
    },
    bootstrapFiles: {
      count: bootstrapFiles.length,
      totalChars: bootstrapFilesTotalChars,
      totalTokens: bootstrapFilesTotalTokens,
      files: bootstrapFiles,
    },
    skills: {
      count: input.skillEntries.length,
      promptEntryCount: promptSkillEntries.length,
      promptChars: skillPromptChars,
      promptTokens: skillPromptTokens,
      topEntries: topEntries(skillPromptEntries),
    },
    tools: {
      count: input.tools.length,
      schemaChars,
      schemaTokens,
      topSchemas: topEntries(toolSchemas),
    },
  }
}

export function summarizeContextPressure(
  contextBudget: ContextBudgetSnapshot | null,
): ContextPressureSummary | null {
  if (!contextBudget) {
    return null
  }
  const reasons: string[] = []
  const recommendedTools = new Set<string>()
  if (contextBudget.selectionHeadroomTokens < 400) {
    reasons.push(`low_headroom:${contextBudget.selectionHeadroomTokens}`)
    recommendedTools.add("retrieval_search")
    recommendedTools.add("session_search_context")
  } else if (contextBudget.selectionHeadroomTokens < 1200) {
    reasons.push(`narrow_headroom:${contextBudget.selectionHeadroomTokens}`)
    recommendedTools.add("retrieval_search")
  }
  if (contextBudget.history.droppedConversationCount > 0) {
    reasons.push(`dropped_conversation:${contextBudget.history.droppedConversationCount}`)
    recommendedTools.add("session_search_context")
    recommendedTools.add("session_get_snapshot")
  }
  if (contextBudget.history.droppedRuntimeNoteCount > 0) {
    reasons.push(`dropped_runtime_notes:${contextBudget.history.droppedRuntimeNoteCount}`)
    recommendedTools.add("session_get_trace")
    recommendedTools.add("shell_describe")
  }
  if (reasons.length === 0) {
    return {
      level: "low",
      reasons: [],
      recommendedTools: [],
    }
  }
  return {
    level:
      contextBudget.selectionHeadroomTokens < 400 ||
      contextBudget.history.droppedConversationCount > 0
        ? "high"
        : "moderate",
    reasons,
    recommendedTools: Array.from(recommendedTools),
  }
}

export function buildContextBudgetMarkdown(input: {
  sessionId: string
  contextBudget: ContextBudgetSnapshot
}): string {
  const budget = input.contextBudget
  return [
    "# Context Budget",
    "",
    `- Session: \`${input.sessionId}\``,
    `- Context selection budget: ${String(budget.contextSelectionBudgetTokens)} tok`,
    `- Selected text estimate: ${String(budget.estimatedSelectedTextTokens)} tok`,
    `- Tool schema estimate: ${String(budget.estimatedToolSchemaTokens)} tok`,
    `- Estimated total runtime tokens: ${String(budget.estimatedTotalRuntimeTokens)} tok`,
    `- Selection headroom: ${String(budget.selectionHeadroomTokens)} tok`,
    "",
    "## System Prompt Sections",
    "",
    ...budget.systemPrompt.sections.map(
      (section) =>
        `- ${section.name}: ${String(section.chars)} chars (~${String(section.estimatedTokens)} tok)`,
    ),
    "",
    "## Bootstrap Files",
    "",
    ...budget.bootstrapFiles.files.map(
      (entry) =>
        `- ${entry.name}: raw ${String(entry.rawChars)} chars (~${String(entry.rawTokens)} tok), injected ${String(entry.injectedChars)} chars (~${String(entry.injectedTokens)} tok)`,
    ),
    "",
    "## Session History",
    "",
    `- Total records: ${String(budget.history.totalCount)}`,
    `- Selected records: ${String(budget.history.selectedCount)}`,
    `- Total conversation records: ${String(budget.history.totalConversationCount)}`,
    `- Conversation records: ${String(budget.history.conversationCount)}`,
    `- Total runtime notes: ${String(budget.history.totalRuntimeNoteCount)}`,
    `- Runtime notes: ${String(budget.history.runtimeNoteCount)}`,
    `- Dropped conversation records: ${String(budget.history.droppedConversationCount)}`,
    `- Dropped runtime notes: ${String(budget.history.droppedRuntimeNoteCount)}`,
    `- Protected conversation continuity records: ${String(
      budget.history.protectedConversationContinuityCount,
    )}`,
    `- Transcript: ${String(budget.history.chars)} chars (~${String(budget.history.estimatedTokens)} tok)`,
    "",
    "## Skills",
    "",
    `- Available skills: ${String(budget.skills.count)}`,
    `- Prompt entries: ${String(budget.skills.promptEntryCount)}`,
    `- Prompt footprint: ${String(budget.skills.promptChars)} chars (~${String(budget.skills.promptTokens)} tok)`,
    ...(budget.skills.topEntries.length > 0
      ? [
          "",
          "### Top Skill Prompt Entries",
          "",
          ...budget.skills.topEntries.map(
            (entry) =>
              `- ${entry.name}: ${String(entry.chars)} chars (~${String(entry.estimatedTokens)} tok)`,
          ),
        ]
      : []),
    "",
    "## Tool Schemas",
    "",
    `- Tool count: ${String(budget.tools.count)}`,
    `- Schema footprint: ${String(budget.tools.schemaChars)} chars (~${String(budget.tools.schemaTokens)} tok)`,
    ...(budget.tools.topSchemas.length > 0
      ? [
          "",
          "### Top Tool Schemas",
          "",
          ...budget.tools.topSchemas.map(
            (entry) =>
              `- ${entry.name}: ${String(entry.chars)} chars (~${String(entry.estimatedTokens)} tok) permission=${entry.permissionPolicy} readOnly=${String(entry.readOnly)}`,
          ),
        ]
      : []),
  ].join("\n")
}

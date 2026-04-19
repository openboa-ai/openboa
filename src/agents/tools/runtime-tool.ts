import type {
  PermissionPolicy,
  SessionToolConfirmationRequest,
  ToolDefinition,
  ToolEffect,
  ToolInterruptBehavior,
  ToolOwnership,
} from "../schema/runtime.js"

export interface AgentRuntimeToolDefinition extends ToolDefinition {
  parameters?: Record<string, unknown>
  execute: (args: unknown) => Promise<string>
}

export abstract class AgentRuntimeInterruptError extends Error {}

export class ToolConfirmationRequiredError extends AgentRuntimeInterruptError {
  readonly request: SessionToolConfirmationRequest

  constructor(request: SessionToolConfirmationRequest) {
    super(`Tool confirmation required for ${request.toolName}`)
    this.name = "ToolConfirmationRequiredError"
    this.request = request
  }
}

export interface CreateRuntimeToolDefinitionInput {
  name: string
  description: string
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  ownership?: ToolOwnership
  permissionPolicy?: PermissionPolicy
  effects?: ToolEffect[]
  readOnly?: boolean
  destructive?: boolean
  interruptBehavior?: ToolInterruptBehavior
  execute: (args: unknown) => Promise<string>
}

export function createRuntimeToolDefinition(
  input: CreateRuntimeToolDefinitionInput,
): AgentRuntimeToolDefinition {
  return {
    name: input.name,
    description: input.description,
    inputSchema: input.inputSchema ?? {},
    outputSchema: input.outputSchema,
    parameters: input.inputSchema ?? {},
    ownership: input.ownership ?? "managed",
    permissionPolicy: input.permissionPolicy ?? "always_allow",
    effects: input.effects ?? [],
    readOnly: input.readOnly ?? true,
    destructive: input.destructive ?? false,
    interruptBehavior: input.interruptBehavior ?? "block",
    execute: input.execute,
  }
}

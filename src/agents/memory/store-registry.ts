export type ManagedMemoryTarget =
  | "checkpoint"
  | "shell_state"
  | "session_state"
  | "working_buffer"
  | "workspace_memory"
  | "workspace_memory_notes"

export interface ManagedMemoryStoreDescriptor {
  target: ManagedMemoryTarget
  title: string
  description: string
  scope: "session" | "agent"
  writable: boolean
  searchable: boolean
}

const MANAGED_MEMORY_STORES: ManagedMemoryStoreDescriptor[] = [
  {
    target: "checkpoint",
    title: "Runtime checkpoint",
    description:
      "Structured session runtime checkpoint with event cursors, last summary, active outcome, and wake state.",
    scope: "session",
    writable: false,
    searchable: true,
  },
  {
    target: "shell_state",
    title: "Shell state",
    description:
      "Durable session-scoped shell state including cwd and the latest bounded command metadata.",
    scope: "session",
    writable: false,
    searchable: true,
  },
  {
    target: "session_state",
    title: "Session state",
    description: "Session-local durable state notes captured in session-state.md.",
    scope: "session",
    writable: true,
    searchable: true,
  },
  {
    target: "working_buffer",
    title: "Working buffer",
    description: "Session-local scratchpad notes captured in working-buffer.md.",
    scope: "session",
    writable: true,
    searchable: true,
  },
  {
    target: "workspace_memory",
    title: "Workspace memory",
    description: "Shared agent MEMORY.md content promoted across sessions.",
    scope: "agent",
    writable: false,
    searchable: true,
  },
  {
    target: "workspace_memory_notes",
    title: "Workspace memory notes",
    description:
      "Managed writable notes section inside shared MEMORY.md for durable agent-level notes.",
    scope: "agent",
    writable: true,
    searchable: true,
  },
]

export function listManagedMemoryStores(): ManagedMemoryStoreDescriptor[] {
  return MANAGED_MEMORY_STORES.map((descriptor) => ({ ...descriptor }))
}

export function resolveManagedMemoryStore(value: unknown): ManagedMemoryStoreDescriptor | null {
  return MANAGED_MEMORY_STORES.find((descriptor) => descriptor.target === value) ?? null
}

export function listWritableManagedMemoryStores(): ManagedMemoryStoreDescriptor[] {
  return MANAGED_MEMORY_STORES.filter((descriptor) => descriptor.writable).map((descriptor) => ({
    ...descriptor,
  }))
}

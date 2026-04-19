import { EventEmitter } from "node:events"
import type { FileHandle } from "node:fs/promises"
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { makeUuidV7 } from "../../foundation/ids.js"
import { appendJsonl, readJsonl } from "../../foundation/storage/jsonl.js"
import { nowIsoString } from "../../foundation/time.js"
import { SessionStore } from "../sessions/session-store.js"

export interface SessionWake {
  id: string
  sessionId: string
  createdAt: string
  dueAt: string
  reason: string
  note: string | null
  dedupeKey: string | null
  priority: "low" | "normal" | "high"
}

interface WakeEnqueuedRecord {
  kind: "session.wake.enqueued"
  sessionId: string
  wake: SessionWake
}

interface WakeCompletedRecord {
  kind: "session.wake.completed"
  sessionId: string
  wakeId: string
  completedAt: string
}

type SessionWakeJournalRecord = WakeEnqueuedRecord | WakeCompletedRecord

interface WakeState {
  wake: SessionWake
  completedAt: string | null
}

interface PendingWakeSessionIndexEntry {
  sessionId: string
  nextDueAt: string
}

interface PendingWakeIndexLockRecord {
  owner: string
  acquiredAt: string
}

export interface DueSessionWakeBatch {
  sessionId: string
  nextDueAt: string
  dueWakes: SessionWake[]
}

export interface SessionPendingWakeState {
  pendingCount: number
  nextDueAt: string | null
}

function compareIso(left: string, right: string): number {
  return Date.parse(left) - Date.parse(right)
}

const DEFAULT_PENDING_WAKE_INDEX_LOCK_STALE_MS = 30 * 1000
const DEFAULT_PENDING_WAKE_INDEX_LOCK_TIMEOUT_MS = 5 * 1000
const PENDING_WAKE_INDEX_LOCK_RETRY_MS = 10

export class SessionWakeQueue {
  private readonly pendingWakeIndexEvents = new EventEmitter()

  constructor(
    private readonly companyDir: string,
    private readonly sessionStore: SessionStore = new SessionStore(companyDir),
  ) {}

  private async filePath(sessionId: string): Promise<string> {
    const { session } = await this.sessionStore.getSession(sessionId)
    return this.filePathForAgentSession(session.agentId, sessionId)
  }

  private filePathForAgentSession(agentId: string, sessionId: string): string {
    return join(
      this.companyDir,
      ".openboa",
      "agents",
      agentId,
      "sessions",
      sessionId,
      "wake-queue.jsonl",
    )
  }

  private pendingWakeSessionsPath(agentId: string): string {
    return join(
      this.companyDir,
      ".openboa",
      "agents",
      agentId,
      "runtime",
      "pending-wake-sessions.json",
    )
  }

  private pendingWakeIndexLockPath(agentId: string): string {
    return join(
      this.companyDir,
      ".openboa",
      "agents",
      agentId,
      "runtime",
      "locks",
      "pending-wake-sessions.lock",
    )
  }

  async enqueue(input: Omit<SessionWake, "id" | "createdAt">): Promise<SessionWake> {
    const wake: SessionWake = {
      id: makeUuidV7(),
      sessionId: input.sessionId,
      createdAt: nowIsoString(),
      dueAt: input.dueAt,
      reason: input.reason,
      note: input.note,
      dedupeKey: input.dedupeKey,
      priority: input.priority,
    }
    const states = this.fold(await this.read(input.sessionId))
    if (
      wake.dedupeKey &&
      [...states.values()].some(
        (state) => state.completedAt === null && state.wake.dedupeKey === wake.dedupeKey,
      )
    ) {
      const existing = [...states.values()].find(
        (state) => state.completedAt === null && state.wake.dedupeKey === wake.dedupeKey,
      )
      if (existing) {
        return existing.wake
      }
    }

    const session = (await this.sessionStore.getSession(input.sessionId)).session
    await appendJsonl(await this.filePath(input.sessionId), {
      kind: "session.wake.enqueued",
      sessionId: input.sessionId,
      wake,
    } satisfies WakeEnqueuedRecord)
    await this.syncPendingWakeSessionIndex(session.agentId, input.sessionId, states, {
      wake,
      completedAt: null,
    })
    return wake
  }

  async listPending(sessionId: string, at = nowIsoString()): Promise<SessionWake[]> {
    const { session } = await this.sessionStore.getSession(sessionId)
    return this.listPendingForAgentSession(session.agentId, sessionId, at)
  }

  async inspectPending(sessionId: string): Promise<SessionPendingWakeState> {
    const { session } = await this.sessionStore.getSession(sessionId)
    return this.inspectPendingForAgentSession(session.agentId, sessionId)
  }

  async listPendingForAgentSession(
    agentId: string,
    sessionId: string,
    at = nowIsoString(),
  ): Promise<SessionWake[]> {
    return [...this.fold(await this.readForAgentSession(agentId, sessionId)).values()]
      .filter((state) => state.completedAt === null && compareIso(state.wake.dueAt, at) <= 0)
      .map((state) => state.wake)
      .sort((left, right) => compareIso(left.dueAt, right.dueAt))
  }

  async inspectPendingForAgentSession(
    agentId: string,
    sessionId: string,
  ): Promise<SessionPendingWakeState> {
    const pending = [...this.fold(await this.readForAgentSession(agentId, sessionId)).values()]
      .filter((state) => state.completedAt === null)
      .map((state) => state.wake)
      .sort((left, right) => compareIso(left.dueAt, right.dueAt))
    return {
      pendingCount: pending.length,
      nextDueAt: pending[0]?.dueAt ?? null,
    }
  }

  async consumeDue(sessionId: string, at = nowIsoString()): Promise<SessionWake[]> {
    const { session } = await this.sessionStore.getSession(sessionId)
    return this.consumeDueForAgentSession(session.agentId, sessionId, at)
  }

  async consumeDueForAgentSession(
    agentId: string,
    sessionId: string,
    at = nowIsoString(),
  ): Promise<SessionWake[]> {
    const wakes = await this.listPendingForAgentSession(agentId, sessionId, at)
    for (const wake of wakes) {
      await appendJsonl(this.filePathForAgentSession(agentId, sessionId), {
        kind: "session.wake.completed",
        sessionId,
        wakeId: wake.id,
        completedAt: at,
      } satisfies WakeCompletedRecord)
    }
    if (wakes.length > 0) {
      await this.syncPendingWakeSessionIndex(agentId, sessionId)
    }
    return wakes
  }

  async consumeKnownForAgentSession(
    agentId: string,
    sessionId: string,
    wakes: SessionWake[],
    at = nowIsoString(),
  ): Promise<SessionWake[]> {
    const uniqueWakes = dedupeWakeList(wakes)
    if (uniqueWakes.length === 0) {
      return []
    }
    for (const wake of uniqueWakes) {
      await appendJsonl(this.filePathForAgentSession(agentId, sessionId), {
        kind: "session.wake.completed",
        sessionId,
        wakeId: wake.id,
        completedAt: at,
      } satisfies WakeCompletedRecord)
    }
    await this.syncPendingWakeSessionIndex(agentId, sessionId)
    return uniqueWakes
  }

  async cancelPending(sessionId: string, at = nowIsoString()): Promise<SessionWake[]> {
    const { session } = await this.sessionStore.getSession(sessionId)
    return this.cancelPendingForAgentSession(session.agentId, sessionId, at)
  }

  async cancelPendingForAgentSession(
    agentId: string,
    sessionId: string,
    at = nowIsoString(),
  ): Promise<SessionWake[]> {
    const wakes = [...this.fold(await this.readForAgentSession(agentId, sessionId)).values()]
      .filter((state) => state.completedAt === null)
      .map((state) => state.wake)
      .sort((left, right) => compareIso(left.dueAt, right.dueAt))
    for (const wake of wakes) {
      await appendJsonl(this.filePathForAgentSession(agentId, sessionId), {
        kind: "session.wake.completed",
        sessionId,
        wakeId: wake.id,
        completedAt: at,
      } satisfies WakeCompletedRecord)
    }
    if (wakes.length > 0) {
      await this.syncPendingWakeSessionIndex(agentId, sessionId)
    }
    return wakes
  }

  async listSessionIdsWithPendingWakes(agentId: string): Promise<string[]> {
    const indexed = await this.readPendingWakeSessionIndex(agentId)
    if (indexed.length === 0) {
      return []
    }
    return indexed.map((entry) => entry.sessionId)
  }

  async peekNextDueAt(
    agentId: string,
    options: {
      allowedSessionIds?: Iterable<string> | null
    } = {},
  ): Promise<string | null> {
    const indexed = await this.readPendingWakeSessionIndex(agentId)
    const allowedSessionIds = options.allowedSessionIds ? new Set(options.allowedSessionIds) : null
    const nextDueAt =
      indexed.find(
        (entry) =>
          entry.nextDueAt.trim().length > 0 &&
          (!allowedSessionIds || allowedSessionIds.has(entry.sessionId)),
      )?.nextDueAt ?? null
    return nextDueAt
  }

  onPendingWakeIndexChanged(agentId: string, listener: () => void): () => void {
    const eventName = pendingWakeIndexEventName(agentId)
    this.pendingWakeIndexEvents.on(eventName, listener)
    return () => this.pendingWakeIndexEvents.off(eventName, listener)
  }

  async listSessionIdsWithDueWakes(agentId: string, at = nowIsoString()): Promise<string[]> {
    return (await this.listDueSessionWakes(agentId, at)).map((entry) => entry.sessionId)
  }

  async listDueSessionWakes(agentId: string, at = nowIsoString()): Promise<DueSessionWakeBatch[]> {
    return this.withPendingWakeIndexLock(agentId, async () => {
      const indexed = await this.readPendingWakeSessionIndex(agentId)
      if (indexed.length === 0) {
        return []
      }
      const confirmed: PendingWakeSessionIndexEntry[] = []
      const dueSessions: DueSessionWakeBatch[] = []
      for (const entry of indexed) {
        const indexedDueAt = entry.nextDueAt.trim().length > 0 ? entry.nextDueAt : null
        if (indexedDueAt && compareIso(indexedDueAt, at) > 0) {
          confirmed.push(entry)
          continue
        }
        const pendingWakes = [
          ...this.fold(await this.readForAgentSession(agentId, entry.sessionId)).values(),
        ]
          .filter((state) => state.completedAt === null)
          .map((state) => state.wake)
          .sort((left, right) => compareIso(left.dueAt, right.dueAt))
        const nextWake = pendingWakes[0] ?? null
        if (!nextWake) {
          continue
        }
        confirmed.push({
          sessionId: entry.sessionId,
          nextDueAt: nextWake.dueAt,
        })
        const dueWakes = pendingWakes.filter((wake) => compareIso(wake.dueAt, at) <= 0)
        if (dueWakes.length > 0) {
          dueSessions.push({
            sessionId: entry.sessionId,
            nextDueAt: nextWake.dueAt,
            dueWakes,
          })
        }
      }
      if (!samePendingWakeEntries(indexed, confirmed)) {
        await this.writePendingWakeSessionIndex(agentId, confirmed)
      }
      return dueSessions
    })
  }

  private async read(sessionId: string): Promise<SessionWakeJournalRecord[]> {
    return readJsonl<SessionWakeJournalRecord>(await this.filePath(sessionId))
  }

  private async readForAgentSession(
    agentId: string,
    sessionId: string,
  ): Promise<SessionWakeJournalRecord[]> {
    return readJsonl<SessionWakeJournalRecord>(this.filePathForAgentSession(agentId, sessionId))
  }

  private fold(records: SessionWakeJournalRecord[]): Map<string, WakeState> {
    const states = new Map<string, WakeState>()
    for (const record of records) {
      if (record.kind === "session.wake.enqueued") {
        states.set(record.wake.id, {
          wake: record.wake,
          completedAt: null,
        })
        continue
      }
      const current = states.get(record.wakeId)
      if (!current) {
        continue
      }
      states.set(record.wakeId, {
        ...current,
        completedAt: record.completedAt,
      })
    }
    return states
  }

  private async readPendingWakeSessionIndex(
    agentId: string,
  ): Promise<PendingWakeSessionIndexEntry[]> {
    try {
      const raw = await readFile(this.pendingWakeSessionsPath(agentId), "utf8")
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) {
        return []
      }
      const entries = parsed.flatMap((value): PendingWakeSessionIndexEntry[] => {
        if (typeof value === "string" && value.trim().length > 0) {
          return [{ sessionId: value, nextDueAt: "" }]
        }
        if (
          value &&
          typeof value === "object" &&
          typeof (value as Record<string, unknown>).sessionId === "string"
        ) {
          return [
            {
              sessionId: (value as Record<string, string>).sessionId,
              nextDueAt:
                typeof (value as Record<string, unknown>).nextDueAt === "string"
                  ? (value as Record<string, string>).nextDueAt
                  : "",
            },
          ]
        }
        return []
      })
      return entries.filter((entry) => entry.sessionId.trim().length > 0)
    } catch {
      return []
    }
  }

  private async writePendingWakeSessionIndex(
    agentId: string,
    entries: PendingWakeSessionIndexEntry[],
  ): Promise<void> {
    const runtimeDir = join(this.companyDir, ".openboa", "agents", agentId, "runtime")
    await mkdir(runtimeDir, { recursive: true })
    const tempPath = join(runtimeDir, `pending-wake-sessions.${makeUuidV7()}.tmp`)
    const unique = dedupePendingWakeEntries(entries)
    await writeFile(tempPath, `${JSON.stringify(unique, null, 2)}\n`, "utf8")
    await rename(tempPath, this.pendingWakeSessionsPath(agentId))
    this.pendingWakeIndexEvents.emit(pendingWakeIndexEventName(agentId))
  }

  private async syncPendingWakeSessionIndex(
    agentId: string,
    sessionId: string,
    knownStates?: Map<string, WakeState>,
    appendedState?: WakeState,
  ): Promise<void> {
    await this.withPendingWakeIndexLock(agentId, async () => {
      const current = await this.readPendingWakeSessionIndex(agentId)
      const states = knownStates ?? this.fold(await this.read(sessionId))
      if (appendedState) {
        states.set(appendedState.wake.id, appendedState)
      }
      const nextDueAt = earliestPendingWakeDueAt(states)
      const next = nextDueAt
        ? dedupePendingWakeEntries([
            ...current.filter((entry) => entry.sessionId !== sessionId),
            {
              sessionId,
              nextDueAt,
            },
          ])
        : current.filter((entry) => entry.sessionId !== sessionId)
      if (samePendingWakeEntries(current, next)) {
        return
      }
      await this.writePendingWakeSessionIndex(agentId, next)
    })
  }

  private async withPendingWakeIndexLock<T>(
    agentId: string,
    fn: () => Promise<T>,
    options: {
      staleAfterMs?: number
      timeoutMs?: number
    } = {},
  ): Promise<T> {
    const staleAfterMs = options.staleAfterMs ?? DEFAULT_PENDING_WAKE_INDEX_LOCK_STALE_MS
    const timeoutMs = options.timeoutMs ?? DEFAULT_PENDING_WAKE_INDEX_LOCK_TIMEOUT_MS
    const lockPath = this.pendingWakeIndexLockPath(agentId)
    await mkdir(dirname(lockPath), { recursive: true })
    const owner = makeUuidV7()
    const startedAt = Date.now()

    while (true) {
      let handle: FileHandle | undefined
      try {
        handle = await open(lockPath, "wx")
        try {
          await handle.writeFile(
            `${JSON.stringify(
              {
                owner,
                acquiredAt: nowIsoString(),
              } satisfies PendingWakeIndexLockRecord,
              null,
              2,
            )}\n`,
            "utf8",
          )
        } finally {
          await handle.close()
        }
        break
      } catch {
        const current = await this.readPendingWakeIndexLock(lockPath)
        const ageMs = current?.acquiredAt ? Date.now() - Date.parse(current.acquiredAt) : Number.NaN
        if (!Number.isFinite(ageMs) || ageMs >= staleAfterMs) {
          await rm(lockPath, { force: true }).catch(() => undefined)
          continue
        }
        if (Date.now() - startedAt >= timeoutMs) {
          throw new Error(
            `Timed out acquiring pending wake index lock for ${agentId} after ${timeoutMs}ms`,
          )
        }
        await new Promise((resolve) => setTimeout(resolve, PENDING_WAKE_INDEX_LOCK_RETRY_MS))
      }
    }

    try {
      return await fn()
    } finally {
      const current = await this.readPendingWakeIndexLock(lockPath)
      if (current?.owner === owner) {
        await rm(lockPath, { force: true }).catch(() => undefined)
      }
    }
  }

  private async readPendingWakeIndexLock(
    lockPath: string,
  ): Promise<PendingWakeIndexLockRecord | null> {
    try {
      const raw = await readFile(lockPath, "utf8")
      const parsed = JSON.parse(raw) as Partial<PendingWakeIndexLockRecord>
      if (typeof parsed.owner !== "string" || typeof parsed.acquiredAt !== "string") {
        return null
      }
      return {
        owner: parsed.owner,
        acquiredAt: parsed.acquiredAt,
      }
    } catch {
      return null
    }
  }
}

function pendingWakeIndexEventName(agentId: string): string {
  return `pending-wake-index:${agentId}`
}

function earliestPendingWakeDueAt(states: Map<string, WakeState>): string | null {
  const pendingDueAts = [...states.values()]
    .filter((state) => state.completedAt === null)
    .map((state) => state.wake.dueAt)
    .sort(compareIso)
  return pendingDueAts[0] ?? null
}

function dedupePendingWakeEntries(
  entries: PendingWakeSessionIndexEntry[],
): PendingWakeSessionIndexEntry[] {
  const map = new Map<string, PendingWakeSessionIndexEntry>()
  for (const entry of entries) {
    const current = map.get(entry.sessionId)
    if (!current || (entry.nextDueAt && compareIso(entry.nextDueAt, current.nextDueAt) < 0)) {
      map.set(entry.sessionId, entry)
    }
  }
  return [...map.values()].sort((left, right) => {
    const dueDiff = compareIso(left.nextDueAt, right.nextDueAt)
    if (dueDiff !== 0) {
      return dueDiff
    }
    return left.sessionId.localeCompare(right.sessionId)
  })
}

function samePendingWakeEntries(
  left: PendingWakeSessionIndexEntry[],
  right: PendingWakeSessionIndexEntry[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (entry, index) =>
        entry.sessionId === right[index]?.sessionId && entry.nextDueAt === right[index]?.nextDueAt,
    )
  )
}

function dedupeWakeList(wakes: SessionWake[]): SessionWake[] {
  const map = new Map<string, SessionWake>()
  for (const wake of wakes) {
    map.set(wake.id, wake)
  }
  return [...map.values()].sort((left, right) => compareIso(left.dueAt, right.dueAt))
}

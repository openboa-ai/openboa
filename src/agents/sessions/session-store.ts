import { EventEmitter } from "node:events"
import type { Dirent } from "node:fs"
import type { FileHandle } from "node:fs/promises"
import { link, mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { isUuidV7, makeUuidV7 } from "../../foundation/ids.js"
import { appendJsonl, readJsonl } from "../../foundation/storage/jsonl.js"
import { nowIsoString } from "../../foundation/time.js"
import { DEFAULT_LOCAL_ENVIRONMENT_ID } from "../environment/environment-store.js"
import {
  buildDefaultSessionResources,
  ensureSessionExecutionWorkspace,
} from "../resources/default-resources.js"
import type {
  PendingEvent,
  ResourceAttachment,
  Session,
  SessionEvent,
  SessionEventType,
  SessionMetadata,
} from "../schema/runtime.js"

interface SessionEventEnvelope {
  kind: "session.event.appended"
  sessionId: string
  event: SessionEvent
}

interface SessionEventProcessedMarker {
  kind: "session.event.processed"
  sessionId: string
  eventId: string
  processedAt: string
}

type SessionEventJournalRecord = SessionEventEnvelope | SessionEventProcessedMarker

interface LegacySessionCheckpoint {
  checkpointId: string
  previousCheckpointId: string | null
  createdAt: string
}

interface LegacySessionRecord {
  kind: "turn.completed"
  conversationId: string
  sessionId: string
  agentId: string
  requestMessage: string
  responseMessage: string
  authMode: "none" | "codex-env" | "codex-oauth"
  provider?: string
  model?: string
  runner?: string
  cliSessionBindings?: Record<string, unknown>
  checkpoint: LegacySessionCheckpoint
}

interface RunnableSessionIndexEntry {
  sessionId: string
  pendingEventType: SessionEventType | null
  deferUntil: string | null
  failureStreak: number
}

interface ActiveWakeLeaseIndexEntry {
  sessionId: string
  acquiredAt: string
}

interface SessionWakeLeaseRecord {
  sessionId: string
  owner: string
  acquiredAt: string
}

const DEFAULT_STALE_WAKE_LEASE_MS = 10 * 60 * 1000
const DEFAULT_SESSION_MUTATION_LOCK_STALE_MS = 30 * 1000
const DEFAULT_SESSION_MUTATION_LOCK_TIMEOUT_MS = 5 * 1000
const SESSION_MUTATION_LOCK_RETRY_MS = 10
const DEFAULT_AGENT_RUNTIME_INDEX_LOCK_STALE_MS = 30 * 1000
const DEFAULT_AGENT_RUNTIME_INDEX_LOCK_TIMEOUT_MS = 5 * 1000
const AGENT_RUNTIME_INDEX_LOCK_RETRY_MS = 10
const DEFAULT_RUNNABLE_FAILURE_BACKOFF_BASE_MS = 2_000
const DEFAULT_RUNNABLE_FAILURE_BACKOFF_MAX_MS = 30_000

function normalizeOptionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : null
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code
}

function foldEvents(records: SessionEventJournalRecord[]): SessionEvent[] {
  const state = new Map<string, SessionEvent>()
  for (const record of records) {
    if (record.kind === "session.event.appended") {
      state.set(record.event.id, record.event)
      continue
    }
    const current = state.get(record.eventId)
    if (!current) {
      continue
    }
    state.set(record.eventId, {
      ...current,
      processedAt: record.processedAt,
    })
  }

  return [...state.values()].sort(
    (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt),
  )
}

export interface CreateSessionInput {
  agentId: string
  environmentId?: string
  resources?: ResourceAttachment[]
  sessionId?: string
}

export interface SessionSnapshot {
  session: Session
  events: SessionEvent[]
}

export interface SessionWakeLease {
  renew(): Promise<void>
  release(): Promise<void>
}

export interface SessionExecutionRuntimeState {
  sessionId: string
  agentId: string
  runnablePendingEventType: SessionEventType | null
  deferUntil: string | null
  failureStreak: number
  activeWakeLease: {
    owner: string
    acquiredAt: string
  } | null
}

export interface ListSessionEventsOptions {
  afterEventId?: string | null
  beforeEventId?: string | null
  aroundEventId?: string | null
  wakeId?: string | null
  beforeLimit?: number
  afterLimit?: number
  includeProcessed?: boolean
  limit?: number
  types?: SessionEventType[]
}

export class SessionStore {
  private readonly runtimeIndexEvents = new EventEmitter()

  constructor(private readonly companyDir: string) {}

  private agentsDir(): string {
    return join(this.companyDir, ".openboa", "agents")
  }

  agentDir(agentId: string): string {
    return join(this.agentsDir(), agentId)
  }

  sessionsDir(agentId: string): string {
    return join(this.agentDir(agentId), "sessions")
  }

  agentRuntimeDir(agentId: string): string {
    return join(this.agentDir(agentId), "runtime")
  }

  sessionDir(agentId: string, sessionId: string): string {
    return join(this.sessionsDir(agentId), sessionId)
  }

  sessionPath(agentId: string, sessionId: string): string {
    return join(this.sessionDir(agentId, sessionId), "session.json")
  }

  eventsPath(agentId: string, sessionId: string): string {
    return join(this.sessionDir(agentId, sessionId), "events.jsonl")
  }

  sessionRuntimeDir(agentId: string, sessionId: string): string {
    return join(this.sessionDir(agentId, sessionId), "runtime")
  }

  wakeLeasePath(agentId: string, sessionId: string): string {
    return join(this.sessionDir(agentId, sessionId), "wake.lock")
  }

  private runnableSessionsPath(agentId: string): string {
    return join(this.agentRuntimeDir(agentId), "runnable-sessions.json")
  }

  private activeWakeLeasesPath(agentId: string): string {
    return join(this.agentRuntimeDir(agentId), "active-wake-leases.json")
  }

  async createSession(input: CreateSessionInput): Promise<Session> {
    return this.createSessionInternal(input, false)
  }

  private async createSessionInternal(
    input: CreateSessionInput,
    skipMigration: boolean,
  ): Promise<Session> {
    if (!skipMigration) {
      await this.migrateLegacyAgentData(input.agentId)
    }
    const sessionId = input.sessionId && isUuidV7(input.sessionId) ? input.sessionId : makeUuidV7()
    const existing = await this.readSessionIfPresent(input.agentId, sessionId)
    if (existing) {
      return existing
    }

    const createdAt = nowIsoString()
    const resources =
      input.resources ??
      (await buildDefaultSessionResources(this.companyDir, input.agentId, sessionId))
    const session: Session = {
      id: sessionId,
      agentId: input.agentId,
      environmentId: input.environmentId ?? DEFAULT_LOCAL_ENVIRONMENT_ID,
      status: "idle",
      createdAt,
      updatedAt: createdAt,
      usage: {
        turns: 0,
      },
      resources,
      stopReason: "idle",
      pendingCustomToolRequest: null,
      pendingToolConfirmationRequest: null,
      metadata: {},
    }

    await this.writeSession(session)
    return session
  }

  async getSession(sessionId: string): Promise<SessionSnapshot> {
    const location = await this.resolveSessionLocation(sessionId)
    if (!location) {
      throw new Error(`Session ${sessionId} was not found`)
    }

    const [session, journal] = await Promise.all([
      this.readSession(location.agentId, location.sessionId),
      this.readJournal(location.agentId, location.sessionId),
    ])

    return {
      session,
      events: foldEvents(journal),
    }
  }

  async getAgentSession(agentId: string, sessionId: string): Promise<SessionSnapshot> {
    const [session, journal] = await Promise.all([
      this.readSession(agentId, sessionId),
      this.readJournal(agentId, sessionId),
    ])
    return {
      session,
      events: foldEvents(journal),
    }
  }

  async getEvents(sessionId: string): Promise<PendingEvent[]> {
    const snapshot = await this.getSession(sessionId)
    return snapshot.events.filter((event): event is PendingEvent => event.processedAt === null)
  }

  async listEvents(
    sessionId: string,
    options: ListSessionEventsOptions = {},
  ): Promise<SessionEvent[]> {
    const snapshot = await this.getSession(sessionId)
    const allEvents = snapshot.events
    const aroundIndex =
      options.aroundEventId && options.aroundEventId.trim().length > 0
        ? allEvents.findIndex((event) => event.id === options.aroundEventId)
        : -1
    const selected =
      aroundIndex >= 0
        ? allEvents.slice(
            Math.max(
              0,
              aroundIndex -
                (typeof options.beforeLimit === "number" &&
                Number.isFinite(options.beforeLimit) &&
                options.beforeLimit > 0
                  ? Math.floor(options.beforeLimit)
                  : 0),
            ),
            Math.min(
              allEvents.length,
              aroundIndex +
                1 +
                (typeof options.afterLimit === "number" &&
                Number.isFinite(options.afterLimit) &&
                options.afterLimit > 0
                  ? Math.floor(options.afterLimit)
                  : 0),
            ),
          )
        : (() => {
            const afterIndex =
              options.afterEventId && options.afterEventId.trim().length > 0
                ? allEvents.findIndex((event) => event.id === options.afterEventId)
                : -1
            const beforeIndex =
              options.beforeEventId && options.beforeEventId.trim().length > 0
                ? allEvents.findIndex((event) => event.id === options.beforeEventId)
                : -1
            const startIndex = afterIndex >= 0 ? afterIndex + 1 : 0
            const endIndex = beforeIndex >= 0 ? beforeIndex : allEvents.length
            return allEvents.slice(startIndex, Math.max(startIndex, endIndex))
          })()
    const filtered =
      options.includeProcessed === false
        ? selected.filter((event) => event.processedAt === null)
        : selected
    const typeFiltered =
      Array.isArray(options.types) && options.types.length > 0
        ? filtered.filter((event) => options.types?.includes(event.type))
        : filtered
    const wakeFiltered =
      typeof options.wakeId === "string" && options.wakeId.trim().length > 0
        ? typeFiltered.filter((event) => event.wakeId === options.wakeId)
        : typeFiltered

    const limit =
      typeof options.limit === "number" && Number.isFinite(options.limit) && options.limit > 0
        ? Math.floor(options.limit)
        : null
    return limit === null ? wakeFiltered : wakeFiltered.slice(-limit)
  }

  async listSessionJournalEvents(agentId: string, sessionId: string): Promise<SessionEvent[]> {
    return foldEvents(await this.readJournal(agentId, sessionId))
  }

  async emitEvent(sessionId: string, event: SessionEvent): Promise<void> {
    const location = await this.resolveSessionLocation(sessionId)
    if (!location) {
      throw new Error(`Session ${sessionId} was not found`)
    }

    await this.withSessionMutationLock(location.agentId, location.sessionId, async () => {
      const session = await this.readSession(location.agentId, location.sessionId)
      const journal = await this.readJournal(location.agentId, location.sessionId)
      this.assertResumeIngressIsCurrent(session, journal, event)

      await this.appendEvent(location.agentId, location.sessionId, event)
      if (!shouldMarkSessionRunnable(event)) {
        return
      }

      if (session.status !== "running" && session.status !== "terminated") {
        await this.writeSession({
          ...session,
          status: "rescheduling",
          stopReason: "rescheduling",
          updatedAt: event.createdAt,
        })
      }
      await this.setRunnableSessionIndexEntry(location.agentId, location.sessionId, event.type)
    })
  }

  async markProcessed(
    sessionId: string,
    eventIds: string[],
    processedAt = nowIsoString(),
  ): Promise<void> {
    const location = await this.resolveSessionLocation(sessionId)
    if (!location) {
      throw new Error(`Session ${sessionId} was not found`)
    }

    await this.withSessionMutationLock(location.agentId, location.sessionId, async () => {
      const uniqueIds = [...new Set(eventIds.filter((value) => value.trim().length > 0))]
      for (const eventId of uniqueIds) {
        await appendJsonl(this.eventsPath(location.agentId, location.sessionId), {
          kind: "session.event.processed",
          sessionId,
          eventId,
          processedAt,
        } satisfies SessionEventProcessedMarker)
      }
      if (uniqueIds.length > 0) {
        await this.touchSession(location.agentId, location.sessionId, processedAt)
        await this.refreshRunnableSessionIndexFromJournal(location.agentId, location.sessionId)
      }
    })
  }

  async updateSession(sessionId: string, mutate: (session: Session) => Session): Promise<Session> {
    const location = await this.resolveSessionLocation(sessionId)
    if (!location) {
      throw new Error(`Session ${sessionId} was not found`)
    }

    return this.withSessionMutationLock(location.agentId, location.sessionId, async () => {
      const session = await this.readSession(location.agentId, location.sessionId)
      const next = mutate(session)
      await this.writeSession(next)
      return next
    })
  }

  async listAgentSessions(agentId: string): Promise<Session[]> {
    await this.migrateLegacyAgentData(agentId)
    const entries = await readdir(this.sessionsDir(agentId), { withFileTypes: true }).catch(
      () => [],
    )
    const sessions = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => this.readSession(agentId, entry.name)),
    )

    return sessions.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
  }

  async listAgentSessionIds(agentId: string): Promise<string[]> {
    await this.migrateLegacyAgentData(agentId)
    const entries = await readdir(this.sessionsDir(agentId), { withFileTypes: true }).catch(
      () => [],
    )
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right))
  }

  async listRunnableSessionIds(agentId: string): Promise<string[]> {
    const runnable = await this.listRunnableSessions(agentId)
    return runnable.map((entry) => entry.sessionId)
  }

  async listRunnableSessions(agentId: string): Promise<RunnableSessionIndexEntry[]> {
    return this.readRunnableSessionIndex(agentId)
  }

  async deferRunnableSession(sessionId: string, deferUntil: string): Promise<void> {
    const location = await this.resolveSessionLocation(sessionId)
    if (!location) {
      throw new Error(`Session ${sessionId} was not found`)
    }
    await this.withSessionMutationLock(location.agentId, location.sessionId, async () => {
      const pendingEventType =
        foldEvents(await this.readJournal(location.agentId, location.sessionId)).find((event) =>
          shouldMarkSessionRunnable(event),
        )?.type ?? null
      if (!pendingEventType) {
        return
      }
      await this.syncRunnableSessionIndex(
        location.agentId,
        location.sessionId,
        "rescheduling",
        pendingEventType,
        deferUntil,
        null,
      )
    })
  }

  async backoffRunnableSession(
    sessionId: string,
    options: {
      baseDelayMs?: number
      maxDelayMs?: number
      now?: string
    } = {},
  ): Promise<{
    deferUntil: string
    failureStreak: number
    delayMs: number
  }> {
    const location = await this.resolveSessionLocation(sessionId)
    if (!location) {
      throw new Error(`Session ${sessionId} was not found`)
    }
    return this.withSessionMutationLock(location.agentId, location.sessionId, async () => {
      const currentRunnable = (await this.readRunnableSessionIndex(location.agentId)).find(
        (entry) => entry.sessionId === location.sessionId,
      )
      const pendingEventType =
        foldEvents(await this.readJournal(location.agentId, location.sessionId)).find((event) =>
          shouldMarkSessionRunnable(event),
        )?.type ?? null
      if (!pendingEventType) {
        return {
          deferUntil: options.now ?? nowIsoString(),
          failureStreak: 0,
          delayMs: 0,
        }
      }
      const baseDelayMs = Math.max(
        1,
        options.baseDelayMs ?? DEFAULT_RUNNABLE_FAILURE_BACKOFF_BASE_MS,
      )
      const maxDelayMs = Math.max(
        baseDelayMs,
        options.maxDelayMs ?? DEFAULT_RUNNABLE_FAILURE_BACKOFF_MAX_MS,
      )
      const failureStreak = Math.max(1, (currentRunnable?.failureStreak ?? 0) + 1)
      const delayMs = Math.min(maxDelayMs, baseDelayMs * 2 ** (failureStreak - 1))
      const now = options.now ?? nowIsoString()
      const deferUntil = new Date(Date.parse(now) + delayMs).toISOString()
      await this.syncRunnableSessionIndex(
        location.agentId,
        location.sessionId,
        "rescheduling",
        pendingEventType,
        deferUntil,
        failureStreak,
      )
      return {
        deferUntil,
        failureStreak,
        delayMs,
      }
    })
  }

  async reconcileRunnableSession(agentId: string, sessionId: string): Promise<void> {
    await this.refreshRunnableSessionIndexFromJournal(agentId, sessionId)
  }

  async acquireWakeLease(
    sessionId: string,
    owner: string,
    options: {
      staleAfterMs?: number
    } = {},
  ): Promise<SessionWakeLease | null> {
    const location = await this.resolveSessionLocation(sessionId)
    if (!location) {
      throw new Error(`Session ${sessionId} was not found`)
    }
    const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_WAKE_LEASE_MS
    const lockPath = this.wakeLeasePath(location.agentId, location.sessionId)
    await mkdir(dirname(lockPath), { recursive: true })
    const record = await this.tryAcquireLeaseRecord(lockPath, sessionId, owner, staleAfterMs, {
      treatInvalidAsStale: false,
    })
    if (!record) {
      return null
    }
    await this.syncActiveWakeLeaseIndex(location.agentId, location.sessionId, record.acquiredAt)
    let released = false
    return {
      renew: async () => {
        if (released) {
          return
        }
        const renewed = buildWakeLeaseRecord(sessionId, owner)
        const updated = await this.writeWakeLeaseIfOwned(lockPath, owner, renewed)
        if (!updated) {
          released = true
          await this.syncActiveWakeLeaseIndex(location.agentId, location.sessionId, null)
          return
        }
        await this.syncActiveWakeLeaseIndex(
          location.agentId,
          location.sessionId,
          renewed.acquiredAt,
        )
      },
      release: async () => {
        if (released) {
          return
        }
        released = true
        const removed = await this.removeWakeLeaseIfOwned(lockPath, owner)
        if (removed) {
          await this.syncActiveWakeLeaseIndex(location.agentId, location.sessionId, null)
        }
      },
    }
  }

  async listActiveWakeLeaseSessionIds(
    agentId: string,
    options: {
      staleAfterMs?: number
    } = {},
  ): Promise<string[]> {
    return this.withAgentRuntimeIndexLock(agentId, "active-wake-leases", async () => {
      const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_WAKE_LEASE_MS
      const current = await this.readActiveWakeLeaseIndex(agentId)
      const confirmed: ActiveWakeLeaseIndexEntry[] = []
      const activeSessionIds: string[] = []
      for (const entry of current) {
        const ageMs = Date.now() - Date.parse(entry.acquiredAt)
        if (!Number.isFinite(ageMs) || ageMs >= staleAfterMs) {
          await rm(this.wakeLeasePath(agentId, entry.sessionId), { force: true }).catch(
            () => undefined,
          )
          continue
        }
        confirmed.push(entry)
        activeSessionIds.push(entry.sessionId)
      }
      if (!sameActiveWakeLeaseEntries(current, confirmed)) {
        await this.writeActiveWakeLeaseIndex(agentId, confirmed)
      }
      return activeSessionIds
    })
  }

  async hasActiveWakeLease(
    agentId: string,
    sessionId: string,
    options: {
      staleAfterMs?: number
    } = {},
  ): Promise<boolean> {
    const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_WAKE_LEASE_MS
    const lockPath = this.wakeLeasePath(agentId, sessionId)
    const lease = await this.readWakeLease(lockPath)
    if (!lease?.acquiredAt) {
      return false
    }
    const ageMs = Date.now() - Date.parse(lease.acquiredAt)
    if (!Number.isFinite(ageMs) || ageMs >= staleAfterMs) {
      await rm(lockPath, { force: true }).catch(() => undefined)
      return false
    }
    return true
  }

  async getSessionExecutionRuntimeState(
    sessionId: string,
    options: {
      staleAfterMs?: number
    } = {},
  ): Promise<SessionExecutionRuntimeState> {
    const location = await this.resolveSessionLocation(sessionId)
    if (!location) {
      throw new Error(`Session ${sessionId} was not found`)
    }
    return this.getSessionExecutionRuntimeStateForAgentSession(
      location.agentId,
      location.sessionId,
      options,
    )
  }

  async getSessionExecutionRuntimeStateForAgentSession(
    agentId: string,
    sessionId: string,
    options: {
      staleAfterMs?: number
    } = {},
  ): Promise<SessionExecutionRuntimeState> {
    const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_WAKE_LEASE_MS
    const [runnableEntries, activeWakeLease] = await Promise.all([
      this.readRunnableSessionIndex(agentId),
      this.readActiveWakeLeaseForAgentSession(agentId, sessionId, staleAfterMs),
    ])
    const runnable = runnableEntries.find((entry) => entry.sessionId === sessionId) ?? null
    return {
      sessionId,
      agentId,
      runnablePendingEventType: runnable?.pendingEventType ?? null,
      deferUntil: runnable?.deferUntil ?? null,
      failureStreak: runnable?.failureStreak ?? 0,
      activeWakeLease,
    }
  }

  private async readWakeLease(lockPath: string): Promise<SessionWakeLeaseRecord | null> {
    try {
      return parseWakeLeaseRecord(await readFile(lockPath, "utf8"))
    } catch {
      return null
    }
  }

  private async tryAcquireLeaseRecord(
    lockPath: string,
    scopeId: string,
    owner: string,
    staleAfterMs: number,
    options: {
      treatInvalidAsStale: boolean
    },
  ): Promise<SessionWakeLeaseRecord | null> {
    const record = buildWakeLeaseRecord(scopeId, owner)
    const lockSuffix = sanitizeLockSuffix(owner)
    const candidatePath = `${lockPath}.${lockSuffix}.candidate`
    const retiredPath = `${lockPath}.${lockSuffix}.stale`
    let handle: FileHandle | null = null
    try {
      handle = await open(candidatePath, "wx", 0o600)
      await writeWakeLeaseRecordToHandle(handle, record)
    } finally {
      await handle?.close().catch(() => undefined)
    }

    const linkCandidate = async (): Promise<boolean> => {
      try {
        await link(candidatePath, lockPath)
        return true
      } catch (error) {
        if (hasErrorCode(error, "EEXIST") || hasErrorCode(error, "ENOENT")) {
          return false
        }
        throw error
      }
    }

    try {
      if (await linkCandidate()) {
        return record
      }

      const current = await this.readWakeLease(lockPath)
      if (!isWakeLeaseStale(current, staleAfterMs, options.treatInvalidAsStale)) {
        return null
      }

      try {
        await rename(lockPath, retiredPath)
      } catch (error) {
        if (hasErrorCode(error, "ENOENT") || hasErrorCode(error, "EEXIST")) {
          return null
        }
        throw error
      }

      return (await linkCandidate()) ? record : null
    } finally {
      await rm(candidatePath, { force: true }).catch(() => undefined)
      await rm(retiredPath, { force: true }).catch(() => undefined)
    }
  }

  private async writeWakeLeaseIfOwned(
    lockPath: string,
    owner: string,
    record: SessionWakeLeaseRecord,
  ): Promise<boolean> {
    let handle: FileHandle | null = null
    try {
      handle = await open(lockPath, "r+")
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
        return false
      }
      throw error
    }

    try {
      const current = await readWakeLeaseRecordFromHandle(handle)
      if (current?.owner !== owner) {
        return false
      }
      await writeWakeLeaseRecordToHandle(handle, record)
      return true
    } finally {
      await handle.close()
    }
  }

  private async removeWakeLeaseIfOwned(lockPath: string, owner: string): Promise<boolean> {
    const current = await this.readWakeLease(lockPath)
    if (current?.owner !== owner) {
      return false
    }
    await rm(lockPath, { force: true }).catch(() => undefined)
    return true
  }

  private async readActiveWakeLeaseForAgentSession(
    agentId: string,
    sessionId: string,
    staleAfterMs: number,
  ): Promise<{
    owner: string
    acquiredAt: string
  } | null> {
    const lockPath = this.wakeLeasePath(agentId, sessionId)
    const lease = await this.readWakeLease(lockPath)
    if (!lease?.acquiredAt) {
      return null
    }
    const ageMs = Date.now() - Date.parse(lease.acquiredAt)
    if (!Number.isFinite(ageMs) || ageMs >= staleAfterMs) {
      await rm(lockPath, { force: true }).catch(() => undefined)
      await this.syncActiveWakeLeaseIndex(agentId, sessionId, null)
      return null
    }
    return {
      owner: lease.owner,
      acquiredAt: lease.acquiredAt,
    }
  }

  private async withSessionMutationLock<T>(
    agentId: string,
    sessionId: string,
    fn: () => Promise<T>,
    options: {
      staleAfterMs?: number
      timeoutMs?: number
    } = {},
  ): Promise<T> {
    const staleAfterMs = options.staleAfterMs ?? DEFAULT_SESSION_MUTATION_LOCK_STALE_MS
    const timeoutMs = options.timeoutMs ?? DEFAULT_SESSION_MUTATION_LOCK_TIMEOUT_MS
    const lockPath = this.sessionMutationLockPath(agentId, sessionId)
    await mkdir(dirname(lockPath), { recursive: true })
    const owner = makeUuidV7()
    const startedAt = Date.now()

    while (true) {
      const record = await this.tryAcquireLeaseRecord(lockPath, sessionId, owner, staleAfterMs, {
        treatInvalidAsStale: true,
      })
      if (record) {
        break
      }
      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(
          `Timed out acquiring session mutation lock for ${sessionId} after ${timeoutMs}ms`,
        )
      }
      await new Promise((resolve) => setTimeout(resolve, SESSION_MUTATION_LOCK_RETRY_MS))
    }

    try {
      return await fn()
    } finally {
      const current = await this.readWakeLease(lockPath)
      if (current?.owner === owner) {
        await rm(lockPath, { force: true }).catch(() => undefined)
      }
    }
  }

  private async withAgentRuntimeIndexLock<T>(
    agentId: string,
    scope: "runnable-sessions" | "active-wake-leases",
    fn: () => Promise<T>,
    options: {
      staleAfterMs?: number
      timeoutMs?: number
    } = {},
  ): Promise<T> {
    const staleAfterMs = options.staleAfterMs ?? DEFAULT_AGENT_RUNTIME_INDEX_LOCK_STALE_MS
    const timeoutMs = options.timeoutMs ?? DEFAULT_AGENT_RUNTIME_INDEX_LOCK_TIMEOUT_MS
    const lockPath = this.agentRuntimeIndexLockPath(agentId, scope)
    await mkdir(dirname(lockPath), { recursive: true })
    const owner = makeUuidV7()
    const startedAt = Date.now()

    while (true) {
      const record = await this.tryAcquireLeaseRecord(lockPath, scope, owner, staleAfterMs, {
        treatInvalidAsStale: true,
      })
      if (record) {
        break
      }
      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(
          `Timed out acquiring agent runtime index lock for ${agentId}/${scope} after ${timeoutMs}ms`,
        )
      }
      await new Promise((resolve) => setTimeout(resolve, AGENT_RUNTIME_INDEX_LOCK_RETRY_MS))
    }

    try {
      return await fn()
    } finally {
      const current = await this.readWakeLease(lockPath)
      if (current?.owner === owner) {
        await rm(lockPath, { force: true }).catch(() => undefined)
      }
    }
  }

  private async readActiveWakeLeaseIndex(agentId: string): Promise<ActiveWakeLeaseIndexEntry[]> {
    try {
      const raw = await readFile(this.activeWakeLeasesPath(agentId), "utf8")
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) {
        return []
      }
      return parsed.flatMap((value): ActiveWakeLeaseIndexEntry[] => {
        if (
          value &&
          typeof value === "object" &&
          typeof (value as Record<string, unknown>).sessionId === "string" &&
          typeof (value as Record<string, unknown>).acquiredAt === "string"
        ) {
          return [
            {
              sessionId: (value as Record<string, string>).sessionId,
              acquiredAt: (value as Record<string, string>).acquiredAt,
            },
          ]
        }
        return []
      })
    } catch {
      return []
    }
  }

  private async writeActiveWakeLeaseIndex(
    agentId: string,
    entries: ActiveWakeLeaseIndexEntry[],
  ): Promise<void> {
    const runtimeDir = this.agentRuntimeDir(agentId)
    await mkdir(runtimeDir, { recursive: true })
    const tempPath = join(runtimeDir, `active-wake-leases.${makeUuidV7()}.tmp`)
    const unique = dedupeActiveWakeLeaseEntries(entries)
    await writeFile(tempPath, `${JSON.stringify(unique, null, 2)}\n`, "utf8")
    await rename(tempPath, this.activeWakeLeasesPath(agentId))
    this.runtimeIndexEvents.emit(runtimeIndexEventName(agentId))
  }

  private async syncActiveWakeLeaseIndex(
    agentId: string,
    sessionId: string,
    acquiredAt: string | null,
  ): Promise<void> {
    await this.withAgentRuntimeIndexLock(agentId, "active-wake-leases", async () => {
      const current = await this.readActiveWakeLeaseIndex(agentId)
      const next =
        typeof acquiredAt === "string" && acquiredAt.trim().length > 0
          ? dedupeActiveWakeLeaseEntries([
              ...current.filter((entry) => entry.sessionId !== sessionId),
              { sessionId, acquiredAt },
            ])
          : current.filter((entry) => entry.sessionId !== sessionId)
      if (sameActiveWakeLeaseEntries(current, next)) {
        return
      }
      await this.writeActiveWakeLeaseIndex(agentId, next)
    })
  }

  onAgentRuntimeIndexChanged(agentId: string, listener: () => void): () => void {
    const eventName = runtimeIndexEventName(agentId)
    this.runtimeIndexEvents.on(eventName, listener)
    return () => this.runtimeIndexEvents.off(eventName, listener)
  }

  async migrateLegacyAgentData(agentId: string): Promise<void> {
    const sessionsDir = this.sessionsDir(agentId)
    const entries = await readdir(sessionsDir, {
      withFileTypes: true,
      encoding: "utf8",
    }).catch(() => [] as Dirent[])
    const defaultRuntimeSessionId = await this.migrateLegacySessionFiles(agentId, entries)
    await this.migrateLegacyRuntimeFiles(agentId, defaultRuntimeSessionId)
  }

  private async migrateLegacySessionFiles(
    agentId: string,
    entries: Dirent[],
  ): Promise<string | null> {
    let runtimeSessionId: string | null = null
    const legacyDir = join(this.agentDir(agentId), "legacy-sessions")
    await mkdir(legacyDir, { recursive: true })

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
        continue
      }

      const filePath = join(this.sessionsDir(agentId), entry.name)
      const legacy = await readJsonl<LegacySessionRecord>(filePath)
      const fileStem = basename(entry.name, ".jsonl")
      const targetSessionId = this.resolveMigrationSessionId(fileStem, legacy)
      const existing = await this.readSessionIfPresent(agentId, targetSessionId)
      if (!existing) {
        await this.createSessionInternal(
          {
            agentId,
            sessionId: targetSessionId,
            environmentId: DEFAULT_LOCAL_ENVIRONMENT_ID,
          },
          true,
        )
      }

      const currentEvents = await this.readJournal(agentId, targetSessionId)
      if (currentEvents.length === 0) {
        for (const record of legacy) {
          await this.appendEvent(agentId, targetSessionId, {
            id: `legacy:${record.checkpoint.checkpointId}:user`,
            type: "user.message",
            createdAt: record.checkpoint.createdAt,
            processedAt: record.checkpoint.createdAt,
            message: record.requestMessage,
          })
          await this.appendEvent(agentId, targetSessionId, {
            id: `legacy:${record.checkpoint.checkpointId}:agent`,
            type: "agent.message",
            createdAt: record.checkpoint.createdAt,
            processedAt: record.checkpoint.createdAt,
            message: record.responseMessage,
            summary: normalizeOptionalText(record.responseMessage) ?? "Legacy migrated response.",
          })
        }

        const latest = legacy.at(-1) ?? null
        if (latest) {
          const session = await this.readSession(agentId, targetSessionId)
          await this.writeSession({
            ...session,
            usage: {
              turns: legacy.length,
            },
            updatedAt: latest.checkpoint.createdAt,
            metadata: {
              ...session.metadata,
              ...this.legacyMetadata(latest),
            },
          })
        }
      }

      if (fileStem === "agent-runtime" || runtimeSessionId === null) {
        runtimeSessionId = targetSessionId
      }

      await rename(filePath, join(legacyDir, entry.name)).catch(() => undefined)
    }

    return runtimeSessionId
  }

  private legacyMetadata(record: LegacySessionRecord): SessionMetadata {
    const provider = record.provider === "claude-cli" ? "claude-cli" : "openai-codex"
    const metadata: SessionMetadata = {
      lastProvider: provider,
      lastModel: record.model,
      lastRunner:
        record.runner === "cli" || record.runner === "embedded" ? record.runner : undefined,
      providerSessionBindings: {},
    }

    if (record.cliSessionBindings && typeof record.cliSessionBindings === "object") {
      for (const [key, value] of Object.entries(record.cliSessionBindings)) {
        if (
          (key === "openai-codex" || key === "claude-cli") &&
          value &&
          typeof value === "object"
        ) {
          metadata.providerSessionBindings ??= {}
          metadata.providerSessionBindings[key as "openai-codex" | "claude-cli"] =
            value as NonNullable<SessionMetadata["providerSessionBindings"]>["openai-codex"]
        }
      }
    }

    return metadata
  }

  private resolveMigrationSessionId(fileStem: string, records: LegacySessionRecord[]): string {
    const latestRecord = records.at(-1) ?? null
    if (latestRecord && isUuidV7(latestRecord.sessionId)) {
      return latestRecord.sessionId
    }
    if (isUuidV7(fileStem)) {
      return fileStem
    }
    return makeUuidV7()
  }

  private async migrateLegacyRuntimeFiles(
    agentId: string,
    preferredSessionId: string | null,
  ): Promise<void> {
    const runtimeDir = join(this.agentDir(agentId), "runtime")
    const legacyFiles = ["checkpoint.json", "session-state.md", "working-buffer.md"]
    const present = await Promise.all(
      legacyFiles.map(async (name) => {
        try {
          await stat(join(runtimeDir, name))
          return name
        } catch {
          return null
        }
      }),
    )
    const sourceFiles = present.filter((value): value is string => value !== null)
    if (sourceFiles.length === 0) {
      return
    }

    let sessionId = preferredSessionId
    if (!sessionId) {
      const sessions = await this.listAgentSessions(agentId)
      sessionId = sessions[0]?.id ?? null
    }
    if (!sessionId) {
      const created = await this.createSessionInternal(
        {
          agentId,
          sessionId: makeUuidV7(),
          environmentId: DEFAULT_LOCAL_ENVIRONMENT_ID,
        },
        true,
      )
      sessionId = created.id
    }

    const targetRuntimeDir = this.sessionRuntimeDir(agentId, sessionId)
    await mkdir(targetRuntimeDir, { recursive: true })

    for (const fileName of sourceFiles) {
      const sourcePath = join(runtimeDir, fileName)
      const targetPath = join(targetRuntimeDir, fileName)
      try {
        await stat(targetPath)
        continue
      } catch {
        // keep moving
      }
      await rename(sourcePath, targetPath).catch(() => undefined)
    }
  }

  private async resolveSessionLocation(
    sessionId: string,
  ): Promise<{ agentId: string; sessionId: string } | null> {
    const entries = await readdir(this.agentsDir(), { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue
      }

      const agentId = entry.name
      await this.migrateLegacyAgentData(agentId)
      try {
        const sessionStats = await stat(this.sessionPath(agentId, sessionId))
        if (sessionStats.isFile()) {
          return { agentId, sessionId }
        }
      } catch {}
    }

    return null
  }

  private async readSession(agentId: string, sessionId: string): Promise<Session> {
    const raw = await readFile(this.sessionPath(agentId, sessionId), "utf8")
    const parsed = JSON.parse(raw) as Session
    return {
      ...parsed,
      pendingCustomToolRequest: parsed.pendingCustomToolRequest ?? null,
      pendingToolConfirmationRequest: parsed.pendingToolConfirmationRequest ?? null,
    }
  }

  private async readSessionIfPresent(agentId: string, sessionId: string): Promise<Session | null> {
    try {
      return await this.readSession(agentId, sessionId)
    } catch {
      return null
    }
  }

  private async readJournal(
    agentId: string,
    sessionId: string,
  ): Promise<SessionEventJournalRecord[]> {
    return readJsonl<SessionEventJournalRecord>(this.eventsPath(agentId, sessionId))
  }

  private assertResumeIngressIsCurrent(
    session: Session,
    journal: SessionEventJournalRecord[],
    event: SessionEvent,
  ): void {
    if (event.type === "user.tool_confirmation") {
      const pending = session.pendingToolConfirmationRequest
      if (!pending) {
        throw new Error(
          `Session ${session.id} does not have a pending tool confirmation request for ${event.toolName}`,
        )
      }
      if (pending.id !== event.requestId || pending.toolName !== event.toolName) {
        throw new Error(
          `Session ${session.id} pending tool confirmation request does not match ${event.requestId}/${event.toolName}`,
        )
      }
      const duplicate = journal.some(
        (entry) =>
          entry.kind === "session.event.appended" &&
          entry.event.type === "user.tool_confirmation" &&
          entry.event.requestId === event.requestId &&
          entry.event.toolName === event.toolName,
      )
      if (duplicate) {
        throw new Error(
          `Session ${session.id} already recorded a tool confirmation for ${event.requestId}`,
        )
      }
      return
    }

    if (event.type === "user.custom_tool_result") {
      const pending = session.pendingCustomToolRequest
      if (!pending) {
        throw new Error(
          `Session ${session.id} does not have a pending custom tool request for ${event.toolName}`,
        )
      }
      if (pending.id !== event.requestId || pending.name !== event.toolName) {
        throw new Error(
          `Session ${session.id} pending custom tool request does not match ${event.requestId}/${event.toolName}`,
        )
      }
      const duplicate = journal.some(
        (entry) =>
          entry.kind === "session.event.appended" &&
          entry.event.type === "user.custom_tool_result" &&
          entry.event.requestId === event.requestId &&
          entry.event.toolName === event.toolName,
      )
      if (duplicate) {
        throw new Error(
          `Session ${session.id} already recorded a custom tool result for ${event.requestId}`,
        )
      }
    }
  }

  private async appendEvent(
    agentId: string,
    sessionId: string,
    event: SessionEvent,
  ): Promise<void> {
    const journal = await this.readJournal(agentId, sessionId)
    if (
      journal.some(
        (entry) => entry.kind === "session.event.appended" && entry.event.id === event.id,
      )
    ) {
      return
    }

    await appendJsonl(this.eventsPath(agentId, sessionId), {
      kind: "session.event.appended",
      sessionId,
      event,
    } satisfies SessionEventEnvelope)
    await this.touchSession(agentId, sessionId, event.createdAt)
  }

  private async writeSession(session: Session): Promise<void> {
    const sessionPath = this.sessionPath(session.agentId, session.id)
    const sessionDir = dirname(sessionPath)
    await mkdir(sessionDir, { recursive: true })
    await mkdir(this.sessionRuntimeDir(session.agentId, session.id), { recursive: true })
    await ensureSessionExecutionWorkspace(this.companyDir, session.agentId, session.id, {
      environmentId: session.environmentId,
      resources: session.resources,
    })
    const tempPath = join(sessionDir, `${session.id}.${makeUuidV7()}.tmp`)
    await writeFile(tempPath, `${JSON.stringify(session, null, 2)}\n`, "utf8")
    await rename(tempPath, sessionPath)
  }

  private async touchSession(
    agentId: string,
    sessionId: string,
    updatedAt = nowIsoString(),
  ): Promise<void> {
    const session = await this.readSession(agentId, sessionId)
    await this.writeSession({
      ...session,
      updatedAt,
    })
  }

  private sessionMutationLockPath(agentId: string, sessionId: string): string {
    return join(this.sessionRuntimeDir(agentId, sessionId), "locks", "session-mutation.lock")
  }

  private agentRuntimeIndexLockPath(
    agentId: string,
    scope: "runnable-sessions" | "active-wake-leases",
  ): string {
    return join(this.agentRuntimeDir(agentId), "locks", `${scope}.lock`)
  }

  private async readRunnableSessionIndex(agentId: string): Promise<RunnableSessionIndexEntry[]> {
    try {
      const raw = await readFile(this.runnableSessionsPath(agentId), "utf8")
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) {
        return []
      }
      return parsed.flatMap((value): RunnableSessionIndexEntry[] => {
        if (typeof value === "string" && value.trim().length > 0) {
          return [{ sessionId: value, pendingEventType: null, deferUntil: null, failureStreak: 0 }]
        }
        if (
          value &&
          typeof value === "object" &&
          typeof (value as Record<string, unknown>).sessionId === "string"
        ) {
          const pendingEventType =
            typeof (value as Record<string, unknown>).pendingEventType === "string"
              ? ((value as Record<string, string>).pendingEventType as SessionEventType)
              : null
          const deferUntil =
            typeof (value as Record<string, unknown>).deferUntil === "string"
              ? ((value as Record<string, string>).deferUntil ?? null)
              : null
          const failureStreak =
            typeof (value as Record<string, unknown>).failureStreak === "number" &&
            Number.isFinite((value as Record<string, number>).failureStreak)
              ? Math.max(0, Math.trunc((value as Record<string, number>).failureStreak))
              : 0
          return [
            {
              sessionId: (value as Record<string, string>).sessionId,
              pendingEventType,
              deferUntil,
              failureStreak,
            },
          ]
        }
        return []
      })
    } catch {
      return []
    }
  }

  private async writeRunnableSessionIndex(
    agentId: string,
    entries: RunnableSessionIndexEntry[],
  ): Promise<void> {
    const runtimeDir = join(this.agentDir(agentId), "runtime")
    const path = this.runnableSessionsPath(agentId)
    await mkdir(runtimeDir, { recursive: true })
    const tempPath = join(runtimeDir, `runnable-sessions.${makeUuidV7()}.tmp`)
    const unique = dedupeRunnableEntries(entries)
    await writeFile(tempPath, `${JSON.stringify(unique, null, 2)}\n`, "utf8")
    await rename(tempPath, path)
    this.runtimeIndexEvents.emit(runtimeIndexEventName(agentId))
  }

  private async syncRunnableSessionIndex(
    agentId: string,
    sessionId: string,
    status: Session["status"],
    pendingEventType: SessionEventType | null = null,
    deferUntil: string | null = null,
    failureStreak: number | null = null,
  ): Promise<void> {
    await this.withAgentRuntimeIndexLock(agentId, "runnable-sessions", async () => {
      const current = await this.readRunnableSessionIndex(agentId)
      const previous = current.find((entry) => entry.sessionId === sessionId) ?? null
      const next =
        status === "rescheduling"
          ? dedupeRunnableEntries([
              ...current.filter((entry) => entry.sessionId !== sessionId),
              {
                sessionId,
                pendingEventType,
                deferUntil,
                failureStreak:
                  typeof failureStreak === "number"
                    ? Math.max(0, Math.trunc(failureStreak))
                    : (previous?.failureStreak ?? 0),
              },
            ])
          : current.filter((entry) => entry.sessionId !== sessionId)
      if (sameRunnableEntries(current, next)) {
        return
      }
      await this.writeRunnableSessionIndex(agentId, next)
    })
  }

  private async setRunnableSessionIndexEntry(
    agentId: string,
    sessionId: string,
    pendingEventType: SessionEventType,
  ): Promise<void> {
    await this.syncRunnableSessionIndex(
      agentId,
      sessionId,
      "rescheduling",
      pendingEventType,
      null,
      0,
    )
  }

  private async refreshRunnableSessionIndexFromJournal(
    agentId: string,
    sessionId: string,
  ): Promise<void> {
    const pendingEventType =
      foldEvents(await this.readJournal(agentId, sessionId)).find((event) =>
        shouldMarkSessionRunnable(event),
      )?.type ?? null
    const session = await this.readSessionIfPresent(agentId, sessionId)
    const status = pendingEventType && session?.status !== "terminated" ? "rescheduling" : "idle"
    await this.syncRunnableSessionIndex(agentId, sessionId, status, pendingEventType, null, 0)
  }
}

function runtimeIndexEventName(agentId: string): string {
  return `agent-runtime-index:${agentId}`
}

function buildWakeLeaseRecord(sessionId: string, owner: string): SessionWakeLeaseRecord {
  return {
    sessionId,
    owner,
    acquiredAt: nowIsoString(),
  }
}

function parseWakeLeaseRecord(raw: string): SessionWakeLeaseRecord | null {
  try {
    const parsed = JSON.parse(raw) as Partial<SessionWakeLeaseRecord>
    if (
      typeof parsed.sessionId !== "string" ||
      typeof parsed.owner !== "string" ||
      typeof parsed.acquiredAt !== "string"
    ) {
      return null
    }
    return {
      sessionId: parsed.sessionId,
      owner: parsed.owner,
      acquiredAt: parsed.acquiredAt,
    }
  } catch {
    return null
  }
}

function formatWakeLeaseRecord(record: SessionWakeLeaseRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`
}

function sanitizeLockSuffix(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_")
}

function wakeLeaseAgeMs(record: SessionWakeLeaseRecord | null): number {
  return record?.acquiredAt ? Date.now() - Date.parse(record.acquiredAt) : Number.NaN
}

function isWakeLeaseStale(
  record: SessionWakeLeaseRecord | null,
  staleAfterMs: number,
  treatInvalidAsStale: boolean,
): boolean {
  const ageMs = wakeLeaseAgeMs(record)
  if (!Number.isFinite(ageMs)) {
    return treatInvalidAsStale
  }
  return ageMs >= staleAfterMs
}

async function readWakeLeaseRecordFromHandle(
  handle: FileHandle,
): Promise<SessionWakeLeaseRecord | null> {
  return parseWakeLeaseRecord(await handle.readFile("utf8"))
}

async function writeWakeLeaseRecordToHandle(
  handle: FileHandle,
  record: SessionWakeLeaseRecord,
): Promise<void> {
  await handle.truncate(0)
  await handle.write(formatWakeLeaseRecord(record), 0, "utf8")
}

function shouldMarkSessionRunnable(event: SessionEvent): event is PendingEvent {
  return (
    event.processedAt === null &&
    (event.type === "user.message" ||
      event.type === "user.interrupt" ||
      event.type === "user.tool_confirmation" ||
      event.type === "user.custom_tool_result" ||
      event.type === "user.define_outcome")
  )
}

function dedupeRunnableEntries(entries: RunnableSessionIndexEntry[]): RunnableSessionIndexEntry[] {
  const map = new Map<string, RunnableSessionIndexEntry>()
  for (const entry of entries) {
    map.set(entry.sessionId, entry)
  }
  return [...map.values()].sort((left, right) => left.sessionId.localeCompare(right.sessionId))
}

function sameRunnableEntries(
  left: RunnableSessionIndexEntry[],
  right: RunnableSessionIndexEntry[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (entry, index) =>
        entry.sessionId === right[index]?.sessionId &&
        entry.pendingEventType === right[index]?.pendingEventType &&
        entry.deferUntil === right[index]?.deferUntil &&
        entry.failureStreak === right[index]?.failureStreak,
    )
  )
}

function dedupeActiveWakeLeaseEntries(
  entries: ActiveWakeLeaseIndexEntry[],
): ActiveWakeLeaseIndexEntry[] {
  const map = new Map<string, ActiveWakeLeaseIndexEntry>()
  for (const entry of entries) {
    map.set(entry.sessionId, entry)
  }
  return [...map.values()].sort((left, right) => left.sessionId.localeCompare(right.sessionId))
}

function sameActiveWakeLeaseEntries(
  left: ActiveWakeLeaseIndexEntry[],
  right: ActiveWakeLeaseIndexEntry[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (entry, index) =>
        entry.sessionId === right[index]?.sessionId &&
        entry.acquiredAt === right[index]?.acquiredAt,
    )
  )
}

import { join } from "node:path"
import { makeUuidV7 } from "../../foundation/ids.js"
import { appendJsonl, readJsonl } from "../../foundation/storage/jsonl.js"
import { nowIsoString } from "../../foundation/time.js"
import type { SessionStore } from "../sessions/session-store.js"
import type { SessionActivation } from "./session-activation-queue.js"

interface ActivationJournalRecordBase {
  createdAt: string
  claimId: string
  agentId: string
  sessionId: string
  activationKind: SessionActivation["kind"]
  priority: SessionActivation["priority"]
  dueAt: string | null
  reason: string
  note: string | null
  dueWakeIds: string[]
  leaseOwner: string
}

export interface ActivationLeasedRecord extends ActivationJournalRecordBase {
  kind: "activation.leased"
}

export interface ActivationBlockedRecord extends ActivationJournalRecordBase {
  kind: "activation.blocked"
  blockedReason: "lease_contended"
}

export interface ActivationAckedRecord extends ActivationJournalRecordBase {
  kind: "activation.acked"
  wakeId: string | null
  stopReason: string
  queuedWakeIds: string[]
  processedEventIds: string[]
}

export interface ActivationRequeuedRecord extends ActivationJournalRecordBase {
  kind: "activation.requeued"
  immediateRetryAt: string | null
  nextQueuedWakeAt: string | null
  queuedWakeIds: string[]
}

export interface ActivationAbandonedRecord extends ActivationJournalRecordBase {
  kind: "activation.abandoned"
  abandonReason: string
  errorMessage: string | null
}

export type ActivationJournalRecord =
  | ActivationLeasedRecord
  | ActivationBlockedRecord
  | ActivationAckedRecord
  | ActivationRequeuedRecord
  | ActivationAbandonedRecord

export interface ActivationJournalFilters {
  sessionId?: string
  claimId?: string
  kinds?: ActivationJournalRecord["kind"][]
}

export interface ActivationRequeueJournalInput {
  immediateRetryAt: string | null
  nextQueuedWakeAt: string | null
  queuedWakeIds: string[]
}

export interface ActivationAckJournalInput {
  wakeId: string | null
  stopReason: string
  queuedWakeIds: string[]
  processedEventIds: string[]
  requeue?: ActivationRequeueJournalInput | null
}

export interface ActivationAbandonJournalInput {
  reason: string
  errorMessage?: string | null
}

export class ActivationJournal {
  constructor(private readonly sessionStore: SessionStore) {}

  async recordLeased(input: {
    agentId: string
    activation: SessionActivation
    leaseOwner: string
    claimId?: string
  }): Promise<string> {
    const claimId = input.claimId ?? makeUuidV7()
    await this.append({
      ...buildBaseRecord(input.agentId, input.activation, input.leaseOwner, claimId),
      kind: "activation.leased",
    })
    return claimId
  }

  async recordBlocked(input: {
    agentId: string
    activation: SessionActivation
    leaseOwner: string
    blockedReason: "lease_contended"
    claimId?: string
  }): Promise<void> {
    const claimId = input.claimId ?? makeUuidV7()
    await this.append({
      ...buildBaseRecord(input.agentId, input.activation, input.leaseOwner, claimId),
      kind: "activation.blocked",
      blockedReason: input.blockedReason,
    })
  }

  async recordAcked(input: {
    agentId: string
    activation: SessionActivation
    leaseOwner: string
    ack: ActivationAckJournalInput
    claimId?: string
  }): Promise<void> {
    const claimId = input.claimId ?? makeUuidV7()
    await this.append({
      ...buildBaseRecord(input.agentId, input.activation, input.leaseOwner, claimId),
      kind: "activation.acked",
      wakeId: input.ack.wakeId,
      stopReason: input.ack.stopReason,
      queuedWakeIds: [...input.ack.queuedWakeIds],
      processedEventIds: [...input.ack.processedEventIds],
    })
  }

  async recordAbandoned(input: {
    agentId: string
    activation: SessionActivation
    leaseOwner: string
    abandon: ActivationAbandonJournalInput
    claimId?: string
  }): Promise<void> {
    const claimId = input.claimId ?? makeUuidV7()
    await this.append({
      ...buildBaseRecord(input.agentId, input.activation, input.leaseOwner, claimId),
      kind: "activation.abandoned",
      abandonReason: input.abandon.reason,
      errorMessage: input.abandon.errorMessage ?? null,
    })
  }

  async recordRequeued(input: {
    agentId: string
    activation: SessionActivation
    leaseOwner: string
    requeue: ActivationRequeueJournalInput
    claimId?: string
  }): Promise<void> {
    const claimId = input.claimId ?? makeUuidV7()
    await this.append({
      ...buildBaseRecord(input.agentId, input.activation, input.leaseOwner, claimId),
      kind: "activation.requeued",
      immediateRetryAt: input.requeue.immediateRetryAt,
      nextQueuedWakeAt: input.requeue.nextQueuedWakeAt,
      queuedWakeIds: [...input.requeue.queuedWakeIds],
    })
  }

  async list(agentId: string): Promise<ActivationJournalRecord[]> {
    return readJsonl<ActivationJournalRecord>(this.path(agentId))
  }

  async listMatching(
    agentId: string,
    filters: ActivationJournalFilters = {},
  ): Promise<ActivationJournalRecord[]> {
    const records = await this.list(agentId)
    return records.filter((record) => {
      if (filters.sessionId && record.sessionId !== filters.sessionId) {
        return false
      }
      if (filters.claimId && record.claimId !== filters.claimId) {
        return false
      }
      if (filters.kinds && filters.kinds.length > 0 && !filters.kinds.includes(record.kind)) {
        return false
      }
      return true
    })
  }

  async listForClaim(agentId: string, claimId: string): Promise<ActivationJournalRecord[]> {
    return this.listMatching(agentId, { claimId })
  }

  async listForSession(agentId: string, sessionId: string): Promise<ActivationJournalRecord[]> {
    return this.listMatching(agentId, { sessionId })
  }

  async latestForSession(
    agentId: string,
    sessionId: string,
  ): Promise<ActivationJournalRecord | null> {
    const records = await this.listForSession(agentId, sessionId)
    return records.at(-1) ?? null
  }

  private async append(record: ActivationJournalRecord): Promise<void> {
    await appendJsonl(this.path(record.agentId), record)
  }

  private path(agentId: string): string {
    return join(this.sessionStore.agentRuntimeDir(agentId), "activation-events.jsonl")
  }
}

function buildBaseRecord(
  agentId: string,
  activation: SessionActivation,
  leaseOwner: string,
  claimId: string,
): ActivationJournalRecordBase {
  return {
    createdAt: nowIsoString(),
    claimId,
    agentId,
    sessionId: activation.sessionId,
    activationKind: activation.kind,
    priority: activation.priority,
    dueAt: activation.dueAt,
    reason: activation.reason,
    note: activation.note,
    dueWakeIds: activation.dueWakes.map((wake) => wake.id),
    leaseOwner,
  }
}

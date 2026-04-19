import { setTimeout as sleep } from "node:timers/promises"
import { resolveChatActorId } from "../actor-id.js"
import { ChatCommandService } from "../policy/command-service.js"

export function chatUsageLines(): string[] {
  return [
    "  openboa chat conversation create --slug <slug> --title <title> [--created-by <actor-id>] [--topic <text>] [--json]",
    "  openboa chat conversation direct --participants <participant-id[,participant-id,...]> [--viewer-id <actor-id>] [--title <text>] [--json]",
    "  openboa chat conversation join --conversation <conversation-id|slug> [--participant-id <actor-id>] [--json]",
    "  openboa chat conversation leave --conversation <conversation-id|slug> [--participant-id <actor-id>] [--json]",
    "  openboa chat conversation remove --conversation <conversation-id|slug> --participant-id <actor-id> [--actor-id <actor-id>] [--json]",
    "  openboa chat conversation invite --conversation <conversation-id|slug> --participant-id <actor-id> [--actor-id <actor-id>] [--json]",
    "  openboa chat conversation viewer --conversation <conversation-id|slug> --participant-id <actor-id> [--actor-id <actor-id>] [--json]",
    "  openboa chat conversation roster --conversation <conversation-id|slug> [--actor-id <actor-id>] [--json]",
    "  openboa chat conversation grants --conversation <conversation-id|slug> [--actor-id <actor-id>] [--include-revoked] [--json]",
    "  openboa chat conversation revoke --conversation <conversation-id|slug> --binding <binding-id> [--actor-id <actor-id>] [--json]",
    "  openboa chat conversation update --conversation <conversation-id|slug> [--title <text>] [--topic <text>] [--visibility <public|private>] [--posting-policy <open|restricted>] [--actor-id <actor-id>] [--json]",
    "  openboa chat conversation archive --conversation <conversation-id|slug> [--actor-id <actor-id>] [--json]",
    "  openboa chat conversation list [--actor-id <actor-id>] [--json]",
    "  openboa chat conversation get --conversation <conversation-id|slug> [--actor-id <actor-id>] [--json]",
    "  openboa chat conversation summaries [--actor-id <actor-id>] [--limit <n>] [--json]",
    "  openboa chat inbox list [--actor-id <actor-id>] [--limit <n>] [--json]",
    "  openboa chat viewer recents [--actor-id <actor-id>] [--limit <n>] [--json]",
    "  openboa chat search messages --query <text> [--actor-id <actor-id>] [--limit <n>] [--json]",
    "  openboa chat message post --conversation <conversation-id|slug> --message <text> [--sender-id <actor-id>] [--thread <message-id>] [--audience-id <actor-id>] [--idempotency-key <key>] [--json]",
    "  openboa chat message read --conversation <conversation-id|slug> [--actor-id <actor-id>] [--thread <message-id>] [--before <message-id>] [--author-id <actor-id>] [--kind <participant|system|all>] [--limit <n>] [--json]",
    "  openboa chat message search --conversation <conversation-id|slug> --query <text> [--actor-id <actor-id>] [--thread <message-id>] [--author-id <actor-id>] [--kind <participant|system|all>] [--limit <n>] [--json]",
    "  openboa chat message edit --conversation <conversation-id|slug> --message <message-id> --body <text> [--actor-id <actor-id>] [--json]",
    "  openboa chat message redact --conversation <conversation-id|slug> --message <message-id> [--actor-id <actor-id>] [--json]",
    "  openboa chat reaction add --conversation <conversation-id|slug> --message <message-id> --emoji <emoji> [--actor-id <actor-id>] [--json]",
    "  openboa chat reaction remove --conversation <conversation-id|slug> --message <message-id> --emoji <emoji> [--actor-id <actor-id>] [--json]",
    "  openboa chat cursor get --conversation <conversation-id|slug> [--actor-id <actor-id>] [--thread <message-id>] [--json]",
    "  openboa chat cursor mark-read --conversation <conversation-id|slug> [--actor-id <actor-id>] [--thread <message-id>] [--json]",
    "  openboa chat watch get --conversation <conversation-id|slug> [--actor-id <actor-id>] [--json]",
    "  openboa chat watch start --conversation <conversation-id|slug> [--actor-id <actor-id>] [--json]",
    "  openboa chat watch stop --conversation <conversation-id|slug> [--actor-id <actor-id>] [--json]",
    "  openboa chat thread followed [--actor-id <actor-id>] [--limit <n>] [--json]",
    "  openboa chat thread get --conversation <conversation-id|slug> --thread <message-id> [--actor-id <actor-id>] [--before <message-id>] [--author-id <actor-id>] [--kind <participant|system|all>] [--limit <n>] [--json]",
    "  openboa chat thread follow --conversation <conversation-id|slug> --thread <message-id> [--actor-id <actor-id>] [--json]",
    "  openboa chat thread unfollow --conversation <conversation-id|slug> --thread <message-id> [--actor-id <actor-id>] [--json]",
    "  openboa chat events list [--actor-id <actor-id>] [--conversation <conversation-id|slug>] [--limit <n>] [--json]",
    "  openboa chat events poll [--actor-id <actor-id>] [--after-sequence <n>] [--conversation <conversation-id|slug>] [--limit <n>] [--json]",
    "  openboa chat events wait [--actor-id <actor-id>] [--after-sequence <n>] [--conversation <conversation-id|slug>] [--limit <n>] [--timeout-ms <n>] [--json]",
  ]
}

function jsonRequested(options: Record<string, string>): boolean {
  return options.json === "true"
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function parsePositiveInteger(value: string | undefined, flagName: string): number | undefined {
  if (!value) {
    return undefined
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flagName} must be a positive integer`)
  }
  return Math.floor(parsed)
}

function parseNonNegativeInteger(value: string | undefined, flagName: string): number | undefined {
  if (!value) {
    return undefined
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flagName} must be a non-negative integer`)
  }
  return Math.floor(parsed)
}

function parseCsvValues(value: string | undefined): string[] {
  return Array.from(
    new Set(
      (value ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  )
}

function parseMessageKindOption(
  value: string | undefined,
): "participant-message" | "system-event" | "all" | undefined {
  if (!value) {
    return undefined
  }
  if (value === "participant") {
    return "participant-message"
  }
  if (value === "system") {
    return "system-event"
  }
  if (value === "all") {
    return "all"
  }
  throw new Error("--kind must be one of: participant, system, all")
}

async function resolveConversationRecord(app: ChatCommandService, ref: string | undefined) {
  const normalizedRef = ref?.trim()
  if (!normalizedRef) {
    throw new Error("chat command requires --conversation <conversation-id|slug>")
  }
  return app.resolveConversationRef({ conversationRef: normalizedRef })
}

function writeConversationListText(
  records: Array<{
    conversationId: string
    kind: string
    title: string
    slug: string | null
    participantIds: string[]
  }>,
): void {
  process.stdout.write("chat conversations:\n")
  for (const record of records) {
    process.stdout.write(
      `- ${record.conversationId} kind=${record.kind} title=${JSON.stringify(record.title)} slug=${record.slug ?? "none"} participants=${record.participantIds.length}\n`,
    )
  }
}

function writeConversationSummaryText(
  records: Array<{
    conversationId: string
    kind: string
    title: string
    unreadCount: number
    mentionCount: number
    latestActivityAt: string | null
    latestMessagePreview: string
    dmGroup: string | null
  }>,
): void {
  process.stdout.write("chat conversation summaries:\n")
  for (const record of records) {
    process.stdout.write(
      `- conversation=${record.conversationId} kind=${record.kind} dmGroup=${record.dmGroup ?? "none"} unread=${record.unreadCount} mentions=${record.mentionCount} latestAt=${record.latestActivityAt ?? "none"} title=${JSON.stringify(record.title)} preview=${JSON.stringify(record.latestMessagePreview)}\n`,
    )
  }
}

function writeConversationRosterText(
  records: Array<{
    participantId: string
    displayName: string | null
    capabilities: string[]
    conversationRoleIds: string[]
    chatRoleIds: string[]
    membershipState: string | null
    inConversation: boolean
    watchAttached: boolean | null
  }>,
): void {
  process.stdout.write("chat conversation roster:\n")
  for (const record of records) {
    process.stdout.write(
      `- participant=${record.participantId} displayName=${JSON.stringify(record.displayName)} inConversation=${String(record.inConversation)} membership=${record.membershipState ?? "none"} watch=${record.watchAttached === null ? "unset" : String(record.watchAttached)} conversationRoles=${record.conversationRoleIds.join(",") || "none"} chatRoles=${record.chatRoleIds.join(",") || "none"} capabilities=${record.capabilities.join(",") || "none"}\n`,
    )
  }
}

function writeConversationGrantBindingsText(
  records: Array<{
    bindingId: string
    subjectId: string
    roleId: string
    scopeKind: string
    conversationId: string | null
    bindingState: string
  }>,
): void {
  process.stdout.write("chat conversation grants:\n")
  for (const record of records) {
    process.stdout.write(
      `- binding=${record.bindingId} subject=${record.subjectId} role=${record.roleId} scope=${record.scopeKind} conversation=${record.conversationId ?? "none"} state=${record.bindingState}\n`,
    )
  }
}

function writeMessageListText(
  records: Array<{
    messageId: string
    createdAt: string
    author: { id: string }
    threadId: string | null
    audience?: { id: string } | null
    body: string
    editedAt?: string | null
    redactedAt?: string | null
  }>,
): void {
  for (const record of records) {
    const status = record.redactedAt ? " status=redacted" : record.editedAt ? " status=edited" : ""
    const audience = record.audience?.id ? ` audience=${record.audience.id}` : ""
    process.stdout.write(
      `${record.createdAt} ${record.messageId} author=${record.author.id} thread=${record.threadId ?? "root"}${audience}${status} ${JSON.stringify(record.body)}\n`,
    )
  }
}

function writeCursorStateText(record: {
  participantId: string
  conversationId: string
  threadId: string | null
  lastObservedSequence: number
  lastObservedScopeSequence: number
  lastObservedScopeRevision: number
  hasPersistedCursor: boolean
}): void {
  process.stdout.write(
    `${[
      "chat cursor",
      `- participantId: ${record.participantId}`,
      `- conversationId: ${record.conversationId}`,
      `- threadId: ${record.threadId ?? "root"}`,
      `- lastObservedSequence: ${record.lastObservedSequence}`,
      `- lastObservedScopeSequence: ${record.lastObservedScopeSequence}`,
      `- lastObservedScopeRevision: ${record.lastObservedScopeRevision}`,
      `- hasPersistedCursor: ${String(record.hasPersistedCursor)}`,
    ].join("\n")}\n`,
  )
}

function writeThreadFollowStateText(record: {
  participantId: string
  conversationId: string
  threadId: string | null
  attached: boolean | null
  hasPersistedAttachment: boolean
}): void {
  process.stdout.write(
    `${[
      "chat thread follow",
      `- participantId: ${record.participantId}`,
      `- conversationId: ${record.conversationId}`,
      `- threadId: ${record.threadId ?? "root"}`,
      `- attached: ${record.attached === null ? "unset" : String(record.attached)}`,
      `- hasPersistedAttachment: ${String(record.hasPersistedAttachment)}`,
    ].join("\n")}\n`,
  )
}

function writeConversationThreadText(record: {
  conversationId: string
  threadId: string
  rootMessage: {
    messageId: string
    createdAt: string
    author: { id: string }
    threadId: string | null
    audience?: { id: string } | null
    body: string
    editedAt?: string | null
    redactedAt?: string | null
  }
  replies: Array<{
    messageId: string
    createdAt: string
    author: { id: string }
    threadId: string | null
    audience?: { id: string } | null
    body: string
    editedAt?: string | null
    redactedAt?: string | null
  }>
  followState: {
    attached: boolean | null
    hasPersistedAttachment: boolean
  }
  cursorState: {
    lastObservedSequence: number
    lastObservedScopeSequence: number
    lastObservedScopeRevision: number
  }
}): void {
  process.stdout.write(
    `${[
      "chat thread",
      `- conversationId: ${record.conversationId}`,
      `- threadId: ${record.threadId}`,
      `- rootMessageId: ${record.rootMessage.messageId}`,
      `- rootAuthor: ${record.rootMessage.author.id}`,
      `- followAttached: ${record.followState.attached === null ? "unset" : String(record.followState.attached)}`,
      `- lastObservedScopeSequence: ${record.cursorState.lastObservedScopeSequence}`,
      `- replies: ${record.replies.length}`,
    ].join("\n")}\n`,
  )
  process.stdout.write("thread root:\n")
  writeMessageListText([record.rootMessage])
  if (record.replies.length > 0) {
    process.stdout.write("thread replies:\n")
    writeMessageListText(record.replies)
  }
}

function writeInboxEntriesText(
  records: Array<{
    entryId: string
    kind: string
    title: string
    preview: string
    conversationId: string
    messageId: string | null
    createdAt: string
  }>,
): void {
  process.stdout.write("chat inbox:\n")
  for (const record of records) {
    process.stdout.write(
      `- entry=${record.entryId} kind=${record.kind} conversation=${record.conversationId} message=${record.messageId ?? "none"} createdAt=${record.createdAt} title=${JSON.stringify(record.title)} preview=${JSON.stringify(record.preview)}\n`,
    )
  }
}

function writeFollowedThreadsText(
  records: Array<{
    conversationId: string
    conversationTitle: string
    threadRootMessageId: string
    threadRootPreview: string
    latestReplyAt: string | null
    latestReplyPreview: string | null
    unreadReplyCount: number
    unreadMentionCount: number
  }>,
): void {
  process.stdout.write("chat followed threads:\n")
  for (const record of records) {
    process.stdout.write(
      `- conversation=${record.conversationId} title=${JSON.stringify(record.conversationTitle)} thread=${record.threadRootMessageId} unreadReplies=${record.unreadReplyCount} unreadMentions=${record.unreadMentionCount} latestReplyAt=${record.latestReplyAt ?? "none"} root=${JSON.stringify(record.threadRootPreview)} latest=${JSON.stringify(record.latestReplyPreview ?? "")}\n`,
    )
  }
}

function writeVisibleSearchResultsText(
  records: Array<{
    messageId: string
    sourceConversationId: string
    openConversationId: string
    openMode: "joined" | "viewer"
    threadId: string | null
    conversationTitle: string
    preview: string
    createdAt: string
    score: number
  }>,
): void {
  process.stdout.write("chat search messages:\n")
  for (const record of records) {
    process.stdout.write(
      `- score=${record.score} openMode=${record.openMode} openConversation=${record.openConversationId} sourceConversation=${record.sourceConversationId} thread=${record.threadId ?? "root"} message=${record.messageId} createdAt=${record.createdAt} title=${JSON.stringify(record.conversationTitle)} preview=${JSON.stringify(record.preview)}\n`,
    )
  }
}

function writeViewerRecentsText(
  records: Array<{
    conversationId: string
    title: string
    kind: string
    observedAt: string
    latestActivityAt: string | null
    latestMessagePreview: string
  }>,
): void {
  process.stdout.write("chat viewer recents:\n")
  for (const record of records) {
    process.stdout.write(
      `- conversation=${record.conversationId} kind=${record.kind} observedAt=${record.observedAt} latestAt=${record.latestActivityAt ?? "none"} title=${JSON.stringify(record.title)} preview=${JSON.stringify(record.latestMessagePreview)}\n`,
    )
  }
}

async function runChatConversationCreate(options: Record<string, string>): Promise<void> {
  const slug = options.slug?.trim()
  const title = options.title?.trim()
  if (!slug) {
    throw new Error("chat conversation create requires --slug <slug>")
  }
  if (!title) {
    throw new Error("chat conversation create requires --title <title>")
  }

  const app = new ChatCommandService(process.cwd())
  const conversation = await app.createChannel({
    slug,
    title,
    createdById: options["created-by"]?.trim() || resolveChatActorId(),
    topic: options.topic ?? null,
    visibility:
      options.visibility === "private" || options.visibility === "public"
        ? options.visibility
        : undefined,
    postingPolicy:
      options["posting-policy"] === "open" || options["posting-policy"] === "restricted"
        ? options["posting-policy"]
        : undefined,
  })

  if (jsonRequested(options)) {
    writeJson(conversation)
    return
  }

  process.stdout.write(
    `${[
      "chat conversation created",
      `- conversationId: ${conversation.conversationId}`,
      `- kind: ${conversation.kind}`,
      `- slug: ${conversation.slug ?? "none"}`,
      `- title: ${conversation.title}`,
    ].join("\n")}\n`,
  )
}

async function runChatConversationDirect(options: Record<string, string>): Promise<void> {
  const participants = parseCsvValues(options.participants)
  if (participants.length === 0) {
    throw new Error(
      "chat conversation direct requires --participants <participant-id[,participant-id,...]>",
    )
  }

  const viewerId = options["viewer-id"]?.trim() || resolveChatActorId()
  const app = new ChatCommandService(process.cwd())
  const conversation = await app.ensureDirectConversation({
    participants: [
      { kind: "participant", id: viewerId },
      ...participants.map((participantId) => ({ kind: "participant" as const, id: participantId })),
    ],
    title: options.title?.trim() || undefined,
  })

  if (jsonRequested(options)) {
    writeJson(conversation)
    return
  }

  process.stdout.write(
    `${[
      "chat direct conversation ready",
      `- conversationId: ${conversation.conversationId}`,
      `- kind: ${conversation.kind}`,
      `- participants: ${conversation.participantIds.join(", ")}`,
      `- title: ${conversation.title}`,
    ].join("\n")}\n`,
  )
}

async function runChatConversationJoin(options: Record<string, string>): Promise<void> {
  const app = new ChatCommandService(process.cwd())
  const conversation = await resolveConversationRecord(app, options.conversation)
  const joined = await app.joinConversation({
    conversationId: conversation.conversationId,
    participantId: options["participant-id"]?.trim() || resolveChatActorId(),
  })

  if (jsonRequested(options)) {
    writeJson(joined)
    return
  }

  process.stdout.write(
    `${[
      "chat conversation joined",
      `- conversationId: ${joined.conversationId}`,
      `- kind: ${joined.kind}`,
      `- participants: ${joined.participantIds.join(", ")}`,
    ].join("\n")}\n`,
  )
}

async function runChatConversationLeave(options: Record<string, string>): Promise<void> {
  const app = new ChatCommandService(process.cwd())
  const conversation = await resolveConversationRecord(app, options.conversation)
  const updated = await app.leaveConversation({
    conversationId: conversation.conversationId,
    participantId: options["participant-id"]?.trim() || resolveChatActorId(),
  })

  if (jsonRequested(options)) {
    writeJson(updated)
    return
  }

  process.stdout.write(
    `${[
      "chat conversation left",
      `- conversationId: ${updated.conversationId}`,
      `- kind: ${updated.kind}`,
      `- participants: ${updated.participantIds.join(", ")}`,
    ].join("\n")}\n`,
  )
}

async function runChatConversationRemove(options: Record<string, string>): Promise<void> {
  const participantId = options["participant-id"]?.trim()
  if (!participantId) {
    throw new Error("chat conversation remove requires --participant-id <actor-id>")
  }

  const app = new ChatCommandService(process.cwd())
  const conversation = await resolveConversationRecord(app, options.conversation)
  const updated = await app.removeConversationParticipant({
    conversationId: conversation.conversationId,
    actorId: options["actor-id"]?.trim() || resolveChatActorId(),
    participantId,
  })

  if (jsonRequested(options)) {
    writeJson(updated)
    return
  }

  process.stdout.write(
    `${[
      "chat conversation participant removed",
      `- conversationId: ${updated.conversationId}`,
      `- participantId: ${participantId}`,
      `- participants: ${updated.participantIds.join(", ")}`,
    ].join("\n")}\n`,
  )
}

async function runChatConversationInvite(options: Record<string, string>): Promise<void> {
  const participantId = options["participant-id"]?.trim()
  if (!participantId) {
    throw new Error("chat conversation invite requires --participant-id <actor-id>")
  }
  const app = new ChatCommandService(process.cwd())
  const conversation = await resolveConversationRecord(app, options.conversation)
  const binding = await app.inviteParticipant({
    conversationId: conversation.conversationId,
    subjectId: participantId,
    invitedById: options["actor-id"]?.trim() || resolveChatActorId(),
  })

  if (jsonRequested(options)) {
    writeJson(binding)
    return
  }

  process.stdout.write(
    `${[
      "chat conversation invited participant",
      `- conversationId: ${conversation.conversationId}`,
      `- subjectId: ${binding.subjectId}`,
      `- roleId: ${binding.roleId}`,
    ].join("\n")}\n`,
  )
}

async function runChatConversationViewer(options: Record<string, string>): Promise<void> {
  const participantId = options["participant-id"]?.trim()
  if (!participantId) {
    throw new Error("chat conversation viewer requires --participant-id <actor-id>")
  }
  const app = new ChatCommandService(process.cwd())
  const conversation = await resolveConversationRecord(app, options.conversation)
  const binding = await app.grantViewerAccess({
    conversationId: conversation.conversationId,
    subjectId: participantId,
    grantedById: options["actor-id"]?.trim() || resolveChatActorId(),
  })

  if (jsonRequested(options)) {
    writeJson(binding)
    return
  }

  process.stdout.write(
    `${[
      "chat conversation viewer granted",
      `- conversationId: ${conversation.conversationId}`,
      `- subjectId: ${binding.subjectId}`,
      `- roleId: ${binding.roleId}`,
    ].join("\n")}\n`,
  )
}

async function runChatConversationRoster(options: Record<string, string>): Promise<void> {
  const app = new ChatCommandService(process.cwd())
  const conversation = await resolveConversationRecord(app, options.conversation)
  const roster = await app.readConversationRoster({
    conversationId: conversation.conversationId,
    actorId: options["actor-id"]?.trim() || resolveChatActorId(),
  })

  if (jsonRequested(options)) {
    writeJson(roster)
    return
  }

  writeConversationRosterText(roster)
}

async function runChatConversationGrants(options: Record<string, string>): Promise<void> {
  const app = new ChatCommandService(process.cwd())
  const conversation = await resolveConversationRecord(app, options.conversation)
  const bindings = await app.readConversationGrantBindings({
    conversationId: conversation.conversationId,
    actorId: options["actor-id"]?.trim() || resolveChatActorId(),
    includeRevoked: options["include-revoked"] === "true",
  })

  if (jsonRequested(options)) {
    writeJson(bindings)
    return
  }

  writeConversationGrantBindingsText(bindings)
}

async function runChatConversationRevoke(options: Record<string, string>): Promise<void> {
  const bindingId = options.binding?.trim()
  if (!bindingId) {
    throw new Error("chat conversation revoke requires --binding <binding-id>")
  }

  const app = new ChatCommandService(process.cwd())
  const conversation = await resolveConversationRecord(app, options.conversation)
  const binding = await app.revokeConversationGrantBinding({
    conversationId: conversation.conversationId,
    bindingId,
    actorId: options["actor-id"]?.trim() || resolveChatActorId(),
  })

  if (jsonRequested(options)) {
    writeJson(binding)
    return
  }

  process.stdout.write(
    `${[
      "chat conversation grant revoked",
      `- bindingId: ${binding.bindingId}`,
      `- conversationId: ${binding.conversationId ?? "none"}`,
      `- subjectId: ${binding.subjectId}`,
      `- roleId: ${binding.roleId}`,
      `- bindingState: ${binding.bindingState}`,
    ].join("\n")}\n`,
  )
}

async function runChatConversationUpdate(options: Record<string, string>): Promise<void> {
  const app = new ChatCommandService(process.cwd())
  const conversation = await resolveConversationRecord(app, options.conversation)
  const updated = await app.updateConversationSettings({
    conversationId: conversation.conversationId,
    updatedById: options["actor-id"]?.trim() || resolveChatActorId(),
    title: options.title?.trim() || undefined,
    topic: options.topic ?? undefined,
    visibility:
      options.visibility === "public" || options.visibility === "private"
        ? options.visibility
        : undefined,
    postingPolicy:
      options["posting-policy"] === "open" || options["posting-policy"] === "restricted"
        ? options["posting-policy"]
        : undefined,
  })

  if (jsonRequested(options)) {
    writeJson(updated)
    return
  }

  process.stdout.write(
    `${[
      "chat conversation updated",
      `- conversationId: ${updated.conversationId}`,
      `- title: ${updated.title}`,
      `- visibility: ${updated.visibility}`,
      `- postingPolicy: ${updated.postingPolicy}`,
    ].join("\n")}\n`,
  )
}

async function runChatConversationArchive(options: Record<string, string>): Promise<void> {
  const app = new ChatCommandService(process.cwd())
  const conversation = await resolveConversationRecord(app, options.conversation)
  const archived = await app.archiveConversation({
    conversationId: conversation.conversationId,
    archivedById: options["actor-id"]?.trim() || resolveChatActorId(),
  })

  if (jsonRequested(options)) {
    writeJson(archived)
    return
  }

  process.stdout.write(
    `${[
      "chat conversation archived",
      `- conversationId: ${archived.conversationId}`,
      `- lifecycleState: ${archived.lifecycleState}`,
    ].join("\n")}\n`,
  )
}

async function runChatConversationList(options: Record<string, string>): Promise<void> {
  const app = new ChatCommandService(process.cwd())
  const conversations = await app.readVisibleConversations({
    actorId: options["actor-id"]?.trim() || resolveChatActorId(),
  })
  if (jsonRequested(options)) {
    writeJson(conversations)
    return
  }
  writeConversationListText(conversations)
}

async function runChatConversationGet(options: Record<string, string>): Promise<void> {
  const app = new ChatCommandService(process.cwd())
  const conversation = await app.readConversation({
    conversationId: (await resolveConversationRecord(app, options.conversation)).conversationId,
    actorId: options["actor-id"]?.trim() || resolveChatActorId(),
  })
  if (jsonRequested(options)) {
    writeJson(conversation)
    return
  }
  writeConversationListText([conversation])
}

async function runChatConversationSummaries(options: Record<string, string>): Promise<void> {
  const app = new ChatCommandService(process.cwd())
  const summaries = await app.readConversationSummaries({
    actorId: options["actor-id"]?.trim() || resolveChatActorId(),
    limit: parsePositiveInteger(options.limit, "--limit"),
  })

  if (jsonRequested(options)) {
    writeJson(summaries)
    return
  }

  writeConversationSummaryText(summaries)
}

async function runChatInboxList(options: Record<string, string>): Promise<void> {
  const app = new ChatCommandService(process.cwd())
  const inbox = await app.readInbox({
    actorId: options["actor-id"]?.trim() || resolveChatActorId(),
    limit: parsePositiveInteger(options.limit, "--limit"),
  })

  if (jsonRequested(options)) {
    writeJson(inbox)
    return
  }

  writeInboxEntriesText(inbox)
}

async function runChatViewerRecents(options: Record<string, string>): Promise<void> {
  const app = new ChatCommandService(process.cwd())
  const recents = await app.readViewerRecents({
    actorId: options["actor-id"]?.trim() || resolveChatActorId(),
    limit: parsePositiveInteger(options.limit, "--limit"),
  })

  if (jsonRequested(options)) {
    writeJson(recents)
    return
  }

  writeViewerRecentsText(recents)
}

async function runChatSearchMessages(options: Record<string, string>): Promise<void> {
  const query = options.query?.trim() || ""
  if (!query) {
    throw new Error("chat search messages requires --query <text>")
  }

  const app = new ChatCommandService(process.cwd())
  const results = await app.searchVisibleMessages({
    actorId: options["actor-id"]?.trim() || resolveChatActorId(),
    query,
    limit: parsePositiveInteger(options.limit, "--limit"),
  })

  if (jsonRequested(options)) {
    writeJson(results)
    return
  }

  writeVisibleSearchResultsText(results)
}

async function runChatMessagePost(options: Record<string, string>, rest: string[]): Promise<void> {
  const app = new ChatCommandService(process.cwd())
  const conversation = await resolveConversationRecord(app, options.conversation)
  const message = (options.message ?? rest.join(" ")).trim()
  if (!message) {
    throw new Error("chat message post requires --message <text>")
  }

  const posted = await app.postMessage({
    conversationId: conversation.conversationId,
    senderId: options["sender-id"]?.trim() || resolveChatActorId(),
    senderKind: "participant",
    body: message,
    threadId: options.thread?.trim() || null,
    audience: options["audience-id"]?.trim()
      ? {
          kind: "participant",
          id: options["audience-id"].trim(),
        }
      : null,
    idempotencyKey: options["idempotency-key"]?.trim() || null,
  })

  if (jsonRequested(options)) {
    writeJson(posted)
    return
  }

  process.stdout.write(
    `${[
      "chat message posted",
      `- messageId: ${posted.messageId}`,
      `- conversationId: ${posted.conversationId}`,
      `- threadId: ${posted.threadId ?? "root"}`,
      `- author: ${posted.author.id}`,
      `- audience: ${posted.audience?.id ?? "none"}`,
    ].join("\n")}\n`,
  )
}

async function runChatMessageRead(options: Record<string, string>): Promise<void> {
  const app = new ChatCommandService(process.cwd())
  const conversation = await resolveConversationRecord(app, options.conversation)
  const messages = await app.readConversationMessages({
    conversationId: conversation.conversationId,
    actorId: options["actor-id"]?.trim() || resolveChatActorId(),
    threadId: options.thread?.trim() || null,
    beforeMessageId: options.before?.trim() || null,
    authorId: options["author-id"]?.trim() || null,
    messageKind: parseMessageKindOption(options.kind),
    limit: parsePositiveInteger(options.limit, "--limit"),
  })

  if (jsonRequested(options)) {
    writeJson(messages)
    return
  }

  process.stdout.write(`chat messages: ${conversation.conversationId}\n`)
  writeMessageListText(messages)
}

async function runChatMessageSearch(options: Record<string, string>): Promise<void> {
  const query = options.query?.trim() || ""
  if (!query) {
    throw new Error("chat message search requires --query <text>")
  }

  const app = new ChatCommandService(process.cwd())
  const conversation = await resolveConversationRecord(app, options.conversation)
  const results = await app.searchConversationMessages({
    conversationId: conversation.conversationId,
    actorId: options["actor-id"]?.trim() || resolveChatActorId(),
    query,
    threadId: options.thread?.trim() || null,
    authorId: options["author-id"]?.trim() || null,
    messageKind: parseMessageKindOption(options.kind),
    limit: options.limit ? Number.parseInt(options.limit, 10) : undefined,
  })

  if (jsonRequested(options)) {
    writeJson(results)
    return
  }

  process.stdout.write(`chat message search: ${conversation.conversationId}\n`)
  for (const result of results) {
    process.stdout.write(
      `- score=${result.score} messageId=${result.message.messageId} author=${result.message.author.id} ${JSON.stringify(result.message.body)}\n`,
    )
  }
}

async function runChatMessageEdit(options: Record<string, string>): Promise<void> {
  const messageId = options.message?.trim()
  if (!messageId) {
    throw new Error("chat message edit requires --message <message-id>")
  }
  const body = options.body ?? ""
  if (!body.trim()) {
    throw new Error("chat message edit requires --body <text>")
  }

  const app = new ChatCommandService(process.cwd())
  const conversation = await resolveConversationRecord(app, options.conversation)
  const edited = await app.editMessage({
    conversationId: conversation.conversationId,
    actorId: options["actor-id"]?.trim() || resolveChatActorId(),
    messageId,
    body,
  })

  if (jsonRequested(options)) {
    writeJson(edited)
    return
  }

  process.stdout.write(
    `${[
      "chat message edited",
      `- messageId: ${edited.messageId}`,
      `- conversationId: ${edited.conversationId}`,
      `- editedBy: ${edited.editedById ?? "unknown"}`,
    ].join("\n")}\n`,
  )
}

async function runChatMessageRedact(options: Record<string, string>): Promise<void> {
  const messageId = options.message?.trim()
  if (!messageId) {
    throw new Error("chat message redact requires --message <message-id>")
  }

  const app = new ChatCommandService(process.cwd())
  const conversation = await resolveConversationRecord(app, options.conversation)
  const redacted = await app.redactMessage({
    conversationId: conversation.conversationId,
    actorId: options["actor-id"]?.trim() || resolveChatActorId(),
    messageId,
  })

  if (jsonRequested(options)) {
    writeJson(redacted)
    return
  }

  process.stdout.write(
    `${[
      "chat message redacted",
      `- messageId: ${redacted.messageId}`,
      `- conversationId: ${redacted.conversationId}`,
      `- redactedBy: ${redacted.redactedById ?? "unknown"}`,
    ].join("\n")}\n`,
  )
}

async function runChatReactionSet(options: Record<string, string>, active: boolean): Promise<void> {
  const messageId = options.message?.trim()
  if (!messageId) {
    throw new Error(`chat reaction ${active ? "add" : "remove"} requires --message <message-id>`)
  }
  const emoji = options.emoji?.trim()
  if (!emoji) {
    throw new Error(`chat reaction ${active ? "add" : "remove"} requires --emoji <emoji>`)
  }

  const app = new ChatCommandService(process.cwd())
  const conversation = await resolveConversationRecord(app, options.conversation)
  const message = await app.setMessageReaction({
    conversationId: conversation.conversationId,
    actorId: options["actor-id"]?.trim() || resolveChatActorId(),
    messageId,
    emoji,
    active,
  })

  if (jsonRequested(options)) {
    writeJson(message)
    return
  }

  process.stdout.write(
    `${[
      `chat reaction ${active ? "added" : "removed"}`,
      `- messageId: ${message.messageId}`,
      `- conversationId: ${message.conversationId}`,
      `- emoji: ${emoji}`,
    ].join("\n")}\n`,
  )
}

async function runChatCursorGet(options: Record<string, string>): Promise<void> {
  const app = new ChatCommandService(process.cwd())
  const conversation = await resolveConversationRecord(app, options.conversation)
  const cursor = await app.readConversationCursor({
    conversationId: conversation.conversationId,
    actorId: options["actor-id"]?.trim() || resolveChatActorId(),
    threadId: options.thread?.trim() || null,
  })

  if (jsonRequested(options)) {
    writeJson(cursor)
    return
  }

  writeCursorStateText(cursor)
}

async function runChatCursorMarkRead(options: Record<string, string>): Promise<void> {
  const app = new ChatCommandService(process.cwd())
  const conversation = await resolveConversationRecord(app, options.conversation)
  const cursor = await app.markConversationRead({
    conversationId: conversation.conversationId,
    actorId: options["actor-id"]?.trim() || resolveChatActorId(),
    threadId: options.thread?.trim() || null,
  })

  if (jsonRequested(options)) {
    writeJson(cursor)
    return
  }

  writeCursorStateText(cursor)
}

async function runChatThreadGet(options: Record<string, string>): Promise<void> {
  const threadId = options.thread?.trim()
  if (!threadId) {
    throw new Error("chat thread get requires --thread <message-id>")
  }
  const app = new ChatCommandService(process.cwd())
  const conversation = await resolveConversationRecord(app, options.conversation)
  const state = await app.readConversationThread({
    conversationId: conversation.conversationId,
    actorId: options["actor-id"]?.trim() || resolveChatActorId(),
    threadId,
    beforeMessageId: options.before?.trim() || null,
    authorId: options["author-id"]?.trim() || null,
    messageKind: parseMessageKindOption(options.kind),
    limit: parsePositiveInteger(options.limit, "--limit"),
  })

  if (jsonRequested(options)) {
    writeJson(state)
    return
  }

  writeConversationThreadText(state)
}

async function runChatThreadFollowed(options: Record<string, string>): Promise<void> {
  const app = new ChatCommandService(process.cwd())
  const followedThreads = await app.readFollowedThreads({
    actorId: options["actor-id"]?.trim() || resolveChatActorId(),
    limit: parsePositiveInteger(options.limit, "--limit"),
  })

  if (jsonRequested(options)) {
    writeJson(followedThreads)
    return
  }

  writeFollowedThreadsText(followedThreads)
}

async function runChatWatchGet(options: Record<string, string>): Promise<void> {
  const app = new ChatCommandService(process.cwd())
  const conversation = await resolveConversationRecord(app, options.conversation)
  const state = await app.readConversationWatchState({
    conversationId: conversation.conversationId,
    actorId: options["actor-id"]?.trim() || resolveChatActorId(),
  })

  if (jsonRequested(options)) {
    writeJson(state)
    return
  }

  writeThreadFollowStateText(state)
}

async function runChatWatchState(
  options: Record<string, string>,
  attached: boolean,
): Promise<void> {
  const app = new ChatCommandService(process.cwd())
  const conversation = await resolveConversationRecord(app, options.conversation)
  const state = await app.setConversationWatchState({
    conversationId: conversation.conversationId,
    actorId: options["actor-id"]?.trim() || resolveChatActorId(),
    attached,
  })

  if (jsonRequested(options)) {
    writeJson(state)
    return
  }

  writeThreadFollowStateText(state)
}

async function runChatThreadFollowState(
  options: Record<string, string>,
  attached: boolean,
): Promise<void> {
  const threadId = options.thread?.trim()
  if (!threadId) {
    throw new Error(
      `chat thread ${attached ? "follow" : "unfollow"} requires --thread <message-id>`,
    )
  }
  const app = new ChatCommandService(process.cwd())
  const conversation = await resolveConversationRecord(app, options.conversation)
  const state = await app.setThreadFollowState({
    conversationId: conversation.conversationId,
    actorId: options["actor-id"]?.trim() || resolveChatActorId(),
    threadId,
    attached,
  })

  if (jsonRequested(options)) {
    writeJson(state)
    return
  }

  writeThreadFollowStateText(state)
}

async function runChatEventsList(options: Record<string, string>): Promise<void> {
  const app = new ChatCommandService(process.cwd())
  const limit = parsePositiveInteger(options.limit, "--limit")
  const events = await app.readChatEvents({
    actorId: options["actor-id"]?.trim() || resolveChatActorId(),
    conversationId: options.conversation
      ? (await resolveConversationRecord(app, options.conversation)).conversationId
      : null,
    limit,
  })

  if (jsonRequested(options)) {
    writeJson(events)
    return
  }

  process.stdout.write("chat events:\n")
  for (const event of events) {
    process.stdout.write(
      `${event.sequence} ${event.eventType} conversation=${"conversationId" in event ? (event.conversationId ?? "none") : "none"}\n`,
    )
  }
}

async function runChatEventsPoll(options: Record<string, string>): Promise<void> {
  const app = new ChatCommandService(process.cwd())
  const afterSequence = parseNonNegativeInteger(options["after-sequence"], "--after-sequence") ?? 0
  const limit = parsePositiveInteger(options.limit, "--limit")
  const selected = await app.readChatEvents({
    actorId: options["actor-id"]?.trim() || resolveChatActorId(),
    conversationId: options.conversation
      ? (await resolveConversationRecord(app, options.conversation)).conversationId
      : null,
    afterSequence,
    limit,
  })
  const nextSequence = selected.at(-1)?.sequence ?? afterSequence

  if (jsonRequested(options)) {
    writeJson({
      afterSequence,
      nextSequence,
      events: selected,
    })
    return
  }

  process.stdout.write(`chat events poll: after=${afterSequence} next=${nextSequence}\n`)
  for (const event of selected) {
    process.stdout.write(
      `${event.sequence} ${event.eventType} conversation=${"conversationId" in event ? (event.conversationId ?? "none") : "none"}\n`,
    )
  }
}

async function runChatEventsWait(options: Record<string, string>): Promise<void> {
  const app = new ChatCommandService(process.cwd())
  const afterSequence = parseNonNegativeInteger(options["after-sequence"], "--after-sequence") ?? 0
  const limit = parsePositiveInteger(options.limit, "--limit")
  const timeoutMs = parseNonNegativeInteger(options["timeout-ms"], "--timeout-ms") ?? 30_000
  const pollIntervalMs = 50
  const deadlineAt = Date.now() + timeoutMs
  const conversationId = options.conversation
    ? (await resolveConversationRecord(app, options.conversation)).conversationId
    : null
  let selected = await app.readChatEvents({
    actorId: options["actor-id"]?.trim() || resolveChatActorId(),
    conversationId,
    afterSequence,
    limit,
  })

  while (selected.length === 0 && Date.now() < deadlineAt) {
    const remainingMs = deadlineAt - Date.now()
    await sleep(Math.max(1, Math.min(pollIntervalMs, remainingMs)))
    selected = await app.readChatEvents({
      actorId: options["actor-id"]?.trim() || resolveChatActorId(),
      conversationId,
      afterSequence,
      limit,
    })
  }

  const nextSequence = selected.at(-1)?.sequence ?? afterSequence
  const timedOut = selected.length === 0

  if (jsonRequested(options)) {
    writeJson({
      afterSequence,
      nextSequence,
      timedOut,
      events: selected,
    })
    return
  }

  process.stdout.write(
    `chat events wait: after=${afterSequence} next=${nextSequence} timedOut=${String(timedOut)}\n`,
  )
  for (const event of selected) {
    process.stdout.write(
      `${event.sequence} ${event.eventType} conversation=${"conversationId" in event ? (event.conversationId ?? "none") : "none"}\n`,
    )
  }
}

export interface RunChatCliInput {
  subcommand?: string
  third?: string
  rest: string[]
  options: Record<string, string>
}

export async function runChatCli(input: RunChatCliInput): Promise<void> {
  const { subcommand, third, rest, options } = input

  if (subcommand === "conversation") {
    if (third === "create") {
      await runChatConversationCreate(options)
      return
    }
    if (third === "direct") {
      await runChatConversationDirect(options)
      return
    }
    if (third === "join") {
      await runChatConversationJoin(options)
      return
    }
    if (third === "leave") {
      await runChatConversationLeave(options)
      return
    }
    if (third === "remove") {
      await runChatConversationRemove(options)
      return
    }
    if (third === "invite") {
      await runChatConversationInvite(options)
      return
    }
    if (third === "viewer") {
      await runChatConversationViewer(options)
      return
    }
    if (third === "roster") {
      await runChatConversationRoster(options)
      return
    }
    if (third === "grants") {
      await runChatConversationGrants(options)
      return
    }
    if (third === "revoke") {
      await runChatConversationRevoke(options)
      return
    }
    if (third === "update") {
      await runChatConversationUpdate(options)
      return
    }
    if (third === "archive") {
      await runChatConversationArchive(options)
      return
    }
    if (third === "list") {
      await runChatConversationList(options)
      return
    }
    if (third === "get") {
      await runChatConversationGet(options)
      return
    }
    if (third === "summaries") {
      await runChatConversationSummaries(options)
      return
    }
    throw new Error(
      "chat conversation requires one of: create, direct, join, leave, remove, invite, viewer, roster, grants, revoke, update, archive, list, get, summaries",
    )
  }
  if (subcommand === "inbox") {
    if (third === "list") {
      await runChatInboxList(options)
      return
    }
    throw new Error("chat inbox requires one of: list")
  }
  if (subcommand === "viewer") {
    if (third === "recents") {
      await runChatViewerRecents(options)
      return
    }
    throw new Error("chat viewer requires one of: recents")
  }
  if (subcommand === "search") {
    if (third === "messages") {
      await runChatSearchMessages(options)
      return
    }
    throw new Error("chat search requires one of: messages")
  }
  if (subcommand === "message") {
    if (third === "post") {
      await runChatMessagePost(options, rest)
      return
    }
    if (third === "read") {
      await runChatMessageRead(options)
      return
    }
    if (third === "search") {
      await runChatMessageSearch(options)
      return
    }
    if (third === "edit") {
      await runChatMessageEdit(options)
      return
    }
    if (third === "redact") {
      await runChatMessageRedact(options)
      return
    }
    throw new Error("chat message requires one of: post, read, search, edit, redact")
  }
  if (subcommand === "reaction") {
    if (third === "add") {
      await runChatReactionSet(options, true)
      return
    }
    if (third === "remove") {
      await runChatReactionSet(options, false)
      return
    }
    throw new Error("chat reaction requires one of: add, remove")
  }
  if (subcommand === "cursor") {
    if (third === "get") {
      await runChatCursorGet(options)
      return
    }
    if (third === "mark-read") {
      await runChatCursorMarkRead(options)
      return
    }
    throw new Error("chat cursor requires one of: get, mark-read")
  }
  if (subcommand === "watch") {
    if (third === "get") {
      await runChatWatchGet(options)
      return
    }
    if (third === "start") {
      await runChatWatchState(options, true)
      return
    }
    if (third === "stop") {
      await runChatWatchState(options, false)
      return
    }
    throw new Error("chat watch requires one of: get, start, stop")
  }
  if (subcommand === "thread") {
    if (third === "followed") {
      await runChatThreadFollowed(options)
      return
    }
    if (third === "get") {
      await runChatThreadGet(options)
      return
    }
    if (third === "follow") {
      await runChatThreadFollowState(options, true)
      return
    }
    if (third === "unfollow") {
      await runChatThreadFollowState(options, false)
      return
    }
    throw new Error("chat thread requires one of: followed, get, follow, unfollow")
  }
  if (subcommand === "events") {
    if (third === "list") {
      await runChatEventsList(options)
      return
    }
    if (third === "poll") {
      await runChatEventsPoll(options)
      return
    }
    if (third === "wait") {
      await runChatEventsWait(options)
      return
    }
    throw new Error("chat events requires one of: list, poll, wait")
  }
  throw new Error(
    "chat requires one of: conversation, inbox, viewer, search, message, reaction, cursor, watch, thread, events",
  )
}

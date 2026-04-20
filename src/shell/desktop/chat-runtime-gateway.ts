import { resolveChatActorId } from "../../chat/actor-id.js"
import { SharedChatLedger } from "../../chat/core/ledger.js"
import type { ChatConversation, ChatConversationRecord, ChatRoleId } from "../../chat/core/model.js"
import { ChatCommandService } from "../../chat/policy/command-service.js"
import {
  buildChatConversationProjection,
  type ChatFollowedThread,
} from "../../chat/projections/projections.js"
import type { ChatSidebarFollowedThread, ChatSidebarViewerRecent } from "../../chat/view-model.js"
import type {
  ChatConversationAccessGrant,
  ChatShellRuntimeSeed,
  ChatShellRuntimeSeedItem,
} from "../chat/index.js"
import { canChatActorPostMessages } from "../chat/permissions.js"
import type {
  ChatRuntimeGatewayArchiveConversationInput,
  ChatRuntimeGatewayGrantAccessInput,
  ChatRuntimeGatewayPollEventsResult,
  ChatRuntimeGatewaySearchResult,
  ChatRuntimeGatewayUpdateConversationSettingsInput,
} from "../chat/runtime-gateway.js"

function latestEventSequence(events: Array<{ sequence: number }>): number {
  return events.at(-1)?.sequence ?? 0
}

function participantLabel(value: string): string {
  return value
    .split(/[-_]/u)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function normalizeConversationForActor(
  conversation: ChatConversationRecord,
  actorId: string,
): ChatConversationRecord {
  if (conversation.kind === "channel") {
    return conversation
  }

  const participantIds = Array.from(new Set(conversation.participantIds))
  const visibleParticipantIds = participantIds.includes(actorId)
    ? participantIds.filter((participantId) => participantId !== actorId)
    : participantIds
  const titleSource = visibleParticipantIds.length > 0 ? visibleParticipantIds : participantIds
  const title =
    !participantIds.includes(actorId) && titleSource.length === 2
      ? titleSource.map(participantLabel).join(" + ")
      : titleSource.map(participantLabel).join(", ")

  return {
    ...conversation,
    kind: participantIds.length <= 2 ? "dm" : "group_dm",
    section: "dms",
    slug: null,
    title,
    visibility: "private",
    participantIds,
  }
}

function summarizeConversation(
  conversation: ChatConversationRecord,
  projection: ReturnType<typeof buildChatConversationProjection>,
  actorId: string,
  existing: ChatConversation | null,
): ChatConversation {
  const latestMessage = projection.conversationMessages.reduce<
    (typeof projection.conversationMessages)[number] | null
  >((latest, message) => {
    if (!latest || message.createdAt > latest.createdAt) {
      return message
    }
    return latest
  }, null)

  return {
    conversationId: conversation.conversationId,
    kind: conversation.kind,
    slug: conversation.slug,
    title: conversation.title,
    topic: conversation.topic,
    visibility: conversation.visibility,
    postingPolicy: conversation.postingPolicy,
    lifecycleState: conversation.lifecycleState,
    section: conversation.section,
    dmGroup:
      conversation.kind === "channel"
        ? null
        : conversation.participantIds.includes(actorId)
          ? "with-viewer"
          : "without-viewer",
    participantIds: conversation.participantIds,
    predecessorConversationId: conversation.predecessorConversationId,
    lineageRootConversationId: conversation.lineageRootConversationId,
    historyMode: conversation.historyMode,
    unreadCount: existing?.unreadCount ?? 0,
    mentionCount: existing?.mentionCount ?? 0,
    latestActivityAt:
      existing?.latestActivityAt ?? latestMessage?.createdAt ?? conversation.updatedAt,
    latestMessagePreview: existing?.latestMessagePreview ?? latestMessage?.body ?? "",
    messageCount: existing?.messageCount ?? projection.conversationMessages.length,
  }
}

function roleIdToAccessGrant(roleId: ChatRoleId): ChatConversationAccessGrant["roleId"] | null {
  switch (roleId) {
    case "participant":
    case "viewer":
    case "room_manager":
      return roleId
    default:
      return null
  }
}

async function buildConversationAccessGrants(input: {
  app: ChatCommandService
  actorId: string
  conversationId: string
}): Promise<ChatConversationAccessGrant[]> {
  const roster = await input.app.readConversationRoster({
    conversationId: input.conversationId,
    actorId: input.actorId,
  })
  const derived = new Map<string, ChatConversationAccessGrant>()

  for (const entry of roster) {
    for (const roleId of entry.conversationRoleIds) {
      const grantRoleId = roleIdToAccessGrant(roleId)
      if (!grantRoleId) {
        continue
      }
      const key = `${entry.participantId}:${grantRoleId}`
      derived.set(key, {
        bindingId: `synthetic:${input.conversationId}:${grantRoleId}:${entry.participantId}`,
        subjectId: entry.participantId,
        roleId: grantRoleId,
      })
    }
  }

  try {
    const persisted = await input.app.readConversationGrantBindings({
      conversationId: input.conversationId,
      actorId: input.actorId,
    })
    for (const grant of persisted) {
      const grantRoleId = roleIdToAccessGrant(grant.roleId)
      if (!grantRoleId) {
        continue
      }
      const key = `${grant.subjectId}:${grantRoleId}`
      derived.set(key, {
        bindingId: grant.bindingId,
        subjectId: grant.subjectId,
        roleId: grantRoleId,
      })
    }
  } catch {
    // Non-managers cannot inspect persisted conversation grants. The roster-derived view is enough
    // for read-only shell hydration and actor-local permission checks.
  }

  return [...derived.values()].sort((left, right) => {
    if (left.roleId !== right.roleId) {
      return left.roleId.localeCompare(right.roleId)
    }
    return left.subjectId.localeCompare(right.subjectId)
  })
}

function toSidebarFollowedThread(
  thread: ChatFollowedThread,
  title: string,
): ChatSidebarFollowedThread {
  return {
    entryId: `thread:${thread.conversationId}:${thread.threadRootMessageId}`,
    title,
    preview: thread.latestReplyPreview ?? thread.threadRootPreview,
    conversationId: thread.conversationId,
    threadRootMessageId: thread.threadRootMessageId,
    unreadReplyCount: thread.unreadReplyCount,
    unreadMentionCount: thread.unreadMentionCount,
    latestReplyAt: thread.latestReplyAt,
  }
}

function toViewerRecentSidebarEntry(input: {
  conversationId: string
  title: string
  observedAt: string
  preview: string
}): ChatSidebarViewerRecent {
  return {
    entryId: `viewer:${input.conversationId}`,
    title: input.title,
    preview: input.preview,
    conversationId: input.conversationId,
    observedAt: input.observedAt,
  }
}

function buildCanonicalOpenIntent(input: {
  joinedConversationIds: Set<string>
  conversationId: string
}) {
  return {
    source: input.joinedConversationIds.has(input.conversationId)
      ? ("search" as const)
      : ("viewer-recent" as const),
    openConversationId: input.conversationId,
    sourceConversationId: input.conversationId,
    openMode: input.joinedConversationIds.has(input.conversationId)
      ? ("joined" as const)
      : ("viewer" as const),
    focusMessageId: null,
    activeThreadId: null,
  }
}

function pickDefaultSidebarItemId(input: {
  joinedSummaries: ChatConversation[]
  viewerRecents: ChatSidebarViewerRecent[]
  canonicalConversationIds: string[]
}): string {
  return (
    input.joinedSummaries[0]?.conversationId ??
    input.viewerRecents[0]?.entryId ??
    input.canonicalConversationIds[0] ??
    "general"
  )
}

function buildBaseChat(input: {
  actorId: string
  joinedSummaries: ChatConversation[]
  inbox: ChatShellRuntimeSeed["baseChat"]["sidebar"]["inbox"]
  followedThreads: ChatSidebarFollowedThread[]
  viewerRecents: ChatSidebarViewerRecent[]
  canonicalItems: Record<string, ChatShellRuntimeSeedItem>
  defaultSidebarItemId: string
}) {
  const channels = input.joinedSummaries.filter((conversation) => conversation.kind === "channel")
  const withViewer = input.joinedSummaries.filter(
    (conversation) => conversation.dmGroup === "with-viewer",
  )
  const withoutViewer = input.joinedSummaries.filter(
    (conversation) => conversation.dmGroup === "without-viewer",
  )
  const defaultItem =
    input.canonicalItems[input.defaultSidebarItemId] ??
    input.canonicalItems[input.joinedSummaries[0]?.conversationId ?? ""] ??
    Object.values(input.canonicalItems)[0] ??
    null
  const defaultSummary = defaultItem
    ? summarizeConversation(
        defaultItem.conversation,
        defaultItem.projection,
        input.actorId,
        input.joinedSummaries.find(
          (conversation) => conversation.conversationId === defaultItem.conversation.conversationId,
        ) ?? null,
      )
    : null

  return {
    activeConversationId: defaultItem?.conversation.conversationId ?? input.defaultSidebarItemId,
    activeConversation: defaultSummary,
    transcript: defaultItem?.projection.mainTranscript ?? [],
    activeThreadRoot: defaultItem?.projection.activeThreadRoot ?? null,
    activeThreadMessages: defaultItem?.projection.activeThreadMessages ?? [],
    composerPlaceholder: defaultSummary
      ? defaultSummary.kind === "channel"
        ? `Message #${defaultSummary.title}`
        : `Message ${defaultSummary.title}`
      : "Message room",
    sidebar: {
      inbox: input.inbox,
      followedThreads: input.followedThreads,
      channels,
      dmGroups: [
        ...(withViewer.length > 0
          ? [
              {
                id: "with-viewer" as const,
                label: "With You",
                conversations: withViewer,
              },
            ]
          : []),
        ...(withoutViewer.length > 0
          ? [
              {
                id: "without-viewer" as const,
                label: "Others",
                conversations: withoutViewer,
              },
            ]
          : []),
      ],
      viewerRecents: input.viewerRecents,
    },
  }
}

function joinedConversationIdsForActor(input: {
  actorId: string
  conversationRecords: ChatConversationRecord[]
  memberships: Array<{ conversationId: string; membershipState: "joined" | "left" }>
}): Set<string> {
  return new Set([
    ...input.memberships
      .filter((membership) => membership.membershipState === "joined")
      .map((membership) => membership.conversationId),
    ...input.conversationRecords
      .filter((conversation) => conversation.participantIds.includes(input.actorId))
      .map((conversation) => conversation.conversationId),
  ])
}

async function buildCanonicalConversationItem(input: {
  app: ChatCommandService
  ledger: SharedChatLedger
  scopeId: string
  actorId: string
  conversationId: string
  conversationRecords: ChatConversationRecord[]
  joinedConversationIds: Set<string>
  followedThreadsByConversationId: Map<string, string[]>
}): Promise<ChatShellRuntimeSeedItem | null> {
  const conversationRecord =
    input.conversationRecords.find((record) => record.conversationId === input.conversationId) ??
    null
  if (!conversationRecord) {
    return null
  }

  const normalizedConversation = normalizeConversationForActor(conversationRecord, input.actorId)
  const messages = await input.ledger.listMessages(input.scopeId, input.conversationId)
  const projection = buildChatConversationProjection({
    activeConversationId: input.conversationId,
    activeThreadId: null,
    conversationRecords: input.conversationRecords,
    messages,
  })
  const accessGrants = await buildConversationAccessGrants({
    app: input.app,
    actorId: input.actorId,
    conversationId: input.conversationId,
  })
  const openIntent = buildCanonicalOpenIntent({
    joinedConversationIds: input.joinedConversationIds,
    conversationId: input.conversationId,
  })

  return {
    conversation: normalizedConversation,
    projection,
    openIntent,
    canPostMessage: canChatActorPostMessages({
      conversation: normalizedConversation,
      accessGrants,
      actorId: input.actorId,
      openMode: openIntent.openMode,
    }),
    accessGrants,
    followedThreadIds: input.followedThreadsByConversationId.get(input.conversationId) ?? [],
  }
}

export async function loadDesktopChatRuntimeSeed(
  companyDir: string,
  input: {
    actorId: string
  },
): Promise<ChatShellRuntimeSeed> {
  const actorId = resolveChatActorId(input.actorId)
  const app = new ChatCommandService(companyDir)
  const ledger = new SharedChatLedger(companyDir)
  const scopeId = ledger.scopeId()
  const [
    conversationRecords,
    visibleSummaries,
    inboxEntries,
    followedThreads,
    viewerRecents,
    memberships,
    events,
  ] = await Promise.all([
    ledger.listConversationRecords(scopeId),
    app.readConversationSummaries({ actorId }),
    app.readInbox({ actorId }),
    app.readFollowedThreads({ actorId }),
    app.readViewerRecents({ actorId }),
    ledger.listRoomMembershipRecords(scopeId, { participantId: actorId }),
    ledger.listEvents(scopeId),
  ])
  const joinedConversationIds = joinedConversationIdsForActor({
    actorId,
    conversationRecords,
    memberships,
  })
  const joinedSummaries = visibleSummaries.filter((conversation) =>
    joinedConversationIds.has(conversation.conversationId),
  )

  const followedThreadsByConversationId = new Map<string, string[]>()
  for (const thread of followedThreads) {
    const followedConversationThreadIds =
      followedThreadsByConversationId.get(thread.conversationId) ?? []
    followedConversationThreadIds.push(thread.threadRootMessageId)
    followedThreadsByConversationId.set(thread.conversationId, followedConversationThreadIds)
  }

  const canonicalConversationIds = Array.from(
    new Set([
      ...joinedSummaries.map((conversation) => conversation.conversationId),
      ...inboxEntries.map((entry) => entry.conversationId),
      ...followedThreads.map((thread) => thread.conversationId),
      ...viewerRecents.map((conversation) => conversation.conversationId),
    ]),
  )
  if (canonicalConversationIds.length === 0) {
    throw new Error("Desktop chat hydration requires at least one visible conversation")
  }
  const canonicalItems: Record<string, ChatShellRuntimeSeedItem> = {}
  const normalizedConversationTitleById = new Map<string, string>()

  for (const conversationId of canonicalConversationIds) {
    const item = await buildCanonicalConversationItem({
      app,
      ledger,
      scopeId,
      actorId,
      conversationId,
      conversationRecords,
      joinedConversationIds,
      followedThreadsByConversationId,
    })
    if (!item) {
      continue
    }

    normalizedConversationTitleById.set(conversationId, item.conversation.title)
    canonicalItems[conversationId] = item
  }
  if (Object.keys(canonicalItems).length === 0) {
    throw new Error("Desktop chat hydration could not resolve any canonical conversation records")
  }

  const normalizedJoinedSummaries = joinedSummaries
    .map((summary) => {
      const item = canonicalItems[summary.conversationId]
      if (!item) {
        return null
      }
      return summarizeConversation(item.conversation, item.projection, actorId, {
        ...summary,
        title: item.conversation.title,
      })
    })
    .filter((conversation): conversation is ChatConversation => conversation != null)
  const normalizedInbox = inboxEntries.map((entry) => ({
    ...entry,
    title:
      entry.kind === "direct"
        ? (normalizedConversationTitleById.get(entry.conversationId) ?? entry.title)
        : `Mention in ${normalizedConversationTitleById.get(entry.conversationId) ?? entry.conversationId}`,
  }))
  const normalizedFollowedThreads = followedThreads.map((thread) =>
    toSidebarFollowedThread(
      thread,
      normalizedConversationTitleById.get(thread.conversationId) ?? thread.conversationTitle,
    ),
  )
  const normalizedViewerRecents = viewerRecents.map((conversation) =>
    toViewerRecentSidebarEntry({
      conversationId: conversation.conversationId,
      title: normalizedConversationTitleById.get(conversation.conversationId) ?? conversation.title,
      observedAt: conversation.observedAt,
      preview: conversation.latestMessagePreview,
    }),
  )
  const defaultSidebarItemId = pickDefaultSidebarItemId({
    joinedSummaries: normalizedJoinedSummaries,
    viewerRecents: normalizedViewerRecents,
    canonicalConversationIds,
  })

  return {
    actorId,
    eventWatermark: latestEventSequence(events),
    defaultSidebarItemId,
    itemsBySidebarItemId: canonicalItems,
    baseChat: buildBaseChat({
      actorId,
      joinedSummaries: normalizedJoinedSummaries,
      inbox: normalizedInbox,
      followedThreads: normalizedFollowedThreads,
      viewerRecents: normalizedViewerRecents,
      canonicalItems,
      defaultSidebarItemId,
    }),
  }
}

export async function postDesktopChatMessage(
  companyDir: string,
  input: {
    actorId: string
    conversationId: string
    body: string
    threadId?: string | null
    audienceId?: string | null
  },
): Promise<void> {
  const app = new ChatCommandService(companyDir)
  const actorId = resolveChatActorId(input.actorId)
  await app.postMessage({
    conversationId: input.conversationId,
    senderId: actorId,
    body: input.body,
    threadId: input.threadId ?? null,
    audience: input.audienceId
      ? {
          kind: "participant",
          id: resolveChatActorId(input.audienceId),
        }
      : null,
  })
}

export async function markDesktopChatRead(
  companyDir: string,
  input: {
    actorId: string
    conversationId: string
    threadId?: string | null
  },
): Promise<void> {
  const app = new ChatCommandService(companyDir)
  await app.markConversationRead({
    conversationId: input.conversationId,
    actorId: resolveChatActorId(input.actorId),
    threadId: input.threadId ?? null,
  })
}

export async function setDesktopChatThreadFollowState(
  companyDir: string,
  input: {
    actorId: string
    conversationId: string
    threadId: string
    followed: boolean
  },
): Promise<void> {
  const app = new ChatCommandService(companyDir)
  await app.setThreadFollowState({
    conversationId: input.conversationId,
    actorId: resolveChatActorId(input.actorId),
    threadId: input.threadId,
    attached: input.followed,
  })
}

export async function searchDesktopChatMessages(
  companyDir: string,
  input: {
    actorId: string
    query: string
    limit?: number
  },
): Promise<ChatRuntimeGatewaySearchResult[]> {
  const actorId = resolveChatActorId(input.actorId)
  const app = new ChatCommandService(companyDir)
  const ledger = new SharedChatLedger(companyDir)
  const scopeId = ledger.scopeId()
  const [results, conversationRecords, memberships, followedThreads] = await Promise.all([
    app.searchVisibleMessages({
      actorId,
      query: input.query,
      limit: input.limit,
    }),
    ledger.listConversationRecords(scopeId),
    ledger.listRoomMembershipRecords(scopeId, { participantId: actorId }),
    app.readFollowedThreads({ actorId }),
  ])
  const joinedConversationIds = joinedConversationIdsForActor({
    actorId,
    conversationRecords,
    memberships,
  })
  const followedThreadsByConversationId = new Map<string, string[]>()
  for (const thread of followedThreads) {
    const conversationThreadIds = followedThreadsByConversationId.get(thread.conversationId) ?? []
    conversationThreadIds.push(thread.threadRootMessageId)
    followedThreadsByConversationId.set(thread.conversationId, conversationThreadIds)
  }
  const canonicalItems = new Map<string, ChatShellRuntimeSeedItem>()

  const mappedResults = await Promise.all(
    results.map(async (result) => {
      let item = canonicalItems.get(result.openConversationId) ?? null
      if (!item) {
        item = await buildCanonicalConversationItem({
          app,
          ledger,
          scopeId,
          actorId,
          conversationId: result.openConversationId,
          conversationRecords,
          joinedConversationIds,
          followedThreadsByConversationId,
        })
        if (item) {
          canonicalItems.set(result.openConversationId, item)
        }
      }
      if (!item) {
        return null
      }

      return {
        resultKind: "message",
        sidebarItemId: result.openConversationId,
        conversationId: result.sourceConversationId,
        conversationTitle: item.conversation.title,
        messageId: result.messageId,
        threadId: result.threadId,
        openMode: result.openMode,
        preview: result.preview,
        createdAt: result.createdAt,
        seedItem: item,
        viewerRecentEntry:
          result.openMode === "viewer"
            ? toViewerRecentSidebarEntry({
                conversationId: result.openConversationId,
                title: item.conversation.title,
                observedAt: result.createdAt,
                preview: result.preview,
              })
            : undefined,
      } satisfies ChatRuntimeGatewaySearchResult
    }),
  )

  return mappedResults.flatMap((result) => (result ? [result] : []))
}

export async function pollDesktopChatEvents(
  companyDir: string,
  input: {
    actorId: string
    afterSequence: number
    limit?: number
  },
): Promise<ChatRuntimeGatewayPollEventsResult> {
  const app = new ChatCommandService(companyDir)
  const events = await app.readChatEvents({
    actorId: resolveChatActorId(input.actorId),
    afterSequence: input.afterSequence,
    limit: input.limit,
  })
  return {
    nextSequence: events.at(-1)?.sequence ?? input.afterSequence,
    hasEvents: events.length > 0,
  }
}

export async function joinDesktopChatConversation(
  companyDir: string,
  input: {
    actorId: string
    conversationId: string
  },
): Promise<void> {
  const app = new ChatCommandService(companyDir)
  await app.joinConversation({
    conversationId: input.conversationId,
    participantId: resolveChatActorId(input.actorId),
  })
}

export async function leaveDesktopChatConversation(
  companyDir: string,
  input: {
    actorId: string
    conversationId: string
  },
): Promise<void> {
  const app = new ChatCommandService(companyDir)
  await app.leaveConversation({
    conversationId: input.conversationId,
    participantId: resolveChatActorId(input.actorId),
  })
}

export async function addDesktopChatConversationParticipant(
  companyDir: string,
  input: {
    actorId: string
    conversationId: string
    participantId: string
  },
): Promise<void> {
  const app = new ChatCommandService(companyDir)
  const actorId = resolveChatActorId(input.actorId)
  const participantId = resolveChatActorId(input.participantId)

  // Materialize the roster addition in one managed step by granting join access first.
  await app.inviteParticipant({
    conversationId: input.conversationId,
    subjectId: participantId,
    invitedById: actorId,
  })
  await app.joinConversation({
    conversationId: input.conversationId,
    participantId,
  })
}

export async function removeDesktopChatConversationParticipant(
  companyDir: string,
  input: {
    actorId: string
    conversationId: string
    participantId: string
  },
): Promise<void> {
  const app = new ChatCommandService(companyDir)
  await app.removeConversationParticipant({
    conversationId: input.conversationId,
    actorId: resolveChatActorId(input.actorId),
    participantId: resolveChatActorId(input.participantId),
  })
}

export async function grantDesktopChatConversationAccess(
  companyDir: string,
  input: ChatRuntimeGatewayGrantAccessInput,
): Promise<void> {
  const app = new ChatCommandService(companyDir)
  const actorId = resolveChatActorId(input.actorId)
  const participantId = resolveChatActorId(input.participantId)

  switch (input.roleId) {
    case "participant":
      await app.inviteParticipant({
        conversationId: input.conversationId,
        subjectId: participantId,
        invitedById: actorId,
      })
      return
    case "viewer":
      await app.grantViewerAccess({
        conversationId: input.conversationId,
        subjectId: participantId,
        grantedById: actorId,
      })
      return
    case "room_manager":
      await app.grantConversationRole({
        conversationId: input.conversationId,
        subjectId: participantId,
        roleId: "room_manager",
        grantedById: actorId,
      })
      return
  }
}

export async function revokeDesktopChatConversationAccess(
  companyDir: string,
  input: {
    actorId: string
    conversationId: string
    bindingId: string
  },
): Promise<void> {
  const app = new ChatCommandService(companyDir)
  await app.revokeConversationGrantBinding({
    conversationId: input.conversationId,
    bindingId: input.bindingId,
    actorId: resolveChatActorId(input.actorId),
  })
}

export async function updateDesktopChatConversationSettings(
  companyDir: string,
  input: ChatRuntimeGatewayUpdateConversationSettingsInput,
): Promise<void> {
  const app = new ChatCommandService(companyDir)
  await app.updateConversationSettings({
    conversationId: input.conversationId,
    updatedById: resolveChatActorId(input.actorId),
    title: input.title,
    topic: input.topic,
    visibility: input.visibility,
    postingPolicy: input.postingPolicy,
  })
}

export async function archiveDesktopChatConversation(
  companyDir: string,
  input: ChatRuntimeGatewayArchiveConversationInput,
): Promise<void> {
  const app = new ChatCommandService(companyDir)
  await app.archiveConversation({
    conversationId: input.conversationId,
    archivedById: resolveChatActorId(input.actorId),
  })
}

export async function setDesktopChatMessageReaction(
  companyDir: string,
  input: {
    actorId: string
    conversationId: string
    messageId: string
    emoji: string
    active: boolean
  },
): Promise<void> {
  const app = new ChatCommandService(companyDir)
  await app.setMessageReaction({
    conversationId: input.conversationId,
    actorId: resolveChatActorId(input.actorId),
    messageId: input.messageId,
    emoji: input.emoji,
    active: input.active,
  })
}

export async function editDesktopChatMessage(
  companyDir: string,
  input: {
    actorId: string
    conversationId: string
    messageId: string
    body: string
  },
): Promise<void> {
  const app = new ChatCommandService(companyDir)
  await app.editMessage({
    conversationId: input.conversationId,
    actorId: resolveChatActorId(input.actorId),
    messageId: input.messageId,
    body: input.body,
  })
}

export async function redactDesktopChatMessage(
  companyDir: string,
  input: {
    actorId: string
    conversationId: string
    messageId: string
  },
): Promise<void> {
  const app = new ChatCommandService(companyDir)
  await app.redactMessage({
    conversationId: input.conversationId,
    actorId: resolveChatActorId(input.actorId),
    messageId: input.messageId,
  })
}

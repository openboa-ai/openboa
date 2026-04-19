import { describe, expect, it } from "vitest"
import { openViewerRecentConversation } from "../src/shell/chat/index.js"
import {
  addChatConversationParticipant,
  appendChatMessage,
  archiveChatConversation,
  buildChatRuntimeState,
  chatSearchResultKey,
  createChatConversation,
  createChatDirectConversation,
  createChatShellRuntimeSeed,
  editChatMessage,
  grantChatConversationAccess,
  hideChatViewerConversation,
  joinChatConversation,
  leaveChatConversation,
  markChatConversationRead,
  markChatThreadRead,
  openChatSearchResult,
  openChatSidebarItem,
  redactChatMessage,
  removeChatConversationParticipant,
  resolveChatSearchSelection,
  resolveInitialChatSidebarItemId,
  restoreChatDraftPersistence,
  restoreChatShellRuntimeSeed,
  retargetChatShellRuntimeSeed,
  revokeChatConversationAccess,
  searchChatMessages,
  setChatThreadFollowState,
  setChatThreadOpenState,
  toggleChatConversationPostingPolicy,
  toggleChatMessageReaction,
  updateChatConversationDetails,
} from "../src/shell/web/chat-app-state.js"
import { makeConversationRecord, makeProjectedMessage } from "../src/shell/web/chat-seed.js"

describe("chat shell runtime state", () => {
  it("accepts only known sidebar selections", () => {
    expect(resolveInitialChatSidebarItemId("ops")).toBe("ops")
    expect(resolveInitialChatSidebarItemId("mention:general-second")).toBe("mention:general-second")
    expect(resolveInitialChatSidebarItemId("missing-item")).toBe("general")
  })

  it("switches to a restricted conversation with no thread drawer", () => {
    const runtime = buildChatRuntimeState("ops")

    expect(runtime.selectedSidebarItemId).toBe("ops")
    expect(runtime.chat.activeConversationId).toBe("ops")
    expect(runtime.transcriptView.conversationId).toBe("ops")
    expect(runtime.transcriptView.composer.enabled).toBe(true)
    expect(runtime.transcriptView.composer.disabledReason).toBeNull()
    expect(runtime.detailPane).toBeNull()
  })

  it("opens inbox entries into their target conversation without changing the selected row id", () => {
    const runtime = buildChatRuntimeState("mention:general-second")

    expect(runtime.selectedSidebarItemId).toBe("mention:general-second")
    expect(runtime.chat.activeConversationId).toBe("general")
    expect(runtime.transcriptView.focusMessageId).toBe("general-second")
    expect(runtime.transcriptView.threadDrawer.open).toBe(false)
  })

  it("opens followed thread sidebar rows directly into the thread drawer", () => {
    const runtime = buildChatRuntimeState("thread:general:general-root")

    expect(runtime.selectedSidebarItemId).toBe("thread:general:general-root")
    expect(runtime.chat.activeConversationId).toBe("general")
    expect(runtime.detailPane).toEqual({
      kind: "thread",
      title: "general",
    })
    expect(runtime.transcriptView.threadDrawer.open).toBe(true)
    expect(runtime.transcriptView.threadDrawer.rootMessage?.messageId).toBe("general-root")
  })

  it("opens viewer recent sidebar rows in explicit viewer mode", () => {
    const runtime = buildChatRuntimeState("viewer:finance-private")

    expect(runtime.selectedSidebarItemId).toBe("viewer:finance-private")
    expect(runtime.chat.activeConversationId).toBe("finance-private")
    expect(runtime.transcriptView.openMode).toBe("viewer")
    expect(runtime.transcriptView.composer.enabled).toBe(false)
  })

  it("normalizes seeded direct conversation titles relative to the active actor", () => {
    const seed = createChatShellRuntimeSeed({ actorId: "alpha" })
    const runtime = buildChatRuntimeState("dm-alpha", { seed })

    expect(runtime.chat.activeConversation).toMatchObject({
      conversationId: "dm-alpha",
      title: "Founder",
      dmGroup: "with-viewer",
    })
  })

  it("builds seed inbox and viewer recents relative to the active actor", () => {
    const founderSeed = createChatShellRuntimeSeed()
    const alphaSeed = createChatShellRuntimeSeed({ actorId: "alpha" })

    expect(founderSeed.baseChat.sidebar.inbox).toEqual([
      expect.objectContaining({
        entryId: "mention:general-second",
        conversationId: "general",
      }),
    ])
    expect(founderSeed.baseChat.sidebar.viewerRecents).toEqual([
      expect.objectContaining({
        entryId: "viewer:finance-private",
        conversationId: "finance-private",
      }),
    ])
    expect(alphaSeed.baseChat.sidebar.inbox).toEqual([])
    expect(alphaSeed.baseChat.sidebar.viewerRecents).toEqual([])
    expect(alphaSeed.itemsBySidebarItemId["viewer:finance-private"]).toBeUndefined()
    expect(alphaSeed.itemsBySidebarItemId["mention:general-second"]).toBeUndefined()
  })

  it("deduplicates followed thread entries for the same conversation thread", () => {
    const seed = createChatShellRuntimeSeed()

    expect(
      seed.baseChat.sidebar.followedThreads.filter(
        (entry) =>
          entry.conversationId === "general" && entry.threadRootMessageId === "general-root",
      ),
    ).toHaveLength(1)
  })

  it("restores persisted chat seeds and re-synchronizes derived sidebar state", () => {
    const seed = createChatShellRuntimeSeed()
    const restored = restoreChatShellRuntimeSeed(JSON.stringify(seed))

    expect(restored.actorId).toBe(seed.actorId)
    expect(
      restored.baseChat.sidebar.followedThreads.filter(
        (entry) =>
          entry.conversationId === "general" && entry.threadRootMessageId === "general-root",
      ),
    ).toHaveLength(1)
    expect(restored.itemsBySidebarItemId["thread:general:general-root"]).toBeDefined()
  })

  it("falls back to a fresh default seed when persisted chat state is invalid", () => {
    const restored = restoreChatShellRuntimeSeed("{not-json")

    expect(restored.actorId).toBe("founder")
    expect(restored.defaultSidebarItemId).toBe("general")
  })

  it("restores persisted chat drafts and audience selections", () => {
    expect(
      restoreChatDraftPersistence(
        JSON.stringify({
          conversationDrafts: { general: "Need to follow up" },
          threadDrafts: { "general:general-root": "Reply draft" },
          conversationAudienceSelections: { general: "alpha" },
          threadAudienceSelections: { "general:general-root": "beta" },
        }),
      ),
    ).toEqual({
      conversationDrafts: { general: "Need to follow up" },
      threadDrafts: { "general:general-root": "Reply draft" },
      conversationAudienceSelections: { general: "alpha" },
      threadAudienceSelections: { "general:general-root": "beta" },
    })
    expect(restoreChatDraftPersistence("{bad-json")).toEqual({
      conversationDrafts: {},
      threadDrafts: {},
      conversationAudienceSelections: {},
      threadAudienceSelections: {},
    })
  })

  it("retargets an existing seed to another actor without resetting chat state", () => {
    const founderSeed = createChatShellRuntimeSeed()
    const nextSeed = appendChatMessage({
      seed: founderSeed,
      sidebarItemId: "ops",
      body: "Founder, can you check the deploy queue?",
      senderId: "alpha",
      threadId: null,
      audienceId: "founder",
      activeSidebarItemId: "general",
    })

    const alphaSeed = retargetChatShellRuntimeSeed(nextSeed, "alpha")
    const alphaRuntime = buildChatRuntimeState("general", { seed: alphaSeed })

    expect(alphaSeed.actorId).toBe("alpha")
    expect(alphaRuntime.chat.sidebar.inbox).toEqual([])
    expect(alphaRuntime.chat.sidebar.viewerRecents).toEqual([])
    expect(
      alphaRuntime.chat.sidebar.dmGroups
        .flatMap((group) => group.conversations)
        .find((conversation) => conversation.conversationId === "dm-alpha"),
    ).toMatchObject({
      title: "Founder",
      dmGroup: "with-viewer",
    })
    expect(
      alphaRuntime.chat.sidebar.channels.find(
        (conversation) => conversation.conversationId === "ops",
      ),
    ).toMatchObject({
      unreadCount: 0,
      mentionCount: 0,
      latestMessagePreview: "Founder, can you check the deploy queue?",
    })
  })

  it("hides viewer conversations from recents and falls back to the default room", () => {
    const seed = createChatShellRuntimeSeed()
    const hidden = hideChatViewerConversation(seed, "viewer:finance-private")
    const runtime = buildChatRuntimeState(hidden.nextSidebarItemId, { seed: hidden.seed })

    expect(hidden.seed.baseChat.sidebar.viewerRecents).toEqual([])
    expect(hidden.seed.itemsBySidebarItemId["viewer:finance-private"]).toBeUndefined()
    expect(hidden.nextSidebarItemId).toBe("general")
    expect(runtime.chat.activeConversationId).toBe("general")
  })

  it("creates a new channel conversation and opens it as the active room", () => {
    const seed = createChatShellRuntimeSeed()
    const created = createChatConversation({
      seed,
      title: "Release Notes",
      creatorId: "founder",
    })

    const runtime = buildChatRuntimeState(created.sidebarItemId, { seed: created.seed })

    expect(created.sidebarItemId).toBe("release-notes")
    expect(runtime.chat.activeConversationId).toBe("release-notes")
    expect(runtime.chat.activeConversation?.title).toBe("Release Notes")
    expect(runtime.chat.sidebar.channels[0]?.conversationId).toBe("release-notes")
    expect(runtime.transcriptView.composer.enabled).toBe(true)
    expect(runtime.transcriptView.chrome.canManageParticipants).toBe(true)
    expect(runtime.transcriptView.transcript).toEqual([])
  })

  it("uniquifies created channel identifiers when the slug already exists", () => {
    const seed = createChatShellRuntimeSeed()
    const created = createChatConversation({
      seed,
      title: "general",
      creatorId: "founder",
    })

    expect(created.sidebarItemId).toBe("general-2")
    expect(created.seed.itemsBySidebarItemId["general-2"]?.conversation.slug).toBe("general-2")
  })

  it("creates private channels with private visibility", () => {
    const seed = createChatShellRuntimeSeed()
    const created = createChatConversation({
      seed,
      title: "Leadership",
      creatorId: "founder",
      visibility: "private",
    })
    const runtime = buildChatRuntimeState(created.sidebarItemId, { seed: created.seed })

    expect(runtime.chat.activeConversation?.visibility).toBe("private")
    expect(created.seed.itemsBySidebarItemId.leadership?.conversation.visibility).toBe("private")
  })

  it("creates direct conversations and opens them in the dm groups", () => {
    const seed = createChatShellRuntimeSeed()
    const created = createChatDirectConversation({
      seed,
      creatorId: "founder",
      participantIds: ["alpha"],
    })
    const runtime = buildChatRuntimeState(created.sidebarItemId, { seed: created.seed })

    expect(runtime.chat.activeConversation).toMatchObject({
      kind: "dm",
      title: "Alpha",
      visibility: "private",
      participantIds: ["founder", "alpha"],
    })
    expect(runtime.chat.sidebar.dmGroups.flatMap((group) => group.conversations)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          conversationId: created.sidebarItemId,
          kind: "dm",
          title: "Alpha",
        }),
      ]),
    )
  })

  it("creates group direct conversations when multiple participants are provided", () => {
    const seed = createChatShellRuntimeSeed()
    const created = createChatDirectConversation({
      seed,
      creatorId: "founder",
      participantIds: ["alpha", "beta"],
    })
    const runtime = buildChatRuntimeState(created.sidebarItemId, { seed: created.seed })

    expect(runtime.chat.activeConversation).toMatchObject({
      kind: "group_dm",
      title: "Alpha, Beta",
      visibility: "private",
      participantIds: ["founder", "alpha", "beta"],
    })
  })

  it("creates direct conversation titles relative to the active actor", () => {
    const seed = createChatShellRuntimeSeed({ actorId: "alpha" })
    const created = createChatDirectConversation({
      seed,
      creatorId: "alpha",
      participantIds: ["beta"],
    })
    const runtime = buildChatRuntimeState(created.sidebarItemId, { seed: created.seed })

    expect(runtime.chat.activeConversation).toMatchObject({
      kind: "dm",
      title: "Beta",
      participantIds: ["alpha", "beta"],
    })
  })

  it("reuses an existing direct conversation for the same participant set", () => {
    const seed = createChatShellRuntimeSeed()
    const created = createChatDirectConversation({
      seed,
      creatorId: "founder",
      participantIds: ["alpha"],
    })

    expect(created.sidebarItemId).toBe("dm-alpha")
    expect(created.seed).toBe(seed)
  })

  it("normalizes group direct conversations to a dm when only two remote participants remain", () => {
    const seed = createChatShellRuntimeSeed()
    const created = createChatDirectConversation({
      seed,
      creatorId: "founder",
      participantIds: ["alpha", "beta"],
    })
    const next = leaveChatConversation(created.seed, created.sidebarItemId, "founder")
    const runtime = buildChatRuntimeState(next.nextSidebarItemId, { seed: next.seed })

    expect(next.nextSidebarItemId).toBe(created.sidebarItemId)
    expect(runtime.transcriptView.openMode).toBe("viewer")
    expect(runtime.transcriptView.composer.enabled).toBe(false)
    expect(runtime.chat.activeConversation).toMatchObject({
      kind: "dm",
      title: "Alpha + Beta",
      dmGroup: "without-viewer",
      participantIds: ["alpha", "beta"],
    })
    expect(runtime.transcriptView.transcript.at(-1)?.body).toBe("Founder left the room.")
  })

  it("adds new participants to joined rooms and appends a room event", () => {
    const seed = createChatShellRuntimeSeed()
    const nextSeed = addChatConversationParticipant({
      seed,
      sidebarItemId: "general",
      participantId: "gamma",
    })
    const runtime = buildChatRuntimeState("general", { seed: nextSeed })

    expect(runtime.chat.activeConversation?.participantIds).toContain("gamma")
    expect(runtime.transcriptView.transcript.at(-1)).toMatchObject({
      author: { kind: "system" },
      body: "Gamma joined the room.",
    })
  })

  it("grants viewer access in joined rooms and records a room grant event", () => {
    const seed = createChatShellRuntimeSeed()
    const nextSeed = grantChatConversationAccess({
      seed,
      sidebarItemId: "general",
      participantId: "sam",
      roleId: "viewer",
    })
    const runtime = buildChatRuntimeState("general", { seed: nextSeed })

    expect(runtime.transcriptView.accessGrants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subjectId: "sam",
          roleId: "viewer",
        }),
      ]),
    )
    expect(runtime.transcriptView.transcript.at(-1)).toMatchObject({
      author: { kind: "system" },
      systemEventKind: "room-grant-added",
      body: "Sam can now view the room.",
    })
  })

  it("revokes existing room access grants and records the revoke event", () => {
    const seed = createChatShellRuntimeSeed()
    const granted = grantChatConversationAccess({
      seed,
      sidebarItemId: "general",
      participantId: "sam",
      roleId: "room_manager",
    })
    const bindingId = buildChatRuntimeState("general", {
      seed: granted,
    }).transcriptView.accessGrants.find(
      (grant) => grant.subjectId === "sam" && grant.roleId === "room_manager",
    )?.bindingId

    expect(bindingId).toBeTruthy()

    const nextSeed = revokeChatConversationAccess({
      seed: granted,
      sidebarItemId: "general",
      bindingId: bindingId ?? "",
    })
    const runtime = buildChatRuntimeState("general", { seed: nextSeed })

    expect(
      runtime.transcriptView.accessGrants.some(
        (grant) => grant.subjectId === "sam" && grant.roleId === "room_manager",
      ),
    ).toBe(false)
    expect(runtime.transcriptView.transcript.at(-1)).toMatchObject({
      author: { kind: "system" },
      systemEventKind: "room-grant-revoked",
      body: "Room manager access for Sam was revoked.",
    })
  })

  it("adds participants to group direct conversations without duplicating existing ids", () => {
    const seed = createChatShellRuntimeSeed()
    const created = createChatDirectConversation({
      seed,
      creatorId: "founder",
      participantIds: ["alpha", "beta"],
    })
    const expandedSeed = addChatConversationParticipant({
      seed: created.seed,
      sidebarItemId: created.sidebarItemId,
      participantId: "gamma",
    })
    const duplicateAttempt = addChatConversationParticipant({
      seed: expandedSeed,
      sidebarItemId: created.sidebarItemId,
      participantId: "gamma",
    })
    const runtime = buildChatRuntimeState(created.sidebarItemId, { seed: duplicateAttempt })

    expect(runtime.chat.activeConversation?.participantIds).toEqual([
      "founder",
      "alpha",
      "beta",
      "gamma",
    ])
    expect(
      runtime.transcriptView.transcript.filter(
        (message) => message.body === "Gamma joined the room.",
      ),
    ).toHaveLength(1)
  })

  it("can close the active thread drawer without losing the selected conversation", () => {
    const runtime = buildChatRuntimeState("general", {
      threadDrawerOpenOverrides: { general: false },
    })

    expect(runtime.selectedSidebarItemId).toBe("general")
    expect(runtime.chat.activeConversationId).toBe("general")
    expect(runtime.transcriptView.threadDrawer.open).toBe(false)
    expect(runtime.detailPane).toBeNull()
  })

  it("appends mainline messages into the active transcript and refreshes sidebar preview", () => {
    const seed = createChatShellRuntimeSeed()
    const nextSeed = appendChatMessage({
      seed,
      sidebarItemId: "general",
      body: "Closing the launch checklist now.",
      senderId: "founder",
      threadId: null,
    })

    const runtime = buildChatRuntimeState("general", { seed: nextSeed })

    expect(runtime.transcriptView.transcript.at(-1)?.body).toBe("Closing the launch checklist now.")
    expect(runtime.chat.activeConversation?.latestMessagePreview).toBe(
      "Closing the launch checklist now.",
    )
    expect(runtime.chat.activeConversation?.unreadCount).toBe(0)
    expect(runtime.chat.sidebar.inbox).toEqual([])
  })

  it("raises unread and inbox attention for external mainline messages in inactive rooms", () => {
    const seed = createChatShellRuntimeSeed()
    const nextSeed = appendChatMessage({
      seed,
      sidebarItemId: "ops",
      body: "Founder, can you check the deploy queue?",
      senderId: "alpha",
      threadId: null,
      audienceId: "founder",
      activeSidebarItemId: "general",
    })
    const runtime = buildChatRuntimeState("general", { seed: nextSeed })
    const opsConversation = runtime.chat.sidebar.channels.find(
      (conversation) => conversation.conversationId === "ops",
    )
    const mentionEntry = runtime.chat.sidebar.inbox.find(
      (entry) => entry.conversationId === "ops" && entry.kind === "mention",
    )

    expect(opsConversation).toMatchObject({
      unreadCount: 1,
      mentionCount: 1,
      latestMessagePreview: "Founder, can you check the deploy queue?",
    })
    expect(mentionEntry).toMatchObject({
      preview: "Founder, can you check the deploy queue?",
      messageId: expect.stringContaining("ops-msg-"),
    })
  })

  it("routes mention attention to the active actor instead of the default founder", () => {
    const seed = createChatShellRuntimeSeed({ actorId: "alpha" })
    const nextSeed = appendChatMessage({
      seed,
      sidebarItemId: "ops",
      body: "Alpha, check the deploy queue.",
      senderId: "founder",
      threadId: null,
      audienceId: "alpha",
      activeSidebarItemId: "general",
    })
    const runtime = buildChatRuntimeState("general", { seed: nextSeed })
    const opsConversation = runtime.chat.sidebar.channels.find(
      (conversation) => conversation.conversationId === "ops",
    )
    const mentionEntry = runtime.chat.sidebar.inbox.find(
      (entry) => entry.conversationId === "ops" && entry.kind === "mention",
    )

    expect(opsConversation).toMatchObject({
      unreadCount: 1,
      mentionCount: 1,
      latestMessagePreview: "Alpha, check the deploy queue.",
    })
    expect(mentionEntry).toMatchObject({
      preview: "Alpha, check the deploy queue.",
      messageId: expect.stringContaining("ops-msg-"),
    })
  })

  it("opens dynamically created inbox rows and clears room attention", () => {
    const seed = createChatShellRuntimeSeed()
    const nextSeed = appendChatMessage({
      seed,
      sidebarItemId: "ops",
      body: "Founder, can you check the deploy queue?",
      senderId: "alpha",
      threadId: null,
      audienceId: "founder",
      activeSidebarItemId: "general",
    })
    const runtime = buildChatRuntimeState("general", { seed: nextSeed })
    const mentionEntry = runtime.chat.sidebar.inbox.find(
      (entry) => entry.conversationId === "ops" && entry.kind === "mention",
    )
    if (!mentionEntry) {
      throw new Error("Expected generated inbox entry")
    }

    const openedSeed = openChatSidebarItem(nextSeed, mentionEntry.entryId)
    const openedRuntime = buildChatRuntimeState("ops", { seed: openedSeed })

    expect(openedRuntime.selectedSidebarItemId).toBe("ops")
    expect(openedRuntime.chat.activeConversationId).toBe("ops")
    expect(openedRuntime.chat.activeConversation).toMatchObject({
      unreadCount: 0,
      mentionCount: 0,
    })
    expect(
      openedRuntime.chat.sidebar.inbox.find(
        (entry) => entry.conversationId === "ops" && entry.kind === "mention",
      ),
    ).toEqual(
      expect.objectContaining({
        resolvedAt: expect.any(String),
      }),
    )
  })

  it("does not raise unread attention for external messages in the actively open room", () => {
    const seed = createChatShellRuntimeSeed()
    const nextSeed = appendChatMessage({
      seed,
      sidebarItemId: "general",
      body: "Founder, this stays quiet because the room is open.",
      senderId: "alpha",
      threadId: null,
      audienceId: "founder",
      activeSidebarItemId: "general",
    })
    const runtime = buildChatRuntimeState("general", { seed: nextSeed })

    expect(runtime.chat.activeConversation).toMatchObject({
      unreadCount: 0,
      mentionCount: 0,
      latestMessagePreview: "Founder, this stays quiet because the room is open.",
    })
    expect(
      runtime.chat.sidebar.inbox.some(
        (entry) =>
          entry.conversationId === "general" &&
          entry.preview === "Founder, this stays quiet because the room is open.",
      ),
    ).toBe(false)
  })

  it("reorders channels by latest activity after new mainline messages", () => {
    const seed = createChatShellRuntimeSeed()
    const nextSeed = appendChatMessage({
      seed,
      sidebarItemId: "ops",
      body: "Ops now owns the hottest room in the sidebar.",
      senderId: "founder",
      threadId: null,
    })
    const runtime = buildChatRuntimeState("ops", { seed: nextSeed })

    expect(runtime.chat.sidebar.channels[0]?.conversationId).toBe("ops")
    expect(runtime.chat.activeConversation?.latestMessagePreview).toBe(
      "Ops now owns the hottest room in the sidebar.",
    )
  })

  it("preserves addressed audience on newly posted messages", () => {
    const seed = createChatShellRuntimeSeed()
    const nextSeed = appendChatMessage({
      seed,
      sidebarItemId: "general",
      body: "Alpha, please close the launch doc.",
      senderId: "founder",
      threadId: null,
      audienceId: "alpha",
    })

    const runtime = buildChatRuntimeState("general", { seed: nextSeed })

    expect(runtime.transcriptView.transcript.at(-1)?.body).toBe(
      "Alpha, please close the launch doc.",
    )
    expect(runtime.transcriptView.transcript.at(-1)?.audience).toEqual({
      kind: "participant",
      id: "alpha",
    })
  })

  it("appends thread replies and refreshes thread metadata in place", () => {
    const seed = createChatShellRuntimeSeed()
    const nextSeed = appendChatMessage({
      seed,
      sidebarItemId: "general",
      body: "I closed the reliability pass.",
      senderId: "founder",
      threadId: "general-root",
    })

    const runtime = buildChatRuntimeState("general", { seed: nextSeed })

    expect(runtime.transcriptView.threadDrawer.open).toBe(true)
    expect(runtime.transcriptView.threadDrawer.messages.at(-1)?.body).toBe(
      "I closed the reliability pass.",
    )
    expect(runtime.transcriptView.transcript[0]?.threadReplyCount).toBe(2)
    expect(runtime.transcriptView.transcript[0]?.threadPreview).toBe(
      "I closed the reliability pass.",
    )
  })

  it("clears unread state and soft-resolves inbox entries when a conversation is marked read", () => {
    const seed = createChatShellRuntimeSeed()
    const nextSeed = markChatConversationRead(seed, "general")

    const runtime = buildChatRuntimeState("general", { seed: nextSeed })

    expect(runtime.chat.activeConversation?.unreadCount).toBe(0)
    expect(runtime.chat.activeConversation?.mentionCount).toBe(0)
    expect(runtime.chat.sidebar.inbox).toEqual([
      expect.objectContaining({
        conversationId: "general",
        resolvedAt: expect.any(String),
      }),
    ])
  })

  it("toggles thread follow state on the active thread drawer", () => {
    const seed = createChatShellRuntimeSeed()
    const unfollowedSeed = setChatThreadFollowState(seed, "general", "general-root", false)
    const unfollowedRuntime = buildChatRuntimeState("general", { seed: unfollowedSeed })

    expect(unfollowedRuntime.transcriptView.threadDrawer.followed).toBe(false)

    const followedSeed = setChatThreadFollowState(unfollowedSeed, "general", "general-root", true)
    const followedRuntime = buildChatRuntimeState("general", { seed: followedSeed })

    expect(followedRuntime.transcriptView.threadDrawer.followed).toBe(true)
  })

  it("tracks followed thread attention for external replies and clears it when opened", () => {
    const seed = createChatShellRuntimeSeed()
    const unfollowedSeed = setChatThreadFollowState(seed, "general", "general-root", false)
    const followedSeed = setChatThreadFollowState(unfollowedSeed, "general", "general-root", true)
    const idleSeed = setChatThreadOpenState(followedSeed, "general", null)
    const nextSeed = appendChatMessage({
      seed: idleSeed,
      sidebarItemId: "general",
      body: "Founder, can you sanity-check this thread?",
      senderId: "alpha",
      threadId: "general-root",
      audienceId: "founder",
    })
    const runtime = buildChatRuntimeState("general", { seed: nextSeed })
    const followedEntry = runtime.chat.sidebar.followedThreads.find(
      (entry) => entry.conversationId === "general" && entry.threadRootMessageId === "general-root",
    )

    expect(followedEntry).toMatchObject({
      unreadReplyCount: 1,
      unreadMentionCount: 1,
      preview: "Founder, can you sanity-check this thread?",
    })

    const clearedSeed = setChatThreadOpenState(nextSeed, "general", "general-root")
    const clearedRuntime = buildChatRuntimeState("general", { seed: clearedSeed })
    const clearedEntry = clearedRuntime.chat.sidebar.followedThreads.find(
      (entry) => entry.conversationId === "general" && entry.threadRootMessageId === "general-root",
    )

    expect(clearedEntry).toMatchObject({
      unreadReplyCount: 0,
      unreadMentionCount: 0,
    })
  })

  it("marks followed thread attention read without reopening the thread", () => {
    const seed = createChatShellRuntimeSeed()
    const idleSeed = setChatThreadOpenState(seed, "general", null)
    const nextSeed = appendChatMessage({
      seed: idleSeed,
      sidebarItemId: "general",
      body: "Founder, review this follow-up when you can.",
      senderId: "alpha",
      threadId: "general-root",
      audienceId: "founder",
    })
    const threadEntryId = "thread:general:general-root"
    const unreadRuntime = buildChatRuntimeState(threadEntryId, { seed: nextSeed })

    expect(unreadRuntime.transcriptView.threadDrawer.unreadReplyCount).toBeGreaterThan(0)
    expect(unreadRuntime.transcriptView.threadDrawer.unreadMentionCount).toBe(1)

    const clearedSeed = markChatThreadRead(nextSeed, threadEntryId, "general-root")
    const clearedRuntime = buildChatRuntimeState(threadEntryId, { seed: clearedSeed })

    expect(clearedRuntime.transcriptView.threadDrawer.unreadReplyCount).toBe(0)
    expect(clearedRuntime.transcriptView.threadDrawer.unreadMentionCount).toBe(0)
  })

  it("toggles quick reactions on participant messages", () => {
    const seed = createChatShellRuntimeSeed()
    const likedSeed = toggleChatMessageReaction({
      seed,
      sidebarItemId: "general",
      messageId: "general-root",
      emoji: "👍",
      participantId: "founder",
    })
    const likedRuntime = buildChatRuntimeState("general", { seed: likedSeed })

    expect(likedRuntime.transcriptView.transcript[0]?.reactions).toEqual([
      {
        emoji: "👍",
        participantIds: ["founder"],
        count: 1,
      },
    ])

    const unlikedSeed = toggleChatMessageReaction({
      seed: likedSeed,
      sidebarItemId: "general",
      messageId: "general-root",
      emoji: "👍",
      participantId: "founder",
    })
    const unlikedRuntime = buildChatRuntimeState("general", { seed: unlikedSeed })

    expect(unlikedRuntime.transcriptView.transcript[0]?.reactions).toEqual([])
  })

  it("edits messages in place and refreshes preview-linked surfaces", () => {
    const seed = createChatShellRuntimeSeed()
    const nextSeed = editChatMessage({
      seed,
      sidebarItemId: "general",
      messageId: "general-second",
      body: "Final release checklist is locked.",
      actorId: "founder",
    })

    const runtime = buildChatRuntimeState("general", { seed: nextSeed })

    expect(runtime.transcriptView.transcript[1]?.body).toBe("Final release checklist is locked.")
    expect(runtime.transcriptView.transcript[1]?.editedAt).toBeTruthy()
    expect(runtime.chat.activeConversation?.latestMessagePreview).toBe(
      "I can take the reliability thread.",
    )
    expect(runtime.chat.sidebar.inbox[0]?.preview).toBe("Final release checklist is locked.")
  })

  it("redacts thread replies and updates thread preview metadata", () => {
    const seed = createChatShellRuntimeSeed()
    const nextSeed = redactChatMessage({
      seed,
      sidebarItemId: "general",
      messageId: "general-thread-reply",
      actorId: "alpha",
    })

    const runtime = buildChatRuntimeState("general", { seed: nextSeed })

    expect(runtime.transcriptView.threadDrawer.messages[0]?.body).toBe("[message redacted]")
    expect(runtime.transcriptView.threadDrawer.messages[0]?.redactedAt).toBeTruthy()
    expect(runtime.transcriptView.transcript[0]?.threadPreview).toBe("[message redacted]")
  })

  it("allows room managers to redact other participant messages", () => {
    const seed = createChatShellRuntimeSeed()
    const nextSeed = redactChatMessage({
      seed,
      sidebarItemId: "general",
      messageId: "general-thread-reply",
      actorId: "founder",
    })

    const runtime = buildChatRuntimeState("general", { seed: nextSeed })

    expect(runtime.transcriptView.threadDrawer.messages[0]?.body).toBe("[message redacted]")
    expect(runtime.transcriptView.threadDrawer.messages[0]?.redactedById).toBe("founder")
  })

  it("toggles posting policy and appends a system event to the transcript", () => {
    const seed = createChatShellRuntimeSeed()
    const nextSeed = toggleChatConversationPostingPolicy({
      seed,
      sidebarItemId: "general",
    })
    const runtime = buildChatRuntimeState("general", { seed: nextSeed })

    expect(runtime.chat.activeConversation?.postingPolicy).toBe("restricted")
    expect(runtime.transcriptView.composer.enabled).toBe(true)
    expect(runtime.transcriptView.composer.disabledReason).toBeNull()
    expect(runtime.transcriptView.transcript.at(-1)?.messageKind).toBe("system-event")
    expect(runtime.transcriptView.transcript.at(-1)?.body).toBe(
      "Room posting policy changed to restricted.",
    )
  })

  it("keeps restricted room posting disabled for joined non-managers", () => {
    const seed = createChatShellRuntimeSeed({ actorId: "alpha" })
    const restrictedSeed = toggleChatConversationPostingPolicy({
      seed,
      sidebarItemId: "general",
    })
    const runtime = buildChatRuntimeState("general", { seed: restrictedSeed })

    expect(runtime.chat.activeConversation?.postingPolicy).toBe("restricted")
    expect(runtime.transcriptView.composer.enabled).toBe(false)
    expect(runtime.transcriptView.composer.disabledReason).toBe("Posting is restricted")
  })

  it("archives conversations and disables posting through transcript state", () => {
    const seed = createChatShellRuntimeSeed()
    const nextSeed = archiveChatConversation({
      seed,
      sidebarItemId: "general",
    })
    const runtime = buildChatRuntimeState("general", { seed: nextSeed })

    expect(runtime.chat.activeConversation?.lifecycleState).toBe("archived")
    expect(runtime.transcriptView.composer.enabled).toBe(false)
    expect(runtime.transcriptView.composer.disabledReason).toBe(
      "Archived conversations cannot accept new messages",
    )
    expect(runtime.transcriptView.transcript.at(-1)?.body).toBe("Room archived.")
  })

  it("updates conversation title/topic and appends system events to the transcript", () => {
    const seed = createChatShellRuntimeSeed()
    const nextSeed = updateChatConversationDetails({
      seed,
      sidebarItemId: "general",
      title: "Launch Readiness",
      topic: "Final release owners",
    })
    const runtime = buildChatRuntimeState("general", { seed: nextSeed })

    expect(runtime.chat.activeConversation?.title).toBe("Launch Readiness")
    expect(runtime.chat.activeConversation?.topic).toBe("Final release owners")
    expect(runtime.transcriptView.transcript.at(-2)?.body).toBe(
      'Room renamed to "Launch Readiness".',
    )
    expect(runtime.transcriptView.transcript.at(-1)?.body).toBe(
      'Room topic set to "Final release owners".',
    )
  })

  it("updates room visibility through the same metadata surface", () => {
    const seed = createChatShellRuntimeSeed()
    const nextSeed = updateChatConversationDetails({
      seed,
      sidebarItemId: "general",
      visibility: "private",
    })
    const runtime = buildChatRuntimeState("general", { seed: nextSeed })

    expect(runtime.chat.activeConversation?.visibility).toBe("private")
    expect(nextSeed.itemsBySidebarItemId.general?.conversation.visibility).toBe("private")
  })

  it("clears room topic through the same metadata update surface", () => {
    const seed = createChatShellRuntimeSeed()
    const nextSeed = updateChatConversationDetails({
      seed,
      sidebarItemId: "general",
      topic: "",
    })
    const runtime = buildChatRuntimeState("general", { seed: nextSeed })

    expect(runtime.chat.activeConversation?.topic).toBeNull()
    expect(runtime.transcriptView.transcript.at(-1)?.body).toBe("Room topic cleared.")
  })

  it("searches messages and opens thread hits into the right conversation focus", () => {
    const seed = createChatShellRuntimeSeed()
    const results = searchChatMessages(seed, "reliability")

    expect(results[0]).toMatchObject({
      resultKind: "message",
      sidebarItemId: "general",
      conversationId: "general",
      messageId: "general-thread-reply",
      threadId: "general-root",
    })
    const firstResult = results[0]
    if (!firstResult) {
      throw new Error("Expected at least one search result")
    }

    const nextSeed = openChatSearchResult(seed, firstResult)
    const runtime = buildChatRuntimeState("general", {
      seed: nextSeed,
      threadDrawerOpenOverrides: { general: true },
    })

    expect(runtime.transcriptView.focusMessageId).toBe("general-thread-reply")
    expect(runtime.transcriptView.threadDrawer.open).toBe(true)
    expect(runtime.transcriptView.threadDrawer.rootMessage?.messageId).toBe("general-root")
  })

  it("searches viewer rooms through their viewer-recent entry when no joined room exists", () => {
    const seed = createChatShellRuntimeSeed()
    const results = searchChatMessages(seed, "quiet")

    expect(results[0]).toMatchObject({
      resultKind: "message",
      sidebarItemId: "viewer:finance-private",
      conversationId: "finance-private",
      openMode: "viewer",
      preview: "quiet viewer room",
    })
  })

  it("searches room metadata when title or topic matches without requiring a message hit", () => {
    const seed = createChatShellRuntimeSeed()
    const results = searchChatMessages(seed, "finance-private")

    expect(results[0]).toMatchObject({
      resultKind: "conversation",
      sidebarItemId: "viewer:finance-private",
      conversationId: "finance-private",
      messageId: null,
      threadId: null,
      preview: "Quarterly budget review",
    })
  })

  it("preserves the active search selection when results re-sort but the same hit remains", () => {
    const originalResults = [
      {
        resultKind: "message" as const,
        sidebarItemId: "general",
        conversationId: "general",
        conversationTitle: "general",
        messageId: "general-second",
        threadId: null,
        openMode: "joined" as const,
        preview: "General update",
        createdAt: "2026-04-10T09:00:00.000Z",
      },
      {
        resultKind: "conversation" as const,
        sidebarItemId: "ops",
        conversationId: "ops",
        conversationTitle: "ops",
        messageId: null,
        threadId: null,
        openMode: "joined" as const,
        preview: "Ops room",
        createdAt: "2026-04-10T08:00:00.000Z",
      },
    ]
    const activeKey = chatSearchResultKey(originalResults[1])

    const resortedResults = [originalResults[1], originalResults[0]]
    expect(resolveChatSearchSelection(resortedResults, activeKey)).toEqual({
      activeKey,
      activeIndex: 0,
    })
  })

  it("promotes viewer mode into joined mode when the local participant joins", () => {
    const seed = createChatShellRuntimeSeed()
    const viewerConversation = makeConversationRecord({
      conversationId: "viewer-room",
      title: "viewer-room",
      visibility: "private",
      participantIds: ["alpha"],
    })
    const viewerProjection = {
      conversationMessages: [
        makeProjectedMessage({
          messageId: "viewer-room-root",
          conversationId: "viewer-room",
          author: { kind: "participant", id: "alpha" },
          body: "Viewer-only room",
        }),
      ],
      mainTranscript: [
        makeProjectedMessage({
          messageId: "viewer-room-root",
          conversationId: "viewer-room",
          author: { kind: "participant", id: "alpha" },
          body: "Viewer-only room",
        }),
      ],
      activeThreadRoot: null,
      activeThreadMessages: [],
    }
    const viewerSeed = {
      ...seed,
      baseChat: {
        ...seed.baseChat,
        activeConversationId: "viewer-room",
        activeConversation: {
          conversationId: "viewer-room",
          kind: "channel" as const,
          slug: "viewer-room",
          title: "viewer-room",
          topic: null,
          visibility: "private" as const,
          postingPolicy: "open" as const,
          lifecycleState: "active" as const,
          section: "channels" as const,
          dmGroup: null,
          participantIds: ["alpha"],
          predecessorConversationId: null,
          lineageRootConversationId: "viewer-room",
          historyMode: "native" as const,
          unreadCount: 0,
          mentionCount: 0,
          latestActivityAt: "2026-04-06T10:00:00.000Z",
          latestMessagePreview: "Viewer-only room",
          messageCount: 1,
        },
        sidebar: {
          ...seed.baseChat.sidebar,
          channels: [
            ...seed.baseChat.sidebar.channels,
            {
              conversationId: "viewer-room",
              kind: "channel" as const,
              slug: "viewer-room",
              title: "viewer-room",
              topic: null,
              visibility: "private" as const,
              postingPolicy: "open" as const,
              lifecycleState: "active" as const,
              section: "channels" as const,
              dmGroup: null,
              participantIds: ["alpha"],
              predecessorConversationId: null,
              lineageRootConversationId: "viewer-room",
              historyMode: "native" as const,
              unreadCount: 0,
              mentionCount: 0,
              latestActivityAt: "2026-04-06T10:00:00.000Z",
              latestMessagePreview: "Viewer-only room",
              messageCount: 1,
            },
          ],
        },
      },
      itemsBySidebarItemId: {
        ...seed.itemsBySidebarItemId,
        "viewer-room": {
          conversation: viewerConversation,
          projection: viewerProjection,
          openIntent: openViewerRecentConversation({
            conversationId: "viewer-room",
            title: "viewer-room",
            kind: "channel",
            observedAt: "2026-04-06T10:01:00.000Z",
            latestActivityAt: "2026-04-06T10:00:00.000Z",
            latestMessagePreview: "Viewer-only room",
          }),
          canPostMessage: false,
          followedThreadIds: [],
        },
      },
    }

    const joinedSeed = joinChatConversation(viewerSeed, "viewer-room", "founder")
    const runtime = buildChatRuntimeState("viewer-room", { seed: joinedSeed })

    expect(runtime.transcriptView.openMode).toBe("joined")
    expect(runtime.transcriptView.composer.enabled).toBe(true)
    expect(runtime.chat.activeConversation?.participantIds).toContain("founder")
    expect(runtime.transcriptView.transcript.at(-1)?.body).toBe("Founder joined the room.")
  })

  it("demotes joined channels into viewer recents when the local participant leaves", () => {
    const seed = createChatShellRuntimeSeed()
    const next = leaveChatConversation(seed, "general", "founder")
    const runtime = buildChatRuntimeState(next.nextSidebarItemId, { seed: next.seed })

    expect(next.nextSidebarItemId).toBe("viewer:general")
    expect(runtime.transcriptView.openMode).toBe("viewer")
    expect(runtime.transcriptView.composer.enabled).toBe(false)
    expect(
      runtime.chat.sidebar.channels.some(
        (conversation) => conversation.conversationId === "general",
      ),
    ).toBe(false)
    expect(
      runtime.chat.sidebar.viewerRecents.some(
        (conversation) => conversation.conversationId === "general",
      ),
    ).toBe(true)
    expect(runtime.transcriptView.transcript.at(-1)?.body).toBe("Founder left the room.")
  })

  it("removes participants from joined rooms and appends a system event", () => {
    const seed = createChatShellRuntimeSeed()
    const joinedSeed = joinChatConversation(seed, "viewer:finance-private", "founder")
    const nextSeed = removeChatConversationParticipant({
      seed: joinedSeed,
      sidebarItemId: "finance-private",
      participantId: "alpha",
    })
    const runtime = buildChatRuntimeState("finance-private", { seed: nextSeed })

    expect(runtime.chat.activeConversation?.participantIds).toEqual(["founder"])
    expect(runtime.transcriptView.transcript.at(-1)?.body).toBe("Removed Alpha from the room.")
  })

  it("normalizes group direct conversations when a participant is removed", () => {
    const seed = createChatShellRuntimeSeed()
    const created = createChatDirectConversation({
      seed,
      creatorId: "founder",
      participantIds: ["alpha", "beta"],
    })
    const nextSeed = removeChatConversationParticipant({
      seed: created.seed,
      sidebarItemId: created.sidebarItemId,
      participantId: "beta",
    })
    const runtime = buildChatRuntimeState(created.sidebarItemId, { seed: nextSeed })

    expect(runtime.chat.activeConversation).toMatchObject({
      kind: "dm",
      title: "Alpha",
      participantIds: ["founder", "alpha"],
      dmGroup: "with-viewer",
    })
  })
})

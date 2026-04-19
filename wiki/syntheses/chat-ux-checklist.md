# Chat UX Checklist

## Goal

Lock the standalone Chat client against layout drift, disappearing state, ambiguous feedback, and
surface-level inconsistency. This checklist is the running audit contract for shell chrome, sidebar,
mobile navigation, transcript, thread, composer, search, desktop behavior, and accessibility.

## 1. Shell Chrome

1. [x] Desktop drag region exists outside content chrome.
2. [x] Global header does not own drag behavior.
3. [x] Search field keeps a stable keyboard shortcut affordance.
4. [x] Inbox pill keeps a stable width at zero state.
5. [x] Actor pill stays visible without causing header reflow.
6. [x] Header layout wraps instead of overlapping at narrow widths.
7. [x] Search control uses fluid width rather than a rigid center column.
8. [x] Chrome buttons stay aligned to the same control height scale.
9. [ ] Header action priority should degrade more intelligently below tablet widths.
10. [ ] Shell chrome should expose a dedicated low-noise offline/loading state.

## 2. Sidebar Information Architecture

11. [x] Inbox section persists after resolution instead of disappearing.
12. [x] Resolved inbox rows degrade into a muted `Seen` state.
13. [x] Followed Threads section stays visible even when empty.
14. [x] Viewer Recents section stays visible even when empty.
15. [x] Empty transient sections show helper copy instead of collapsing.
16. [x] Active row styling is stronger than background-only contrast.
17. [x] Sidebar row details no longer jitter between active and inactive states.
18. [x] Sidebar create panel is overlay-based, not inline-expanding.
19. [x] Sidebar create panel closes on `Escape` and outside click.
20. [ ] Sidebar section ordering should become user-configurable only after persistence rules are defined.

## 3. Sidebar Row Construction

21. [x] Sidebar rows keep list semantics instead of card semantics.
22. [x] Badge placement stays in the trailing meta region.
23. [x] Muted rows remain readable while clearly secondary.
24. [x] Detail copy can span two lines without clipping the row.
25. [x] Empty-state rows reuse the same leading/content rhythm as real rows.
26. [x] Section labels keep a stable uppercase metadata treatment.
27. [x] Count badges use the same size and radius scale across sections.
28. [ ] Sidebar row hover and keyboard focus states should be unified.
29. [ ] Drag-and-drop reorder affordances should not exist until actual reorder behavior lands.
30. [ ] Section collapse affordances should only be added if they persist cleanly across sessions.

## 4. Mobile Navigation

31. [x] Mobile create panel is overlay-based.
32. [x] Actor switching uses human-readable names.
33. [x] Horizontal strips expose snap and overflow rhythm clearly.
34. [x] Active mobile pills have stronger emphasis without changing row height.
35. [x] Mobile room pills now include preview detail instead of title-only chips.
36. [x] Mobile room pills use stable widths so badge changes do not reflow the strip.
37. [x] Mobile empty sections keep a visible placeholder card.
38. [x] Resolved inbox entries keep a visible `Seen` state on mobile.
39. [ ] Mobile create flow should support chip removal by keyboard, not just pointer.
40. [ ] Mobile strips should reveal focused items more clearly under keyboard navigation.

## 5. Transcript Header

41. [x] Header title, icon, and room status badges share one consistent line.
42. [x] Room status hierarchy distinguishes visibility, read-only, archived, and posting policy.
43. [x] Roster toggle keeps stable width.
44. [x] Mark-read control stays visible regardless of unread count.
45. [x] Dense header actions wrap into grouped rows rather than overlapping.
46. [x] Details and roster panels open as overlays instead of pushing content downward.
47. [x] Header overlays close on `Escape`.
48. [x] Header overlays close on outside click.
49. [ ] Header actions should collapse into a compact overflow strategy on very narrow desktop widths.
50. [ ] Room topic editing should preserve unsaved draft across overlay close/reopen.

## 6. Transcript Timeline

51. [x] Timeline uses continuous list rhythm rather than stacked cards.
52. [x] Message actions no longer reserve vertical space below every row.
53. [x] Message actions float instead of moving layout.
54. [x] Edited and redacted states remain explicit inline metadata.
55. [x] Directed messages remain explicit through a `To …` pill.
56. [x] Empty transcript state has dedicated copy instead of blank space.
57. [x] `Today` divider disappears when there are no messages.
58. [x] Reactions remain inline and compact under each message.
59. [ ] Long message bodies still need a tighter right-edge strategy under dense action clusters.
60. [ ] Hover-only affordances should degrade more intentionally on touch-first layouts.

## 7. Message Row Construction

61. [x] Compact thread rows no longer use a hard narrow body width.
62. [x] Default transcript rows keep a wider readable column than compact thread rows.
63. [x] Action bars stay within the message row edge instead of pushing neighboring content.
64. [x] Reaction picker closes immediately after selection.
65. [x] Reaction chips keep count alignment stable through tabular numerals.
66. [x] Edit mode reuses the same message shell instead of opening a disconnected form.
67. [x] Thread entry pill remains inline and compact.
68. [ ] Action labels should shorten on very narrow widths while preserving icon meaning.
69. [ ] Thread preview text inside reply pills should clamp more gracefully on long roots.
70. [ ] System messages need a stronger visual distinction from participant messages without breaking list continuity.

## 8. Thread Pane

71. [x] Thread header keeps follow, mark-read, and close controls from overlapping.
72. [x] Zero-state unread and mention badges remain visible for layout stability.
73. [x] Root message is visually separated from replies.
74. [x] Thread pane shows an explicit empty state when no thread is selected.
75. [x] Thread pane shows an explicit empty reply state when a root has no replies.
76. [x] Reply count appears in both header metadata and root context.
77. [x] Compact message rows in thread use available pane width.
78. [ ] Thread pane should preserve scroll anchor more carefully after reply insertion.
79. [ ] Follow state deserves a stronger passive cue when a thread is pinned but fully read.
80. [ ] Thread pane should expose a lightweight permalink affordance for the root message.

## 9. Composer

81. [x] Conversation composer and thread composer share the same shell pattern.
82. [x] Audience targeting does not collapse layout when toggled.
83. [x] Mention insertion is explicit through autocomplete and toolbar affordance.
84. [x] Emoji insertion affordance is explicit in both conversation and thread composers.
85. [x] Directed vs broadcast helper copy is explicit.
86. [x] Per-conversation and per-thread drafts persist through more transitions.
87. [x] Composer action button stays anchored even when toolbar wraps.
88. [ ] Audience tokens should compress into a denser summary when the room is large.
89. [x] Mention suggestions support arrow-key traversal and Enter commit.
90. [ ] Composer should surface a stronger archived/read-only explanation before the disabled input.

## 10. Create Conversation Flow

91. [x] Direct creation uses selected chips instead of comma-only raw text.
92. [x] Direct creation shows participant suggestions filtered against selected chips.
93. [x] Validation explains why create is disabled.
94. [x] Overlay closes on `Escape`.
95. [x] Overlay closes on outside click.
96. [x] Direct creation suggestion rows support arrow-key traversal and active selection.
97. [ ] Channel creation should show uniqueness/conflict feedback before submit.
98. [ ] Visibility choice should include a short consequence label, not only public/private text.
99. [ ] Direct creation should preserve partially selected chips if focus escapes and returns.
100. [ ] Create flow needs a dedicated mobile touch-target pass for chip removal and suggestion acceptance.

## Notes

- Checked items are locked by code and tests or by a stable shared pattern.
- Unchecked items are still part of the Chat polish frontier and should be revisited before the
  surface is considered finished.

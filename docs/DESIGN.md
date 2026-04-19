---
title: "Design Canon"
summary: "Stable taste, interaction, and presentation rules used as the design bar for autonomous UI work."
---
# Design Canon


This page is the stable design canon for autonomous project work in this repository.

Workers should use this page to judge whether a UI change feels aligned before moving a PR toward
final signoff.

## Implementation model

Build the UI in three layers.

1. shared primitives
   - base buttons, badges, inputs, textareas, avatars, separators, and sidebars
   - these should come from the adopted primitive system and be tuned through tokens and variants
2. composed patterns
   - repeated application patterns such as row layouts, meta pills, count badges, pane headers, and composers
   - these should be built by composing shared primitives, not by bypassing them with one-off markup
3. surface assembly
   - chat, work, observe, and future product surfaces
   - these should assemble composed patterns instead of inventing a new local visual language

When a defect repeats in more than one place, fix the primitive or composed pattern first.

## Taste summary

The product should feel calm, durable, businesslike, and high-signal.
It should not feel decorative, playful, or overloaded.

## Foundation-first rule

Before polishing a surface, stabilize the shared UI rules that the surface depends on.

- fix repeated alignment, sizing, radius, and meta-placement problems in shared primitives before applying one-off surface tweaks
- prefer stable row structures such as `left / content / right` over absolute overlays for badges, counts, and status
- use surface-specific overrides only after the primitive or reusable pattern is already believable
- treat recurring micro-defects across multiple components as a design-system problem first, not a local patch problem
- do not consider a surface polished if its clean appearance depends on ad hoc exceptions instead of consistent primitives

## Interaction principles

- prioritize clarity over cleverness
- prioritize continuity over novelty
- prefer familiar productivity patterns over custom metaphors
- make important state obvious without increasing noise

## Density and layout rules

- default to compact, readable density
- prefer continuous lists and dividers over unnecessary boxes
- keep section padding small unless spacing is doing real structural work
- create larger gaps between true sections, not between related rows

## Token families

The design system should stay small and predictable.

- radius
  - use a narrow radius scale for controls, rows, and panels
  - avoid introducing new corner styles for one surface
- spacing
  - use a compact spacing ladder and reuse it across headers, rows, and composers
  - repeated micro-adjustments should be promoted into shared spacing rules
- control sizing
  - use one shared control height scale for badges, icon buttons, fields, and pills
  - avoid one-off heights unless a component is truly exceptional
- typography
  - use one display family, one UI/body family, and one mono family
  - metadata should rely on quieter size and tone, not custom fonts per surface
- color
  - default to neutral surfaces and restrained emphasis
  - reserve accent and workflow color for real state, not decoration
- elevation
  - prefer borders and subtle contrast before stronger shadows
  - use stronger depth only for true shell boundaries, not routine list items

## Typography and hierarchy rules

- hierarchy should come from size, weight, and spacing before color
- metadata should be quieter than primary content
- labels should be short, stable, and easy to scan

## Color and emphasis rules

- default surfaces should stay restrained and mostly neutral
- use emphasis only where it changes understanding, priority, or state
- avoid spreading accent color across large surfaces when a compact signal is enough

## List vs card discipline

- navigation rows should read as lists, not independent cards
- transcripts and thread replies should read as continuous conversation, not dashboard tiles
- use cards only for true major containers or detail panels with a distinct semantic boundary

## Surface construction rules

- major containers may define the shell, but most interactive detail should live in rows, dividers, and restrained controls
- headers should communicate one dominant idea quickly; avoid stacking explanatory chrome when one line and one secondary detail will do
- composer bars, thread rows, and navigation items should feel like parts of one system, not like unrelated custom widgets
- if a UI issue repeats across header, list, thread, and composer, solve the shared pattern before the local surface

## Canonical composed patterns

These patterns should be stabilized before surface-specific polish.

- pane header
  - eyebrow, title, description, and actions should come from one repeated structure
  - use it for sidebars, transcript headers, thread panes, and future work/detail panes
- list row
  - default anatomy is `left / content / right`
  - counts and status belong in trailing meta, not in absolute overlays
- meta pill
  - pills carry compact state or counts and should stay visually restrained
  - prefer them for room counts, participants, mentions, or compact status
- composer shell
  - editor, toolbar, and primary action should read as one control family, not as separate widgets
- message row
  - transcript and thread should share the same author/meta/body rhythm unless a clear scope reason demands density changes

## Shaping principles for a good system

- prefer a primitive that teams will actually reuse over a theoretically perfect abstraction that they will bypass
- choose flat APIs for simple, repeated usage and composed patterns for complex or extensible usage
- design the system so common product needs fit naturally without local hacks
- treat the design system as a product that must remain easy to adopt, not as a static style guide

## What counts as visually unacceptable

- noisy emphasis
- excessive empty space that weakens scanning
- stacked boxes with no semantic reason
- inconsistent alignment or badge positioning
- a surface that reads more like a dashboard than a believable coordination tool

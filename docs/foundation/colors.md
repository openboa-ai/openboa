---
title: "Color Foundation"
summary: "Token-based palette system for openboa: Green (brand), Gray (text), Sand (surface)."
read_when:
  - You need a shared color contract for docs and UI
  - You want to avoid readability regressions while preserving brand tone
---

The openboa palette is organized by role:

- **Green**: brand and emphasis
- **Gray**: text and structure
- **Sand**: warm surfaces and background layers

<Warning>
Do not use green tokens (`#8CC92A`, `#478D24`) for long paragraph text on light backgrounds.
</Warning>

<Tip>
`#EDDBB7` and `#EEDCB6` are extremely close tones and should be treated as one sand family in practical UI usage.
</Tip>

## Green Palette

<CardGroup cols={3}>
  <Card title="green-50">
    <span className="boa-token-line"><span className="boa-swatch boa-swatch--green-50" aria-hidden="true" /><code>#EEF7DF</code></span>

    Ultra-light brand wash.
  </Card>
  <Card title="green-100">
    <span className="boa-token-line"><span className="boa-swatch boa-swatch--green-100" aria-hidden="true" /><code>#DFF1C4</code></span>

    Light background tint.
  </Card>
  <Card title="green-200">
    <span className="boa-token-line"><span className="boa-swatch boa-swatch--green-200" aria-hidden="true" /><code>#C9E69A</code></span>

    Soft highlight surface.
  </Card>
  <Card title="green-300">
    <span className="boa-token-line"><span className="boa-swatch boa-swatch--green-300" aria-hidden="true" /><code>#ACD968</code></span>

    Gentle emphasis color.
  </Card>
  <Card title="green-400">
    <span className="boa-token-line"><span className="boa-swatch boa-swatch--green-400" aria-hidden="true" /><code>#97CF45</code></span>

    Active and hover accent.
  </Card>
  <Card title="green-500 (primary)">
    <span className="boa-token-line"><span className="boa-swatch boa-swatch--green-500" aria-hidden="true" /><code>#8CC92A</code></span>

    Main brand accent color.
  </Card>
  <Card title="green-600">
    <span className="boa-token-line"><span className="boa-swatch boa-swatch--green-600" aria-hidden="true" /><code>#67A525</code></span>

    Strong accent for interactive controls.
  </Card>
  <Card title="green-700">
    <span className="boa-token-line"><span className="boa-swatch boa-swatch--green-700" aria-hidden="true" /><code>#478D24</code></span>

    Secondary accent for borders and underlines.
  </Card>
  <Card title="green-800">
    <span className="boa-token-line"><span className="boa-swatch boa-swatch--green-800" aria-hidden="true" /><code>#163525</code></span>

    Dark panel surface for dark mode layers.
  </Card>
  <Card title="green-900">
    <span className="boa-token-line"><span className="boa-swatch boa-swatch--green-900" aria-hidden="true" /><code>#050D0A</code></span>

    Near-black green background anchor (deepest green token).
  </Card>
</CardGroup>

## Gray Palette

<CardGroup cols={3}>
  <Card title="gray-50">
    <span className="boa-token-line"><span className="boa-swatch boa-swatch--gray-50" aria-hidden="true" /><code>#FEF6E2</code></span>

    Softest neutral tint.
  </Card>
  <Card title="gray-100">
    <span className="boa-token-line"><span className="boa-swatch boa-swatch--gray-100" aria-hidden="true" /><code>#EDE5D4</code></span>

    Very light neutral surface.
  </Card>
  <Card title="gray-200">
    <span className="boa-token-line"><span className="boa-swatch boa-swatch--gray-200" aria-hidden="true" /><code>#D7D1C8</code></span>

    Default border and neutral divider.
  </Card>
  <Card title="gray-300">
    <span className="boa-token-line"><span className="boa-swatch boa-swatch--gray-300" aria-hidden="true" /><code>#B8B3AA</code></span>

    Secondary divider and disabled text.
  </Card>
  <Card title="gray-400">
    <span className="boa-token-line"><span className="boa-swatch boa-swatch--gray-400" aria-hidden="true" /><code>#9AA09A</code></span>

    Muted UI labels.
  </Card>
  <Card title="gray-500">
    <span className="boa-token-line"><span className="boa-swatch boa-swatch--gray-500" aria-hidden="true" /><code>#768688</code></span>

    Metadata and helper text.
  </Card>
  <Card title="gray-600">
    <span className="boa-token-line"><span className="boa-swatch boa-swatch--gray-600" aria-hidden="true" /><code>#5E6C67</code></span>

    Strong helper text.
  </Card>
  <Card title="gray-700">
    <span className="boa-token-line"><span className="boa-swatch boa-swatch--gray-700" aria-hidden="true" /><code>#44504B</code></span>

    Secondary body text on light backgrounds.
  </Card>
  <Card title="gray-800">
    <span className="boa-token-line"><span className="boa-swatch boa-swatch--gray-800" aria-hidden="true" /><code>#2E3C38</code></span>

    Dark panel and chrome tone.
  </Card>
  <Card title="gray-900">
    <span className="boa-token-line"><span className="boa-swatch boa-swatch--gray-900" aria-hidden="true" /><code>#162D24</code></span>

    Primary body text color in light mode.
  </Card>
</CardGroup>

## Sand Palette

<CardGroup cols={3}>
  <Card title="sand-50">
    <span className="boa-token-line"><span className="boa-swatch boa-swatch--sand-50" aria-hidden="true" /><code>#FEF6E2</code></span>

    Main warm canvas.
  </Card>
  <Card title="sand-100">
    <span className="boa-token-line"><span className="boa-swatch boa-swatch--sand-100" aria-hidden="true" /><code>#F7ECCF</code></span>

    Light warm section background.
  </Card>
  <Card title="sand-200">
    <span className="boa-token-line"><span className="boa-swatch boa-swatch--sand-200" aria-hidden="true" /><code>#EEDCB6</code></span>

    Warm elevated surface.
  </Card>
  <Card title="sand-300">
    <span className="boa-token-line"><span className="boa-swatch boa-swatch--sand-300" aria-hidden="true" /><code>#EDDBB7</code></span>

    Alternate warm panel tone.
  </Card>
  <Card title="sand-400">
    <span className="boa-token-line"><span className="boa-swatch boa-swatch--sand-400" aria-hidden="true" /><code>#E3CB9E</code></span>

    Elevated warm panel.
  </Card>
  <Card title="sand-500">
    <span className="boa-token-line"><span className="boa-swatch boa-swatch--sand-500" aria-hidden="true" /><code>#D8BE89</code></span>

    Warm UI accent background.
  </Card>
  <Card title="sand-600">
    <span className="boa-token-line"><span className="boa-swatch boa-swatch--sand-600" aria-hidden="true" /><code>#CDAE7B</code></span>

    Strong warm divider.
  </Card>
  <Card title="sand-700">
    <span className="boa-token-line"><span className="boa-swatch boa-swatch--sand-700" aria-hidden="true" /><code>#BDAA75</code></span>

    Decorative accent line.
  </Card>
  <Card title="sand-800">
    <span className="boa-token-line"><span className="boa-swatch boa-swatch--sand-800" aria-hidden="true" /><code>#9D8E61</code></span>

    Deep warm accent.
  </Card>
  <Card title="sand-900">
    <span className="boa-token-line"><span className="boa-swatch boa-swatch--sand-900" aria-hidden="true" /><code>#7A6E4D</code></span>

    Dark warm anchor.
  </Card>
</CardGroup>

## Semantic Mapping

- `--boa-bg` → `sand-50` (light), `green-900` (dark)
- `--boa-surface` → near-white elevated panel
- `--boa-panel` → warm sand panel (light), deep green panel (dark)
- `--boa-text` → `gray-900` (light), `sand-50` (dark)
- `--boa-border` → `gray-200` (light), dark neutral border in dark mode
- `--boa-accent` → `green-500` (light), `green-600` (dark)
- `--boa-accent-strong` → `green-700` (light), `green-500` (dark)

import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import { describe, expect, it } from "vitest"

const rootRequire = createRequire(import.meta.url)
const electronRequire = createRequire(rootRequire.resolve("electron-builder"))
const builderRequire = createRequire(electronRequire.resolve("app-builder-lib"))
const { FileMatcher } = builderRequire("./fileMatcher.js")
const universalRequire = createRequire(builderRequire.resolve("@electron/universal"))
const universalMinimatch = universalRequire("minimatch").minimatch
const asarRequire = createRequire(builderRequire.resolve("@electron/asar"))

const cli2Require = createRequire(rootRequire.resolve("markdownlint-cli2"))
const linterRequire = createRequire(cli2Require.resolve("markdownlint"))
const { micromark } = await import(pathToFileURL(linterRequire.resolve("micromark")).href)
const { math, mathHtml } = await import(
  pathToFileURL(linterRequire.resolve("micromark-extension-math")).href
)
let docsRequire = rootRequire
for (const name of [
  "mintlify/package.json",
  "@mintlify/cli",
  "@mintlify/common",
  "@mintlify/validation",
]) {
  docsRequire = createRequire(docsRequire.resolve(name))
}
const { default: rehypeKatex } = await import(
  pathToFileURL(docsRequire.resolve("rehype-katex")).href
)
const { toHtml } = await import(pathToFileURL(docsRequire.resolve("hast-util-to-html")).href)
const { VFile } = await import(pathToFileURL(docsRequire.resolve("vfile")).href)

const fileStat = { isDirectory: () => false }
const directoryStat = { isDirectory: () => true }

describe("actual desktop minimatch consumers", () => {
  it("retains inclusion, exclusion, dotfiles, braces and partial directory matching", () => {
    const matcher = new FileMatcher("/app", "/out", (value: string) => value, [
      "**/*.{js,json}",
      "!**/*.test.js",
    ])
    const filter = matcher.createFilter()
    expect(filter("/app/src/main.js", fileStat)).toBe(true)
    expect(filter("/app/.config/settings.json", fileStat)).toBe(true)
    expect(filter("/app/src/main.test.js", fileStat)).toBe(false)
    expect(filter("/app/src/readme.md", fileStat)).toBe(false)
    expect(filter("/app/src", directoryStat)).toBe(true)
    expect(filter("/app/node_modules", directoryStat)).toBe(false)
  })

  it("retains extglobs and the consumer's backslash pattern normalization", () => {
    const matcher = new FileMatcher("/app", "/out", (value: string) => value, [
      "src\\**\\@(main|preload).js",
    ])
    const filter = matcher.createFilter()
    expect(filter("/app/src/main.js", fileStat)).toBe(true)
    expect(filter("/app/src/nested/preload.js", fileStat)).toBe(true)
    expect(filter("/app/src/other.js", fileStat)).toBe(false)
  })

  it("retains named matchBase calls used for universal binaries and plists", () => {
    expect(
      universalMinimatch("Contents/Resources/native/addon.node", "*.node", { matchBase: true }),
    ).toBe(true)
    expect(universalMinimatch("Contents/Frameworks/helper", "helper", { matchBase: true })).toBe(
      true,
    )
    expect(universalMinimatch("Contents/Info.plist", "Info.plist", { matchBase: true })).toBe(true)
    expect(universalMinimatch("Contents/Info.plist", "Other.plist", { matchBase: true })).toBe(
      false,
    )
  })

  it("keeps legacy ASAR's callable minimatch API", () => {
    const minimatch = asarRequire("minimatch")
    expect(typeof minimatch).toBe("function")
    expect(minimatch("src/main.js", "**/*.js")).toBe(true)
  })

  it("bounds repeated globparts preprocessing in the actual patched consumer", () => {
    const entry = builderRequire.resolve("minimatch")
    const source = `const {Minimatch}=require(${JSON.stringify(entry)});const pattern=Array.from({length:14},(_,i)=>"**/../a"+i+"/b"+i+"/").join("")+"fixture.txt";new Minimatch(pattern,{optimizationLevel:2}).match("fixture.txt");console.log("completed");`
    const result = spawnSync(process.execPath, ["-e", source], {
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 65536,
    })
    expect(result.error).toBeUndefined()
    expect(result.status, result.stdout + result.stderr).toBe(0)
    expect(result.stdout).toContain("completed")
  })
})

function renderMicromark(
  expression: string,
  display: boolean,
  options: Record<string, unknown> = {},
) {
  const markdown = display ? `$$\n${expression}\n$$` : `$${expression}$`
  return micromark(markdown, {
    extensions: [math()],
    htmlExtensions: [mathHtml(options)],
  }) as string
}

function renderRehype(expression: string, display: boolean, options: Record<string, unknown> = {}) {
  const tree = {
    type: "root",
    children: [
      {
        type: "element",
        tagName: "span",
        properties: { className: [display ? "math-display" : "math-inline"] },
        children: [{ type: "text", value: expression }],
      },
    ],
  }
  rehypeKatex(options)(tree, new VFile())
  return toHtml(tree) as string
}

describe.each([
  ["micromark-extension-math", renderMicromark],
  ["rehype-katex", renderRehype],
] as const)("actual %s KaTeX consumer", (name, render) => {
  it.each([false, true])("renders normal math with display=%s", (display) => {
    const html = render("x^2 + 1", display)
    expect(html).toContain('class="katex')
    expect(html.includes("katex-display")).toBe(display)
  })

  it("retains explicit trusted links and denies them by default", () => {
    const expression = "\\href{https://example.invalid/}{link}"
    expect(render(expression, false)).not.toContain('href="https://example.invalid/')
    expect(render(expression, false, { trust: true })).toContain('href="https://example.invalid/')
  })

  it("retains explicit trusted images and denies external resources by default", () => {
    const expression = "\\includegraphics{https://example.invalid/image.png}"
    expect(render(expression, false)).not.toContain('src="https://example.invalid/')
    expect(render(expression, false, { trust: true })).toContain('src="https://example.invalid/')
  })

  it("does not inherit trust from an already polluted prototype", () => {
    const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "trust")
    Object.defineProperty(Object.prototype, "trust", {
      value: true,
      writable: true,
      configurable: true,
    })
    try {
      const html = render("\\href{javascript:alert(1)}{click}", false)
      expect(html).not.toContain('href="javascript:')
      expect(render("\\includegraphics{https://example.invalid/image.png}", false)).not.toContain(
        'src="https://example.invalid/',
      )
    } finally {
      if (descriptor) Object.defineProperty(Object.prototype, "trust", descriptor)
      else Reflect.deleteProperty(Object.prototype, "trust")
    }
  })

  it("does not accept inherited renderer options", () => {
    const options = Object.create({ trust: true }) as Record<string, unknown>
    expect(render("\\href{javascript:alert(1)}{click}", false, options)).not.toContain(
      'href="javascript:',
    )
    expect(
      render("\\includegraphics{https://example.invalid/image.png}", false, options),
    ).not.toContain('src="https://example.invalid/')
  })

  it("retains explicitly configured macro definitions", () => {
    expect(render("\\ownmacro", false, { macros: { "\\ownmacro": "x" } })).toContain("<mi>x</mi>")
  })

  it("does not accept inherited macro namespace definitions", () => {
    const options = { macros: Object.create({ "\\inheritedmacro": "x" }) }
    if (name === "micromark-extension-math") {
      expect(() => render("\\inheritedmacro", false, options)).toThrow(/Undefined control sequence/)
    } else {
      const html = render("\\inheritedmacro", false, options)
      expect(html).toContain("\\inheritedmacro")
      expect(html).not.toContain("<mi>x</mi>")
    }
  })

  it("does not inherit processor metadata from a polluted prototype", () => {
    const expected = render("x^2 + 1", false)
    const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "processor")
    Object.defineProperty(Object.prototype, "processor", {
      value: () => true,
      writable: true,
      configurable: true,
    })
    try {
      expect(render("x^2 + 1", false)).toBe(expected)
    } finally {
      if (descriptor) Object.defineProperty(Object.prototype, "processor", descriptor)
      else Reflect.deleteProperty(Object.prototype, "processor")
    }
  })

  it("retains malformed math rendering without enabling trust", () => {
    if (name === "micromark-extension-math") {
      expect(() => render("\\unknowncommand", false)).toThrow(/Undefined control sequence/)
    } else {
      expect(render("\\unknowncommand", false)).toMatch(/katex-error|unknowncommand/)
    }
  })
})

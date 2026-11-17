import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { pathToFileURL } from "node:url"
import ts from "typescript"
import { afterAll, describe, expect, it, vi } from "vitest"

const rootRequire = createRequire(import.meta.url)
const mintlifyRequire = createRequire(rootRequire.resolve("mintlify/package.json"))
const cliEntry = mintlifyRequire.resolve("@mintlify/cli")
const cliRequire = createRequire(cliEntry)
const cliRoot = join(dirname(cliEntry), "..")
const zodRoot = dirname(cliRequire.resolve("zod/package.json"))
const legacy = cliRequire("zod/v3")
const current = cliRequire("zod")
const temporaryDirectories: string[] = []
const digest = (value: string) => createHash("sha256").update(value).digest("hex")

let validationRequire = cliRequire
for (const name of ["@mintlify/common", "@mintlify/validation"]) {
  validationRequire = createRequire(validationRequire.resolve(name))
}
const validationRoot = join(dirname(validationRequire.resolve("./index.js")), "..")
let browsersRequire = cliRequire
for (const name of ["@mintlify/link-rot", "@mintlify/scraping", "puppeteer", "puppeteer-core"]) {
  browsersRequire = createRequire(browsersRequire.resolve(name))
}
const bidiRoot = join(dirname(browsersRequire.resolve("chromium-bidi/package.json")), "lib")
const bidiEntry = join(bidiRoot, "cjs/bidiMapper/BidiMapper.js")
const bidiRequire = createRequire(bidiEntry)

async function compileLegacySource() {
  const sourceRoot = join(zodRoot, "src/v3")
  const directory = await mkdtemp(join(tmpdir(), "openboa-zod-source-"))
  temporaryDirectories.push(directory)
  await writeFile(join(directory, "package.json"), '{"type":"module"}\n')
  async function compileTree(source: string) {
    for (const entry of await readdir(source, { withFileTypes: true })) {
      const file = join(source, entry.name)
      if (entry.isDirectory()) {
        if (!/^(?:tests|__tests__|benchmarks)$/.test(entry.name)) await compileTree(file)
      } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
        const text = await readFile(file, "utf8")
        if (file === join(sourceRoot, "types.ts")) {
          expect(digest(text)).toBe(
            "0131f9bb6acc2e3930db35a7e7af60b67be1257437414b8292ae570604f77a8e",
          )
        }
        const output = join(directory, relative(sourceRoot, file).replace(/\.ts$/, ".js"))
        await mkdir(dirname(output), { recursive: true })
        await writeFile(
          output,
          ts.transpileModule(text, {
            compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
          }).outputText,
        )
      }
    }
  }
  await compileTree(sourceRoot)
  return import(pathToFileURL(join(directory, "index.js")).href)
}

async function converterLegacyFactory() {
  const source = await readFile(join(cliRoot, "bin/vendor/converter.js"), "utf8")
  expect(digest(source)).toBe("5250e3290d04bf82b65043556f2c297fb6f596fdda87811510a47323af9e7c46")
  const helpersEnd = source.indexOf("// ../editor/")
  const start = source.indexOf("// ../../node_modules/zod/v3/external.js")
  const end = source.indexOf("// ../editor/", start)
  expect(helpersEnd).toBeGreaterThan(0)
  expect(start).toBeGreaterThan(helpersEnd)
  expect(end).toBeGreaterThan(start)
  // Execute the unchanged shipped factory, identified by the whole-file digest.
  return new Function(
    `${source.slice(0, helpersEnd)}\n${source.slice(start, end)}\nreturn external_exports;`,
  )()
}

async function bidiLegacyFactory() {
  const source = await readFile(join(bidiRoot, "iife/mapperTab.js"), "utf8")
  expect(digest(source)).toBe("5cb72c6a14c42ac40f956b69fb5c37c6ab1d310df1b2181fcdec4597063f5d04")
  const start = source.indexOf("    var util;")
  const end = source.indexOf("\n    var Script;", start)
  expect(start).toBeGreaterThan(0)
  expect(end).toBeGreaterThan(start)
  return new Function(`${source.slice(start, end)}\nreturn {z, Script:Script$1};`)()
}

const sourceModule = await compileLegacySource()
const esmModule = await import(pathToFileURL(join(zodRoot, "v3/index.js")).href)
const converterLegacy = await converterLegacyFactory()
const bidiLegacy = await bidiLegacyFactory()
const representations = [
  ["CJS v3", legacy],
  ["ESM v3", esmModule.z],
  ["compiled shipped TypeScript v3", sourceModule.z],
  ["CLI converter's shipped v3", converterLegacy],
  ["BiDi IIFE's shipped v3", bidiLegacy.z],
] as const

afterAll(async () => {
  vi.restoreAllMocks()
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true })))
})

describe.each(representations)("bounded %s collections", (_name, z: typeof legacy) => {
  it.each(["max", "length"])(
    "aborts oversized array %s before elements and refinements",
    (bound) => {
      let elements = 0
      let refinements = 0
      const schema = z
        .array(
          z.number().transform((value: number) => {
            elements++
            return value + 1
          }),
        )
        [bound](2)
        .superRefine(() => {
          refinements++
        })
      const result = schema.safeParse([1, 2, 3])
      expect(result.success).toBe(false)
      expect(result.error.issues[0]).toMatchObject({ code: "too_big", maximum: 2, type: "array" })
      expect(elements).toBe(0)
      expect(refinements).toBe(0)
      expect(schema.parse([1, 2])).toEqual([2, 3])
      expect(elements).toBe(2)
      expect(refinements).toBe(1)
    },
  )

  it("keeps nested issue paths, bound metadata and custom errors", () => {
    const array = z
      .array(z.number(), { errorMap: () => ({ message: "bounded collection" }) })
      .max(1)
    const result = z.object({ payload: array }).safeParse({ payload: [1, 2] })
    expect(result.error.issues[0]).toMatchObject({
      code: "too_big",
      path: ["payload"],
      maximum: 1,
      inclusive: true,
      exact: false,
      message: "bounded collection",
    })
  })

  it("retains too-small and unconstrained parsed-value behavior", () => {
    let elements = 0
    const child = z.number().transform((value: number) => {
      elements++
      return value + 1
    })
    const result = z.array(child).length(2).safeParse([1])
    expect(result.error.issues[0].code).toBe("too_small")
    expect(elements).toBe(1)
    expect(z.array(child).parse([1, 2, 3])).toEqual([2, 3, 4])
    expect(elements).toBe(4)
  })

  it.each(["max", "size"])("aborts oversized set %s before enumeration", (bound) => {
    let enumerations = 0
    let refinements = 0
    const input = new Set([1, 2, 3])
    Object.defineProperty(input, "values", {
      value: () => {
        enumerations++
        throw new Error("tail enumeration")
      },
    })
    const schema = z
      .set(z.number())
      [bound](2)
      .superRefine(() => {
        refinements++
      })
    const result = schema.safeParse(input)
    expect(result.error.issues[0]).toMatchObject({ code: "too_big", maximum: 2, type: "set" })
    expect(enumerations).toBe(0)
    expect(refinements).toBe(0)
    expect([...schema.parse(new Set([1, 2]))]).toEqual([1, 2])
  })

  it("preserves async parsed results while aborting oversize before callbacks", async () => {
    let callbacks = 0
    const schema = z
      .array(
        z.string().transform(async (value: string) => {
          callbacks++
          return `${value}!`
        }),
      )
      .max(1)
    expect((await schema.safeParseAsync(["a", "b"])).success).toBe(false)
    expect(callbacks).toBe(0)
    expect(await schema.parseAsync(["a"])).toEqual(["a!"])
    expect(callbacks).toBe(1)
    expect(
      (
        await z
          .set(z.number())
          .size(1)
          .safeParseAsync(new Set([1, 2]))
      ).success,
    ).toBe(false)
  })

  it("bounds fixed tuple work and retains prefix error aggregation and rest tuples", async () => {
    let tailReads = 0
    const input = [-1, 5, 0]
    Object.defineProperty(input, 2, {
      get: () => {
        tailReads++
        throw new Error("tuple tail")
      },
    })
    const schema = z.tuple([z.number().min(0), z.string()])
    for (const result of [schema.safeParse(input), await schema.safeParseAsync(input)]) {
      expect(result.success).toBe(false)
      expect(result.error.issues.map((issue: { code: string }) => issue.code)).toEqual(
        expect.arrayContaining(["too_big", "too_small", "invalid_type"]),
      )
    }
    expect(tailReads).toBe(0)
    expect(schema.parse([1, "valid"])).toEqual([1, "valid"])
    expect(z.tuple([z.number()]).rest(z.string()).parse([1, "a", "b"])).toEqual([1, "a", "b"])
  })
})

describe("actual v4 root and legacy consumers", () => {
  it("retains legitimate v3 intersections and upstream hardened error representations", () => {
    const schema = legacy.intersection(
      legacy.object({ name: legacy.string(), count: legacy.number() }),
      legacy.object({ name: legacy.string(), enabled: legacy.boolean() }),
    )
    expect(schema.parse({ name: "fixture", count: 1, enabled: true })).toEqual({
      name: "fixture",
      count: 1,
      enabled: true,
    })
    const conflict = legacy
      .intersection(
        legacy.string().transform(() => ({ value: 1 })),
        legacy.string().transform(() => ({ value: 2 })),
      )
      .safeParse("fixture")
    expect(conflict.error.issues[0].code).toBe("invalid_intersection_types")
    const protoData = () => JSON.parse('{"__proto__":{"fixture":true},"name":"fixture"}')
    const sanitized = legacy
      .intersection(legacy.any().transform(protoData), legacy.any().transform(protoData))
      .parse(null)
    expect(sanitized).toEqual({ name: "fixture" })
    expect(Object.hasOwn(sanitized, "__proto__")).toBe(false)
    const error = new legacy.ZodError(
      ["__proto__", "constructor", "toString", "_errors"].map((key) => ({
        code: "custom",
        path: [key],
        message: "fixture issue",
      })),
    )
    const formatted = error.format()
    expect(Object.hasOwn(formatted, "__proto__")).toBe(true)
    expect(formatted.__proto__._errors).toEqual(["fixture issue"])
    expect(formatted.constructor._errors).toEqual(["fixture issue"])
    expect(formatted._errors).toEqual(["fixture issue"])
    const flattened = error.flatten()
    expect(Object.getPrototypeOf(flattened.fieldErrors)).toBe(null)
    expect(flattened.fieldErrors.__proto__).toEqual(["fixture issue"])
    expect(Object.getPrototypeOf({})).toBe(Object.prototype)
  })

  it("uses the actual generated parser's collection preflight before element access", () => {
    const oversizedArray = [1, 2]
    Object.defineProperty(oversizedArray, 0, {
      get: () => {
        throw new Error("compiled array element")
      },
    })
    const oversizedSet = new Set([1, 2])
    Object.defineProperty(oversizedSet, Symbol.iterator, {
      value: () => {
        throw new Error("compiled set iteration")
      },
    })
    const oversizedMap = new Map([
      ["a", 1],
      ["b", 2],
    ])
    Object.defineProperty(oversizedMap, Symbol.iterator, {
      value: () => {
        throw new Error("compiled map iteration")
      },
    })
    for (const [schema, oversized, valid] of [
      [current.array(current.number()).max(1), oversizedArray, [1]],
      [current.set(current.number()).max(1), oversizedSet, new Set([1])],
      [current.map(current.string(), current.number()).max(1), oversizedMap, new Map([["a", 1]])],
    ] as const) {
      const compiled = current.compile(schema, { strict: true })
      expect(compiled).not.toBe(schema)
      expect(compiled._zod.run).not.toBe(schema._zod.run)
      const generated = current.core.compileFn(schema, { debug: true })
      expect(generated.code.length).toBeGreaterThan(0)
      expect(generated(oversized)).toBe(current.core.INVALID)
      expect(generated(valid)).toEqual(valid)
      expect(compiled.safeParse(oversized).success).toBe(false)
      expect(compiled.parse(valid)).toEqual(valid)
    }
  })

  it.each([false, true])("retains root v4 bounds with jitless=%s", async (jitless) => {
    const previous = { ...current.config() }
    current.config({ jitless })
    try {
      let elements = 0
      const child = current.number().transform((value: number) => {
        elements++
        return value + 1
      })
      expect(current.array(child).max(1).safeParse([1, 2]).success).toBe(false)
      expect(
        current
          .set(child)
          .max(1)
          .safeParse(new Set([1, 2])).success,
      ).toBe(false)
      expect(
        current
          .map(current.string(), child)
          .max(1)
          .safeParse(
            new Map([
              ["a", 1],
              ["b", 2],
            ]),
          ).success,
      ).toBe(false)
      expect(elements).toBe(0)
      expect(await current.array(child).max(1).parseAsync([1])).toEqual([2])
    } finally {
      current.config(previous)
    }
  })

  it("retains real Mintlify footer schemas and rejects oversize before columns", async () => {
    for (const [file, valid] of [
      [
        "dist/mint-config/schemas/v1/footer.js",
        { links: [{ title: "Docs", links: [{ label: "Home", url: "/" }] }] },
      ],
      [
        "dist/mint-config/schemas/v2/properties/footer.js",
        { links: [{ header: "Docs", items: [{ label: "Home", href: "/" }] }] },
      ],
    ] as const) {
      const { footerSchema } = await import(pathToFileURL(join(validationRoot, file)).href)
      expect(footerSchema.safeParse(valid).success).toBe(true)
      const input = new Array(5)
      Object.defineProperty(input, 0, {
        get: () => {
          throw new Error("footer column must not be read")
        },
      })
      const result = footerSchema.safeParse({ links: input })
      expect(result.error.issues[0]).toMatchObject({ code: "too_big", path: ["links"], maximum: 4 })
    }
  })

  it("preserves the real JSON Schema converter's legacy API and options", () => {
    const { zodToJsonSchema } = validationRequire("zod-to-json-schema")
    const result = zodToJsonSchema(
      legacy.object({
        name: legacy.string(),
        tags: legacy.array(legacy.string()).max(2).optional(),
      }),
      { name: "Fixture", target: "jsonSchema7" },
    )
    expect(result.$ref).toBe("#/definitions/Fixture")
    expect(result.definitions.Fixture.properties.name.type).toBe("string")
    expect(result.definitions.Fixture.properties.tags.maxItems).toBe(2)
    expect(result.definitions.Fixture.required).toEqual(["name"])
    expect(result.definitions.Fixture.additionalProperties).toBe(false)
  })

  it("uses actual CLI v4 status parsing with a local fetch stub only", async () => {
    const { getCliSubdomains } = await import(pathToFileURL(join(cliRoot, "bin/status.js")).href)
    const fetch = vi.spyOn(globalThis, "fetch")
    try {
      for (const [body, expected] of [
        [
          {
            user: { email: "fixture@example.invalid" },
            org: { name: "Fixture" },
            subdomains: ["docs"],
          },
          ["docs"],
        ],
        [{ user: { email: "fixture@example.invalid" }, org: { name: "Fixture" } }, []],
        [{ user: { email: 7 }, org: { name: "Fixture" }, subdomains: ["docs"] }, []],
      ] as const) {
        fetch.mockImplementation(async () => new Response(JSON.stringify(body)))
        expect(await getCliSubdomains("fixture-token")).toEqual(expected)
      }
      expect(fetch).toHaveBeenCalledTimes(3)
    } finally {
      fetch.mockRestore()
    }
  })

  it("retains actual BiDi mapping pairs without visiting an oversized tuple tail", () => {
    const native = bidiRequire(join(bidiRoot, "cjs/protocol-parser/generated/webdriver-bidi.js"))
    for (const script of [native.Script, bidiLegacy.Script]) {
      for (const schema of [script.MappingLocalValueSchema, script.MappingRemoteValueSchema]) {
        expect(schema.safeParse([["key", { type: "string", value: "fixture" }]]).success).toBe(true)
        let reads = 0
        const pair = ["key", { type: "string", value: "fixture" }, null]
        Object.defineProperty(pair, 2, {
          get: () => {
            reads++
            throw new Error("BiDi pair tail")
          },
        })
        const result = schema.safeParse([pair])
        expect(result.success).toBe(false)
        expect(
          result.error.issues.some((issue: { code: string }) => issue.code === "too_big"),
        ).toBe(true)
        expect(reads).toBe(0)
      }
    }
  })
})

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { createServer } from "node:http"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { describe, expect, it, vi } from "vitest"

const rootRequire = createRequire(import.meta.url)
const playwrightRequire = createRequire(rootRequire.resolve("playwright/package.json"))
const bundlePath = playwrightRequire.resolve("playwright-core/lib/utilsBundle")
const bundle = playwrightRequire(bundlePath)
const z = bundle.z
const source = readFileSync(bundlePath, "utf8")
expect(createHash("sha256").update(source).digest("hex")).toBe(
  "9cce6edfb1b8ac0d075ebc12a9412fc351d0296df1b597824018abdcc309f9bd",
)
const startMarker = "// node_modules/zod/v3/helpers/util.js"
const endMarker = "// node_modules/@modelcontextprotocol/sdk/dist/esm/server/zod-compat.js"
expect(source.split(startMarker)).toHaveLength(2)
expect(source.split(endMarker)).toHaveLength(2)
const legacy = new Function(
  `${source.slice(source.indexOf(startMarker), source.indexOf(endMarker))}
return {array:arrayType,number:numberType,string:stringType,set:setType,tuple:tupleType,object:objectType};`,
)()

describe("actual Playwright completion consumer", () => {
  it("preserves normal completion and rejects max(100) before reading values", async () => {
    let values = ["fixture"]
    let reads = 0
    let closed = false
    const methods: string[] = []
    const client = new bundle.Client({ name: "fixture", version: "0.0.0" }, { capabilities: {} })
    const transport = {
      onclose: undefined as undefined | (() => void),
      onmessage: undefined as undefined | ((message: unknown) => void),
      async start() {},
      async close() {
        closed = true
        this.onclose?.()
      },
      async send(message: { method: string; id: number; params: { protocolVersion: string } }) {
        if (message.method === "initialize") {
          queueMicrotask(() =>
            this.onmessage?.({
              jsonrpc: "2.0",
              id: message.id,
              result: {
                protocolVersion: message.params.protocolVersion,
                capabilities: { completions: {} },
                serverInfo: { name: "fixture", version: "0.0.0" },
              },
            }),
          )
        } else if (message.method === "completion/complete") {
          methods.push(message.method)
          queueMicrotask(() =>
            this.onmessage?.({
              jsonrpc: "2.0",
              id: message.id,
              result: { completion: { values, total: values.length, hasMore: false } },
            }),
          )
        }
      },
    }
    try {
      await client.connect(transport, { timeout: 1000 })
      const params = {
        ref: { type: "ref/prompt", name: "fixture" },
        argument: { name: "query", value: "f" },
      }
      expect((await client.complete(params, { timeout: 1000 })).completion).toEqual({
        values: ["fixture"],
        total: 1,
        hasMore: false,
      })
      values = new Array(101).fill("fixture")
      Object.defineProperty(values, 0, {
        get() {
          reads++
          throw new Error("completion child")
        },
      })
      await expect(client.complete(params, { timeout: 1000 })).rejects.toMatchObject({
        issues: [
          expect.objectContaining({
            code: "too_big",
            maximum: 100,
            path: ["completion", "values"],
          }),
        ],
      })
      expect(reads).toBe(0)
      expect(methods).toEqual(["completion/complete", "completion/complete"])
    } finally {
      await client.close()
      expect(closed).toBe(true)
    }
  })
})

describe("upstream v4.6.7 interpreter and compiler", () => {
  it("preserves disabled bounds, declaration order, overwrite and later-refinement safety", () => {
    expect(
      z
        .array(z.number())
        .max(1, { when: () => false })
        .parse([1, 2]),
    ).toEqual([1, 2])
    expect(
      z
        .array(z.number())
        .overwrite((v: number[]) => v.slice(0, 1))
        .max(1)
        .parse([1, 2]),
    ).toEqual([1])
    let children = 0
    let later = 0
    const schema = z
      .array(
        z.number().transform((value: number) => {
          children++
          return value + 1
        }),
      )
      .max(2, { error: "first upper bound" })
      .max(1)
      .refine(
        () => {
          later++
          return true
        },
        { when: () => true },
      )
    const result = z.object({ values: schema }).safeParse({ values: [1, 2, 3] })
    expect(result.error.issues[0]).toMatchObject({
      code: "too_big",
      maximum: 2,
      origin: "array",
      message: "first upper bound",
      path: ["values"],
    })
    expect(children).toBe(0)
    expect(later).toBe(0)
    expect(
      z
        .array(z.number())
        .max(1)
        .overwrite((v: number[]) => v.slice(0, 1))
        .safeParse([1, 2]).success,
    ).toBe(false)
    expect(z.array(z.number()).min(2).safeParse([1]).error.issues[0].code).toBe("too_small")
    expect(z.array(z.number()).safeParse("wrong type").error.issues[0].code).toBe("invalid_type")
  })

  it("enforces raw map/set bounds before deduplicating child transforms", async () => {
    let children = 0
    const child = z.number().transform((value: number) => {
      children++
      return value + 1
    })
    const key = z.string().transform(() => {
      children++
      return "same"
    })
    const set = z.set(child).size(1)
    const map = z.map(key, child).size(1)
    expect(set.safeParse(new Set([1, 2])).success).toBe(false)
    expect(
      map.safeParse(
        new Map([
          ["a", 1],
          ["b", 2],
        ]),
      ).success,
    ).toBe(false)
    expect(children).toBe(0)
    expect(await set.parseAsync(new Set([1]))).toEqual(new Set([2]))
    expect(await map.parseAsync(new Map([["a", 1]]))).toEqual(new Map([["same", 2]]))
    expect(z.array(child).parse([1, 2])).toEqual([2, 3])
  })

  it("retains skipChecks and backwards codec/canary work", () => {
    let callbacks = 0
    const array = z
      .array(
        z.number().transform((n: number) => {
          callbacks++
          return n + 1
        }),
      )
      .max(1)
    const skipped = array._zod.run({ value: [1, 2], issues: [] }, { skipChecks: true })
    expect(skipped.issues).toEqual([])
    expect(skipped.value).toEqual([2, 3])
    expect(callbacks).toBe(2)
    let encoded = 0
    const codec = z.codec(z.number(), z.string(), {
      decode: (n: number) => String(n),
      encode: (s: string) => {
        encoded++
        return Number(s)
      },
    })
    const schema = z.array(codec).max(1)
    expect(z.encode(schema, ["1"])).toEqual([1])
    encoded = 0
    expect(z.safeEncode(schema, ["1", "2"]).success).toBe(false)
    expect(encoded).toBeGreaterThan(0)
  })

  it.each([false, true])("uses object collection dispatch with jitless=%s", (jitless) => {
    const previous = { ...z.config() }
    const originalFunction = globalThis.Function
    let generated = 0
    const spy = vi.spyOn(globalThis, "Function").mockImplementation(function constructorSpy(
      ...args: string[]
    ) {
      generated++
      return originalFunction(...args)
    })
    z.config({ jitless })
    try {
      const schema = z.object({ values: z.array(z.number()).max(1) })
      expect(schema.parse({ values: [1] })).toEqual({ values: [1] })
      const values = [1, 2]
      Object.defineProperty(values, 0, {
        get() {
          throw new Error("object child")
        },
      })
      expect(schema.safeParse({ values }).error.issues[0]).toMatchObject({
        code: "too_big",
        path: ["values"],
      })
      expect(generated > 0).toBe(!jitless)
    } finally {
      spy.mockRestore()
      z.config(previous)
    }
  })

  it("runs actual strict generated array/map/set preflights", () => {
    const array = [1, 2]
    Object.defineProperty(array, 0, {
      get() {
        throw new Error("compiled array child")
      },
    })
    const set = new Set([1, 2])
    Object.defineProperty(set, Symbol.iterator, {
      value() {
        throw new Error("compiled set iterator")
      },
    })
    const map = new Map([
      ["a", 1],
      ["b", 2],
    ])
    Object.defineProperty(map, Symbol.iterator, {
      value() {
        throw new Error("compiled map iterator")
      },
    })
    for (const [schema, large, valid] of [
      [z.array(z.number()).max(1), array, [1]],
      [z.set(z.number()).max(1), set, new Set([1])],
      [z.map(z.string(), z.number()).max(1), map, new Map([["a", 1]])],
    ]) {
      const compiled = z.compile(schema, { strict: true })
      expect(compiled).not.toBe(schema)
      const parser = z.core.compileFn(schema, { debug: true })
      expect(parser.code.length).toBeGreaterThan(0)
      expect(parser(large)).toBe(z.core.INVALID)
      expect(parser(valid)).toEqual(valid)
      expect(compiled.safeParse(large).success).toBe(false)
      expect(compiled.parse(valid)).toEqual(valid)
    }
  })
})

describe("the exact bundled dormant v3 factory", () => {
  it.each(["max", "length"])(
    "aborts oversized array %s before transforms/refinements",
    async (bound) => {
      let children = 0
      let later = 0
      const schema = legacy
        .array(
          legacy.number().transform((v: number) => {
            children++
            return v + 1
          }),
        )
        [bound](2)
        .superRefine(() => {
          later++
        })
      for (const result of [schema.safeParse([1, 2, 3]), await schema.safeParseAsync([1, 2, 3])]) {
        expect(result.error.issues[0]).toMatchObject({ code: "too_big", type: "array", maximum: 2 })
      }
      expect(children).toBe(0)
      expect(later).toBe(0)
      expect(await schema.parseAsync([1, 2])).toEqual([2, 3])
      expect(children).toBe(2)
      expect(later).toBe(1)
    },
  )

  it.each(["max", "size"])("aborts oversized set %s before enumeration", async (bound) => {
    let enumerations = 0
    let later = 0
    const values = new Set([1, 2, 3])
    Object.defineProperty(values, "values", {
      value() {
        enumerations++
        throw new Error("v3 enumeration")
      },
    })
    const schema = legacy
      .set(legacy.number())
      [bound](2)
      .superRefine(() => {
        later++
      })
    expect(schema.safeParse(values).error.issues[0]).toMatchObject({
      code: "too_big",
      type: "set",
      maximum: 2,
    })
    expect((await schema.safeParseAsync(values)).success).toBe(false)
    expect(enumerations).toBe(0)
    expect(later).toBe(0)
    expect(await schema.parseAsync(new Set([1, 2]))).toEqual(new Set([1, 2]))
  })

  it("preserves fixed-prefix issues, rest tuples, normal transforms and error maps", async () => {
    let reads = 0
    const values = [-1, 5, null]
    Object.defineProperty(values, 2, {
      get() {
        reads++
        throw new Error("v3 tuple tail")
      },
    })
    const tuple = legacy.tuple([legacy.number().min(0), legacy.string()])
    for (const result of [tuple.safeParse(values), await tuple.safeParseAsync(values)]) {
      expect(result.error.issues.map((i: { code: string }) => i.code)).toEqual(
        expect.arrayContaining(["too_big", "too_small", "invalid_type"]),
      )
    }
    expect(reads).toBe(0)
    expect(tuple.parse([1, "fixture"])).toEqual([1, "fixture"])
    expect(legacy.tuple([legacy.number()]).rest(legacy.string()).parse([1, "a", "b"])).toEqual([
      1,
      "a",
      "b",
    ])
    expect(legacy.array(legacy.number().transform((v: number) => v + 1)).parse([1, 2, 3])).toEqual([
      2, 3, 4,
    ])
    expect(legacy.array(legacy.number()).length(2).safeParse([1]).error.issues[0].code).toBe(
      "too_small",
    )
    const bounded = legacy
      .array(legacy.number(), { errorMap: () => ({ message: "bounded legacy" }) })
      .max(1)
    expect(
      legacy.object({ values: bounded }).safeParse({ values: [1, 2] }).error.issues[0],
    ).toMatchObject({
      code: "too_big",
      path: ["values"],
      maximum: 1,
      message: "bounded legacy",
    })
  })
})

describe("ordinary Playwright API compatibility without browser installation", () => {
  it("retains root imports, browser-type API and CLI help/version", () => {
    const api = rootRequire("playwright")
    for (const name of ["chromium", "firefox", "webkit"])
      expect(typeof api[name].launch).toBe("function")
    expect(playwrightRequire("playwright-core/package.json").version).toBe("1.65.1")
    const cli = join(dirname(rootRequire.resolve("playwright/package.json")), "cli.js")
    for (const args of [["--version"], ["--help"]]) {
      const result = spawnSync(process.execPath, [cli, ...args], {
        encoding: "utf8",
        timeout: 5000,
      })
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).toContain(args[0] === "--version" ? "1.65.1" : "Usage:")
    }
  })

  it("uses the real request API on bounded loopback and disposes it", async () => {
    const server = createServer((request, response) => {
      response.writeHead(request.url === "/fixture" ? 200 : 404, {
        "content-type": "application/json",
      })
      response.end(JSON.stringify({ fixture: true }))
    })
    let request: import("playwright").APIRequestContext | undefined
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject)
        server.listen(0, "127.0.0.1", () => {
          server.off("error", reject)
          resolve()
        })
      })
      const address = server.address()
      if (!address || typeof address === "string") throw new Error("missing loopback fixture")
      request = await rootRequire("playwright").request.newContext({
        baseURL: `http://127.0.0.1:${address.port}`,
        timeout: 1000,
      })
      const response = await request.get("/fixture")
      expect(response.ok()).toBe(true)
      expect(await response.json()).toEqual({ fixture: true })
      expect((await request.get("/missing")).status()).toBe(404)
    } finally {
      try {
        await request?.dispose()
      } finally {
        server.closeAllConnections()
        if (server.listening) {
          await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          )
        }
      }
    }
  })
})

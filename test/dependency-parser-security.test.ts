import { createRequire } from "node:module"
import { describe, expect, it } from "vitest"

// Resolve the parsers through their real docs-tool consumers.
const rootRequire = createRequire(import.meta.url)
const mintlifyRequire = createRequire(rootRequire.resolve("mintlify/package.json"))
const cliRequire = createRequire(mintlifyRequire.resolve("@mintlify/cli"))
const previewRequire = createRequire(cliRequire.resolve("@mintlify/previewing"))
const expressRequire = createRequire(previewRequire.resolve("express"))
const proxyaddr = expressRequire("proxy-addr")
const scrapingRequire = createRequire(cliRequire.resolve("@mintlify/scraping"))
const { XMLParser } = scrapingRequire("fast-xml-parser")

function forwardedAddress(subnet: string, remoteAddress: string) {
  return proxyaddr(
    {
      headers: { "x-forwarded-for": "192.0.2.123" },
      socket: { remoteAddress },
    },
    proxyaddr.compile(subnet),
  )
}

describe("docs proxy trust boundary", () => {
  it.each(["::ffff:10.0.0.0/8", "::/1"])(
    "does not trust an unrelated IPv4 peer through %s",
    (subnet) => {
      expect(forwardedAddress(subnet, "203.0.113.12")).toBe("203.0.113.12")
    },
  )

  it.each(["10.0.0.0/8", "::ffff:10.0.0.0/104"])(
    "preserves correctly scoped proxy behavior through %s",
    (subnet) => {
      expect(forwardedAddress(subnet, "203.0.113.12")).toBe("203.0.113.12")
      expect(forwardedAddress(subnet, "10.1.2.3")).toBe("192.0.2.123")
    },
  )
})

describe("docs PHPDoc XML compatibility", () => {
  it("preserves array tags, attributes, string values and HTML entities", () => {
    const arrayTags = new Set(["file", "class", "method"])
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      parseTagValue: false,
      parseAttributeValue: false,
      htmlEntities: true,
      isArray: (name: string) => arrayTags.has(name),
    })
    const xml =
      '<project><file path="src/Fixture.php"><class><name>01</name><description>A &amp; B</description><method visibility="public"><name>run</name></method></class></file></project>'

    expect(parser.parse(xml)).toEqual({
      project: {
        file: [
          {
            "@_path": "src/Fixture.php",
            class: [
              {
                name: "01",
                description: "A & B",
                method: [{ "@_visibility": "public", name: "run" }],
              },
            ],
          },
        ],
      },
    })
  })
})

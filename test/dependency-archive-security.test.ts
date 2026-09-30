import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

// Exercise the actual docs browser downloader's extraction boundary.
let dependencyRequire = createRequire(import.meta.url)
dependencyRequire = createRequire(dependencyRequire.resolve("mintlify/package.json"))
dependencyRequire = createRequire(dependencyRequire.resolve("@mintlify/cli"))
const Zip = dependencyRequire("adm-zip")
for (const name of ["@mintlify/link-rot", "@mintlify/scraping", "puppeteer"]) {
  dependencyRequire = createRequire(dependencyRequire.resolve(name))
}
const browsersEntry = dependencyRequire.resolve("@puppeteer/browsers")
const { unpackArchive } = dependencyRequire(join(dirname(browsersEntry), "fileUtil.js")) as {
  unpackArchive: (archive: string, destination: string) => Promise<void>
}

const scratchDirectories: string[] = []

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openboa-zip-security-"))
  scratchDirectories.push(root)
  const destination = join(root, "browser")
  await mkdir(destination)
  return { root, destination, archive: join(root, "browser.zip") }
}

function addSymlink(zip: InstanceType<typeof Zip>, name: string, target: string) {
  zip.addFile(name, Buffer.from(target))
  const entry = zip.getEntry(name)
  entry.header.made = (3 << 8) | 20
  entry.header.attr = (0o120777 << 16) >>> 0
}

afterEach(async () => {
  await Promise.all(scratchDirectories.splice(0).map((path) => rm(path, { recursive: true })))
})

describe("docs browser archive extraction", () => {
  it.each(["relative", "absolute"])(
    "rejects %s symlinks outside the browser directory",
    async (kind) => {
      const { root, destination, archive } = await fixture()
      const outside = join(root, "outside.txt")
      await writeFile(outside, "original")
      const zip = new Zip()
      addSymlink(zip, "escape", kind === "absolute" ? outside : "../outside.txt")
      zip.writeZip(archive)

      await expect(unpackArchive(archive, destination)).rejects.toThrow()
      expect(await readFile(outside, "utf8")).toBe("original")
    },
  )

  it("replaces a pre-existing file symlink without overwriting its target", async () => {
    const { root, destination, archive } = await fixture()
    const outside = join(root, "outside.txt")
    await writeFile(outside, "original")
    await symlink(outside, join(destination, "chrome"))
    const zip = new Zip()
    zip.addFile("chrome", Buffer.from("browser binary"))
    zip.writeZip(archive)

    await unpackArchive(archive, destination)
    expect(await readFile(outside, "utf8")).toBe("original")
    expect(await readFile(join(destination, "chrome"), "utf8")).toBe("browser binary")
  })

  it("preserves browser files, executable permissions, and internal relative symlinks", async () => {
    const { destination, archive } = await fixture()
    const zip = new Zip()
    zip.addFile("bin/chrome", Buffer.from("browser binary"))
    const binary = zip.getEntry("bin/chrome")
    binary.header.made = (3 << 8) | 20
    binary.header.attr = (0o100755 << 16) >>> 0
    addSymlink(zip, "chrome", "bin/chrome")
    zip.writeZip(archive)

    await unpackArchive(archive, destination)
    expect(await readFile(join(destination, "chrome"), "utf8")).toBe("browser binary")
    expect((await stat(join(destination, "bin/chrome"))).mode & 0o777).toBe(0o755)
  })
})

import { once } from "node:events"
import { createRequire } from "node:module"
import { type AddressInfo, createServer, type Server, Socket } from "node:net"
import { PassThrough } from "node:stream"
import { afterEach, describe, expect, it, vi } from "vitest"

let consumerRequire = createRequire(import.meta.url)
for (const name of [
  "mintlify/package.json",
  "@mintlify/cli",
  "@mintlify/link-rot",
  "@mintlify/scraping",
  "puppeteer",
  "@puppeteer/browsers",
  "proxy-agent",
  "pac-proxy-agent",
]) {
  consumerRequire = createRequire(consumerRequire.resolve(name))
}
const { getUri } = consumerRequire("get-uri")
const getUriRequire = createRequire(consumerRequire.resolve("get-uri"))
const { Client } = getUriRequire("basic-ftp")

type FtpOptions = {
  unsupportedMdtm?: boolean
  listingFact?: string
  passiveHost?: string
}

const fixtures: Array<{ close: () => Promise<void> }> = []
const fileBytes = "local FTP fixture\n"

async function listen(server: Server) {
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  return (server.address() as AddressInfo).port
}

async function ftpFixture(options: FtpOptions = {}) {
  const sockets = new Set<Socket>()
  const servers: Server[] = []
  const commands: string[] = []
  let dataSocket: Socket | undefined
  const track = (socket: Socket) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
    socket.on("error", () => {})
  }
  const control = createServer((socket) => {
    track(socket)
    socket.write("220 Local test server\r\n")
    let buffered = ""
    let queue = Promise.resolve()

    const command = async (line: string) => {
      const verb = line.split(" ", 1)[0]
      commands.push(verb)
      if (verb === "USER" || verb === "PASS") {
        socket.write("230 Logged in\r\n")
      } else if (verb === "FEAT") {
        socket.write("211-Features\r\n MLST type*;size*;modify*;\r\n211 End\r\n")
      } else if (verb === "MDTM") {
        socket.write(
          options.unsupportedMdtm ? "502 MDTM unsupported\r\n" : "213 20261117000000\r\n",
        )
      } else if (verb === "EPSV") {
        socket.write("502 Use PASV\r\n")
      } else if (verb === "PASV") {
        const dataServer = createServer((data) => {
          track(data)
          dataSocket = data
        })
        servers.push(dataServer)
        const port = await listen(dataServer)
        const host = (options.passiveHost ?? "127.0.0.1").replaceAll(".", ",")
        socket.write(`227 Entering Passive Mode (${host},${port >> 8},${port & 255})\r\n`)
      } else if (verb === "MLSD" || verb === "LIST" || verb === "RETR") {
        if (!dataSocket) throw new Error("Transfer requested without a data connection")
        const listing = `${options.listingFact ?? ""}type=file;size=${fileBytes.length};modify=20261117000000; fixture.txt\r\n`
        socket.write("150 Opening data connection\r\n")
        dataSocket.end(verb === "RETR" ? fileBytes : listing, () => {
          if (!socket.destroyed) socket.write("226 Transfer complete\r\n")
        })
        dataSocket = undefined
      } else if (verb === "QUIT") {
        socket.end("221 Goodbye\r\n")
      } else {
        socket.write("200 OK\r\n")
      }
    }

    socket.on("data", (chunk) => {
      buffered += chunk.toString()
      let end = buffered.indexOf("\r\n")
      while (end !== -1) {
        const line = buffered.slice(0, end)
        buffered = buffered.slice(end + 2)
        queue = queue
          .then(() => command(line))
          .catch(() => {
            socket.destroy()
          })
        end = buffered.indexOf("\r\n")
      }
    })
  })
  servers.push(control)
  const port = await listen(control)
  const fixture = {
    url: `ftp://127.0.0.1:${port}/fixture.txt`,
    port,
    commands,
    async close() {
      for (const socket of sockets) socket.destroy()
      await Promise.all(
        servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
      )
    },
  }
  fixtures.push(fixture)
  return fixture
}

async function download(url: string) {
  const stream = await getUri(url)
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString()
}

function forbidForeignConnections() {
  const attempted: string[] = []
  const originalConnect = Socket.prototype.connect
  vi.spyOn(Socket.prototype, "connect").mockImplementation(function (
    this: Socket,
    ...args: unknown[]
  ) {
    const options = args[0]
    const host =
      options && typeof options === "object" && "host" in options
        ? String(options.host)
        : typeof args[1] === "string"
          ? args[1]
          : undefined
    if (host && host !== "127.0.0.1") {
      attempted.push(host)
      throw new Error("Foreign connection blocked by local fixture")
    }
    return Reflect.apply(originalConnect, this, args) as Socket
  })
  return attempted
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()))
})

describe("docs get-uri FTP dependency boundary", () => {
  it("downloads ordinary same-host files", async () => {
    const fixture = await ftpFixture()
    expect(await download(fixture.url)).toBe(fileBytes)
    expect(fixture.commands).toContain("MDTM")
    expect(fixture.commands).not.toContain("MLSD")
  })

  it("retains LIST fallback when MDTM is unsupported", async () => {
    const fixture = await ftpFixture({ unsupportedMdtm: true })
    expect(await download(fixture.url)).toBe(fileBytes)
    expect(fixture.commands).toContain("MLSD")
  })

  it.each(["__proto__=x;", "constructor=x;"])(
    "ignores inherited MLSD facts without losing the file: %s",
    async (listingFact) => {
      const fixture = await ftpFixture({ unsupportedMdtm: true, listingFact })
      expect(await download(fixture.url)).toBe(fileBytes)
      expect(fixture.commands).toContain("MLSD")
      expect(fixture.commands).toContain("RETR")
    },
  )

  it("rejects an unrelated PASV data host before attempting a connection", async () => {
    const fixture = await ftpFixture({ passiveHost: "203.0.113.77" })
    const attempted = forbidForeignConnections()
    const client = new Client(1000)
    try {
      await client.access({ host: "127.0.0.1", port: fixture.port })
      await expect(client.downloadTo(new PassThrough(), "/fixture.txt")).rejects.toThrow()
      expect(attempted).toEqual([])
      expect(fixture.commands).toContain("PASV")
    } finally {
      client.close()
    }
  })

  it("substitutes the control host for a permitted loopback alias", async () => {
    const fixture = await ftpFixture({ passiveHost: "127.0.0.2" })
    const attempted = forbidForeignConnections()
    expect(await download(fixture.url)).toBe(fileBytes)
    expect(attempted).toEqual([])
  })
})

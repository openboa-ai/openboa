import { describe, expect, it } from "vitest"

import {
  type ParsedCommand,
  parseCliOptions,
  parseOpenBoaCommand,
  usageLines,
} from "../src/cli/parser.js"

describe("openboa parser", () => {
  it("parses setup command", () => {
    const parsed: ParsedCommand = parseOpenBoaCommand(["setup"])
    expect(parsed.kind).toBe("setup")
  })

  it("parses help request", () => {
    expect(parseOpenBoaCommand(["--help"]).kind).toBe("help")
    expect(parseOpenBoaCommand(["-h"]).kind).toBe("help")
  })

  it("parses agent spawn with --name", () => {
    const parsed: ParsedCommand = parseOpenBoaCommand(["agent", "spawn", "--name", "agent_1"])
    expect(parsed.kind).toBe("agent-spawn")
    expect(parsed).toMatchObject({ agentId: "agent_1" })
  })

  it("parses agent chat with flags", () => {
    const parsed: ParsedCommand = parseOpenBoaCommand([
      "agent",
      "chat",
      "--name",
      "agent_1",
      "--chat-id",
      "c1",
      "--session-id",
      "s1",
      "--sender-id",
      "u1",
    ])
    expect(parsed).toBeTypeOf("object")
    expect(parsed.kind).toBe("agent-chat")
    expect(parsed.agentId).toBe("agent_1")
    expect(parsed.options?.["chat-id"]).toBe("c1")
    expect(parsed.options?.["session-id"]).toBe("s1")
    expect(parsed.options?.["sender-id"]).toBe("u1")
  })

  it("parses oneshot chat text and keeps spacing", () => {
    const parsed: ParsedCommand = parseOpenBoaCommand(["hello", "pi", "runtime"])
    expect(parsed.kind).toBe("oneshot-chat")
    expect(parsed.text).toBe("hello pi runtime")
  })

  it("parses short options and flag style", () => {
    const parsed: ParsedCommand = parseOpenBoaCommand(["agent", "spawn", "-n", "agent_2"])
    expect(parsed.kind).toBe("agent-spawn")
    expect(parsed.agentId).toBe("agent_2")
  })

  it("extracts cli options in equals form and standalone flag", () => {
    const parsed = parseCliOptions(["--name=agent_3", "--chat-id=c1", "--flag"])
    expect(parsed.name).toBe("agent_3")
    expect(parsed["chat-id"]).toBe("c1")
    expect(parsed.flag).toBe("true")
  })

  it("renders stable usage lines", () => {
    const lines = usageLines()
    expect(lines[0]).toBe("openboa usage:")
    expect(lines).toContain("  openboa setup")
    expect(lines).toContain("  openboa codex-login")
  })
})

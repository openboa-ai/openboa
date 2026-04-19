import { mkdir, open, readFile, unlink, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"
import { LocalSandbox, sandboxLockPathForRoot } from "../src/agents/sandbox/sandbox.js"
import type { ResourceAttachment } from "../src/agents/schema/runtime.js"
import { SessionStore } from "../src/agents/sessions/session-store.js"
import { createCompanyFixture, createOfflineCodexAgent } from "./helpers.js"

describe("local sandbox", () => {
  it("reads and writes within mounted workspace resources", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const sandbox = new LocalSandbox()
    const sandboxExecute = (name: string, input: unknown) => sandbox.execute(name, input)

    await sandbox.provision(session.resources)

    const substrateWrite = await sandboxExecute("write_text", {
      path: "/workspace/agent/AGENTS.md",
      content: "should fail",
    })

    const mkdirResult = await sandboxExecute("mkdir", {
      path: "/workspace/notes",
      recursive: true,
    })
    const writeResult = await sandboxExecute("write_text", {
      path: "notes/sandbox.md",
      content: "workspace-backed sandbox",
    })
    const appendResult = await sandboxExecute("append_text", {
      path: "notes/sandbox.md",
      content: "\nappend works",
    })
    const replaceResult = await sandboxExecute("replace_text", {
      path: "/workspace/notes/sandbox.md",
      oldText: "append works",
      newText: "replace works",
    })
    const readResult = await sandboxExecute("read_text", {
      path: "/workspace/notes/sandbox.md",
    })
    const headReadResult = await sandboxExecute("read_text", {
      path: "/workspace/notes/sandbox.md",
      lineCount: 1,
    })
    const rangeReadResult = await sandboxExecute("read_text", {
      path: "/workspace/notes/sandbox.md",
      startLine: 2,
      lineCount: 1,
    })
    const tailReadResult = await sandboxExecute("read_text", {
      path: "/workspace/notes/sandbox.md",
      tailLines: 1,
    })
    const tolerantHeadReadResult = await sandboxExecute("read_text", {
      path: "/workspace/notes/sandbox.md",
      lineCount: 1,
      tailLines: 0,
    })
    const listResult = await sandboxExecute("list_dir", {
      path: "/workspace/notes",
      limit: 10,
    })
    const workspaceRootList = await sandboxExecute("list_dir", {
      path: "/workspace",
      limit: 20,
    })
    const findResult = await sandboxExecute("find_entries", {
      path: "/workspace",
      query: "sandbox",
      limit: 10,
    })
    const globResult = await sandboxExecute("glob_entries", {
      path: "/workspace",
      pattern: "**/*.md",
      limit: 10,
    })
    const globDirectoryResult = await sandboxExecute("glob_entries", {
      path: "/workspace",
      pattern: "**/notes",
      kind: "directory",
      limit: 10,
    })
    const grepResult = await sandboxExecute("grep_text", {
      path: "/workspace",
      query: "workspace-backed sandbox",
      limit: 10,
    })
    const regexGrepResult = await sandboxExecute("grep_text", {
      path: "/workspace",
      query: "workspace-backed\\s+sandbox",
      regex: true,
      limit: 10,
    })
    const commandResult = await sandboxExecute("run_command", {
      command: "pwd",
      args: [],
      cwd: "/workspace/notes",
      timeoutMs: 5000,
    })
    const basenameResult = await sandboxExecute("run_command", {
      command: "basename",
      args: ["sandbox.md"],
      cwd: "/workspace/notes",
      timeoutMs: 5000,
    })
    const dirnameResult = await sandboxExecute("run_command", {
      command: "dirname",
      args: ["sandbox.md"],
      cwd: "/workspace/notes",
      timeoutMs: 5000,
    })
    const shellResult = await sandboxExecute("run_shell", {
      command: "printf '%s' \"$SESSION_FLAG\" > shell.txt",
      cwd: "/workspace/notes",
      timeoutMs: 5000,
      env: { SESSION_FLAG: "from shell" },
    })
    const virtualShellResult = await sandboxExecute("run_shell", {
      command: "printf '%s' 'virtual shell path' > /workspace/notes/virtual-shell.txt",
      cwd: "/workspace",
      timeoutMs: 5000,
    })
    const openPersistentShell = await sandboxExecute("open_persistent_shell", {
      cwd: "/workspace",
      env: { SESSION_FLAG: "persisted shell" },
    })
    const persistentShellExec = await sandboxExecute("exec_persistent_shell", {
      command:
        'export EXTRA_FLAG=persistent && cd notes && printf \'%s/%s\' "$SESSION_FLAG" "$EXTRA_FLAG" > persistent.txt',
      timeoutMs: 5000,
    })
    const persistentVirtualShellExec = await sandboxExecute("exec_persistent_shell", {
      command: "printf '%s' 'virtual persistent path' > /workspace/notes/virtual-persistent.txt",
      timeoutMs: 5000,
    })
    const closePersistentShell = await sandboxExecute("close_persistent_shell", {})
    process.env.OPENBOA_ENV_LEAK_TEST = "should-not-leak"
    const envResult = await sandboxExecute("run_command", {
      command: "env",
      args: [],
      cwd: "/workspace",
      timeoutMs: 5000,
      env: { SESSION_FLAG: "from env" },
    })
    delete process.env.OPENBOA_ENV_LEAK_TEST
    const statResult = await sandboxExecute("stat", {
      path: "/workspace/notes/sandbox.md",
    })

    expect(mkdirResult.ok).toBe(true)
    expect(substrateWrite.ok).toBe(false)
    expect(substrateWrite.error?.message).toContain("read-only")
    expect(writeResult.ok).toBe(true)
    expect(appendResult.ok).toBe(true)
    expect(replaceResult.ok).toBe(true)
    expect(readResult.ok).toBe(true)
    expect(readResult.text).toContain("workspace-backed sandbox")
    expect(readResult.text).toContain("replace works")
    expect(
      (readResult.output as { totalLineCount?: number; selectedLineCount?: number } | null)
        ?.totalLineCount,
    ).toBe(2)
    expect(
      (readResult.output as { totalLineCount?: number; selectedLineCount?: number } | null)
        ?.selectedLineCount,
    ).toBe(2)
    expect(headReadResult.ok).toBe(true)
    expect(headReadResult.text).toContain("workspace-backed sandbox")
    expect(headReadResult.text).not.toContain("replace works")
    expect(
      (headReadResult.output as { totalLineCount?: number; selectedLineCount?: number } | null)
        ?.totalLineCount,
    ).toBe(2)
    expect(
      (headReadResult.output as { totalLineCount?: number; selectedLineCount?: number } | null)
        ?.selectedLineCount,
    ).toBe(1)
    expect(
      (headReadResult.output as { lineWindow?: { mode: string; count: number } } | null)
        ?.lineWindow,
    ).toEqual({ mode: "head", count: 1 })
    expect(rangeReadResult.ok).toBe(true)
    expect(rangeReadResult.text).toContain("replace works")
    expect(rangeReadResult.text).not.toContain("workspace-backed sandbox")
    expect(
      (rangeReadResult.output as { totalLineCount?: number; selectedLineCount?: number } | null)
        ?.totalLineCount,
    ).toBe(2)
    expect(
      (rangeReadResult.output as { totalLineCount?: number; selectedLineCount?: number } | null)
        ?.selectedLineCount,
    ).toBe(1)
    expect(
      (
        rangeReadResult.output as {
          lineWindow?: { mode: string; startLine?: number; count: number }
        } | null
      )?.lineWindow,
    ).toEqual({ mode: "range", startLine: 2, count: 1 })
    expect(tailReadResult.ok).toBe(true)
    expect(tailReadResult.text).toContain("replace works")
    expect(tailReadResult.text).not.toContain("workspace-backed sandbox")
    expect(
      (tailReadResult.output as { totalLineCount?: number; selectedLineCount?: number } | null)
        ?.totalLineCount,
    ).toBe(2)
    expect(
      (tailReadResult.output as { totalLineCount?: number; selectedLineCount?: number } | null)
        ?.selectedLineCount,
    ).toBe(1)
    expect(
      (tailReadResult.output as { lineWindow?: { mode: string; count: number } } | null)
        ?.lineWindow,
    ).toEqual({ mode: "tail", count: 1 })
    expect(tolerantHeadReadResult.ok).toBe(true)
    expect(tolerantHeadReadResult.text).toContain("workspace-backed sandbox")
    expect(tolerantHeadReadResult.text).not.toContain("replace works")
    expect(listResult.ok).toBe(true)
    expect(listResult.text).toContain("/workspace/notes/sandbox.md")
    expect(workspaceRootList.ok).toBe(true)
    expect(workspaceRootList.text).toContain("/workspace/agent")
    expect(workspaceRootList.text).toContain("/workspace/README.md")
    expect(findResult.ok).toBe(true)
    expect(findResult.text).toContain("/workspace/notes/sandbox.md")
    expect(globResult.ok).toBe(true)
    expect(globResult.text).toContain("/workspace/notes/sandbox.md")
    expect(globDirectoryResult.ok).toBe(true)
    expect(globDirectoryResult.text).toContain("directory\t/workspace/notes")
    expect(globDirectoryResult.text).not.toContain("file\t/workspace/notes")
    expect(grepResult.ok).toBe(true)
    expect(grepResult.text).toContain("/workspace/notes/sandbox.md")
    expect(regexGrepResult.ok).toBe(true)
    expect(regexGrepResult.text).toContain("/workspace/notes/sandbox.md")
    expect(commandResult.ok).toBe(true)
    expect(commandResult.text).toContain("exitCode=0")
    expect(commandResult.text).toContain("cwd=/workspace/notes")
    expect(commandResult.text).toContain("/sessions/")
    expect(basenameResult.ok).toBe(true)
    expect((basenameResult.output as { stdout?: string } | null)?.stdout?.trim()).toBe("sandbox.md")
    expect(dirnameResult.ok).toBe(true)
    expect((dirnameResult.output as { stdout?: string } | null)?.stdout?.trim()).toContain(
      "/workspace/notes",
    )
    expect(shellResult.ok).toBe(true)
    expect(shellResult.text).toContain("command=shell")
    expect(shellResult.text).toContain("cwd=/workspace/notes")
    expect(virtualShellResult.ok).toBe(true)
    expect(virtualShellResult.text).toContain("rewroteVirtualPaths=true")
    expect(openPersistentShell.ok).toBe(true)
    expect(openPersistentShell.text).toContain("persistent shell")
    expect(persistentShellExec.ok).toBe(true)
    expect((persistentShellExec.output as { cwd?: string; persistent?: boolean } | null)?.cwd).toBe(
      "/workspace/notes",
    )
    expect((persistentShellExec.output as { persistent?: boolean } | null)?.persistent).toBe(true)
    expect(persistentVirtualShellExec.ok).toBe(true)
    expect(persistentVirtualShellExec.text).toContain("rewroteVirtualPaths=true")
    expect(closePersistentShell.ok).toBe(true)
    expect(envResult.ok).toBe(true)
    const envStdout = (envResult.output as { stdout?: string } | null)?.stdout ?? ""
    expect(envStdout).toContain("OPENBOA_SESSION_ID=")
    expect(envStdout).toContain("OPENBOA_WORKSPACE_CWD=/workspace")
    expect(envStdout).toContain("SESSION_FLAG=from env")
    expect(envStdout).not.toContain("OPENBOA_ENV_LEAK_TEST=should-not-leak")
    const learningWrite = await sandboxExecute("write_text", {
      path: "/memory/learnings/manual.txt",
      content: "should fail",
    })
    expect(learningWrite.ok).toBe(false)
    expect(learningWrite.error?.message).toContain("read-only")
    expect(statResult.ok).toBe(true)
    expect(statResult.text).toContain("kind=file")

    const writtenPath = join(
      companyDir,
      ".openboa",
      "agents",
      "alpha",
      "sessions",
      session.id,
      "workspace",
      "notes",
      "sandbox.md",
    )
    const written = await readFile(writtenPath, "utf8")
    expect(written).toBe("workspace-backed sandbox\nreplace works")
    const shellWritten = await readFile(
      join(
        companyDir,
        ".openboa",
        "agents",
        "alpha",
        "sessions",
        session.id,
        "workspace",
        "notes",
        "shell.txt",
      ),
      "utf8",
    )
    expect(shellWritten).toBe("from shell")
    const virtualShellWritten = await readFile(
      join(
        companyDir,
        ".openboa",
        "agents",
        "alpha",
        "sessions",
        session.id,
        "workspace",
        "notes",
        "virtual-shell.txt",
      ),
      "utf8",
    )
    expect(virtualShellWritten).toBe("virtual shell path")
    const persistentWritten = await readFile(
      join(
        companyDir,
        ".openboa",
        "agents",
        "alpha",
        "sessions",
        session.id,
        "workspace",
        "notes",
        "persistent.txt",
      ),
      "utf8",
    )
    expect(persistentWritten).toBe("persisted shell/persistent")
    const persistentVirtualWritten = await readFile(
      join(
        companyDir,
        ".openboa",
        "agents",
        "alpha",
        "sessions",
        session.id,
        "workspace",
        "notes",
        "virtual-persistent.txt",
      ),
      "utf8",
    )
    expect(persistentVirtualWritten).toBe("virtual persistent path")

    const sessionReadme = await readFile(
      join(
        companyDir,
        ".openboa",
        "agents",
        "alpha",
        "sessions",
        session.id,
        "workspace",
        "README.md",
      ),
      "utf8",
    )
    expect(sessionReadme).toContain("writable execution hand")
    const runtimeGuide = await readFile(
      join(
        companyDir,
        ".openboa",
        "agents",
        "alpha",
        "sessions",
        session.id,
        "workspace",
        ".openboa-runtime",
        "session-runtime.md",
      ),
      "utf8",
    )
    expect(runtimeGuide).toContain("OpenBOA Session Runtime")
    expect(runtimeGuide).toContain("/workspace/agent")
    const runtimeGuideJson = await readFile(
      join(
        companyDir,
        ".openboa",
        "agents",
        "alpha",
        "sessions",
        session.id,
        "workspace",
        ".openboa-runtime",
        "session-runtime.json",
      ),
      "utf8",
    )
    expect(runtimeGuideJson).toContain('"mountPath": "/workspace"')
    expect(runtimeGuideJson).toContain('"mountPath": "/workspace/agent"')

    const description = await sandbox.describe()
    expect(description.constraints).toContain(
      "run_command is shell=false and limited to allowlisted read-only commands.",
    )
    expect(description.constraints).toContain(
      "run_shell is permission-gated and limited to writable execution mounts such as /workspace.",
    )
    expect(description.actions.some((action) => action.name === "glob_entries")).toBe(true)
    expect(description.actions.some((action) => action.name === "replace_text")).toBe(true)
    expect(description.actions.some((action) => action.name === "run_command")).toBe(true)
    expect(description.actions.some((action) => action.name === "run_shell")).toBe(true)
    expect(description.actions.some((action) => action.name === "open_persistent_shell")).toBe(true)
    expect(description.actions.some((action) => action.name === "exec_persistent_shell")).toBe(true)
    expect(description.actions.some((action) => action.name === "wait_persistent_shell")).toBe(true)
    expect(description.actions.some((action) => action.name === "close_persistent_shell")).toBe(
      true,
    )
    expect(description.commandPolicy?.allowlistedCommands).toContain("pwd")
    expect(description.commandPolicy?.allowlistedCommands).toContain("basename")
    expect(description.commandPolicy?.allowlistedCommands).toContain("dirname")
    expect(description.commandPolicy?.allowlistedCommands).toContain("realpath")
    expect(description.commandPolicy?.shell).toBe(true)
  })

  it("reports live busy state for the persistent shell while a command is running", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const sandbox = new LocalSandbox()
    const sandboxExecute = (name: string, input: unknown) => sandbox.execute(name, input)

    await sandbox.provision(session.resources)
    const opened = await sandboxExecute("open_persistent_shell", {
      cwd: "/workspace",
    })
    expect(opened.ok).toBe(true)

    const execPromise = sandboxExecute("exec_persistent_shell", {
      command: "printf 'start' && sleep 0.2 && printf 'done'",
      timeoutMs: 2000,
    })
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50))

    const inspectedBusy = await sandboxExecute("inspect_persistent_shell", {})
    expect(inspectedBusy.ok).toBe(true)
    expect(inspectedBusy.text).toContain("persistent shell ready")
    expect(
      (inspectedBusy.output as { persistentShell?: { busy?: boolean } | null } | null)
        ?.persistentShell?.busy,
    ).toBe(true)
    expect(
      (
        inspectedBusy.output as {
          persistentShell?: { currentCommand?: string | null } | null
        } | null
      )?.persistentShell?.currentCommand,
    ).toContain("sleep 0.2")
    expect(
      (
        inspectedBusy.output as {
          persistentShell?: { currentStdoutPreview?: string | null } | null
        } | null
      )?.persistentShell?.currentStdoutPreview,
    ).toContain("start")

    const waitedBusy = await sandboxExecute("wait_persistent_shell", {
      timeoutMs: 10,
    })
    expect(waitedBusy.ok).toBe(true)
    expect((waitedBusy.output as { status?: string } | null)?.status).toBe("running")

    const execResult = await execPromise
    expect(execResult.ok).toBe(true)

    const inspectedIdle = await sandboxExecute("inspect_persistent_shell", {})
    expect(inspectedIdle.ok).toBe(true)
    expect(
      (inspectedIdle.output as { persistentShell?: { busy?: boolean } | null } | null)
        ?.persistentShell?.busy,
    ).toBe(false)
  })

  it("blocks persistent shell execution when the mounted root is already write-locked", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const sandbox = new LocalSandbox()
    const sandboxExecute = (name: string, input: unknown) => sandbox.execute(name, input)

    await sandbox.provision(session.resources)

    const workspaceRoot = join(
      companyDir,
      ".openboa",
      "agents",
      "alpha",
      "sessions",
      session.id,
      "workspace",
    )
    const lockPath = sandboxLockPathForRoot(workspaceRoot)
    await mkdir(dirname(lockPath), { recursive: true })
    const firstLockHandle = await open(lockPath, "wx", 0o600)
    try {
      await firstLockHandle.writeFile("locked\n", "utf8")
    } finally {
      await firstLockHandle.close()
    }

    try {
      const result = await sandboxExecute("exec_persistent_shell", {
        command: "printf 'busy' > busy.txt",
        cwd: "/workspace",
        timeoutMs: 5000,
      })
      expect(result.ok).toBe(false)
      expect(result.error?.message).toContain("currently busy")
    } finally {
      await unlink(lockPath).catch(() => {})
    }
  })

  it("blocks paths outside mounted roots and denies writes to read-only mounts", async () => {
    const companyDir = await createCompanyFixture()
    const vaultDir = join(companyDir, "vault-fixture")
    await mkdir(vaultDir, { recursive: true })
    await writeFile(join(vaultDir, "sealed.txt"), "vault", "utf8")
    const sandbox = new LocalSandbox()
    const resources: ResourceAttachment[] = [
      {
        id: "workspace",
        kind: "session_workspace",
        sourceRef: join(companyDir, "workspace-fixture"),
        mountPath: "/workspace",
        access: "read_write",
      },
      {
        id: "vault",
        kind: "vault",
        sourceRef: vaultDir,
        mountPath: "/vault",
        access: "read_only",
      },
    ]
    await mkdir(join(companyDir, "workspace-fixture"), { recursive: true })
    const sandboxExecute = (name: string, input: unknown) => sandbox.execute(name, input)

    await sandbox.provision(resources)

    const outsideWrite = await sandboxExecute("write_text", {
      path: "/tmp/escape.txt",
      content: "nope",
    })
    const vaultRead = await sandboxExecute("read_text", {
      path: "/vault/sealed.txt",
    })
    const vaultGrep = await sandboxExecute("grep_text", {
      path: "/vault",
      query: "vault",
      limit: 10,
    })
    const vaultWrite = await sandboxExecute("write_text", {
      path: "/vault/sealed.txt",
      content: "changed",
    })
    const blockedCommand = await sandboxExecute("run_command", {
      command: "node",
      args: ["-e", "process.stdout.write('blocked')"],
      cwd: "/workspace",
      timeoutMs: 5000,
    })
    const protectedEnvCommand = await sandboxExecute("run_command", {
      command: "env",
      args: [],
      cwd: "/workspace",
      timeoutMs: 5000,
      env: {
        OPENBOA_SESSION_ID: "forbidden",
      },
    })
    const vaultCommand = await sandboxExecute("run_command", {
      command: "pwd",
      args: [],
      cwd: "/vault",
      timeoutMs: 5000,
    })
    const vaultCatCommand = await sandboxExecute("run_command", {
      command: "cat",
      args: ["sealed.txt"],
      cwd: "/vault",
      timeoutMs: 5000,
    })
    const vaultShell = await sandboxExecute("run_shell", {
      command: "printf 'blocked' > denied.txt",
      cwd: "/vault",
      timeoutMs: 5000,
    })

    expect(outsideWrite.ok).toBe(false)
    expect(outsideWrite.error?.message).toContain("outside provisioned sandbox mounts")
    expect(vaultRead.ok).toBe(false)
    expect(vaultRead.error?.message).toContain("Direct vault content reads are blocked")
    expect(vaultGrep.ok).toBe(false)
    expect(vaultGrep.error?.message).toContain("Direct vault content search is blocked")
    expect(vaultWrite.ok).toBe(false)
    expect(vaultWrite.error?.message).toContain("read-only")
    expect(blockedCommand.ok).toBe(false)
    expect(blockedCommand.error?.message).toContain("read-only commands")
    expect(protectedEnvCommand.ok).toBe(false)
    expect(protectedEnvCommand.error?.message).toContain("protected")
    expect(vaultCommand.ok).toBe(true)
    expect(vaultCommand.text).toContain("cwd=/vault")
    expect(vaultCatCommand.ok).toBe(false)
    expect(vaultCatCommand.error?.message).toContain("only allows pwd, ls")
    expect(vaultShell.ok).toBe(false)
    expect(vaultShell.error?.message).toContain("read-only")
  })

  it("serializes writes per mounted root with an advisory lock", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const sandbox = new LocalSandbox()
    const sandboxExecute = (name: string, input: unknown) => sandbox.execute(name, input)
    await sandbox.provision(session.resources)

    const workspaceRoot = join(
      companyDir,
      ".openboa",
      "agents",
      "alpha",
      "sessions",
      session.id,
      "workspace",
    )
    const lockPath = sandboxLockPathForRoot(workspaceRoot)
    await mkdir(dirname(lockPath), { recursive: true })
    const secondLockHandle = await open(lockPath, "wx", 0o600)
    try {
      await secondLockHandle.writeFile("busy\n", "utf8")
    } finally {
      await secondLockHandle.close()
    }

    const blocked = await sandboxExecute("write_text", {
      path: "/workspace/notes/blocked.md",
      content: "should not write",
    })

    expect(blocked.ok).toBe(false)
    expect(blocked.error?.message).toContain("currently busy")

    await unlink(lockPath)
  })
})

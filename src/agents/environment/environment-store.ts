import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { nowIsoString } from "../../foundation/time.js"
import type { Environment } from "../schema/runtime.js"

export const DEFAULT_LOCAL_ENVIRONMENT_ID = "local-default"

function defaultLocalEnvironment(now = nowIsoString()): Environment {
  return {
    id: DEFAULT_LOCAL_ENVIRONMENT_ID,
    name: "Default local environment",
    kind: "local",
    sandbox: {
      mode: "workspace",
      workspaceAccess: "rw",
      networkAccess: "enabled",
      packagePolicy: "workspace",
    },
    workspaceMountDefaults: {
      workspacePath: "/workspace",
      runtimePath: "/runtime",
    },
    createdAt: now,
    updatedAt: now,
  }
}

export class EnvironmentStore {
  constructor(private readonly companyDir: string) {}

  dirPath(): string {
    return join(this.companyDir, ".openboa", "environments")
  }

  filePath(environmentId: string): string {
    return join(this.dirPath(), `${environmentId}.json`)
  }

  async ensureDefaultLocalEnvironment(): Promise<Environment> {
    const existing = await this.getEnvironment(DEFAULT_LOCAL_ENVIRONMENT_ID)
    if (existing) {
      return existing
    }

    const environment = defaultLocalEnvironment()
    await this.writeEnvironment(environment)
    return environment
  }

  async writeEnvironment(environment: Environment): Promise<void> {
    await mkdir(this.dirPath(), { recursive: true })
    await writeFile(
      this.filePath(environment.id),
      `${JSON.stringify(environment, null, 2)}\n`,
      "utf8",
    )
  }

  async getEnvironment(environmentId: string): Promise<Environment | null> {
    try {
      const raw = await readFile(this.filePath(environmentId), "utf8")
      return JSON.parse(raw) as Environment
    } catch {
      return null
    }
  }

  async listEnvironments(): Promise<Environment[]> {
    const entries = await readdir(this.dirPath(), { withFileTypes: true }).catch(() => [])
    const environments = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => this.getEnvironment(entry.name.slice(0, -".json".length))),
    )

    return environments.filter((value): value is Environment => value !== null)
  }
}

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

export async function appendJsonl(filePath: string, record: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(record)}\n`, { encoding: "utf8", flag: "a" })
}

export async function readJsonl<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await readFile(filePath, "utf8")
    if (!raw.trim()) {
      return []
    }

    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as T)
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return []
    }

    throw error
  }
}

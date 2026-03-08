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

    const lines = raw.split("\n")
    const records: T[] = []

    for (let index = 0; index < lines.length; index += 1) {
      const trimmed = lines[index].trim()
      if (!trimmed) {
        continue
      }

      try {
        records.push(JSON.parse(trimmed) as T)
      } catch (error) {
        const hasNonEmptyAfter = lines
          .slice(index + 1)
          .some((line) => line.trim().length > 0)

        if (!hasNonEmptyAfter) {
          // tolerate partially written trailing line
          break
        }

        throw error
      }
    }

    return records
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return []
    }

    throw error
  }
}

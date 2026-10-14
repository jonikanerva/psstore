import fs from 'node:fs/promises'
import path from 'node:path'
import { format, resolveConfig } from 'prettier'

export const ensureDir = async (filePath: string): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
}

export const readJsonFile = async <T>(filePath: string): Promise<T> => {
  const raw = await fs.readFile(filePath, 'utf8')
  return JSON.parse(raw) as T
}

export const writeJsonFile = async (
  filePath: string,
  value: unknown,
): Promise<void> => {
  await ensureDir(filePath)
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

// Writes `value` as the JSON text that Prettier gives for `filePath`, so a
// committed file passes `mise run format-check` after the write.
// JSON.stringify(value, null, 2) puts each array item on its own line, but
// Prettier keeps a short array on one line. The input keeps the indentation:
// Prettier keeps a JSON object expanded only when its source text has a line
// break after `{`. `editorconfig: true` makes the API read the same
// configuration as the Prettier CLI.
export const writeFormattedJsonFile = async (
  filePath: string,
  value: unknown,
): Promise<void> => {
  const options = await resolveConfig(filePath, { editorconfig: true })
  const text = await format(JSON.stringify(value, null, 2), {
    ...(options ?? {}),
    filepath: filePath,
  })
  await ensureDir(filePath)
  await fs.writeFile(filePath, text, 'utf8')
}

export const readTextFile = async (filePath: string): Promise<string> =>
  fs.readFile(filePath, 'utf8')

export const writeTextFile = async (
  filePath: string,
  value: string,
): Promise<void> => {
  await ensureDir(filePath)
  await fs.writeFile(filePath, value, 'utf8')
}

export const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

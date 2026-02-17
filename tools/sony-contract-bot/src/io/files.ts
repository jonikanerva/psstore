import fs from 'node:fs/promises'
import path from 'node:path'

export const ensureDir = async (filePath: string): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
}

export const readJsonFile = async <T>(filePath: string): Promise<T> => {
  const raw = await fs.readFile(filePath, 'utf8')
  return JSON.parse(raw) as T
}

export const writeJsonFile = async (filePath: string, value: unknown): Promise<void> => {
  await ensureDir(filePath)
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export const readTextFile = async (filePath: string): Promise<string> => fs.readFile(filePath, 'utf8')

export const writeTextFile = async (filePath: string, value: string): Promise<void> => {
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

import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function readLocalData(filename: string): Promise<unknown> {
  try { return JSON.parse(await readFile(join(app.getPath('userData'), filename), 'utf8')) }
  catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** Replace a complete file so interrupted writes cannot leave partial JSON. */
export async function writeLocalData(filename: string, value: unknown): Promise<void> {
  const directory = app.getPath('userData')
  const target = join(directory, filename)
  const temporary = `${target}.${randomUUID()}.tmp`
  await mkdir(directory, { recursive: true })
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8')
    await rename(temporary, target)
  } finally { await rm(temporary, { force: true }) }
}

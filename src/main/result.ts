import type { ActionResult } from '../shared/types'

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'Something went wrong'
}

export async function settle<T>(work: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, value: await work() }
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) }
  }
}

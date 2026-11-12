import { readdirSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOTS = ['src', 'tests', 'scripts', 'docs']
const EXTENSIONS = new Set(['.ts', '.cjs', '.js', '.html', '.css', '.md', '.json'])
// UTF-8 text that was decoded as Windows-1252 shows up as a Latin-1 lead letter (U+00C2..U+00F4)
// followed by a character that Windows-1252 gives to the bytes 0x80..0xBF.
const GARBLED = /[\u00c2-\u00f4][\u0080-\u00bf\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u2013\u2014\u2018-\u201e\u2020-\u2022\u2026\u2030\u2039\u203a\u20ac\u2122]/

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return entry.name === 'bin' || entry.name === 'obj' ? [] : files(path)
    return EXTENSIONS.has(extname(entry.name)) ? [path] : []
  })
}

describe('text encoding', () => {
  it('has no garbled UTF-8 in source files', () => {
    const garbled = ROOTS.flatMap(files).flatMap((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .map((line, index) => ({ path, line: index + 1, text: line }))
        .filter(({ text }) => GARBLED.test(text)),
    )
    expect(garbled.map(({ path, line }) => `${path}:${line}`)).toEqual([])
  })
})

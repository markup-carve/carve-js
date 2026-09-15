import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { expandIncludes, parse, renderHtml, resolve } from '../src/index.js'
import { fileSystemResolver } from '../src/includes-fs.js'

const CHILD_MARKER = 'CHILD-CONTENT-MARKER'
const SOURCE = '{{ child.crv }}\n'

/**
 * Section 19 constrains the DOCUMENT, not the constructor: a host that
 * supplies no root leaves inclusion disabled and the directive literal. So the
 * resolver is built the way a host builds one - refusal means no resolver - and
 * every assertion below is made on the expanded document, from a working
 * directory that does contain the target.
 */
function expandFrom(cwd: string, rootSpec: string) {
  const previous = process.cwd()
  process.chdir(cwd)
  try {
    let resolver: ReturnType<typeof fileSystemResolver> | undefined
    try {
      resolver = fileSystemResolver(rootSpec)
    } catch {
      resolver = undefined
    }
    const result = expandIncludes(parse(SOURCE, { positions: true }), SOURCE, { resolve: resolver })
    return { ...result, html: renderHtml(resolve(result.doc)) }
  } finally {
    process.chdir(previous)
  }
}

describe('a blank include root configures no root', () => {
  it('leaves the directive literal when the working directory holds the target', () => {
    const base = mkdtempSync(join(tmpdir(), 'carve-blank-root-'))
    try {
      writeFileSync(join(base, 'child.crv'), `${CHILD_MARKER}\n`)
      const result = expandFrom(base, '')
      expect(result.html).toBe('<p>{{ child.crv }}</p>')
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('reads nothing at all', () => {
    const base = mkdtempSync(join(tmpdir(), 'carve-blank-root-'))
    try {
      writeFileSync(join(base, 'child.crv'), `${CHILD_MARKER}\n`)
      const result = expandFrom(base, '')
      expect(result.html).not.toContain(CHILD_MARKER)
      expect(result.dependencies).toEqual([])
      expect(result.warnings).toEqual([])
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('treats a whitespace-only value as unset, even where that names a real directory', () => {
    const base = mkdtempSync(join(tmpdir(), 'carve-blank-root-'))
    try {
      mkdirSync(join(base, '   '))
      writeFileSync(join(base, '   ', 'child.crv'), `${CHILD_MARKER}\n`)
      const result = expandFrom(base, '   ')
      expect(result.html).toBe('<p>{{ child.crv }}</p>')
      expect(result.html).not.toContain(CHILD_MARKER)
      expect(result.dependencies).toEqual([])
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('still honors an absolute root, from an unrelated working directory', () => {
    const base = mkdtempSync(join(tmpdir(), 'carve-blank-root-'))
    try {
      writeFileSync(join(base, 'child.crv'), `${CHILD_MARKER}\n`)
      const result = expandFrom(tmpdir(), base)
      expect(result.html).toContain(CHILD_MARKER)
      expect(result.warnings).toEqual([])
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})

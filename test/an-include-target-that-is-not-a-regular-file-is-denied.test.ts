import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { fileSystemResolver } from '../src/includes-fs.js'

const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'carve-js-include-special-')))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const ctx = { stack: [], depth: 0 }

describe('fileSystemResolver reads regular files only', () => {
  // A FIFO reports size 0, so the size cap passes it, and readFileSync then
  // blocks until a writer appears: the whole event loop stalls.
  it.skipIf(process.platform === 'win32')('denies a FIFO without opening it', () => {
    execFileSync('mkfifo', [path.join(root, 'pipe.crv')])
    for (const opts of [{}, { maxFileBytes: Infinity }]) {
      const resolved = fileSystemResolver(root, opts)('pipe.crv', ctx)
      expect(resolved).toEqual({ source: null, id: path.join(root, 'pipe.crv'), denial: 'denied' })
    }
  })

  it('denies a directory', () => {
    mkdirSync(path.join(root, 'chapter.crv'))
    const resolved = fileSystemResolver(root, { maxFileBytes: Infinity })('chapter.crv', ctx)
    expect(resolved).toEqual({ source: null, id: path.join(root, 'chapter.crv'), denial: 'denied' })
  })
})

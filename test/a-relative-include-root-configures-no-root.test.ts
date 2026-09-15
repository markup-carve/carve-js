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
 * markup-carve/carve#2004, merged as markup-carve/carve#2011: a configured
 * containment root MUST be absolute.
 *
 * Every row runs from a working directory that DOES contain the target, which
 * is the whole point: `realpathSync` resolves a relative spec against the
 * process working directory, so a spec this refuses is one that would
 * otherwise have worked - and worked by rooting containment at the value
 * section 19 forbids the root defaulting to.
 *
 * Where the named directory holds `child.crv` the marker in the HTML is the
 * signal; where it does not ("..", "sub/deeper") the empty warning list is,
 * because a resolver that was consulted and found nothing reports.
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

function withTree(body: (base: string) => void): void {
  const base = mkdtempSync(join(tmpdir(), 'carve-relative-root-'))
  try {
    writeFileSync(join(base, 'child.crv'), `${CHILD_MARKER}\n`)
    body(base)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
}

describe('a relative include root configures no root', () => {
  for (const spec of ['.', './', '..', 'sub', './sub', 'sub/deeper']) {
    it(`refuses ${JSON.stringify(spec)}, though the working directory holds the target`, () => {
      withTree((base) => {
        mkdirSync(join(base, 'sub', 'deeper'), { recursive: true })
        writeFileSync(join(base, 'sub', 'child.crv'), `${CHILD_MARKER}\n`)
        const result = expandFrom(base, spec)

        expect(result.html).toBe('<p>{{ child.crv }}</p>')
        expect(result.html).not.toContain(CHILD_MARKER)
        expect(result.dependencies).toEqual([])
        expect(result.warnings).toEqual([])
      })
    })
  }

  /**
   * The whitespace case falls out of absoluteness rather than needing a rule
   * of its own - `"   "` is a legal POSIX directory name, refused because it
   * is RELATIVE. carve-js#1690 refused it for being blank after trimming, and
   * that spelling could not tell the two readings apart.
   */
  it('refuses a whitespace-only spec, even where that names a real directory', () => {
    withTree((base) => {
      mkdirSync(join(base, '   '))
      writeFileSync(join(base, '   ', 'child.crv'), `${CHILD_MARKER}\n`)
      const result = expandFrom(base, '   ')

      expect(result.html).toBe('<p>{{ child.crv }}</p>')
      expect(result.dependencies).toEqual([])
    })
  })

  it('refuses a blank spec, as it did before', () => {
    withTree((base) => {
      const result = expandFrom(base, '')

      expect(result.html).toBe('<p>{{ child.crv }}</p>')
      expect(result.dependencies).toEqual([])
    })
  })

  /**
   * Without this the refusal could be blanket and pin nothing: the same tree
   * and the same target, named absolutely, still resolves.
   */
  it('honors the same directory named absolutely', () => {
    withTree((base) => {
      const result = expandFrom(base, base)

      expect(result.html).toContain(CHILD_MARKER)
      expect(result.warnings).toEqual([])
    })
  })

  /**
   * The spec constrains the ROOT, not what a front end computes before
   * handing one over. The CLI expands its own `--include-root` argument, so
   * the convenience survives the refusal.
   */
  it('a front end may expand a relative argument itself', () => {
    withTree((base) => {
      const previous = process.cwd()
      process.chdir(base)
      try {
        const resolver = fileSystemResolver(process.cwd())
        const result = expandIncludes(parse(SOURCE, { positions: true }), SOURCE, { resolve: resolver })

        expect(renderHtml(resolve(result.doc))).toContain(CHILD_MARKER)
      } finally {
        process.chdir(previous)
      }
    })
  })
})

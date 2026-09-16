import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expandIncludes, parse } from '../src/index.js'
import { fileSystemResolver } from '../src/includes-fs.js'

/**
 * PART 9 section 19 I11: an unresolved target's id is resolved against the
 * including file like a resolved one, and a path escaping the containment root
 * keeps the directive's spelling. The spec suite pins both as
 * `i11-fs-missing-target-below-the-root-names-where-it-would-appear` and
 * `i11-fs-escaping-target-below-the-root-keeps-its-spelling`; this is the same
 * pair against the local tree, so the behavior is gated whatever the spec pin
 * is at.
 */
const ENTRY = '{{ sub/frag.crv }}\n'

function expandTree(files: Record<string, string>, root: string): ReturnType<typeof expandIncludes> {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'carve-i11-')))
  try {
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(base, rel)
      mkdirSync(join(abs, '..'), { recursive: true })
      writeFileSync(abs, content)
    }
    const result = expandIncludes(parse(ENTRY, { positions: true }), ENTRY, {
      resolve: fileSystemResolver(join(base, root)),
      sourcePath: join(base, root === '.' ? 'main.crv' : `${root}/main.crv`),
    })
    return {
      ...result,
      dependencies: result.dependencies.map((d) => ({
        ...d,
        id: d.id.startsWith(base) ? `<TMP>${d.id.slice(base.length)}` : d.id,
      })),
    }
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
}

describe('an unresolved include names where the file would be', () => {
  it('names a missing target below the root by where it would appear', () => {
    const result = expandTree(
      { 'main.crv': ENTRY, 'sub/frag.crv': '{{ missing.crv }}\n' },
      '.',
    )

    expect(result.dependencies).toEqual([
      { id: '<TMP>/sub/frag.crv', resolved: true },
      { id: '<TMP>/sub/missing.crv', resolved: false },
    ])
  })

  /**
   * The scope limit. Resolving the id against the including file must not turn
   * an out-of-root refusal into one that reads as if it were inside.
   */
  it('keeps the directive spelling for a target that escapes the root', () => {
    const result = expandTree(
      {
        'root/main.crv': ENTRY,
        'root/sub/frag.crv': '{{ ../../secret.crv }}\n',
        'secret.crv': 'TOP SECRET\n',
      },
      'root',
    )

    expect(result.dependencies).toEqual([
      { id: '<TMP>/root/sub/frag.crv', resolved: true },
      { id: '../../secret.crv', resolved: false },
    ])
  })

  /** A target that is not there but would land outside the root is refused too. */
  it('keeps the directive spelling for a missing target outside the root', () => {
    const result = expandTree(
      { 'root/main.crv': ENTRY, 'root/sub/frag.crv': '{{ ../../gone.crv }}\n' },
      'root',
    )

    expect(result.dependencies).toEqual([
      { id: '<TMP>/root/sub/frag.crv', resolved: true },
      { id: '../../gone.crv', resolved: false },
    ])
  })
})

import { describe, it, expect } from 'vitest'
import { run, type CliIO } from '../src/cli.js'
import { migrateCaseOnlyReferences, carveToHtml } from '../src/index.js'

/*
 * CARVE-P9R-010: no name lookup folds case. `carve fmt --migrate` respells a
 * reference that misses its target only by case, but only when exactly one
 * target matches it case-insensitively.
 */
function makeIO(stdin: string, files: Record<string, string> = {}) {
  let out = ''
  const io: CliIO = {
    readStdin: async () => stdin,
    write: (s) => {
      out += s
    },
    writeErr: () => {},
    readFile: (p) => {
      if (!(p in files)) throw new Error(`ENOENT: ${p}`)
      return files[p]!
    },
    writeFile: (p, c) => {
      files[p] = c
    },
  }
  return {
    io,
    files,
    get out() {
      return out
    },
  }
}

describe('migrateCaseOnlyReferences', () => {
  it('respells a crossref to the one id it matches case-insensitively', () => {
    expect(migrateCaseOnlyReferences('# Getting Started\n\nSee </#getting-started>.\n')).toBe(
      '# Getting Started\n\nSee </#Getting-Started>.\n',
    )
  })

  it('respells a collapsed heading reference to the heading text', () => {
    const migrated = migrateCaseOnlyReferences('See [plan][].\n\n# Plan\n')
    expect(migrated).toBe('See [Plan][].\n\n# Plan\n')
    expect(carveToHtml(migrated)).toContain('<a href="#Plan">Plan</a>')
  })

  it('respells an explicit label to the definition label', () => {
    expect(migrateCaseOnlyReferences('[x][Label]\n\n[label]: /u\n')).toBe('[x][label]\n\n[label]: /u\n')
  })

  it('judges a crossref against the ids the heading-id options produce', () => {
    const source = '# Plan\n\nSee </#plan>.\n'
    expect(carveToHtml(source, { lowercaseHeadingIds: true })).toContain('<a href="#plan">Plan</a>')
    expect(migrateCaseOnlyReferences(source, { lowercaseHeadingIds: true })).toBe(source)
    expect(migrateCaseOnlyReferences('# Plan\n\nSee </#Plan>.\n', { lowercaseHeadingIds: true })).toBe(source)
    expect(migrateCaseOnlyReferences(source)).toBe('# Plan\n\nSee </#Plan>.\n')
  })

  it('judges a crossref against ASCII-folded ids', () => {
    const source = '# Café\n\nSee </#Cafe>.\n'
    expect(carveToHtml(source, { asciiHeadingIds: 'fold' })).toContain('href="#Cafe"')
    expect(migrateCaseOnlyReferences(source, { asciiHeadingIds: 'fold' })).toBe(source)
    expect(migrateCaseOnlyReferences('# Café\n\nSee </#cafe>.\n', { asciiHeadingIds: 'fold' })).toBe(source)
  })

  it('respells a reference image label like a link label', () => {
    const migrated = migrateCaseOnlyReferences('A ![b][Logo] here.\n\n[logo]: logo.png\n')
    expect(migrated).toBe('A ![b][logo] here.\n\n[logo]: logo.png\n')
    expect(carveToHtml(migrated)).toContain('<img src="logo.png" alt="b">')
  })

  it('respells a collapsed reference image to the definition label', () => {
    expect(migrateCaseOnlyReferences('![Logo][]\n\n[logo]: logo.png\n')).toBe('![logo][]\n\n[logo]: logo.png\n')
  })

  it('keeps use-site attributes on a respelled reference image', () => {
    const migrated = migrateCaseOnlyReferences('![b][Logo]{width=10} and ![Logo][]{.c}\n\n[logo]: logo.png\n')
    expect(migrated).toBe('![b][logo]{width=10} and ![logo][]{.c}\n\n[logo]: logo.png\n')
    expect(carveToHtml(migrated)).toContain('width="10"')
  })

  it('respells an image and a link in one paragraph', () => {
    expect(migrateCaseOnlyReferences('😀 ![b][Logo] and [x][Logo]\n\n[logo]: logo.png\n')).toBe(
      '😀 ![b][logo] and [x][logo]\n\n[logo]: logo.png\n',
    )
  })

  it('leaves a reference image with several case variants or a heading-only match', () => {
    const several = '![b][LOGO]\n\n[logo]: a.png\n[Logo]: b.png\n'
    expect(migrateCaseOnlyReferences(several)).toBe(several)
    const multiline = '![a][Lo\ngo]\n\n[lo go]: /a\n'
    expect(migrateCaseOnlyReferences(multiline)).toBe(multiline)
    const heading = '![plan][]\n\n# Plan\n'
    expect(migrateCaseOnlyReferences(heading)).toBe(heading)
  })

  it('does not rewrite when several ids match', () => {
    const source = '{#Tip}\n# A\n\n{#TIP}\n# B\n\nSee </#tip>.\n'
    expect(migrateCaseOnlyReferences(source)).toBe(source)
  })

  it('does not rewrite when several headings match a collapsed reference', () => {
    const source = '# Plan\n\n# PLAN\n\nSee [plan][].\n'
    expect(migrateCaseOnlyReferences(source)).toBe(source)
  })

  it('leaves a collapsed label carrying markup for the author', () => {
    const source = '# *bold* heading\n\nSee [*Bold* heading][].\n'
    expect(migrateCaseOnlyReferences(source)).toBe(source)
  })

  it('leaves exact and unrelated references alone', () => {
    const source = '# Plan\n\nSee </#Plan>, </#nope> and [Plan][].\n'
    expect(migrateCaseOnlyReferences(source)).toBe(source)
  })

  it('respells every reference in one pass, astral characters included', () => {
    expect(migrateCaseOnlyReferences('# 𝒜 Plan\n\n𝒜 </#𝒜-plan> and </#𝒜-plan>\n')).toBe(
      '# 𝒜 Plan\n\n𝒜 </#𝒜-Plan> and </#𝒜-Plan>\n',
    )
  })
})

describe('carve fmt --migrate', () => {
  it('migrates and formats stdin', async () => {
    const t = makeIO('# Plan\n\nSee </#plan>.\n')
    expect(await run(['fmt', '--migrate'], t.io)).toBe(0)
    expect(t.out).toBe('# Plan\n\nSee </#Plan>.\n')
  })

  it('leaves case-only misses alone without the flag', async () => {
    const t = makeIO('# Plan\n\nSee </#plan>.\n')
    expect(await run(['fmt'], t.io)).toBe(0)
    expect(t.out).toBe('# Plan\n\nSee </#plan>.\n')
  })

  it('rewrites files in place with --write', async () => {
    const t = makeIO('', { 'a.crv': 'See [plan][].\n\n# Plan\n' })
    expect(await run(['fmt', '--migrate', '-w', 'a.crv'], t.io)).toBe(0)
    expect(t.files['a.crv']).toBe('See [Plan][].\n\n# Plan\n')
  })
})

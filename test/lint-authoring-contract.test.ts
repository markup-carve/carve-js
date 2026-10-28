import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { lintCarve } from '../src/lint.js'
import { carveToHtml, lintAccessibility } from '../src/index.js'
import { run, type CliIO } from '../src/cli.js'

type Finding = { line: number; column: number; includes: string[] }
const vectors = JSON.parse(readFileSync(new URL('./fixtures/authoring-lint-3808.json', import.meta.url), 'utf8')) as {
  rules: { rule: string; vectors: { name: string; source: string; expected: { findings: Finding[] } }[] }[]
  suppression: { rule: string; file: string; vectors: { name: string; source: string; expected: [string, number][]; ignoredFiles?: string[] }[] }
}

for (const { rule, vectors: cases } of vectors.rules) describe(rule, () => {
  for (const vector of cases) it(vector.name, () => {
    const warnings = lintCarve(vector.source, { enabledRules: [rule] }).filter(w => w.rule === rule)
    expect(warnings.map(({ line, column }) => ({ line, column }))).toEqual(
      vector.expected.findings.map(({ line, column }) => ({ line, column })))
    for (let i = 0; i < warnings.length; i++) for (const word of vector.expected.findings[i]!.includes)
      expect(warnings[i]!.message.toLowerCase()).toContain(word.toLowerCase())
  })
})

describe('authoring lint suppression', () => {
  for (const vector of vectors.suppression.vectors) it(vector.name, () => {
    const warnings = lintCarve(vector.source, {
      fileId: vectors.suppression.file, ...(vector.ignoredFiles ? { ignoredFiles: vector.ignoredFiles } : {}),
    }).filter(w => w.rule === vectors.suppression.rule)
    expect(warnings.map(w => [w.rule, w.line])).toEqual(vector.expected)
    if (vector.name !== 'in-code-is-inert') expect(carveToHtml(vector.source)).not.toContain('carve-lint-')
  })

  it('keeps a next-line scope despite a document enable on the finding line', () => {
    const source = '# One\n%% carve-lint-disable-next-line heading-level-skip\n### Three %% carve-lint-enable\n'
    expect(lintCarve(source).filter(w => w.rule === 'heading-level-skip')).toEqual([])
  })

  it('uses the last document scope selecting each rule', () => {
    const source = '%% carve-lint-disable\n%% carve-lint-enable empty-link-destination\n[x]()\n\n[r]: /u\n'
    expect(lintCarve(source).map(w => w.rule)).toEqual(['empty-link-destination'])
  })

  it('accepts comma-separated rule ids and requires the ASCII space after %%', () => {
    expect(lintCarve('%% carve-lint-disable unused-link-reference-definition,empty-link-destination\n[r]: /u\n\n[x]()\n')).toEqual([])
    expect(lintCarve('%%carve-lint-disable\n[x]()\n').map(w => w.rule)).toContain('empty-link-destination')
  })

  it('leaves directives in raw content and delimited comments inert', () => {
    for (const comment of ['```=html\n%% carve-lint-disable\n```', '{% carve-lint-disable %}'])
      expect(lintCarve(`${comment}\n\n[x]()\n`).map(w => w.rule)).toContain('empty-link-destination')
  })

  it('keeps physical lines and offsets with CRLF and astral text', () => {
    const source = '😀\r\n\r\n%% carve-lint-disable-next-line empty-link-destination\r\n> [x]()\r\n\r\n[y]()\r\n'
    const warnings = lintCarve(source).filter(w => w.rule === 'empty-link-destination')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ line: 6, column: 1, start: source.indexOf('[y]()') })
  })
})

describe('authoring lint near misses', () => {
  it('keeps optional rules off by default', () => {
    for (const source of ['[here](/u)\n', '*Title*\n', '[a]: /u\n[b]: /u\n\n[x][a] [y][b]\n'])
      expect(lintCarve(source)).toEqual([])
  })

  it('counts image uses, normalized labels, and only winning definitions', () => {
    for (const source of ['[r]: /u\n\n![alt][ r ]\n', '[r]: /old\n[r]: /new\n\n[x][r]\n'])
      expect(lintCarve(source).filter(w => w.rule === 'unused-link-reference-definition')).toEqual([])
  })

  it('does not count a link in an unused footnote or unresolved reference', () => {
    for (const source of ['[r]: /u\n\n[^n]: [x][r]\n', '[r]: /u\n\n[[x][r]][missing]\n'])
      expect(lintCarve(source).filter(w => w.rule === 'unused-link-reference-definition')).toHaveLength(1)
    expect(lintCarve('[r]: /u\n\n[^n]: [x][r]\n\nuse[^n]\n')
      .filter(w => w.rule === 'unused-link-reference-definition')).toEqual([])
  })

  it('folds ASCII whitespace and honors specific accessible names and image alternatives', () => {
    const opts = { enabledRules: ['non-descriptive-link-text'] }
    expect(lintCarve('[ CLICK  HERE ](/u)\n', opts).filter(w => w.rule === 'non-descriptive-link-text')).toHaveLength(1)
    for (const source of ['[here](/u){ARIA-LABEL="Guide"}\n', '[![here](image)](/u)\n', '[here](/u){aria-label=" "}\n'])
      expect(lintCarve(source, opts).filter(w => w.rule === 'non-descriptive-link-text')).toEqual([])
  })

  it('uses decoded destinations and ignores invisible comments around emphasis', () => {
    expect(lintCarve('[a]: /x\\(a\\)\n[b]: /x(a)\n', { enabledRules: ['duplicate-reference-url'] })
      .filter(w => w.rule === 'duplicate-reference-url')).toHaveLength(1)
    expect(lintCarve('*Title* {% hidden %}\n', { enabledRules: ['emphasis-as-heading'] })
      .filter(w => w.rule === 'emphasis-as-heading')).toHaveLength(1)
  })
})

function capture(source: string, files: Record<string, string> = {}) {
  let output = ''
  let errors = ''
  const io: CliIO = {
    readStdin: async () => source, readFile: path => files[path] ?? '', writeFile: () => {},
    write: s => { output += s }, writeErr: s => { errors += s },
  }
  return { io, output: () => output, errors: () => errors }
}

describe('authoring lint CLI', () => {
  it('accepts optional rules and the heading input alias', async () => {
    const result = capture('[here](/u)\n\n# One\n### Three\n')
    expect(await run(['lint', '--json', '--rule', 'non-descriptive-link-text', '--rule', 'a11y/heading-jump'], result.io)).toBe(1)
    expect(JSON.parse(result.output()).map((w: { rule: string }) => w.rule)).toEqual(['non-descriptive-link-text', 'heading-level-skip'])
  })

  it('ignores only the exact requested file id', async () => {
    const result = capture('', { 'doc.crv': '[x]()\n', 'other.crv': '[y]()\n' })
    expect(await run(['lint', '--json', '--ignore', 'doc.crv', 'doc.crv', 'other.crv'], result.io)).toBe(1)
    expect(JSON.parse(result.output())).toMatchObject([{ file: 'other.crv', rule: 'empty-link-destination' }])
    expect(result.errors()).toBe('')
  })

  it('suppresses migration findings as well as semantic findings', async () => {
    const result = capture('%% carve-lint-disable\n**title**\n')
    expect(await run(['lint', '--json'], result.io)).toBe(0)
    expect(JSON.parse(result.output())).toEqual([])
  })
})

describe('authoring lint in included files', () => {
  const root = '[x]()\n\n{{ part.crv }}\n'
  const part = '[y]()\n\n{{ inner.crv }}\n'
  const files: Record<string, string> = { 'part.crv': part, 'inner.crv': '[z]()\n' }
  const includes = { resolve: (path: string) => files[path] ?? null, sourcePath: 'doc.crv' }

  it('ignores the root independently of its included files', () => {
    const findings = lintCarve(root, { includes, ignoredFiles: ['doc.crv'] })
      .filter(w => w.rule === 'empty-link-destination')
    expect(findings.map(w => w.file)).toEqual(['part.crv', 'inner.crv'])
  })

  it("ignores a child independently of that child's includes", () => {
    const findings = lintCarve(root, { includes, ignoredFiles: ['part.crv'] })
      .filter(w => w.rule === 'empty-link-destination')
    expect(findings.map(w => w.file ?? 'doc.crv')).toEqual(['doc.crv', 'inner.crv'])
  })

  it('keeps a root document scope from suppressing child diagnostics', () => {
    const findings = lintCarve('%% carve-lint-disable\n'+root, { includes })
      .filter(w => w.rule === 'empty-link-destination')
    expect(findings.map(w => w.file)).toEqual(['part.crv', 'inner.crv'])
  })

  it("uses the child's physical source lines for next-line scopes", () => {
    const findings = lintCarve('{{ part.crv }}\n', { includes: {
      sourcePath: 'doc.crv', resolve: () => '%% carve-lint-disable-next-line empty-link-destination\n[x]()\n\n[y]()\n',
    } }).filter(w => w.rule === 'empty-link-destination')
    expect(findings).toMatchObject([{ file: 'part.crv', line: 4 }])
    expect(findings).toHaveLength(1)
  })

  it('applies a document suppression to unresolved includes', () => {
    expect(lintCarve('%% carve-lint-disable\n{{ missing.crv }}\n', {
      includes: { sourcePath: 'doc.crv', resolve: () => null },
    })).toEqual([])
  })
})


it('uses canonical heading ids and suppression scopes in the accessibility API', () => {
  expect(lintAccessibility('# One\n\n### Three\n').map(w => w.rule)).toEqual(['heading-level-skip'])
  expect(lintAccessibility('%% carve-lint-disable a11y/heading-jump,a11y/image-alt\n# One\n\n### Three\n\n![](/map.png)\n')).toEqual([])
})


it('locates a reference definition after a quoted task marker', () => {
  const source = '> - [x] [r]: /u\n'
  const warnings = lintCarve(source).filter(w => w.rule === 'unused-link-reference-definition')
  expect(warnings).toHaveLength(1)
  expect(warnings[0]).toMatchObject({ line: 1, column: 9 })
  expect(source.slice(warnings[0]!.start)).toBe('[r]: /u\n')
})


it('ignores root include failures using the caller exact file id', () => {
  expect(lintCarve('{{ missing.crv }}\n', {
    fileId: 'doc.crv', ignoredFiles: ['doc.crv'],
    includes: { sourcePath: '/docs/doc.crv', resolve: () => null },
  })).toEqual([])
})

import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  expandIncludes,
  fileSystemResolver,
  parse,
  renderCarve,
  renderHtml,
  resolve,
  type IncludeOptions,
} from '../src/index.js'

function expand(
  source: string,
  files: Record<string, string>,
  options: Omit<IncludeOptions, 'resolve'> = {},
) {
  const doc = parse(source, { positions: true })
  const result = expandIncludes(doc, source, {
    ...options,
    resolve: (path) => files[path] ?? null,
  })
  return {
    ...result,
    html: renderHtml(resolve(result.doc)),
    carve: renderCarve(result.doc),
  }
}

describe('expandIncludes', () => {
  it('no resolver leaves include directives literal without warnings', () => {
    const source = 'See {{ child.crv }} here.'
    const doc = parse(source, { positions: true })
    const result = expandIncludes(doc, source)
    expect(result.warnings).toEqual([])
    expect(renderHtml(resolve(result.doc))).toBe('<p>See {{ child.crv }} here.</p>')
  })

  it('verbatim shielding keeps directives literal in fenced blocks and inline code spans', () => {
    const source = '```txt\n{{ child }}\n```\n\nUse `{{ child }}`.'
    const result = expand(source, { child: 'expanded' })
    expect(result.warnings).toEqual([])
    expect(result.html).toContain('{{ child }}')
    expect(result.html).not.toContain('expanded')
  })

  it('fragment containment keeps an unclosed child fence from swallowing parent content', () => {
    const result = expand('Before.\n\n{{ child }}\n\nAfter.', {
      child: '```js\nlet x = 1;',
    })
    expect(result.warnings).toEqual([])
    expect(result.html).toContain('<pre><code class="language-js">let x = 1;\n</code></pre>')
    expect(result.html).toContain('<p>After.</p>')
  })

  it('inline include of multi-block child warns and stays literal', () => {
    const result = expand('See {{ child }}.', { child: 'One.\n\nTwo.' })
    expect(result.warnings.map((w) => w.rule)).toEqual(['include-block-in-inline'])
    expect(result.html).toBe('<p>See {{ child }}.</p>')
  })

  it('cycle, depth, and budget limits warn and leave the directive literal', () => {
    const cycle = expand('{{ a }}', { a: '{{ b }}', b: '{{ a }}' })
    expect(cycle.warnings.map((w) => w.rule)).toContain('include-cycle')
    expect(cycle.html).toContain('{{ a }}')

    const depth = expand('{{ a }}', { a: '{{ b }}', b: 'done' }, { maxDepth: 1 })
    expect(depth.warnings.map((w) => w.rule)).toEqual(['include-depth'])
    expect(depth.html).toContain('{{ b }}')

    const budget = expand('{{ a }}', { a: 'too large' }, { maxBytes: 1 })
    expect(budget.warnings.map((w) => w.rule)).toEqual(['include-budget'])
    expect(budget.html).toBe('<p>{{ a }}</p>')
  })

  it('#section includes the selected heading subtree', () => {
    const result = expand('{{ child #pick }}', {
      child: '# A\n\nskip\n\n{#pick}\n# B\n\nyes\n\n## C\n\nmore\n\n# D\n\nskip',
    })
    expect(result.warnings).toEqual([])
    expect(result.html).toContain('<section id="pick">')
    expect(result.html).toContain('<h1>B</h1>')
    expect(result.html).toContain('<p>yes</p>')
    expect(result.html).toContain('<h2>C</h2>')
    expect(result.html).toContain('<p>more</p>')
    expect(result.html).not.toContain('skip')
  })

  it('@lines includes an inclusive physical line range', () => {
    const result = expand('{{ child @lines:2-3 }}', { child: 'skip\nOne\nTwo\nskip' })
    expect(result.warnings).toEqual([])
    expect(result.html).toBe('<p>One\nTwo</p>')
  })

  it('@shift shifts headings and warns when clamped', () => {
    const result = expand('{{ child @shift:1 }}', { child: '# A\n\n###### B' })
    expect(result.warnings.map((w) => w.rule)).toEqual(['include-heading-clamp'])
    expect(result.html).toContain('<h2>A</h2>')
    expect(result.html).toContain('<h6>B</h6>')
  })

  it('#section plus @lines warns and stays literal', () => {
    const source = '{{ child #x @lines:1-1 }}'
    const result = expand(source, { child: '# X' })
    expect(result.warnings.map((w) => w.rule)).toEqual(['include-selection-conflict'])
    // Literal means byte-identical to the no-resolver render, tag/mention
    // markup for #x and @lines included.
    expect(result.html).toBe(renderHtml(resolve(parse(source))))
    expect(result.html).not.toContain('<h1>')
  })

  it('renames duplicate child footnote labels and keeps each reference with its definition', () => {
    const result = expand('{{ a }}\n\n{{ b }}', {
      a: 'First[^a].\n\n[^a]: one',
      b: 'Second[^a].\n\n[^a]: two',
    })
    expect(result.warnings.map((w) => w.rule)).toEqual(['include-footnote-rename'])
    expect(result.html).toContain('First<a id="fnref1"')
    expect(result.html).toContain('Second<a id="fnref2"')
    expect(result.html).toContain('one')
    expect(result.html).toContain('two')
  })

  it('renames duplicate explicit heading ids deterministically', () => {
    const result = expand('{{ a }}\n\n{{ b }}', {
      a: '{#dup}\n# A',
      b: '{#dup}\n# B',
    })
    expect(result.warnings.map((w) => w.rule)).toEqual(['include-heading-id-rename'])
    expect(result.html).toContain('<section id="dup">')
    expect(result.html).toContain('<section id="dup-2">')
  })

  it('parent explicit ids win a collision and the child crossref follows the rename', () => {
    const result = expand('{{ a }}\n\n{#dup}\n# Parent', {
      a: '{#dup}\n# Child\n\nSee </#dup>.',
    })
    expect(result.warnings.map((w) => w.rule)).toEqual(['include-heading-id-rename'])
    expect(result.html).toContain('<section id="dup-2">')
    expect(result.html).toContain('href="#dup-2"')
  })

  it('detects a cycle through differing path spellings when the resolver supplies ids', () => {
    const files: Record<string, string> = { a: '{{ ./b }}', b: '{{ a }}' }
    const result = (() => {
      const source = '{{ a }}'
      const doc = parse(source, { positions: true })
      return expandIncludes(doc, source, {
        resolve: (path) => {
          const id = path.replace(/^\.\//, '')
          return files[id] === undefined ? null : { source: files[id], id }
        },
      })
    })()
    expect(result.warnings.map((w) => w.rule)).toContain('include-cycle')
  })

  it('fileSystemResolver resolves nested relative includes against the actual parent directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'carve-includes-'))
    try {
      mkdirSync(join(root, 'parts/chapters/sections'), { recursive: true })
      writeFileSync(join(root, 'main.crv'), '{{ parts/part.crv }}\n')
      writeFileSync(join(root, 'parts/part.crv'), '{{ chapters/ch.crv }}\n')
      writeFileSync(join(root, 'parts/chapters/ch.crv'), '{{ sections/leaf.crv }}\n')
      writeFileSync(join(root, 'parts/chapters/sections/leaf.crv'), 'Deep leaf.\n')
      const source = readFileSync(join(root, 'main.crv'), 'utf8')
      const doc = parse(source, { positions: true })
      const result = expandIncludes(doc, source, { resolve: fileSystemResolver(root) })
      expect(result.warnings).toEqual([])
      expect(renderHtml(resolve(result.doc))).toContain('<p>Deep leaf.</p>')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fileSystemResolver rejects symlink and dot-dot escapes from the root', () => {
    const base = mkdtempSync(join(tmpdir(), 'carve-includes-'))
    try {
      const root = join(base, 'root')
      mkdirSync(root, { recursive: true })
      writeFileSync(join(base, 'secret.crv'), 'TOP SECRET\n')
      symlinkSync(join(base, 'secret.crv'), join(root, 'link.crv'))
      const source = '{{ link.crv }}\n\n{{ ../secret.crv }}\n'
      const doc = parse(source, { positions: true })
      const result = expandIncludes(doc, source, { resolve: fileSystemResolver(root) })
      expect(result.warnings.map((w) => w.rule)).toEqual(['include-unresolved', 'include-unresolved'])
      expect(renderHtml(resolve(result.doc))).not.toContain('TOP SECRET')
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})

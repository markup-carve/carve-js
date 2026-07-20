import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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

  it('expands a directive mid-sentence and keeps the surrounding text', () => {
    const result = expand('Intro: {{ child }} tail.', { child: 'a /short/ fragment' })
    expect(result.warnings).toEqual([])
    expect(result.html).toBe('<p>Intro: a <em>short</em> fragment tail.</p>')
  })

  it('recognizes options the core split into tag and mention nodes', () => {
    const result = expand('{{ child #pick @shift:1 }}', { child: '{#pick}\n# B\n\nyes' })
    expect(result.warnings).toEqual([])
    expect(result.html).toContain('<h2>B</h2>')
  })

  it('leaves the reserved @shift:auto value unexpanded with a warning', () => {
    // Spec 19 I8 reserves "auto" for a future version: Carve headings are a
    // flat stream, so inferring the include-site level is deferred. Until it
    // is specified, a known key with a reserved value must degrade like any
    // other invalid option (I1/I7) rather than gain ad-hoc semantics here.
    const source = '{{ child @shift:auto }}'
    const result = expand(source, { child: '# Heading' })
    expect(result.warnings.map((w) => w.rule)).toEqual(['include-unknown-option'])
    expect(result.html).not.toContain('<h1>')
    expect(result.html).toBe(renderHtml(resolve(parse(source))))
  })

  it('warns on an unknown option and leaves the directive literal', () => {
    const source = '{{ child @nope:1 }}'
    const result = expand(source, { child: 'text' })
    expect(result.warnings.map((w) => w.rule)).toEqual(['include-unknown-option'])
    expect(result.html).toBe(renderHtml(resolve(parse(source))))
  })

  it('resolves a quoted path after the core rewrites it to typographic quotes', () => {
    const result = expand('{{ "my chapter.crv" }}', { 'my chapter.crv': 'spaced path body' })
    expect(result.warnings).toEqual([])
    expect(result.html).toBe('<p>spaced path body</p>')
  })

  it('reports a nested include chain as deduplicated dependencies', () => {
    const result = expand('{{ child }}', {
      child: 'Child.\n\n{{ grandchild }}',
      grandchild: 'Grandchild.',
    })
    expect(result.warnings).toEqual([])
    expect(result.dependencies).toEqual([
      { id: 'child', resolved: true },
      { id: 'grandchild', resolved: true },
    ])
  })

  it('reports a missing include target as an unresolved dependency', () => {
    const result = expand('{{ present }}\n\n{{ absent }}', { present: 'Here.' })
    expect(result.warnings.map((w) => w.rule)).toEqual(['include-unresolved'])
    expect(result.dependencies).toEqual([
      { id: 'present', resolved: true },
      { id: 'absent', resolved: false },
    ])
  })

  it('reports the same file included twice only once', () => {
    const result = expand('{{ child }}\n\n{{ child }}', { child: 'Body.' })
    expect(result.warnings).toEqual([])
    expect(result.dependencies).toEqual([{ id: 'child', resolved: true }])
  })

  it('reports no dependencies without a resolver', () => {
    const source = '{{ child }}'
    expect(expandIncludes(parse(source, { positions: true }), source).dependencies).toEqual([])
  })

  it('reports a containment-denied target as an unresolved dependency', () => {
    const base = mkdtempSync(join(tmpdir(), 'carve-includes-'))
    try {
      const root = join(base, 'root')
      mkdirSync(root, { recursive: true })
      writeFileSync(join(base, 'secret.crv'), 'TOP SECRET\n')
      writeFileSync(join(root, 'ok.crv'), 'Fine.\n')
      const source = '{{ ok.crv }}\n\n{{ ../secret.crv }}\n'
      const doc = parse(source, { positions: true })
      const result = expandIncludes(doc, source, { resolve: fileSystemResolver(root) })
      expect(result.warnings.map((w) => w.rule)).toEqual(['include-unresolved'])
      expect(result.dependencies).toEqual([
        { id: realpathSync(join(root, 'ok.crv')), resolved: true },
        { id: '../secret.crv', resolved: false },
      ])
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('fileSystemResolver allows a dot-dot path whose canonical target stays inside the root', () => {
    const root = mkdtempSync(join(tmpdir(), 'carve-includes-'))
    try {
      mkdirSync(join(root, 'chapters'), { recursive: true })
      mkdirSync(join(root, 'shared'), { recursive: true })
      writeFileSync(join(root, 'main.crv'), '{{ chapters/ch1.crv }}\n')
      writeFileSync(join(root, 'chapters/ch1.crv'), 'Chapter one.\n\n{{ ../shared/glossary.crv }}\n')
      writeFileSync(join(root, 'shared/glossary.crv'), 'Glossary body.\n')
      const source = readFileSync(join(root, 'main.crv'), 'utf8')
      const doc = parse(source, { positions: true })
      const result = expandIncludes(doc, source, {
        resolve: fileSystemResolver(root),
        sourcePath: join(root, 'main.crv'),
      })
      expect(result.warnings).toEqual([])
      const html = renderHtml(resolve(result.doc))
      expect(html).toContain('<p>Chapter one.</p>')
      expect(html).toContain('<p>Glossary body.</p>')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fileSystemResolver rejects a dot-dot chain that escapes the root', () => {
    const base = mkdtempSync(join(tmpdir(), 'carve-includes-'))
    try {
      const root = join(base, 'a/b/root')
      mkdirSync(root, { recursive: true })
      writeFileSync(join(base, 'secret.crv'), 'TOP SECRET\n')
      // Driven through the resolver directly: the core parses the "/../"
      // runs of a multi-level dot-dot path as emphasis, so such a directive
      // never forms in source and cannot exercise containment.
      const resolver = fileSystemResolver(root)
      const ctx = { stack: [], depth: 0 }
      expect(resolver('../../../secret.crv', ctx)).toBeNull()
      expect(resolver('../../..' + '/etc/passwd', ctx)).toBeNull()
      // The sibling-directory case stays allowed through the same resolver.
      mkdirSync(join(root, 'chapters'), { recursive: true })
      mkdirSync(join(root, 'shared'), { recursive: true })
      writeFileSync(join(root, 'shared/ok.crv'), 'OK BODY\n')
      expect(resolver('../shared/ok.crv', { stack: [join(root, 'chapters/ch.crv')], depth: 0 })).toEqual({
        source: 'OK BODY\n',
        id: join(root, 'shared/ok.crv'),
      })
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('rejects a single-level dot-dot escape written as a directive', () => {
    const base = mkdtempSync(join(tmpdir(), 'carve-includes-'))
    try {
      const root = join(base, 'root')
      mkdirSync(root, { recursive: true })
      writeFileSync(join(base, 'secret.crv'), 'TOP SECRET\n')
      const source = '{{ ../secret.crv }}\n'
      const doc = parse(source, { positions: true })
      const result = expandIncludes(doc, source, { resolve: fileSystemResolver(root) })
      expect(result.warnings.map((w) => w.rule)).toEqual(['include-unresolved'])
      expect(renderHtml(resolve(result.doc))).not.toContain('TOP SECRET')
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('fileSystemResolver rejects an escape through a symlinked directory component', () => {
    const base = mkdtempSync(join(tmpdir(), 'carve-includes-'))
    try {
      const root = join(base, 'root')
      mkdirSync(join(base, 'outside'), { recursive: true })
      mkdirSync(root, { recursive: true })
      writeFileSync(join(base, 'outside/secret.crv'), 'TOP SECRET\n')
      symlinkSync(join(base, 'outside'), join(root, 'linkdir'))
      const source = '{{ linkdir/secret.crv }}\n'
      const doc = parse(source, { positions: true })
      const result = expandIncludes(doc, source, { resolve: fileSystemResolver(root) })
      expect(result.warnings.map((w) => w.rule)).toEqual(['include-unresolved'])
      expect(renderHtml(resolve(result.doc))).not.toContain('TOP SECRET')
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('fileSystemResolver rejects an absolute path outside the root by default', () => {
    const base = mkdtempSync(join(tmpdir(), 'carve-includes-'))
    try {
      const root = join(base, 'root')
      mkdirSync(root, { recursive: true })
      writeFileSync(join(base, 'secret.crv'), 'TOP SECRET\n')
      const source = `{{ "${join(base, 'secret.crv')}" }}\n`
      const doc = parse(source, { positions: true })
      const result = expandIncludes(doc, source, { resolve: fileSystemResolver(root) })
      expect(result.warnings.map((w) => w.rule)).toEqual(['include-unresolved'])
      expect(renderHtml(resolve(result.doc))).not.toContain('TOP SECRET')
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('fileSystemResolver keeps the single top-level root for nested includes', () => {
    const root = mkdtempSync(join(tmpdir(), 'carve-includes-'))
    try {
      mkdirSync(join(root, 'chapters'), { recursive: true })
      mkdirSync(join(root, 'shared'), { recursive: true })
      // The chapter reaches a sibling folder: only possible if the root does
      // not re-base to the including file's directory.
      writeFileSync(join(root, 'main.crv'), '{{ chapters/ch1.crv }}\n')
      writeFileSync(join(root, 'chapters/ch1.crv'), '{{ ../shared/note.crv }}\n')
      writeFileSync(join(root, 'shared/note.crv'), 'Shared note.\n')
      const source = readFileSync(join(root, 'main.crv'), 'utf8')
      const doc = parse(source, { positions: true })
      const result = expandIncludes(doc, source, { resolve: fileSystemResolver(root) })
      expect(result.warnings).toEqual([])
      expect(renderHtml(resolve(result.doc))).toContain('<p>Shared note.</p>')
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

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

  describe('an empty or path-less run is not a directive', () => {
    // The maintainer ruled that "{{ }}", whitespace-only braces, and a run
    // that carries only a #section or an @option with no path are ORDINARY
    // literal text - no warning, no dependency - at expansion and formatting.
    // This pins behavior that until now existed only implicitly.
    const fmt = (source: string) => renderCarve(parse(source, { positions: true }))
    const cases: Array<[string, string]> = [
      ['empty braces', '{{ }}'],
      ['whitespace-only braces', '{{   }}'],
      ['section only, no path', '{{ #intro }}'],
      ['option only, no path', '{{ @lines:2-4 }}'],
    ]

    for (const [name, source] of cases) {
      it(`treats ${name} as literal text with no warning or dependency`, () => {
        const result = expand(source, { '': 'X', '#intro': 'X', '@lines:2-4': 'X' })
        expect(result.warnings).toEqual([])
        expect(result.dependencies).toEqual([])
        // The literal braces reach the rendered output verbatim.
        expect(result.html).toContain('{{')
        expect(result.html).toContain('}}')
      })

      it(`keeps ${name} literal across a format pass`, () => {
        // Not a directive, so fmt takes the ordinary escaping path rather than
        // the verbatim channel: the braces are emitted escaped, which renders
        // to the SAME literal text and is idempotent.
        const formatted = fmt(source)
        expect(fmt(formatted)).toBe(formatted)
        const before = renderHtml(resolve(parse(source, { positions: true })))
        const after = renderHtml(resolve(parse(formatted, { positions: true })))
        expect(after).toBe(before)
      })
    }
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

  it('a missing section keeps the dependency resolved and warns', () => {
    // Spec I11: `resolved` reflects only whether the source was READ. It was -
    // the section simply was not in it. Reporting unresolved here would
    // misdescribe a successful read as a failed one.
    const result = expand('{{ child #nope }}', { child: '# Real' })
    expect(result.warnings.map((w) => w.rule)).toEqual(['include-section'])
    expect(result.dependencies).toEqual([{ id: 'child', resolved: true }])
  })

  it('a depth-exceeded target stays unresolved because nothing was read', () => {
    // The dividing line for `resolved` is strictly "did a read happen": the
    // depth guard fires BEFORE the resolver is called, so nothing was read.
    const result = expand('{{ a }}', { a: '{{ b }}', b: 'Deep.' }, { maxDepth: 1 })
    expect(result.warnings.map((w) => w.rule)).toEqual(['include-depth'])
    expect(result.dependencies).toEqual([
      { id: 'a', resolved: true },
      { id: 'b', resolved: false },
    ])
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

  it('keeps a throwing resolver error text out of the warning message', () => {
    // Spec I7: the message must be processor-generated and name the failure
    // class. A filesystem resolver's own error routinely embeds an ABSOLUTE
    // path, and echoing it into rendered output discloses host layout.
    const secret = '/home/someone/private/vault/child.crv'
    const source = '{{ child.crv }}'
    const doc = parse(source, { positions: true })
    const result = expandIncludes(doc, source, {
      resolve: () => {
        throw new Error(`ENOENT: no such file or directory, open '${secret}'`)
      },
    })
    expect(result.warnings.map((w) => w.rule)).toEqual(['include-unresolved'])
    const warning = result.warnings[0]!
    expect(warning.message).toBe('Include "child.crv" could not be resolved.')
    expect(warning.message).not.toContain(secret)
    expect(warning.message).not.toContain('ENOENT')
    // The raw text is not discarded, just moved off the rendered channel.
    expect(warning.detail).toContain(secret)
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

describe('an include inside a heading expands and the id comes from the resolved text', () => {
  // The invariant (maintainer ruling): a heading whose text comes from an
  // expanded include is "as if the content were inline" - its auto id is the
  // slug of the FINAL, post-expansion heading text, computed after expansion
  // (and after any @shift), exactly like a normal heading. carve-js and
  // carve-rs agree byte-for-byte here. This whole case was untested, which is
  // why a stale mischaracterization of the behavior survived; these lock it.
  it('slugs a heading built entirely from an include off the resolved text', () => {
    const result = expand('# {{ title.crv }}', { 'title.crv': 'My Title' })
    expect(result.html).toContain('<h1>My Title</h1>')
    expect(result.html).toContain('<section id="My-Title">')
  })

  it('slugs a heading mixing prose and two includes off the full resolved text', () => {
    const result = expand('# a {{ x.crv }} b {{ y.crv }}', { 'x.crv': 'Xtext', 'y.crv': 'Ytext' })
    expect(result.html).toContain('<h1>a Xtext b Ytext</h1>')
    // The id is the slug of the POST-expansion text, not of the "{{ … }}" source.
    expect(result.html).toContain('<section id="a-Xtext-b-Ytext">')
  })

  it('slugs a heading with prose and one include off the resolved text', () => {
    const result = expand('# a {{ x.crv }} b', { 'x.crv': 'Xtext' })
    expect(result.html).toContain('<h1>a Xtext b</h1>')
    expect(result.html).toContain('<section id="a-Xtext-b">')
  })

  it('lets an explicit {#id} win over the resolved-text slug', () => {
    const result = expand('{#custom}\n# a {{ x.crv }} b', { 'x.crv': 'Xtext' })
    expect(result.html).toContain('<h1>a Xtext b</h1>')
    expect(result.html).toContain('<section id="custom">')
  })

  it('leaves a heading with no include byte-unchanged', () => {
    const withIncludes = expand('# plain heading no include', { 'x.crv': 'Xtext' })
    // Same document rendered with the include pipeline vs. plain resolve().
    const plain = renderHtml(resolve(parse('# plain heading no include', { positions: true })))
    expect(withIncludes.html).toBe(plain)
    expect(withIncludes.html).toContain('<section id="plain-heading-no-include">')
  })

  it('resolves a </#id> crossref into an expansion-sourced heading', () => {
    const result = expand('# {{ title.crv }}\n\nSee </#My-Title>.', { 'title.crv': 'My Title' })
    expect(result.html).toContain('<a href="#My-Title">My Title</a>')
  })

  it('keeps an unresolved directive literal in the heading and slugs that literal', () => {
    // Edge: no file resolves, so the directive is NOT expanded - it stays
    // literal text in the heading, and the id is the slug of that literal
    // (measured, not assumed). `expand(_, {})` serves an empty file map, so
    // every path misses -> the include-unresolved / literal path.
    const result = expand('# a {{ gone.crv }} b', {})
    expect(result.html).toContain('<h1>a {{ gone.crv }} b</h1>')
    expect(result.html).toContain('<section id="a-gone-crv-b">')
  })
})

/**
 * Coverage keyed to the normative include rules (spec 19, I1-I11). Rules also
 * exercised by the tests above are cross-referenced rather than duplicated.
 */
describe('include rules', () => {
  it('I1 syntax: a malformed value on a known option warns and stays literal', () => {
    const source = '{{ child @shift:x }}'
    const result = expand(source, { child: 'body' })
    expect(result.warnings.map((w) => w.rule)).toEqual(['include-unknown-option'])
    expect(result.html).toBe(renderHtml(resolve(parse(source))))
  })

  it('I1 syntax: an inverted line range warns and stays literal', () => {
    const source = '{{ child @lines:3-1 }}'
    const result = expand(source, { child: 'a\nb\nc' })
    expect(result.warnings.map((w) => w.rule)).toEqual(['include-unknown-option'])
    expect(result.html).toBe(renderHtml(resolve(parse(source))))
  })

  it('I2 block vs inline: a directive alone on a line merges as blocks', () => {
    const result = expand('{{ child }}', { child: '# Head\n\nBody.' })
    expect(result.warnings).toEqual([])
    expect(result.html).toContain('<h1>Head</h1>')
    expect(result.html).toContain('<p>Body.</p>')
  })

  it('I2 block vs inline: a directive inside a sentence merges as inline', () => {
    const result = expand('Before {{ child }} after.', { child: 'middle' })
    expect(result.warnings).toEqual([])
    expect(result.html).toBe('<p>Before middle after.</p>')
  })

  it('I3 resolver model: no resolver attempts no resolution at all', () => {
    const source = 'See {{ child }}.'
    const doc = parse(source, { positions: true })
    const result = expandIncludes(doc, source)
    expect(result.warnings).toEqual([])
    expect(result.dependencies).toEqual([])
    expect(renderHtml(resolve(result.doc))).toBe('<p>See {{ child }}.</p>')
  })

  it('I3 resolver model: a shielded directive is never handed to the resolver', () => {
    const calls: string[] = []
    const source = '`{{ child }}`\n\n```txt\n{{ child }}\n```'
    const doc = parse(source, { positions: true })
    expandIncludes(doc, source, {
      resolve: (p) => {
        calls.push(p)
        return 'expanded'
      },
    })
    expect(calls).toEqual([])
  })

  it('I5 collisions: reference-definition labels resolve per file without renaming', () => {
    // Divergence note: ids and footnote labels are renamed at merge time, but
    // reference definitions are resolved inside their own document before the
    // merge, so a label reused by parent and child keeps each file pointing at
    // its own target and no rename warning is emitted.
    const result = expand('Parent [p][ref].\n\n[ref]: https://parent.example\n\n{{ child }}', {
      child: 'Child [c][ref].\n\n[ref]: https://child.example',
    })
    expect(result.warnings).toEqual([])
    expect(result.html).toContain('href="https://parent.example"')
    expect(result.html).toContain('href="https://child.example"')
  })

  it('I6 limits: a file including itself is caught as a cycle', () => {
    const result = expand('{{ a }}', { a: 'Self.\n\n{{ a }}' })
    expect(result.warnings.map((w) => w.rule)).toEqual(['include-cycle'])
    expect(result.html).toContain('{{ a }}')
  })

  it('I7 errors: binary content warns and stays literal', () => {
    const source = '{{ child }}'
    const result = expand(source, { child: 'binary\u0000payload' })
    expect(result.warnings.map((w) => w.rule)).toEqual(['include-non-text'])
    expect(result.html).toBe(renderHtml(resolve(parse(source))))
    expect(result.html).not.toContain('payload')
  })

  it('I8 shift: a negative shift raises heading levels', () => {
    const result = expand('{{ child @shift:-1 }}', { child: '## A\n\n### B' })
    expect(result.warnings).toEqual([])
    expect(result.html).toContain('<h1>A</h1>')
    expect(result.html).toContain('<h2>B</h2>')
  })

  it('I8 shift: clamps at level 1, warns, and keeps the heading', () => {
    const result = expand('{{ child @shift:-2 }}', { child: '# A' })
    expect(result.warnings.map((w) => w.rule)).toEqual(['include-heading-clamp'])
    expect(result.html).toContain('<h1>A</h1>')
  })

  it('I8 shift: ids and slugs are unchanged so a crossref into a shifted heading resolves', () => {
    const result = expand('{{ child @shift:2 }}', { child: '# Alpha\n\nSee </#Alpha>.' })
    expect(result.warnings).toEqual([])
    expect(result.html).toContain('<h3>Alpha</h3>')
    expect(result.html).toContain('id="Alpha"')
    expect(result.html).toContain('href="#Alpha"')
  })

  it('I8 auto: no preceding heading gives C=0 and leaves levels alone', () => {
    const result = expand('{{ child @shift:auto }}', { child: '# Top\n\n## Sub' })
    expect(result.warnings).toEqual([])
    expect(result.html).toContain('<h1>Top</h1>')
    expect(result.html).toContain('<h2>Sub</h2>')
  })

  it('I8 auto: C=2 with child top level 1 shifts by 2', () => {
    const result = expand('# One\n\n## Two\n\n{{ child @shift:auto }}', { child: '# Top\n\n## Sub' })
    expect(result.warnings).toEqual([])
    expect(result.html).toContain('<h3>Top</h3>')
    expect(result.html).toContain('<h4>Sub</h4>')
  })

  it('I8 auto: uses the minimum child level, not the first heading', () => {
    // Child starts at h3 but contains an h2; T is the minimum, so the h2
    // becomes the child's top and the internal gap is preserved.
    const result = expand('# One\n\n{{ child @shift:auto }}', { child: '### Deep\n\n## Shallow' })
    expect(result.warnings).toEqual([])
    expect(result.html).toContain('<h3>Deep</h3>')
    expect(result.html).toContain('<h2>Shallow</h2>')
  })

  it('I8 auto: child without headings is a no-op and warns about nothing', () => {
    const result = expand('# One\n\n## Two\n\n{{ child @shift:auto }}', { child: 'Just a paragraph.' })
    expect(result.warnings).toEqual([])
    expect(result.html).toContain('<p>Just a paragraph.</p>')
  })

  it('I8 auto: composes with #section, using the selected subtree top level', () => {
    const result = expand('# One\n\n## Two\n\n{{ child #pick @shift:auto }}', {
      child: '# Skipped\n\n{#pick}\n## Picked\n\n### Under',
    })
    expect(result.warnings).toEqual([])
    expect(result.html).toContain('<h3>Picked</h3>')
    expect(result.html).toContain('<h4>Under</h4>')
    expect(result.html).not.toContain('Skipped')
  })

  it('I8 auto: a closed sibling container does not set the context level', () => {
    // The h2 lives inside a blockquote that has closed by the time the
    // directive is reached, so C falls back to the enclosing h1.
    const result = expand('# One\n\n> ## Quoted\n\n{{ child @shift:auto }}', { child: '# Top' })
    expect(result.warnings).toEqual([])
    expect(result.html).toContain('<h2>Top</h2>')
  })

  it('I8 auto: an enclosing container heading does set the context level', () => {
    const result = expand('# One\n\n::: note\n## Inner\n\n{{ child @shift:auto }}\n:::', { child: '# Top' })
    expect(result.warnings).toEqual([])
    expect(result.html).toContain('<h3 id="Top">Top</h3>')
  })

  it('I8 auto: resolves against the document as assembled under a numeric parent shift', () => {
    // Parent include shifts the child by 1, so the child h1 lands at h2; the
    // grandchild's auto must land one level below that, at h3.
    const result = expand('{{ child @shift:1 }}', {
      child: '# ChildTop\n\n{{ grand @shift:auto }}',
      grand: '# GrandTop',
    })
    expect(result.warnings).toEqual([])
    expect(result.html).toContain('<h2>ChildTop</h2>')
    expect(result.html).toContain('<h3>GrandTop</h3>')
  })

  it('I8 auto: counts headings a child contributes only through a nested include', () => {
    // The child has no headings of its own; everything comes from the
    // grandchild. Measuring before expansion would see none and no-op, leaving
    // the grandchild h1 under an h2.
    const result = expand('# One\n\n## Two\n\n{{ child @shift:auto }}', {
      child: '{{ grand }}',
      grand: '# GrandTop\n\n## GrandSub',
    })
    expect(result.warnings).toEqual([])
    expect(result.html).toContain('<h3>GrandTop</h3>')
    expect(result.html).toContain('<h4>GrandSub</h4>')
  })

  it('I8 auto: a stated parent shift still places a nested auto by the assembled level', () => {
    // The child is shifted by 1 explicitly and has no headings of its own, so
    // the grandchild's auto must key off the parent h1 as assembled, landing
    // at h2 rather than being pushed twice.
    const result = expand('# One\n\n{{ child @shift:1 }}', {
      child: '{{ grand @shift:auto }}',
      grand: '# GrandTop',
    })
    expect(result.warnings).toEqual([])
    expect(result.html).toContain('<h2>GrandTop</h2>')
  })

  it('I8 auto: a heading merged by an earlier include sets the context for a later one', () => {
    const result = expand('{{ first }}\n\n{{ second @shift:auto }}', {
      first: '# First\n\n## Deeper',
      second: '# SecondTop',
    })
    expect(result.warnings).toEqual([])
    expect(result.html).toContain('<h3>SecondTop</h3>')
  })

  it('I8 auto: is a no-op for an inline include, whose content has no headings', () => {
    const result = expand('# One\n\n## Two\n\nSee {{ child @shift:auto }} here.', { child: 'a fragment' })
    expect(result.warnings).toEqual([])
    expect(result.html).toContain('<p>See a fragment here.</p>')
  })

  it('I9 verbatim: a raw block keeps a directive literal', () => {
    const result = expand('```=html\n{{ child }}\n```', { child: 'EXPANDED' })
    expect(result.warnings).toEqual([])
    expect(result.html).toContain('{{ child }}')
    expect(result.html).not.toContain('EXPANDED')
  })

  it('I9 verbatim: a fence with an info string shields, a plain directive still expands', () => {
    const result = expand('```js\n{{ child }}\n```\n\n{{ child }}', { child: 'EXPANDED' })
    expect(result.warnings).toEqual([])
    expect(result.html).toContain('<code class="language-js">{{ child }}')
    expect(result.html).toContain('<p>EXPANDED</p>')
  })

  it('I4 source mapping: merged blocks currently keep the child file positions', () => {
    // Pinning actual behavior, not endorsing it: included blocks carry the
    // positions they had in the child source, so a host still cannot map a
    // location in the assembled document back to a file and offset. Warning
    // attribution is covered separately by the `file` field below; position
    // remapping is the remaining half of I4.
    const source = 'Parent.\n\n{{ child }}'
    const doc = parse(source, { positions: true })
    const result = expandIncludes(doc, source, { resolve: () => 'Child.' })
    expect(result.warnings).toEqual([])
    const positions = result.doc.children.map((b) => b.pos?.startOffset)
    expect(positions).toEqual([0, 0])
  })

  describe('I4 attribution: warnings name the file they arose in', () => {
    it('attributes an unresolvable directive to the top-level document', () => {
      const result = expand('{{ missing }}', {}, { sourcePath: 'book.crv' })
      expect(result.warnings.map((w) => [w.rule, w.file])).toEqual([
        ['include-unresolved', 'book.crv'],
      ])
    })

    it('attributes a warning raised while expanding a child to the child', () => {
      // The clamp happens on a heading that lives in child.crv, even though
      // the directive that pulled it in lives in the parent.
      const result = expand('{{ child.crv @shift:1 }}', { 'child.crv': '###### Deep' }, {
        sourcePath: 'book.crv',
      })
      expect(result.warnings.map((w) => [w.rule, w.file])).toEqual([
        ['include-heading-clamp', 'child.crv'],
      ])
    })

    it('attributes a grandchild warning to the grandchild, not an ancestor', () => {
      // Only the innermost file has a directive that fails, so attribution
      // must walk the whole chain rather than stopping at the root or at the
      // file that owns the outermost include.
      const result = expand(
        '{{ chapter.crv }}',
        {
          'chapter.crv': 'Chapter.\n\n{{ section.crv }}',
          'section.crv': 'Section.\n\n{{ missing.crv }}',
        },
        { sourcePath: 'book.crv' },
      )
      expect(result.warnings.map((w) => [w.rule, w.file])).toEqual([
        ['include-unresolved', 'section.crv'],
      ])
    })

    it('omits the file entirely when the top-level document has no sourcePath', () => {
      const result = expand('{{ missing }}', {})
      expect(result.warnings.map((w) => w.rule)).toEqual(['include-unresolved'])
      expect(result.warnings[0]!.file).toBeUndefined()
      expect('file' in result.warnings[0]!).toBe(false)
    })
  })
  describe('formatting preserves directives (spec I1)', () => {
    const fmt = (source: string) => renderCarve(parse(source, { positions: true }))

    it('emits a well-formed directive verbatim instead of escaping it', () => {
      expect(fmt('{{ chapter.crv }}')).toBe('{{ chapter.crv }}\n')
    })

    it('preserves a quoted path with spaces using PLAIN quotes', () => {
      // The core smart-quotes the delimiters before the serializer sees them.
      // carve-js resolves the curled form to the same path, so nothing broke
      // here, but the output must still be byte-identical to the input:
      // engines that accept only the plain form have to read a formatted
      // document the same way this one does.
      expect(fmt('{{ "my chapter.crv" }}')).toBe('{{ "my chapter.crv" }}\n')
    })

    it('keeps a quoted path naming the same file after a format', () => {
      // String equality alone would not catch a path that changed and still
      // looked plausible, so this asserts through an actual resolver.
      const files = { 'my chapter.crv': 'Chapter body.' }
      const source = '{{ "my chapter.crv" }}'
      const formatted = fmt(source)
      expect(fmt(formatted)).toBe(formatted)
      expect(expand(formatted.trim(), files).html).toBe(expand(source, files).html)
      expect(expand(formatted.trim(), files).dependencies).toEqual(
        expand(source, files).dependencies,
      )
    })

    it('preserves two quoted paths in one run with plain quotes', () => {
      expect(fmt('{{ "a b.crv" }} and {{ "c d.crv" }}')).toBe('{{ "a b.crv" }} and {{ "c d.crv" }}\n')
    })

    it('preserves a section selection', () => {
      expect(fmt('{{ chapter.crv #intro }}')).toBe('{{ chapter.crv #intro }}\n')
    })

    it('preserves a line range', () => {
      expect(fmt('{{ chapter.crv @lines:2-40 }}')).toBe('{{ chapter.crv @lines:2-40 }}\n')
    })

    it('preserves a stated shift', () => {
      expect(fmt('{{ chapter.crv @shift:+1 }}')).toBe('{{ chapter.crv @shift:+1 }}\n')
    })

    it('preserves an auto shift', () => {
      expect(fmt('{{ chapter.crv @shift:auto }}')).toBe('{{ chapter.crv @shift:auto }}\n')
    })

    it('preserves a directive that sits inside a sentence', () => {
      expect(fmt('See {{ chapter.crv }} for more.')).toBe('See {{ chapter.crv }} for more\\.\n')
    })

    it('keeps a directive in a code span or fenced block escaped exactly as the core produces it', () => {
      // Spec I9: code is where a directive is inert, so the serializer must not
      // "helpfully" unescape it there - the verbatim channels already round-trip.
      const span = fmt('Use `{{ chapter.crv }}` here.')
      expect(span).toBe('Use `{{ chapter.crv }}` here\\.\n')
      const fence = fmt('```txt\n{{ chapter.crv }}\n```')
      expect(fence).toBe('``` txt\n{{ chapter.crv }}\n```\n')
    })

    it('preserves two directives separated by prose', () => {
      // Every fixture used to carry a SINGLE directive, which made a
      // "first one only" defect invisible - carve-php had exactly that bug.
      expect(fmt('a {{ x.crv }} b {{ y.crv }} c')).toBe('a {{ x.crv }} b {{ y.crv }} c\n')
    })

    it('preserves three or more directives in one run', () => {
      expect(fmt('{{ a.crv }} p {{ b.crv }} q {{ c.crv }}')).toBe(
        '{{ a.crv }} p {{ b.crv }} q {{ c.crv }}\n',
      )
      expect(fmt('w {{ a.crv }} x {{ b.crv }} y {{ c.crv }} z {{ d.crv }}')).toBe(
        'w {{ a.crv }} x {{ b.crv }} y {{ c.crv }} z {{ d.crv }}\n',
      )
    })

    it('preserves adjacent directives with no prose between them', () => {
      expect(fmt('{{ a.crv }}{{ b.crv }}')).toBe('{{ a.crv }}{{ b.crv }}\n')
      expect(fmt('{{ a.crv }} {{ b.crv }}')).toBe('{{ a.crv }} {{ b.crv }}\n')
    })

    it('preserves a directive at the very start and one at the very end of a run', () => {
      expect(fmt('{{ a.crv }} middle prose {{ b.crv }}')).toBe(
        '{{ a.crv }} middle prose {{ b.crv }}\n',
      )
    })

    it('preserves multiple directives carrying #section and options', () => {
      // These parse into extra tag and mention nodes, so the run has to be
      // reassembled across node boundaries before the scan can see them.
      expect(fmt('a {{ x.crv #intro }} b {{ y.crv #outro }} c')).toBe(
        'a {{ x.crv #intro }} b {{ y.crv #outro }} c\n',
      )
      expect(fmt('a {{ x.crv @shift:1 }} b {{ y.crv @lines:2-4 }} c')).toBe(
        'a {{ x.crv @shift:1 }} b {{ y.crv @lines:2-4 }} c\n',
      )
      expect(fmt('{{ x.crv #intro @shift:auto }} p {{ y.crv @lines:1-2 }}')).toBe(
        '{{ x.crv #intro @shift:auto }} p {{ y.crv @lines:1-2 }}\n',
      )
    })

    it('escapes a shape-invalid run without disturbing valid ones around it', () => {
      expect(fmt('a {{ x.crv }} b {{ }} c {{ y.crv }} d')).toBe(
        'a {{ x.crv }} b \\{\\{ \\}\\} c {{ y.crv }} d\n',
      )
    })

    it('preserves directives across separate paragraphs and block positions', () => {
      const source =
        '{{ a.crv }}\n\nprose {{ b.crv }} prose\n\n> quoted {{ c.crv }} here\n\n- item {{ d.crv }} tail\n'
      expect(fmt(source)).toBe(source)
    })

    it('still escapes a run that is not shape-well-formed', () => {
      // No closing "}}" and an empty path token: neither is a directive at
      // all, so both keep the ordinary escaping path.
      expect(fmt('{{ oops')).toBe('\\{\\{ oops\n')
      expect(fmt('{{ }}')).toBe('\\{\\{ \\}\\}\n')
    })

    it('preserves a shape-well-formed directive with an invalid option', () => {
      // Escaping this would freeze a one-character typo into permanent
      // literal text and destroy the warning that explains it.
      expect(fmt('{{ chapter.crv @bogus:1 }}')).toBe('{{ chapter.crv @bogus:1 }}\n')
    })

    it('preserves a shape-well-formed directive with a malformed section', () => {
      expect(fmt('{{ chapter.crv #1bad }}')).toBe('{{ chapter.crv #1bad }}\n')
    })

    it('a preserved invalid-option directive still warns on re-parse', () => {
      // The point of preserving it: the diagnostic survives the format.
      const formatted = fmt('{{ chapter.crv @bogus:1 }}')
      const result = expand(formatted.trim(), { 'chapter.crv': 'Body.' })
      expect(result.warnings.map((w) => w.rule)).toContain('include-unknown-option')
    })

    it('keeps a quoted path with an embedded quote resolving after a format', () => {
      // The inner quote arrives unescaped in the AST; emitted bare, smart
      // typography would curl it on the next parse and change the path.
      const files = { 'a"b.crv': 'Body.' }
      const source = '{{ "a\\"b.crv" }}'
      const formatted = fmt(source)
      expect(fmt(formatted)).toBe(formatted)
      expect(expand(formatted, files).html).toBe(expand(source, files).html)
      expect(expand(formatted, files).html).toBe('<p>Body.</p>')
    })

    it('is idempotent over a document full of directives', () => {
      const source =
        '{{ a.crv }}\n\nSee {{ b.crv #intro }} and {{ "c d.crv" @shift:auto }}.\n\n```txt\n{{ e.crv }}\n```\n'
      const once = fmt(source)
      expect(fmt(once)).toBe(once)
    })

    it('expanding a formatted document matches expanding the original', () => {
      // The formatter's standing invariant - carveToHtml(fmt(x)) === carveToHtml(x)
      // - cannot see this bug: an escaped directive renders as the same literal
      // text, so the invariant holds while every include is silently destroyed.
      // The assertion that catches it is about INTENT: the formatted document
      // must still include the same content, with the same dependency set.
      const files = {
        'a.crv': '# Chapter\n\nBody.',
        'b.crv': 'inline bit',
        'c d.crv': '## Quoted path',
      }
      const source = '{{ a.crv }}\n\nSee {{ b.crv }} and here:\n\n{{ "c d.crv" @shift:auto }}'
      const original = expand(source, files)
      const formatted = expand(fmt(source), files)
      expect(formatted.html).toBe(original.html)
      expect(formatted.dependencies).toEqual(original.dependencies)
      expect(original.dependencies.map((d) => d.id)).toEqual(['a.crv', 'b.crv', 'c d.crv'])
      expect(original.html).toContain('Body.')
    })

    it('expanding a formatted document matches when one run holds several directives', () => {
      // The case above spreads its directives one per inline run, so a
      // "first directive in a run survives, the rest are escaped" defect
      // (carve-php had exactly that) would slip straight through it. Here
      // every form that shares a run is exercised at once: plain, sectioned,
      // optioned, quoted, and adjacent.
      const files = {
        'a.crv': 'A body.',
        'b.crv': 'B body.',
        'c.crv': '# Intro\n\nC intro.\n\n# Outro\n\nC outro.',
        'd.crv': 'D body.',
        'e f.crv': 'EF body.',
        'g h.crv': 'GH body.',
      }
      const source = [
        'start {{ a.crv }} mid {{ b.crv }} end',
        '',
        'sec {{ c.crv #Intro }} and {{ c.crv #Outro }} done',
        '',
        'opt {{ a.crv @shift:1 }} and {{ b.crv @lines:1-1 }} done',
        '',
        'quoted {{ "e f.crv" }} and {{ "g h.crv" }} done',
        '',
        '{{ a.crv }}{{ d.crv }}',
      ].join('\n')
      const original = expand(source, files)
      const formatted = expand(fmt(source), files)
      expect(formatted.html).toBe(original.html)
      expect(formatted.dependencies).toEqual(original.dependencies)
      // Guards the assertion itself: if preservation regressed to the first
      // directive per run, these later targets would drop out entirely.
      expect(original.dependencies.map((d) => d.id)).toEqual([
        'a.crv',
        'b.crv',
        'c.crv',
        'e f.crv',
        'g h.crv',
        'd.crv',
      ])
      expect(fmt(fmt(source))).toBe(fmt(source))
    })
  })

  describe('a rejected directive has no side effects', () => {
    /**
     * Byte-identity check: the document with the directive must render exactly
     * as the same document with that directive written as literal text from the
     * start. The control substitutes an inert placeholder for the directive and
     * puts the directive's own text back, so any difference elsewhere - a
     * suffixed heading id, a renamed footnote label - fails.
     */
    const expectNoSideEffects = (
      directive: string,
      rest: string,
      files: Record<string, string>,
      options: Omit<IncludeOptions, 'resolve'> = {},
    ) => {
      const withDirective = expand(`Text ${directive} text.\n\n${rest}`, files, options)
      const literal = expand(`Text PLACEHOLDER text.\n\n${rest}`, files, options)
      // The directive's own paragraph is left literal either way and renders
      // its tokens (a "#section" is a tag) differently from the placeholder;
      // everything AFTER it must be byte-identical.
      const tail = (html: string) => html.slice(html.indexOf('\n') + 1)
      expect(tail(withDirective.html)).toBe(tail(literal.html))
      expect(withDirective.html.split('\n')[0]).toContain(directive.slice(0, 9))
    }

    const later = '{{ later }}'
    const laterFiles = { later: '{#dup}\n# Later\n\nSee [^note].\n\n[^note]: Later note.' }

    it('an unresolvable include reserves nothing', () => {
      expectNoSideEffects('{{ missing }}', later, laterFiles)
    })

    it('a binary include reserves nothing', () => {
      expectNoSideEffects('{{ bin }}', later, { ...laterFiles, bin: 'a\0b' })
    })

    it('an include with both selections reserves nothing', () => {
      expectNoSideEffects('{{ child #s @lines:1-2 }}', later, {
        ...laterFiles,
        child: '{#dup}\n# S',
      })
    })

    it('a missing section reserves nothing', () => {
      expectNoSideEffects('{{ child #nope }}', later, {
        ...laterFiles,
        child: '{#dup}\n# S\n\nBody.',
      })
    })

    it('a cyclic include reserves nothing', () => {
      expectNoSideEffects('{{ a }}', later, {
        ...laterFiles,
        a: '{#dup}\n# A\n\n{{ a }}',
      })
    })

    it('a depth-exceeded include reserves nothing', () => {
      expectNoSideEffects(
        '{{ a }}',
        later,
        { ...laterFiles, a: '{#dup}\n# A\n\n{{ b }}', b: '{#dup2}\n# B' },
        { maxDepth: 0 },
      )
    })

    it('a size-exceeded include reserves nothing', () => {
      expectNoSideEffects(
        '{{ big }}',
        later,
        { ...laterFiles, big: `{#dup}\n# Big\n\n${'x'.repeat(200)}` },
        { maxBytes: 8 },
      )
    })

    it('an inline include of block content reserves no heading id', () => {
      // The found case: the rejected child never reaches the document, yet its
      // explicit id used to be claimed, suffixing the next legitimate heading.
      const result = expand('See {{ a }}.\n\n{{ later }}', {
        ...laterFiles,
        a: '{#dup}\n# A\n\nMore.',
      })
      expect(result.warnings.map((w) => w.rule)).toEqual(['include-block-in-inline'])
      expect(result.html).toContain('<section id="dup">')
      expect(result.html).not.toContain('dup-2')
      expectNoSideEffects('{{ a }}', later, { ...laterFiles, a: '{#dup}\n# A\n\nMore.' })
    })

    it('an inline include of block content reserves no footnote label', () => {
      const result = expand('See {{ a }}.\n\n{{ later }}', {
        ...laterFiles,
        a: 'One [^note].\n\nTwo.\n\n[^note]: Rejected note.',
      })
      expect(result.warnings.map((w) => w.rule)).toEqual(['include-block-in-inline'])
      expect(result.html).toContain('Later note.')
      expect(result.html).not.toContain('Rejected note.')
      expectNoSideEffects('{{ a }}', later, {
        ...laterFiles,
        a: 'One [^note].\n\nTwo.\n\n[^note]: Rejected note.',
      })
    })
  })
})

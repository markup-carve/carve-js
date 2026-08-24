import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { carveToAstJson, carveToCarve, carveToHtml, parse } from '../src/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const corpusDir = resolve(__dirname, '../spec/tests/corpus')

if (!existsSync(corpusDir)) {
  throw new Error(
    `Spec corpus not found at ${corpusDir}.\n` +
      `Did you initialize the submodule?\n` +
      `  git submodule update --init`,
  )
}

const cases = readdirSync(corpusDir)
  .filter((f) => f.endsWith('.crv'))
  .map((f) => basename(f, '.crv'))
  .sort()

/**
 * The comparable form of a published tree, for PART 11 §1's `parse(fmt(x)) ==
 * parse(x)`.
 *
 * §1 is equality of DOCUMENTS, not of JSON, so four differences that are not
 * differences of document are taken out first:
 *
 *  - `pos` and `srcByteLength`, which say where a node was written. The writer
 *    is allowed to move a node - that is most of what it does - and a §1 that
 *    read a moved node as a changed one could never hold for any writer.
 *  - `escaped_text` vs `text`. §1 has to forgive escaping or it contradicts
 *    §2, which requires the writer to ADD an escape wherever omitting it would
 *    change the re-parse. PART 11 §2's own "only if" half is what audits the
 *    escapes, and carve-php measures it separately for that reason.
 *  - ADJACENT TEXT RUNS, merged. One run or two is a slot-boundary artifact of
 *    where the escape fell, not a different document, and the renderers already
 *    coalesce them.
 *  - OBJECT KEY ORDER. JSON objects are unordered; the parser fills `attrs`
 *    slot by slot, so `{.c}{#i}` and its merged `{.c #i}` arrive with `id` and
 *    `classes` inserted in different orders while holding the same values. The
 *    author-visible order is carried by `attrs.order`, which compares
 *    verbatim.
 *
 * NOT INTO `attrs`. It holds named slots rather than nodes, and a `keyValues`
 * entry can be spelled `type`, `pos` or `srcByteLength` - descending would
 * rename or delete an ATTRIBUTE, and the order of `keyValues` and `classes` is
 * what the renderer emits. Its own four slot names are a fixed schema, so
 * sorting THOSE is safe; the values below them compare exactly as they came.
 * carve-php's `CarveFmtCorpusTest::canonical()` states the same exclusion.
 */
function canonicalTree(value: unknown): unknown {
  if (Array.isArray(value)) {
    const out: unknown[] = []
    for (const raw of value) {
      const child = canonicalTree(raw)
      const last = out.length > 0 ? out[out.length - 1] : null
      if (isTextRun(child) && isTextRun(last)) {
        last.value += child.value
        continue
      }
      out.push(child)
    }
    return out
  }
  if (value === null || typeof value !== 'object') return value

  const src: Record<string, unknown> = { ...(value as Record<string, unknown>) }
  delete src.srcByteLength
  delete src.pos
  if (src.type === 'escaped_text') src.type = 'text'

  const out: Record<string, unknown> = {}
  for (const key of Object.keys(src).sort()) {
    out[key] = key === 'attrs' ? sortedAttrSlots(src[key]) : canonicalTree(src[key])
  }
  return out
}

function isTextRun(node: unknown): node is { type: 'text'; value: string } {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return false
  const keys = Object.keys(node)
  return (
    keys.length === 2 &&
    keys.includes('type') &&
    keys.includes('value') &&
    (node as { type: unknown }).type === 'text'
  )
}

function sortedAttrSlots(attrs: unknown): unknown {
  if (attrs === null || typeof attrs !== 'object' || Array.isArray(attrs)) return attrs
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(attrs).sort()) out[key] = (attrs as Record<string, unknown>)[key]
  return out
}

const tree = (source: string): string => JSON.stringify(canonicalTree(carveToAstJson(source)))

describe('renderCarve corpus', () => {
  for (const name of cases) {
    const source = readFileSync(resolve(corpusDir, `${name}.crv`), 'utf8')

    it(`${name}: semantic`, () => {
      expect(carveToHtml(carveToCarve(source))).toBe(carveToHtml(source))
    })

    it(`${name}: idempotent`, () => {
      const formatted = carveToCarve(source)
      expect(carveToCarve(formatted)).toBe(formatted)
    })

    it(`${name}: parses cleanly`, () => {
      const formatted = carveToCarve(source)
      expect(() => parse(formatted)).not.toThrow()
      expect(() => parse(carveToCarve(formatted))).not.toThrow()
    })

    // PART 11 §1's OWN invariant, and the one the three above cannot see. §1a
    // says it in as many words: `to_html(fmt(x)) == to_html(x)` is "strictly
    // weaker", and "a writer satisfying only the HTML form still fails this
    // section". Two spellings that render alike are still two spellings - a
    // list whose tightness moves is invisible to the HTML whenever the item's
    // blocks sit inside a container, because a tight list's paragraph
    // suppression never reaches inside one.
    //
    // NO ALLOWLIST, deliberately. carve-php has asserted this over the same
    // 1370 documents with none (`CarveFmtCorpusTest::
    // testTheFormattedDocumentParsesToTheSameTree`), and an entry here would
    // silence the comparison whether or not the engine passed it.
    //
    // THE ONE EXEMPTION IS THE SPEC'S OWN, AND IT IS DERIVED, NOT LISTED. Where
    // the corpus ships a `<slug>.fmt` sidecar, the canonical form is the SPEC's
    // choice, and for corpus 411 that choice re-parses to a different tree: the
    // source is a lone image indented by one space, which PART 12 reads as a
    // paragraph, and the canonical form (markup-carve/carve#1673) dedents it to
    // column 0, where the same image is a promoted block image. The invariant
    // and the sidecar cannot both hold, and the sidecar is the spec speaking.
    // carve-rs and carve-php fail this same stricter assertion on the same two
    // documents; only the weaker `to_html(fmt(x)) == to_html(x)` half of PART 11
    // §1 is normative, and the `semantic` case above still asserts it here.
    //
    // The exemption reads the sidecar rather than naming a slug, so it cannot
    // drift, and it FAILS IN BOTH DIRECTIONS: the formatted tree must equal the
    // sidecar's tree exactly, and it must genuinely DIFFER from the source's -
    // so a document that starts round-tripping cleanly fails here and moves
    // back to the invariant rather than sitting in a silent carve-out.
    const sidecar = resolve(corpusDir, `${name}.fmt`)
    const canonical = existsSync(sidecar) ? readFileSync(sidecar, 'utf8') : undefined
    if (canonical !== undefined && tree(canonical) !== tree(source)) {
      it(`${name}: matches the spec's canonical form, which re-parses differently`, () => {
        expect(tree(carveToCarve(source))).toBe(tree(canonical))
        expect(
          tree(carveToCarve(source)),
          `${name} now round-trips: drop the sidecar exemption`,
        ).not.toBe(tree(source))
      })
    } else {
      it(`${name}: parses to the same tree`, () => {
        expect(tree(carveToCarve(source))).toBe(tree(source))
      })
    }
  }
})

describe('renderCarve targeted canonicalization', () => {
  it('collapses blank-line runs', () => {
    expect(carveToCarve('a\n\n\n\nb')).toBe('a\n\nb\n')
  })

  it('preserves the authored bullet marker (issue 286)', () => {
    // The marker is semantic (§11): normalizing `*` to `-` would merge
    // adjacent lists separated only by their bullet char.
    expect(carveToCarve('* a\n* b')).toBe('* a\n* b\n')
    expect(carveToCarve('- a\n- b')).toBe('- a\n- b\n')
  })

  it('sizes code fences around inner backticks', () => {
    expect(carveToCarve('```\na ``` b\n```')).toBe('````\na ``` b\n````\n')
  })

  it('preserves the author source order of attribute slots', () => {
    // Reordering slots would change the rendered HTML attribute order, breaking
    // the semantic-preserving invariant, so fmt keeps the source order verbatim.
    expect(carveToCarve('{k=v .cls #id}\n# Title')).toBe('{k=v .cls #id}\n# Title\n')
  })

  it('strips trailing whitespace while preserving nbsp', () => {
    // Three moves, and it is back where it started - worth recording, because
    // the middle one looks like a regression from here.
    //
    // It asserted `a` originally, and reached that answer for the WRONG reason:
    // the native `.trim()` counts NBSP as whitespace, so the NBSP-only line read
    // as blank, the line above it read as block-final, and its run was dropped
    // as a block-final run. Narrowing the blank-line test to space-and-tab
    // (carve#890) removed that accident, and the honest answer was then `a  `,
    // because the PARSER kept a run before a soft break and writing `a` would
    // have rendered a different document.
    //
    // carve#926 moves the parser: the run is dropped on EVERY content line, so
    // it is not in the tree for the writer to write, and `a` is right again -
    // now for the reason the assertion's name gives.
    expect(carveToCarve('a  \n\u00a0  \n')).toBe('a\n\u00a0\n')
  })

  it('keeps an invisible character that ends a block', () => {
    // The only place the writer's trim is REACHED: a line is trimmed at its end
    // only when the next line is blank or absent, so a character that ends the
    // last line of a block is the one input that can observe which characters
    // that trim removes. The corpus documents for carve#924 put each invisible
    // character on a line of its OWN, where the test never fires, so reverting
    // the trim to Unicode whitespace left all 1373 of them byte-identical and
    // the whole suite green. These eleven are what that mutation moves.
    for (const code of [0x0b, 0x0c, 0x1680, 0x2000, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000]) {
      const src = `a${String.fromCodePoint(code)}\n`
      expect(carveToCarve(src)).toBe(src)
      expect(carveToHtml(carveToCarve(src))).toBe(carveToHtml(src))
    }
  })

  it('keeps to_html(fmt(x)) == to_html(x) over a trailing run before an invisible line', () => {
    // The invariant the assertion above used to break. Kept separate from it so
    // a future narrowing of the written form has to answer this question too
    // rather than just moving the literal.
    for (const src of ['a  \n\u00a0  \n', 'a  \n\u200b\n', 'a\t\n\ufeff\n']) {
      expect(carveToHtml(carveToCarve(src))).toBe(carveToHtml(src))
    }
  })

  it('keeps soft breaks in a plain div that carries a line-block class', () => {
    // The `::: |` sugar forces hard breaks; a generic div with `.line-block`
    // must NOT be rewritten to it (that would turn soft breaks into <br>).
    const src = '{.line-block}\n:::\na\nb\n:::\n'
    const formatted = carveToCarve(src)
    expect(carveToHtml(formatted)).toBe(carveToHtml(src))
    expect(formatted).not.toContain('::: |')
  })

  it('round-trips a line-block sugar div via explicit hard breaks', () => {
    const src = '::: |\na\nb\n:::\n'
    const formatted = carveToCarve(src)
    expect(carveToHtml(formatted)).toBe(carveToHtml(src))
  })

  it('widens a container fence for its whole subtree, not the next level (issue 496)', () => {
    // A fence closes on an equal-or-longer bare fence, so an outer container
    // needs a fence wider than EVERY container below it, not just its direct
    // children: three levels deep, a one-level lookahead emitted `::::` for
    // both the outer and the middle fence and the middle stopped nesting.
    const src = '::::: a\n\n:::: b\n\n::: c\nX\n:::\n\n::::\n\n:::::\n'
    const formatted = carveToCarve(src)
    expect(carveToHtml(formatted)).toBe(carveToHtml(src))
    expect(carveToCarve(formatted)).toBe(formatted)
  })

  it('counts admonitions, divs and line blocks alike when widening a fence', () => {
    // The div's class rides a PRECEDING attribute line: an opener carrying
    // inline `{...}` is a paragraph, which would leave only two real levels.
    const src = ':::::: note\n\n{.wrap}\n:::::\n\n:::: |\na\nb\n::::\n\n:::::\n\n::::::\n'
    const formatted = carveToCarve(src)
    expect(carveToHtml(formatted)).toBe(carveToHtml(src))
    expect(carveToCarve(formatted)).toBe(formatted)
  })

  it('does not widen a fence for a container behind a prefix or indent', () => {
    // A container inside a blockquote, a list item or a definition body writes
    // its fence lines with that host's prefix or indent, so they cannot close
    // an ancestor fence. Widening for them would only make the source noisier.
    const hosts = [
      '::: outer\n\n- item\n\n  ::: inner\n  x\n  :::\n\n:::\n',
      '::: outer\n\n> ::: inner\n> x\n> :::\n\n:::\n',
      '::: outer\n\n:: term\n:  ::: inner\n   x\n   :::\n\n:::\n',
    ]
    for (const src of hosts) {
      const formatted = carveToCarve(src)
      expect(carveToHtml(formatted)).toBe(carveToHtml(src))
      expect(formatted.startsWith('::: outer')).toBe(true)
    }
  })

  it('emits Carve inline delimiters', () => {
    expect(carveToCarve('/i/ *b* _u_ ~s~ {^sup^} {,sub,} =mark=')).toBe(
      '/i/ *b* _u_ ~s~ {^sup^} {,sub,} =mark=\n',
    )
  })

  it('leaves a literal caret and a literal comma unescaped', () => {
    // `^sup^` / `,sub,` are plain text (no bare sup/sub delimiter), and PART 11
    // §2's test is whether omitting the escape changes the RE-PARSED AST. It
    // does not here, so neither character needs escaping. The caret used to be
    // escaped unconditionally, which §2 calls a defect rather than a safe
    // default: over-escaping is invisible to every gate the project runs - the
    // HTML matches and the round trip holds, and only the AST shows the
    // `escaped_text` node nobody wrote (carve#581).
    expect(carveToCarve('^sup^ ,sub, stays literal')).toBe('^sup^ ,sub, stays literal\n')
  })

  it('still escapes a caret where dropping it WOULD change the parse', () => {
    // A caret line after a resolvable image promotes the paragraph to a figure,
    // so there the escape is load-bearing and stays.
    expect(carveToCarve('![a](/u)\n\\^ cap')).toBe('![a](/u)\n\\^ cap\n')
  })

  it('keeps a quoted admonition title stable across fmt passes (issue 295)', () => {
    const src = '::: note "A titled call-out"\nBody.\n:::\n'
    const f1 = carveToCarve(src)
    const f2 = carveToCarve(f1)
    expect(f2).toBe(f1)
    expect(carveToHtml(f1)).toBe(carveToHtml(src))
  })

  it('keeps a code-fence header with a backslash stable across fmt passes (issue 295)', () => {
    const src = '``` php "src\\Auth.php"\ncode\n```\n'
    const f1 = carveToCarve(src)
    const f2 = carveToCarve(f1)
    expect(f2).toBe(f1)
    expect(carveToHtml(f1)).toBe(carveToHtml(src))
    expect(f1).toContain('"src\\Auth.php"')
  })

  it('escapes literal inline delimiter characters in text', () => {
    const src = String.raw`\* \\/ \[`
    const formatted = carveToCarve(src)
    expect(carveToHtml(formatted)).toBe(carveToHtml(src))
    expect(formatted).toContain(String.raw`\*`)
    expect(formatted).toContain(String.raw`\[`)
  })

  describe('verbatim content survives document normalization (issue 340)', () => {
    it('keeps trailing whitespace inside code-block content', () => {
      const src = '```\ntrailing   \nalso\t\t\n```\n'
      const f1 = carveToCarve(src)
      expect(f1).toBe(src)
      expect(carveToHtml(f1)).toBe(carveToHtml(src))
    })

    it('keeps blank-line runs inside code-block content', () => {
      const src = '```\na\n\n\n\nb\n```\n'
      const f1 = carveToCarve(src)
      expect(f1).toBe(src)
      expect(carveToHtml(f1)).toBe(carveToHtml(src))
    })

    it('keeps raw-block content byte-exact', () => {
      const src = '```=html\n<pre>x   \n\n\n\ny</pre>\n```\n'
      const f1 = carveToCarve(src)
      expect(f1).toBe(src)
      expect(carveToHtml(f1)).toBe(carveToHtml(src))
    })

    it('keeps blank lines and trailing spaces in frontmatter and block comments', () => {
      const src = '---\ntitle: X\n\n\n\nnote: kept\n---\n\n%%%\nc   \n\n\n\nd\n%%%\n\nbody\n'
      // The CONTENT is what this asserts. The OPENER is canonicalized to
      // `---yaml` (markup-carve/carve#977, PART 11 §6b), which is the one byte
      // difference from the source here.
      const canonical = src.replace('---\n', '---yaml\n')
      const f1 = carveToCarve(src)
      expect(f1).toBe(canonical)
      expect(carveToCarve(f1)).toBe(f1)
      expect(carveToHtml(f1)).toBe(carveToHtml(src))
    })

    it('code block with trailing-space + blank-line content stays stable inside a blockquote and a list', () => {
      for (const src of [
        '> ```\n> a   \n>\n>\n>\n> b\n> ```\n',
        '- item\n\n  ```\n  a   \n\n\n\n  b\n  ```\n',
      ]) {
        const f1 = carveToCarve(src)
        const f2 = carveToCarve(f1)
        expect(f2).toBe(f1)
        expect(carveToHtml(f1)).toBe(carveToHtml(src))
      }
    })
  })
})

describe('verbatim spans with surrounding spaces stay fmt-idempotent', () => {
  // A verbatim span whose content both begins and ends with a space is stripped
  // by one space on each side at parse; fmt must pad it back so the strip is
  // reversible. Applies to plain code spans, attributed ones, and inline
  // literals alike (all share the serializer).
  const cases = ['``  x  ``', '``  x  ``{.foo}', '!``  x  ``', '!`` x``', '!``x ``', '!``   ``']
  for (const src of cases) {
    it(`round-trips ${JSON.stringify(src)}`, () => {
      const once = carveToCarve(src)
      expect(carveToHtml(once)).toBe(carveToHtml(src)) // invariant
      expect(carveToCarve(once)).toBe(once) // idempotent
    })
  }
})

describe('all-space verbatim content is never stripped or padded', () => {
  // Regression: the strip skips content that consists ENTIRELY of spaces (the
  // CommonMark rule, and what the executable spec's codeText() does). Stripping
  // it produced an empty verbatim span, which has no representable Carve source
  // -- a bare `` `` `` reparses as a two-backtick opener -- so `!`  `` degraded
  // to `!``` and then to `\!```, changing the document on every fmt pass. The
  // serializer must mirror the parser and NOT pad all-space content either,
  // otherwise each pass grew the span by two spaces.
  const cases = [
    '` `',
    '`  `',
    '`   `',
    '!` `',
    '!`  `',
    '!`   `',
    '$` x `',
    '$`  `',
    '``  ``',
    '!``  ``',
    '`a b`',
    '` a `',
  ]
  for (const src of cases) {
    it(`round-trips ${JSON.stringify(src)}`, () => {
      const once = carveToCarve(src)
      expect(carveToHtml(once)).toBe(carveToHtml(src)) // invariant
      expect(carveToCarve(once)).toBe(once) // idempotent
    })
  }

  it('preserves all-space content verbatim rather than collapsing it', () => {
    // Two spaces must survive as two spaces; previously they stripped to empty.
    expect(carveToHtml('`  `')).toBe('<p><code>  </code></p>')
    expect(carveToHtml('`   `')).toBe('<p><code>   </code></p>')
    // ... while a non-all-space span still gets the single-space strip.
    expect(carveToHtml('` a `')).toBe('<p><code>a</code></p>')
  })

  it('keeps an all-space inline literal a literal across fmt', () => {
    // The bug turned this into an escaped bang plus an unclosed code span.
    expect(carveToCarve('!`  `').trim()).toBe('!`  `')
  })
})

describe('fmt keeps a heading on one line', () => {
  it('collapses a break inside an ingested heading instead of splitting it', async () => {
    // A heading ends at the newline (PART 2), so fmt must never emit a heading
    // whose text carries one. No parse builds such a heading, but PART 12 lets
    // an ingested AST put a break node in one; emitting it verbatim re-parsed
    // as a heading PLUS a paragraph, silently moving text out of the title.
    const { carveToAstJson, fromAstJson, renderCarve } = await import('../src/index.js')
    const j = carveToAstJson('# a b\n\npara x\ny\n')
    const heading = j.children.find((c) => c.type === 'heading')!
    const para = j.children.find((c) => c.type === 'paragraph')!
    heading.children = para.children
    const out = renderCarve(
      fromAstJson({ type: 'document', srcByteLength: 0, children: [heading] }),
    )
    expect(out).toBe('{#a-b}\n# para x y\n')
    expect(carveToHtml(out)).toBe('<section id="a-b">\n  <h1>para x y</h1>\n</section>')
  })

  it('keeps a literal backslash that sits before the collapsed break', async () => {
    // Only an ODD run of backslashes is a hard break's marker. Dropping one
    // unconditionally wrote `# a\\ b`, where the escape swallows the space and
    // the author's backslash disappears on re-parse.
    const { fromAstJson, renderCarve } = await import('../src/index.js')
    const doc = fromAstJson({
      type: 'document',
      srcByteLength: 0,
      children: [
        {
          type: 'heading',
          level: 1,
          children: [
            { type: 'text', value: 'a\\' },
            { type: 'soft_break' },
            { type: 'text', value: 'b' },
          ],
        },
      ],
    } as never)
    const out = renderCarve(doc)
    expect(out).toBe('# a\\\\ b\n')
    expect(carveToHtml(out)).toBe('<section id="a-b">\n  <h1>a\\ b</h1>\n</section>')
  })

  it('keeps the innermost content of a document nested at the parser cap', async () => {
    // The writer's recursion bound was the parser's own MAX_NESTING_DEPTH, so a
    // document nested at exactly the cap parsed fine and then wrote back with
    // its innermost block replaced by an empty line - `fmt` deleting content
    // with no error, and PART 11's semantic invariant broken at the boundary
    // (issue 517). All three engines shared the defect.
    const { MAX_NESTING_DEPTH } = await import('../src/parse.js')
    const src = '::: note\n'.repeat(MAX_NESTING_DEPTH) + 'body\n'
    expect(carveToHtml(src)).toContain('<p>body</p>')

    const written = carveToCarve(src)
    expect(written).toContain('body')
    expect(carveToHtml(written)).toBe(carveToHtml(src))
  })

  it('REFUSES a hand-built AST deeper than any parse can reach', async () => {
    // Raising the bound must not retire it: the guard is there for ASTs that
    // did not come from the parser, which can nest without limit.
    //
    // §25: AT THE RENDER CEILING, A RENDERER REFUSES. This used to truncate -
    // emit the nested markers and delete the body - which is the worse half of
    // the two failure modes even though it looks tidier: this is the CANONICAL
    // WRITER, so a tree built through the API came back as a document whose
    // body was gone, with nothing in the return value to say so (carve#526).
    const { renderCarve, RenderDepthError } = await import('../src/index.js')
    const build = (depth: number): unknown => {
      let node: unknown = { type: 'paragraph', children: [{ type: 'text', value: 'body' }] }
      for (let i = 0; i < depth; i++) node = { type: 'admonition', kind: 'note', children: [node] }
      return { type: 'doc', children: [node] }
    }
    expect(() => renderCarve(build(50_000) as never)).toThrow(RenderDepthError)
    expect(() => renderCarve(build(1_000) as never)).toThrow(RenderDepthError)
    // The failure names the bound rather than being whatever the host raises
    // when the stack runs out.
    expect(() => renderCarve(build(1_000) as never)).toThrow(/render cap of 232/)
  })
})

import { describe, expect, it } from 'vitest'

import {
  carveToHtml,
  codeGroup,
  htmlToAst,
  htmlToCarve,
  parse,
  renderCarve,
  tabs,
} from '../src/index.js'
import type { Admonition, BlockNode, Document } from '../src/ast.js'

/**
 * A CONTAINER THE RENDERER WROTE COMES BACK AS THAT CONTAINER
 * (markup-carve/carve-js#1316, markup-carve/carve#1502).
 *
 * `renderAdmonition` sends an `admonition` node to one of two shapes: a Tier-1
 * kind becomes `<aside class="admonition {kind}">`, every other kind becomes
 * `<div class="{kind}">`. The import is that mapping read backwards, so a tab
 * set, a code group, a panel and a callout all survive - and so does the next
 * container an extension invents, which is the half a list of names would have
 * gone on losing.
 *
 * WHY THE ASSERTION IS ON NODE KINDS AND NOT ON BYTES
 * (markup-carve/carve-js#1295). Every input below re-renders to byte-identical
 * HTML with the defect present: an unwrapped `<aside>` gives back the same
 * `<p>` it went in as, and a `<div class="tabs">` kept as a `div` node carrying
 * a `.tabs` class renders `<div class="tabs">` again. An HTML-to-HTML check
 * therefore reports success while the callout has stopped being a callout. The
 * node is the only place the loss is visible, so the node is what is measured.
 */

/** Every `type` in the tree, in document order - the unit #1295 requires. */
function kinds(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) kinds(child, out)
    return out
  }
  if (!node || typeof node !== 'object') return out
  const record = node as Record<string, unknown>
  if (typeof record.type === 'string') out.push(record.type)
  for (const slot of ['children', 'target', 'caption', 'title']) {
    if (record[slot]) kinds(record[slot], out)
  }
  return out
}

const extensions = [tabs(), codeGroup()]

describe('an imported container comes back as the container', () => {
  /*
   * THE FOUR CONSTRUCTS carve-js#1316 MEASURED, minus the endnotes section.
   *
   * The ticket listed endnotes as the fourth loss and named carve-php's
   * `[^1]: n` as the answer. It is not one: an endnotes section with no
   * reference to it imports there as an ORPHAN definition, and an orphan
   * footnote definition renders to the empty string, so the note's text is
   * deleted by the import and nothing is reported. This engine keeps that
   * content visible, and already rebuilds the footnote when a `doc-noteref`
   * reference is present - which is the shape a rendered document has. The
   * endnotes row is therefore pinned as it stands, at the end of this file.
   */
  const containers: Array<[string, string, string[]]> = [
    ['a Tier-1 callout', '::: note\nbody\n:::\n', ['note']],
    ['a tab set and its panel', '::: tabs\n:::: tabs-panel\na\n::::\n:::\n', ['tabs', 'tabs-panel']],
    ['a code group', '::: code-group\nx\n:::\n', ['code-group']],
    ['a container no extension claims', '::: sidebar\nx\n:::\n', ['sidebar']],
  ]

  for (const [label, source, expectedKinds] of containers) {
    it(`rebuilds ${label} from its own rendered HTML`, () => {
      const before = parse(source, { extensions })
      const html = carveToHtml(source, { extensions })
      const after = htmlToAst(html).value

      // The node, not the bytes: `admonition` survives as `admonition`.
      expect(kinds(after)).toEqual(kinds(before))
      expect(admonitionKinds(after)).toEqual(expectedKinds)
      // And the whole document comes back as the source it was rendered from.
      expect(htmlToCarve(html).value).toBe(source)
    })
  }

  it('does not bake the callout name the renderer derived into the source', () => {
    /*
     * PART 9 §16a, and a rule this engine could not apply until the callout
     * survived the import: with the `<aside>` unwrapped there was no element
     * left to read a name off. A kept `aria-label="Note"` is indistinguishable
     * from an authored one, so the author-wins rule makes it WIN on every later
     * render - the document is permanently unlocalizable while no byte of
     * today's output moves, which is why the assertion is ABSENCE and not a
     * round trip.
     */
    const html = carveToHtml('::: note\nbody\n:::\n')
    expect(html).toContain('aria-label="Note"')
    expect(htmlToCarve(html).value).not.toContain('aria-label')

    // The re-rendered document still answers to a `labels` map, which is the
    // whole of what the drop buys.
    const reimported = htmlToCarve(html).value
    expect(carveToHtml(reimported, { labels: { admonitionNote: 'Hinweis' } })).toContain(
      'aria-label="Hinweis"',
    )
  })

  it('keeps a callout name that is not the one the renderer derives', () => {
    // The near-miss control: the rule is value-matched, so a name that differs
    // is the author's and survives.
    expect(
      htmlToCarve('<aside class="admonition note" aria-label="Heads up"><p>x</p></aside>').value,
    ).toContain('aria-label="Heads up"')
  })

  it('is written as source the formatter already agrees with', () => {
    // The spec's own rule for an importer: it emits the source `carve fmt`
    // emits, which is also what lets a shared fixture compare byte-for-byte.
    for (const [, source] of containers) {
      const imported = htmlToCarve(carveToHtml(source, { extensions })).value
      expect(imported).toBe(renderCarve(parse(imported, { extensions })))
    }
  })

  it('reports nothing, because nothing was lost', () => {
    const html = carveToHtml('::: note\nbody\n:::\n', { extensions })
    expect(htmlToCarve(html).report.diagnostics).toEqual([])
  })

  /*
   * THE GUARD, and it is the writer's own rule rather than a copy of it. A
   * fence opener reads its type word as `[a-zA-Z_][\w-]*`, so a class outside
   * that shape cannot be the fence word: written there it would read back as a
   * paragraph, and the element would lose both its class and its structure.
   * Such a div keeps the generic node, where the class survives as a class.
   */
  it('keeps a class a fence opener cannot spell as a class', () => {
    const result = htmlToCarve('<div class="2col"><p>x</p></div>')
    expect(result.value).toBe('{.2col}\n:::\nx\n:::\n')
    expect(kinds(htmlToAst('<div class="2col"><p>x</p></div>').value)).toContain('div')
  })

  it('leaves an aside that is not a callout unwrapped', () => {
    // The class PAIR is what marks a rendered callout. A bare `<aside>` is
    // somebody else's sidebar and keeps the unwrap it has always had.
    const result = htmlToCarve('<aside><p>x</p></aside>')
    expect(result.value).toBe('x\n')
    expect(result.report.diagnostics.map((d) => d.code)).toContain('element-unwrapped')
  })

  it('keeps an extra class beside the name it consumed', () => {
    // The structural class becomes the fence word and is NOT kept beside it:
    // the renderer writes it back from the kind, so keeping it would emit
    // `class="tabs tabs"` on the next render.
    expect(htmlToCarve('<div class="tabs extra"><p>x</p></div>').value).toBe(
      '{.extra}\n::: tabs\nx\n:::\n',
    )
  })

  /*
   * THE TITLED SHAPE, which only became reachable once the aside survived.
   * carve-rs pinned this as `an_admonition_title_id_never_reaches_source_
   * because_the_aside_is_unwrapped` and said in place that the family lands the
   * day the aside does. It has landed.
   */
  it('lifts the title paragraph into the container it names', () => {
    const source = '::: note "A"\nx\n:::\n'
    const html = carveToHtml(source)
    expect(html).toContain('<p class="admonition-title" id="adm-1">A</p>')

    const result = htmlToCarve(html)
    expect(result.value).toBe(source)
    // Left in the body it would be written back as an ordinary paragraph
    // carrying the renderer's own class, which renders a SECOND title element
    // on the next pass.
    expect(result.value).not.toContain('admonition-title')
    expect(result.report.diagnostics).toEqual([])
  })

  it('drops the aria-labelledby that pointed at the lifted title', () => {
    // A DANGLING reference otherwise: the paragraph it names becomes the
    // container's title and stops being an element with an id
    // (markup-carve/carve-php#1542).
    const imported = htmlToCarve(carveToHtml('::: note "A"\nx\n:::\n')).value
    expect(imported).not.toContain('aria-labelledby')
    expect(imported).not.toContain('adm-1')
  })

  /*
   * THE TITLE IS MARKED BY ITS CLASS, NOT BY THE GENERATED ID.
   *
   * `renderAdmonition` emits `id="adm-N"` only for a CANONICAL kind with no
   * authored name, so both shapes below render a BARE
   * `<p class="admonition-title">`. Keying the lift on the id left their titles
   * in the body, written back as an ordinary paragraph carrying the renderer's
   * own class - the container came back title-less and one paragraph longer.
   * carve-php reads the class here too.
   */
  const untitledId: Array<[string, string]> = [
    ['a container that is not a Tier-1 kind', '::: sidebar "A"\nx\n:::\n'],
    ['a callout whose name the author wrote', '{aria-label=Mine}\n::: note "A"\nx\n:::\n'],
  ]

  for (const [label, source] of untitledId) {
    it(`lifts the title of ${label}, which renders with no id`, () => {
      const html = carveToHtml(source)
      expect(html).toContain('<p class="admonition-title">')
      expect(html).not.toContain('id="adm-')
      expect(htmlToCarve(html).value).toBe(source)
    })
  }

  it('keeps an authored name on a titled container', () => {
    // The rule stays value-matched. An `aria-labelledby` that names something
    // other than this container's own counted title is the author's.
    const imported = htmlToCarve(
      '<aside class="admonition note" aria-labelledby="elsewhere"><p>x</p></aside>',
    ).value
    expect(imported).toContain('aria-labelledby=elsewhere')
  })

  it('keeps an endnotes section visible when nothing references it', () => {
    /*
     * PINNED AGAINST carve-php's ANSWER, which loses the content. Importing
     * this to `[^1]: n` produces a definition no reference reaches, and an
     * unreferenced definition renders to the empty string - so the note's text
     * leaves the document silently. Degrading to the `<hr>` and `<ol>` the
     * section is built from keeps every byte the reader could see.
     */
    const result = htmlToCarve(
      '<section role="doc-endnotes"><hr><ol><li id="fn1"><p>n</p></li></ol></section>',
    )
    expect(result.value).toContain('n')
    expect(carveToHtml(result.value)).not.toBe('')
  })
})

/** The `kind` of every admonition in the tree, in document order. */
function admonitionKinds(document: Document): string[] {
  const found: string[] = []
  const walk = (nodes: BlockNode[]): void => {
    for (const node of nodes) {
      if (node.type === 'admonition') {
        found.push((node as Admonition).kind)
        walk((node as Admonition).children)
      }
    }
  }
  walk(document.children)
  return found
}

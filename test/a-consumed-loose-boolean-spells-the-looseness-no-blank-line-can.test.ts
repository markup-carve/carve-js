import { describe, expect, it } from 'vitest'
import {
  carveToCarve,
  carveToHtml,
  carveToAstJson,
  fromAstJson,
  parse,
  renderCarve,
  renderHtml,
} from '../src/index.js'

const h = (s: string) => carveToHtml(s)
const fmt = (s: string) => carveToCarve(s)

/**
 * PART 9 §17 L7 (`markup-carve/carve#1612`, `markup-carve/carve#1623`,
 * `markup-carve/carve-js#1401`).
 *
 * A container's preceding BLOCK-ATTRIBUTE LINE may carry the boolean `loose`.
 * It says the container's children render as BLOCKS rather than as inline runs,
 * and it is CONSUMED: it never reaches the output as an HTML attribute. The
 * precedent is PART 12 §15's `header-rows`, which rides the same line, carries a
 * structural fact as a boolean, and is likewise consumed rather than emitted.
 *
 * The key reaches the shapes a blank line cannot spell, because a blank line
 * needs two things to stand between:
 *
 *   - a ONE-ITEM list has no "between items" to put one in;
 *   - a definition description holding ONE block has none at ANY entry count,
 *     since a blank line between two ENTRIES does not loosen a `<dl>` at all.
 */
describe('the consumed `loose` boolean', () => {
  it('loosens a one-item list and does not reach the output', () => {
    expect(h('{loose}\n- Note text.\n')).toBe(
      '<ul>\n  <li><p>Note text.</p></li>\n</ul>',
    )
  })

  it('loosens a one-block definition description', () => {
    expect(h('{loose}\n:: Term\n:  Definition.\n')).toBe(
      '<dl>\n  <dt>Term</dt>\n  <dd><p>Definition.</p></dd>\n</dl>',
    )
  })

  // CONSUMPTION IS ITS OWN ASSERTION. A fixture that only checks the container
  // is loose passes with `loose=""` still on the tag, because the `<p>` and the
  // stray attribute are independent. Both halves are asserted, on both
  // containers, so neither can be bought by breaking the other.
  it('emits no `loose` attribute on the list', () => {
    expect(h('{loose}\n- Note text.\n')).not.toContain('loose')
  })

  it('emits no `loose` attribute on the definition list', () => {
    expect(h('{loose}\n:: Term\n:  Definition.\n')).not.toContain('loose')
  })

  it('consumes only `loose`, keeping the id and the classes beside it', () => {
    expect(h('{#i loose .note}\n- x\n')).toBe(
      '<ul id="i" class="note">\n  <li><p>x</p></li>\n</ul>',
    )
  })

  // PART 4 makes `{loose}` and `{loose=""}` the SAME attribute, so both are this
  // key. `loose=x` names a value the key does not take, so it is not this key at
  // all: it stays an ordinary attribute and renders. There is no error state.
  it('reads the empty value as the same key', () => {
    expect(h('{loose=""}\n- x\n')).toBe('<ul>\n  <li><p>x</p></li>\n</ul>')
  })

  it('leaves a valued `loose` an ordinary attribute', () => {
    expect(h('{loose=x}\n- x\n')).toBe('<ul loose="x">\n  <li>x</li>\n</ul>')
  })

  // THE NAME IS RESERVED NOWHERE ELSE. The tight/loose axis exists in exactly two
  // containers, so on anything else `loose` has no special meaning and renders
  // like any other boolean.
  it('stays an ordinary boolean on a container with no such axis', () => {
    expect(h('{loose}\n> q\n')).toBe('<blockquote loose=""><p>q</p></blockquote>')
  })

  it('takes the same key on an ordered list', () => {
    expect(h('{loose}\n1. a\n')).toBe('<ol>\n  <li><p>a</p></li>\n</ol>')
  })

  // At the nested container's OWN indent, so it loosens the sub-list and not
  // its parent - the outer item stays tight and keeps its lead text inline.
  it('loosens the sub-list and not its parent', () => {
    expect(h('- outer\n  {loose}\n  - inner\n')).toBe(
      '<ul>\n  <li>outer\n    <ul>\n      <li><p>inner</p></li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  // REDUNDANT USE IS A LEGAL NO-OP, on both containers. Rejecting it would make
  // the key context-sensitive, and a producer that always emits it is simpler
  // than one that has to decide.
  it('changes nothing on a list the blank lines already loosened', () => {
    expect(h('{loose}\n- a\n\n- b\n')).toBe(h('- a\n\n- b\n'))
  })

  it('changes nothing on a description that already holds two blocks', () => {
    expect(h('{loose}\n:: T\n:  a\n\n   b\n')).toBe(h(':: T\n:  a\n\n   b\n'))
  })

  // A SIBLING'S SECOND BLOCK SAYS NOTHING ABOUT THIS DESCRIPTION. Only a second
  // block inside the SAME description wraps it, so the key is not redundant here.
  it('loosens every description, not only the ones that already had two blocks', () => {
    expect(h('{loose}\n:: T\n:  a\n:: U\n:  x\n\n   y\n')).toBe(
      '<dl>\n  <dt>T</dt>\n  <dd><p>a</p></dd>\n  <dt>U</dt>\n  <dd>\n    <p>x</p>\n    <p>y</p>\n  </dd>\n</dl>',
    )
  })

  // PART 12 §8 NAMES THE FIELD (`markup-carve/carve#1624`, spec `cfb8d7bf`), so
  // the definition-list half of L7 rides the wire like the list half's `tight`.
  // It is `const: true`: PRESENT means the looseness was SPELLED, ABSENT means
  // each description derives its own wrapper from its block count. There is no
  // `false` to write, because an absent boolean read as false would say loose -
  // the opposite of the default.
  it('publishes the spelled looseness for a definition list', () => {
    expect(carveToAstJson('{loose}\n:: T\n:  a\n').children[0]).toMatchObject({
      type: 'definition_list',
      loose: true,
    })
  })

  // THE NEAR MISS, and it is what stops the fix from being "always publish".
  // Only the SPELLED fact is underivable; a list that derived its own looseness
  // publishes nothing, so an over-correction that emitted the flag on every
  // definition list fails here rather than passing quietly.
  it('publishes no looseness for a definition list that did not spell it', () => {
    const derived = carveToAstJson(':: T\n:  a\n\n:: U\n:  b\n').children[0]!
    expect(derived).toMatchObject({ type: 'definition_list' })
    expect(Object.keys(derived)).not.toContain('loose')
  })

  it('leaves the list half publishing `tight`, not `loose`', () => {
    expect(Object.keys(carveToAstJson('{loose}\n- a\n').children[0]!)).not.toContain('loose')
  })

  it('sets the existing `tight` field for a list, and leaves it no attributes', () => {
    const list = parse('{loose}\n- a\n').children[0]!
    expect(list).toMatchObject({ type: 'list', tight: false })
    expect(list.attrs).toBeUndefined()
  })
})

/**
 * PART 12 §8's field is the only thing that carries L7's definition-list
 * looseness across a serialization boundary.
 *
 * A blank line between two ENTRIES does not loosen a `<dl>` at all, so
 * `<dd><p>x</p></dd>` has no blank-line spelling at any entry count. Drop the
 * field on the way out and the fact is simply gone: the tree re-renders
 * `<dd>a</dd>` and the writer re-emits a `:: T` / `:  a` that no longer says
 * what the author said (`markup-carve/carve-js#1409`).
 */
describe('the definition-list looseness survives an AST JSON round trip', () => {
  const src = '{loose}\n:: T\n: a\n'
  const roundTrip = () => fromAstJson(carveToAstJson(src))

  it('renders the same HTML after a round trip as it does directly', () => {
    expect(renderHtml(roundTrip())).toBe(carveToHtml(src))
  })

  // The value the render is ABOUT, spelled out. Without it the assertion above
  // could be bought by breaking the direct render to match the round trip.
  it('keeps the block wrapper the looseness asks for', () => {
    expect(renderHtml(roundTrip())).toContain('<dd><p>a</p></dd>')
  })

  it('writes the key back after a round trip', () => {
    expect(renderCarve(roundTrip())).toBe(src)
  })

  // §11 refuses a property the schema does not name, so publishing the field
  // without naming it in `WIRE_FIELDS` would turn a silent loss into a throw.
  it('accepts an ingested payload carrying the field', () => {
    expect(() =>
      fromAstJson({
        type: 'document',
        srcByteLength: 0,
        children: [
          {
            type: 'definition_list',
            loose: true,
            items: [
              { type: 'definition_term', children: [{ type: 'text', value: 'T' }] },
              {
                type: 'definition_description',
                children: [{ type: 'paragraph', children: [{ type: 'text', value: 'a' }] }],
              },
            ],
          },
        ],
      } as never),
    ).not.toThrow()
  })
})

/**
 * PART 9 §17 L7's WRITER RULE: the key is spelled only where the blank-line
 * spelling cannot express the looseness.
 *
 * This is the load-bearing rule for churn - emitting it on every loose container
 * would rewrite a large share of every document anyone has written. It follows
 * PART 12 §15's writer, which retains `header-rows` rather than deriving it onto
 * every table, and PART 11 §2, which spends a mark only where omitting it would
 * change the re-parsed document.
 */
describe('the writer spells looseness only where a blank line cannot', () => {
  it('spells it on the one-item list', () => {
    expect(fmt('{loose}\n- Note text.\n')).toBe('{loose}\n- Note text.\n')
  })

  it('spells it on the one-block definition description', () => {
    expect(fmt('{loose}\n:: Term\n: Definition.\n')).toBe('{loose}\n:: Term\n: Definition.\n')
  })

  // The corpus control: a multi-item loose list whose blank lines already say it.
  // The HTML is byte-identical with and without the key, so only the written
  // source can see this rule.
  it('does not derive it onto a list the blank lines already loosened', () => {
    expect(fmt('- alpha\n\n- beta\n')).toBe('- alpha\n\n- beta\n')
  })

  // A redundant key the AUTHOR wrote is dropped too: the parser consumed it, so
  // the writer re-derives the spelling from the tree rather than echoing it.
  it('drops a redundant key the author wrote', () => {
    expect(fmt('{loose}\n- alpha\n\n- beta\n')).toBe('- alpha\n\n- beta\n')
  })

  /**
   * ON A DEFINITION LIST THE ANSWER IS UNCONDITIONAL (§17 L7, ruled in
   * markup-carve/carve-rs#1305 / markup-carve/carve#1639). The looseness field
   * is set ONLY where the key was spelled, because a blank line between two
   * ENTRIES does not loosen a `<dl>` at any count - so a body written without
   * the key can never read back with the field set, and the re-parse test says
   * "emit" every time.
   *
   * A description already holding two blocks does not change it. The key is
   * redundant in the RENDER there - both spellings wrap the `<dd>` - and it is
   * NOT redundant in the tree, and the tree is what PART 11 §1's equality is
   * taken over. This engine read the redundancy off the render and dropped the
   * key, so `fmt` deleted a fact the document stated.
   */
  it('decorates a definition list unconditionally, two-block description included', () => {
    expect(fmt('{loose}\n:: T\n: a\n\n  b\n')).toBe('{loose}\n:: T\n: a\n\n  b\n')
    expect(fmt('{loose}\n:: T\n: a\n:: U\n: b\n')).toBe('{loose}\n:: T\n: a\n:: U\n: b\n')
  })

  /** And a `<dl>` that never carried the key still never gains one. */
  it('does not derive the key onto a definition list that did not spell it', () => {
    expect(fmt(':: T\n: a\n\n  b\n')).toBe(':: T\n: a\n\n  b\n')
    expect(fmt(':: T\n: a\n')).toBe(':: T\n: a\n')
  })

  /**
   * THE TEST IS A RE-PARSE OVER THE DOCUMENT, not over the render. Written
   * without the key, this `<dl>` reads back with no looseness at all - which is
   * exactly what the render cannot see, since both spellings wrap the `<dd>`.
   */
  it('keeps the looseness through a format pass where the render cannot see it', () => {
    const src = '{loose}\n:: T\n: a\n\n  b\n'
    expect(h(fmt(src))).toBe(h(src))
    expect(parse(fmt(src)).children[0]).toMatchObject({ type: 'definition_list', loose: true })
    expect(parse(':: T\n:  a\n\n   b\n').children[0]).not.toHaveProperty('loose')
  })

  // A blank line loosens an item only before a genuine PARAGRAPH (§17 L2), so a
  // one-item list whose second child is a sub-block re-reads TIGHT and the key is
  // the only spelling left.
  it('spells it where the item\'s own blank line would not loosen on re-read', () => {
    const src = '{loose}\n- a\n\n  ```\n  code\n  ```\n'
    expect(fmt(src)).toContain('{loose}')
    expect(h(fmt(src))).toBe(h(src))
  })

  // THE NEAR MISS a naive reading of the rule also decorates. This one-item list
  // is loose, and its lead CONTAINER carries a blank line of its own, so the
  // written source re-reads loose without any key - the mark would be idle. The
  // looseness is not even observable in the HTML here, since the `<li>` holds no
  // paragraph of its own.
  it('does not decorate a one-item list whose lead container already spells it', () => {
    const src = '- ::: d\n  b\n\n  tail\n  :::\n'
    expect(fmt(src)).toBe(src)
    expect(h(fmt(src))).toBe(h(src))
  })

  it('round-trips every shape through the writer', () => {
    const cases = [
      '{loose}\n- Note text.\n',
      '{loose}\n:: Term\n:  Definition.\n',
      '- alpha\n\n- beta\n',
      '{loose}\n- a\n\n- b\n',
      '{loose}\n:: T\n:  a\n:: U\n:  x\n\n   y\n',
      '{#i loose .note}\n- x\n',
      '{loose=x}\n- x\n',
      '{loose}\n> q\n',
      '- outer\n  {loose}\n  - inner\n',
      '- ::: d\n  b\n\n  tail\n  :::\n',
    ]
    for (const src of cases) {
      expect(h(fmt(src)), src).toBe(h(src))
      expect(fmt(fmt(src)), src).toBe(fmt(src))
    }
  })
})

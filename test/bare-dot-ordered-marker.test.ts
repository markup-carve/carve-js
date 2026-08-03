import { describe, expect, it } from 'vitest'

import {
  carveToCarve,
  carveToHtml,
  fromAstJson,
  parse,
  renderCarve,
  toAstJson,
} from '../src/index.js'

/**
 * The bare-dot ordered marker (proposal for carve#315).
 *
 * `. text` is a decimal ordered item counting from 1 - the AsciiDoc-style
 * shorthand. Only `.` may drop its value: a leading `) ` collides with prose
 * parentheticals far more often, which is the same asymmetry that keeps `(1)`
 * from being a marker.
 *
 * This is a BREAKING change to the language, not an addition: after a blank
 * line, a paragraph opening with `. ` used to be a paragraph. The tests below
 * pin both what that buys and what it costs.
 */
describe('bare-dot ordered marker', () => {
  it('counts from 1 and renders as a decimal list', () => {
    expect(carveToHtml('. first\n. second\n. third')).toBe(
      '<ol>\n  <li>first</li>\n  <li>second</li>\n  <li>third</li>\n</ol>',
    )
  })

  it('is the same list as an explicit decimal-dot marker', () => {
    // Sharing the dialect is what lets the two forms mix; a delimiter or
    // dialect change would still open a sibling list (§11).
    const mixed = '<ol>\n  <li>a</li>\n  <li>b</li>\n</ol>'
    expect(carveToHtml('1. a\n. b')).toBe(mixed)
    expect(carveToHtml('. a\n2. b')).toBe(mixed)
  })

  it('does not exist for the other delimiter', () => {
    expect(carveToHtml(') text')).toBe('<p>) text</p>')
  })

  it('needs a space and content, like every other marker', () => {
    expect(carveToHtml('.')).toBe('<p>.</p>')
    expect(carveToHtml('.   ')).toBe('<p>.</p>')
    expect(carveToHtml('.x is prose')).toBe('<p>.x is prose</p>')
  })

  it('does not port the AsciiDoc `..` nesting idiom', () => {
    // No space after the first dot, so it is not a marker at all. Carve nests
    // by indentation.
    expect(carveToHtml('.. text')).toBe('<p>.. text</p>')
  })

  it('does not interrupt a paragraph', () => {
    expect(carveToHtml('A sentence.\n. first')).toBe('<p>A sentence.\n. first</p>')
  })

  it('opens a list where a paragraph used to be (the breaking change)', () => {
    // Stated rather than hidden: this is the cost of the feature.
    expect(carveToHtml('The value was\n\n. 5 percent')).toBe(
      '<p>The value was</p>\n<ol>\n  <li>5 percent</li>\n</ol>',
    )
  })

  describe('li-attributes', () => {
    it('attach to a bare dot exactly as to any other marker', () => {
      // The shape is marker + [attrs] + space + content. The block sits BEFORE
      // the required space, which is where `1.{...}` and `-{...}` already put
      // it, so it never competes with the space that makes a marker a marker.
      expect(carveToHtml('.{#x .k} text')).toBe(
        '<ol>\n  <li id="x" class="k">text</li>\n</ol>',
      )
    })

    it('still need the space after the block', () => {
      // Identical to `1.{k=v}text` and `-{k=v}text`, which are also not markers.
      expect(carveToHtml('.{k=v}text')).toBe('<p>.{k=v}text</p>')
      expect(carveToHtml('1.{k=v}text')).toBe('<p>1.{k=v}text</p>')
      expect(carveToHtml('-{k=v}text')).toBe('<p>-{k=v}text</p>')
    })

    it('widen the breaking change, which is the honest cost', () => {
      // A paragraph opening with `.{` plus a valid attribute block and a space
      // becomes an item. Rarer than the `. ` case already accepted, and
      // refusing it would not avoid the collision class, only one instance.
      expect(carveToHtml('.{color} is a CSS class')).toBe(
        '<ol>\n  <li color="">is a CSS class</li>\n</ol>',
      )
    })
  })

  describe('nesting', () => {
    it('nests by indentation, in both directions', () => {
      expect(carveToHtml('- a\n\n  . b')).toBe(
        '<ul>\n  <li>a\n    <ol>\n      <li>b</li>\n    </ol>\n  </li>\n</ul>',
      )
      expect(carveToHtml('. a\n\n  - b')).toBe(
        '<ol>\n  <li>a\n    <ul>\n      <li>b</li>\n    </ul>\n  </li>\n</ol>',
      )
    })

    it('restarts a nested list at 1 rather than inheriting a start', () => {
      const html = carveToHtml('3. a\n\n   . n1\n   . n2')
      expect(html).toContain('<ol start="3">')
      // The nested list carries no start of its own.
      expect(html).toContain('<ol>\n      <li>n1</li>')
    })
  })

  describe('fmt', () => {
    it('writes back the spelling the author used, either way', () => {
      // PART 11 §6: `fmt` does not respell a construct to a synonym. The two
      // forms parse to the same list, so the tree carries which one opened it
      // (`bareMarker`) - the same remedy the combined bold-italic form needed,
      // and the reason an existing `1.`/`2.`/`3.` document is untouched.
      expect(carveToCarve('. a\n. b')).toBe('. a\n. b\n')
      expect(carveToCarve('1. a\n2. b')).toBe('1. a\n2. b\n')
    })

    it('is fixed by the FIRST item, like start and olType', () => {
      // A mixed list is one list, and its opener decides how it is written.
      expect(carveToCarve('. a\n2. b')).toBe('. a\n. b\n')
      expect(carveToCarve('1. a\n. b')).toBe('1. a\n2. b\n')
    })

    it('keeps renumbering an explicit list, which it always did', () => {
      // Author NUMBERING was never preserved; the marker SPELLING now is.
      expect(carveToCarve('1. a\n1. b')).toBe('1. a\n2. b\n')
    })

    it('keeps an explicit value wherever the value carries something', () => {
      // A start, a dialect and a delimiter are all authored form (§11), and a
      // bare dot cannot express any of them.
      expect(carveToCarve('3. a\n4. b')).toBe('3. a\n4. b\n')
      expect(carveToCarve('a. x\nb. y')).toBe('a. x\nb. y\n')
      expect(carveToCarve('i. x\nii. y')).toBe('i. x\nii. y\n')
      expect(carveToCarve('1) a\n2) b')).toBe('1) a\n2) b\n')
    })

    it('records the spelling in the AST and publishes it', () => {
      // Without the mark there is nothing to preserve, which is exactly the
      // argument PART 11 §6 makes for `boldItalic`.
      const bare = parse('. a').children[0] as { bareMarker?: true }
      const explicit = parse('1. a').children[0] as { bareMarker?: true }
      expect(bare.bareMarker).toBe(true)
      expect(explicit.bareMarker).toBeUndefined()

      // It rides the wire too, since carve#480 gave it a field in the schema
      // beside `delim` and `bulletChar` - the author-choice fields it is
      // exactly like. Before that it was stripped, and a JSON round trip
      // silently renumbered the list.
      const wire = JSON.parse(JSON.stringify(toAstJson(parse('. a\n. b'))))
      expect(JSON.stringify(wire)).toContain('bareMarker')
      expect(renderCarve(fromAstJson(wire))).toBe('. a\n. b\n')
    })

    it('keeps li-attributes on the canonical form', () => {
      // Without the attribute fix this line could not be written at all: the
      // canonical marker would break the moment an item needed an id.
      expect(carveToCarve('.{#x} a\n. b')).toBe('.{#x} a\n. b\n')
    })

    it('is idempotent and preserves the rendered list', () => {
      for (const source of [
        '. a\n. b',
        '1. a\n2. b',
        '3. a\n4. b',
        '.{#x} a\n. b',
        '. a\n2. b',
        '1. a\n. b',
      ]) {
        const once = carveToCarve(source)
        expect(carveToCarve(once)).toBe(once)
        expect(carveToHtml(once)).toBe(carveToHtml(source))
      }
    })
  })
})

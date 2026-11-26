// C2-H-215 to C2-H-217: the snippet carriers of a `roundtrip` render, read back as snippet uses.
import { type DefaultTreeAdapterTypes as Html } from 'parse5'
import { type Block, type Inline } from '../../src/index.ts'
import { isSnippetName } from '../../src/snippets.ts'
import { attr, has, ignoredCarrier, report, type HtmlContext } from './html-dom.ts'

const VALUE = /^([1-9][0-9]*):(inline|block):\$(.+)$/u

interface Carrier { n: string, mode: 'inline' | 'block', name: string }

function parse(value: string): Carrier | undefined {
  const match = VALUE.exec(value)
  if (match === null || !isSnippetName(match[3]!)) return undefined
  return { n: match[1]!, mode: match[2] as 'inline' | 'block', name: match[3]! }
}

/** C2-H-217: the scope carrier beside an accepted carrier reports the lost include, once per element. */
export function snippetScope(node: Html.Element, context: HtmlContext): void {
  const scope = attr(node, 'data-carve-snippet-scope')
  if (scope === undefined) return
  if (scope !== 'include') return ignoredCarrier(context, node, 'data-carve-snippet-scope', 'the value is not include')
  report(context, node, 'snippet-scope-loss', 'The snippet came from an included file; its definition reads back into this document')
}

/**
 * C2-H-186: the use an element with `data-carve-snippet` stands for, in a slot of `mode`, or undefined where the carrier
 * is not read. Its content is generated and not read.
 */
function accepted(node: Html.Element, context: HtmlContext, mode: 'inline' | 'block'): Carrier | undefined {
  const value = attr(node, 'data-carve-snippet')
  if (value === undefined) return undefined
  const carrier = parse(value)
  const ordinals = context.snippetOrdinals ??= new Set()
  let fault: string | undefined
  if (carrier === undefined) fault = 'the value is not N:MODE:$NAME'
  else if (carrier.mode !== mode) fault =
    `the mode ${carrier.mode} does not match a slot of ${mode === 'inline' ? 'inline content' : 'blocks'}`
  else if (ordinals.has(carrier.n)) fault = 'another carrier holds the same ordinal'
  if (fault !== undefined) {
    ignoredCarrier(context, node, 'data-carve-snippet', fault)
    if (has(node, 'data-carve-snippet-scope')) ignoredCarrier(context, node, 'data-carve-snippet-scope', 'no snippet carrier is read here')
    return undefined
  }
  ordinals.add(carrier!.n)
  snippetScope(node, context)
  return carrier
}

/** The ordinal and mode of a well-formed carrier, without the reports and the ordinal claim of `accepted`. */
export function carrierOrdinal(node: Html.Element): { n: string, mode: 'inline' | 'block' } | undefined {
  const value = attr(node, 'data-carve-snippet')
  return value === undefined ? undefined : parse(value)
}

export function inlineSnippet(node: Html.Element, context: HtmlContext): Inline[] | undefined {
  if (!has(node, 'data-carve-snippet')) return undefined
  const carrier = accepted(node, context, 'inline')
  return carrier === undefined ? undefined : [{ type: 'snippet_use', name: carrier.name, mode: 'inline' }]
}

export function blockSnippet(node: Html.Element, context: HtmlContext): Block[] | undefined {
  if (!has(node, 'data-carve-snippet')) return undefined
  if (node.tagName !== 'p') {
    ignoredCarrier(context, node, 'data-carve-snippet', 'a block use is read only from a paragraph')
    return undefined
  }
  const carrier = accepted(node, context, 'block')
  return carrier === undefined ? undefined : [{ type: 'snippet_use', name: carrier.name, mode: 'block' }]
}

/** C2-H-217: a note reference whose `data-carve-snippet-mark` names an accepted use is dropped. */
export function droppedMark(node: Html.Element, context: HtmlContext): boolean {
  const mark = attr(node, 'data-carve-snippet-mark')
  if (mark === undefined) return false
  if (context.snippetOrdinals?.has(mark) === true) return true
  ignoredCarrier(context, node, 'data-carve-snippet-mark', 'the value is no ordinal of a snippet use')
  return false
}

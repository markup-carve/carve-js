// C2-H-114: the abbreviation template of a `roundtrip` render holds the Carve source of a run of definitions.
import { type DefaultTreeAdapterTypes as Html } from 'parse5'
import { parseTree, type AbbreviationDefNode } from '../../v2/src/index.ts'
import { content, has, ignoredCarrier, isElement, isText, type HtmlContext } from './html-dom.ts'
import { isFootnoteSection } from './html-notes.ts'

function isTemplate(node: Html.Element): node is Html.Template {
  return node.tagName === 'template'
}

function definitions(text: string): AbbreviationDefNode[] | undefined {
  const children = parseTree(text).document.children
  const result: AbbreviationDefNode[] = []
  for (const child of children) {
    if (child.type !== 'abbreviation_def') return undefined
    const { pos: _pos, ...rest } = child
    result.push(rest)
  }
  return result.length > 0 ? result : undefined
}

/** The definitions of one template, read from its content fragment, or undefined with a diagnostic. */
function read(node: Html.Template, context: HtmlContext): AbbreviationDefNode[] | undefined {
  const nodes = node.content.childNodes
  if (!nodes.every(isText)) {
    ignoredCarrier(context, node, 'data-carve-abbreviations', 'the template holds markup')
    return undefined
  }
  const found = definitions(nodes.map(child => child.value).join(''))
  if (found === undefined) ignoredCarrier(context, node, 'data-carve-abbreviations', 'the template holds more than definitions')
  return found
}

/**
 * Reads every template that stands where a render writes one: among the children of the document, or of a
 * section it opened at a heading. A template anywhere else is not a carrier.
 */
export function collectTemplates(nodes: Html.ChildNode[], context: HtmlContext): void {
  for (const node of nodes) {
    if (!isElement(node)) continue
    if (isTemplate(node) && has(node, 'data-carve-abbreviations')) {
      const found = read(node, context)
      context.templates.set(node, found ?? [])
      for (const definition of found ?? []) {
        if (!context.abbreviations.has(definition.key)) context.abbreviations.set(definition.key, definition)
      }
    } else if (['section', 'html', 'body'].includes(node.tagName) && !isFootnoteSection(node)) {
      collectTemplates(content(node), context)
    }
  }
}

/** The definitions at the place of the template, nothing for a template that held no definitions, or undefined for any other. */
export function abbreviationTemplate(node: Html.Element, context: HtmlContext): AbbreviationDefNode[] | undefined {
  const found = context.templates.get(node)
  if (found !== undefined) return found
  if (has(node, 'data-carve-abbreviations')) {
    ignoredCarrier(context, node, 'data-carve-abbreviations', 'a render writes a template only in the flow of the document')
  }
  return undefined
}

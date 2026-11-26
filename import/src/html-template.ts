// C2-H-114: the abbreviation template of a `roundtrip` render holds the Carve source of a run of definitions.
import { type DefaultTreeAdapterTypes as Html } from 'parse5'
import { parseTree, type AbbreviationDefNode, type SnippetDefinitionNode } from '../../src/index.ts'
import { snippetScope } from './html-snippets.ts'
import { content, has, ignoredCarrier, isElement, isText, type HtmlContext } from './html-dom.ts'
import { isFootnoteSection } from './html-notes.ts'

function isTemplate(node: Html.Element): node is Html.Template {
  return node.tagName === 'template'
}

type Definition = AbbreviationDefNode | SnippetDefinitionNode

/** The definitions of `type` a template text holds, or undefined where it holds anything else. */
function definitions(text: string, type: Definition['type']): Definition[] | undefined {
  const children = parseTree(text, { positions: false }).document.children
  const result: Definition[] = []
  for (const child of children) {
    if (child.type !== type) return undefined
    result.push(child as Definition)
  }
  return result.length > 0 ? result : undefined
}

/** The carrier a template holds: the abbreviation or, C2-H-216, the snippet template. */
function carrierOf(node: Html.Element): 'data-carve-abbreviations' | 'data-carve-snippets' | undefined {
  if (has(node, 'data-carve-abbreviations')) return 'data-carve-abbreviations'
  return has(node, 'data-carve-snippets') ? 'data-carve-snippets' : undefined
}

/** The definitions of one template, read from its content fragment, or undefined with a diagnostic. */
function read(node: Html.Template, context: HtmlContext, carrier: NonNullable<ReturnType<typeof carrierOf>>): Definition[] | undefined {
  const nodes = node.content.childNodes
  if (!nodes.every(isText)) {
    ignoredCarrier(context, node, carrier, 'the template holds markup')
    return undefined
  }
  const type = carrier === 'data-carve-snippets' ? 'snippet_definition' : 'abbreviation_def'
  const found = definitions(nodes.map(child => child.value).join(''), type)
  if (found === undefined) ignoredCarrier(context, node, carrier, 'the template holds more than definitions')
  else if (carrier === 'data-carve-snippets') snippetScope(node, context)
  return found
}

function collectTemplate(node: Html.Template, context: HtmlContext, carrier: NonNullable<ReturnType<typeof carrierOf>>): void {
  const found = read(node, context, carrier) ?? []
  context.templates.set(node, found)
  for (const definition of found) {
    if (definition.type === 'abbreviation_def' && !context.abbreviations.has(definition.key)) {
      context.abbreviations.set(definition.key, definition)
    }
  }
}

/**
 * Reads every template that stands where a render writes one: among the children of the document, or of a
 * section it opened at a heading. A template anywhere else is not a carrier.
 */
export function collectTemplates(nodes: Html.ChildNode[], context: HtmlContext): void {
  for (const node of nodes) {
    if (!isElement(node)) continue
    const carrier = isTemplate(node) ? carrierOf(node) : undefined
    if (carrier !== undefined) {
      collectTemplate(node as Html.Template, context, carrier)
    } else if (['section', 'html', 'body'].includes(node.tagName) && !isFootnoteSection(node)) {
      collectTemplates(content(node), context)
    }
  }
}

/** The definitions at the place of the template, nothing for a template that held no definitions, or undefined for any other. */
export function abbreviationTemplate(node: Html.Element, context: HtmlContext): Definition[] | undefined {
  const found = context.templates.get(node)
  if (found !== undefined) return found
  const carrier = carrierOf(node)
  if (carrier !== undefined) ignoredCarrier(context, node, carrier, 'a render writes a template only in the flow of the document')
  return undefined
}

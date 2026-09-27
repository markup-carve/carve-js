import type { InlineNode } from './ast.js'

/** Transform each authored inline child list, leaving derived display text alone. */
export function mapInlineChildren<T>(
  node: InlineNode,
  map: (children: InlineNode[], context: T) => InlineNode[],
  context: T,
): void {
  switch (node.type) {
    case 'emphasis': case 'strong': case 'underline': case 'strike':
    case 'superscript': case 'subscript': case 'highlight':
    case 'link': case 'span': case 'small_caps': case 'insert': case 'delete':
      node.children = map(node.children, context)
      return
    case 'inline_footnote':
      node.inline = map(node.inline, context)
      return
    case 'substitution':
      node.old = map(node.old, context)
      node.new = map(node.new, context)
      return
    case 'inline_extension':
      node.content = map(node.content, context)
      return
    case 'ruby':
      for (const pair of node.pairs) {
        pair.base = map(pair.base, context)
        pair.annotation = map(pair.annotation, context)
      }
      return
    case 'citation_group':
      for (const item of node.items) {
        if (item.prefix) item.prefix = map(item.prefix, context)
        if (item.locator) item.locator = map(item.locator, context)
        if (item.suffix) item.suffix = map(item.suffix, context)
      }
      return
    case 'text': case 'escaped_text': case 'smart_punctuation': case 'code':
    case 'image': case 'math': case 'raw_inline': case 'literal_inline':
    case 'symbol': case 'autolink': case 'heading_ref': case 'caption_number':
    case 'mention': case 'tag': case 'abbreviation': case 'footnote_ref':
    case 'non_breaking_space': case 'soft_break': case 'hard_break':
    case 'critic_comment': case 'comment':
      return
    default:
      return assertNever(node)
  }
}

function assertNever(_node: never): never {
  throw new Error('Unsupported inline node type')
}

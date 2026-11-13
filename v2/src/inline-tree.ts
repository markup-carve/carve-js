// The inline tree of one content, built from the events of its inline pass.
import { type AttributeMemo, type AttributeSink, readAttributeBlock, unescape } from './attributes.ts'
import { ENTER, EVENT_WIDTH, eventFlags, eventKind, eventType, SPAN } from './events.ts'
import {
  ATTRIBUTE_BLOCK, DESTINATION, ESCAPE, FLAG_COLLAPSED, IMAGE, isInlineContainer, LABEL, TITLE,
} from './inline-kinds.ts'

/** Kinds of the tree that no event has: a run of text, and one line of a line block. */
export const TEXT = 61
export const LINE = 62

const NO_MEMO: AttributeMemo = { doubleQuoteFailEnd: -1, singleQuoteFailEnd: -1, valueFailEnd: -1 }

/** The merged attribute blocks of a host, in the fixed order of C2-I-041. */
export interface Attributes {
  id: string | null
  classes: string[]
  language: string | null
  keys: [string, string][]
}

/**
 * One field layout for every inline node. A node with inline content has `children`. `value` is
 * the text of a text node, the payload of a node without children and the alt source of an image.
 * `label` is the key of a reference (C2-I-079).
 */
export interface InlineNode {
  kind: number
  start: number
  end: number
  flags: number
  aux: number
  children: InlineNode[] | null
  value: string | null
  destination: string | null
  title: string | null
  label: string | null
  attributes: Attributes | null
}

function createNode(kind: number, start: number, flags: number, aux: number): InlineNode {
  return {
    kind, start, end: start, flags, aux, children: isInlineContainer(kind) ? [] : null,
    value: null, destination: null, title: null, label: null, attributes: null,
  }
}

/** C2-I-079: every run of spaces, tabs and a line break is one space, and the ends are trimmed. */
export function foldLabel(source: string): string {
  return source.replaceAll(/[ \t\n]+/g, ' ').trim()
}

function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

/** C2-I-039, C2-I-042: adds the parts of one block to `attributes`. */
export function attributeSink(attributes: Attributes): AttributeSink {
  const sink: AttributeSink = {
    id: (name) => {
      attributes.id = name
    },
    className: (name) => {
      attributes.classes.push(name)
    },
    language: (tag) => {
      attributes.language = tag
    },
    key: (key, value) => {
      if (sameName(key, 'id')) return sink.id(value)
      if (sameName(key, 'class')) {
        for (const name of value.split(/[ \t]+/)) if (name !== '') attributes.classes.push(name)
        return
      }
      // A later key replaces an earlier one of the same name, at its first place (C2-A-035).
      const earlier = attributes.keys.find((pair) => sameName(pair[0], key))
      if (earlier === undefined) attributes.keys.push([key, value])
      else earlier[1] = value
    },
  }
  return sink
}

function addAttributes(src: string, host: InlineNode, start: number, end: number): void {
  host.attributes ??= { id: null, classes: [], language: null, keys: [] }
  readAttributeBlock(src, start, end, NO_MEMO, attributeSink(host.attributes))
}

/** Adds text to the node list: adjacent runs are one text node (C2-A-040). */
function addText(list: InlineNode[], value: string, start: number, end: number): void {
  const last = list.length > 0 ? list[list.length - 1]! : null
  if (last !== null && last.kind === TEXT) {
    last.value += value
    last.end = end
    return
  }
  const node = createNode(TEXT, start, 0, 0)
  node.value = value
  node.end = end
  list.push(node)
}

type ContentReader = (start: number, end: number) => string

/** Closes a part of `host`: it goes into a field of the host. */
function closePart(src: string, node: InlineNode, host: InlineNode, content: ContentReader): void {
  const value = node.value ?? ''
  if (node.kind === ATTRIBUTE_BLOCK) addAttributes(src, host, node.start, node.end)
  else if (node.kind === DESTINATION) host.destination = value.replaceAll(/\\([()\\])/g, '$1')
  else if (node.kind === TITLE) host.title = unescape(value, 0, value.length)
  // C2-I-072: the label of a collapsed reference is the source of its own text.
  else if ((host.flags & FLAG_COLLAPSED) !== 0) host.label = foldLabel(content(host.start + (host.kind === IMAGE ? 2 : 1), node.start - 1))
  else host.label = foldLabel(value)
}

function isPart(kind: number): boolean {
  return kind === ATTRIBUTE_BLOCK || kind === DESTINATION || kind === TITLE || kind === LABEL
}

/**
 * Builds the inline nodes of one content from the first `length` ints of its events. `content`
 * gives the source of a range without the prefixes of the lines it crosses.
 */
export function buildInlineTree(src: string, events: Int32Array, length: number, content: ContentReader): InlineNode[] {
  const root: InlineNode[] = []
  const open: InlineNode[] = []
  let top: InlineNode | null = null
  for (let at = 0; at < length; at += EVENT_WIDTH) {
    const tag = events[at]!
    const a = events[at + 1]!
    const b = events[at + 2]!
    const type = eventType(tag)
    if (type === ENTER) {
      top = createNode(eventKind(tag), a, eventFlags(tag), b)
      open.push(top)
    } else if (type === SPAN && top !== null && top.children === null) {
      top.value = top.value === null ? src.slice(a, b) : `${top.value}\n${src.slice(a, b)}`
    } else if (type === SPAN) {
      addText(top === null ? root : top.children!, src.slice(a, b), a, b)
    } else {
      const node = open.pop()!
      node.end = a
      top = open.length > 0 ? open[open.length - 1]! : null
      const list = top === null ? root : top.children
      // C2-A-041: an escape is no node. Its character is text.
      if (node.kind === ESCAPE) addText(list!, node.value ?? '', node.start, a)
      else if (isPart(node.kind)) closePart(src, node, top!, content)
      else list!.push(node)
    }
  }
  return root
}

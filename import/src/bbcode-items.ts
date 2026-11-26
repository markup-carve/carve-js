// The items the BBCode reader makes, and the tag tables both BBCode writers read.

export interface Tag { kind: 'tag', name: string, value: string | undefined, children: Item[], start: number, end: number }
export type Item = string | Tag

export const BLOCK = new Set(['quote', 'code', 'list', 'hr', 'table', 'spoiler', 'center', 'left', 'right'])
export const INLINE: Record<string, string> = { b: 'strong', i: 'em', u: 'u', s: 'del', strike: 'del', sup: 'sup', sub: 'sub' }

export function plainText(items: Item[]): string {
  return items.map(item => typeof item === 'string' ? item : plainText(item.children)).join('')
}

export function isTag(item: Item, ...names: string[]): item is Tag {
  return typeof item !== 'string' && names.includes(item.name)
}

/** A paragraph break in BBCode text: a blank line and the whitespace after it. */
export const PARAGRAPH_BREAK = /\n[ \t]*\n\s*/u
const BLANK_LINE = /\n[ \t]*\n/u

/** A list item of one paragraph is written bare, as a tight list writes it (C2-M-033). */
export function itemHasBlocks(items: Item[]): boolean {
  return items.some(item => typeof item === 'string' ? BLANK_LINE.test(item.trim()) : BLOCK.has(item.name))
}

/** A leading `=` would make the fence a raw block (`[code= =html]`), so it is cut, as in 0.1. */
export function codeLanguage(tag: Tag): string | undefined {
  return tag.value?.trim().toLowerCase().replace(/^=+/u, '').trimStart()
}

export function codeValue(tag: Tag): string {
  return plainText(tag.children).replace(/^\n/u, '')
}

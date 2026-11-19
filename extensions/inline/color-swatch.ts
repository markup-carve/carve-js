import { type ExtensionClaim, type ExtensionDefinition, type ExtensionRenderer, type Inline, type Attrs } from '../../src/index.ts'
import { attrValue, authorAttrs, withClass } from '../common/attrs.ts'

export type SwatchPosition = 'before' | 'after' | 'none'
export type SwatchShape = 'square' | 'round' | 'ring'
export interface ColorSwatchOptions {
  position?: SwatchPosition
  shape?: SwatchShape
  tint?: boolean
  reveal?: boolean
}

const NAMED_COLORS = new Set(('transparent currentcolor aliceblue antiquewhite aqua aquamarine azure beige bisque black ' +
  'blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan ' +
  'darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid ' +
  'darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkvioletred deeppink deepskyblue ' +
  'dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green ' +
  'greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue ' +
  'lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue ' +
  'lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue ' +
  'mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue ' +
  'mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen ' +
  'paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue ' +
  'saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategray slategrey snow ' +
  'springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen').split(' '))

function textOf(nodes: readonly Inline[]): string {
  let result = ''
  for (const node of nodes) {
    if (node.type === 'text' || node.type === 'code' || node.type === 'literal_inline') result += node.value
    else if (node.type === 'tag') result += `#${node.name}`
    else if ('children' in node && Array.isArray(node.children)) result += textOf(node.children as Inline[])
  }
  return result
}

function safeColor(input: string): string | null {
  const value = input.trim()
  if (value.length > 256) return null
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) return value
  if (/^(?:rgb|rgba|hsl|hsla)\([0-9.,%\s/]*[0-9][0-9.,%\s/]*\)$/.test(value)) return value
  if (/^[a-z]+$/i.test(value) && NAMED_COLORS.has(value.toLowerCase())) return value
  return null
}

function contrastText(value: string): '#000' | '#fff' | null {
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value)?.[1]
  if (hex !== undefined && (hex.length === 4 || hex.length === 8) && /^0+$/.test(hex.slice(hex.length === 4 ? 3 : 6))) return null
  const channels = colorChannels(value, hex)
  if (channels === undefined) return null
  const brightness = ((channels[0] ?? 0) * 299 + (channels[1] ?? 0) * 587 + (channels[2] ?? 0) * 114) / 1000
  return brightness >= 128 ? '#000' : '#fff'
}

function colorChannels(value: string, hex: string | undefined): number[] | undefined {
  if (hex !== undefined) {
    const digits = hex.length < 5 ? [...hex.slice(0, 3)].map((part) => part.repeat(2)) :
      [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)]
    return digits.map((part) => Number.parseInt(part, 16))
  }
  const rgb = /^rgba?\((.*)\)$/.exec(value)?.[1]
  const parts = rgb?.trim().split(/[\s,/]+/).slice(0, 3)
  return parts?.length === 3 && parts.every((part) => /^\d+$/.test(part)) ? parts.map(Number) : undefined
}

function transform(claim: ExtensionClaim) {
  if (claim.form !== 'inline') return null
  const value = safeColor(textOf(claim.children))
  if (value === null) return null
  const fallback = structuredClone(claim.children)
  return { type: 'inline_extension' as const, name: 'carve.colorSwatch', version: '1', children: [],
    props: { value }, slots: { value: claim.children }, fallback }
}

export const colorSwatchExtension: ExtensionDefinition = {
  name: 'carve.colorSwatch', version: '1', matcher: { form: 'inline', name: 'color' },
  props: { value: 'string' }, slots: { value: { kind: 'inline' } }, children: 'none', transform,
}

function renderSwatch(value: string, attrs: Attrs | undefined, options: ColorSwatchOptions, host: Parameters<NonNullable<ExtensionRenderer['render']>>[1]): string {
  const position = options.position ?? 'before'
  const shape = options.shape ?? 'square'
  const reveal = options.reveal === true && position !== 'none'
  const tint = options.tint === true
  const chipClass = shape === 'square' ? 'swatch-chip' : `swatch-chip swatch-chip-${shape}`
  const style = shape === 'ring' ? `border-color:${value}` : `background-color:${value}`
  const chip = `<span class="${chipClass}" style="${host.escapeAttribute(style)}"></span>`
  const escaped = host.escapeText(value)
  const outer = authorAttrs(swatchAttrs(value, attrs, position, tint, reveal), host, ['contrast'])
  const visible = reveal ? `<span class="swatch-val">${escaped}</span>` : escaped
  const inner = position === 'none' ? chip : position === 'after' ? `${visible} ${chip}` : `${chip} ${visible}`
  return `<span${outer}>${inner}</span>`
}

function withDefault(attrs: Attrs, name: string, value: string): Attrs {
  return attrValue(attrs, name) !== undefined ? attrs :
    { ...attrs, keyValues: [...(attrs.keyValues ?? []), [name, value]] }
}

function swatchAttrs(value: string, attrs: Attrs | undefined, position: SwatchPosition, tint: boolean, reveal: boolean): Attrs {
  const classes = ['swatch', ...(attrs?.classes ?? []), ...(tint ? ['swatch-tint'] : []),
    ...(position === 'none' ? ['swatch-chip-only'] : []), ...(reveal ? ['swatch-reveal'] : [])]
  let result: Attrs = { ...(attrs ?? {}), classes }
  if (tint) result = withDefault(result, 'style', `background-color:color-mix(in srgb, ${value} 12%, transparent)`)
  if (position === 'none') result = withDefault(result, 'title', value)
  if (reveal) result = withDefault(result, 'tabindex', '0')
  return result
}

export function createColorSwatch(options: ColorSwatchOptions = {}): { definition: ExtensionDefinition, renderer: ExtensionRenderer } {
  if (options.position !== undefined && !['before', 'after', 'none'].includes(options.position)) throw new Error('Invalid swatch position')
  if (options.shape !== undefined && !['square', 'round', 'ring'].includes(options.shape)) throw new Error('Invalid swatch shape')
  const renderer: ExtensionRenderer = { version: '1', render(node, host) {
    const value = String(node.props?.['value'] ?? '')
    const contrast = attrValue(node.attrs, 'contrast') !== undefined
    const contrastColor = contrast ? contrastText(value) : null
    if (contrastColor !== null) {
      const attrs = withDefault(withClass(node.attrs, 'swatch-label'), 'style', `background:${value};color:${contrastColor}`)
      return `<span${authorAttrs(attrs, host, ['contrast'])}>${host.escapeText(value)}</span>`
    }
    return renderSwatch(value, node.attrs, options, host)
  } }
  return { definition: colorSwatchExtension, renderer }
}

export const colorSwatchRenderer = createColorSwatch().renderer

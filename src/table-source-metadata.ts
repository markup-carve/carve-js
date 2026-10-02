import type { Attrs, Table, TableColumn, TableRowGroups } from './ast.js'

function shiftDecimal(value: string, places: number): string | undefined {
  const match = /^([+]?)(\d+(?:\.\d*)?|\.\d+)(?:[eE]([+-]?\d+))?$/.exec(value.trim())
  if (!match) return undefined
  const mantissa = match[2]!
  const digits = mantissa.replace('.', '')
  const point = (mantissa.includes('.') ? mantissa.indexOf('.') : mantissa.length) + Number(match[3] ?? 0) + places
  if (!Number.isSafeInteger(point) || Math.abs(point) > 1000) return undefined
  const shifted = point <= 0 ? `0.${'0'.repeat(-point)}${digits}`
    : point >= digits.length ? `${digits}${'0'.repeat(point - digits.length)}`
      : `${digits.slice(0, point)}.${digits.slice(point)}`
  return shifted.replace(/^0+(?=\d)/, '')
}

export function tableWidthPercentage(width: number): string {
  return shiftDecimal(String(width), 2) ?? String(width * 100)
}

function positional(value: string | undefined, allowed: Set<string>): Array<string | undefined> {
  return value?.split(',').map((raw) => {
    const item = raw.trim()
    return allowed.has(item) ? item : undefined
  }) ?? []
}

export function tableColumnsFromAttrs(attrs: Attrs | undefined): TableColumn[] | undefined {
  const kv = attrs?.keyValues
  if (!kv) return undefined
  const aligns = positional(kv.aligns, new Set(['left', 'right', 'center']))
  const valigns = positional(kv.valigns, new Set(['top', 'middle', 'bottom']))
  const widths = kv.widths?.split(',').map((raw) => {
    const value = Number(raw.trim())
    return Number.isFinite(value) && value > 0 && value <= 100 ? Number(shiftDecimal(raw, -2) ?? String(value / 100)) : undefined
  }) ?? []
  const count = Math.max(aligns.length, valigns.length, widths.length)
  return count > 0 ? Array.from({ length: count }, (_, i) => ({
    ...(aligns[i] ? { align: aligns[i] as NonNullable<TableColumn['align']> } : {}),
    ...(valigns[i] ? { valign: valigns[i] as NonNullable<TableColumn['valign']> } : {}),
    ...(widths[i] ? { width: widths[i] } : {}),
  })) : undefined
}

export function tableRowGroupsFromAttrs(attrs: Attrs | undefined, rows: number): TableRowGroups | undefined {
  const kv = attrs?.keyValues
  if (!kv || !['header-rows', 'footer-rows', 'body-rows', 'body-header-rows', 'body-header-cols'].some(key => kv[key] !== undefined)) return undefined
  const count = (value: string): number | undefined => {
    const trimmed = value.trim()
    if (!/^\d+$/.test(trimmed)) return undefined
    const number = Number(trimmed)
    return Number.isSafeInteger(number) ? number : undefined
  }
  const edge = (value: string | undefined): number | undefined => value === undefined ? 0 : value.trim() === '' ? 1 : count(value)
  const headRows = edge(kv['header-rows'])
  const footRows = edge(kv['footer-rows'])
  if (headRows === undefined || footRows === undefined || headRows + footRows > rows) return undefined
  if (kv['body-rows'] === undefined) {
    if (kv['body-header-rows'] !== undefined || kv['body-header-cols'] !== undefined) return undefined
    return { headRows, bodies: [{ headRows: 0, bodyRows: rows - headRows - footRows }], footRows }
  }
  const rawBodies = kv['body-rows'].trim() === '' ? [] : kv['body-rows'].split(',')
  const headers = kv['body-header-rows']?.split(',')
  const columns = kv['body-header-cols']?.split(',')
  if ((headers && headers.length !== rawBodies.length) || (columns && columns.length !== rawBodies.length)) return undefined
  const bodies: TableRowGroups['bodies'] = []
  let remaining = rows - headRows - footRows
  for (let i = 0; i < rawBodies.length; i++) {
    const bodyRows = count(rawBodies[i]!)
    const bodyHead = headers ? count(headers[i]!) : 0
    const rawColumns = columns?.[i]?.trim()
    const rowHeadColumns = rawColumns ? count(rawColumns) : undefined
    if (bodyRows === undefined || bodyHead === undefined || (rawColumns && rowHeadColumns === undefined) || bodyHead > remaining || bodyRows > remaining - bodyHead) return undefined
    remaining -= bodyHead + bodyRows
    bodies.push({ headRows: bodyHead, bodyRows, ...(rowHeadColumns === undefined ? {} : { rowHeadColumns }) })
  }
  return remaining === 0 ? { headRows, bodies, footRows } : undefined
}

/** Add source spellings for table metadata without replacing authored attributes. */
export function tableSourceAttrs(table: Table): Attrs | undefined {
  const keyValues = { ...(table.attrs?.keyValues ?? {}) }
  const columns = table.columns
  if (columns?.length) {
    const join = (field: 'align' | 'valign', key: string): void => {
      if (keyValues[key] === undefined && columns.some((column) => column[field] !== undefined)) {
        keyValues[key] = columns.map((column) => column[field] ?? '').join(',')
      }
    }
    join('align', 'aligns')
    join('valign', 'valigns')
    if (keyValues.widths === undefined && columns.some((column) => column.width !== undefined)) {
      keyValues.widths = columns.map((column) => column.width === undefined ? '' : tableWidthPercentage(column.width)).join(',')
    }
    if (keyValues.aligns === undefined && keyValues.valigns === undefined && keyValues.widths === undefined) {
      keyValues.aligns = columns.map(() => '').join(',')
    }
  }
  const groups = table.rowGroups
  if (groups) {
    const put = (key: string, value: string): void => { if (keyValues[key] === undefined) keyValues[key] = value }
    if (groups.headRows > 0) put('header-rows', String(groups.headRows))
    if (groups.footRows > 0) put('footer-rows', String(groups.footRows))
    const simple = groups.bodies.length === 1 && groups.bodies[0]!.headRows === 0 && groups.bodies[0]!.rowHeadColumns === undefined
    if (simple) {
      if (keyValues['header-rows'] === undefined && keyValues['footer-rows'] === undefined) put('header-rows', '0')
    } else {
      put('body-rows', groups.bodies.map(body => body.bodyRows).join(','))
      if (groups.bodies.some(body => body.headRows !== 0)) put('body-header-rows', groups.bodies.map(body => body.headRows).join(','))
      if (groups.bodies.some(body => body.rowHeadColumns !== undefined)) put('body-header-cols', groups.bodies.map(body => body.rowHeadColumns ?? '').join(','))
    }
  }
  return Object.keys(keyValues).length ? { ...(table.attrs ?? {}), keyValues } : table.attrs
}

export function preservesTableRowGroups(table: Table, attrs: Attrs | undefined): boolean {
  const groups = table.rowGroups!
  const rebuilt = tableRowGroupsFromAttrs(attrs, table.rows.length)
  return rebuilt !== undefined && groups.headRows === rebuilt.headRows && groups.footRows === rebuilt.footRows
    && groups.bodies.length === rebuilt.bodies.length && groups.bodies.every((body, i) => {
      const other = rebuilt.bodies[i]!
      return body.headRows === other.headRows && body.bodyRows === other.bodyRows && body.rowHeadColumns === other.rowHeadColumns
    })
}

export function preservesTableColumns(table: Table, attrs: Attrs | undefined): boolean {
  const columns = table.columns!
  const rebuilt = tableColumnsFromAttrs(attrs)
  return rebuilt !== undefined && rebuilt.length === columns.length && columns.every((column, i) => {
    const other = rebuilt[i]!
    return column.align === other.align && column.valign === other.valign && column.width === other.width
  })
}

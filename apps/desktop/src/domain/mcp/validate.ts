/** Minimal JSON-Schema argument validation for MCP tool inputs. Pure; errors are German (reach the client's model). */
import type { JsonSchema } from './types'
import { McpToolError } from './types'

function check(name: string, schema: JsonSchema, value: unknown): void {
  switch (schema.type) {
    case 'string': {
      if (typeof value !== 'string') throw new McpToolError(`Argument «${name}» muss ein Text sein.`)
      if (schema.minLength != null && value.length < schema.minLength)
        throw new McpToolError(`Argument «${name}» ist zu kurz (mindestens ${schema.minLength} Zeichen).`)
      if (schema.maxLength != null && value.length > schema.maxLength)
        throw new McpToolError(`Argument «${name}» ist zu lang (höchstens ${schema.maxLength} Zeichen).`)
      break
    }
    case 'integer':
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new McpToolError(`Argument «${name}» muss eine Zahl sein.`)
      if (schema.type === 'integer' && !Number.isInteger(value)) throw new McpToolError(`Argument «${name}» muss eine ganze Zahl sein.`)
      if (schema.minimum != null && value < schema.minimum) throw new McpToolError(`Argument «${name}» muss mindestens ${schema.minimum} sein.`)
      if (schema.maximum != null && value > schema.maximum) throw new McpToolError(`Argument «${name}» darf höchstens ${schema.maximum} sein.`)
      break
    }
    case 'boolean':
      if (typeof value !== 'boolean') throw new McpToolError(`Argument «${name}» muss true oder false sein.`)
      break
    default:
      break
  }
  if (schema.enum && !schema.enum.includes(value as string | number))
    throw new McpToolError(`Argument «${name}» muss einer von diesen Werten sein: ${schema.enum.join(', ')}.`)
}

/** Validates `args` against an object schema and returns it (null/undefined -> {}). */
export function validateArgs(schema: JsonSchema, args: unknown): Record<string, unknown> {
  if (args === null || args === undefined) args = {}
  if (typeof args !== 'object' || Array.isArray(args)) throw new McpToolError('Die Argumente müssen ein Objekt sein.')
  const obj = args as Record<string, unknown>
  const props = schema.properties ?? {}
  for (const key of schema.required ?? []) {
    if (obj[key] === undefined || obj[key] === null) throw new McpToolError(`Argument «${key}» fehlt.`)
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(obj)) if (!(key in props)) throw new McpToolError(`Unbekanntes Argument «${key}».`)
  }
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue
    const sub = props[key]
    if (sub) check(key, sub, value)
    out[key] = value
  }
  return out
}

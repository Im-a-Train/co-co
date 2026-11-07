#!/usr/bin/env node
// Redacts a HAR capture down to API *structure*: methods, templated paths,
// parameter names, header names, status codes and JSON shapes (types only).
// No values from the capture are written, except for fields explicitly
// whitelisted with --keep=fieldA,fieldB (e.g. enum codes like courseStatus).
//
// Usage: node tools/har-redact.mjs <input.har> [--out=captures/redacted] [--keep=courseStatus,status]
//
// Console output is limited to counts and file paths, so running this never
// echoes captured data (parse errors are reported generically on purpose).

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith('--'));
const opt = (name, dflt) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : dflt;
};
const outDir = opt('out', 'captures/redacted');
const keep = new Set(opt('keep', '').split(',').map((s) => s.trim()).filter(Boolean));

if (!input) {
  console.error('usage: node tools/har-redact.mjs <input.har> [--out=dir] [--keep=field1,field2]');
  process.exit(2);
}

// ---------- classification helpers ----------
const STATIC_EXT = /\.(js|mjs|css|map|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|otf|eot)$/i;
const STATIC_MIME = /^(image\/|font\/|text\/css|application\/(x-)?javascript|text\/javascript|application\/font)/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeLiteralSegment(seg) {
  if (!seg) return true;
  if (seg.length > 40) return false;
  if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(seg)) return false; // no digits-first, no @, spaces, umlauts
  if ((seg.match(/\d/g) || []).length > 1) return false;
  return true;
}
function segmentKind(seg) {
  if (/^\d+$/.test(seg)) return 'id';
  if (UUID.test(seg)) return 'uuid';
  if (/^[0-9a-f]{16,}$/i.test(seg)) return 'hash';
  return 'param';
}
function safeKey(k) {
  // identifier-like and dominated by letters (allows e.g. "assistantInstructor1418AnalysisBid")
  if (!/^[A-Za-z_$][A-Za-z0-9_$.-]{0,60}$/.test(k)) return false;
  const digits = (k.match(/\d/g) || []).length;
  const letters = (k.match(/[A-Za-z]/g) || []).length;
  return digits <= 3 || letters >= digits * 3;
}
function keyFormat(k) {
  if (/^\d+$/.test(k)) return 'numeric';
  if (UUID.test(k)) return 'uuid';
  return 'other';
}
function stringFormat(s) {
  if (s === '') return 'empty';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return 'date';
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s)) return 'date-time';
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(s)) return 'time';
  if (UUID.test(s)) return 'uuid';
  if (/^756\.?\d{4}\.?\d{4}\.?\d{2}$/.test(s)) return 'ahv-number';
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) return 'email';
  if (/^https?:\/\//i.test(s)) return 'uri';
  if (/^eyJ[A-Za-z0-9_-]+\./.test(s)) return 'jwt';
  if (/^-?\d+(\.\d+)?$/.test(s)) return 'numeric-string';
  if (/^(true|false)$/i.test(s)) return 'boolean-string';
  if (/^[A-Z][A-Z0-9_]{2,}$/.test(s)) return 'enum-like';
  return null;
}

// ---------- schema inference (internal: { variants: { type: V } }) ----------
const newS = () => ({ variants: {} });

function addValue(S, v, keyName) {
  let t;
  if (v === null) t = 'null';
  else if (Array.isArray(v)) t = 'array';
  else if (typeof v === 'object') t = Object.keys(v).some((k) => !safeKey(k)) ? 'map' : 'object';
  else if (typeof v === 'number') t = Number.isInteger(v) ? 'integer' : 'number';
  else t = typeof v; // string | boolean
  const V = (S.variants[t] ??= { n: 0 });
  V.n++;
  if (t === 'string') {
    V.formats ??= {};
    const f = stringFormat(v) ?? 'text';
    V.formats[f] = (V.formats[f] || 0) + 1;
    V.maxLen = Math.max(V.maxLen || 0, v.length);
  }
  if (keyName && keep.has(keyName) && ['string', 'integer', 'number', 'boolean'].includes(t)) {
    V.values ??= new Set();
    if (V.values.size < 50 && String(v).length <= 60) V.values.add(v);
  }
  if (t === 'array') {
    V.items ??= newS();
    V.maxItems = Math.max(V.maxItems || 0, v.length);
    for (const it of v) addValue(V.items, it, keyName);
  } else if (t === 'object') {
    V.props ??= {};
    for (const [k, val] of Object.entries(v)) {
      const P = (V.props[k] ??= { n: 0, s: newS() });
      P.n++;
      addValue(P.s, val, k);
    }
  } else if (t === 'map') {
    V.map ??= newS();
    V.keyFormats ??= new Set();
    V.maxKeys = Math.max(V.maxKeys || 0, Object.keys(v).length);
    for (const [k, val] of Object.entries(v)) {
      V.keyFormats.add(keyFormat(k));
      addValue(V.map, val);
    }
  }
}

function finalize(S) {
  const out = Object.entries(S.variants).map(([t, V]) => {
    const o = {};
    if (t === 'map') {
      o.type = 'object';
      o['x-map-keys'] = [...V.keyFormats];
      o.additionalProperties = finalize(V.map);
    } else o.type = t;
    if (t === 'string') {
      const fmts = Object.keys(V.formats);
      if (!(fmts.length === 1 && fmts[0] === 'text')) o['x-formats'] = V.formats;
      o['x-max-length'] = V.maxLen;
    }
    if (V.values) o.enum = [...V.values].sort();
    if (t === 'array') o.items = finalize(V.items);
    if (t === 'object') {
      o.properties = {};
      const req = [];
      for (const [k, P] of Object.entries(V.props)) {
        o.properties[k] = finalize(P.s);
        if (P.n === V.n) req.push(k);
      }
      if (req.length) o.required = req;
    }
    return o;
  });
  if (out.length === 0) return {};
  return out.length === 1 ? out[0] : { anyOf: out };
}

// field paths whose observed values were all enum-like codes (names only, no values)
function enumCandidates(schema, prefix = '', acc = []) {
  if (!schema || typeof schema !== 'object') return acc;
  if (schema.anyOf) schema.anyOf.forEach((s) => enumCandidates(s, prefix, acc));
  if (schema.type === 'string' && schema['x-formats'] && Object.keys(schema['x-formats']).every((f) => f === 'enum-like' || f === 'empty') && !schema.enum)
    acc.push(prefix || '(root)');
  if (schema.items) enumCandidates(schema.items, prefix + '[]', acc);
  if (schema.properties) for (const [k, s] of Object.entries(schema.properties)) enumCandidates(s, prefix ? `${prefix}.${k}` : k, acc);
  if (schema.additionalProperties) enumCandidates(schema.additionalProperties, prefix + '{*}', acc);
  return acc;
}

// ---------- read HAR ----------
function loadHar(file) {
let raw;
try {
  raw = fs.readFileSync(file);
} catch (err) {
  console.error(`HAR could not be read: ${err.code || 'unknown error'}`);
  process.exit(1);
}
let text;
if (raw[0] === 0xff && raw[1] === 0xfe) text = raw.subarray(2).toString('utf16le');
else if (raw[0] === 0xfe && raw[1] === 0xff) text = Buffer.from(raw.subarray(2)).swap16().toString('utf16le');
else text = raw.toString('utf8').replace(/^﻿/, '');
let har;
try {
  har = JSON.parse(text);
} catch (err) {
  // only structural hints, never content
  const pos = Number((String(err.message).match(/position (\d+)/) || [])[1]);
  console.error(`HAR is not valid JSON (bytes: ${raw.length}, first char code: ${text.charCodeAt(0)}, error near ${Number.isFinite(pos) ? `${Math.round((pos / text.length) * 100)}% of file` : 'unknown position'})`);
  process.exit(1);
}
return har?.log?.entries ?? [];
}
const inputs = args.filter((a) => !a.startsWith('--'));
const entries = inputs.flatMap(loadHar);

function bodyText(content) {
  if (!content || typeof content.text !== 'string') return null;
  return content.encoding === 'base64' ? Buffer.from(content.text, 'base64').toString('utf8') : content.text;
}
function tryJson(text, mime) {
  if (text == null) return undefined;
  const t = text.trim();
  if (!/json/i.test(mime || '') && !/^[[{]/.test(t)) return undefined;
  try { return JSON.parse(t); } catch { return undefined; }
}
const baseMime = (m) => (m || '').split(';')[0].trim().toLowerCase() || null;

// ---------- pass 1: split URLs, collect static assets ----------
const staticAssets = new Set();
const items = [];
let skippedStatic = 0;
for (const e of entries) {
  let u;
  try { u = new URL(e.request.url); } catch { continue; }
  if (!/^https?:$/.test(u.protocol)) continue;
  const respMime = baseMime(e.response?.content?.mimeType);
  if (STATIC_EXT.test(u.pathname) || STATIC_MIME.test(respMime || '')) {
    skippedStatic++;
    if (/\.m?js$/i.test(u.pathname)) staticAssets.add(`${u.host}${u.pathname}`);
    continue;
  }
  const segs = u.pathname.split('/').map((s) => {
    const clean = s.split(';')[0];
    try { return decodeURIComponent(clean); } catch { return clean; }
  });
  items.push({ e, u, segs, respMime });
}

// ---------- pass 2: templatise path segments ----------
// a) unsafe-looking segments -> {id}/{uuid}/{param}
// b) positions with many distinct literal values under the same parent -> {param}
for (const it of items) it.tpl = it.segs.map((s) => (safeLiteralSegment(s) ? s : `{${segmentKind(s)}}`));
const maxDepth = Math.max(0, ...items.map((i) => i.tpl.length));
for (let d = 0; d < maxDepth; d++) {
  // values that each occur in only ~1 request look like data (e.g. a search
  // term); route names (services, resources) recur across many requests.
  if (d <= 1) continue; // first segment = backend service name
  const groups = new Map();
  for (const it of items) {
    if (d >= it.tpl.length || it.tpl[d].startsWith('{')) continue;
    const key = it.u.host + '|' + it.tpl.slice(0, d).join('/');
    if (!groups.has(key)) groups.set(key, { values: new Set(), total: 0 });
    const g = groups.get(key);
    g.values.add(it.tpl[d]);
    g.total++;
  }
  for (const it of items) {
    if (d >= it.tpl.length || it.tpl[d].startsWith('{')) continue;
    const g = groups.get(it.u.host + '|' + it.tpl.slice(0, d).join('/'));
    if (g.values.size >= 8 && g.values.size / g.total >= 0.6) it.tpl[d] = '{param}';
  }
}

// ---------- pass 3: aggregate per endpoint ----------
const REQ_HEADER_VALUES = new Set(['accept', 'content-type']);
// GraphQL documents are application code, not data. Keep them, but mask any
// inline literals (strings, numbers) in case the client inlined arguments.
function redactGraphql(q) {
  return q
    .replace(/"""[\s\S]*?"""/g, '"<str>"')
    .replace(/"(?:[^"\\]|\\.)*"/g, '"<str>"')
    .replace(/(:\s*)-?\d+(\.\d+)?\b/g, '$1<num>')
    .replace(/[ \t]+/g, ' ')
    .trim();
}
const endpoints = new Map();
for (const { e, u, tpl, respMime } of items) {
  const method = e.request.method;
  const p = tpl.join('/') || '/';
  const pd0 = e.request.postData;
  const reqJson0 = pd0 ? tryJson(pd0.text, pd0.mimeType) : undefined;
  const isGql = reqJson0 && typeof reqJson0 === 'object' && !Array.isArray(reqJson0) && typeof reqJson0.query === 'string';
  const opName = isGql ? (/^[A-Za-z_][A-Za-z0-9_]{0,80}$/.test(reqJson0.operationName || '') ? reqJson0.operationName : '(anonymous)') : null;
  const key = `${method} ${u.host}${p}${opName ? ` #${opName}` : ''}`;
  const ep = endpoints.get(key) ?? {
    method, host: u.host, path: p, calls: 0, graphql: opName ? { operationName: opName, documents: new Set() } : undefined,
    query: {}, requestHeaderNames: new Set(), requestHeaderValues: {}, cookieNames: new Set(),
    requestBody: { mimes: new Set(), formFields: new Set(), schema: newS(), jsonSeen: 0 },
    responses: {},
  };
  endpoints.set(key, ep);
  ep.calls++;
  if (isGql) ep.graphql.documents.add(redactGraphql(reqJson0.query));
  for (const c of e.request.cookies || []) if (c.name) ep.cookieNames.add(c.name);

  for (const k of u.searchParams.keys()) ep.query[k] = (ep.query[k] || 0) + 1;
  for (const h of e.request.headers || []) {
    const n = h.name.toLowerCase();
    if (n.startsWith(':')) continue; // http2 pseudo headers
    ep.requestHeaderNames.add(n);
    if (REQ_HEADER_VALUES.has(n)) (ep.requestHeaderValues[n] ??= new Set()).add(baseMime(h.value));
  }
  const pd = e.request.postData;
  if (pd) {
    ep.requestBody.mimes.add(baseMime(pd.mimeType));
    for (const prm of pd.params || []) ep.requestBody.formFields.add(prm.name);
    let j = reqJson0;
    if (isGql) { j = { ...j }; delete j.query; delete j.operationName; }
    if (j !== undefined) { addValue(ep.requestBody.schema, j); ep.requestBody.jsonSeen++; }
    else if (/x-www-form-urlencoded/i.test(pd.mimeType || '') && pd.text)
      for (const k of new URLSearchParams(pd.text).keys()) ep.requestBody.formFields.add(k);
  }
  const status = String(e.response?.status ?? 0);
  const r = (ep.responses[status] ??= { calls: 0, mimes: new Set(), headerNames: new Set(), schema: newS(), jsonSeen: 0, nonJsonBodies: 0, redirectTo: new Set() });
  r.calls++;
  if (respMime) r.mimes.add(respMime);
  for (const h of e.response?.headers || []) {
    const n = h.name.toLowerCase();
    r.headerNames.add(n);
    if (n === 'location') {
      try { const l = new URL(h.value, u); r.redirectTo.add(`${l.host}${l.pathname.split('/').map((s) => (safeLiteralSegment(s) ? s : '{param}')).join('/')}`); } catch {}
    }
  }
  const j = tryJson(bodyText(e.response?.content), respMime);
  if (j !== undefined) { addValue(r.schema, j); r.jsonSeen++; }
  else if (bodyText(e.response?.content)) r.nonJsonBodies++;
}

// ---------- serialise ----------
const result = [...endpoints.values()]
  .sort((a, b) => (a.host + a.path + a.method).localeCompare(b.host + b.path + b.method))
  .map((ep) => {
    const reqSchema = ep.requestBody.jsonSeen ? finalize(ep.requestBody.schema) : undefined;
    return {
      method: ep.method, host: ep.host, path: ep.path, calls: ep.calls,
      graphql: ep.graphql ? { operationName: ep.graphql.operationName, documents: [...ep.graphql.documents] } : undefined,
      cookieNames: [...ep.cookieNames].sort(),
      queryParams: Object.keys(ep.query).sort(),
      requestHeaderNames: [...ep.requestHeaderNames].sort(),
      requestHeaderValues: Object.fromEntries(Object.entries(ep.requestHeaderValues).map(([k, v]) => [k, [...v].filter(Boolean)])),
      requestBody: ep.requestBody.mimes.size ? {
        mimeTypes: [...ep.requestBody.mimes].filter(Boolean),
        formFields: [...ep.requestBody.formFields].sort(),
        jsonSchema: reqSchema,
      } : undefined,
      responses: Object.fromEntries(Object.entries(ep.responses).map(([s, r]) => [s, {
        calls: r.calls,
        mimeTypes: [...r.mimes],
        headerNames: [...r.headerNames].sort(),
        redirectTo: r.redirectTo.size ? [...r.redirectTo] : undefined,
        jsonSchema: r.jsonSeen ? finalize(r.schema) : undefined,
        nonJsonBodies: r.nonJsonBodies || undefined,
      }])),
    };
  });

const enumFields = new Set();
for (const ep of result) {
  if (ep.requestBody?.jsonSchema) enumCandidates(ep.requestBody.jsonSchema).forEach((f) => enumFields.add(f.split(/[.[{]/).pop() || f));
  for (const r of Object.values(ep.responses)) if (r.jsonSchema) enumCandidates(r.jsonSchema).forEach((f) => enumFields.add(f.split('.').pop().replace(/\[\]|\{\*\}/g, '')));
}

// ---------- markdown for human review ----------
function schemaLines(s, indent = '', name = null, required = true, lines = []) {
  const label = name == null ? '' : `${name}${required ? '' : '?'}: `;
  if (!s || !Object.keys(s).length) { lines.push(`${indent}${label}(empty)`); return lines; }
  if (s.anyOf) {
    lines.push(`${indent}${label}${s.anyOf.map((x) => x.type).join(' | ')}`);
    for (const x of s.anyOf) if (x.properties || x.items || x.additionalProperties) schemaLines(x, indent + '  ', `<${x.type}>`, true, lines);
    return lines;
  }
  let t = s.type;
  if (s['x-formats']) t += `(${Object.keys(s['x-formats']).join('|')})`;
  if (s.enum) t += ` enum[${s.enum.join(', ')}]`;
  if (s.type === 'array') {
    lines.push(`${indent}${label}array of:`);
    schemaLines(s.items, indent + '  ', null, true, lines);
  } else if (s.properties) {
    lines.push(`${indent}${label}object`);
    const req = new Set(s.required || []);
    for (const [k, v] of Object.entries(s.properties)) schemaLines(v, indent + '  ', k, req.has(k), lines);
  } else if (s.additionalProperties) {
    lines.push(`${indent}${label}map<${s['x-map-keys'].join('|')} key, …>`);
    schemaLines(s.additionalProperties, indent + '  ', '{key}', true, lines);
  } else lines.push(`${indent}${label}${t}`);
  return lines;
}

const md = [];
md.push('# Redacted HAR capture: structure only', '');
md.push(`Entries in HAR: ${entries.length}. Static assets skipped: ${skippedStatic}. Endpoints: ${result.length}.`, '');
md.push(`Values kept for fields: ${keep.size ? [...keep].join(', ') : '(none)'}`, '');
md.push('**Review before sharing:** check the path literals and field names below; they are the only capture-derived text besides types.', '');
if (enumFields.size) {
  md.push('## Enum candidates (values withheld)', '', 'These fields only contained UPPER_CASE codes. Re-run with `--keep=` listing the ones you consider safe to get their values:', '');
  md.push([...enumFields].sort().map((f) => `\`${f}\``).join(', '), '');
}
for (const ep of result) {
  md.push(`## ${ep.method} ${ep.host}${ep.path}${ep.graphql ? ` · ${ep.graphql.operationName}` : ''}`, '');
  md.push(`calls: ${ep.calls}` + (ep.queryParams.length ? ` · query: ${ep.queryParams.map((q) => `\`${q}\``).join(', ')}` : '') + (ep.cookieNames.length ? ` · cookies: ${ep.cookieNames.join(', ')}` : ''), '');
  if (ep.graphql) for (const doc of ep.graphql.documents) md.push('```graphql', doc, '```', '');
  if (ep.requestBody) {
    md.push(`Request body (${ep.requestBody.mimeTypes.join(', ')})` + (ep.requestBody.formFields.length ? ` form fields: ${ep.requestBody.formFields.join(', ')}` : ''));
    if (ep.requestBody.jsonSchema) md.push('```', ...schemaLines(ep.requestBody.jsonSchema), '```');
    md.push('');
  }
  for (const [s, r] of Object.entries(ep.responses)) {
    md.push(`**${s}** ×${r.calls} ${r.mimeTypes.join(', ')}${r.redirectTo ? ` → ${r.redirectTo.join(', ')}` : ''}`);
    if (r.jsonSchema) md.push('```', ...schemaLines(r.jsonSchema), '```');
    md.push('');
  }
}
md.push('## JS bundles seen (paths only)', '', ...[...staticAssets].sort().map((a) => `- ${a}`), '');

fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const jsonOut = path.join(outDir, `endpoints-${stamp}.json`);
const mdOut = path.join(outDir, `endpoints-${stamp}.md`);
fs.writeFileSync(jsonOut, JSON.stringify({ generatedAt: new Date().toISOString(), keptValuesFor: [...keep], jsBundles: [...staticAssets].sort(), endpoints: result }, null, 2));
fs.writeFileSync(mdOut, md.join('\n'));

console.log(`entries: ${entries.length}, static skipped: ${skippedStatic}, endpoints: ${result.length}, enum candidates: ${enumFields.size}`);
console.log(`wrote ${jsonOut}`);
console.log(`wrote ${mdOut}`);

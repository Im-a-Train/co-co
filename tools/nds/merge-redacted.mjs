#!/usr/bin/env node
// Merges several redacted captures (endpoints-*.json from har-redact.mjs) into
// one, so the OpenAPI spec can grow across captures without keeping raw HARs.
// Inputs hold structure only (types, names, whitelisted enum codes), never
// captured values, so this tool never touches personal data.
//
// Usage: node tools/nds/merge-redacted.mjs <a.json> <b.json> [...] [--out=captures/redacted/endpoints-merged.json]

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const inputs = args.filter((a) => !a.startsWith('--'));
const outFile = (args.find((a) => a.startsWith('--out=')) || '--out=captures/redacted/endpoints-merged.json').slice(6);
if (inputs.length < 2) {
  console.error('usage: node tools/nds/merge-redacted.mjs <a.json> <b.json> [...] [--out=file]');
  process.exit(2);
}

const union = (a = [], b = []) => [...new Set([...a, ...b])];
const sortedUnion = (a, b) => union(a, b).sort();

// ---------- schema merge (finalized har-redact schemas) ----------
const variants = (s) => (!s || !Object.keys(s).length ? [] : s.anyOf ? s.anyOf : [s]);
const variantKey = (v) => (v.type === 'object' && v.additionalProperties && !v.properties ? 'map' : v.type);

function mergeVariant(a, b) {
  const o = { ...a };
  if (a.type === 'string') {
    const fa = a['x-formats'] ?? { text: 1 };
    const fb = b['x-formats'] ?? { text: 1 };
    const f = { ...fa };
    for (const [k, n] of Object.entries(fb)) f[k] = (f[k] || 0) + n;
    if (Object.keys(f).length === 1 && f.text) delete o['x-formats'];
    else o['x-formats'] = f;
    o['x-max-length'] = Math.max(a['x-max-length'] || 0, b['x-max-length'] || 0);
  }
  if (a.enum || b.enum) o.enum = sortedUnion(a.enum, b.enum);
  if (a.type === 'array') o.items = mergeSchema(a.items, b.items);
  if (variantKey(a) === 'map') {
    o['x-map-keys'] = union(a['x-map-keys'], b['x-map-keys']);
    o.additionalProperties = mergeSchema(a.additionalProperties, b.additionalProperties);
  } else if (a.type === 'object') {
    o.properties = { ...(a.properties || {}) };
    for (const [k, v] of Object.entries(b.properties || {})) o.properties[k] = mergeSchema(o.properties[k], v);
    const rb = new Set(b.required || []);
    const req = (a.required || []).filter((k) => rb.has(k));
    if (req.length) o.required = req;
    else delete o.required;
  }
  return o;
}

function mergeSchema(a, b) {
  if (!a || !Object.keys(a).length) return b ?? a;
  if (!b || !Object.keys(b).length) return a;
  const byKey = new Map();
  for (const v of [...variants(a), ...variants(b)]) {
    const k = variantKey(v);
    byKey.set(k, byKey.has(k) ? mergeVariant(byKey.get(k), v) : v);
  }
  const out = [...byKey.values()];
  return out.length === 1 ? out[0] : { anyOf: out };
}

// ---------- endpoint merge ----------
const epKey = (e) => `${e.method} ${e.host}${e.path}${e.graphql ? ` #${e.graphql.operationName}` : ''}`;

function mergeEndpoint(a, b) {
  const o = { ...a, calls: a.calls + b.calls };
  if (a.graphql) o.graphql = { operationName: a.graphql.operationName, documents: union(a.graphql.documents, b.graphql.documents) };
  o.cookieNames = sortedUnion(a.cookieNames, b.cookieNames);
  o.queryParams = sortedUnion(a.queryParams, b.queryParams);
  o.requestHeaderNames = sortedUnion(a.requestHeaderNames, b.requestHeaderNames);
  o.requestHeaderValues = { ...a.requestHeaderValues };
  for (const [k, v] of Object.entries(b.requestHeaderValues || {})) o.requestHeaderValues[k] = union(o.requestHeaderValues[k], v);
  if (a.requestBody || b.requestBody) {
    const ra = a.requestBody || {};
    const rb = b.requestBody || {};
    o.requestBody = {
      mimeTypes: union(ra.mimeTypes, rb.mimeTypes),
      formFields: sortedUnion(ra.formFields, rb.formFields),
      jsonSchema: mergeSchema(ra.jsonSchema, rb.jsonSchema),
    };
  }
  o.responses = { ...a.responses };
  for (const [s, r] of Object.entries(b.responses || {})) {
    const p = o.responses[s];
    o.responses[s] = !p ? r : {
      calls: p.calls + r.calls,
      mimeTypes: union(p.mimeTypes, r.mimeTypes),
      headerNames: sortedUnion(p.headerNames, r.headerNames),
      redirectTo: p.redirectTo || r.redirectTo ? union(p.redirectTo, r.redirectTo) : undefined,
      jsonSchema: mergeSchema(p.jsonSchema, r.jsonSchema),
      nonJsonBodies: (p.nonJsonBodies || 0) + (r.nonJsonBodies || 0) || undefined,
    };
  }
  return o;
}

const caps = inputs.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
const endpoints = new Map();
for (const cap of caps)
  for (const ep of cap.endpoints) {
    const k = epKey(ep);
    endpoints.set(k, endpoints.has(k) ? mergeEndpoint(endpoints.get(k), ep) : ep);
  }

const result = {
  generatedAt: new Date().toISOString(),
  mergedFrom: inputs.map((f) => path.basename(f)),
  keptValuesFor: caps.reduce((acc, c) => union(acc, c.keptValuesFor), []),
  jsBundles: caps.reduce((acc, c) => sortedUnion(acc, c.jsBundles), []),
  endpoints: [...endpoints.values()].sort((a, b) => (a.host + a.path + a.method).localeCompare(b.host + b.path + b.method)),
};
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
console.log(`inputs: ${inputs.length}, endpoints: ${result.endpoints.length}`);
console.log(`wrote ${outFile}`);

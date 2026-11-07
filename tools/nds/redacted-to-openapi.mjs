#!/usr/bin/env node
// Builds an OpenAPI 3.1 spec (read-only subset) plus a GraphQL operations file
// from the redacted capture produced by har-redact.mjs. Input contains no
// personal data (structure + whitelisted enum codes only).
//
// Usage: node tools/redacted-to-openapi.mjs <endpoints.json> [--out=docs/nds-api]

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith('--'));
const outDir = (args.find((a) => a.startsWith('--out=')) || '--out=docs/nds-api').slice(6);
const cap = JSON.parse(fs.readFileSync(input, 'utf8'));

const READ_ONLY = (ep) => ep.method === 'GET' || (ep.method === 'POST' && ep.graphql && !/^\s*mutation\b/.test(ep.graphql.documents[0] || ''));

// ---------- schema cleanup ----------
const FORMAT_MAP = { date: 'date', 'date-time': 'date-time', uuid: 'uuid', email: 'email', uri: 'uri', time: 'time' };

function clean(s) {
  if (!s || !Object.keys(s).length) return {};
  if (s.anyOf) {
    const nonNull = s.anyOf.filter((x) => x.type !== 'null');
    const hasNull = nonNull.length < s.anyOf.length;
    if (nonNull.length === 1) return withNull(clean(nonNull[0]), hasNull);
    const out = { anyOf: nonNull.map(clean) };
    if (hasNull) out.anyOf.push({ type: 'null' });
    return out;
  }
  if (s.type === 'null') return { description: 'Only null observed in captures; actual type unknown.' };
  const o = { type: s.type };
  if (s.type === 'string') {
    const f = Object.keys(s['x-formats'] || {}).filter((x) => x !== 'empty');
    if (f.length === 1 && FORMAT_MAP[f[0]]) o.format = FORMAT_MAP[f[0]];
    else if (f.length === 1 && f[0] === 'numeric-string') o.pattern = '^-?\\d+$';
    else if (f.length === 1 && f[0] === 'ahv-number') { o.pattern = '^756\\.?\\d{4}\\.?\\d{4}\\.?\\d{2}$'; o.description = 'AHV/AVS number (AHVN13). Sensitive: systematic use restricted by AHVG Art. 153c ff.'; }
    if (s.enum) o.enum = s.enum;
  }
  if (['integer', 'number', 'boolean'].includes(s.type) && s.enum && s.type !== 'boolean') o.enum = s.enum;
  if (s.type === 'array') o.items = clean(s.items);
  if (s.type === 'object') {
    if (s.properties) {
      o.properties = {};
      for (const [k, v] of Object.entries(s.properties)) o.properties[k] = clean(v);
    }
    if (s.additionalProperties) o.additionalProperties = clean(s.additionalProperties);
  }
  return o;
}
function withNull(s, hasNull) {
  if (!hasNull) return s;
  if (s.type && typeof s.type === 'string') return { ...s, type: [s.type, 'null'] };
  return { anyOf: [s, { type: 'null' }] };
}

// ---------- shared component extraction (structural dedupe) ----------
const components = {};
const bySignature = new Map();
const KNOWN = [
  [['de', 'fr', 'it'], 'LocalizedString'],
  [['de', 'fr', 'it', 'resolvedDe', 'resolvedFr', 'resolvedIt'], 'ResolvedLocalizedString'],
  [['first', 'last'], 'DateRange'],
  [['content', 'number', 'size', 'totalElements', 'totalPages'], null], // pages are named by their parent
];
const KEY_ALIAS = {
  officialAddress: 'Address', correspondenceAddress: 'Address', privateAddress: 'Address', businessAddress: 'Address', legalSeat: 'Address', personAddress: 'Address', destination: 'Address',
  manager: 'Person', coach: 'Person', organisationManager: 'Person', responsiblePerson: 'Person', person: 'Person',
  organisation: 'Organisation', grantingBody: 'Organisation', association: 'Organisation', parentOrganisation: 'Organisation',
  title: 'LocalizedString', name: 'LocalizedString', shortName: 'LocalizedString', rowTitle: 'LocalizedString', topic: 'LocalizedString',
  mainSport: 'Sport', sports: 'Sport', sportsYouthTraining: 'Sport', coveredSports: 'Sport',
  duration: 'DateRange', validityYouthTraining: 'DateRange', validitySquadTraining: 'DateRange', validityRiskActivity: 'DateRange',
  _availableOptions: 'AvailableOptions',
};
const pascal = (k) => k.replace(/^_+/, '').replace(/(^|[^A-Za-z0-9])([a-z])/g, (_, a, b) => b.toUpperCase()).replace(/^[a-z]/, (c) => c.toUpperCase()) || 'Object';
function nameFor(key, props, parent) {
  const sorted = [...props].sort().join(',');
  for (const [k, n] of KNOWN) if (n && k.slice().sort().join(',') === sorted) return n;
  if (key === 'content') return `${pascal(parent || 'List')}Item`;
  if (key === '_availableOptions') return `${pascal(parent || 'Entity')}Options`;
  if (KEY_ALIAS[key]) return KEY_ALIAS[key];
  return pascal(key || 'Object');
}
// Collect every object occurrence per component name; merged into one superset schema afterwards.
const groups = new Map();
function extract(s, key, parent) {
  if (!s || typeof s !== 'object') return s;
  if (s.anyOf) return { ...s, anyOf: s.anyOf.map((x) => extract(x, key, parent)) };
  if (s.items) s = { ...s, items: extract(s.items, key, parent) };
  if (s.additionalProperties) s = { ...s, additionalProperties: extract(s.additionalProperties, key, parent) };
  if (s.properties) {
    const props = {};
    for (const [k, v] of Object.entries(s.properties)) {
      if (k === '__typename') continue; // GraphQL client artefact
      props[k] = extract(v, k, key === 'content' ? parent : key || parent);
    }
    s = { ...s, properties: props };
    const keys = Object.keys(props);
    const name = key && nameFor(key, keys, parent);
    if (key && keys.length >= 2 && (keys.length >= 3 || name !== pascal(key))) {
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(s);
      return { $ref: `#/components/schemas/${name}` };
    }
  }
  return s;
}

const isNullOnly = (x) => x && !x.type && !x.anyOf && !x.$ref && !x.properties && !x.items;
function nullable(x) {
  if (x.$ref || x.anyOf) return x.anyOf?.some((y) => y.type === 'null') ? x : { anyOf: [...(x.anyOf || [x]), { type: 'null' }] };
  const t = Array.isArray(x.type) ? x.type : [x.type];
  return t.includes('null') ? x : { ...x, type: [...t, 'null'] };
}
const baseType = (x) => (Array.isArray(x.type) ? x.type.filter((t) => t !== 'null') : [x.type]).join('|');
const hasNull = (x) => Array.isArray(x.type) && x.type.includes('null');
function merge(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (isNullOnly(a)) return isNullOnly(b) ? a : nullable(b);
  if (isNullOnly(b)) return nullable(a);
  if (JSON.stringify(a) === JSON.stringify(b)) return a;
  if (a.$ref || b.$ref || a.anyOf || b.anyOf) {
    const opts = [...(a.anyOf || [a]), ...(b.anyOf || [b])];
    const uniq = opts.filter((x, i) => opts.findIndex((y) => JSON.stringify(y) === JSON.stringify(x)) === i);
    return uniq.length === 1 ? uniq[0] : { anyOf: uniq };
  }
  if (baseType(a) !== baseType(b)) return { anyOf: [a, b] };
  const o = { ...a };
  if (hasNull(a) || hasNull(b)) o.type = [baseType(a), 'null'];
  if (a.format !== b.format) delete o.format;
  if (a.pattern !== b.pattern) delete o.pattern;
  if (a.description !== b.description) o.description = a.description || b.description;
  if (a.enum || b.enum) o.enum = [...new Set([...(a.enum || []), ...(b.enum || [])])].sort();
  if (a.items || b.items) o.items = merge(a.items, b.items);
  if (a.properties || b.properties) {
    o.properties = { ...(a.properties || {}) };
    for (const [k, v] of Object.entries(b.properties || {})) o.properties[k] = merge(o.properties[k], v);
  }
  if (a.additionalProperties || b.additionalProperties) o.additionalProperties = merge(a.additionalProperties, b.additionalProperties);
  return o;
}
function finalizeComponents() {
  for (const [name, list] of groups) {
    const merged = list.reduce((acc, s) => merge(acc, s), null);
    components[name] = components[name] ? merge(components[name], merged) : merged;
    if (list.length > 1) components[name]['x-merged-from-occurrences'] = list.length;
  }
}

// ---------- paths ----------
const PARAM_NAME_OVERRIDE = { frontend: 'frontendApp' };
const lcFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
function templatePath(p) {
  const segs = p.split('/');
  const params = [];
  const out = segs.map((s, i) => {
    if (!/^\{(id|param|uuid|hash)\}$/.test(s)) return s;
    const prev = segs[i - 1] || 'resource';
    let name = PARAM_NAME_OVERRIDE[prev] || (/Id$/.test(prev) ? prev : `${lcFirst(prev)}Id`);
    while (params.some((x) => x.name === name)) name += '2';
    params.push({ name, kind: s });
    return `{${name}}`;
  });
  return { path: out.join('/'), params };
}
function operationId(method, p) {
  const words = p.split('/').filter(Boolean).filter((s) => !s.startsWith('{')).filter((s, i, a) => a.indexOf(s) === i);
  return lcFirst(method.toLowerCase()) + words.map(pascal).join('');
}
const SERVICE_DESC = {
  perorgfin: 'Persons, organisations, finance (bank accounts, financial transactions). Also hosts the Keycloak OAuth2 login entry point.',
  youthtraining: 'J+S Jugendausbildung: offers (Angebote), camps (Lager), courses, activities, participants, attendance.',
  cadre: 'Kaderbildung (cadre education): course plan, education structure, personal trainings and further education.',
  document: 'Documents attached to offers, camps, organisations.',
  material: 'Rental material orders (Leihmaterial) for camps/courses.',
  workflow: 'Person tasks and notifications.',
  personal: 'Per-user UI settings: table configs, start page, maintenance info.',
  frontend: 'Static UI texts (i18n).',
};
const OP_DESC = [
  [/availableOptions|availableFlsOptions/, 'Permission flags for the logged-in user (what the UI may show/do).'],
  [/staticText/, 'Localized static UI texts; filter by `language` and key `pattern`.'],
  [/tableConfig/, 'Saved table layout of the logged-in user for a UI route.'],
  [/\/expand$/, 'Fully expanded entity including nested persons and addresses.'],
];

const paths = {};
const gqlByPath = new Map();
const tags = new Set();
let skippedWrites = 0;

for (const ep of cap.endpoints) {
  if (!READ_ONLY(ep)) { skippedWrites++; continue; }
  const service = ep.path.split('/')[1];
  tags.add(service);
  if (ep.graphql) {
    if (!gqlByPath.has(ep.path)) gqlByPath.set(ep.path, []);
    gqlByPath.get(ep.path).push(ep);
    continue;
  }
  const { path: p, params } = templatePath(ep.path);
  const parameters = [
    ...params.map((x) => ({ name: x.name, in: 'path', required: true, schema: x.kind === 'id' ? { type: 'string', pattern: '^\\d+$' } : { type: 'string' } })),
    ...ep.queryParams.map((q) => ({ name: q, in: 'query', required: false, schema: { type: 'string' } })),
    { $ref: '#/components/parameters/DefaultLanguage' },
  ];
  const responses = {};
  for (const [status, r] of Object.entries(ep.responses)) {
    if (status === '0') continue; // aborted in browser
    const resp = { description: status.startsWith('2') ? 'OK' : `Observed status ${status}` };
    if (r.jsonSchema) resp.content = { 'application/json': { schema: extract(clean(r.jsonSchema), pascal(operationId('', ep.path)) + 'Response') } };
    else if (r.mimeTypes.length) resp.content = Object.fromEntries(r.mimeTypes.map((m) => [m, {}]));
    responses[status] = resp;
  }
  if (!Object.keys(responses).length) responses['200'] = { description: 'Not observed (request aborted during capture).' };
  responses['401'] = { $ref: '#/components/responses/Unauthenticated' };
  const desc = OP_DESC.find(([re]) => re.test(ep.path));
  (paths[p] ??= {})[ep.method.toLowerCase()] = {
    tags: [service],
    operationId: operationId(ep.method, ep.path),
    summary: ep.path.split('/').slice(2).filter((s) => s && !s.startsWith('{')).filter((s, i, a) => a.indexOf(s) === i && !['admin'].includes(s)).join(' › '),
    ...(desc ? { description: desc[1] } : {}),
    parameters,
    responses,
    'x-observed-calls': ep.calls,
  };
}

// GraphQL: one POST per service endpoint, request/response as oneOf per operation
const gqlDocs = [];
for (const [p, eps] of gqlByPath) {
  const service = p.split('/')[1];
  const reqs = [], resps = [];
  for (const ep of eps) {
    const op = ep.graphql.operationName;
    const vars = ep.requestBody?.jsonSchema?.properties?.variables;
    const reqName = `${pascal(op)}Request`;
    components[reqName] = {
      type: 'object',
      required: ['operationName', 'query', 'variables'],
      properties: {
        operationName: { const: op },
        query: { type: 'string', description: `GraphQL document \`${op}\`, see operations.graphql` },
        variables: vars ? extract(clean(vars), `${op}Variables`) : { type: 'object' },
      },
    };
    reqs.push({ $ref: `#/components/schemas/${reqName}` });
    const r = ep.responses['200'];
    if (r?.jsonSchema) resps.push(extract(clean(r.jsonSchema), `${op}Response`));
    gqlDocs.push({ service, path: p, op, doc: ep.graphql.documents[0], calls: ep.calls });
  }
  tags.add(service);
  paths[p] = {
    post: {
      tags: [service],
      operationId: `graphql${pascal(service)}`,
      summary: `GraphQL endpoint of the ${service} service`,
      description: `Apollo-style GraphQL over POST. Observed operations: ${eps.map((e) => `\`${e.graphql.operationName}\``).join(', ')}. Documents in operations.graphql. Pagination via \`chunk { size, page, sort[{name, direction}] }\`, results as \`{content, totalElements, totalPages, number, size}\`.`,
      parameters: [{ $ref: '#/components/parameters/DefaultLanguage' }],
      requestBody: { required: true, content: { 'application/json': { schema: { oneOf: reqs, discriminator: { propertyName: 'operationName' } } } } },
      responses: {
        200: { description: 'GraphQL result (errors are reported in `errors`, HTTP status stays 200)', content: { 'application/json': { schema: { oneOf: resps } } } },
        401: { $ref: '#/components/responses/Unauthenticated' },
      },
      'x-graphql-operations': eps.map((e) => e.graphql.operationName),
    },
  };
}

finalizeComponents();
const spec = {
  openapi: '3.1.0',
  info: {
    title: 'NDS (Nationale Datenbank Sport) – internal web API (reverse engineered, read-only)',
    version: `capture-${(cap.generatedAt || '').slice(0, 10)}`,
    description: [
      'Unofficial description of the backend used by the NDS web UI (www.nds.baspo.admin.ch), derived from redacted browser captures.',
      'Not the official partner "Standard-API" (api.baspo.admin.ch/nds/api, Kaderbildung only).',
      '',
      '**Caveats**',
      '- Schemas reflect only what was observed: optional/required is unknown, fields seen only as `null` have unknown type, enums list observed values only.',
      '- Only read operations are included.',
      '- Using this API outside the official UI may violate the NDS terms of use; obtain BASPO approval before integrating.',
      '',
      '**Authentication**: browser session. Login via AGOV → Keycloak (`GET /perorgfin/oauth2/authorization/keycloak?clientRoute=…`), which sets the `SESSION` cookie. `cookiesession1` is a load-balancer cookie, `LANG` the UI language. No bearer token or CSRF header was observed on read requests.',
    ].join('\n'),
  },
  servers: [{ url: 'https://www.nds.baspo.admin.ch', description: 'Production (web UI backend)' }],
  security: [{ sessionCookie: [] }],
  tags: [...tags].sort().map((t) => ({ name: t, description: SERVICE_DESC[t] || '' })),
  paths: Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b))),
  components: {
    securitySchemes: {
      sessionCookie: { type: 'apiKey', in: 'cookie', name: 'SESSION', description: 'Spring Session cookie obtained through the AGOV/Keycloak login flow.' },
    },
    parameters: {
      DefaultLanguage: { name: 'default-language', in: 'header', required: false, description: 'UI language sent by the web client (de/fr/it).', schema: { type: 'string', enum: ['de', 'fr', 'it'] } },
    },
    responses: {
      Unauthenticated: { description: 'No or expired session (browser is redirected to the Keycloak login).' },
    },
    schemas: Object.fromEntries(Object.entries(components).sort(([a], [b]) => a.localeCompare(b))),
  },
};

// ---------- YAML writer (JSON-compatible scalars) ----------
function yaml(v, ind = '') {
  if (v === null) return 'null';
  if (typeof v !== 'object') return typeof v === 'string' ? (v.includes('\n') ? `|-\n${v.split('\n').map((l) => ind + '  ' + l).join('\n')}` : JSON.stringify(v)) : String(v);
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    return '\n' + v.map((x) => `${ind}- ${yaml(x, ind + '  ').replace(/^\n\s*/, '')}`).join('\n');
  }
  const ks = Object.keys(v);
  if (!ks.length) return '{}';
  return '\n' + ks.map((k) => {
    const key = /^[A-Za-z_$][\w$.-]*$/.test(k) ? k : JSON.stringify(k);
    const val = yaml(v[k], ind + '  ');
    return `${ind}${key}:${val.startsWith('\n') ? val : ' ' + val}`;
  }).join('\n');
}

// ---------- GraphQL file with re-indentation ----------
function reindent(doc) {
  let depth = 0;
  return doc.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    if (/^[}\)]/.test(l)) depth = Math.max(0, depth - 1);
    const line = '  '.repeat(depth) + l;
    if (/[{(]$/.test(l)) depth++;
    return line;
  }).join('\n');
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'openapi.yaml'), yaml(spec).replace(/^\n/, '') + '\n');
const gql = ['# NDS GraphQL operations observed in the web UI (read-only).', '# Inline literals were masked as "<str>" / <num> during redaction.', ''];
let lastPath = '';
for (const g of gqlDocs.sort((a, b) => (a.path + a.op).localeCompare(b.path + b.op))) {
  if (g.path !== lastPath) { gql.push('', `# ==== POST ${g.path} ====`, ''); lastPath = g.path; }
  gql.push(reindent(g.doc), '');
}
fs.writeFileSync(path.join(outDir, 'operations.graphql'), gql.join('\n'));
console.log(`paths: ${Object.keys(paths).length}, graphql operations: ${gqlDocs.length}, schemas: ${Object.keys(components).length}, skipped writes: ${skippedWrites}`);

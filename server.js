const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (!key) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT || 3000);
const DATA_FILE = path.join(__dirname, 'data', 'stock_wt.CSV');
const PAGE_SIZE = Number(process.env.PAGE_SIZE || 20);
const INDEX_HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const CSV_SOURCE = String(process.env.CSV_SOURCE || '').trim().toLowerCase() || (process.env.GITHUB_RAW_URL_WT || process.env.GITHUB_RAW_URL ? 'github' : 'local');
const GITHUB_RAW_URL_WT = process.env.GITHUB_RAW_URL_WT || process.env.GITHUB_RAW_URL || '';
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 60_000);

function parseCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  const normalized = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    const next = normalized[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (next === '"') {
          field += '"';
          i += 1;
        } else if (next === ',' || next === '\n' || next === '\r' || next === undefined) {
          inQuotes = false;
        } else {
          field += '"';
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      if (field === '') {
        inQuotes = true;
      } else {
        field += '"';
      }
      continue;
    }

    if (char === ',') {
      row.push(field);
      field = '';
      continue;
    }

    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }

    field += char;
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function normalizeSku(value) {
  return String(value || '').trim().toUpperCase();
}

function toNumber(value) {
  const raw = String(value ?? '').replace(/,/g, '').trim();
  if (!raw) return 0;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function loadInventory() {
  return [];
}

function loadInventoryFromText(text) {
  const rows = parseCsv(text);
  const items = [];

  for (const row of rows) {
    const sku = normalizeSku(row[3]);
    if (!/^[A-Z0-9][A-Z0-9\-_.]{2,}$/.test(sku)) continue;

    items.push({
      sku,
      name: String(row[4] || '').trim(),
      branch: 'WT',
      warehouse: 'Music Concept WT',
      stock: toNumber(row[10]),
    });
  }

  return items;
}

async function fetchRemoteText(url) {
  if (!url) throw new Error('Missing GITHUB_RAW_URL_WT or GITHUB_RAW_URL');
  const response = await fetch(url, {
    headers: {
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Failed to fetch remote CSV: ${response.status} ${text.slice(0, 200)}`);
  }
  return text;
}

function buildCatalog(items) {
  const bySku = new Map();

  for (const item of items) {
    if (!bySku.has(item.sku)) {
      bySku.set(item.sku, { sku: item.sku, name: item.name, entries: [] });
    }

    const product = bySku.get(item.sku);
    if (!product.name && item.name) product.name = item.name;
    product.entries.push({
      branch: item.branch,
      warehouse: item.warehouse,
      stock: item.stock,
    });
  }

  return bySku;
}

function summarize(product) {
  const branches = [];
  let available_stock = 0;

  for (const entry of product.entries) {
    available_stock += entry.stock;
    branches.push({
      branch: entry.branch,
      warehouse: entry.warehouse,
      stock: entry.stock,
    });
  }

  return {
    mode: 'exact',
    sku: product.sku,
    name: product.name,
    available_stock,
    branches,
  };
}

function search(query, catalog, page = 1) {
  const raw = String(query || '').trim();
  if (!raw) return null;

  const normalized = normalizeSku(raw);
  if (catalog.has(normalized)) return summarize(catalog.get(normalized));

  if (/^[A-Z0-9][A-Z0-9\-_.]*$/.test(normalized)) {
    const allMatches = Array.from(catalog.values())
      .filter((product) => product.sku.startsWith(normalized))
      .sort((a, b) => a.sku.localeCompare(b.sku, 'en'))
      .map(summarize);
    if (allMatches.length === 1) {
      return {
        ...allMatches[0],
        mode: 'prefix',
        query: raw,
        total_matches: allMatches.length,
        shown_matches: allMatches.length,
        page: 1,
        total_pages: 1,
      };
    }

    if (allMatches.length > 1) {
      const totalPages = Math.max(1, Math.ceil(allMatches.length / PAGE_SIZE));
      const currentPage = Math.min(Math.max(1, Number.parseInt(page, 10) || 1), totalPages);
      const start = (currentPage - 1) * PAGE_SIZE;
      const matches = allMatches.slice(start, start + PAGE_SIZE);
      return {
        mode: 'prefix',
        query: raw,
        total_matches: allMatches.length,
        shown_matches: matches.length,
        page: currentPage,
        total_pages: totalPages,
        matches,
      };
    }
  }

  const allMatches = Array.from(catalog.values())
    .filter((product) => String(product.name || '').toLowerCase().includes(raw.toLowerCase()))
    .sort((a, b) => a.sku.localeCompare(b.sku, 'en'))
    .map(summarize);
  if (allMatches.length === 1) {
    return {
      ...allMatches[0],
      mode: 'name',
      query: raw,
      total_matches: allMatches.length,
      shown_matches: allMatches.length,
      page: 1,
      total_pages: 1,
    };
  }

  if (allMatches.length > 1) {
    const totalPages = Math.max(1, Math.ceil(allMatches.length / PAGE_SIZE));
    const currentPage = Math.min(Math.max(1, Number.parseInt(page, 10) || 1), totalPages);
    const start = (currentPage - 1) * PAGE_SIZE;
    const matches = allMatches.slice(start, start + PAGE_SIZE);
    return {
      mode: 'name',
      query: raw,
      total_matches: allMatches.length,
      shown_matches: matches.length,
      page: currentPage,
      total_pages: totalPages,
      matches,
    };
  }

  return null;
}

function renderIndex({ sku = '', result = null, error = '', source = CSV_SOURCE }) {
  const sourceLabel = source === 'github' ? 'GitHub' : 'Local';
  const updatedAt = cache.loadedAt ? new Date(cache.loadedAt).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '-';
  return INDEX_HTML
    .replaceAll('%%INITIAL_SKU%%', sku.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'))
    .replaceAll('%%INITIAL_RESULT%%', result ? JSON.stringify(result) : 'null')
    .replaceAll('%%INITIAL_ERROR%%', error.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'))
    .replaceAll('%%INITIAL_SOURCE%%', source)
    .replaceAll('%%INITIAL_SOURCE_LABEL%%', sourceLabel)
    .replaceAll('%%INITIAL_UPDATED_AT%%', updatedAt);
}

let cache = { fingerprint: '', loadedAt: 0, catalog: new Map(), inventory: [] };

async function refreshIfNeeded() {
  const now = Date.now();
  if (cache.loadedAt && (now - cache.loadedAt) < CACHE_TTL_MS) return cache;

  let fingerprint = '';
  let inventory = [];

  if (CSV_SOURCE === 'github') {
    const text = await fetchRemoteText(GITHUB_RAW_URL_WT);
    fingerprint = `remote:${crypto.createHash('sha1').update(text).digest('hex')}`;
    if (fingerprint === cache.fingerprint) {
      cache.loadedAt = now;
      return cache;
    }
    inventory = loadInventoryFromText(text);
  } else {
    const stat = fs.existsSync(DATA_FILE) ? fs.statSync(DATA_FILE) : null;
    const mtimeMs = stat ? stat.mtimeMs : 0;
    fingerprint = `local:${mtimeMs}`;
    if (fingerprint === cache.fingerprint) {
      cache.loadedAt = now;
      return cache;
    }
    if (!stat) {
      inventory = [];
    } else {
      const text = fs.readFileSync(DATA_FILE, 'latin1');
      inventory = loadInventoryFromText(text);
    }
  }

  cache = {
    fingerprint,
    loadedAt: now,
    inventory,
    catalog: buildCatalog(inventory),
  };
  console.log(`Loaded ${inventory.length} rows, ${cache.catalog.size} unique SKUs from ${CSV_SOURCE}.`);
  return cache;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let state;
  try {
    state = await refreshIfNeeded();
  } catch (error) {
    const message = error && error.message ? error.message : 'Failed to load inventory';
    if (url.pathname === '/health') {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: message }));
      return;
    }
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderIndex({ sku: '', result: null, error: message }));
      return;
    }
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'load_failed', message }));
    return;
  }

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      ok: true,
      rows: state.inventory.length,
      skus: state.catalog.size,
      source: CSV_SOURCE,
      updated_at: cache.loadedAt ? new Date(cache.loadedAt).toISOString() : null,
    }));
    return;
  }

  if (url.pathname === '/search') {
    const query = url.searchParams.get('sku') || url.searchParams.get('q') || '';
    const page = url.searchParams.get('page') || '1';
    const result = search(query, state.catalog, page);
    if (!result) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'not_found', message: 'ไม่พบสินค้า', query }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      ...result,
      source: CSV_SOURCE,
      updated_at: cache.loadedAt ? new Date(cache.loadedAt).toISOString() : null,
    }));
    return;
  }

  if (url.pathname === '/') {
    const initialSku = url.searchParams.get('sku') || '';
    const initialError = url.searchParams.get('error') || '';
    const page = url.searchParams.get('page') || '1';
    const initialResult = initialSku ? search(initialSku, state.catalog, page) : null;

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderIndex({ sku: initialSku, result: initialResult, error: initialError, source: CSV_SOURCE }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Local stock checker running at http://localhost:${PORT}`);
});

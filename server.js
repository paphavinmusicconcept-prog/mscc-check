const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { TextDecoder } = require('util');
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
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILES = (process.env.DATA_FILES || [
  'stock_mscc.CSV',
  'stock_mscc_werehouse.CSV',
  'stock_beh_hq.CSV',
  'stock_beh_werehouse.CSV',
].join(','))
  .split(',')
  .map((file) => file.trim())
  .filter(Boolean)
  .map((file) => path.join(DATA_DIR, file));
const PAGE_SIZE = Number(process.env.PAGE_SIZE || 20);
const INDEX_HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const CSV_SOURCE = String(process.env.CSV_SOURCE || '').trim().toLowerCase() || (process.env.GITHUB_RAW_URLS || process.env.GITHUB_RAW_URL_WT || process.env.GITHUB_RAW_URL ? 'github' : 'local');
const GITHUB_RAW_URLS = (process.env.GITHUB_RAW_URLS || '')
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean);
const GITHUB_RAW_URL_WT = process.env.GITHUB_RAW_URL_WT || process.env.GITHUB_RAW_URL || '';
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 60_000);
const CSV_DECODER = new TextDecoder('windows-874');

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

const SECTION_META = {
  '01': { branch: '01', warehouse: 'คลังมิวสิกคอนเซพท์' },
  '02': { branch: '02', warehouse: 'ใบยืมมิวสิกคอนเซพท์' },
  '03': { branch: '03', warehouse: 'สินค้ารออะไหล่, เสีย - มิวสิกคอนเซพท์' },
  '04': { branch: '04', warehouse: 'สินค้าฝากขาย' },
  '05': { branch: '05', warehouse: 'จองสินค้า, มัดจำสินค้า' },
  '06': { branch: '06', warehouse: 'คลังฝาก มิวสิกคอนเซพท์ - สนง.เพชรบุรี' },
};

const DISPLAY_WAREHOUSES = new Map([
  ['stock_beh_hq.csv|01|คลังเบ๊', 'คลังเบ๊'],
  ['stock_mscc.csv|01|คลังมิวสิกคอนเซพท์', 'คลังมิวสิกคอนเซพท์'],
  ['stock_mscc_werehouse.csv|04|คลังสำนักงานเพชรบุรีตัดใหม่', 'คลังสำนักงานเพชรบุรีตัดใหม่'],
  ['stock_beh_werehouse.csv|04|คลังสำนักงานเพชรบุรีตัดใหม่', 'คลังสำนักงานเพชรบุรีตัดใหม่'],
  ['stock_mscc.csv|06|คลังฝาก มิวสิกคอนเซพท์ - สนง.เพชรบุรี', 'คลังฝาก MSCC'],
  ['stock_mscc_werehouse.csv|07|เบ๊จองสินค้า-เพชรบุรีฯ', 'เบ๊จอง คลังเพชรบุรีฯ'],
  ['stock_beh_werehouse.csv|07|เบ๊จอง สินค้าคลังเพชรบุรีฯ', 'เบ๊จอง คลังเพชรบุรีฯ'],
  ['stock_beh_werehouse.csv|08|มิวสิกจอง สินค้าคลังเพชรบุรีฯ', 'Mscc จอง คลังเพชรบุรีฯ'],
]);

function getBranchFromFile(filePath) {
  const name = path.basename(filePath).toLowerCase();
  if (name.includes('beh')) return 'BEH';
  if (name.includes('mscc')) return 'MSCC';
  return 'WT';
}

function getWarehouseKindFromFile(filePath) {
  const name = path.basename(filePath).toLowerCase();
  if (name.includes('hq')) return 'หน้าร้าน';
  if (name.includes('werehouse') || name.includes('warehouse')) return 'คลัง';
  return '';
}

function getSectionMeta(code, fallbackTitle = '', filePath = '') {
  const normalized = String(code || '').trim();
  const branch = getBranchFromFile(filePath);
  const fileKind = getWarehouseKindFromFile(filePath);
  const title = String(fallbackTitle || '').trim().replace(/\s+/g, ' ');
  const displayKey = `${path.basename(filePath).toLowerCase()}|${normalized}|${title}`;
  const displayLabel = DISPLAY_WAREHOUSES.get(displayKey) || '';
  if (normalized === '01' && fileKind) return { branch, warehouse: title || fileKind, displayLabel };
  if (SECTION_META[normalized]) {
    return { ...SECTION_META[normalized], branch: normalized === '01' ? branch : SECTION_META[normalized].branch, warehouse: title || SECTION_META[normalized].warehouse, displayLabel };
  }
  return {
    branch: normalized || branch,
    warehouse: title || 'Music Concept WT',
    displayLabel,
  };
}

function loadInventoryFromText(text, filePath = '') {
  const rows = parseCsv(text);
  const items = [];
  let currentSection = getSectionMeta('01', 'Music Concept WT', filePath);

  for (const row of rows) {
    if (row.length === 3 && /^[0-9]{2}$/.test(String(row[1] || '').trim())) {
      currentSection = getSectionMeta(row[1], row[2], filePath);
      continue;
    }

    const sku = normalizeSku(row[3]);
    if (!/^[A-Z0-9][A-Z0-9\-_.]{2,}$/.test(sku)) continue;

    const displayKey = `${path.basename(filePath).toLowerCase()}|${currentSection.branch}|${currentSection.warehouse}`;
    const displayLabel = currentSection.displayLabel || DISPLAY_WAREHOUSES.get(displayKey) || '';
    if (!displayLabel) continue;

    items.push({
      sku,
      name: String(row[4] || '').trim(),
      branch: currentSection.branch,
      warehouse: currentSection.warehouse,
      label: displayLabel,
      source_file: path.basename(filePath),
      stock: toNumber(row[10]),
    });
  }

  return items;
}

async function fetchRemoteText(url) {
  if (!url) throw new Error('Missing GITHUB_RAW_URLS, GITHUB_RAW_URL_WT, or GITHUB_RAW_URL');
  const response = await fetch(url, {
    headers: {
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
    },
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  const text = CSV_DECODER.decode(buffer);
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
      label: item.label,
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
      label: entry.label,
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
  const liffId = String(process.env.LIFF_ID || '').trim();
  return INDEX_HTML
    .replaceAll('%%INITIAL_SKU%%', sku.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'))
    .replaceAll('%%INITIAL_RESULT%%', result ? JSON.stringify(result) : 'null')
    .replaceAll('%%INITIAL_ERROR%%', error.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'))
    .replaceAll('%%INITIAL_SOURCE%%', source)
    .replaceAll('%%INITIAL_SOURCE_LABEL%%', sourceLabel)
    .replaceAll('%%INITIAL_UPDATED_AT%%', updatedAt)
    .replaceAll('%%LIFF_ID%%', liffId.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'));
}

let cache = { fingerprint: '', loadedAt: 0, catalog: new Map(), inventory: [] };

async function refreshIfNeeded() {
  const now = Date.now();
  if (cache.loadedAt && (now - cache.loadedAt) < CACHE_TTL_MS) return cache;

  let fingerprint = '';
  let inventory = [];

  if (CSV_SOURCE === 'github') {
    const urls = GITHUB_RAW_URLS.length ? GITHUB_RAW_URLS : [GITHUB_RAW_URL_WT].filter(Boolean);
    const files = await Promise.all(urls.map(async (url) => ({ url, text: await fetchRemoteText(url) })));
    fingerprint = `remote:${crypto.createHash('sha1').update(files.map(({ url, text }) => `${url}:${text}`).join('\n')).digest('hex')}`;
    if (fingerprint === cache.fingerprint) {
      cache.loadedAt = now;
      return cache;
    }
    inventory = files.flatMap(({ url, text }) => loadInventoryFromText(text, url));
  } else {
    const fileStats = DATA_FILES
      .filter((filePath) => fs.existsSync(filePath))
      .map((filePath) => ({ filePath, stat: fs.statSync(filePath) }));
    fingerprint = `local:${fileStats.map(({ filePath, stat }) => `${path.basename(filePath)}:${stat.mtimeMs}:${stat.size}`).join('|')}`;
    if (fingerprint === cache.fingerprint) {
      cache.loadedAt = now;
      return cache;
    }
    inventory = fileStats.flatMap(({ filePath }) => {
      const text = CSV_DECODER.decode(fs.readFileSync(filePath));
      return loadInventoryFromText(text, filePath);
    });
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

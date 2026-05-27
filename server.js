const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { TextDecoder } = require('util');
const { URL } = require('url');

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, 'data');
const PAGE_SIZE = Number(process.env.PAGE_SIZE || 20);
const INDEX_HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const CSV_DECODER = new TextDecoder('windows-874');
const ADMIN_ID = String(process.env.ADMIN_ID || 'mscc-acc');
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '');
const GITHUB_TOKEN = String(process.env.GITHUB_TOKEN || '');
const DATA_REPO = String(process.env.DATA_REPO || 'paphavinmusicconcept-prog/mscc-stock-data');
const DATA_BRANCH = String(process.env.DATA_BRANCH || 'main');
const CSV_SOURCE = String(process.env.CSV_SOURCE || '').trim().toLowerCase() || 'github';
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 15 * 1024 * 1024);
const GITHUB_REFRESH_TTL_MS = Number(process.env.GITHUB_REFRESH_TTL_MS || 60 * 1000);
const STOCK_METADATA_PATH = 'data/stock-upload-meta.json';
const ALLOWED_STOCK_FILES = [
  'stock_mscc.CSV',
  'stock_mscc_werehouse.CSV',
  'stock_beh_hq.CSV',
  'stock_beh_werehouse.CSV',
];
const DATA_FILES = (process.env.DATA_FILES || ALLOWED_STOCK_FILES.join(','))
  .split(',')
  .map((file) => file.trim())
  .filter(Boolean)
  .map((file) => path.join(DATA_DIR, file));
const GITHUB_DATA_PATHS = (process.env.GITHUB_DATA_PATHS || ALLOWED_STOCK_FILES.map((file) => `data/${file}`).join(','))
  .split(',')
  .map((file) => file.trim())
  .filter(Boolean);

const DEFAULT_DISPLAY_LABELS = new Map([
  ['stock_beh_hq.csv|BEH', 'คลังเบ๊'],
  ['stock_mscc.csv|MSCC', 'คลังมิวสิคคอนเซ็พท์'],
  ['stock_mscc_werehouse.csv|04', 'คลังสำนักงานเพชรบุรีตัดใหม่'],
  ['stock_beh_werehouse.csv|04', 'คลังสำนักงานเพชรบุรีตัดใหม่'],
  ['stock_mscc.csv|06', 'คลังฝาก MSCC'],
  ['stock_mscc_werehouse.csv|07', 'เบ๊จอง คลังเพชรบุรีฯ'],
  ['stock_beh_werehouse.csv|07', 'เบ๊จอง คลังเพชรบุรีฯ'],
  ['stock_beh_werehouse.csv|08', 'Mscc จอง คลังเพชรบุรีฯ'],
]);

function parseCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    const next = normalized[i + 1];
    if (inQuotes) {
      if (char === '"') {
        if (next === '"') {
          field += '"';
          i += 1;
        } else if (next === ',' || next === '\n' || next === undefined) {
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
      if (!field) inQuotes = true;
      else field += '"';
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

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getBranchFromFile(filePath) {
  const name = path.basename(filePath).toLowerCase();
  if (name.includes('beh')) return 'BEH';
  if (name.includes('mscc')) return 'MSCC';
  return 'WT';
}

function getSectionMeta(code, title, filePath) {
  const normalized = String(code || '').trim();
  const fileBranch = getBranchFromFile(filePath);
  if (normalized === '01') return { branch: fileBranch, warehouse: String(title || '').trim() || fileBranch };
  return { branch: normalized || fileBranch, warehouse: String(title || '').trim() || normalized || fileBranch };
}

function getDisplayLabel(filePath, section) {
  const fileName = path.basename(filePath).toLowerCase();
  return DEFAULT_DISPLAY_LABELS.get(`${fileName}|${section.branch}`) || '';
}

function loadInventoryFromText(text, filePath = '') {
  const rows = parseCsv(text);
  const items = [];
  let section = getSectionMeta('01', '', filePath);
  for (const row of rows) {
    if (row.length === 3 && /^[0-9]{2}$/.test(String(row[1] || '').trim())) {
      section = getSectionMeta(row[1], row[2], filePath);
      continue;
    }
    const sku = normalizeSku(row[3]);
    if (!/^[A-Z0-9][A-Z0-9\-_.]{2,}$/.test(sku)) continue;
    const label = getDisplayLabel(filePath, section);
    if (!label) continue;
    items.push({
      sku,
      name: String(row[4] || '').trim(),
      branch: section.branch,
      warehouse: section.warehouse,
      label,
      source_file: path.basename(filePath),
      stock: toNumber(row[10]),
    });
  }
  return items;
}

function countThaiChars(text) {
  return (String(text || '').match(/[\u0e00-\u0e7f]/g) || []).length;
}

function countReplacementChars(text) {
  return (String(text || '').match(/\uFFFD/g) || []).length;
}

function decodeStrictUtf8(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
  } catch {
    return '';
  }
}

function repairLatin1Mojibake(text) {
  const bytes = [];
  for (const char of String(text || '')) {
    const code = char.charCodeAt(0);
    if (code > 255) return '';
    bytes.push(code);
  }
  return CSV_DECODER.decode(Buffer.from(bytes));
}

function scoreDecodedCsv(text, filePath) {
  const rows = parseCsv(text);
  const inventory = loadInventoryFromText(text, filePath);
  const skuRows = rows.filter((row) => /^[A-Z0-9][A-Z0-9\-_.]{2,}$/.test(normalizeSku(row[3]))).length;
  return {
    text,
    rows,
    inventory,
    skuRows,
    score: (inventory.length * 1000) + (skuRows * 100) + countThaiChars(text) - (countReplacementChars(text) * 500),
  };
}

function decodeCsvForStock(buffer, filePath) {
  const strictUtf8 = decodeStrictUtf8(buffer);
  const utf8 = strictUtf8 || new TextDecoder('utf-8').decode(buffer).replace(/^\uFEFF/, '');
  const candidates = [
    { encoding: 'Windows-874', text: CSV_DECODER.decode(buffer) },
    { encoding: 'UTF-8', text: utf8 },
    { encoding: 'UTF-8 repaired', text: repairLatin1Mojibake(utf8) },
  ].filter((candidate) => candidate.text);
  const scored = candidates.map((candidate) => ({ ...candidate, ...scoreDecodedCsv(candidate.text, filePath) }));
  if (strictUtf8 && countThaiChars(strictUtf8) > 0) {
    const utf8Candidate = scored.find((candidate) => candidate.encoding === 'UTF-8');
    if (utf8Candidate && utf8Candidate.inventory.length) utf8Candidate.score += 1000000000;
  }
  return scored.sort((a, b) => b.score - a.score)[0] || { encoding: 'unknown', text: '', rows: [], inventory: [], skuRows: 0 };
}

function uniqueSkuCount(items) {
  return new Set(items.map((item) => item.sku)).size;
}

function githubReadHeaders() {
  return {
    Accept: 'application/vnd.github+json',
    ...(GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
    'User-Agent': 'mscc-check',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function githubWriteHeaders() {
  if (!GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is not configured');
  return {
    ...githubReadHeaders(),
    'Content-Type': 'application/json',
  };
}

function encodeGitHubPath(filePath) {
  return filePath.split('/').map(encodeURIComponent).join('/');
}

async function fetchGitHubContent(filePath) {
  const apiUrl = `https://api.github.com/repos/${DATA_REPO}/contents/${encodeGitHubPath(filePath)}?ref=${encodeURIComponent(DATA_BRANCH)}`;
  const response = await fetch(apiUrl, { headers: { ...githubReadHeaders(), 'Cache-Control': 'no-cache' } });
  const body = await response.text();
  if (!response.ok) throw new Error(`Failed to fetch ${filePath}: ${response.status} ${body.slice(0, 160)}`);
  const payload = JSON.parse(body);
  const buffer = Buffer.from(String(payload.content || '').replace(/\s/g, ''), 'base64');
  return {
    path: filePath,
    sha: payload.sha || '',
    size: payload.size || buffer.length,
    ...decodeCsvForStock(buffer, filePath),
  };
}

async function fetchLatestFileCommit(filePath) {
  const apiUrl = `https://api.github.com/repos/${DATA_REPO}/commits?sha=${encodeURIComponent(DATA_BRANCH)}&path=${encodeURIComponent(filePath)}&per_page=1`;
  const response = await fetch(apiUrl, { headers: { ...githubReadHeaders(), 'Cache-Control': 'no-cache' } });
  const body = await response.text();
  if (!response.ok) return null;
  const commits = JSON.parse(body);
  const commit = Array.isArray(commits) ? commits[0] : null;
  return commit ? {
    name: path.basename(filePath),
    path: filePath,
    sha: commit.sha || '',
    updated_at: commit.commit?.committer?.date || commit.commit?.author?.date || null,
  } : null;
}

async function fetchStockMetadata() {
  const apiUrl = `https://api.github.com/repos/${DATA_REPO}/contents/${encodeGitHubPath(STOCK_METADATA_PATH)}?ref=${encodeURIComponent(DATA_BRANCH)}`;
  const response = await fetch(apiUrl, { headers: githubReadHeaders() });
  const body = await response.text();
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Failed to fetch stock metadata: ${response.status} ${body.slice(0, 160)}`);
  const payload = JSON.parse(body);
  return JSON.parse(Buffer.from(String(payload.content || '').replace(/\s/g, ''), 'base64').toString('utf8'));
}

async function putGitHubFile(apiPath, contentBuffer, message) {
  const apiUrl = `https://api.github.com/repos/${DATA_REPO}/contents/${encodeGitHubPath(apiPath)}`;
  const headers = githubWriteHeaders();
  const current = await fetch(`${apiUrl}?ref=${encodeURIComponent(DATA_BRANCH)}`, { headers });
  const currentText = await current.text();
  let sha = '';
  if (current.ok) sha = JSON.parse(currentText).sha;
  else if (current.status !== 404) throw new Error(`Cannot read existing GitHub file: ${current.status} ${currentText.slice(0, 160)}`);
  const updated = await fetch(apiUrl, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ message, content: contentBuffer.toString('base64'), ...(sha ? { sha } : {}), branch: DATA_BRANCH }),
  });
  const updatedText = await updated.text();
  if (!updated.ok) throw new Error(`GitHub update failed: ${updated.status} ${updatedText.slice(0, 160)}`);
  return JSON.parse(updatedText);
}

async function commitGitHubFiles(files, message) {
  const headers = githubWriteHeaders();
  const refUrl = `https://api.github.com/repos/${DATA_REPO}/git/refs/heads/${encodeURIComponent(DATA_BRANCH)}`;
  const refResponse = await fetch(refUrl, { headers });
  const refText = await refResponse.text();
  if (!refResponse.ok) throw new Error(`Cannot read GitHub branch: ${refResponse.status} ${refText.slice(0, 160)}`);
  const baseSha = JSON.parse(refText).object.sha;

  const commitResponse = await fetch(`https://api.github.com/repos/${DATA_REPO}/git/commits/${baseSha}`, { headers });
  const commitText = await commitResponse.text();
  if (!commitResponse.ok) throw new Error(`Cannot read GitHub commit: ${commitResponse.status} ${commitText.slice(0, 160)}`);
  const baseTree = JSON.parse(commitText).tree.sha;

  const blobs = await Promise.all(files.map(async (file) => {
    const blobResponse = await fetch(`https://api.github.com/repos/${DATA_REPO}/git/blobs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ content: file.data.toString('base64'), encoding: 'base64' }),
    });
    const blobText = await blobResponse.text();
    if (!blobResponse.ok) throw new Error(`Cannot create GitHub blob for ${file.path}: ${blobResponse.status} ${blobText.slice(0, 160)}`);
    return { path: file.path, sha: JSON.parse(blobText).sha };
  }));

  const treeResponse = await fetch(`https://api.github.com/repos/${DATA_REPO}/git/trees`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      base_tree: baseTree,
      tree: blobs.map((blob) => ({ path: blob.path, mode: '100644', type: 'blob', sha: blob.sha })),
    }),
  });
  const treeText = await treeResponse.text();
  if (!treeResponse.ok) throw new Error(`Cannot create GitHub tree: ${treeResponse.status} ${treeText.slice(0, 160)}`);
  const treeSha = JSON.parse(treeText).sha;

  const newCommitResponse = await fetch(`https://api.github.com/repos/${DATA_REPO}/git/commits`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ message, tree: treeSha, parents: [baseSha] }),
  });
  const newCommitText = await newCommitResponse.text();
  if (!newCommitResponse.ok) throw new Error(`Cannot create GitHub commit: ${newCommitResponse.status} ${newCommitText.slice(0, 160)}`);
  const newCommitSha = JSON.parse(newCommitText).sha;

  const updateRefResponse = await fetch(refUrl, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ sha: newCommitSha }),
  });
  const updateRefText = await updateRefResponse.text();
  if (!updateRefResponse.ok) throw new Error(`Cannot update GitHub branch: ${updateRefResponse.status} ${updateRefText.slice(0, 160)}`);
  return newCommitSha;
}

function buildCatalog(items) {
  const bySku = new Map();
  for (const item of items) {
    if (!bySku.has(item.sku)) bySku.set(item.sku, { sku: item.sku, name: item.name, entries: [] });
    const product = bySku.get(item.sku);
    if (!product.name && item.name) product.name = item.name;
    product.entries.push({ branch: item.branch, warehouse: item.warehouse, label: item.label, stock: item.stock });
  }
  return bySku;
}

function summarize(product) {
  const branches = [];
  let available_stock = 0;
  for (const entry of product.entries) {
    available_stock += entry.stock;
    branches.push({ branch: entry.branch, warehouse: entry.warehouse, label: entry.label, stock: entry.stock });
  }
  return { mode: 'exact', sku: product.sku, name: product.name, available_stock, branches };
}

function paginateMatches(matches, mode, query, page) {
  if (matches.length === 1) return { ...matches[0], mode, query, total_matches: 1, shown_matches: 1, page: 1, total_pages: 1 };
  if (!matches.length) return null;
  const totalPages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, Number.parseInt(page, 10) || 1), totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  return { mode, query, total_matches: matches.length, shown_matches: Math.min(PAGE_SIZE, matches.length - start), page: currentPage, total_pages: totalPages, matches: matches.slice(start, start + PAGE_SIZE) };
}

function search(query, catalog, page = 1) {
  const raw = String(query || '').trim();
  if (!raw) return null;
  const normalized = normalizeSku(raw);
  if (catalog.has(normalized)) return summarize(catalog.get(normalized));
  if (/^[A-Z0-9][A-Z0-9\-_.]*$/.test(normalized)) {
    const matches = Array.from(catalog.values()).filter((product) => product.sku.startsWith(normalized)).sort((a, b) => a.sku.localeCompare(b.sku, 'en')).map(summarize);
    const result = paginateMatches(matches, 'prefix', raw, page);
    if (result) return result;
  }
  const lower = raw.toLowerCase();
  const matches = Array.from(catalog.values()).filter((product) => String(product.name || '').toLowerCase().includes(lower)).sort((a, b) => a.sku.localeCompare(b.sku, 'en')).map(summarize);
  return paginateMatches(matches, 'name', raw, page);
}

let cache = { fingerprint: '', loadedAt: 0, githubCheckedAt: 0, stockUpdatedAt: null, stockFiles: [], catalog: new Map(), inventory: [] };
let refreshPromise = null;

async function refreshIfNeeded(force = false) {
  const now = Date.now();
  if (!force && cache.catalog.size && cache.githubCheckedAt && (now - cache.githubCheckedAt) < GITHUB_REFRESH_TTL_MS) {
    cache.loadedAt = now;
    return cache;
  }
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
  let files = [];
  let stockUpdatedAt = null;
  let stockFiles = [];
  let inventory = [];
  let fingerprint = '';
  if (CSV_SOURCE === 'github') {
    const dataPaths = GITHUB_DATA_PATHS.length ? GITHUB_DATA_PATHS : ALLOWED_STOCK_FILES.map((file) => `data/${file}`);
    const [githubFiles, metadata, commits] = await Promise.all([
      Promise.all(dataPaths.map((filePath) => fetchGitHubContent(filePath))),
      fetchStockMetadata().catch(() => null),
      Promise.all(dataPaths.map((filePath) => fetchLatestFileCommit(filePath))),
    ]);
    files = githubFiles;
    if (metadata?.uploaded_at) {
      stockUpdatedAt = metadata.uploaded_at;
      stockFiles = Array.isArray(metadata.files) ? metadata.files : [];
    }
    const latestCommitTime = commits.filter(Boolean).map((commit) => (commit.updated_at ? Date.parse(commit.updated_at) : 0)).sort((a, b) => b - a)[0];
    if (latestCommitTime && (!stockUpdatedAt || latestCommitTime > Date.parse(stockUpdatedAt))) {
      stockUpdatedAt = new Date(latestCommitTime).toISOString();
      stockFiles = commits.filter(Boolean);
    }
    fingerprint = `github:${crypto.createHash('sha1').update(files.map((file) => `${file.path}:${file.sha}:${file.size}`).join('\n')).digest('hex')}`;
    inventory = files.flatMap((file) => file.inventory);
  } else {
    const fileStats = DATA_FILES.filter((filePath) => fs.existsSync(filePath)).map((filePath) => ({ filePath, stat: fs.statSync(filePath) }));
    fingerprint = `local:${fileStats.map(({ filePath, stat }) => `${path.basename(filePath)}:${stat.mtimeMs}:${stat.size}`).join('|')}`;
    stockUpdatedAt = fileStats.reduce((latest, { stat }) => Math.max(latest, stat.mtimeMs), 0) || null;
    stockFiles = fileStats.map(({ filePath, stat }) => ({ name: path.basename(filePath), size: stat.size, updated_at: new Date(stat.mtimeMs).toISOString() }));
    inventory = fileStats.flatMap(({ filePath }) => decodeCsvForStock(fs.readFileSync(filePath), filePath).inventory);
  }
  if (fingerprint === cache.fingerprint) {
    cache.loadedAt = now;
    cache.githubCheckedAt = now;
    cache.stockUpdatedAt = stockUpdatedAt || cache.stockUpdatedAt;
    cache.stockFiles = stockFiles.length ? stockFiles : cache.stockFiles;
    return cache;
  }
  cache = { fingerprint, loadedAt: now, githubCheckedAt: now, stockUpdatedAt, stockFiles, inventory, catalog: buildCatalog(inventory) };
  console.log(`Loaded ${inventory.length} rows, ${cache.catalog.size} unique SKUs from ${CSV_SOURCE}.`);
  return cache;
  })();
  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

function renderIndex({ sku = '', result = null, error = '', source = CSV_SOURCE }) {
  const sourceLabel = source === 'github' ? 'GitHub' : 'Local';
  const updatedAt = cache.stockUpdatedAt ? new Date(cache.stockUpdatedAt).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '-';
  const liffId = String(process.env.LIFF_ID || '').trim();
  return INDEX_HTML
    .replaceAll('%%INITIAL_SKU%%', escapeHtml(sku))
    .replaceAll('%%INITIAL_RESULT%%', result ? JSON.stringify(result) : 'null')
    .replaceAll('%%INITIAL_ERROR%%', escapeHtml(error))
    .replaceAll('%%INITIAL_SOURCE%%', source)
    .replaceAll('%%INITIAL_SOURCE_LABEL%%', sourceLabel)
    .replaceAll('%%INITIAL_UPDATED_AT%%', updatedAt)
    .replaceAll('%%LIFF_ID%%', escapeHtml(liffId));
}

function constantTimeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function getBasicAuth(req) {
  const header = req.headers.authorization || '';
  if (!header.toLowerCase().startsWith('basic ')) return null;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const idx = decoded.indexOf(':');
  if (idx === -1) return null;
  return { id: decoded.slice(0, idx), password: decoded.slice(idx + 1) };
}

function requireAdmin(req, res) {
  const auth = getBasicAuth(req);
  const ok = !!ADMIN_PASSWORD && !!auth && constantTimeEqual(auth.id, ADMIN_ID) && constantTimeEqual(auth.password, ADMIN_PASSWORD);
  if (ok) return true;
  res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8', 'WWW-Authenticate': 'Basic realm="MSCC Stock Admin", charset="UTF-8"' });
  res.end(ADMIN_PASSWORD ? 'Login required' : 'Admin password is not configured');
  return false;
}

function renderAdminPage({ message = '', error = '' } = {}) {
  const requiredItems = ALLOWED_STOCK_FILES.map((file) => `<li><code>${escapeHtml(file)}</code></li>`).join('');
  const statusHtml = error ? `<div class="alert error">${escapeHtml(error)}</div>` : message ? `<div class="alert ok">${escapeHtml(message)}</div>` : '';
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MSCC Stock Admin</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111827; background: #f6f7fb; }
    main { width: min(760px, calc(100% - 32px)); margin: 0 auto; padding: 32px 0; }
    section { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; box-shadow: 0 12px 40px rgba(17, 24, 39, .08); }
    h1 { margin: 0 0 6px; font-size: 28px; }
    p { margin: 0 0 18px; color: #4b5563; line-height: 1.6; }
    ul { margin: 10px 0 0; padding-left: 20px; color: #374151; line-height: 1.8; }
    code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 13px; color: #0f766e; }
    input[type="file"] { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
    .dropzone { margin-top: 16px; border: 2px dashed #99f6e4; border-radius: 8px; padding: 28px 18px; background: #f0fdfa; text-align: center; cursor: pointer; }
    .dropzone.dragging { border-color: #0f766e; background: #ccfbf1; }
    .dropzone strong { display: block; color: #0f766e; font-size: 18px; }
    .dropzone span { display: block; margin-top: 6px; color: #4b5563; }
    .file-list { margin-top: 14px; display: grid; gap: 8px; }
    .file-row { display: flex; justify-content: space-between; gap: 12px; padding: 10px 12px; border-radius: 8px; background: #f9fafb; border: 1px solid #e5e7eb; font-size: 14px; }
    .file-row.good { border-color: #a7f3d0; background: #ecfdf5; }
    .file-row.bad { border-color: #fecaca; background: #fef2f2; }
    button { margin-top: 18px; width: 100%; border: 0; border-radius: 8px; padding: 14px 16px; background: #0f766e; color: #fff; font-size: 16px; font-weight: 800; cursor: pointer; }
    button:disabled { background: #9ca3af; cursor: not-allowed; }
    .alert { margin-bottom: 16px; border-radius: 8px; padding: 12px 14px; line-height: 1.5; white-space: pre-wrap; }
    .ok { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
    .error { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
    .note { margin-top: 16px; font-size: 13px; color: #6b7280; }
  </style>
</head>
<body>
  <main>
    <section>
      <h1>อัปเดตไฟล์ CSV</h1>
      <p>ลากไฟล์ CSV ทั้ง 4 ไฟล์มาวาง ระบบจะตรวจชื่อไฟล์ อ่าน encoding แล้วแปลงเป็น UTF-8 ก่อนอัปเดตเข้า ${escapeHtml(DATA_REPO)}</p>
      ${statusHtml}
      <div class="note">ไฟล์ที่ต้องมีครบ:</div>
      <ul>${requiredItems}</ul>
      <form method="post" action="/admin/upload" enctype="multipart/form-data">
        <label id="dropzone" class="dropzone" for="csvFiles">
          <strong>ลากไฟล์มาวางที่นี่</strong>
          <span>หรือกดเพื่อเลือกไฟล์ CSV ทั้ง 4 ไฟล์</span>
        </label>
        <input id="csvFiles" name="csvFiles" type="file" accept=".csv,.CSV,text/csv" multiple required />
        <div id="file-list" class="file-list"></div>
        <button id="submit-button" type="submit" disabled>อัปเดตสต็อก</button>
      </form>
      <div class="note">หลังอัปเดตสำเร็จ หน้า search จะแสดงเวลาอัปเดตล่าสุด และข้อมูลจะ rebuild จาก CSV ชุดใหม่</div>
    </section>
  </main>
  <script>
    const requiredFiles = ${JSON.stringify(ALLOWED_STOCK_FILES)};
    const input = document.getElementById('csvFiles');
    const dropzone = document.getElementById('dropzone');
    const fileList = document.getElementById('file-list');
    const submitButton = document.getElementById('submit-button');
    function renderFiles(files) {
      const names = Array.from(files || []).map((file) => file.name);
      const missing = requiredFiles.filter((name) => !names.includes(name));
      const unexpected = names.filter((name) => !requiredFiles.includes(name));
      const duplicate = names.filter((name, index) => names.indexOf(name) !== index);
      const rows = requiredFiles.map((name) => '<div class="file-row ' + (names.includes(name) ? 'good' : 'bad') + '"><span><code>' + name + '</code></span><span>' + (names.includes(name) ? 'พร้อม' : 'ยังไม่มี') + '</span></div>');
      for (const name of unexpected) rows.push('<div class="file-row bad"><span><code>' + name + '</code></span><span>ชื่อไฟล์ไม่ถูกต้อง</span></div>');
      for (const name of duplicate) rows.push('<div class="file-row bad"><span><code>' + name + '</code></span><span>ไฟล์ซ้ำ</span></div>');
      fileList.innerHTML = rows.join('');
      submitButton.disabled = missing.length > 0 || unexpected.length > 0 || duplicate.length > 0;
    }
    input.addEventListener('change', () => renderFiles(input.files));
    dropzone.addEventListener('dragover', (event) => { event.preventDefault(); dropzone.classList.add('dragging'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragging'));
    dropzone.addEventListener('drop', (event) => { event.preventDefault(); dropzone.classList.remove('dragging'); input.files = event.dataTransfer.files; renderFiles(input.files); });
    renderFiles([]);
  </script>
</body>
</html>`;
}

function readBody(req, limitBytes = MAX_UPLOAD_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error('Upload is too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseContentDisposition(header) {
  const result = {};
  for (const part of String(header || '').split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    const key = rawKey.trim().toLowerCase();
    if (!key) continue;
    let value = rawValue.join('=').trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    result[key] = value;
  }
  return result;
}

function parseMultipart(buffer, boundary) {
  const delimiter = Buffer.from(`--${boundary}`);
  const fields = {};
  const files = {};
  let cursor = buffer.indexOf(delimiter);
  while (cursor !== -1) {
    let partStart = cursor + delimiter.length;
    if (buffer.slice(partStart, partStart + 2).toString() === '--') break;
    if (buffer.slice(partStart, partStart + 2).toString() === '\r\n') partStart += 2;
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), partStart);
    if (headerEnd === -1) break;
    const next = buffer.indexOf(delimiter, headerEnd + 4);
    if (next === -1) break;
    const headerText = buffer.slice(partStart, headerEnd).toString('utf8');
    const headers = Object.fromEntries(headerText.split('\r\n').map((line) => {
      const idx = line.indexOf(':');
      return idx === -1 ? ['', ''] : [line.slice(0, idx).trim().toLowerCase(), line.slice(idx + 1).trim()];
    }).filter(([key]) => key));
    const disposition = parseContentDisposition(headers['content-disposition']);
    let dataEnd = next;
    if (buffer.slice(dataEnd - 2, dataEnd).toString() === '\r\n') dataEnd -= 2;
    const data = buffer.slice(headerEnd + 4, dataEnd);
    if (disposition.name) {
      if (disposition.filename !== undefined) {
        if (!files[disposition.name]) files[disposition.name] = [];
        files[disposition.name].push({ filename: disposition.filename, data, contentType: headers['content-type'] || '' });
      } else {
        fields[disposition.name] = data.toString('utf8');
      }
    }
    cursor = next;
  }
  return { fields, files };
}

function validateStockUploads(uploadList) {
  const uploads = (uploadList || []).filter((file) => file && file.filename);
  const byName = new Map();
  const duplicates = [];
  for (const upload of uploads) {
    const fileName = path.basename(upload.filename);
    if (byName.has(fileName)) duplicates.push(fileName);
    else byName.set(fileName, upload);
  }
  const missing = ALLOWED_STOCK_FILES.filter((fileName) => !byName.has(fileName));
  const unexpected = Array.from(byName.keys()).filter((fileName) => !ALLOWED_STOCK_FILES.includes(fileName));
  if (missing.length || unexpected.length || duplicates.length) {
    const parts = [];
    if (missing.length) parts.push(`Missing files: ${missing.join(', ')}`);
    if (unexpected.length) parts.push(`Invalid file names: ${unexpected.join(', ')}`);
    if (duplicates.length) parts.push(`Duplicate files: ${duplicates.join(', ')}`);
    throw new Error(parts.join(' | '));
  }
  return ALLOWED_STOCK_FILES.map((fileName) => {
    const upload = byName.get(fileName);
    if (!upload.data || upload.data.length === 0) throw new Error(`Empty file: ${fileName}`);
    const decoded = decodeCsvForStock(upload.data, fileName);
    if (!decoded.inventory.length || !decoded.skuRows) throw new Error(`Cannot read stock rows from ${fileName}`);
    const normalizedData = Buffer.from(decoded.text.replace(/^\uFEFF/, ''), 'utf8');
    return {
      fileName,
      data: normalizedData,
      sourceSize: upload.data.length,
      size: normalizedData.length,
      encoding: decoded.encoding,
      rows: decoded.inventory.length,
      skus: uniqueSkuCount(decoded.inventory),
      inventory: decoded.inventory,
    };
  });
}

async function updateStockCsvFiles(uploadList) {
  const files = validateStockUploads(uploadList);
  const uploadedAt = new Date().toISOString();
  const updatedFiles = files.map((file) => ({
    name: file.fileName,
    size: file.size,
    source_size: file.sourceSize,
    encoding: `${file.encoding} -> UTF-8`,
    rows: file.rows,
    skus: file.skus,
    updated_at: uploadedAt,
  }));
  const metadata = { uploaded_at: uploadedAt, files: updatedFiles };
  await commitGitHubFiles([
    ...files.map((file) => ({ path: `data/${file.fileName}`, data: file.data })),
    { path: STOCK_METADATA_PATH, data: Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`, 'utf8') },
  ], 'Update stock CSV files from stock admin');
  const inventory = files.flatMap((file) => file.inventory || []);
  cache = { fingerprint: '', loadedAt: Date.now(), githubCheckedAt: Date.now(), stockUpdatedAt: uploadedAt, stockFiles: updatedFiles, catalog: buildCatalog(inventory), inventory };
  return metadata;
}

async function handleAdmin(req, res, url) {
  if (!requireAdmin(req, res)) return true;
  if (req.method === 'GET' && url.pathname === '/admin') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderAdminPage({ message: url.searchParams.get('message') || '', error: url.searchParams.get('error') || '' }));
    return true;
  }
  if (req.method === 'POST' && url.pathname === '/admin/upload') {
    try {
      const contentType = req.headers['content-type'] || '';
      const match = contentType.match(/boundary=(?:(?:"([^"]+)")|([^;]+))/i);
      if (!match) throw new Error('Missing multipart boundary');
      const body = await readBody(req);
      const parsed = parseMultipart(body, match[1] || match[2]);
      const uploads = parsed.files.csvFiles || [];
      if (!uploads.length) throw new Error('Please choose all 4 CSV files');
      const metadata = await updateStockCsvFiles(uploads);
      const updatedAt = new Date(metadata.uploaded_at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
      const summary = metadata.files.map((file) => `${file.name}: ${file.rows} rows, ${file.skus} SKUs, ${file.encoding}`).join('\n');
      res.writeHead(303, { Location: `/admin?message=${encodeURIComponent(`Updated ${ALLOWED_STOCK_FILES.length} files at ${updatedAt}\n${summary}`)}` });
      res.end();
    } catch (error) {
      const message = error && error.message ? error.message : 'Upload failed';
      res.writeHead(303, { Location: `/admin?error=${encodeURIComponent(message)}` });
      res.end();
    }
    return true;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
    await handleAdmin(req, res, url);
    return;
  }
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
      res.end(renderIndex({ error: message }));
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
      updated_at: cache.stockUpdatedAt ? new Date(cache.stockUpdatedAt).toISOString() : null,
      loaded_at: cache.loadedAt ? new Date(cache.loadedAt).toISOString() : null,
      files: cache.stockFiles,
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
    res.end(JSON.stringify({ ...result, source: CSV_SOURCE, updated_at: cache.stockUpdatedAt ? new Date(cache.stockUpdatedAt).toISOString() : null }));
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

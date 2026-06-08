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
const PAGE_SIZE = Number(process.env.PAGE_SIZE || 20);
const INDEX_HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const CSV_DECODER = new TextDecoder('windows-874');
const CSV_SOURCE = String(process.env.CSV_SOURCE || '').trim().toLowerCase() || 'github';
const ADMIN_ID = String(process.env.ADMIN_ID || 'mscc-acc');
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '');
const GITHUB_TOKEN = String(process.env.GITHUB_TOKEN || '');
const DATA_REPO = String(process.env.DATA_REPO || 'paphavinmusicconcept-prog/mscc-stock-data');
const DATA_BRANCH = String(process.env.DATA_BRANCH || 'main');
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 15 * 1024 * 1024);
const STOCK_METADATA_PATH = 'data/stock-upload-meta.json';
const STOCK_FILES = ['stock_mscc.CSV', 'stock_mscc_warehouse.CSV', 'stock_beh_hq.CSV', 'stock_beh_warehouse.CSV'];
const GITHUB_DATA_PATHS = (process.env.GITHUB_DATA_PATHS || STOCK_FILES.map((file) => `data/${file}`).join(','))
  .split(',')
  .map((file) => file.trim())
  .filter(Boolean);
const LOCAL_DATA_FILES = GITHUB_DATA_PATHS.map((file) => path.join(__dirname, file));

const SECTION_META = {
  '01': { branch: '01', warehouse: 'คลังมิวสิคคอนเซพท์' },
  '02': { branch: '02', warehouse: 'ใบยืมมิวสิคคอนเซพท์' },
  '03': { branch: '03', warehouse: 'สินค้ารออะไหล่, เสีย - มิวสิคคอนเซพท์' },
  '04': { branch: '04', warehouse: 'สินค้าฝากขาย' },
  '05': { branch: '05', warehouse: 'จองสินค้า, มัดจำสินค้า' },
  '06': { branch: '06', warehouse: 'คลังฝาก มิวสิคคอนเซพท์ - สนง.เพชรบุรี' },
};

const DISPLAY_WAREHOUSES = new Map([
  ['stock_beh_hq.csv|01|คลังเบ๊', 'คลังเบ๊'],
  ['stock_mscc.csv|01|คลังมิวสิคคอนเซพท์', 'คลังมิวสิคคอนเซพท์'],
  ['stock_mscc_warehouse.csv|04|คลังสำนักงานเพชรบุรีตัดใหม่', 'คลังสำนักงานเพชรบุรีตัดใหม่'],
  ['stock_beh_warehouse.csv|04|คลังสำนักงานเพชรบุรีตัดใหม่', 'คลังสำนักงานเพชรบุรีตัดใหม่'],
  ['stock_mscc.csv|06|คลังฝาก มิวสิคคอนเซพท์ - สนง.เพชรบุรี', 'คลังฝาก MSCC'],
  ['stock_mscc_warehouse.csv|07|เบ๊จองสินค้า-เพชรบุรีฯ', 'เบ๊จอง คลังเพชรบุรีฯ'],
  ['stock_beh_warehouse.csv|07|เบ๊จอง สินค้าคลังเพชรบุรีฯ', 'เบ๊จอง คลังเพชรบุรีฯ'],
  ['stock_beh_warehouse.csv|08|มิวสิคจอง สินค้าคลังเพชรบุรีฯ', 'Mscc จอง คลังเพชรบุรีฯ'],
]);

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

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
        if (next === '"') { field += '"'; i += 1; }
        else if (next === ',' || next === '\n' || next === undefined) inQuotes = false;
        else field += '"';
      } else field += char;
      continue;
    }
    if (char === '"') { if (!field) inQuotes = true; else field += '"'; continue; }
    if (char === ',') { row.push(field); field = ''; continue; }
    if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += char;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function normalizeSku(value) { return String(value || '').trim().toUpperCase(); }
function toNumber(value) {
  const parsed = Number.parseFloat(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}
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
  if (SECTION_META[normalized]) return { ...SECTION_META[normalized], branch: normalized === '01' ? branch : SECTION_META[normalized].branch, warehouse: title || SECTION_META[normalized].warehouse, displayLabel };
  return { branch: normalized || branch, warehouse: title || 'Music Concept WT', displayLabel };
}

function loadInventoryFromText(text, filePath) {
  const items = [];
  let currentSection = getSectionMeta('01', 'Music Concept WT', filePath);
  for (const row of parseCsv(text)) {
    if (row.length === 3 && /^[0-9]{2}$/.test(String(row[1] || '').trim())) {
      currentSection = getSectionMeta(row[1], row[2], filePath);
      continue;
    }
    const sku = normalizeSku(row[3]);
    if (!/^[A-Z0-9][A-Z0-9\-_.]{2,}$/.test(sku)) continue;
    const displayKey = `${path.basename(filePath).toLowerCase()}|${currentSection.branch}|${currentSection.warehouse}`;
    const label = currentSection.displayLabel || DISPLAY_WAREHOUSES.get(displayKey) || '';
    if (!label) continue;
    items.push({ sku, name: String(row[4] || '').trim(), branch: currentSection.branch, warehouse: currentSection.warehouse, label, source_file: path.basename(filePath), stock: toNumber(row[10]) });
  }
  return items;
}

function githubReadHeaders() {
  return { 'Accept': 'application/vnd.github+json', ...(GITHUB_TOKEN ? { 'Authorization': `Bearer ${GITHUB_TOKEN}` } : {}), 'User-Agent': 'mscc-check', 'X-GitHub-Api-Version': '2022-11-28' };
}
function githubWriteHeaders() {
  if (!GITHUB_TOKEN) throw new Error('ยังไม่ได้ตั้งค่า GITHUB_TOKEN');
  return { ...githubReadHeaders(), 'Content-Type': 'application/json' };
}
function encodeGitHubPath(filePath) { return filePath.split('/').map(encodeURIComponent).join('/'); }

async function fetchGitHubContentText(filePath) {
  const apiUrl = `https://api.github.com/repos/${DATA_REPO}/contents/${encodeGitHubPath(filePath)}?ref=${encodeURIComponent(DATA_BRANCH)}`;
  const response = await fetch(apiUrl, { headers: { ...githubReadHeaders(), 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } });
  const text = await response.text();
  if (!response.ok) throw new Error(`Failed to fetch GitHub file ${filePath}: ${response.status} ${text.slice(0, 200)}`);
  const payload = JSON.parse(text);
  return { path: filePath, sha: payload.sha || '', size: payload.size || 0, text: CSV_DECODER.decode(Buffer.from(String(payload.content || '').replace(/\s/g, ''), 'base64')) };
}

async function fetchLatestFileCommit(filePath) {
  const apiUrl = `https://api.github.com/repos/${DATA_REPO}/commits?sha=${encodeURIComponent(DATA_BRANCH)}&path=${encodeURIComponent(filePath)}&per_page=1`;
  const response = await fetch(apiUrl, { headers: { ...githubReadHeaders(), 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } });
  const text = await response.text();
  if (!response.ok) return null;
  const commit = JSON.parse(text)[0];
  if (!commit) return null;
  return { name: path.basename(filePath), path: filePath, sha: commit.sha || '', updated_at: commit.commit?.committer?.date || commit.commit?.author?.date || null };
}

async function fetchStockMetadata() {
  if (CSV_SOURCE !== 'github') return null;
  const response = await fetch(`https://api.github.com/repos/${DATA_REPO}/contents/${encodeGitHubPath(STOCK_METADATA_PATH)}?ref=${encodeURIComponent(DATA_BRANCH)}`, { headers: githubReadHeaders() });
  const text = await response.text();
  if (response.status === 404) return null;
  if (!response.ok) return null;
  const payload = JSON.parse(text);
  return JSON.parse(Buffer.from(String(payload.content || '').replace(/\s/g, ''), 'base64').toString('utf8'));
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
  for (const entry of product.entries) { available_stock += entry.stock; branches.push({ ...entry }); }
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
  const matches = Array.from(catalog.values()).filter((product) => String(product.name || '').toLowerCase().includes(raw.toLowerCase())).sort((a, b) => a.sku.localeCompare(b.sku, 'en')).map(summarize);
  return paginateMatches(matches, 'name', raw, page);
}

let cache = { fingerprint: '', loadedAt: 0, stockUpdatedAt: null, stockFiles: [], catalog: new Map(), inventory: [] };

async function refreshIfNeeded() {
  const now = Date.now();
  let files = [];
  let stockFiles = [];
  let stockUpdatedAt = null;
  if (CSV_SOURCE === 'github') {
    [files, stockFiles] = await Promise.all([
      Promise.all(GITHUB_DATA_PATHS.map((filePath) => fetchGitHubContentText(filePath))),
      Promise.all(GITHUB_DATA_PATHS.map((filePath) => fetchLatestFileCommit(filePath))).then((items) => items.filter(Boolean)),
    ]);
    const metadata = await fetchStockMetadata().catch(() => null);
    if (metadata?.uploaded_at) stockUpdatedAt = metadata.uploaded_at;
    const latestCsvMs = stockFiles.map((file) => (file.updated_at ? Date.parse(file.updated_at) : 0)).filter(Boolean).sort((a, b) => b - a)[0];
    if (latestCsvMs && (!stockUpdatedAt || latestCsvMs > Date.parse(stockUpdatedAt))) stockUpdatedAt = new Date(latestCsvMs).toISOString();
  } else {
    files = LOCAL_DATA_FILES.filter((filePath) => fs.existsSync(filePath)).map((filePath) => {
      const stat = fs.statSync(filePath);
      stockFiles.push({ name: path.basename(filePath), path: filePath, size: stat.size, updated_at: new Date(stat.mtimeMs).toISOString() });
      return { path: filePath, sha: String(stat.mtimeMs), size: stat.size, text: CSV_DECODER.decode(fs.readFileSync(filePath)) };
    });
    stockUpdatedAt = stockFiles.map((file) => Date.parse(file.updated_at)).sort((a, b) => b - a)[0] || null;
    if (stockUpdatedAt) stockUpdatedAt = new Date(stockUpdatedAt).toISOString();
  }
  const fingerprint = `${CSV_SOURCE}:${crypto.createHash('sha1').update(files.map((file) => `${file.path}:${file.sha}:${file.size}`).join('\n')).digest('hex')}`;
  if (fingerprint === cache.fingerprint) {
    cache.loadedAt = now;
    cache.stockUpdatedAt = stockUpdatedAt || cache.stockUpdatedAt;
    cache.stockFiles = stockFiles.length ? stockFiles : cache.stockFiles;
    return cache;
  }
  const inventory = files.flatMap((file) => loadInventoryFromText(file.text, file.path));
  cache = { fingerprint, loadedAt: now, stockUpdatedAt, stockFiles, inventory, catalog: buildCatalog(inventory) };
  console.log(`Loaded ${inventory.length} rows, ${cache.catalog.size} unique SKUs from ${CSV_SOURCE}.`);
  return cache;
}

function renderIndex({ sku = '', result = null, error = '', source = CSV_SOURCE }) {
  const updatedAt = cache.stockUpdatedAt ? new Date(cache.stockUpdatedAt).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '-';
  const liffId = String(process.env.LIFF_ID || '').trim();
  return INDEX_HTML
    .replaceAll('%%INITIAL_SKU%%', escapeHtml(sku))
    .replaceAll('%%INITIAL_RESULT%%', result ? JSON.stringify(result) : 'null')
    .replaceAll('%%INITIAL_ERROR%%', escapeHtml(error))
    .replaceAll('%%INITIAL_SOURCE%%', source)
    .replaceAll('%%INITIAL_SOURCE_LABEL%%', source === 'github' ? 'GitHub' : 'Local')
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
function isAdminAuthorized(req) {
  if (!ADMIN_PASSWORD) return false;
  const auth = getBasicAuth(req);
  return !!auth && constantTimeEqual(auth.id, ADMIN_ID) && constantTimeEqual(auth.password, ADMIN_PASSWORD);
}
function requireAdmin(req, res) {
  if (isAdminAuthorized(req)) return true;
  res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8', 'WWW-Authenticate': 'Basic realm="MSCC Stock Admin", charset="UTF-8"' });
  res.end(ADMIN_PASSWORD ? 'Login required' : 'Admin password is not configured');
  return false;
}

function renderAdminPage({ message = '', error = '' } = {}) {
  const requiredItems = STOCK_FILES.map((file) => `<li><code>${escapeHtml(file)}</code></li>`).join('');
  const statusHtml = error ? `<div class="alert error">${escapeHtml(error)}</div>` : message ? `<div class="alert ok">${escapeHtml(message)}</div>` : '';
  return `<!doctype html><html lang="th"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>MSCC Stock Admin</title><style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111827;background:#f6f7fb}main{width:min(720px,calc(100% - 32px));margin:0 auto;padding:32px 0}section{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:20px;box-shadow:0 12px 40px rgba(17,24,39,.08)}h1{margin:0 0 6px;font-size:28px}p{margin:0 0 18px;color:#4b5563;line-height:1.6}ul{margin:10px 0 0;padding-left:20px;color:#374151;line-height:1.8}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:13px;color:#0f766e}input[type=file]{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}.dropzone{margin-top:16px;border:2px dashed #99f6e4;border-radius:8px;padding:28px 18px;background:#f0fdfa;text-align:center;cursor:pointer}.dropzone.dragging{border-color:#0f766e;background:#ccfbf1}.dropzone strong{display:block;color:#0f766e;font-size:18px}.dropzone span{display:block;margin-top:6px;color:#4b5563}.file-list{margin-top:14px;display:grid;gap:8px}.file-row{display:flex;justify-content:space-between;gap:12px;padding:10px 12px;border-radius:8px;background:#f9fafb;border:1px solid #e5e7eb;font-size:14px}.file-row.good{border-color:#a7f3d0;background:#ecfdf5}.file-row.bad{border-color:#fecaca;background:#fef2f2}button{margin-top:18px;width:100%;border:0;border-radius:8px;padding:14px 16px;background:#0f766e;color:#fff;font-size:16px;font-weight:800;cursor:pointer}button:disabled{background:#9ca3af;cursor:not-allowed}.alert{margin-bottom:16px;border-radius:8px;padding:12px 14px;line-height:1.5}.ok{background:#ecfdf5;color:#047857;border:1px solid #a7f3d0}.error{background:#fef2f2;color:#b91c1c;border:1px solid #fecaca}.note{margin-top:16px;font-size:13px;color:#6b7280}
  </style></head><body><main><section><h1>อัปเดตไฟล์ CSV</h1><p>ลากไฟล์ CSV ทั้ง 4 ไฟล์มาวาง แล้วระบบจะตรวจชื่อไฟล์และความครบก่อนอัปเดตเข้า ${escapeHtml(DATA_REPO)}</p>${statusHtml}<div class="note">ไฟล์ที่ต้องมีครบ:</div><ul>${requiredItems}</ul><form method="post" action="/admin/upload" enctype="multipart/form-data"><label id="dropzone" class="dropzone" for="csvFiles"><strong>ลากไฟล์มาวางที่นี่</strong><span>หรือกดเพื่อเลือกไฟล์ CSV ทั้ง 4 ไฟล์</span></label><input id="csvFiles" name="csvFiles" type="file" accept=".csv,.CSV,text/csv" multiple required /><div id="file-list" class="file-list"></div><button id="submit-button" type="submit" disabled>อัปเดตสต็อก</button></form><div class="note">หลังอัปเดตสำเร็จ หน้า search จะแสดงเวลาอัปเดตไฟล์ล่าสุด</div></section></main><script>
    const requiredFiles=${JSON.stringify(STOCK_FILES)};const input=document.getElementById('csvFiles');const dropzone=document.getElementById('dropzone');const fileList=document.getElementById('file-list');const submitButton=document.getElementById('submit-button');function renderFiles(files){const names=Array.from(files||[]).map((file)=>file.name);const missing=requiredFiles.filter((name)=>!names.includes(name));const unexpected=names.filter((name)=>!requiredFiles.includes(name));const duplicate=names.filter((name,index)=>names.indexOf(name)!==index);const rows=requiredFiles.map((name)=>'<div class="file-row '+(names.includes(name)?'good':'bad')+'"><span><code>'+name+'</code></span><span>'+(names.includes(name)?'พร้อม':'ยังไม่มี')+'</span></div>');for(const name of unexpected)rows.push('<div class="file-row bad"><span><code>'+name+'</code></span><span>ชื่อไฟล์ไม่ถูกต้อง</span></div>');for(const name of duplicate)rows.push('<div class="file-row bad"><span><code>'+name+'</code></span><span>ไฟล์ซ้ำ</span></div>');fileList.innerHTML=rows.join('');submitButton.disabled=missing.length>0||unexpected.length>0||duplicate.length>0}input.addEventListener('change',()=>renderFiles(input.files));dropzone.addEventListener('dragover',(event)=>{event.preventDefault();dropzone.classList.add('dragging')});dropzone.addEventListener('dragleave',()=>dropzone.classList.remove('dragging'));dropzone.addEventListener('drop',(event)=>{event.preventDefault();dropzone.classList.remove('dragging');input.files=event.dataTransfer.files;renderFiles(input.files)});renderFiles([]);
  </script></body></html>`;
}

function readBody(req, limitBytes = MAX_UPLOAD_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => { size += chunk.length; if (size > limitBytes) { reject(new Error('ไฟล์ใหญ่เกินกำหนด')); req.destroy(); return; } chunks.push(chunk); });
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
    const headers = Object.fromEntries(headerText.split('\r\n').map((line) => { const idx = line.indexOf(':'); return idx === -1 ? ['', ''] : [line.slice(0, idx).trim().toLowerCase(), line.slice(idx + 1).trim()]; }).filter(([key]) => key));
    const disposition = parseContentDisposition(headers['content-disposition']);
    let dataEnd = next;
    if (buffer.slice(dataEnd - 2, dataEnd).toString() === '\r\n') dataEnd -= 2;
    const data = buffer.slice(headerEnd + 4, dataEnd);
    if (disposition.name) {
      if (disposition.filename !== undefined) { if (!files[disposition.name]) files[disposition.name] = []; files[disposition.name].push({ filename: disposition.filename, data, contentType: headers['content-type'] || '' }); }
      else fields[disposition.name] = data.toString('utf8');
    }
    cursor = next;
  }
  return { fields, files };
}
async function putGitHubFile(apiPath, contentBuffer, message) {
  const encodedPath = encodeGitHubPath(apiPath);
  const apiUrl = `https://api.github.com/repos/${DATA_REPO}/contents/${encodedPath}`;
  const headers = githubWriteHeaders();
  const current = await fetch(`${apiUrl}?ref=${encodeURIComponent(DATA_BRANCH)}`, { headers });
  const currentText = await current.text();
  let sha = '';
  if (current.ok) sha = JSON.parse(currentText).sha;
  else if (current.status !== 404) throw new Error(`อ่านไฟล์เดิมจาก GitHub ไม่ได้: ${current.status} ${currentText.slice(0, 160)}`);
  const updated = await fetch(apiUrl, { method: 'PUT', headers, body: JSON.stringify({ message, content: contentBuffer.toString('base64'), ...(sha ? { sha } : {}), branch: DATA_BRANCH }) });
  const updatedText = await updated.text();
  if (!updated.ok) throw new Error(`อัปเดต GitHub ไม่สำเร็จ: ${updated.status} ${updatedText.slice(0, 160)}`);
  return JSON.parse(updatedText);
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
  const missing = STOCK_FILES.filter((fileName) => !byName.has(fileName));
  const unexpected = Array.from(byName.keys()).filter((fileName) => !STOCK_FILES.includes(fileName));
  if (missing.length || unexpected.length || duplicates.length) {
    const parts = [];
    if (missing.length) parts.push(`ไฟล์ไม่ครบ: ${missing.join(', ')}`);
    if (unexpected.length) parts.push(`ชื่อไฟล์ไม่ถูกต้อง: ${unexpected.join(', ')}`);
    if (duplicates.length) parts.push(`ไฟล์ซ้ำ: ${duplicates.join(', ')}`);
    throw new Error(parts.join(' | '));
  }
  return STOCK_FILES.map((fileName) => {
    const upload = byName.get(fileName);
    if (!upload.data || upload.data.length === 0) throw new Error(`ไฟล์ว่าง: ${fileName}`);
    return { fileName, data: upload.data };
  });
}
async function updateStockCsvFiles(uploadList) {
  const uploadedAt = new Date().toISOString();
  const updatedFiles = [];
  for (const file of validateStockUploads(uploadList)) {
    await putGitHubFile(`data/${file.fileName}`, file.data, `Update ${file.fileName} from stock admin`);
    updatedFiles.push({ name: file.fileName, size: file.data.length, updated_at: uploadedAt });
  }
  const metadata = { uploaded_at: uploadedAt, files: updatedFiles };
  await putGitHubFile(STOCK_METADATA_PATH, Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`, 'utf8'), 'Update stock upload metadata');
  cache = { fingerprint: '', loadedAt: 0, stockUpdatedAt: uploadedAt, stockFiles: updatedFiles, catalog: new Map(), inventory: [] };
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
      const match = String(req.headers['content-type'] || '').match(/boundary=(?:(?:"([^"]+)")|([^;]+))/i);
      if (!match) throw new Error('ไม่พบ multipart boundary');
      const parsed = parseMultipart(await readBody(req), match[1] || match[2]);
      const uploads = parsed.files.csvFiles || [];
      if (!uploads.length) throw new Error('กรุณาเลือกไฟล์ CSV ทั้ง 4 ไฟล์');
      const metadata = await updateStockCsvFiles(uploads);
      const updatedAt = new Date(metadata.uploaded_at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
      res.writeHead(303, { Location: `/admin?message=${encodeURIComponent(`อัปเดตครบ ${STOCK_FILES.length} ไฟล์แล้ว เวลา ${updatedAt}`)}` });
      res.end();
    } catch (error) {
      res.writeHead(303, { Location: `/admin?error=${encodeURIComponent(error.message || 'อัปเดตไม่สำเร็จ')}` });
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
  if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) { await handleAdmin(req, res, url); return; }
  let state;
  try { state = await refreshIfNeeded(); }
  catch (error) {
    const message = error && error.message ? error.message : 'Failed to load inventory';
    if (url.pathname === '/health') { res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: false, error: message })); return; }
    if (url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(renderIndex({ sku: '', result: null, error: message })); return; }
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: 'load_failed', message })); return;
  }
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, rows: state.inventory.length, skus: state.catalog.size, source: CSV_SOURCE, updated_at: cache.stockUpdatedAt ? new Date(cache.stockUpdatedAt).toISOString() : null, loaded_at: cache.loadedAt ? new Date(cache.loadedAt).toISOString() : null, files: cache.stockFiles }));
    return;
  }
  if (url.pathname === '/search') {
    const query = url.searchParams.get('sku') || url.searchParams.get('q') || '';
    const result = search(query, state.catalog, url.searchParams.get('page') || '1');
    if (!result) { res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: 'not_found', message: 'ไม่พบสินค้า', query })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ...result, source: CSV_SOURCE, updated_at: cache.stockUpdatedAt ? new Date(cache.stockUpdatedAt).toISOString() : null }));
    return;
  }
  if (url.pathname === '/') {
    const initialSku = url.searchParams.get('sku') || '';
    const page = url.searchParams.get('page') || '1';
    const initialResult = initialSku ? search(initialSku, state.catalog, page) : null;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderIndex({ sku: initialSku, result: initialResult, error: url.searchParams.get('error') || '', source: CSV_SOURCE }));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

server.listen(PORT, () => console.log(`Local stock checker running at http://localhost:${PORT}`));

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
const CSV_DECODER = new TextDecoder('windows-874');
const ADMIN_ID = String(process.env.ADMIN_ID || 'mscc-acc');
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '');
const GITHUB_TOKEN = String(process.env.GITHUB_TOKEN || '');
const DATA_REPO = String(process.env.DATA_REPO || 'paphavinmusicconcept-prog/mscc-stock-data');
const DATA_BRANCH = String(process.env.DATA_BRANCH || 'main');
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 15 * 1024 * 1024);
const ALLOWED_STOCK_FILES = [
  'stock_mscc.CSV',
  'stock_mscc_werehouse.CSV',
  'stock_beh_hq.CSV',
  'stock_beh_werehouse.CSV',
  'stock_wt.CSV',
];

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

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

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
  ['stock_mscc_werehouse.csv|04|คลังสำนักงานเพชรบุรีตัดใหม่', 'คลังสำนักงานเพชรบุรีตัดใหม่'],
  ['stock_beh_werehouse.csv|04|คลังสำนักงานเพชรบุรีตัดใหม่', 'คลังสำนักงานเพชรบุรีตัดใหม่'],
  ['stock_mscc.csv|06|คลังฝาก มิวสิคคอนเซพท์ - สนง.เพชรบุรี', 'คลังฝาก MSCC'],
  ['stock_mscc_werehouse.csv|07|เบ๊จองสินค้า-เพชรบุรีฯ', 'เบ๊จอง คลังเพชรบุรีฯ'],
  ['stock_beh_werehouse.csv|07|เบ๊จอง สินค้าคลังเพชรบุรีฯ', 'เบ๊จอง คลังเพชรบุรีฯ'],
  ['stock_beh_werehouse.csv|08|มิวสิคจอง สินค้าคลังเพชรบุรีฯ', 'Mscc จอง คลังเพชรบุรีฯ'],
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
  const parsed = new URL(url);
  parsed.searchParams.set('_', String(Date.now()));
  const response = await fetch(parsed.toString(), {
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
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
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
  if (!auth) return false;
  return constantTimeEqual(auth.id, ADMIN_ID) && constantTimeEqual(auth.password, ADMIN_PASSWORD);
}

function requireAdmin(req, res) {
  if (isAdminAuthorized(req)) return true;
  res.writeHead(401, {
    'Content-Type': 'text/plain; charset=utf-8',
    'WWW-Authenticate': 'Basic realm="MSCC Stock Admin", charset="UTF-8"',
  });
  res.end(ADMIN_PASSWORD ? 'Login required' : 'Admin password is not configured');
  return false;
}

function renderAdminPage({ message = '', error = '' } = {}) {
  const options = ALLOWED_STOCK_FILES
    .map((file) => `<option value="${escapeHtml(file)}">${escapeHtml(file)}</option>`)
    .join('');
  const statusHtml = error
    ? `<div class="alert error">${escapeHtml(error)}</div>`
    : message
      ? `<div class="alert ok">${escapeHtml(message)}</div>`
      : '';

  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MSCC Stock Admin</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111827; background: #f6f7fb; }
    main { width: min(720px, calc(100% - 32px)); margin: 0 auto; padding: 32px 0; }
    section { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; box-shadow: 0 12px 40px rgba(17, 24, 39, .08); }
    h1 { margin: 0 0 6px; font-size: 28px; }
    p { margin: 0 0 18px; color: #4b5563; line-height: 1.6; }
    label { display: block; margin: 16px 0 8px; font-weight: 700; }
    select, input[type="file"] { width: 100%; padding: 12px; border: 1px solid #d1d5db; border-radius: 8px; background: #fff; font-size: 16px; }
    button { margin-top: 18px; width: 100%; border: 0; border-radius: 8px; padding: 14px 16px; background: #0f766e; color: #fff; font-size: 16px; font-weight: 800; cursor: pointer; }
    .alert { margin-bottom: 16px; border-radius: 8px; padding: 12px 14px; line-height: 1.5; }
    .ok { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
    .error { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
    .note { margin-top: 16px; font-size: 13px; color: #6b7280; }
  </style>
</head>
<body>
  <main>
    <section>
      <h1>อัปเดตไฟล์ CSV</h1>
      <p>เลือกไฟล์ CSV จากเครื่อง แล้วระบบจะอัปเดตเข้า ${escapeHtml(DATA_REPO)} ให้อัตโนมัติ</p>
      ${statusHtml}
      <form method="post" action="/admin/upload" enctype="multipart/form-data">
        <label for="fileName">ไฟล์ที่จะอัปเดต</label>
        <select id="fileName" name="fileName" required>${options}</select>
        <label for="csvFile">เลือกไฟล์ CSV</label>
        <input id="csvFile" name="csvFile" type="file" accept=".csv,.CSV,text/csv" required />
        <button type="submit">อัปเดตสต็อก</button>
      </form>
      <div class="note">หลังอัปเดตสำเร็จ แอปค้นหาสต็อกจะอ่านข้อมูลใหม่จาก GitHub raw URL</div>
    </section>
  </main>
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
        reject(new Error('ไฟล์ใหญ่เกินกำหนด'));
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
        files[disposition.name] = { filename: disposition.filename, data, contentType: headers['content-type'] || '' };
      } else {
        fields[disposition.name] = data.toString('utf8');
      }
    }
    cursor = next;
  }

  return { fields, files };
}

async function updateStockCsv(fileName, csvBuffer) {
  if (!GITHUB_TOKEN) throw new Error('ยังไม่ได้ตั้งค่า GITHUB_TOKEN');
  if (!ALLOWED_STOCK_FILES.includes(fileName)) throw new Error('ชื่อไฟล์ไม่อยู่ในรายการที่อนุญาต');
  if (!csvBuffer || csvBuffer.length === 0) throw new Error('ไฟล์ CSV ว่าง');

  const apiPath = `data/${fileName}`;
  const encodedPath = apiPath.split('/').map(encodeURIComponent).join('/');
  const apiUrl = `https://api.github.com/repos/${DATA_REPO}/contents/${encodedPath}`;
  const headers = {
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${GITHUB_TOKEN}`,
    'Content-Type': 'application/json',
    'User-Agent': 'mscc-check-admin',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  const current = await fetch(`${apiUrl}?ref=${encodeURIComponent(DATA_BRANCH)}`, { headers });
  const currentText = await current.text();
  if (!current.ok) throw new Error(`อ่านไฟล์เดิมจาก GitHub ไม่ได้: ${current.status} ${currentText.slice(0, 160)}`);
  const currentJson = JSON.parse(currentText);

  const updated = await fetch(apiUrl, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message: `Update ${fileName} from stock admin`,
      content: csvBuffer.toString('base64'),
      sha: currentJson.sha,
      branch: DATA_BRANCH,
    }),
  });
  const updatedText = await updated.text();
  if (!updated.ok) throw new Error(`อัปเดต GitHub ไม่สำเร็จ: ${updated.status} ${updatedText.slice(0, 160)}`);
  cache = { fingerprint: '', loadedAt: 0, catalog: new Map(), inventory: [] };
  return JSON.parse(updatedText);
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
      if (!match) throw new Error('ไม่พบ multipart boundary');
      const body = await readBody(req);
      const parsed = parseMultipart(body, match[1] || match[2]);
      const fileName = String(parsed.fields.fileName || '').trim();
      const upload = parsed.files.csvFile;
      if (!upload) throw new Error('กรุณาเลือกไฟล์ CSV');
      await updateStockCsv(fileName, upload.data);
      res.writeHead(303, { Location: `/admin?message=${encodeURIComponent(`อัปเดต ${fileName} สำเร็จ`)}` });
      res.end();
    } catch (error) {
      const message = error && error.message ? error.message : 'อัปเดตไม่สำเร็จ';
      res.writeHead(303, { Location: `/admin?error=${encodeURIComponent(message)}` });
      res.end();
    }
    return true;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
  return true;
}

let cache = { fingerprint: '', loadedAt: 0, catalog: new Map(), inventory: [] };

async function refreshIfNeeded() {
  const now = Date.now();

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

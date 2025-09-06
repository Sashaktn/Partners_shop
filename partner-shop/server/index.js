import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import fetch from 'node-fetch';
import { parseStringPromise } from 'xml2js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import https from 'https';
import csv from 'csv-parser';
const require = createRequire(import.meta.url);
const { loadPartnerPrices, getPartnerPrice, updatePartnerPricesFromSheet, downloadSheetToRoot, downloadSheetToData } = require('./partner-prices.cjs');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5173;
const FEED_URL = process.env.FEED_URL;
const FEED_TTL = Number(process.env.FEED_TTL_SECONDS || 600);
const FEED_PATH = path.join(__dirname, 'data', 'feed.xml');

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser(process.env.SESSION_SECRET || 'dev_secret'));

// In-memory cache
let feedCache = { at: 0, data: null };

const rulesPath = path.join(__dirname, 'data', 'rules.json');
function loadRules() {
  try {
    const raw = fs.readFileSync(rulesPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { profiles: {} };
  }
}

function simplifyFeed(feedJson) {
  const shop = feedJson?.yml_catalog?.shop?.[0] || {};
  const categories = (shop.categories?.[0]?.category || []).map(c => ({
    id: String(c.$.id),
    parentId: c.$.parentId ? String(c.$.parentId) : null,
    name: String(c._ || '').trim()
  }));

  const offers = (shop.offers?.[0]?.offer || []).map(o => {
    const pictures = Array.isArray(o.picture) ? o.picture.map(String) : [];
    const params = [];
    if (Array.isArray(o.param)) {
      for (const p of o.param) {
        params.push({
          name: p?.$?.name || '',
          value: String(p._ || '')
        });
      }
    }
    // --- кількість тільки з quantity_in_stock
    let qty = null;
    if (o.quantity_in_stock?.[0] !== undefined && !isNaN(Number(o.quantity_in_stock?.[0]))) {
      qty = Number(o.quantity_in_stock?.[0]);
      if (!Number.isFinite(qty) || qty < 1) qty = null;
    }
    return {
      id: String(o.$.id),
      available: String(o.$.available || 'true') === 'true',
      name: String(o.name_ua?.[0] || o.name?.[0] || '').trim(),
      price: Number(o.price?.[0] || 0),
      currency: String(o.currencyId?.[0] || 'UAH'),
      categoryId: String(o.categoryId?.[0] || ''),
      vendorCode: String(o.vendorCode?.[0] || ''),
      picture: pictures[0] || null,
      pictures,
      description: String(o.description_ua?.[0] || o.description?.[0] || ''),
      quantityInStock: qty,
      maxQty: qty,
      keywords: String(o.keywords_ua?.[0] || o.keywords?.[0] || ''),
      params,
      raw: o
    };
  });

  // Групуємо по categoryId
  const catMap = new Map(categories.map(c => [c.id, c]));
  const groupMap = new Map();
  for (const it of offers) {
    const gid = it.categoryId || 'nogroup';
    if (!groupMap.has(gid)) {
      const cname = catMap.get(gid)?.name || 'Без групи';
      groupMap.set(gid, { id: gid, name: cname, items: [] });
    }
    groupMap.get(gid).items.push(it);
  }

  const groups = Array.from(groupMap.values())
    .sort((a, b) => a.name.localeCompare(b.name));

  return { groups, updatedAt: new Date().toISOString() };
}

async function fetchFeed() {
  const now = Date.now();
  if (feedCache.data && now - feedCache.at < FEED_TTL * 1000) return feedCache.data;
  if (!fs.existsSync(FEED_PATH)) throw new Error('feed.xml not found. Оновіть фід через /api/feed/update');
  const xml = fs.readFileSync(FEED_PATH, 'utf8');
  const json = await parseStringPromise(xml, { explicitArray: true, mergeAttrs: false });
  const simplified = simplifyFeed(json);
  feedCache = { at: now, data: simplified };
  return simplified;
}

// Завантаження цін для партнера А на старті
await loadPartnerPrices().then(() => {
  console.log('Партнерські ціни завантажено!');
}).catch(e => {
  console.error('Не вдалося завантажити partner-prices.csv:', e);
});

const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/12XFa9lnufrJ7uTwLHplgS0W79ZJHkrz3XzYtUI-fdHQ/export?format=csv&gid=0';

function fetchPartnerPrices() {
  return new Promise((resolve, reject) => {
    const priceMap = new Map();
    let rowIdx = 0;
    https.get(SHEET_CSV_URL, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        https.get(res.headers.location, (res2) => {
          res2.pipe(csv({ mapHeaders: ({ header, index }) => index }))
            .on('data', (data) => {
              rowIdx++;
              if (rowIdx < 3) return;
              const article = data[1];
              const price = data[6];
              if (article && price) priceMap.set(article.trim(), Number(price));
            })
            .on('end', () => resolve(priceMap))
            .on('error', reject);
        });
      } else if (res.statusCode === 200) {
        res.pipe(csv({ mapHeaders: ({ header, index }) => index }))
          .on('data', (data) => {
            rowIdx++;
            if (rowIdx < 3) return;
            const article = data[1];
            const price = data[6];
            if (article && price) priceMap.set(article.trim(), Number(price));
          })
          .on('end', () => resolve(priceMap))
          .on('error', reject);
      } else {
        reject(new Error('HTTP status ' + res.statusCode));
      }
    }).on('error', reject);
  });
}

function getPartnerBPrice(article) {
  try {
    const prices = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'partner-b-prices.json'), 'utf8'));
    const found = prices.find(x => String(x.article).trim() === String(article).trim());
    return found ? found.price : null;
  } catch {
    return null;
  }
}

// --- USERS ---
const usersPath = path.join(__dirname, 'data', 'users.json');
function loadUsers() {
  try {
    const raw = fs.readFileSync(usersPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}
function getUserByPhone(phone) {
  const users = loadUsers();
  return users.find(u => u.phone === phone);
}
function getUserById(id) {
  const users = loadUsers();
  return users.find(u => String(u.id) === String(id));
}
function getUserByPhoneAndPassword(phone, password) {
  const users = loadUsers();
  return users.find(u => u.phone === phone && u.password === password);
}
// --- Middleware для user/profile ---
app.use((req, res, next) => {
  const userId = req.cookies.userId;
  if (userId) {
    const user = getUserById(userId);
    if (user) {
      req.user = user;
      req.profile = user.role;
    }
  }
  next();
});
// --- API: логін через телефон і пароль ---
app.post('/api/login-phone', express.json(), (req, res) => {
  const { phone, password } = req.body || {};
  if (!phone || !password) return res.status(400).json({ ok: false, error: 'Вкажіть телефон і пароль' });
  const user = getUserByPhoneAndPassword(phone, password);
  if (!user) return res.status(401).json({ ok: false, error: 'Телефон або пароль невірні' });
  res.cookie('userId', user.id, { httpOnly: true, sameSite: 'lax', maxAge: 30*24*3600*1000 });
  res.json({ ok: true, user: { id: user.id, phone: user.phone, role: user.role } });
});
// --- API: вихід ---
app.post('/api/logout-phone', (req, res) => {
  res.clearCookie('userId');
  res.json({ ok: true });
});
// --- API: отримати профіль ---
app.get('/api/me', (req, res) => {
  if (req.user) {
    return res.json({ profile: req.profile, user: { id: req.user.id, phone: req.user.phone, role: req.user.role } });
  }
  return res.json({ profile: null });
});

// --- FEED ---
app.get('/api/feed', async (req, res) => {
  const p = req.profile || null;
  let file = 'feed.xml';
  if (p === 'partner_A') file = 'feed_partner_A.xml';
  if (p === 'partner_B') file = 'feed_partner_B.xml';
  const filePath = path.join(__dirname, 'data', file);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Фід не знайдено' });
  try {
    const xml = fs.readFileSync(filePath, 'utf8');
    const json = await parseStringPromise(xml, { explicitArray: true, mergeAttrs: false });
    const simplified = simplifyFeed(json);
    res.json(simplified);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});
// --- XML FEEDS for marketplace ---
app.get(['/api/feed.xml', '/api/feed_partner_A.xml', '/api/feed_partner_B.xml'], (req, res) => {
  let file = 'feed.xml';
  if (req.path.endsWith('feed_partner_A.xml')) file = 'feed_partner_A.xml';
  if (req.path.endsWith('feed_partner_B.xml')) file = 'feed_partner_B.xml';
  const filePath = path.join(__dirname, 'data', file);
  if (!fs.existsSync(filePath)) return res.status(404).send('Фід не знайдено');
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  fs.createReadStream(filePath).pipe(res);
});

app.post('/api/feed/update', async (req, res) => {
  try {
    const resp = await fetch(FEED_URL, { timeout: 20000 });
    if (!resp.ok) throw new Error('Feed fetch failed: ' + resp.status);
    const xml = await resp.text();
    fs.writeFileSync(FEED_PATH, xml, 'utf8');
    feedCache = { at: 0, data: null }; // скидаємо кеш
    res.json({ ok: true, message: 'Фід оновлено!' });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// --- PRICE QUOTE (optional, для майбутнього розширення) ---
app.post('/api/price/quote', express.json(), async (req, res) => {
  const { items, groupId } = req.body || {};
  const p = req.cookies.profile || null;
  function priceOf(base, vendorCode) {
    const partnerPrice = getPartnerBPrice(vendorCode);
    let v = Number(base || 0);
    return {
      price: v,
      old: null,
      partnerPrice: partnerPrice !== undefined && partnerPrice !== null && partnerPrice !== '' ? Number(partnerPrice) : null
    };
  }
  const out = (items || []).map(x => {
    const { price, old, partnerPrice } = priceOf(x.price, x.vendorCode);
    return { id: x.id, price, old, partnerPrice };
  });
  res.json({ profile: p, items: out });
});

// --- Завантаження другого аркуша у data/partner-prices.csv ---
app.post('/api/prices/download-root', async (req, res) => {
  try {
    await downloadSheetToData();
    res.json({ ok: true, message: 'Таблицю збережено у data/partner-prices.csv!' });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// --- ORDER → Telegram ---
app.post('/api/order', async (req, res) => {
  try {
    const { items, contact } = req.body || {};
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ ok: false, error: 'Empty cart' });
    }
    const p = req.cookies.profile || 'guest';
    const rules = loadRules();
    const profile = rules.profiles?.[p] || null;

    const subtotal = items.reduce((s, it) => s + (Number(it.price) * Number(it.qty || 1)), 0);
    let total = subtotal;
    let cartNote = '';
    if (profile?.cart_rules) {
      for (const cr of profile.cart_rules) {
        if (cr.threshold_subtotal && subtotal >= cr.threshold_subtotal && cr.extra_discount_percent) {
          const cut = total * (cr.extra_discount_percent/100);
          total -= cut;
          cartNote += `\nCart rule: -${cr.extra_discount_percent}% (≥ ${cr.threshold_subtotal})`;
        }
      }
    }

    const lines = items.map(it => `• ${it.name} (x${it.qty}) — ${it.price} ${it.currency || 'UAH'}`).join('\n');
    const info = contact || {};

    const msg = `🛒 *Нове замовлення*\n\nПрофіль: ${p}\nПозиций: ${items.length}\nСума: ${subtotal.toFixed(2)} → *${total.toFixed(2)}* UAH${cartNote}\n\n${lines}\n\n👤 *Клієнт*\nІм'я: ${info.name || '-'}\nТелефон: ${info.phone || '-'}\nКоментар: ${info.note || '-'}\nВідкрито: ${new Date().toLocaleString('uk-UA')}`;

    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) throw new Error('Telegram env not set');

    const tgRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'Markdown' })
    });
    const tgJson = await tgRes.json();
    if (!tgJson.ok) throw new Error('Telegram error: ' + (tgJson.description || 'unknown'));

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// --- API для адмін-панелі ---
function requireAdmin(req, res, next) {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'admin_A' && req.user.role !== 'admin_B')) return res.status(403).json({ error: 'Тільки для адміна' });
  next();
}
app.get('/api/admin/users', requireAdmin, (req, res) => {
  res.json(loadUsers());
});
app.post('/api/admin/users/:id', requireAdmin, express.json(), (req, res) => {
  const { id } = req.params;
  const { name, role, status } = req.body || {};
  const users = loadUsers();
  const idx = users.findIndex(u => String(u.id) === String(id));
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  if (name !== undefined) users[idx].name = name;
  if (role !== undefined) users[idx].role = role;
  if (status !== undefined) users[idx].status = status;
  fs.writeFileSync(usersPath, JSON.stringify(users, null, 2), 'utf8');
  res.json(users[idx]);
});

// --- Static ---
const pub = path.join(__dirname, 'public');
app.use(express.static(pub, { extensions: ['html'] }));

// Fallback to SPA
app.get('*', (_req, res) => {
  res.sendFile(path.join(pub, 'index.html'));
});

app.listen(PORT, () => console.log('Server on http://localhost:' + PORT));


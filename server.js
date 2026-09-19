// ============================================================
//              CosmoMes Server — полная версия 2.0
// ============================================================
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

// ---------- Конфиг ----------
const ADMIN_LOGIN = process.env.ADMIN_LOGIN || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'cosmo2024';
const ONLINE_WINDOW_MS = 30_000;   // 30 сек — считаем онлайн
const CODE_TTL_MS = 5 * 60_000;    // код живёт 5 минут

// ============================================================
//                       ХРАНИЛИЩЕ
// ============================================================
let db = {
  users: [],
  messages: [],
  transactions: [],
  gifts: [],
  codes: {},       // phone → { code, expiresAt }
  presence: {},    // username → timestamp (ms)
  nextUserId: 1,
  nextMsgId: 1,
  nextTxId: 1
};

function loadDb() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      db.codes = db.codes || {};
      db.presence = db.presence || {};
      db.users = db.users || [];
      db.messages = db.messages || [];
      db.transactions = db.transactions || [];
      db.gifts = db.gifts || [];
      db.nextUserId = db.nextUserId || 1;
      db.nextMsgId = db.nextMsgId || 1;
      db.nextTxId = db.nextTxId || 1;
      console.log(`📂 Загружено: ${db.users.length} юзеров, ${db.messages.length} сообщений`);
    } catch (e) {
      console.error('Ошибка чтения data.json:', e.message);
    }
  }
}

function saveDb() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
  } catch (e) {
    console.error('Ошибка записи data.json:', e.message);
  }
}

loadDb();
setInterval(saveDb, 5000);

// ============================================================
//                       ХЕЛПЕРЫ
// ============================================================
function clean(u) {
  return String(u || '').replace(/^@/, '').trim().toLowerCase().slice(0, 32);
}

function isOnline(username) {
  const t = db.presence[clean(username)];
  return t && Date.now() - t < ONLINE_WINDOW_MS;
}

function findUser(username) {
  return db.users.find(u => u.username === clean(username));
}

function computeBadges(u) {
  const badges = [];
  const msgs = u.messagesCount || 0;
  if (msgs > 50) badges.push('chatterbox');
  if (msgs > 500) badges.push('helper');
  if ((u.cosmics || 0) > 100) badges.push('cosmonaut');
  if (u.createdAt) {
    const days = (Date.now() - new Date(u.createdAt).getTime()) / 86400000;
    if (days > 30) badges.push('early_bird');
  }
  const hour = new Date().getHours();
  if (hour >= 5 && hour <= 8) badges.push('night_owl');
  return badges;
}

function publicUser(u, forSelf = false) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    avatar: u.avatar || '',
    cosmics: u.cosmics || 0,
    online: isOnline(u.username),
    bio: u.bio || '',
    status: u.status || '',
    badges: computeBadges(u),
    messagesCount: u.messagesCount || 0,
    contactsCount: u.contactsCount || 0,
    createdAt: u.createdAt || '',
    lastSeen: db.presence[u.username]
      ? new Date(db.presence[u.username]).toISOString()
      : (u.createdAt || ''),
    phone: forSelf ? (u.phone || '') : undefined
  };
}

function countContacts(username) {
  const contacts = new Set();
  db.messages.forEach(m => {
    if (m.from === username) contacts.add(m.to);
    if (m.to === username) contacts.add(m.from);
  });
  return contacts.size;
}

function checkAdmin(admin, password) {
  return clean(admin) === clean(ADMIN_LOGIN) && password === ADMIN_PASSWORD;
}

// ============================================================
//                       AUTH
// ============================================================
app.post('/auth/request-code', (req, res) => {
  const phone = String(req.body.phone || '').trim();
  if (!phone) return res.status(400).json({ error: 'phone required' });

  const code = String(Math.floor(100000 + Math.random() * 900000));
  db.codes[phone] = { code, expiresAt: Date.now() + CODE_TTL_MS };
  saveDb();

  console.log(`📱 [CODE] ${phone} → ${code}`);
  res.json({ ok: true, demoCode: code });
});

app.post('/auth/verify-code', (req, res) => {
  const phone = String(req.body.phone || '').trim();
  const code = String(req.body.code || '').trim();
  const entry = db.codes[phone];

  if (!entry || entry.code !== code || Date.now() > entry.expiresAt) {
    return res.status(400).json({ error: 'invalid or expired code' });
  }

  delete db.codes[phone];
  saveDb();

  const user = db.users.find(u => u.phone === phone);
  res.json({ ok: true, user: user ? { username: user.username } : null });
});

app.post('/register', (req, res) => {
  const name = String(req.body.name || '').trim();
  const username = clean(req.body.username);
  const phone = String(req.body.phone || '').trim();
  const avatar = String(req.body.avatar || '');

  if (!name || username.length < 3) {
    return res.status(400).json({ error: 'invalid name or username' });
  }
  if (findUser(username)) {
    return res.status(409).json({ error: 'username taken' });
  }
  if (phone && db.users.find(u => u.phone === phone)) {
    return res.status(409).json({ error: 'phone already registered' });
  }

  const user = {
    id: db.nextUserId++,
    username,
    name,
    phone,
    avatar,
    cosmics: 100,
    bio: '',
    status: '',
    messagesCount: 0,
    contactsCount: 0,
    banned: false,
    createdAt: new Date().toISOString()
  };
  db.users.push(user);

  db.transactions.push({
    id: db.nextTxId++,
    username,
    amount: 100,
    type: 'welcome',
    description: 'Приветственный бонус',
    createdAt: new Date().toISOString()
  });

  saveDb();
  console.log(`✨ Новый юзер: @${username}`);
  res.json({ ok: true, user: publicUser(user, true) });
});

// ============================================================
//                       USERS
// ============================================================
app.get('/users', (req, res) => {
  res.json(db.users.filter(u => !u.banned).map(u => publicUser(u)));
});

app.get('/profile', (req, res) => {
  const username = clean(req.query.username);
  const viewer = clean(req.query.viewer);
  const user = findUser(username);
  if (!user) return res.status(404).json({ error: 'user not found' });
  if (user.banned) return res.status(403).json({ error: 'user banned' });
  res.json(publicUser(user, viewer === username));
});

app.post('/profile', (req, res) => {
  const username = clean(req.body.username);
  const user = findUser(username);
  if (!user) return res.status(404).json({ error: 'user not found' });

  if (req.body.name !== undefined) {
    user.name = String(req.body.name).trim().slice(0, 60);
  }
  if (req.body.avatar !== undefined) {
    user.avatar = String(req.body.avatar).slice(0, 2_000_000);
  }
  if (req.body.bio !== undefined) {
    user.bio = String(req.body.bio).trim().slice(0, 120);
  }
  if (req.body.status !== undefined) {
    user.status = String(req.body.status).trim().slice(0, 60);
  }

  saveDb();
  res.json({ ok: true, user: publicUser(user, true) });
});

// ============================================================
//                       SEARCH
// ============================================================
app.get('/search', (req, res) => {
  const q = String(req.query.q || '').toLowerCase().trim();
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);

  if (q.length < 2) return res.json([]);

  const results = db.users
    .filter(u => !u.banned)
    .filter(u =>
      u.username.includes(q) ||
      (u.name || '').toLowerCase().includes(q)
    )
    .slice(0, limit)
    .map(u => publicUser(u));

  res.json(results);
});

// ============================================================
//                       PRESENCE
// ============================================================
app.post('/presence', (req, res) => {
  const username = clean(req.body.username);
  if (!findUser(username)) return res.status(404).json({ error: 'user not found' });
  db.presence[username] = Date.now();
  res.json({ ok: true });
});

// ============================================================
//                       MESSAGES
// ============================================================
app.get('/messages', (req, res) => {
  const a = clean(req.query.user1);
  const b = clean(req.query.user2);
  const list = db.messages.filter(m =>
    (m.from === a && m.to === b) || (m.from === b && m.to === a)
  );
  res.json(list);
});

app.post('/messages', (req, res) => {
  const from = clean(req.body.from);
  const to = clean(req.body.to);
  const text = String(req.body.text || '');

  if (!from || !to || !text) return res.status(400).json({ error: 'missing fields' });

  const sender = findUser(from);
  const receiver = findUser(to);
  if (!sender || !receiver) return res.status(404).json({ error: 'user not found' });
  if (receiver.banned) return res.status(403).json({ error: 'receiver banned' });

  const msg = {
    id: db.nextMsgId++,
    from,
    to,
    text: text.slice(0, 500_000),
    createdAt: new Date().toISOString()
  };
  db.messages.push(msg);

  sender.messagesCount = (sender.messagesCount || 0) + 1;
  sender.cosmics = (sender.cosmics || 0) + 1;

  if (db.messages.length > 100_000) {
    db.messages = db.messages.slice(-50_000);
  }

  saveDb();
  res.json({ ok: true, message: msg });
});

// ============================================================
//                       COSMICS
// ============================================================
app.get('/cosmics', (req, res) => {
  const username = clean(req.query.username);
  const user = findUser(username);
  if (!user) return res.status(404).json({ error: 'user not found' });

  const history = db.transactions
    .filter(t => t.username === username)
    .slice(-100)
    .reverse();

  res.json({ balance: user.cosmics || 0, history });
});


// ============================================================
//                       GIFTS
// ============================================================
const DEFAULT_GIFTS = [
  { id: 'rose', name: 'Роза', emoji: '🌹', price: 10, description: 'Маленький знак внимания' },
  { id: 'star', name: 'Звезда', emoji: '⭐', price: 50, description: 'Яркий подарок' },
  { id: 'planet', name: 'Планета', emoji: '🪐', price: 150, description: 'Космический подарок' },
  { id: 'galaxy', name: 'Галактика', emoji: '🌌', price: 500, description: 'Большой космический подарок' }
];

app.get('/gifts/catalog', (req, res) => res.json(DEFAULT_GIFTS));

app.get('/gifts', (req, res) => {
  const username = clean(req.query.username);
  res.json((db.gifts || []).filter(g => g.to === username || g.from === username).slice(-100).reverse());
});

app.post('/gifts/send', (req, res) => {
  const from = clean(req.body.from);
  const to = clean(req.body.to);
  const giftId = String(req.body.giftId || '');
  const sender = findUser(from);
  const receiver = findUser(to);
  const gift = DEFAULT_GIFTS.find(g => g.id === giftId);

  if (!sender || !receiver) return res.status(404).json({ error: 'user not found' });
  if (sender.banned || receiver.banned) return res.status(403).json({ error: 'user banned' });
  if (!gift) return res.status(404).json({ error: 'gift not found' });
  if (from === to) return res.status(400).json({ error: 'cannot gift yourself' });
  if ((sender.cosmics || 0) < gift.price) return res.status(400).json({ error: 'not enough cosmics' });

  sender.cosmics -= gift.price;
  receiver.giftCount = (receiver.giftCount || 0) + 1;
  const record = {
    id: String(Date.now()) + '_' + String(db.nextTxId++),
    giftId: gift.id, name: gift.name, emoji: gift.emoji, price: gift.price,
    from, to, createdAt: new Date().toISOString()
  };
  db.gifts.push(record);
  db.transactions.push({
    id: db.nextTxId++, username: from, amount: -gift.price, type: 'gift_sent',
    description: 'Подарок ' + gift.emoji + ' ' + gift.name + ' → @' + to,
    createdAt: new Date().toISOString()
  });
  db.transactions.push({
    id: db.nextTxId++, username: to, amount: 0, type: 'gift_received',
    description: 'Получен подарок ' + gift.emoji + ' ' + gift.name + ' от @' + from,
    createdAt: new Date().toISOString()
  });
  saveDb();
  res.json({ ok: true, gift: record, balance: sender.cosmics });
});

// ============================================================
//                       STATS
// ============================================================
app.get('/stats', (req, res) => {
  const username = clean(req.query.username);
  const user = findUser(username);
  if (!user) return res.status(404).json({ error: 'user not found' });

  const msgs = db.messages.filter(m => m.from === username || m.to === username).length;
  const online = db.users.filter(u => isOnline(u.username)).length;

  const created = user.createdAt ? new Date(user.createdAt).getTime() : Date.now();
  const days = Math.max(1, Math.floor((Date.now() - created) / 86400000));

  res.json({
    messages: msgs,
    online,
    cosmics: user.cosmics || 0,
    days,
    contacts: countContacts(username)
  });
});

// ============================================================
//                       AI / BOT
// ============================================================
app.post('/ai/chat', (req, res) => {
  const text = String(req.body.text || '').trim();
  const username = clean(req.body.username);
  if (!text) return res.status(400).json({ error: 'text required' });

  const user = findUser(username);

  // Простые ответы (можно заменить на OpenAI API)
  const lower = text.toLowerCase();

  let reply;
  if (lower.includes('привет') || lower.includes('hello')) {
    reply = `Привет${user ? ', @' + user.username : ''}! Чем могу помочь? 👋`;
  } else if (lower.includes('как дела')) {
    reply = 'Отлично! Все процессы работают штатно. А у тебя?';
  } else if (lower.includes('космик')) {
    reply = `У тебя ${user ? user.cosmics : 0} ✦. Копи на мечту!`;
  } else if (lower.includes('спасибо')) {
    reply = 'Всегда рад помочь! 😊';
  } else if (lower.includes('?')) {
    reply = 'Хороший вопрос! Дай подумать... 🤔\n\nЯ бы сказал, что всё зависит от контекста. Расскажи подробнее.';
  } else {
    const replies = [
      "Интересная мысль! Расскажи подробнее.",
      "Понял тебя. А что ты об этом думаешь?",
      "Согласен на все 100%. Что дальше?",
      "Хм, давай разберём это вместе.",
      `Кстати, у тебя уже ${user ? user.cosmics : 0} ✦. Неплохо!`,
      "Я всегда рядом, если что 😊",
      "Расскажи, как прошёл твой день?",
      "Мне нравится ход твоих мыслей! ✨"
    ];
    reply = replies[Math.floor(Math.random() * replies.length)];
  }

  res.json({ reply });
});

app.post('/bot', (req, res) => {
  const username = clean(req.body.username);
  const text = String(req.body.text || '').trim().toLowerCase();
  const user = findUser(username);

  if (text === '/balance') {
    return res.json({ reply: `У тебя ${user ? user.cosmics : 0} ✦ космиков.` });
  }

  if (text === '/help') {
    return res.json({
      reply: '📖 Команды:\n' +
        '/balance — баланс\n' +
        '/give — получить 10 ✦\n' +
        '/gifts — подарки\n' +
        '/top — топ юзеров\n' +
        '/help — помощь'
    });
  }

  if (text === '/give') {
    if (user) {
      user.cosmics = (user.cosmics || 0) + 10;
      db.transactions.push({
        id: db.nextTxId++,
        username,
        amount: 10,
        type: 'gift',
        description: 'Бонус от CosmoAI',
        createdAt: new Date().toISOString()
      });
      saveDb();
    }
    return res.json({ reply: 'Держи 10 ✦! Используй с умом. 🎁' });
  }

  if (text === '/gifts') {
    return res.json({
      reply: '🎁 Доступные подарки:\n' +
        '• Стикерпак «Космос» — 50 ✦\n' +
        '• Тема «Галактика» — 100 ✦\n' +
        '• Премиум на месяц — 500 ✦'
    });
  }

  if (text === '/top') {
    const top = [...db.users]
      .sort((a, b) => (b.cosmics || 0) - (a.cosmics || 0))
      .slice(0, 5)
      .map((u, i) => `${i + 1}. @${u.username} — ${u.cosmics} ✦`)
      .join('\n');
    return res.json({ reply: '🏆 Топ-5:\n' + top });
  }

  res.json({ reply: '❓ Неизвестная команда. Попробуй /help' });
});

// ============================================================
//                       BLOCK
// ============================================================
app.post('/block', (req, res) => {
  const username = clean(req.body.username);
  const target = clean(req.body.target);
  if (!findUser(username) || !findUser(target)) {
    return res.status(404).json({ error: 'user not found' });
  }
  res.json({ ok: true });
});

// ============================================================
//                       ADMIN
// ============================================================
app.post('/admin/login', (req, res) => {
  const admin = clean(req.body.username);
  const password = String(req.body.password || '');
  if (!checkAdmin(admin, password)) {
    return res.status(403).json({ error: 'invalid credentials' });
  }
  res.json({ ok: true });
});

app.get('/admin/users', (req, res) => {
  const admin = clean(req.query.admin);
  const password = String(req.query.password || '');
  if (!checkAdmin(admin, password)) {
    return res.status(403).json({ error: 'forbidden' });
  }

  res.json(db.users.map(u => ({
    id: u.id,
    username: u.username,
    name: u.name,
    avatar: u.avatar || '',
    cosmics: u.cosmics || 0,
    online: isOnline(u.username),
    phone: u.phone || '',
    createdAt: u.createdAt || '',
    lastSeen: db.presence[u.username]
      ? new Date(db.presence[u.username]).toISOString()
      : (u.createdAt || ''),
    messagesCount: u.messagesCount || 0,
    banned: !!u.banned
  })));
});

app.post('/admin/ban', (req, res) => {
  const { admin, password, target } = req.body;
  if (!checkAdmin(admin, password)) return res.status(403).json({ error: 'forbidden' });
  const u = findUser(target);
  if (!u) return res.status(404).json({ error: 'user not found' });
  u.banned = true;
  saveDb();
  console.log(`🚫 BAN: @${u.username}`);
  res.json({ ok: true });
});

app.post('/admin/unban', (req, res) => {
  const { admin, password, target } = req.body;
  if (!checkAdmin(admin, password)) return res.status(403).json({ error: 'forbidden' });
  const u = findUser(target);
  if (!u) return res.status(404).json({ error: 'user not found' });
  u.banned = false;
  saveDb();
  console.log(`✅ UNBAN: @${u.username}`);
  res.json({ ok: true });
});

app.post('/admin/delete', (req, res) => {
  const { admin, password, target } = req.body;
  if (!checkAdmin(admin, password)) return res.status(403).json({ error: 'forbidden' });

  const t = clean(target);
  const before = db.users.length;
  db.users = db.users.filter(u => u.username !== t);
  db.messages = db.messages.filter(m => m.from !== t && m.to !== t);
  db.transactions = db.transactions.filter(x => x.username !== t);

  saveDb();
  console.log(`🗑 DELETE: @${t} (${before - db.users.length} удалено)`);
  res.json({ ok: true });
});

app.post('/admin/give', (req, res) => {
  const { admin, password, target, amount } = req.body;
  if (!checkAdmin(admin, password)) return res.status(403).json({ error: 'forbidden' });

  const u = findUser(target);
  if (!u) return res.status(404).json({ error: 'user not found' });

  const amt = parseInt(amount) || 0;
  u.cosmics = (u.cosmics || 0) + amt;

  db.transactions.push({
    id: db.nextTxId++,
    username: u.username,
    amount: amt,
    type: 'admin',
    description: amt > 0 ? 'Начислено администратором' : 'Списано администратором',
    createdAt: new Date().toISOString()
  });

  saveDb();
  console.log(`💰 GIVE: @${u.username} ${amt > 0 ? '+' : ''}${amt} ✦`);
  res.json({ ok: true, balance: u.cosmics });
});

app.post('/admin/broadcast', (req, res) => {
  const { admin, password, text } = req.body;
  if (!checkAdmin(admin, password)) return res.status(403).json({ error: 'forbidden' });
  console.log(`📢 BROADCAST: ${text}`);
  // Тут можно разослать push-уведомления
  res.json({ ok: true });
});

// ============================================================
//                       HEALTH / ROOT
// ============================================================
app.get('/', (req, res) => {
  res.json({
    name: 'CosmoMes Server',
    version: '2.0',
    status: 'online',
    stats: {
      users: db.users.length,
      messages: db.messages.length,
      transactions: db.transactions.length,
      online: db.users.filter(u => isOnline(u.username)).length
    },
    endpoints: [
      'POST /auth/request-code',
      'POST /auth/verify-code',
      'POST /register',
      'GET  /users',
      'GET  /profile?username=X',
      'POST /profile',
      'GET  /search?q=X',
      'POST /presence',
      'GET  /messages?user1=X&user2=Y',
      'POST /messages',
      'GET  /cosmics?username=X',
      'GET  /gifts/catalog',
      'GET  /gifts?username=X',
      'POST /gifts/send',
      'GET  /stats?username=X',
      'POST /ai/chat',
      'POST /bot',
      'POST /block',
      'POST /admin/login',
      'GET  /admin/users',
      'POST /admin/ban',
      'POST /admin/unban',
      'POST /admin/delete',
      'POST /admin/give',
      'POST /admin/broadcast'
    ]
  });
});

// ============================================================
//                       START
// ============================================================
app.listen(PORT, () => {
  console.log('');
  console.log('🚀 ====================================');
  console.log(`🚀  CosmoMes Server v2.0`);
  console.log(`🚀  Порт: ${PORT}`);
  console.log(`🚀  Юзеров: ${db.users.length}`);
  console.log(`🚀  Сообщений: ${db.messages.length}`);
  console.log(`🚀  Админ: ${ADMIN_LOGIN} / ${ADMIN_PASSWORD}`);
  console.log('🚀 ====================================');
  console.log('');
});

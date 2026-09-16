const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-luna';

app.use(cors());
app.use(express.json({ limit: '2mb' }));

const users = [];
const messages = [];
const transactions = [];
const gifts = [];
const pendingAuth = new Map();
const aiRate = new Map();

function clean(value) {
  return String(value ?? '').trim();
}

function normalizePhone(value) {
  return clean(value).replace(/[\s()\-]/g, '');
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    avatar: user.avatar || '',
    phone: user.phone || '',
    cosmics: user.cosmics || 0,
    online: !!user.online
  };
}

function findUser(username) {
  const u = clean(username).replace(/^@/, '').toLowerCase();
  return users.find(x => x.username.toLowerCase() === u);
}

function validUsername(username) {
  return /^[a-zA-Z0-9_]{3,32}$/.test(username);
}

app.get('/', (_req, res) => {
  res.json({ app: 'CosmoMes', status: 'online', version: '4.0' });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, users: users.length, messages: messages.length, version: '4.0' });
});

// DEMO phone verification. For real SMS delivery, connect an SMS provider.
app.post('/auth/request-code', (req, res) => {
  const phone = normalizePhone(req.body.phone);
  if (!/^\+?[0-9]{8,15}$/.test(phone)) {
    return res.status(400).json({ success: false, message: 'Введите корректный номер телефона' });
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = Date.now() + 5 * 60 * 1000;
  pendingAuth.set(phone, { code, expiresAt });

  console.log(`[CosmoMes] Verification code for ${phone}: ${code}`);
  const existing = users.find(u => u.phone === phone);

  res.json({
    success: true,
    exists: !!existing,
    message: 'Код подтверждения создан',
    demoCode: code
  });
});

app.post('/auth/verify-code', (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const code = clean(req.body.code);
  const record = pendingAuth.get(phone);

  if (!record || record.expiresAt < Date.now() || record.code !== code) {
    return res.status(400).json({ success: false, message: 'Неверный или просроченный код' });
  }

  pendingAuth.delete(phone);
  const user = users.find(u => u.phone === phone);

  if (user) {
    user.online = true;
    return res.json({ success: true, registered: true, user: publicUser(user) });
  }

  res.json({ success: true, registered: false, phone });
});

app.post('/register', (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const username = clean(req.body.username).replace(/^@/, '');
  const name = clean(req.body.name);
  const avatar = clean(req.body.avatar);

  if (!/^\+?[0-9]{8,15}$/.test(phone)) {
    return res.status(400).json({ success: false, message: 'Неверный номер телефона' });
  }
  if (!validUsername(username)) {
    return res.status(400).json({ success: false, message: 'Username: 3–32 символа, только латиница, цифры и _' });
  }
  if (!name || name.length > 50) {
    return res.status(400).json({ success: false, message: 'Введите имя' });
  }
  if (users.some(u => u.phone === phone)) {
    return res.status(409).json({ success: false, message: 'Этот номер уже зарегистрирован' });
  }
  if (findUser(username)) {
    return res.status(409).json({ success: false, message: 'Этот username уже занят' });
  }

  const user = {
    id: users.length + 1,
    phone,
    username,
    name,
    avatar: avatar.slice(0, 500000),
    cosmics: 0,
    online: true
  };
  users.push(user);
  res.json({ success: true, user: publicUser(user) });
});

app.post('/login', (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const user = users.find(u => u.phone === phone);
  if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден' });
  user.online = true;
  res.json({ success: true, user: publicUser(user) });
});

app.post('/presence', (req, res) => {
  const user = findUser(req.body.username);
  if (!user) return res.status(404).json({ success: false });
  user.online = !!req.body.online;
  res.json({ success: true });
});

app.get('/users', (_req, res) => {
  res.json({ users: users.map(publicUser) });
});

app.get('/profile', (req, res) => {
  const user = findUser(req.query.username);
  if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден' });
  res.json(publicUser(user));
});

app.post('/profile', (req, res) => {
  const user = findUser(req.body.username);
  if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден' });

  if (req.body.name !== undefined) {
    const name = clean(req.body.name);
    if (!name || name.length > 50) return res.status(400).json({ success: false, message: 'Некорректное имя' });
    user.name = name;
  }
  if (req.body.avatar !== undefined) user.avatar = clean(req.body.avatar).slice(0, 500000);

  res.json({ success: true, user: publicUser(user) });
});

app.get('/messages', (req, res) => {
  const a = clean(req.query.user1).replace(/^@/, '').toLowerCase();
  const b = clean(req.query.user2).replace(/^@/, '').toLowerCase();
  const result = messages.filter(m =>
    (m.from === a && m.to === b) || (m.from === b && m.to === a)
  );
  res.json({ messages: result });
});

app.post('/messages', (req, res) => {
  const from = clean(req.body.from).replace(/^@/, '').toLowerCase();
  const to = clean(req.body.to).replace(/^@/, '').toLowerCase();
  const text = clean(req.body.text);
  if (!from || !to || !text) return res.status(400).json({ success: false, message: 'Пустое сообщение' });

  const message = {
    id: messages.length + 1,
    from,
    to,
    text: text.slice(0, 4000),
    time: new Date().toISOString()
  };
  messages.push(message);
  res.json({ success: true, message });
});

app.get('/cosmics', (req, res) => {
  const user = findUser(req.query.username);
  if (!user) return res.status(404).json({ success: false });
  res.json({ cosmics: user.cosmics || 0 });
});

app.post('/cosmics/give', (req, res) => {
  const from = findUser(req.body.from);
  const to = findUser(req.body.to);
  const amount = Math.floor(Number(req.body.amount));
  if (!to || !Number.isFinite(amount) || amount <= 0) return res.status(400).json({ success: false, message: 'Некорректные данные' });
  if (from && from.cosmics < amount) return res.status(400).json({ success: false, message: 'Недостаточно космиков' });
  if (from) from.cosmics -= amount;
  to.cosmics = (to.cosmics || 0) + amount;
  transactions.push({ from: from?.username || 'system', to: to.username, amount, time: new Date().toISOString() });
  res.json({ success: true, cosmics: to.cosmics });
});

app.get('/gifts/catalog', (_req, res) => {
  res.json({ gifts: [
    { id: 'star', name: 'Звезда', price: 10, emoji: '⭐' },
    { id: 'planet', name: 'Планета', price: 25, emoji: '🪐' },
    { id: 'rocket', name: 'Ракета', price: 50, emoji: '🚀' },
    { id: 'galaxy', name: 'Галактика', price: 100, emoji: '🌌' }
  ]});
});

app.post('/gifts/send', (req, res) => {
  const from = findUser(req.body.from);
  const to = findUser(req.body.to);
  const catalog = {
    star: ['Звезда', 10, '⭐'],
    planet: ['Планета', 25, '🪐'],
    rocket: ['Ракета', 50, '🚀'],
    galaxy: ['Галактика', 100, '🌌']
  };
  const item = catalog[clean(req.body.giftId)];
  if (!from || !to || !item) return res.status(400).json({ success: false, message: 'Некорректные данные' });
  if ((from.cosmics || 0) < item[1]) return res.status(400).json({ success: false, message: 'Недостаточно космиков' });
  from.cosmics -= item[1];
  gifts.push({ from: from.username, to: to.username, giftId: req.body.giftId, name: item[0], emoji: item[2], time: new Date().toISOString() });
  res.json({ success: true, cosmics: from.cosmics });
});

app.get('/gifts', (req, res) => {
  const username = clean(req.query.username).replace(/^@/, '').toLowerCase();
  res.json({ gifts: gifts.filter(g => g.to === username || g.from === username) });
});

app.post('/bot', (req, res) => {
  const command = clean(req.body.command);
  const parts = command.split(/\s+/);
  if (parts[0] !== '/give' || parts.length !== 3) {
    return res.status(400).json({ success: false, message: 'Использование: /give @username количество' });
  }
  const to = findUser(parts[1]);
  const amount = Math.floor(Number(parts[2]));
  if (!to || !Number.isFinite(amount) || amount <= 0) return res.status(400).json({ success: false, message: 'Некорректная команда' });
  to.cosmics = (to.cosmics || 0) + amount;
  transactions.push({ from: 'CosmoBot', to: to.username, amount, time: new Date().toISOString() });
  res.json({ success: true, message: `Начислено ${amount} космиков пользователю @${to.username}`, cosmics: to.cosmics });
});

app.post('/admin/login', (req, res) => {
  if (!ADMIN_PASSWORD || clean(req.body.password) !== ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, message: 'Неверный пароль' });
  }
  res.json({ success: true });
});

app.get('/admin/users', (req, res) => {
  if (!ADMIN_PASSWORD || clean(req.query.password) !== ADMIN_PASSWORD) return res.status(401).json({ success: false });
  res.json({ users: users.map(publicUser), transactions });
});

app.post('/admin/give', (req, res) => {
  if (!ADMIN_PASSWORD || clean(req.body.password) !== ADMIN_PASSWORD) return res.status(401).json({ success: false });
  const user = findUser(req.body.username);
  const amount = Math.floor(Number(req.body.amount));
  if (!user || !Number.isFinite(amount)) return res.status(400).json({ success: false, message: 'Некорректные данные' });
  user.cosmics = (user.cosmics || 0) + amount;
  transactions.push({ from: 'Admin', to: user.username, amount, time: new Date().toISOString() });
  res.json({ success: true, cosmics: user.cosmics });
});

app.post('/ai/chat', async (req, res) => {
  if (!OPENAI_API_KEY) return res.status(503).json({ success: false, message: 'CosmoAI не настроен: добавьте OPENAI_API_KEY в Render Environment' });

  const username = clean(req.body.username).replace(/^@/, '').toLowerCase();
  const now = Date.now();
  const last = aiRate.get(username) || 0;
  if (now - last < 1200) return res.status(429).json({ success: false, message: 'Слишком часто. Подожди немного.' });
  aiRate.set(username, now);

  const history = Array.isArray(req.body.messages) ? req.body.messages.slice(-20) : [];
  const input = history.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: clean(m.content).slice(0, 4000) }));

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        instructions: 'Ты CosmoAI внутри мессенджера CosmoMes. Общайся естественно, современно и по делу. Не называй интерфейс отдельным сайтом или страницей. Отвечай на русском, если пользователь пишет по-русски. Не будь детским или чрезмерно официальным. Помогай с учёбой, кодом, идеями, играми и обычными вопросами.',
        input
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('OpenAI error:', data);
      return res.status(502).json({ success: false, message: 'CosmoAI временно недоступен' });
    }

    const text = data.output_text || (data.output || [])
      .flatMap(item => item.content || [])
      .map(part => part.text || '')
      .join('')
      .trim();

    res.json({ success: true, reply: text || 'Не получилось получить ответ.' });
  } catch (error) {
    console.error('AI request failed:', error);
    res.status(502).json({ success: false, message: 'Ошибка соединения с CosmoAI' });
  }
});

app.listen(PORT, () => {
  console.log(`CosmoMes server 4.0 running on port ${PORT}`);
});

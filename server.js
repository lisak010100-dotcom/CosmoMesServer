const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-luna';

app.use(cors());
app.use(express.json({ limit: '1mb' }));

const users = [];
const messages = [];
const transactions = [];
const gifts = [];
const aiRate = new Map();

const catalog = [
  { id: 'rose', name: 'Роза', emoji: '🌹', price: 100 },
  { id: 'diamond', name: 'Алмаз', emoji: '💎', price: 500 },
  { id: 'rocket', name: 'Ракета', emoji: '🚀', price: 1000 },
  { id: 'galaxy', name: 'Галактика', emoji: '🌌', price: 2500 },
  { id: 'crown', name: 'Корона', emoji: '👑', price: 5000 }
];

const clean = value => String(value || '').replace(/^@/, '').trim().toLowerCase();
const findUser = username => users.find(u => u.username === clean(username));
const isOnline = user => user && user.lastSeen && Date.now() - new Date(user.lastSeen).getTime() < 90000;

function publicUser(user) {
  return user && {
    id: user.id,
    username: user.username,
    name: user.name,
    avatar: user.avatar,
    cosmics: user.cosmics,
    createdAt: user.createdAt,
    lastSeen: user.lastSeen || null,
    online: Boolean(isOnline(user))
  };
}

function addTx(username, amount, type, description) {
  transactions.push({
    id: transactions.length + 1,
    username,
    amount,
    type,
    description,
    createdAt: new Date().toISOString()
  });
}

app.get('/', (_, res) => res.json({
  app: 'CosmoMes',
  version: '3.2',
  status: 'online',
  ai: Boolean(OPENAI_API_KEY)
}));

app.get('/health', (_, res) => res.json({ ok: true, version: '3.2' }));

app.post('/register', (req, res) => {
  const username = clean(req.body.username);
  const name = String(req.body.name || '').trim();

  if (!username || !name) return res.status(400).json({ error: 'Username и имя обязательны' });
  if (!/^[a-z0-9_]{3,24}$/i.test(username)) {
    return res.status(400).json({ error: 'Username: только латинские буквы, цифры и _ (3–24 символа)' });
  }
  if (findUser(username)) return res.status(409).json({ error: 'Такой username уже существует' });

  const user = {
    id: users.length + 1,
    username,
    name: name.slice(0, 40),
    avatar: username[0].toUpperCase(),
    cosmics: 1000,
    createdAt: new Date().toISOString(),
    lastSeen: new Date().toISOString()
  };

  users.push(user);
  addTx(username, 1000, 'bonus', 'Стартовый бонус CosmoMes');
  res.json({ success: true, user: publicUser(user) });
});

app.post('/presence', (req, res) => {
  const user = findUser(req.body.username);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  user.lastSeen = new Date().toISOString();
  res.json({ success: true, online: true });
});

app.get('/users', (_, res) => res.json(users.map(publicUser)));

app.get('/profile', (req, res) => {
  const user = findUser(req.query.username);
  user ? res.json(publicUser(user)) : res.status(404).json({ error: 'Пользователь не найден' });
});

app.post('/profile', (req, res) => {
  const user = findUser(req.body.username);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

  if (req.body.name !== undefined) user.name = String(req.body.name).trim().slice(0, 40) || user.name;
  if (req.body.avatar !== undefined) user.avatar = String(req.body.avatar).trim().slice(0, 2) || user.avatar;
  user.lastSeen = new Date().toISOString();

  res.json({ success: true, user: publicUser(user) });
});

app.post('/messages', (req, res) => {
  const from = clean(req.body.from);
  const to = clean(req.body.to);
  const text = String(req.body.text || '').trim();
  const sender = findUser(from);
  const receiver = findUser(to);

  if (!from || !to || !text) return res.status(400).json({ error: 'Недостаточно данных' });
  if (!sender || !receiver) return res.status(404).json({ error: 'Пользователь не найден' });

  sender.lastSeen = new Date().toISOString();
  const message = {
    id: messages.length + 1,
    from,
    to,
    text: text.slice(0, 4000),
    createdAt: new Date().toISOString()
  };
  messages.push(message);
  res.json({ success: true, message });
});

app.get('/messages', (req, res) => {
  const a = clean(req.query.user1);
  const b = clean(req.query.user2);
  res.json(messages.filter(m => (m.from === a && m.to === b) || (m.from === b && m.to === a)));
});

app.get('/cosmics', (req, res) => {
  const user = findUser(req.query.username);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json({
    balance: user.cosmics,
    history: transactions.filter(t => t.username === user.username).slice(-50).reverse()
  });
});

app.post('/cosmics/give', (req, res) => {
  const from = findUser(req.body.from);
  const to = findUser(req.body.to);
  const amount = Number(req.body.amount);

  if (!from || !to) return res.status(404).json({ error: 'Пользователь не найден' });
  if (from === to) return res.status(400).json({ error: 'Нельзя переводить самому себе' });
  if (!Number.isInteger(amount) || amount <= 0) return res.status(400).json({ error: 'Некорректная сумма' });
  if (from.cosmics < amount) return res.status(400).json({ error: 'Недостаточно Космиков' });

  from.cosmics -= amount;
  to.cosmics += amount;
  addTx(from.username, -amount, 'transfer', `Перевод @${to.username}`);
  addTx(to.username, amount, 'transfer', `Получено от @${from.username}`);
  res.json({ success: true, from: publicUser(from), to: publicUser(to) });
});

app.get('/gifts/catalog', (_, res) => res.json(catalog));
app.get('/gifts', (req, res) => res.json(gifts.filter(g => g.to === clean(req.query.username)).reverse()));

app.post('/gifts/send', (req, res) => {
  const from = findUser(req.body.from);
  const to = findUser(req.body.to);
  const gift = catalog.find(g => g.id === req.body.giftId);

  if (!from || !to || !gift) return res.status(404).json({ error: 'Данные не найдены' });
  if (from.cosmics < gift.price) return res.status(400).json({ error: 'Недостаточно Космиков' });

  from.cosmics -= gift.price;
  const item = {
    id: gifts.length + 1,
    giftId: gift.id,
    giftName: gift.name,
    emoji: gift.emoji,
    price: gift.price,
    from: from.username,
    to: to.username,
    createdAt: new Date().toISOString()
  };
  gifts.push(item);
  addTx(from.username, -gift.price, 'gift', `Подарок ${gift.emoji} @${to.username}`);
  res.json({ success: true, gift: item, balance: from.cosmics });
});

app.post('/bot', (req, res) => {
  const user = findUser(req.body.username);
  const text = String(req.body.text || '').trim();
  const parts = text.split(/\s+/);
  const cmd = (parts[0] || '').toLowerCase();

  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  user.lastSeen = new Date().toISOString();

  if (cmd === '/start' || cmd === '/help') {
    return res.json({ reply: '🤖 CosmoBot\n\n/balance — баланс\n/give @username 100 — перевод\n/gifts — мои подарки\n/help — помощь' });
  }
  if (cmd === '/balance') return res.json({ reply: `💫 Ваш баланс: ${user.cosmics} ✦` });
  if (cmd === '/gifts') {
    const own = gifts.filter(g => g.to === user.username);
    return res.json({ reply: own.length ? '🎁 Ваши подарки:\n\n' + own.slice(-10).reverse().map(g => `${g.emoji} ${g.giftName} от @${g.from}`).join('\n') : '🎁 У вас пока нет подарков.' });
  }
  if (cmd === '/give') {
    const target = findUser(parts[1]);
    const amount = Number(parts[2]);
    if (!target || !Number.isInteger(amount) || amount <= 0) return res.json({ reply: '❌ Использование: /give @username 100' });
    if (target.username === user.username) return res.json({ reply: '❌ Нельзя переводить самому себе.' });
    if (user.cosmics < amount) return res.json({ reply: '❌ Недостаточно Космиков.' });
    user.cosmics -= amount;
    target.cosmics += amount;
    addTx(user.username, -amount, 'transfer', `Перевод @${target.username}`);
    addTx(target.username, amount, 'transfer', `Получено от @${user.username}`);
    return res.json({ reply: `✅ Переведено ${amount} ✦ пользователю @${target.username}.` });
  }
  return res.json({ reply: '🤖 Не знаю такую команду. Напиши /help.' });
});

app.post('/admin/login', (req, res) => {
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: 'ADMIN_PASSWORD не настроен на сервере' });
  const user = findUser(req.body.username);
  if (!user || String(req.body.password || '') !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Неверный пароль' });
  }
  user.lastSeen = new Date().toISOString();
  res.json({ success: true });
});

app.get('/admin/users', (req, res) => {
  if (!ADMIN_PASSWORD || String(req.query.password || '') !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Нет доступа' });
  res.json(users.map(u => ({ ...publicUser(u), online: Boolean(isOnline(u)) })));
});

app.post('/admin/give', (req, res) => {
  if (!ADMIN_PASSWORD || String(req.body.password || '') !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Нет доступа' });

  const admin = findUser(req.body.username);
  const target = findUser(req.body.to);
  const amount = Number(req.body.amount);

  if (!admin) return res.status(404).json({ error: 'Администратор не найден' });
  if (!target) return res.status(404).json({ error: 'Получатель не найден' });
  if (!Number.isInteger(amount) || amount <= 0) return res.status(400).json({ error: 'Некорректная сумма' });

  target.cosmics += amount;
  addTx(target.username, amount, 'admin', `Выдано администратором @${admin.username}`);
  res.json({ success: true, message: `Выдано ${amount} ✦ пользователю @${target.username}`, user: publicUser(target) });
});

app.post('/ai/chat', async (req, res) => {
  const user = findUser(req.body.username);
  const text = String(req.body.text || '').trim();

  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (!text) return res.status(400).json({ error: 'Пустой запрос' });
  if (!OPENAI_API_KEY) return res.status(503).json({ error: 'OPENAI_API_KEY не настроен на сервере' });
  if (text.length > 4000) return res.status(400).json({ error: 'Сообщение слишком длинное' });

  const now = Date.now();
  const previous = aiRate.get(user.username) || 0;
  if (now - previous < 2500) return res.status(429).json({ error: 'Слишком быстро. Подожди пару секунд.' });
  aiRate.set(user.username, now);
  user.lastSeen = new Date().toISOString();

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        instructions: 'Ты CosmoAI — дружелюбный встроенный ИИ-мессенджера CosmoMes. Отвечай на русском, если пользователь пишет по-русски. Будь полезным и кратким, но можешь подробно объяснять сложные темы.',
        input: text,
        max_output_tokens: 800
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('OpenAI error:', data);
      return res.status(502).json({ error: 'Ошибка AI-сервиса' });
    }

    const reply = data.output_text || (data.output || [])
      .filter(item => item.type === 'message')
      .flatMap(item => item.content || [])
      .filter(part => part.type === 'output_text')
      .map(part => part.text)
      .join('\n')
      .trim();

    res.json({ reply: reply || '🤖 Я не смог сформировать ответ.' });
  } catch (error) {
    console.error('AI request failed:', error);
    res.status(502).json({ error: 'Не удалось связаться с AI' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 CosmoMes server 3.2 on port ${PORT}`);
  console.log(`AI: ${OPENAI_API_KEY ? OPENAI_MODEL : 'disabled (set OPENAI_API_KEY)'}`);
});

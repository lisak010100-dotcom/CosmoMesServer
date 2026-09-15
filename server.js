const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const users = [];
const messages = [];
const transactions = [];
const gifts = [];

const catalog = [
  { id: 'rose', name: 'Роза', emoji: '🌹', price: 100 },
  { id: 'diamond', name: 'Алмаз', emoji: '💎', price: 500 },
  { id: 'rocket', name: 'Ракета', emoji: '🚀', price: 1000 },
  { id: 'galaxy', name: 'Галактика', emoji: '🌌', price: 2500 },
  { id: 'crown', name: 'Корона', emoji: '👑', price: 5000 }
];

const clean = (value) => String(value || '').replace(/^@/, '').trim().toLowerCase();
const findUser = (username) => users.find((u) => u.username === clean(username));
const publicUser = (u) => u && ({
  id: u.id,
  username: u.username,
  name: u.name,
  avatar: u.avatar,
  cosmics: u.cosmics,
  createdAt: u.createdAt
});

function addTransaction(username, amount, type, description) {
  transactions.push({
    id: transactions.length + 1,
    username,
    amount,
    type,
    description,
    createdAt: new Date().toISOString()
  });
}

app.get('/', (_req, res) => {
  res.json({ app: 'CosmoMes', version: '3.0', status: 'online' });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'CosmoMes', time: new Date().toISOString() });
});

app.post('/register', (req, res) => {
  const username = clean(req.body.username);
  const name = String(req.body.name || '').trim();

  if (!username || !name) {
    return res.status(400).json({ error: 'Username и имя обязательны' });
  }

  if (!/^[a-z0-9_]{3,24}$/i.test(username)) {
    return res.status(400).json({ error: 'Username: 3-24 символа, только буквы, цифры и _' });
  }

  if (findUser(username)) {
    return res.status(409).json({ error: 'Такой username уже существует' });
  }

  const user = {
    id: users.length + 1,
    username,
    name: name.slice(0, 40),
    avatar: username[0].toUpperCase(),
    cosmics: 1000,
    createdAt: new Date().toISOString()
  };

  users.push(user);
  addTransaction(username, 1000, 'bonus', 'Стартовый бонус CosmoMes');

  res.json({ success: true, user: publicUser(user) });
});

app.get('/users', (_req, res) => {
  res.json(users.map(publicUser));
});

app.get('/profile', (req, res) => {
  const user = findUser(req.query.username);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json(publicUser(user));
});

app.post('/profile', (req, res) => {
  const user = findUser(req.body.username);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

  if (req.body.name !== undefined) {
    user.name = String(req.body.name).trim().slice(0, 40) || user.name;
  }
  if (req.body.avatar !== undefined) {
    user.avatar = String(req.body.avatar).trim().slice(0, 2) || user.avatar;
  }

  res.json({ success: true, user: publicUser(user) });
});

app.post('/messages', (req, res) => {
  const from = clean(req.body.from);
  const to = clean(req.body.to);
  const text = String(req.body.text || '').trim();

  if (!from || !to || !text) {
    return res.status(400).json({ error: 'Недостаточно данных' });
  }
  if (!findUser(from) || !findUser(to)) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

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
  res.json(messages.filter((m) =>
    (m.from === a && m.to === b) || (m.from === b && m.to === a)
  ));
});

app.get('/cosmics', (req, res) => {
  const user = findUser(req.query.username);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

  res.json({
    balance: user.cosmics,
    history: transactions.filter((x) => x.username === user.username).slice(-30).reverse()
  });
});

app.post('/cosmics/give', (req, res) => {
  const from = findUser(req.body.from);
  const to = findUser(req.body.to);
  const amount = Number(req.body.amount);

  if (!from || !to) return res.status(404).json({ error: 'Пользователь не найден' });
  if (!Number.isInteger(amount) || amount <= 0) return res.status(400).json({ error: 'Некорректная сумма' });
  if (from.cosmics < amount) return res.status(400).json({ error: 'Недостаточно Космиков' });

  from.cosmics -= amount;
  to.cosmics += amount;
  addTransaction(from.username, -amount, 'transfer', `Перевод @${to.username}`);
  addTransaction(to.username, amount, 'transfer', `Получено от @${from.username}`);

  res.json({ success: true, from: publicUser(from), to: publicUser(to) });
});

app.get('/gifts/catalog', (_req, res) => res.json(catalog));

app.get('/gifts', (req, res) => {
  res.json(gifts.filter((g) => g.to === clean(req.query.username)).reverse());
});

app.post('/gifts/send', (req, res) => {
  const from = findUser(req.body.from);
  const to = findUser(req.body.to);
  const gift = catalog.find((x) => x.id === req.body.giftId);

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
  addTransaction(from.username, -gift.price, 'gift', `Подарок ${gift.emoji} @${to.username}`);

  res.json({ success: true, gift: item, balance: from.cosmics });
});

app.post('/bot', (req, res) => {
  const user = findUser(req.body.username);
  const text = String(req.body.text || '').trim();
  const parts = text.split(/\s+/);
  const command = (parts[0] || '').toLowerCase();

  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

  if (command === '/start' || command === '/help') {
    return res.json({
      reply: '🤖 CosmoBot\n\n/balance — баланс\n/give @username 100 — перевод\n/gifts — мои подарки\n/help — помощь'
    });
  }

  if (command === '/balance') {
    return res.json({ reply: `💫 Ваш баланс: ${user.cosmics} ✦` });
  }

  if (command === '/gifts') {
    const userGifts = gifts.filter((g) => g.to === user.username);
    return res.json({
      reply: userGifts.length
        ? '🎁 Ваши подарки:\n\n' + userGifts.slice(-10).reverse().map((g) => `${g.emoji} ${g.giftName} от @${g.from}`).join('\n')
        : '🎁 У вас пока нет подарков.'
    });
  }

  if (command === '/give') {
    const to = findUser(parts[1]);
    const amount = Number(parts[2]);

    if (!to || !Number.isInteger(amount) || amount <= 0) {
      return res.json({ reply: '❌ Использование: /give @username 100' });
    }
    if (to.username === user.username) {
      return res.json({ reply: '❌ Нельзя переводить самому себе.' });
    }
    if (user.cosmics < amount) {
      return res.json({ reply: '❌ Недостаточно Космиков.' });
    }

    user.cosmics -= amount;
    to.cosmics += amount;
    addTransaction(user.username, -amount, 'transfer', `Перевод @${to.username}`);
    addTransaction(to.username, amount, 'transfer', `Получено от @${user.username}`);

    return res.json({ reply: `✅ Переведено ${amount} ✦ пользователю @${to.username}.` });
  }

  res.json({ reply: '🤖 Не знаю такую команду. Напиши /help.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 CosmoMes server started on port ${PORT}`);
});

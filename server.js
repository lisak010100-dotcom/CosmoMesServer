const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const users = [], messages = [], transactions = [], gifts = [];
const catalog = [
  { id:'rose', name:'Роза', emoji:'🌹', price:100 },
  { id:'diamond', name:'Алмаз', emoji:'💎', price:500 },
  { id:'rocket', name:'Ракета', emoji:'🚀', price:1000 },
  { id:'galaxy', name:'Галактика', emoji:'🌌', price:2500 },
  { id:'crown', name:'Корона', emoji:'👑', price:5000 }
];
const clean = v => String(v || '').replace(/^@/,'').trim().toLowerCase();
const findUser = u => users.find(x => x.username === clean(u));
const publicUser = u => u && ({id:u.id,username:u.username,name:u.name,avatar:u.avatar,cosmics:u.cosmics,createdAt:u.createdAt,lastSeen:u.lastSeen||null});
const addTx = (username, amount, type, description) => transactions.push({id:transactions.length+1,username,amount,type,description,createdAt:new Date().toISOString()});
const online = u => !!(u && u.lastSeen && Date.now()-new Date(u.lastSeen).getTime()<90000);

app.get('/',(_q,r)=>r.json({app:'CosmoMes',version:'3.1',status:'online'}));
app.get('/health',(_q,r)=>r.json({ok:true,service:'CosmoMes',time:new Date().toISOString()}));

app.post('/register',(q,r)=>{
 const username=clean(q.body.username),name=String(q.body.name||'').trim();
 if(!username||!name)return r.status(400).json({error:'Username и имя обязательны'});
 if(!/^[a-z0-9_]{3,24}$/i.test(username))return r.status(400).json({error:'Username: 3-24 символа, только буквы, цифры и _'});
 if(findUser(username))return r.status(409).json({error:'Такой username уже существует'});
 const u={id:users.length+1,username,name:name.slice(0,40),avatar:username[0].toUpperCase(),cosmics:1000,createdAt:new Date().toISOString(),lastSeen:new Date().toISOString()};
 users.push(u);addTx(username,1000,'bonus','Стартовый бонус CosmoMes');r.json({success:true,user:publicUser(u)});
});
app.post('/presence',(q,r)=>{const u=findUser(q.body.username);if(!u)return r.status(404).json({error:'Пользователь не найден'});u.lastSeen=new Date().toISOString();r.json({success:true,online:true,lastSeen:u.lastSeen});});
app.get('/users',(_q,r)=>r.json(users.map(u=>({...publicUser(u),online:online(u)}))));
app.get('/profile',(q,r)=>{const u=findUser(q.query.username);if(!u)return r.status(404).json({error:'Пользователь не найден'});r.json({...publicUser(u),online:online(u)});});
app.post('/profile',(q,r)=>{const u=findUser(q.body.username);if(!u)return r.status(404).json({error:'Пользователь не найден'});if(q.body.name!==undefined)u.name=String(q.body.name).trim().slice(0,40)||u.name;if(q.body.avatar!==undefined)u.avatar=String(q.body.avatar).trim().slice(0,2)||u.avatar;r.json({success:true,user:publicUser(u)});});

app.post('/messages',(q,r)=>{
 const from=clean(q.body.from),to=clean(q.body.to),text=String(q.body.text||'').trim();
 if(!from||!to||!text)return r.status(400).json({error:'Недостаточно данных'});
 if(!findUser(from)||!findUser(to))return r.status(404).json({error:'Пользователь не найден'});
 const m={id:messages.length+1,from,to,text:text.slice(0,4000),createdAt:new Date().toISOString()};messages.push(m);r.json({success:true,message:m});
});
app.get('/messages',(q,r)=>{const a=clean(q.query.user1),b=clean(q.query.user2);r.json(messages.filter(m=>(m.from===a&&m.to===b)||(m.from===b&&m.to===a)));});

app.get('/cosmics',(q,r)=>{const u=findUser(q.query.username);if(!u)return r.status(404).json({error:'Пользователь не найден'});r.json({balance:u.cosmics,history:transactions.filter(x=>x.username===u.username).slice(-30).reverse()});});
app.post('/cosmics/give',(q,r)=>{const a=findUser(q.body.from),b=findUser(q.body.to),n=Number(q.body.amount);if(!a||!b)return r.status(404).json({error:'Пользователь не найден'});if(a===b)return r.status(400).json({error:'Нельзя переводить самому себе'});if(!Number.isInteger(n)||n<=0)return r.status(400).json({error:'Некорректная сумма'});if(a.cosmics<n)return r.status(400).json({error:'Недостаточно Космиков'});a.cosmics-=n;b.cosmics+=n;addTx(a.username,-n,'transfer',`Перевод @${b.username}`);addTx(b.username,n,'transfer',`Получено от @${a.username}`);r.json({success:true,from:publicUser(a),to:publicUser(b)});});

app.get('/gifts/catalog',(_q,r)=>r.json(catalog));
app.get('/gifts',(q,r)=>r.json(gifts.filter(g=>g.to===clean(q.query.username)).reverse()));
app.post('/gifts/send',(q,r)=>{const a=findUser(q.body.from),b=findUser(q.body.to),g=catalog.find(x=>x.id===q.body.giftId);if(!a||!b||!g)return r.status(404).json({error:'Данные не найдены'});if(a.cosmics<g.price)return r.status(400).json({error:'Недостаточно Космиков'});a.cosmics-=g.price;const item={id:gifts.length+1,giftId:g.id,giftName:g.name,emoji:g.emoji,price:g.price,from:a.username,to:b.username,createdAt:new Date().toISOString()};gifts.push(item);addTx(a.username,-g.price,'gift',`Подарок ${g.emoji} @${b.username}`);r.json({success:true,gift:item,balance:a.cosmics});});

app.post('/bot',(q,r)=>{const u=findUser(q.body.username),text=String(q.body.text||'').trim(),p=text.split(/\s+/),cmd=(p[0]||'').toLowerCase();if(!u)return r.status(404).json({error:'Пользователь не найден'});if(cmd==='/start'||cmd==='/help')return r.json({reply:'🤖 CosmoBot\n\n/balance — баланс\n/give @username 100 — перевод\n/gifts — мои подарки\n/help — помощь'});if(cmd==='/balance')return r.json({reply:`💫 Ваш баланс: ${u.cosmics} ✦`});if(cmd==='/gifts'){const gs=gifts.filter(g=>g.to===u.username);return r.json({reply:gs.length?'🎁 Ваши подарки:\n\n'+gs.slice(-10).reverse().map(g=>`${g.emoji} ${g.giftName} от @${g.from}`).join('\n'):'🎁 У вас пока нет подарков.'});}if(cmd==='/give'){const b=findUser(p[1]),n=Number(p[2]);if(!b||!Number.isInteger(n)||n<=0)return r.json({reply:'❌ Использование: /give @username 100'});if(b===u)return r.json({reply:'❌ Нельзя переводить самому себе.'});if(u.cosmics<n)return r.json({reply:'❌ Недостаточно Космиков.'});u.cosmics-=n;b.cosmics+=n;addTx(u.username,-n,'transfer',`Перевод @${b.username}`);addTx(b.username,n,'transfer',`Получено от @${u.username}`);return r.json({reply:`✅ Переведено ${n} ✦ пользователю @${b.username}.`});}r.json({reply:'🤖 Не знаю такую команду. Напиши /help.'});});

app.post('/admin/login',(q,r)=>{if(!ADMIN_PASSWORD)return r.status(503).json({error:'ADMIN_PASSWORD не настроен на сервере'});if(String(q.body.password||'')!==ADMIN_PASSWORD)return r.status(401).json({error:'Неверный пароль'});r.json({success:true});});
app.get('/admin/users',(q,r)=>{if(!ADMIN_PASSWORD||String(q.query.password||'')!==ADMIN_PASSWORD)return r.status(401).json({error:'Нет доступа'});r.json(users.map(u=>({...publicUser(u),online:online(u)})));});
app.post('/admin/give',(q,r)=>{if(!ADMIN_PASSWORD||String(q.body.password||'')!==ADMIN_PASSWORD)return r.status(401).json({error:'Нет доступа'});const u=findUser(q.body.to),n=Number(q.body.amount);if(!u||!Number.isInteger(n)||n<=0)return r.status(400).json({error:'Некорректные данные'});u.cosmics+=n;addTx(u.username,n,'admin','Начисление от администратора');r.json({success:true,user:publicUser(u)});});

app.listen(PORT,'0.0.0.0',()=>console.log(`🚀 CosmoMes server 3.1 on port ${PORT}`));

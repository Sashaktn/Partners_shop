# Partner Shop MVP

Односторінковий сайт для партнерів на базі Prom-фіда.
- Персональні ціни за профілем (MVP: токен у URL `?p=partner_A`).
- Групи, пошук, модаль товару, кошик.
- Надсилання замовлення у Telegram.

## Швидкий старт

```bash
cd server
cp .env.example .env   # заповни змінні
npm i
npm start
```

Після запуску: [http://localhost:5173](http://localhost:5173)

### Логін за профілем (MVP)

Перейди на URL з параметром `p`:

```
http://localhost:5173/?p=partner_A
```

Щоб вийти (гостьовий режим):

```
http://localhost:5173/?logout=1
```

### Правила цін

Редагуй `server/data/rules.json` — там приклади профілів і правил.

```
profiles.partner_A: глобальна знижка 5%, для групи hotends — 7%, додаткова -10% від 3000 грн у кошику.
```

### Telegram

Заповни у `.env`:

* `TELEGRAM_BOT_TOKEN`
* `TELEGRAM_CHAT_ID` (ID вашого чату/каналу/групи для отримання заявок)

Після оформлення замовлення дані відправляються у Telegram через Bot API.


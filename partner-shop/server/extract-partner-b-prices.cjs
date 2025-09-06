const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');

const filePath = path.join(__dirname, 'data', 'ali_price.xlsx');
const sheetName = 'partner-prices';

const wb = xlsx.readFile(filePath);
const ws = wb.Sheets[sheetName];
if (!ws) {
  console.error('Аркуш partner-prices не знайдено!');
  process.exit(1);
}

const data = xlsx.utils.sheet_to_json(ws, { header: 1 });
const result = [];
for (let i = 3; i < data.length; i++) { // з 4-го рядка (індекс 3)
  const row = data[i];
  const article = row[1]; // 2-га колонка (B)
  let priceRaw = row[6];   // 7-ма колонка (G)
  let price = priceRaw;
  if (typeof priceRaw === 'string') price = priceRaw.replace(',', '.');
  price = Number(price);
  if (article && !isNaN(price)) {
    result.push({ article, price });
    console.log('Артикул:', article, 'Ціна для partner_B:', price);
  }
}
console.log('Загалом знайдено:', result.length, 'позицій.');

// Зберігаємо у JSON
const outPath = path.join(__dirname, 'data', 'partner-b-prices.json');
fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');
console.log('Дані збережено у', outPath);

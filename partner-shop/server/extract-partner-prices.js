const fs = require('fs');
const csv = require('csv-parser');

const results = [];
const inputPath = __dirname + '/partner-prices.csv';
const outputPath = __dirname + '/partner-prices-simple.csv';

let rowIdx = 0;
const outRows = [];

fs.createReadStream(inputPath)
  .pipe(csv({ mapHeaders: ({ header, index }) => index }))
  .on('data', (data) => {
    rowIdx++;
    if (rowIdx < 3) return; // Пропускаємо перші два рядки
    const article = data[1]; // Друга колонка (B)
    const price = data[6];  // Сьома колонка (G)
    if (article && price) {
      outRows.push(`${article},${price}`);
    }
  })
  .on('end', () => {
    // Вивести у консоль
    outRows.forEach(row => console.log(row));
    // Або зберегти у новий файл
    fs.writeFileSync(outputPath, outRows.join('\n'), 'utf8');
    console.log('Готово! Дані збережено у', outputPath);
  });

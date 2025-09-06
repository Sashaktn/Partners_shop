const https = require('https');
const fs = require('fs');

const FILE_ID = '1ao1dhIoGdwjMrufsPyvnuHHKsIq7GmtD';
const DEST = __dirname + '/partner-prices.csv';

function downloadFromDrive(fileId, dest, cb) {
  const url = `https://drive.google.com/uc?export=download&id=${fileId}`;
  const file = fs.createWriteStream(dest);
  https.get(url, (res) => {
    console.log('HTTP статус:', res.statusCode);
    res.pipe(file);
    file.on('finish', () => file.close(cb));
  }).on('error', (err) => {
    fs.unlink(dest, () => {});
    if (cb) cb(err.message);
  });
}

console.log('Завантажую partner-prices.csv з Google Drive...');
downloadFromDrive(FILE_ID, DEST, (err) => {
  if (err) {
    console.error('Помилка при завантаженні:', err);
    return;
  }
  console.log('Файл partner-prices.csv успішно оновлено!');
});

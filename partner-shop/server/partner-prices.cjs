const fs = require('fs');
const https = require('https');
const path = require('path');

// Посилання на другий аркуш (з gid=...)
const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/12XFa9lnufrJ7uTwLHplgS0W79ZJHkrz3XzYtUI-fdHQ/export?format=csv&gid=1777069131';
const DEST_DATA = path.join(__dirname, 'data', 'partner-prices.csv');

function downloadSheetToData() {
  return new Promise((resolve, reject) => {
    https.get(SHEET_CSV_URL, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        https.get(res.headers.location, (res2) => {
          const file = fs.createWriteStream(DEST_DATA);
          res2.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve();
          });
        });
      } else if (res.statusCode === 200) {
        const file = fs.createWriteStream(DEST_DATA);
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      } else {
        reject(new Error('HTTP статус: ' + res.statusCode));
      }
    }).on('error', reject);
  });
}

// --- Заглушки для експорту, щоб не було помилки імпорту ---
function loadPartnerPrices() { return Promise.resolve(); }
function getPartnerPrice() { return null; }
function updatePartnerPricesFromSheet() { return Promise.resolve(); }
function downloadSheetToRoot() { return Promise.resolve(); }

module.exports = {
  downloadSheetToData,
  loadPartnerPrices,
  getPartnerPrice,
  updatePartnerPricesFromSheet,
  downloadSheetToRoot
};

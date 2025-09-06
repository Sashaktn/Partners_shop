const fs = require('fs');
const path = require('path');
const xml2js = require('xml2js');

const FEED_PATH = path.join(__dirname, 'data', 'feed.xml');
const PARTNER_A_PATH = path.join(__dirname, 'data', 'feed_partner_A.xml');
const PARTNER_B_PATH = path.join(__dirname, 'data', 'feed_partner_B.xml');
const PARTNER_B_PRICES_PATH = path.join(__dirname, 'data', 'partner-b-prices.json');

async function main() {
  const xml = fs.readFileSync(FEED_PATH, 'utf8');
  const feed = await xml2js.parseStringPromise(xml, { explicitArray: false });
  const offers = feed.yml_catalog.shop.offers.offer;
  // --- Partner A: всі ціни ×0.9 ---
  const offersA = offers.map(o => ({
    ...o,
    price: (Number(o.price) * 0.9).toFixed(2)
  }));
  const feedA = JSON.parse(JSON.stringify(feed));
  feedA.yml_catalog.shop.offers.offer = offersA;
  const xmlA = new xml2js.Builder({ headless: false, renderOpts: { pretty: true } }).buildObject(feedA);
  fs.writeFileSync(PARTNER_A_PATH, xmlA, 'utf8');
  // --- Partner B: ціни з partner-b-prices.json ---
  const partnerBPrices = JSON.parse(fs.readFileSync(PARTNER_B_PRICES_PATH, 'utf8'));
  const priceMap = new Map(partnerBPrices.map(x => [String(x.article), Number(x.price)]));
  const offersB = offers.map(o => {
    const code = o.vendorCode ? String(o.vendorCode).trim() : '';
    const newPrice = priceMap.has(code) ? priceMap.get(code) : Number(o.price);
    return { ...o, price: newPrice };
  });
  const feedB = JSON.parse(JSON.stringify(feed));
  feedB.yml_catalog.shop.offers.offer = offersB;
  const xmlB = new xml2js.Builder({ headless: false, renderOpts: { pretty: true } }).buildObject(feedB);
  fs.writeFileSync(PARTNER_B_PATH, xmlB, 'utf8');
  console.log('Готово! Згенеровано feed_partner_A.xml і feed_partner_B.xml');
}

main().catch(e => { console.error(e); process.exit(1); });

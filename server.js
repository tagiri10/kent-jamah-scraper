import express from 'express';
import cors from 'cors';
import puppeteer from 'puppeteer';
import chromium from '@sparticuz/chromium';

const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());

// Mosque list
const mosques = [
  {
    id: 'gillingham',
    name: 'Gillingham Mosque',
    url: 'https://kmwa.org.uk/',
    address: '114 Canterbury Street, Gillingham, Kent ME7 5UH'
  },
  {
    id: 'chatham-hill',
    name: 'Chatham Hill Mosque',
    url: 'https://www.chathamhillmosque.co.uk/',
    address: '7-9 High St, Chatham, Kent'
  },
  {
    id: 'al-abraar',
    name: 'Masjid Al Abraar',
    url: 'https://www.masjidulabraar.org/',
    address: '16 High St, Rochester, Kent'
  }
];

// Scraper function
async function scrapeMosque(mosque) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: chromium.args.concat(['--no-sandbox', '--disable-setuid-sandbox']),
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      ignoreHTTPSErrors: true
    });

    const page = await browser.newPage();
    await page.goto(mosque.url, { waitUntil: 'networkidle2', timeout: 30000 });

    let jamaah = {};
    let jummah = [];

    // --- Custom scraping per mosque ---
    if (mosque.id === 'gillingham') {
      jamaah = await page.evaluate(() => {
        const obj = {};
        const tableRows = document.querySelectorAll('table tr');
        tableRows.forEach(row => {
          const cells = row.querySelectorAll('td');
          if (cells.length === 2) {
            const prayer = cells[0].innerText.trim();
            const time = cells[1].innerText.trim();
            obj[prayer] = time;
          }
        });
        return obj;
      });
      jummah = await page.evaluate(() => {
        return ['12:15', '13:00']; // Hardcoded because Jummah times are fixed
      });
    } else if (mosque.id === 'chatham-hill') {
      jamaah = await page.evaluate(() => {
        const obj = {};
        document.querySelectorAll('.tablepress tbody tr').forEach(row => {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 2) {
            obj[cells[0].innerText.trim()] = cells[1].innerText.trim();
          }
        });
        return obj;
      });
      jummah = await page.evaluate(() => {
        const elements = document.querySelectorAll('.jummah-times p');
        return Array.from(elements).map(el => el.innerText.trim());
      });
    } else if (mosque.id === 'al-abraar') {
      jamaah = await page.evaluate(() => {
        const obj = {};
        document.querySelectorAll('.prayer-times tr').forEach(row => {
          const cells = row.querySelectorAll('td');
          if (cells.length === 2) {
            obj[cells[0].innerText.trim()] = cells[1].innerText.trim();
          }
        });
        return obj;
      });
      jummah = await page.evaluate(() => {
        const el = document.querySelector('.jummah p');
        return el ? [el.innerText.trim()] : [];
      });
    }

    return { id: mosque.id, name: mosque.name, url: mosque.url, address: mosque.address, jamaah, jummah };
  } catch (err) {
    console.error(`Error scraping ${mosque.name}:`, err);
    return { id: mosque.id, name: mosque.name, url: mosque.url, address: mosque.address, jamaah: {}, jummah: [] };
  } finally {
    if (browser) await browser.close();
  }
}

// API endpoint
app.get('/api/kent-mosques', async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  try {
    const results = [];
    for (const mosque of mosques) {
      const data = await scrapeMosque(mosque);
      results.push(data);
    }
    res.json({ date, data: results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch mosque times' });
  }
});

app.listen(PORT, () => {
  console.log(`Kent Jamah Scraper API running on port ${PORT}`);
});

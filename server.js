// server.js
import express from 'express';
import cors from 'cors';
import puppeteer from 'puppeteer';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Mosques with URLs and addresses
const MOSQUES = [
  {
    id: 'chatham-hill',
    name: 'Chatham Hill Mosque & Kent Islamic Centre',
    url: 'https://www.chathamhillmosque.co.uk/daily-prayer-timings/',
    address: '7-9 High St, Chatham, ME4 4EE'
  },
  {
    id: 'masjidul-abraar',
    name: 'Masjidul Abraar',
    url: 'https://www.masjidulabraar.org/',
    address: '41 Bradfield Rd, Gillingham, ME7 4BL'
  },
  {
    id: 'kmwa',
    name: 'Kent Muslim Welfare Association',
    url: 'https://kmwa.org.uk/prayer-time-table-2021/',
    address: '99-101 Sturry Rd, Canterbury, CT2 7DE'
  }
];

// Site-specific scraping logic
async function scrapeMosque(mosque) {
  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      executablePath: puppeteer.executablePath()
    });

    const page = await browser.newPage();
    await page.goto(mosque.url, { waitUntil: 'networkidle2' });

    let result = { jamaah: {}, jummah: [] };

    // Chatham Hill Mosque
    if (mosque.id === 'chatham-hill') {
      result = await page.evaluate(() => {
        const jamaah = {};
        const jummah = [];
        document.querySelectorAll('table tr').forEach(tr => {
          const cells = tr.querySelectorAll('td');
          if (cells.length >= 3) {
            const prayer = cells[0].innerText.trim();
            const jamaahTime = cells[2].innerText.trim();
            if (prayer.toLowerCase().includes('jummah')) jummah.push(jamaahTime);
            else jamaah[prayer] = jamaahTime;
          }
        });
        return { jamaah, jummah };
      });
    }

    // Masjidul Abraar
    if (mosque.id === 'masjidul-abraar') {
      result = await page.evaluate(() => {
        const jamaah = {};
        const jummah = [];
        document.querySelectorAll('ul li').forEach(li => {
          const text = li.innerText;
          if (text.toLowerCase().includes('jumah') || text.toLowerCase().includes('jummah')) {
            const timeMatch = text.match(/\d{1,2}:\d{2}/g);
            if (timeMatch) timeMatch.forEach(t => jummah.push(t));
          } else {
            const parts = text.split(':');
            if (parts.length === 2) jamaah[parts[0].trim()] = parts[1].trim();
          }
        });
        return { jamaah, jummah };
      });
    }

    // KMWA
    if (mosque.id === 'kmwa') {
      result = await page.evaluate(() => {
        const jamaah = {};
        const jummah = [];
        document.querySelectorAll('table tr').forEach(tr => {
          const cells = tr.querySelectorAll('td');
          if (cells.length >= 2) {
            const prayer = cells[0].innerText.trim();
            const time = cells[1].innerText.trim();
            if (prayer.toLowerCase().includes('jummah')) {
              const times = time.split(',').map(t => t.trim());
              times.forEach(t => jummah.push(t));
            } else {
              jamaah[prayer] = time;
            }
          }
        });
        return { jamaah, jummah };
      });
    }

    await browser.close();
    return result;
  } catch (err) {
    console.error('Error scraping', mosque.name, err);
    return { jamaah: {}, jummah: [] };
  }
}

// API endpoint
app.get('/api/kent-mosques', async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  try {
    const results = [];
    for (const mosque of MOSQUES) {
      const data = await scrapeMosque(mosque);
      results.pus

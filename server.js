// server.js
import express from 'express';
import cors from 'cors';
import puppeteer from 'puppeteer';
import fs from 'fs-extra';
import fetch from 'node-fetch';
import pdf from 'pdf-parse';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Clear Puppeteer cache just in case
await fs.remove('/opt/render/.cache/puppeteer');

// Mosques data with addresses and URLs
const MOSQUES = [
  { id: 'kmwa', name: 'Kent Muslim Welfare Association', url: 'https://kmwa.org.uk/', address: '99-101 Sturry Rd, Canterbury, CT2 7DE' },
  { id: 'chatham-hill', name: 'Chatham Hill Mosque & Kent Islamic Centre', url: 'https://www.chathamhillmosque.co.uk/', address: '7-9 High St, Chatham, ME4 4EE' },
  { id: 'gravesend-central', name: 'Gravesend Central Mosque', url: 'https://www.gravesendcentralmosque.com/', address: '31-33 Coldharbour Rd, Gravesend, DA11 0DA' },
  { id: 'masjidul-abraar', name: 'Masjidul Abraar', url: 'https://www.masjidulabraar.org/', address: '41 Bradfield Rd, Gillingham, ME7 4BL' },
  { id: 'sittingbourne', name: 'Sittingbourne Islamic Cultural Centre', url: 'https://masjidbox.com/prayer-times/sittingbourne-islamic-cultural-centre', address: '9 St. Michaels Rd, Sittingbourne, ME10 4LP' },
  { id: 'maidstone', name: 'Maidstone Mosque', url: 'https://maidstonemosque.com/', address: '48-50 Fant Lane, Maidstone, ME16 8RA' },
  { id: 'canterbury', name: 'Canterbury Mosque', url: 'https://canterburymosque.co.uk/', address: '108 Sturry Rd, Canterbury, CT2 7DE' },
  { id: 'ashford', name: 'Ashford Mosque', url: 'https://ashfordmosque.org/', address: '50-52 Beaver Rd, Ashford, TN23 1PH' },
  { id: 'tonbridge', name: 'Tonbridge Masjid', url: 'https://tonbridgemasjid.org/', address: '37 High St, Tonbridge, TN9 1DX' },
  { id: 'masjid-abubakr', name: 'Masjid Abu Bakr', url: 'https://masjidabubakr.co.uk/', address: '3 St. Peter’s St, Dartford, DA1 1QA' },
  { id: 'secc-sidcup', name: 'SECC Sidcup', url: 'http://www.seccsidcup.org.uk/prayer-times/', address: '22 Burnt Oak Ln, Sidcup, DA15 9AG' },
  { id: 'dmic', name: 'DMIC', url: 'https://dmic.co.uk/Prayer-Times/Monthly-Prayer-Timetable-November-2025.pdf', address: 'DMIC, Dartford, Kent, UK' }
];

// Helper: scrape a mosque page for fixed jamaah/jummah times
async function scrapeMosque(mosque) {
  try {
    // DMIC PDF scraping
    if (mosque.id === 'dmic') {
      const pdfBuffer = await fetch(mosque.url).then(res => res.arrayBuffer());
      const data = await pdf(Buffer.from(pdfBuffer));
      // This is a simple example: grab all times as text; you may refine later
      return { jamaah: {}, jummah: [], rawText: data.text };
    }

    // Puppeteer for normal mosque pages
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      executablePath: puppeteer.executablePath()
    });

    const page = await browser.newPage();
    await page.goto(mosque.url, { waitUntil: 'networkidle2' });

    // Basic scraping: looks for text in tables or divs with prayer times
    const result = await page.evaluate(() => {
      const jamaah = {};
      const jummah = [];
      // Example selectors, adjust per site
      document.querySelectorAll('table, .prayer-times').forEach(tbl => {
        tbl.querySelectorAll('tr').forEach(row => {
          const cells = row.querySelectorAll('td, th');
          if (cells.length >= 2) {
            const prayer = cells[0].innerText.trim();
            const time = cells[1].innerText.trim();
            if (prayer.toLowerCase().includes('jummah')) {
              jummah.push(time);
            } else {
              jamaah[prayer] = time;
            }
          }
        });
      });
      return { jamaah, jummah };
    });

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
      results.push({
        id: mosque.id,
        name: mosque.name,
        url: mosque.url,
        address: mosque.address,
        jamaah: data.jamaah || {},
        jummah: data.jummah || []
      });
    }
    res.json({ date, data: results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch mosque times' });
  }
});

// Root message
app.get('/', (req, res) => {
  res.send('<h3>Kent Jamaah Scraper</h3><p>Use /api/kent-mosques?date=YYYY-MM-DD</p>');
});

// Start server
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

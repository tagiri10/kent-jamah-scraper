import express from "express";
import cors from "cors";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import cron from "node-cron";

const app = express();
app.use(cors());

let prayerData = {};

// Define mosque info
const mosques = [
  {
    name: "Gillingham Mosque (KMWA)",
    url: "https://kmwa.org.uk/",
    address: "114 Canterbury Street, Gillingham, ME7 5UH",
  },
  {
    name: "Chatham Hill Mosque",
    url: "https://chathamhillmosque.org.uk/",
    address: "22A Chatham Hill, Chatham ME5 7AA",
  },
  {
    name: "Masjid al Abraar",
    url: "https://www.masjidalabraar.org/",
    address: "77 Dale St, Chatham ME4 6QG",
  },
];

// Scraper function
async function scrapePrayerTimes() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  const results = {};

  for (const mosque of mosques) {
    try {
      await page.goto(mosque.url, { waitUntil: "domcontentloaded", timeout: 60000 });
      let data;

      // Simple text scraping pattern per mosque (these can be refined if structure changes)
      if (mosque.url.includes("kmwa.org.uk")) {
        data = await page.$$eval("table tr", rows =>
          rows.map(r => r.innerText).filter(t => /Fajr|Dhuhr|Asr|Maghrib|Isha/i.test(t))
        );
      } else if (mosque.url.includes("chathamhillmosque.org.uk")) {
        data = await page.$$eval("table tr", rows =>
          rows.map(r => r.innerText).filter(t => /Fajr|Dhuhr|Asr|Maghrib|Isha/i.test(t))
        );
      } else if (mosque.url.includes("masjidalabraar.org")) {
        data = await page.$$eval("table tr", rows =>
          rows.map(r => r.innerText).filter(t => /Fajr|Dhuhr|Asr|Maghrib|Isha/i.test(t))
        );
      }

      results[mosque.name] = {
        name: mosque.name,
        url: mosque.url,
        address: mosque.address,
        prayers: data || [],
      };
    } catch (e) {
      console.error(`Error scraping ${mosque.name}:`, e.message);
      results[mosque.name] = {
        name: mosque.name,
        url: mosque.url,
        address: mosque.address,
        prayers: ["Error fetching times"],
      };
    }
  }

  await browser.close();
  prayerData = results;
  console.log("✅ Prayer times updated");
}

// Run once on startup + every midnight
await scrapePrayerTimes();
cron.schedule("0 0 * * *", scrapePrayerTimes);

// API endpoint
app.get("/api/today", (req, res) => {
  res.json(prayerData);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

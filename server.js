// server.js
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import pdf from "pdf-parse";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import cron from "node-cron";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TODAY = () => new Date().toISOString().split("T")[0];

// --- MOSQUE CONFIG ---
const MOSQUES = [
  {
    id: "kmwa",
    name: "Gillingham Mosque (KMWA)",
    url: "https://kmwa.org.uk/",
    address: "114 Canterbury Street, Gillingham, ME7 5UH",
    source: "pdf",
    pdfFile: "Kent-Muslim-Welfare-Ass-Calendar-2025HR.pdf"
  },
  {
    id: "chatham-hill",
    name: "Chatham Hill Mosque",
    url: "https://www.chathamhillmosque.co.uk/prayer-times",
    address: "22A Chatham Hill, Chatham ME5 7AA",
    source: "chatham"
  },
  {
    id: "al-abraar",
    name: "Masjid al Abraar",
    url: "https://masjidbox.com/prayer-times/masjid-ul-abraar",
    address: "77 Dale St, Chatham ME4 6QG",
    source: "masjidbox"
  }
];

// In-memory cache
let cached = { date: null, data: null, updatedAt: null };

// ---------- KMWA PDF PARSER ----------
async function parseKMWAPdfForDate(pdfFilename, targetDateISO) {
  const pdfPath = path.resolve(pdfFilename);
  if (!fs.existsSync(pdfPath)) throw new Error("KMWA PDF not found: " + pdfPath);
  const raw = fs.readFileSync(pdfPath);
  const parsed = await pdf(raw);
  const text = parsed.text.replace(/\r/g, "\n");
  const dateObj = new Date(targetDateISO);
  const day = dateObj.getDate();
  const monthIndex = dateObj.getMonth();
  const monthNames = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December"
  ];
  const monthName = monthNames[monthIndex];

  // Narrow to the month block by locating the month name
  const monthRegex = new RegExp(monthName, "i");
  const monthMatchIndex = text.search(monthRegex);
  if (monthMatchIndex === -1) {
    // fallback: search for the day anywhere
    return parseRowByDayFromText(text, day);
  }
  const monthBlock = text.slice(monthMatchIndex, monthMatchIndex + 5000); // grab next chunk

  // try to find a row where the second token is the day number
  const result = parseRowByDayFromText(monthBlock, day);
  if (result) return result;

  // fallback search entire PDF
  return parseRowByDayFromText(text, day);
}

// helper that finds a line with day number and returns jammat times
function parseRowByDayFromText(textBlock, dayNumber) {
  const lines = textBlock.split("\n").map(s => s.trim()).filter(Boolean);
  // look for line where a token equals the dayNumber (1..31) and enough columns
  for (const line of lines) {
    // normalize spaces
    const parts = line.split(/\s+/);
    // typical row has many columns; we expect at least 8-11 tokens
    if (parts.length < 6) continue;
    // find token equal to dayNumber
    const foundIdx = parts.findIndex(p => {
      const n = parseInt(p, 10);
      return !isNaN(n) && n === dayNumber;
    });
    if (foundIdx !== -1) {
      // Based on KMWA layout observed, columns mapping:
      // [DOW, Date, FajrStart, FajrJammat, Sunrise, ZuhrStart, ZuhrJammat, AsrStart, AsrJammat, Maghrib, IshaStart, IshaJammat]
      // Ensure we have enough tokens; if not, skip
      if (parts.length >= foundIdx + 12) {
        const Fajr = parts[foundIdx + 3];
        const Zuhr = parts[foundIdx + 6];
        const Asr = parts[foundIdx + 8];
        const Maghrib = parts[foundIdx + 9]; // maghrib listed (start)
        const Isha = parts[foundIdx + 11];
        return {
          Fajr, Zuhr, Asr, Maghrib, Isha
        };
      } else {
        // Try a more tolerant extraction: collect all time-like tokens after date
        const timeCandidates = parts.slice(foundIdx + 1).filter(t => /^\d{1,2}[:.]\d{2}$/.test(t));
        // Expect at least 5 times: fajrStart,fajrJ, sunrise, zuhrstart, zuhrJ, ...
        if (timeCandidates.length >= 5) {
          // Assign by position heuristics
          const Fajr = timeCandidates[1] || timeCandidates[0];
          const Zuhr = timeCandidates[3] || "";
          const Asr = timeCandidates[5] || "";
          const Maghrib = timeCandidates[6] || "";
          const Isha = timeCandidates[timeCandidates.length - 1] || "";
          return { Fajr, Zuhr, Asr, Maghrib, Isha };
        }
      }
    }
  }
  return null;
}

// ---------- CHATHAM HILL SCRAPER ----------
async function scrapeChatham(page) {
  await page.goto("https://www.chathamhillmosque.co.uk/prayer-times", { waitUntil: "domcontentloaded", timeout: 30000 });
  // the active day block contains a table/rows where td[0]=prayer, td[2]=iqamah/jamaah
  const jamaah = await page.evaluate(()=> {
    const out = {};
    const container = document.querySelector("div.section-prayer-timetable-day.active-day");
    if (!container) return out;
    const rows = container.querySelectorAll("tr");
    rows.forEach(r => {
      const tds = r.querySelectorAll("td");
      if (tds.length >= 3) {
        const prayer = tds[0].innerText.trim();
        const iqamah = tds[2].innerText.trim();
        if (prayer) out[prayer] = iqamah;
      }
    });
    return out;
  });
  // collect jummah times if present (look for 'Jumu' or 'Jummah' text)
  const jummah = await page.evaluate(() => {
    const out = [];
    const container = document.querySelector("div.section-prayer-timetable-day.active-day");
    if (!container) return out;
    container.querySelectorAll("tr").forEach(r => {
      const txt = r.innerText || "";
      if (/jummah|jumu|jumuah|jumu'ah/i.test(txt)) {
        const times = txt.match(/\d{1,2}:\d{2}/g);
        if (times) times.forEach(t => out.push(t));
      }
    });
    return out;
  });
  return { jamaah, jummah };
}

// ---------- MASJIDBOX (Masjid al Abraar) SCRAPER ----------
async function scrapeMasjidbox(page) {
  await page.goto("https://masjidbox.com/prayer-times/masjid-ul-abraar", { waitUntil: "domcontentloaded", timeout: 30000 });
  // strategy: find the visible timetable for today (active-day or table), then for each row take prayer name and the iqamah time
  const jamaah = await page.evaluate(() => {
    const out = {};
    // Many masjidbox pages use table rows; pick all rows in page and parse
    const rows = Array.from(document.querySelectorAll("table tr, .prayer-time-row"));
    function extractTimeFromCells(cells) {
      // prefer cells that include 'Iqamah' label or last time-like token in row
      const text = cells.map(c => c.innerText.trim()).join(" ");
      const times = text.match(/\d{1,2}:\d{2}/g);
      if (!times) return null;
      // If the row shows begins + iqamah, iqamah often appears later -> choose last time
      return times[times.length - 1];
    }
    rows.forEach(r => {
      const cells = Array.from(r.querySelectorAll("th, td, div, span"));
      if (cells.length === 0) return;
      const prayer = cells[0].innerText.trim();
      if (!prayer) return;
      const iqamah = extractTimeFromCells(cells.map(c=>c));
      if (iqamah) out[prayer] = iqamah;
    });
    return out;
  });

  // jummah: try to find 'Jumu' row
  const jummah = await page.evaluate(()=>{
    const out = [];
    const trs = Array.from(document.querySelectorAll("table tr"));
    trs.forEach(tr => {
      const txt = tr.innerText || "";
      if (/jummah|jumu/i.test(txt)) {
        const times = txt.match(/\d{1,2}:\d{2}/g);
        if (times) times.forEach(t => out.push(t));
      }
    });
    return out;
  });

  return { jamaah, jummah };
}

// ---------- MAIN SCRAPER (uses puppeteer-core + @sparticuz/chromium) ----------
async function scrapeAllForToday() {
  const dateISO = TODAY();
  const browser = await puppeteer.launch({
    args: chromium.args.concat(["--no-sandbox","--disable-setuid-sandbox"]),
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless
  });

  const page = await browser.newPage();
  const results = [];

  for (const m of MOSQUES) {
    try {
      if (m.source === "pdf") {
        const times = await parseKMWAPdfForDate(m.pdfFile, dateISO);
        results.push({
          id: m.id,
          name: m.name,
          url: m.url,
          address: m.address,
          jamaah: times || {},
          jummah: [] // PDF includes jamat per prayer; jummah not always in same file
        });
      } else if (m.source === "chatham") {
        const { jamaah, jummah } = await scrapeChatham(page);
        results.push({
          id: m.id,
          name: m.name,
          url: m.url,
          address: m.address,
          jamaah: jamaah || {},
          jummah: jummah || []
        });
      } else if (m.source === "masjidbox") {
        const { jamaah, jummah } = await scrapeMasjidbox(page);
        results.push({
          id: m.id,
          name: m.name,
          url: m.url,
          address: m.address,
          jamaah: jamaah || {},
          jummah: jummah || []
        });
      } else {
        results.push({
          id: m.id,
          name: m.name,
          url: m.url,
          address: m.address,
          jamaah: {},
          jummah: []
        });
      }
    } catch (err) {
      console.error("Scrape error for", m.name, err);
      results.push({
        id: m.id,
        name: m.name,
        url: m.url,
        address: m.address,
        jamaah: {},
        jummah: []
      });
    }
  }

  await browser.close();
  return { date: dateISO, data: results, updatedAt: new Date().toISOString() };
}

// ---------- DAILY REFRESH ----------
async function refreshCache() {
  try {
    console.log("Refreshing cache...");
    const fresh = await scrapeAllForToday();
    cached = { date: fresh.date, data: fresh.data, updatedAt: fresh.updatedAt };
    console.log("Cache refreshed:", cached.date);
  } catch (e) {
    console.error("Failed refresh:", e);
  }
}

// run on startup
await refreshCache();
// schedule at midnight server time
cron.schedule("0 0 * * *", refreshCache);

// ---------- API ----------
app.get("/api/today", (req, res) => {
  // if cache missing or stale, perform a fresh scrape (safety)
  const today = TODAY();
  if (!cached.date || cached.date !== today) {
    // perform sync scrape (not awaited) and respond with whatever exists
    refreshCache().catch(()=>{});
  }
  res.json({ date: cached.date || today, data: cached.data || [], updatedAt: cached.updatedAt || new Date().toISOString() });
});

app.get("/api/status", (req, res) => {
  res.json({ status: "ok", date: cached.date || TODAY(), updatedAt: cached.updatedAt || null });
});

app.listen(PORT, () => console.log(`Server listening on ${PORT}`));

import express from "express";
import cors from "cors";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import cron from "node-cron";

const app = express();
app.use(cors());
app.use(express.json());

// Scraper for Gillingham Mosque (as a working example)
async function scrapePrayerTimes() {
  console.log("Launching browser...");

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(), // ✅ key line
    headless: chromium.headless,
  });

  const page = await browser.newPage();
  await page.goto("https://kmwa.org.uk/", { waitUntil: "domcontentloaded" });

  // Example scraping logic (adjust as needed)
  const data = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("table tr"));
    return rows.map((r) => r.innerText.trim());
  });

  await browser.close();
  return data;
}

// Cache data, refresh daily
let cachedTimes = null;
cron.schedule("0 0 * * *", async () => {
  console.log("Refreshing cached prayer times...");
  cachedTimes = await scrapePrayerTimes();
});

app.get("/api/status", (req, res) => {
  res.json({ status: "Server running", time: new Date().toISOString() });
});

app.get("/api/today", async (req, res) => {
  try {
    if (!cachedTimes) cachedTimes = await scrapePrayerTimes();
    res.json({
      date: new Date().toISOString().split("T")[0],
      times: cachedTimes,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`✅ Server running on port ${PORT}`)
);

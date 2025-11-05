/**
 * server.js - Kent Jamaah Scraper
 *
 * Instructions:
 * 1. Save as server.js in your folder (no .txt!)
 * 2. Ensure package.json exists with the dependencies listed
 * 3. Deploy to Render / local Node.js environment
 */

import express from 'express';
import puppeteer from 'puppeteer';
import fs from 'fs-extra';
import path from 'path';
import cors from 'cors';
import fetch from 'node-fetch';
import pdf from 'pdf-parse';

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.resolve('./data');
fs.ensureDirSync(DATA_DIR);

const app = express();
app.use(cors());

const MOSQUES = [
  { id: 'kmwa', name: 'Kent Muslim Welfare Association', url: 'https://kmwa.org.uk/' },
  { id: 'chatham-hill', name: 'Chatham Hill Mosque & Kent Islamic Centre', url: 'https://www.chathamhillmosque.co.uk/' },
  { id: 'gravesend-central', name: 'Gravesend Central Mosque', url: 'https://www.gravesendcentralmosque.com/' },
  { id: 'masjidul-abraar', name: 'Masjidul Abraar', url: 'https://www.masjidulabraar.org/' },
  { id: 'sittingbourne', name: 'Sittingbourne Islamic Cultural Centre', url: 'https://masjidbox.com/prayer-times/sittingbourne-islamic-cultural-centre' },
  { id: 'maidstone', name: 'Maidstone Mosque', url: 'https://maidstonemosque.com/' },
  { id: 'canterbury', name: 'Canterbury Mosque', url: 'https://canterburymosque.co.uk/' },
  { id: 'ashford', name: 'Ashford Mosque', url: 'https://ashfordmosque.org/' },
  { id: 'tonbridge', name: 'Tonbridge Masjid', url: 'https://tonbridgemasjid.org/' },
  { id: 'masjid-abubakr', name: 'Masjid Abu Bakr', url: 'https://masjidabubakr.co.uk/' },
  { id: 'secc-sidcup', name: 'SECC Sidcup', url: 'http://www.seccsidcup.org.uk/prayer-times/' },
  { id: 'dmic', name: 'DMIC', url: 'https://dmic.co.uk/Prayer-Times/Monthly-Prayer-Timetable-November-2025.pdf' }
];

// helper to extract times like 05:00, 12:30, etc
function extractTimesFromText(text) {
  if (!text || typeof text !== 'string') return [];
  const regex = /([01]?\d|2[0-3]):[0-5]\d(?:\s?(?:am|pm))?/ig;
  const matches = text.match(regex);
  if (!matches) return [];
  return matches.map(raw => {
    const m = raw.match(/([01]?\d|2[0-3]):([0-5]\d)\s*(am|pm)?/i);
    if (!m) return raw.trim();
    let hh = parseInt(m[1], 10);
    const mm = m[2];
    const ampm = m[3] && m[3].toLowerCase();
    if (ampm) {
      if (ampm === 'pm' && hh !== 12) hh += 12;
      if (ampm === 'am' && hh === 12) hh = 0;
    }
    return String(hh).padStart(2,'0') + ':' + mm;
  });
}

// PDF extraction
async function extractFromPDF(url) {
  try {
    const resp = await fetch(url);
    const buffer = await resp.buffer();
    const data = await pdf(buffer);
    const text = data.text || '';
    const times = extractTimesFromText(text);
    const jamaah = { Fajr:null,Dhuhr:null,Asr:null,Maghrib:null,Isha:null };
    if (times.length>=5) {
      jamaah.Fajr=times[0]; jamaah.Dhuhr=times[1]; jamaah.Asr=times[2]; jamaah.Maghrib=times[3]; jamaah.Isha=times[4];
    }
    const jummah = times.slice(5,10);
    return { jamaah, jummah };
  } catch(err) {
    console.warn('PDF extract failed', url, err.message);
    return { jamaah:{Fajr:null,Dhuhr:null,Asr:null,Maghrib:null,Isha:null}, jummah:[] };
  }
}

// generic HTML page extractor
async function genericExtract(page) {
  const bodyText = await page.evaluate(() => document.body.innerText || '');
  const prayers = ['Fajr','Dhuhr','Asr','Maghrib','Isha'];
  const jamaah = {};
  for(const p of prayers){
    const regex = new RegExp(p+'[^\\d]*(\\d{1,2}:\\d{2})','i');
    const match = bodyText.match(regex);
    jamaah[p] = match ? match[1] : null;
  }
  // jummah
  const jummah = [];
  const jumNodes = await page.$x("//*[contains(translate(.,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'jum')]");
  for(const n of jumNodes.slice(0,6)){
    const t = await page.evaluate(el=>el.innerText||'',n);
    const found = extractTimesFromText(t);
    if(found.length) jummah.push(...found);
  }
  return { jamaah, jummah:Array.from(new Set(jummah)).slice(0,5) };
}

// scrape single mosque
async function scrapeMosque(browser, mosque) {
  if(mosque.url.endsWith('.pdf')) return await extractFromPDF(mosque.url);
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (compatible; KentJamahBot/1.0)');
  await page.goto(mosque.url,{waitUntil:'domcontentloaded',timeout:25000}).catch(()=>{});
  const result = await genericExtract(page);
  await page.close();
  return result;
}

// API endpoint
app.get('/api/kent-mosques', async (req,res)=>{
  const date = req.query.date || new Date().toISOString().split('T')[0];
  const cacheFile = path.join(DATA_DIR,`${date}.json`);
  if(await fs.pathExists(cacheFile)){
    const cached = await fs.readJson(cacheFile);
    return res.json({fromCache:true,date,data:cached});
  }
  const browser = await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-setuid-sandbox']});
  const results=[];
  for(const m of MOSQUES){
    const data = await scrapeMosque(browser,m);
    results.push({id:m.id,name:m.name,url:m.url,jamaah:data.jamaah,jummah:data.jummah,scrapedAt:new Date().toISOString()});
  }
  await browser.close();
  await fs.writeJson(cacheFile,results,{spaces:2});
  res.json({fromCache:false,date,data:results});
});

app.get('/',(req,res)=>res.send('<h3>Kent Jamaah Scraper</h3><p>Use /api/kent-mosques?date=YYYY-MM-DD</p>'));

app.listen(PORT,()=>console.log(`Server running on port ${PORT}`));
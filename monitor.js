// 檢查各網站的新公告，有新的就發到 Google Chat。
// 用法: GOOGLE_CHAT_WEBHOOK=... node monitor.js [--dry-run]
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, 'seen.json');
const MAX_SEEN = 300;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const DRY_RUN = process.argv.includes('--dry-run');

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

const decode = (s) => s
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim();

// Sony Music 系列官網共用的公告 JSON（JSONP 格式）
function sonyMusic(folder, archiveUrl) {
  return async () => {
    const body = await get(`https://www.sonymusic.co.jp/json/v2/artist/${folder}/information/start/0/count/20`);
    const json = JSON.parse(body.slice(body.indexOf('(') + 1, body.lastIndexOf(')')));
    return json.items.map((it) => ({
      id: String(it.id),
      title: decode(it.title),
      date: it.date,
      url: archiveUrl + it.link.split('/info/')[1],
    }));
  };
}

const SITES = [
  {
    name: 'zutomayo',
    fetch: async () => {
      const html = await get('https://zutomayo.net/news/');
      const items = [];
      const re = /<p class="f-tt--b">\[([^\]]*)\]<\/p>\s*<h3 class="f-tt--b">([\s\S]*?)<\/h3>[\s\S]*?<a href="\/news\/([^"\/]+)" class="btn-link">/g;
      for (const m of html.matchAll(re)) {
        items.push({ id: m[3], title: decode(m[2]), date: m[1], url: `https://zutomayo.net/news/${m[3]}` });
      }
      return items;
    },
  },
  { name: '西野加奈', fetch: sonyMusic('kananishino', 'https://www.nishinokana.com/info/archive/?') },
  { name: 'アジカン', fetch: sonyMusic('ASIANKUNG-FU', 'https://www.asiankung-fu.com/s/n80/page/smoj_info_archive?') },
  {
    name: '水曜日',
    fetch: async () => {
      const json = JSON.parse(await get('http://www.wed-camp.com/data/cms-ja.json'));
      return json.tour.map((t) => ({
        id: String(t.id),
        title: decode(`${t.title}（${t.date}）`),
        date: t.post_date,
        url: `http://www.wed-camp.com/?id=${t.id}#tour`,
      }));
    },
  },
  { name: 'LGM', fetch: sonyMusic('LittleGleeMonster', 'https://www.littlegleemonster.com/info/archive/?') },
];

async function notify(text) {
  if (DRY_RUN) { console.log('[dry-run]', text.replace(/\n/g, ' | ')); return; }
  const webhook = process.env.GOOGLE_CHAT_WEBHOOK;
  if (!webhook) throw new Error('GOOGLE_CHAT_WEBHOOK is not set');
  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Google Chat HTTP ${res.status}: ${await res.text()}`);
}

async function main() {
  const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {};
  let failed = false;

  for (const site of SITES) {
    try {
      // 只看最新 30 則；MAX_SEEN 要比這個大，舊公告才不會被當成新的
      const items = (await site.fetch()).slice(0, 30);
      if (items.length === 0) throw new Error('抓不到任何公告，網站結構可能改了');

      const seen = state[site.name];
      // 第一次跑只記錄現有公告，不發通知，避免一次洗版
      if (!seen) {
        state[site.name] = items.map((i) => i.id);
        console.log(`${site.name}: 初次記錄 ${items.length} 則`);
        continue;
      }

      const fresh = items.filter((i) => !seen.includes(i.id)).reverse(); // 舊的先發
      for (const item of fresh) {
        await notify(`這是來自 ${site.name} 的公告\n*${item.title}*\n${item.url}`);
        seen.unshift(item.id);
        state[site.name] = seen.slice(0, MAX_SEEN);
      }
      console.log(`${site.name}: ${items.length} 則，新的 ${fresh.length} 則`);
    } catch (e) {
      failed = true;
      console.error(`${site.name}: 失敗 - ${e.message}`);
    }
  }

  if (!DRY_RUN) fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
  if (failed) process.exitCode = 1;
}

main();

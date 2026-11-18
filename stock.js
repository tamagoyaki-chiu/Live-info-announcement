// 台股開盤／收盤行情通知到 Google Chat。
// 用法: GOOGLE_CHAT_WEBHOOK=... node stock.js open|close [--dry-run]
const MODE = process.argv[2];
const DRY_RUN = process.argv.includes('--dry-run');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

// symbol: Yahoo Finance（走勢圖，約延遲 20 分鐘）／mis: 證交所即時行情
const SYMBOLS = [
  { symbol: '^TWII', mis: 'tse_t00.tw', name: '加權指數', index: true },
  { symbol: '2330.TW', mis: 'tse_2330.tw', name: '台積電 2330' },
  { symbol: '2308.TW', mis: 'tse_2308.tw', name: '台達電 2308' },
];

// 台股習慣：漲紅跌綠
const UP = '#e53935';
const DOWN = '#2e7d32';
const FLAT = '#757575';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const taipeiDate = (sec) => new Date((sec + 8 * 3600) * 1000).toISOString().slice(0, 10);
const taipeiTime = (sec) => new Date((sec + 8 * 3600) * 1000).toISOString().slice(11, 16);
const fmt = (n, index) => n.toLocaleString('en-US', { minimumFractionDigits: index ? 2 : 0, maximumFractionDigits: 2 });

async function quote({ symbol, name, index }) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=5m&range=1d`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status} ${symbol}`);
  const r = (await res.json()).chart.result[0];
  const m = r.meta;
  const q = r.indicators.quote[0];
  const points = (r.timestamp || [])
    .map((t, i) => ({ t, close: q.close[i], open: q.open[i] }))
    .filter((p) => p.close != null);
  const price = m.regularMarketPrice;
  const prev = m.chartPreviousClose;
  return {
    name, index, price, prev, points,
    open: points[0]?.open ?? price,
    high: m.regularMarketDayHigh,
    low: m.regularMarketDayLow,
    volume: m.regularMarketVolume,
    change: price - prev,
    pct: ((price - prev) / prev) * 100,
    date: points.length ? taipeiDate(points[0].t) : null,
    time: m.regularMarketTime,
    sessionStart: m.currentTradingPeriod.regular.start,
    sessionEnd: m.currentTradingPeriod.regular.end,
  };
}

// 證交所即時行情。z 是最新成交價，剛好沒成交時是 "-"，改用最佳買賣價的中間值
async function misQuotes() {
  const ex = SYMBOLS.map((s) => s.mis).join('|');
  const res = await fetch(`https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(ex)}&json=1&delay=0`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`TWSE HTTP ${res.status}`);
  const num = (v) => (v && v !== '-' ? parseFloat(v) : null);
  const out = {};
  for (const a of (await res.json()).msgArray) {
    const bid = num((a.b || '').split('_')[0]);
    const ask = num((a.a || '').split('_')[0]);
    const price = num(a.z) ?? (bid && ask ? (bid + ask) / 2 : bid ?? ask);
    out[`${a.ex}_${a.ch}`] = {
      price, open: num(a.o), high: num(a.h), low: num(a.l), prev: num(a.y),
      volume: num(a.v), // 個股單位為張
      date: `${a.d.slice(0, 4)}-${a.d.slice(4, 6)}-${a.d.slice(6, 8)}`,
      clock: a.t,
    };
  }
  return out;
}

// 以證交所即時資料為主，抓不到時退回 Yahoo
function merge(q, live) {
  if (!live || live.price == null) return { ...q, clock: taipeiTime(q.time), volumeLots: q.volume / 1000 };
  return {
    ...q, ...live,
    change: live.price - live.prev,
    pct: ((live.price - live.prev) / live.prev) * 100,
    volumeLots: live.volume,
  };
}

const arrow = (q) => (q.change > 0 ? '▲' : q.change < 0 ? '▼' : '－');
const color = (q) => (q.change > 0 ? UP : q.change < 0 ? DOWN : FLAT);
const changeText = (q) =>
  `${arrow(q)} ${fmt(Math.abs(q.change), q.index)} (${q.change >= 0 ? '+' : '-'}${Math.abs(q.pct).toFixed(2)}%)`;

// 用 QuickChart 產生當日走勢圖，回傳圖片網址
async function chartUrl(q) {
  // x 軸固定為整個交易時段（09:00–13:30，每 5 分鐘）
  const labels = [];
  const byTime = new Map(q.points.map((p) => [taipeiTime(p.t), p.close]));
  for (let t = q.sessionStart; t <= q.sessionEnd; t += 300) labels.push(taipeiTime(t));
  const data = labels.map((l) => byTime.get(l) ?? null);
  // Yahoo 有延遲，把最新價格（收盤後即收盤價）接在對應的時間點上
  const hhmm = q.clock.slice(0, 5);
  let slot = labels.findLastIndex((l) => l <= hhmm);
  if (slot >= 0) {
    if (data[slot] != null && labels[slot] !== hhmm && slot < labels.length - 1) slot++;
    data[slot] = q.price;
  }

  // 軸上只標整點和收盤時間
  const axisLabels = labels.map((l, i) => (l.endsWith(':00') || i === labels.length - 1 ? l : ''));

  const config = {
    type: 'line',
    data: {
      labels: axisLabels,
      datasets: [
        { data, borderColor: color(q), backgroundColor: color(q) + '22', fill: true, borderWidth: 2, pointRadius: 0, spanGaps: true },
        { data: labels.map(() => q.prev), borderColor: '#9e9e9e', borderDash: [4, 4], borderWidth: 1, pointRadius: 0, fill: false },
      ],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { autoSkip: false, maxRotation: 0 }, grid: { display: false } },
        y: { ticks: { maxTicksLimit: 5 } },
      },
    },
  };
  const res = await fetch('https://quickchart.io/chart/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chart: config, version: '4', width: 600, height: 260, backgroundColor: 'white' }),
  });
  const json = await res.json();
  if (!json.success) throw new Error('QuickChart failed');
  return json.url;
}

function openMessage(quotes) {
  const date = quotes[0].date.replace(/-/g, '/');
  const lines = quotes.map((q) =>
    `*${q.name}*\n開盤 ${fmt(q.open, q.index)}　現在 ${fmt(q.price, q.index)}　${changeText(q)}`);
  return { text: `📈 台股開盤 ${date}（台北 ${quotes[0].clock.slice(0, 5)}）\n\n${lines.join('\n\n')}` };
}

async function closeMessage(quotes) {
  const date = quotes[0].date.replace(/-/g, '/');
  const sections = [];
  for (const q of quotes) {
    const widgets = [
      { decoratedText: {
        topLabel: '收盤',
        text: `<b>${fmt(q.price, q.index)}</b>　<font color="${color(q)}">${changeText(q)}</font>`,
        bottomLabel: `開 ${fmt(q.open, q.index)}　高 ${fmt(q.high, q.index)}　低 ${fmt(q.low, q.index)}` +
          (q.index ? '' : `　量 ${Math.round(q.volumeLots).toLocaleString('en-US')} 張`),
      } },
    ];
    try {
      widgets.push({ image: { imageUrl: await chartUrl(q), altText: `${q.name} 當日走勢` } });
    } catch (e) {
      console.error(`${q.name}: 走勢圖產生失敗 - ${e.message}`);
    }
    sections.push({ header: q.name, widgets });
  }
  return {
    // text 會顯示在通知預覽裡
    text: `📊 台股收盤 ${date}`,
    cardsV2: [{
      cardId: 'tw-close',
      card: { header: { title: `台股收盤 ${date}`, subtitle: '虛線為昨日收盤價' }, sections },
    }],
  };
}

async function send(message) {
  if (DRY_RUN) { console.log(JSON.stringify(message, null, 2)); return; }
  const webhook = process.env.GOOGLE_CHAT_WEBHOOK;
  if (!webhook) throw new Error('GOOGLE_CHAT_WEBHOOK is not set');
  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(message),
  });
  if (!res.ok) throw new Error(`Google Chat HTTP ${res.status}: ${await res.text()}`);
}

async function main() {
  if (MODE !== 'open' && MODE !== 'close') throw new Error('usage: node stock.js open|close [--dry-run]');
  const today = taipeiDate(Math.floor(Date.now() / 1000));

  // 證交所抓不到時只能靠延遲的 Yahoo，開盤後最多等 30 分鐘等今天的資料出現
  let quotes;
  for (let attempt = 0; ; attempt++) {
    let live = {};
    try {
      live = await misQuotes();
    } catch (e) {
      console.error(`證交所行情失敗，改用 Yahoo - ${e.message}`);
    }
    const yahoo = await Promise.all(SYMBOLS.map(quote));
    quotes = yahoo.map((q, i) => merge(q, live[SYMBOLS[i].mis]));
    if (quotes.every((q) => q.date === today)) break;
    if (MODE === 'close' || attempt >= 30) {
      console.log(`今天（${today}）沒有交易資料，判斷為休市，不發通知`);
      return;
    }
    await sleep(60_000);
  }

  await send(MODE === 'open' ? openMessage(quotes) : await closeMessage(quotes));
  console.log(`${MODE} 通知已送出`);
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; });

'use strict';

/**
 * 시장 동향 대시보드 - 백엔드 프록시 서버
 *
 * 브라우저에서 Yahoo Finance 를 직접 부르면 CORS 에 막히므로,
 * 이 서버가 서버 사이드에서 Yahoo chart API 를 호출해 프론트로 넘겨준다.
 * (공개 CORS 프록시는 쓰지 않고 직접 구현)
 */

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5173;

// Yahoo 는 User-Agent 가 없으면 종종 거부하므로 브라우저처럼 위장한다.
const YH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  Accept: 'application/json,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};

// 한 호스트가 실패하면 다른 호스트로 재시도한다.
const HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];

async function fetchYahooChart(symbol, range, interval) {
  let lastErr;
  for (const host of HOSTS) {
    const url =
      `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}` +
      `?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}` +
      `&includePrePost=true`;
    try {
      const res = await fetch(url, { headers: YH_HEADERS });
      if (!res.ok) {
        lastErr = new Error(`Yahoo HTTP ${res.status}`);
        continue;
      }
      const json = await res.json();
      if (json && json.chart && json.chart.error) {
        lastErr = new Error(json.chart.error.description || 'Yahoo error');
        continue;
      }
      if (!json || !json.chart || !json.chart.result || !json.chart.result[0]) {
        lastErr = new Error('빈 응답');
        continue;
      }
      return json;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('fetch 실패');
}

function parseChart(json) {
  const r = json.chart.result[0];
  const meta = r.meta || {};
  const ts = r.timestamp || [];
  const quote =
    (r.indicators && r.indicators.quote && r.indicators.quote[0]) || {};
  const opens = quote.open || [];
  const highs = quote.high || [];
  const lows = quote.low || [];
  const closes = quote.close || [];

  // 캔들스틱용 OHLC. 하나라도 null/비유한값이면 그 지점은 건너뛴다.
  const series = [];
  for (let i = 0; i < ts.length; i++) {
    const o = opens[i];
    const h = highs[i];
    const l = lows[i];
    const c = closes[i];
    if (
      o == null || h == null || l == null || c == null ||
      !isFinite(o) || !isFinite(h) || !isFinite(l) || !isFinite(c)
    ) {
      continue;
    }
    series.push({ time: ts[i], open: o, high: h, low: l, close: c });
  }

  return {
    symbol: meta.symbol,
    currency: meta.currency,
    price: meta.regularMarketPrice,
    previousClose:
      meta.chartPreviousClose != null
        ? meta.chartPreviousClose
        : meta.previousClose,
    marketTime: meta.regularMarketTime, // epoch 초 - 데이터 신선도 판단용
    exchangeTz: meta.exchangeTimezoneName,
    dayHigh: meta.regularMarketDayHigh,
    dayLow: meta.regularMarketDayLow,
    series,
    fetchedAt: Math.floor(Date.now() / 1000),
  };
}

// GET /api/chart?symbol=^TNX&range=1d&interval=5m
app.get('/api/chart', async (req, res) => {
  const symbol = req.query.symbol;
  const range = req.query.range || '1d';
  const interval = req.query.interval || '5m';
  if (!symbol) return res.status(400).json({ error: 'symbol 파라미터 필요' });

  try {
    const json = await fetchYahooChart(symbol, range, interval);
    res.set('Cache-Control', 'no-store');
    res.json(parseChart(json));
  } catch (e) {
    res.status(502).json({ error: String((e && e.message) || e), symbol });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// ---- 공통 JSON fetch 헬퍼 --------------------------------------------------
async function fetchJson(url, opts = {}) {
  const timeoutMs = opts.timeoutMs || 8000;
  const headers = { ...YH_HEADERS, ...(opts.headers || {}) };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// 야후 KRW=X(달러/원) 현재가를 가져온다. (김치/금치 공용)
async function getUsdKrw() {
  const fx = parseChart(await fetchYahooChart('KRW=X', '1d', '5m'));
  return fx.price;
}

// ---- 지수: 인베스팅닷컴 우선 시도 → 실패 시 야후 폴백 ----------------------
// 인베스팅닷컴은 공식 API 가 없고 Cloudflare 봇 차단(403)이 있어, 실제로는
// 대부분 야후로 폴백된다. 그래도 스펙대로 "우선 시도"는 수행한다.
const INVESTING_IDS = {
  '^GSPC': 166, // S&P 500
  '^NDX': 20, // Nasdaq 100
  '^KS11': 37426, // KOSPI
  'ES=F': 1175153, // S&P500 선물
  'NQ=F': 8874, // Nasdaq100 선물
};
async function tryInvesting(symbol) {
  const id = INVESTING_IDS[symbol];
  if (!id) return null;
  try {
    const j = await fetchJson(
      `https://api.investing.com/api/financialdata/${id}/historical/chart/?interval=PT1M&pointscount=2`,
      {
        timeoutMs: 4000,
        headers: {
          Referer: 'https://www.investing.com/',
          Origin: 'https://www.investing.com',
          'domain-id': 'www',
        },
      }
    );
    // data.data = [[ts, open, high, low, close, ...], ...]
    const rows = j && j.data;
    if (Array.isArray(rows) && rows.length) {
      const last = rows[rows.length - 1];
      const price = Number(last[4] != null ? last[4] : last[1]);
      if (isFinite(price)) return { price, ts: Math.floor(last[0] / 1000) };
    }
    return null;
  } catch {
    return null; // 차단/오류 시 폴백
  }
}

// 네이버 금융 국내 금 시세 (goldDetail.naver 페이지의 "국내 금 매매기준율").
// goldDailyQuote 표의 최신 행 첫 값(매매기준율, 원/g)을 파싱한다.
//   · 이 값이 네이버 금 시세 페이지와 이지인베스팅 등에서 보는 "국내 금" 시세와 일치.
//   · (참고: 모바일 front-api M04020000 은 다른 계열이라 값이 달라 사용하지 않음)
// 숫자·날짜는 ASCII 라 EUC-KR 디코딩 없이도 정규식으로 안전하게 추출된다.
async function getNaverDomesticGoldPerGram() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(
      'https://finance.naver.com/marketindex/goldDailyQuote.naver',
      {
        headers: { ...YH_HEADERS, Referer: 'https://finance.naver.com/marketindex/' },
        signal: ctrl.signal,
      }
    );
    if (!res.ok) throw new Error(`네이버 금 HTTP ${res.status}`);
    const html = await res.text();
    // 최신 행: 첫 날짜 셀(YYYY.MM.DD) 뒤 첫 번째 매매기준율(원/g)
    const dateM = html.match(/(\d{4}\.\d{2}\.\d{2})<\/td>/);
    if (!dateM) throw new Error('네이버 금 표 날짜 파싱 실패');
    const after = html.slice(dateM.index);
    const numM = after.match(/([0-9]{2,3},[0-9]{3}\.[0-9]{2})/);
    if (!numM) throw new Error('네이버 금 가격 파싱 실패');
    const perGram = parseFloat(numM[1].replace(/,/g, ''));
    if (!isFinite(perGram)) throw new Error('네이버 금 가격 변환 실패');
    return { perGram, tradedAt: dateM[1].replace(/\./g, '-') };
  } finally {
    clearTimeout(t);
  }
}

// 네이버 금융 원/달러 환율 (USD/KRW, 매매기준율). 국내 금 시세와 동일 소스·시점.
async function getNaverUsdKrw() {
  const url =
    'https://m.stock.naver.com/front-api/marketIndex/prices' +
    '?category=exchange&reutersCode=FX_USDKRW&page=1&pageSize=10';
  const j = await fetchJson(url, {
    headers: { Referer: 'https://m.stock.naver.com/' },
  });
  if (!j || !j.isSuccess || !Array.isArray(j.result) || !j.result.length) {
    throw new Error('네이버 환율 형식 오류');
  }
  const latest = j.result[0];
  const rate = parseFloat(String(latest.closePrice).replace(/,/g, ''));
  if (!isFinite(rate)) throw new Error('네이버 환율 파싱 실패');
  return { rate, tradedAt: latest.localTradedAt };
}

// GET /api/index?symbol=^GSPC&range=1d&interval=5m
// 시세(현재가)는 인베스팅 우선, 캔들 차트는 야후. source 로 실제 출처를 알린다.
app.get('/api/index', async (req, res) => {
  const symbol = req.query.symbol;
  const range = req.query.range || '1d';
  const interval = req.query.interval || '5m';
  if (!symbol) return res.status(400).json({ error: 'symbol 파라미터 필요' });
  try {
    const [yahoo, inv] = await Promise.all([
      fetchYahooChart(symbol, range, interval).then(parseChart),
      tryInvesting(symbol),
    ]);
    res.set('Cache-Control', 'no-store');
    if (inv && inv.price) {
      res.json({ ...yahoo, price: inv.price, marketTime: inv.ts, source: 'investing', investingTried: true });
    } else {
      res.json({ ...yahoo, source: 'yahoo', investingTried: true });
    }
  } catch (e) {
    res.status(502).json({ error: String((e && e.message) || e), symbol });
  }
});

// ---- 김치프리미엄: 업비트(KRW) vs 바이낸스(USD) BTC 가격차 ------------------
// 프리미엄(%) = ((업비트원화 / 환율) / 바이낸스달러 - 1) * 100
app.get('/api/kimchi', async (_req, res) => {
  try {
    const [upbitArr, binance, krw] = await Promise.all([
      fetchJson('https://api.upbit.com/v1/ticker?markets=KRW-BTC'),
      fetchJson('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT'),
      getUsdKrw(),
    ]);
    const upbitKrw = Array.isArray(upbitArr) ? upbitArr[0].trade_price : null;
    const binanceUsd = binance ? parseFloat(binance.price) : null;
    if (!upbitKrw || !binanceUsd || !krw) throw new Error('원시값 누락');

    const upbitUsdEquiv = upbitKrw / krw; // 업비트가격을 달러로 환산
    const binanceKrwEquiv = binanceUsd * krw; // 바이낸스가격을 원화로 환산
    const premium = (upbitUsdEquiv / binanceUsd - 1) * 100;

    res.set('Cache-Control', 'no-store');
    res.json({
      available: true,
      premium, // %
      upbitKrw, // 업비트 원화가격
      binanceUsd, // 바이낸스 달러가격
      binanceKrwEquiv, // 바이낸스 환산가격(원)
      upbitUsdEquiv, // 업비트 환산가격(달러)
      krw, // 적용 환율
      fetchedAt: Math.floor(Date.now() / 1000),
    });
  } catch (e) {
    res.status(502).json({ available: false, error: String((e && e.message) || e) });
  }
});

// ---- 금치프리미엄: 국제 금(GC=F) vs 국내 금(네이버=신한은행 고시) -----------
// 금치프리미엄(%) = (국내금_g당원화 / 국제금_g당원화환산 - 1) * 100
const TROY_OZ_G = 31.1034768;
app.get('/api/goldkimchi', async (_req, res) => {
  try {
    const gcParsed = parseChart(await fetchYahooChart('GC=F', '1d', '5m'));
    const gc = gcParsed.price;
    if (!gc) throw new Error('국제금 원시값 누락');

    // 환율: 국내 금(네이버)과 시점을 맞추기 위해 네이버 원/달러 환율을 우선 사용.
    //       실패 시에만 야후 KRW=X 로 폴백한다.
    let yahooKrw = null;
    let yahooKrwTime = null;
    try {
      const yfx = parseChart(await fetchYahooChart('KRW=X', '1d', '5m'));
      yahooKrw = yfx.price;
      yahooKrwTime = yfx.marketTime;
    } catch { /* 무시 */ }

    let krw = null;
    let krwSource = null;
    let krwTradedAt = null;
    try {
      const nf = await getNaverUsdKrw();
      krw = nf.rate;
      krwSource = '네이버(매매기준율)';
      krwTradedAt = nf.tradedAt;
    } catch {
      krw = yahooKrw;
      krwSource = '야후 KRW=X';
      krwTradedAt = null;
    }
    if (!krw) throw new Error('환율 소스 모두 실패');

    // 진단: 야후 KRW=X 와 실제 사용 환율이 크게 다르면 로그로 남긴다.
    if (yahooKrw != null) {
      const ageStr =
        yahooKrwTime != null
          ? `${Math.floor(Date.now() / 1000) - yahooKrwTime}s 전`
          : '시각미상';
      const flag = Math.abs(yahooKrw - krw) > 10 ? '  <== 불일치!' : '';
      console.log(
        `[goldkimchi] 야후 KRW=X=${yahooKrw} (${ageStr}) | 사용 환율=${krw} (${krwSource})${flag}`
      );
    }

    const intlPerGram = (gc / TROY_OZ_G) * krw; // 국제 금 g당 원화 환산

    // 국내 금: 네이버 국내 금 시세 (실패해도 국제 참고값은 내려준다)
    let domesticPerGram = null;
    let domesticTradedAt = null;
    let domesticError = null;
    try {
      const dom = await getNaverDomesticGoldPerGram();
      domesticPerGram = dom.perGram;
      domesticTradedAt = dom.tradedAt;
    } catch (e) {
      domesticError = String((e && e.message) || e);
    }

    const premium =
      domesticPerGram != null ? (domesticPerGram / intlPerGram - 1) * 100 : null;

    res.set('Cache-Control', 'no-store');
    res.json({
      available: domesticPerGram != null,
      premium,
      domesticPerGram, // 국내 금 g당 원화 (네이버/신한 고시)
      domesticTradedAt, // 국내 금 시세 기준일
      intlPerGram, // 국제 금 g당 원화 환산
      gcUsd: gc, // 국제 금 USD/oz
      gcTime: gcParsed.marketTime, // 국제 금 시세 시점
      krw, // 실제 적용 환율
      krwSource, // 환율 출처
      krwTradedAt, // 환율 기준일/시점
      yahooKrw, // 참고: 야후 KRW=X 값
      domesticError, // 국내 소스 실패 시 사유
      source: '네이버 금융 국내 금 시세 (매매기준율)',
      fetchedAt: Math.floor(Date.now() / 1000),
    });
  } catch (e) {
    res.status(502).json({ available: false, error: String((e && e.message) || e) });
  }
});

// ---- 원/달러 환율: 야후 KRW=X 우선 + 네이버 매매기준율 안전장치 -------------
// 과거 야후 KRW=X 가 순간적으로 실제 환율과 크게 어긋난 값을 준 사례가 있어,
// 네이버 매매기준율(금치프리미엄에서 이미 쓰는 소스)과 비교해 2% 이상 벗어나면
// 그 시점만 네이버 값으로 대체한다. 캔들 차트(series)는 항상 야후 데이터를 쓴다.
const FX_KRW_SANITY_THRESHOLD = 0.02; // 2%

app.get('/api/fx-krw', async (req, res) => {
  const range = req.query.range || '1d';
  const interval = req.query.interval || '5m';
  try {
    const yahoo = parseChart(await fetchYahooChart('KRW=X', range, interval));

    let naverRate = null;
    let naverTradedAt = null;
    let naverError = null;
    try {
      const nf = await getNaverUsdKrw();
      naverRate = nf.rate;
      naverTradedAt = nf.tradedAt;
    } catch (e) {
      naverError = String((e && e.message) || e);
    }

    let price = yahoo.price;
    let source = 'yahoo';
    let overridden = false;
    if (naverRate != null && yahoo.price != null) {
      const diffPct = Math.abs(yahoo.price - naverRate) / naverRate;
      if (diffPct > FX_KRW_SANITY_THRESHOLD) {
        console.error(
          `[fx-krw] 야후 KRW=X(${yahoo.price})가 네이버 환율(${naverRate})과 ` +
            `${(diffPct * 100).toFixed(1)}% 괴리 → 네이버 값으로 대체`
        );
        price = naverRate;
        source = 'naver';
        overridden = true;
      }
    }

    res.set('Cache-Control', 'no-store');
    res.json({
      ...yahoo,
      price,
      source, // 'yahoo' | 'naver'
      overridden, // 안전장치 발동 여부
      yahooPrice: yahoo.price, // 참고: 원래 야후 값
      naverRate,
      naverTradedAt,
      naverError,
    });
  } catch (e) {
    res.status(502).json({ error: String((e && e.message) || e) });
  }
});

// ---- CNN Fear & Greed Index (비공식 엔드포인트) ----------------------------
// production.dataviz.cnn.io 는 봇 차단(HTTP 418)이 있는데, Referer/Origin 을
// CNN 자체 페이지처럼 넣어주면 통과한다. (User-Agent 는 YH_HEADERS 재사용)
function fearGreedStartDate() {
  const d = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000); // 1년 전
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// 하위 지표 하나에서 (CNN 점수, 등급, 실제 원시값)만 뽑아낸다.
function pickIndicator(obj) {
  if (!obj) return null;
  const data = Array.isArray(obj.data) ? obj.data : [];
  const last = data.length ? data[data.length - 1] : null;
  return {
    score: obj.score,
    rating: obj.rating,
    timestamp: obj.timestamp,
    lastValue: last ? last.y : null, // 해당 지표의 실제(원시) 수치
  };
}

app.get('/api/feargreed', async (_req, res) => {
  const url =
    `https://production.dataviz.cnn.io/index/fearandgreed/graphdata/${fearGreedStartDate()}`;
  try {
    const j = await fetchJson(url, {
      timeoutMs: 10000,
      headers: {
        Accept: 'application/json, text/plain, */*',
        Referer: 'https://edition.cnn.com/markets/fear-and-greed',
        Origin: 'https://edition.cnn.com',
      },
    });

    const fg = j.fear_and_greed;
    if (!fg || typeof fg.score !== 'number') throw new Error('fear_and_greed 필드 없음');

    const historical = Array.isArray(j.fear_and_greed_historical?.data)
      ? j.fear_and_greed_historical.data.map((p) => ({
          time: Math.floor(p.x / 1000),
          value: p.y,
        }))
      : [];

    res.set('Cache-Control', 'no-store');
    res.json({
      available: true,
      main: {
        score: fg.score,
        rating: fg.rating,
        timestamp: fg.timestamp,
        previousClose: fg.previous_close,
        previous1Week: fg.previous_1_week,
        previous1Month: fg.previous_1_month,
        previous1Year: fg.previous_1_year,
      },
      historical,
      subIndicators: {
        momentum: pickIndicator(j.market_momentum_sp500),
        priceStrength: pickIndicator(j.stock_price_strength),
        priceBreadth: pickIndicator(j.stock_price_breadth),
        putCall: pickIndicator(j.put_call_options),
        vix: pickIndicator(j.market_volatility_vix),
        junkBond: pickIndicator(j.junk_bond_demand),
        safeHaven: pickIndicator(j.safe_haven_demand),
      },
      fetchedAt: Math.floor(Date.now() / 1000),
    });
  } catch (e) {
    console.error('[feargreed] CNN 데이터 조회 실패:', e && e.message ? e.message : e);
    res.status(502).json({ available: false, error: String((e && e.message) || e) });
  }
});

// ---- 뉴스 탭: RSS 피드 (야후 파이낸스 + 구글 뉴스, API 키 불필요) ------------
// RSS 는 구조가 단순해서 별도 XML 파서 라이브러리 없이 정규식으로 파싱한다.

async function fetchText(url, opts = {}) {
  const timeoutMs = opts.timeoutMs || 8000;
  const headers = { ...YH_HEADERS, ...(opts.headers || {}) };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

// HTML/XML 흔한 엔티티만 간단히 디코딩 (전체 엔티티 테이블은 필요 없음)
function decodeEntities(s) {
  if (!s) return s;
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .trim();
}

function extractTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? decodeEntities(m[1]) : null;
}

// RSS 2.0 <item> 목록을 {title, link, pubDate, source} 배열로 파싱한다.
function parseRss(xml, defaultSource) {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  const items = [];
  for (const block of blocks) {
    let title = extractTag(block, 'title');
    const link = extractTag(block, 'link');
    const pubDate = extractTag(block, 'pubDate');
    if (!title || !link) continue;

    const srcMatch = block.match(/<source url="([^"]*)"[^>]*>([^<]*)<\/source>/i);
    let source = srcMatch ? decodeEntities(srcMatch[2]) : defaultSource;
    const sourceUrl = srcMatch ? srcMatch[1] : null;

    // 구글 뉴스는 제목 끝에 " - 출처명" 이 중복으로 붙어 있어 잘라낸다.
    if (source && title.endsWith(` - ${source}`)) {
      title = title.slice(0, -(` - ${source}`.length)).trim();
    }

    const ts = pubDate ? Date.parse(pubDate) : NaN;
    items.push({
      title,
      link: link.trim(),
      source: source || defaultSource,
      sourceUrl,
      timestamp: isNaN(ts) ? null : Math.floor(ts / 1000),
    });
  }
  return items;
}

async function fetchYahooNews(symbol) {
  try {
    const xml = await fetchText(
      `https://finance.yahoo.com/rss/headline?s=${encodeURIComponent(symbol)}`,
      { timeoutMs: 8000 }
    );
    return parseRss(xml, 'Yahoo Finance');
  } catch {
    return [];
  }
}

async function fetchGoogleNews(query) {
  try {
    const url =
      `https://news.google.com/rss/search?q=${encodeURIComponent(query)}` +
      `&hl=ko&gl=KR&ceid=KR:ko`;
    const xml = await fetchText(url, { timeoutMs: 8000 });
    return parseRss(xml, '구글 뉴스');
  } catch {
    return [];
  }
}

// 섹션별 뉴스 소스 매핑
const NEWS_SOURCES = {
  bonds: {
    yahoo: ['^TNX', 'ZN=F', '^TYX', '30Y=F'],
    google: ['미국 국채 금리', '연준 금리', '30년물 국채'],
  },
  fx: {
    yahoo: ['KRW=X', 'DX-Y.NYB'],
    google: ['달러 원 환율', '달러인덱스'],
  },
  indices: {
    yahoo: ['^GSPC', '^NDX', '^KS11'],
    google: ['코스피', '나스닥 지수'],
  },
  commodities: {
    yahoo: ['GC=F', 'SI=F', 'CL=F', 'BTC-USD', 'ETH-USD'],
    google: ['국제 금값', '국제 유가', 'WTI 원유', '비트코인 시세'],
  },
  premium: {
    yahoo: [],
    google: ['김치프리미엄', '국내 금시세 -vietnam.vn'],
  },
};

// 검색어와 무관하게 계속 섞여 들어오는 저관련성 소스를 통째로 제외한다.
// (예: 베트남 금시세를 여러 언어로 자동 번역해 퍼뜨리는 콘텐츠 파밍 사이트.
//  "Vietnam.vn", "Laodong.vn" 등 소스명은 제각각이라도 도메인은 전부 .vn 이라
//  소스명이 아니라 도메인 TLD 기준으로 걸러야 이름이 바뀌어도 계속 걸러진다.)
const NEWS_TLD_BLOCKLIST = ['.vn'];
function isBlockedSource(item) {
  if (!item.sourceUrl) return false;
  try {
    const host = new URL(item.sourceUrl).hostname.toLowerCase();
    return NEWS_TLD_BLOCKLIST.some((tld) => host.endsWith(tld));
  } catch {
    return false;
  }
}

// ---- 뉴스 중요도 스코어링 --------------------------------------------------
// "개수를 정해두고 자르기"가 아니라, 아래 3가지로 점수를 매겨 임계값을 넘는
// 뉴스만 (개수 제한 없이) 보여준다.
//   1) 최신성 - 최근일수록 높은 점수 (12시간 반감기)
//   2) 출처 신뢰도 - 로이터/블룸버그/연합뉴스 등 주요 언론사 가점
//   3) 교차 출처 중복 - 여러 매체가 같은 이슈를 다루면 "정말 중요한 이슈"로
//      보고 가장 큰 가중치를 준다.

const SOURCE_CREDIBILITY_TIERS = [
  {
    score: 8,
    patterns: [
      /reuters/i, /bloomberg/i, /wall street journal|\bwsj\b/i, /cnbc/i,
      /financial times|\bft\.com/i, /barron/i, /associated press|\bap\b/i,
      /연합뉴스(?!tv)/i, /^yna\.co\.kr/i, /연합인포맥스/i,
      /한국경제/i, /매일경제/i, /서울경제/i, /조선일보/i, /한겨레/i, /중앙일보/i,
      /\bkbs\b/i, /\bmbc\b/i, /\bsbs\b/i, /\bytn\b/i, /파이낸셜뉴스/i,
    ],
  },
  {
    score: 4,
    patterns: [
      /yahoo finance/i, /marketwatch/i, /investing\.com/i, /머니투데이/i,
      /아시아경제/i, /뉴시스/i, /뉴스1/i, /헤럴드경제/i, /이데일리/i,
      /글로벌이코노믹/i, /디지털타임스/i, /전자신문/i, /이투데이/i,
    ],
  },
];
function sourceCredibility(source) {
  const s = source || '';
  for (const tier of SOURCE_CREDIBILITY_TIERS) {
    if (tier.patterns.some((re) => re.test(s))) return tier.score;
  }
  return 0;
}

// 제목을 단어 집합으로 쪼갠다 (조사 몇 개만 대충 제거, 완벽한 형태소 분석 아님)
const TITLE_STOPWORDS = new Set([
  '이', '가', '은', '는', '을', '를', '의', '에', '에서', '으로', '로', '와',
  '과', '도', '만', '까지', '부터', '등', '그', '및',
]);
function tokenizeTitle(title) {
  const cleaned = title.replace(/[\[\]()「」『』''""·,.!?…\-–—:;]/g, ' ');
  const tokens = new Set();
  for (const w of cleaned.split(/\s+/)) {
    const t = w.trim();
    if (t.length >= 2 && !TITLE_STOPWORDS.has(t)) tokens.add(t.toLowerCase());
  }
  return tokens;
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

// 제목 유사도로 "같은 이슈"를 묶는다 (야후+구글 합친 원시 목록 전체 대상)
const CLUSTER_SIMILARITY_THRESHOLD = 0.45;
function clusterNews(items) {
  const clusters = [];
  for (const it of items) {
    const tokens = tokenizeTitle(it.title);
    let best = null;
    let bestSim = 0;
    for (const c of clusters) {
      const sim = jaccard(tokens, c.tokens);
      if (sim > bestSim) {
        bestSim = sim;
        best = c;
      }
    }
    if (best && bestSim >= CLUSTER_SIMILARITY_THRESHOLD) {
      best.members.push(it);
      const curCred = sourceCredibility(best.repItem.source);
      const newCred = sourceCredibility(it.source);
      if (newCred > curCred || (newCred === curCred && (it.timestamp || 0) > (best.repItem.timestamp || 0))) {
        best.repItem = it; // 더 신뢰도 높은(동률이면 더 최신) 소스를 대표로
      }
    } else {
      clusters.push({ repItem: it, tokens, members: [it] });
    }
  }
  return clusters;
}

function recencyScore(timestamp) {
  if (!timestamp) return 0;
  const ageHours = Math.max(0, Date.now() / 1000 / 3600 - timestamp / 3600);
  return 10 * Math.pow(0.5, ageHours / 12); // 12시간마다 절반으로 감쇠
}

// 교차 출처 중복(같은 이슈를 여러 매체가 다룸)에 가장 큰 가중치를 둔다.
const DUPLICATE_SOURCE_WEIGHT = 6;
const NEWS_SCORE_THRESHOLD = 14; // 이 값 미만은 "사소한 단신"으로 간주해 제외

function scoreCluster(cluster) {
  const distinctSources = new Set(cluster.members.map((m) => (m.source || '').toLowerCase()));
  const bestTimestamp = Math.max(...cluster.members.map((m) => m.timestamp || 0));
  const bestCredibility = Math.max(...cluster.members.map((m) => sourceCredibility(m.source)));
  const duplicateBonus = (distinctSources.size - 1) * DUPLICATE_SOURCE_WEIGHT;
  return {
    score: recencyScore(bestTimestamp) + bestCredibility + duplicateBonus,
    sourceCount: distinctSources.size,
  };
}

const NEWS_CACHE = new Map(); // category -> { at, data }
const NEWS_CACHE_TTL_MS = 4 * 60 * 1000; // 4분 (프론트 5분 폴링보다 살짝 짧게)

app.get('/api/news', async (req, res) => {
  const category = req.query.category;
  const src = NEWS_SOURCES[category];
  if (!src) {
    return res.status(400).json({ error: `알 수 없는 category: ${category}` });
  }

  const cached = NEWS_CACHE.get(category);
  if (cached && Date.now() - cached.at < NEWS_CACHE_TTL_MS) {
    res.set('Cache-Control', 'no-store');
    return res.json(cached.data);
  }

  try {
    const [yahooResults, googleResults] = await Promise.all([
      Promise.all(src.yahoo.map((sym) => fetchYahooNews(sym))),
      Promise.all(src.google.map((q) => fetchGoogleNews(q))),
    ]);
    const merged = [...yahooResults.flat(), ...googleResults.flat()].filter(
      (it) => !isBlockedSource(it)
    );

    const clusters = clusterNews(merged);
    const scored = clusters.map((c) => {
      const { score, sourceCount } = scoreCluster(c);
      return {
        title: c.repItem.title,
        link: c.repItem.link,
        source: c.repItem.source,
        timestamp: c.repItem.timestamp,
        sourceCount,
        score: Math.round(score * 10) / 10,
      };
    });
    // 1단계: 중요도 점수로 "볼 만한 뉴스"만 필터링 (임계값 미만은 제외)
    // 2단계: 필터링된 뉴스를 발행 시각 기준 내림차순(최신 → 과거)으로 정렬
    const items = scored
      .filter((s) => s.score >= NEWS_SCORE_THRESHOLD)
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    const payload = {
      category,
      items,
      totalCandidates: scored.length,
      fetchedAt: Math.floor(Date.now() / 1000),
    };
    NEWS_CACHE.set(category, { at: Date.now(), data: payload });
    res.set('Cache-Control', 'no-store');
    res.json(payload);
  } catch (e) {
    console.error(`[news] ${category} 조회 실패:`, e && e.message ? e.message : e);
    res.status(502).json({ error: String((e && e.message) || e) });
  }
});

// 개발 중 app.js/스타일이 자주 바뀌므로 브라우저가 옛 버전을 캐시해
// "탭이 안 눌리는 것처럼" 보이는 문제를 막기 위해 정적 파일은 캐시하지 않는다.
app.use(
  express.static(path.join(__dirname, 'public'), {
    etag: false,
    lastModified: false,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-store, must-revalidate');
    },
  })
);

app.listen(PORT, () => {
  console.log('──────────────────────────────────────────');
  console.log('  시장 동향 대시보드 실행 중');
  console.log(`  → http://localhost:${PORT}`);
  console.log('──────────────────────────────────────────');
});

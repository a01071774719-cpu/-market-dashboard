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

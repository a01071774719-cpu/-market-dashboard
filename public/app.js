'use strict';

/* ==========================================================================
 * 시장 동향 대시보드 - 프론트엔드 (섹션 구조)
 * 백엔드 프록시(/api/chart, /api/index, /api/kimchi, /api/goldkimchi)를 통해
 * Yahoo/업비트/바이낸스/네이버 데이터를 받아 렌더링한다.
 * ======================================================================== */

// ---- 섹션 / 항목 정의 ------------------------------------------------------
// type: 'quote'(캔들, /api/chart) | 'index'(캔들+출처, /api/index) | 'premium'
const SECTIONS = [
  {
    id: 'rates',
    title: '국채 금리',
    tabLabel: '채권',
    items: [
      { key: 'us10y', name: '미국 10년물 국채 금리', type: 'quote', unit: '%', digits: 3,
        spot: { symbol: '^TNX', label: '10년물 금리 (^TNX)' },
        fut: { symbol: '10Y=F', label: '10년물 금리 선물 (10Y=F)' } },
      { key: 'us2y', name: '미국 2년물 국채 금리', type: 'quote',
        symbol: '2YY=F', unit: '%', label: '2년물 금리 (2YY=F · 수익률 선물)', digits: 3 },
    ],
  },
  {
    id: 'indices',
    title: '지수',
    tabLabel: '지수',
    toggle: true, // 지수/선물 토글은 이 섹션에만 적용
    items: [
      { key: 'us500', name: 'US 500', type: 'index', unit: '', digits: 2,
        spot: { symbol: '^GSPC', label: 'S&P 500 (^GSPC)' },
        fut: { symbol: 'ES=F', label: 'S&P 500 선물 (ES=F)' } },
      { key: 'ustech100', name: 'US Tech 100', type: 'index', unit: '', digits: 2,
        spot: { symbol: '^NDX', label: '나스닥 100 (^NDX)' },
        fut: { symbol: 'NQ=F', label: '나스닥 100 선물 (NQ=F)' } },
      { key: 'kospi', name: '코스피', type: 'index', unit: '', digits: 2,
        spot: { symbol: '^KS11', label: '코스피 (^KS11)' },
        fut: { symbol: '^KS11', label: '코스피 (^KS11)' } },
    ],
  },
  {
    id: 'commodities',
    title: '원자재',
    tabLabel: '원자재',
    items: [
      { key: 'gold', name: '금', type: 'quote',
        symbol: 'GC=F', unit: '$', label: '금 선물 (GC=F, USD/oz)', digits: 2 },
      { key: 'silver', name: '은', type: 'quote',
        symbol: 'SI=F', unit: '$', label: '은 선물 (SI=F, USD/oz)', digits: 3 },
      { key: 'btc', name: '비트코인', type: 'quote',
        symbol: 'BTC-USD', unit: '$', label: '비트코인 (BTC-USD)', digits: 2 },
      { key: 'eth', name: '이더리움', type: 'quote',
        symbol: 'ETH-USD', unit: '$', label: '이더리움 (ETH-USD)', digits: 2 },
    ],
  },
  {
    id: 'premium',
    title: '프리미엄',
    tabLabel: '프리미엄',
    items: [
      { key: 'kimchi', name: '김치프리미엄', type: 'premium', kind: 'kimchi',
        endpoint: '/api/kimchi',
        link: 'https://upbit.com/exchange?code=CRIX.UPBIT.KRW-BTC' },
      { key: 'goldkimchi', name: '금치프리미엄', type: 'premium', kind: 'goldkimchi',
        endpoint: '/api/goldkimchi',
        link: 'https://finance.naver.com/marketindex/goldDetail.naver' },
    ],
  },
];

const ALL_ITEMS = SECTIONS.flatMap((s) => s.items);

// ---- 기간 → interval 매핑 --------------------------------------------------
const RANGE_INTERVAL = {
  '1d': { interval: '5m', intraday: true },
  '5d': { interval: '30m', intraday: true },
  '1mo': { interval: '60m', intraday: true },
  '6mo': { interval: '1d', intraday: false },
  '1y': { interval: '1d', intraday: false },
};

const REFRESH_MS = 20000; // 20초 폴링
const LIVE_THRESHOLD_S = 90; // 데이터가 90초 이내면 "실시간"으로 간주

// mode: 'auto'(지연 시 선물 자동전환) | 'spot'(지수 고정) | 'fut'(선물 고정)
const state = { mode: 'auto', range: '1d', tab: 'indices' }; // 기본 탭: 지수, 기본 모드: 자동
const cards = {}; // key -> { item, el, chart, series, refs, trend? }

// ---- 유틸 ------------------------------------------------------------------
function fmtNumber(v, digits) {
  if (v == null || !isFinite(v)) return '—';
  return v.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
function agoText(seconds) {
  if (seconds < 60) return `${seconds}초 전`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}
function nowSec() {
  return Math.floor(Date.now() / 1000);
}
function unitPrefix(unit) {
  return unit === '$' ? '$' : '';
}
function unitSuffix(unit) {
  if (unit === '%') return '%';
  if (unit === '₩') return '원';
  if (unit === '¥') return '엔';
  return '';
}
// spot/fut 두 심볼이 있고 서로 다른 카드만 자동전환 대상. (코스피처럼 spot==fut 이거나
// 원자재처럼 심볼이 하나뿐이면 고정 카드로 취급)
function isPaired(item) {
  return !!(item.spot && item.fut && item.fut.symbol !== item.spot.symbol);
}
// leg('spot'|'fut') 에 해당하는 심볼/라벨. 고정 카드는 leg 무시.
function legConf(item, leg) {
  if (item.spot) {
    const c = (leg === 'fut' ? item.fut : item.spot) || item.spot;
    return { symbol: c.symbol, label: c.label, unit: item.unit, digits: item.digits };
  }
  return { symbol: item.symbol, label: item.label, unit: item.unit, digits: item.digits };
}

// ---- 차트 헬퍼 -------------------------------------------------------------
function makeChart(container) {
  return LightweightCharts.createChart(container, {
    autoSize: true,
    layout: {
      background: { type: 'solid', color: 'transparent' },
      textColor: '#8ba396',
      fontSize: 10,
    },
    grid: {
      vertLines: { color: 'rgba(34,48,41,0.4)' },
      horzLines: { color: 'rgba(34,48,41,0.4)' },
    },
    rightPriceScale: { borderColor: '#223029' },
    timeScale: { borderColor: '#223029', timeVisible: true, secondsVisible: false },
    crosshair: { mode: 0 },
    handleScroll: false,
    handleScale: false,
  });
}
function collectRefs(el) {
  const refs = {};
  el.querySelectorAll('[data-ref]').forEach((n) => {
    refs[n.getAttribute('data-ref')] = n;
  });
  return refs;
}
function renderFigures(rows) {
  return rows
    .map(
      ([k, v]) =>
        `<div class="fig"><span class="fk">${k}</span><span class="fv">${v}</span></div>`
    )
    .join('');
}

// ---- 섹션/카드 생성 --------------------------------------------------------
// 상단 탭 네비게이션 (한 번에 한 섹션만 표시)
function buildTabBar() {
  const bar = document.getElementById('tabbar');
  bar.innerHTML = '';
  for (const section of SECTIONS) {
    const btn = document.createElement('button');
    btn.dataset.tab = section.id;
    btn.textContent = section.tabLabel || section.title;
    btn.className = section.id === state.tab ? 'active' : '';
    bar.appendChild(btn);
  }
}

// 활성 탭의 섹션만 보이게 한다. (폴링은 전체 카드가 계속 갱신됨)
function showTab(tabId) {
  state.tab = tabId;
  document.querySelectorAll('#tabbar button').forEach((b) =>
    b.classList.toggle('active', b.dataset.tab === tabId)
  );
  document.querySelectorAll('.market-section').forEach((sec) => {
    sec.hidden = sec.dataset.section !== tabId;
  });
  // 숨겨졌다 보이는 순간 차트가 0px 로 잡혀 있을 수 있으니 다시 맞춘다.
  const shown = SECTIONS.find((s) => s.id === tabId);
  if (shown) {
    for (const item of shown.items) {
      const card = cards[item.key];
      if (card && card.chart) {
        try {
          card.chart.timeScale().fitContent();
        } catch (_) {}
      }
    }
  }
}

function buildSections() {
  const root = document.getElementById('sections');
  root.innerHTML = '';

  for (const section of SECTIONS) {
    const sec = document.createElement('section');
    sec.className = 'market-section';
    sec.dataset.section = section.id;
    sec.hidden = section.id !== state.tab; // 활성 탭만 표시

    const head = document.createElement('div');
    head.className = 'section-head';
    head.innerHTML = `<h2>${section.title}</h2>`;
    // 지수 섹션에만 지수/선물 토글을 붙인다.
    if (section.toggle) {
      const toggle = document.createElement('div');
      toggle.className = 'toggle';
      toggle.id = 'modeToggle';
      toggle.setAttribute('role', 'group');
      toggle.setAttribute('aria-label', '지수/선물 자동전환 모드');
      toggle.innerHTML =
        '<button data-mode="auto" class="active">자동</button>' +
        '<button data-mode="spot">지수 고정</button>' +
        '<button data-mode="fut">선물 고정</button>';
      head.appendChild(toggle);
    }
    sec.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'grid';
    sec.appendChild(grid);
    root.appendChild(sec);

    for (const item of section.items) {
      if (item.type === 'premium') buildPremiumCard(grid, item);
      else buildCandleCard(grid, item);
    }
  }
}

// 캔들 카드 (국채/지수/원자재). index 는 출처 배지를 함께 표시.
function buildCandleCard(grid, item) {
  const el = document.createElement('section');
  el.className = 'card';
  el.innerHTML = `
    <div class="card-head">
      <div>
        <div class="card-name">${item.name}</div>
        <div class="card-sub" data-ref="sub"></div>
      </div>
      <div class="badges">
        <span class="auto-badge" data-ref="autobadge" hidden></span>
        <span class="source-badge" data-ref="source" hidden></span>
        <span class="freshness" data-ref="fresh"><span class="dot"></span><span data-ref="freshtext">연결 중…</span></span>
      </div>
    </div>
    <div class="price-row">
      <div class="price" data-ref="price">—</div>
      <div class="change" data-ref="change"></div>
    </div>
    <div class="chart" data-ref="chart"></div>
    <div class="card-hint">클릭하면 Yahoo Finance에서 자세히 보기 ↗</div>
    <div class="card-foot">
      <span data-ref="range"></span>
      <span data-ref="updated"></span>
    </div>
  `;
  grid.appendChild(el);
  const refs = collectRefs(el);

  // 클릭 → 현재 표시 중인 심볼의 Yahoo Finance 페이지 (차트 조작 시 제외)
  el.addEventListener('click', (e) => {
    if (e.target.closest('.chart')) return;
    const sym = cards[item.key].displaySymbol;
    window.open(`https://finance.yahoo.com/quote/${encodeURIComponent(sym)}`, '_blank', 'noopener');
  });

  const chart = makeChart(refs.chart);
  const series = chart.addCandlestickSeries({
    upColor: '#2ebd85',
    downColor: '#f6465c',
    borderUpColor: '#2ebd85',
    borderDownColor: '#f6465c',
    wickUpColor: '#2ebd85',
    wickDownColor: '#f6465c',
    priceLineVisible: false,
    lastValueVisible: false,
  });

  cards[item.key] = {
    item, el, chart, series, refs,
    displaySymbol: legConf(item, 'spot').symbol, // 클릭 링크용 (갱신 시 갱신됨)
  };
}

// 프리미엄 카드 (큰 % + 핵심 수치 + 인메모리 추이 라인)
function buildPremiumCard(grid, item) {
  const el = document.createElement('section');
  el.className = 'card premium';
  const hint =
    item.kind === 'kimchi'
      ? '클릭하면 업비트 BTC 시세 보기 ↗'
      : '클릭하면 네이버 금 시세 보기 ↗';
  el.innerHTML = `
    <div class="card-head">
      <div>
        <div class="card-name">${item.name}</div>
        <div class="card-sub" data-ref="sub"></div>
      </div>
      <span class="freshness" data-ref="fresh"><span class="dot"></span><span data-ref="freshtext">연결 중…</span></span>
    </div>
    <div class="price-row">
      <div class="price" data-ref="price">—</div>
    </div>
    <div class="premium-figures" data-ref="figures"></div>
    <div class="chart" data-ref="chart"></div>
    <div class="card-hint">${hint}</div>
    <div class="card-foot">
      <span data-ref="range"></span>
      <span data-ref="updated"></span>
    </div>
  `;
  grid.appendChild(el);
  const refs = collectRefs(el);

  el.addEventListener('click', (e) => {
    if (e.target.closest('.chart')) return;
    window.open(item.link, '_blank', 'noopener');
  });

  const chart = makeChart(refs.chart);
  const series = chart.addLineSeries({
    color: '#2ebd85',
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: false,
  });

  cards[item.key] = { item, el, chart, series, refs, trend: [] };
}

// 한 leg('spot'|'fut')의 데이터를 가져온다.
async function fetchLeg(item, leg) {
  const conf = legConf(item, leg);
  const { interval } = RANGE_INTERVAL[state.range];
  const base = item.type === 'index' ? '/api/index' : '/api/chart';
  const url = `${base}?symbol=${encodeURIComponent(conf.symbol)}&range=${state.range}&interval=${interval}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return { data, conf };
}

// ---- 캔들 카드 갱신 (지연 자동 감지 → 선물 자동전환 포함) -------------------
async function updateCandle(key) {
  const card = cards[key];
  const item = card.item;
  const { intraday } = RANGE_INTERVAL[state.range];

  try {
    let data, conf, leg, autoSwitched = false;

    if (!isPaired(item)) {
      // 고정 카드(원자재·2년물·코스피): 항상 단일 심볼
      ({ data, conf } = await fetchLeg(item, 'spot'));
      leg = 'spot';
    } else if (state.mode === 'spot') {
      ({ data, conf } = await fetchLeg(item, 'spot')); // 지수 고정
      leg = 'spot';
    } else if (state.mode === 'fut') {
      ({ data, conf } = await fetchLeg(item, 'fut')); // 선물 고정
      leg = 'fut';
    } else {
      // 자동: 먼저 spot 을 보고, 지연이면 fut 으로 다시 가져와 표시
      const spot = await fetchLeg(item, 'spot');
      const spotAge = spot.data.marketTime ? nowSec() - spot.data.marketTime : null;
      const spotDelayed = spotAge == null || spotAge > LIVE_THRESHOLD_S;
      if (spotDelayed) {
        const fut = await fetchLeg(item, 'fut');
        ({ data, conf } = fut);
        leg = 'fut';
        autoSwitched = true;
      } else {
        ({ data, conf } = spot);
        leg = 'spot';
      }
    }

    card.displaySymbol = conf.symbol;

    // --- 자동전환 배지 ---
    if (autoSwitched) {
      card.refs.autobadge.hidden = false;
      card.refs.autobadge.textContent = '🔁 선물 자동전환';
    } else {
      card.refs.autobadge.hidden = true;
    }

    // --- 출처 배지 (index 전용) ---
    if (item.type === 'index') {
      const src = data.source === 'investing' ? '인베스팅' : '야후';
      card.refs.source.hidden = false;
      card.refs.source.textContent = src;
      card.refs.source.className = `source-badge ${data.source === 'investing' ? 'inv' : 'yh'}`;
    }

    // --- 가격 / 등락 ---
    const price = data.price;
    const prev = data.previousClose;
    const diff = price != null && prev != null ? price - prev : null;
    const pct = diff != null && prev ? (diff / prev) * 100 : null;
    const unit = conf.unit;

    card.refs.price.textContent =
      unitPrefix(unit) + fmtNumber(price, conf.digits) + unitSuffix(unit);
    card.refs.sub.textContent = conf.label;

    const dir = diff == null ? 'flat' : diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
    const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '—';
    card.refs.change.className = `change ${dir}`;
    if (diff == null) {
      card.refs.change.textContent = '';
    } else {
      const sign = diff > 0 ? '+' : '';
      const diffSuffix = unit === '%' ? '%p' : unitSuffix(unit);
      card.refs.change.innerHTML =
        `<span class="arrow">${arrow}</span>` +
        `${sign}${fmtNumber(diff, conf.digits)}${diffSuffix} ` +
        `(${sign}${fmtNumber(pct, 2)}%)`;
    }

    // --- 캔들 차트 ---
    if (Array.isArray(data.series) && data.series.length) {
      const seen = new Set();
      const points = [];
      for (const p of data.series) {
        if (seen.has(p.time)) continue;
        seen.add(p.time);
        points.push({ time: p.time, open: p.open, high: p.high, low: p.low, close: p.close });
      }
      card.series.setData(points);
      card.chart.timeScale().applyOptions({ timeVisible: intraday });
      card.chart.timeScale().fitContent();
    }

    // --- 신선도 ---
    setFresh(card, data.marketTime ? nowSec() - data.marketTime : null);
    card.refs.updated.textContent = `갱신 ${new Date().toLocaleTimeString('ko-KR')}`;
    card.refs.range.textContent = `기간 ${labelForRange(state.range)}`;
  } catch (err) {
    card.refs.fresh.className = 'freshness error';
    card.refs.freshtext.textContent = '오류';
    card.refs.updated.textContent = String(err.message || err).slice(0, 40);
  }
}

function setFresh(card, age) {
  const fresh = card.refs.fresh;
  const txt = card.refs.freshtext;
  if (age == null) {
    fresh.className = 'freshness delayed';
    txt.textContent = '시각 정보 없음';
  } else if (age <= LIVE_THRESHOLD_S) {
    fresh.className = 'freshness live';
    txt.textContent = `실시간 · ${agoText(age)}`;
  } else {
    fresh.className = 'freshness delayed';
    txt.textContent = `지연 · ${agoText(age)}`;
  }
}

function labelForRange(r) {
  return { '1d': '1일', '5d': '5일', '1mo': '1개월', '6mo': '6개월', '1y': '1년' }[r] || r;
}

// ---- 프리미엄 카드 갱신 ----------------------------------------------------
async function updatePremium(key) {
  const card = cards[key];
  const item = card.item;
  try {
    const res = await fetch(item.endpoint);
    const d = await res.json();

    // 국내 소스 실패(금치) 또는 오류 → 미연동 표시
    if (!res.ok || d.available === false) {
      if (item.kind === 'goldkimchi' && d && d.intlPerGram) {
        card.refs.price.className = 'price flat';
        card.refs.price.textContent = '연동 실패';
        card.refs.sub.textContent = '국내 금 시세(네이버) 연동 실패';
        card.refs.figures.innerHTML = renderFigures([
          ['국내 금', '— (실패)'],
          ['국제 금 환산(참고)', fmtNumber(d.intlPerGram, 0) + '원/g'],
          ['적용 환율', fmtNumber(d.krw, 2) + '원'],
        ]);
        card.refs.fresh.className = 'freshness error';
        card.refs.freshtext.textContent = '국내 연동 실패';
        card.refs.updated.textContent = String(d.domesticError || '').slice(0, 40);
        card.refs.range.textContent = '국제 참고값만';
        return;
      }
      throw new Error((d && d.error) || `HTTP ${res.status}`);
    }

    const prem = d.premium;
    const dir = prem > 0 ? 'up' : prem < 0 ? 'down' : 'flat';
    const sign = prem > 0 ? '+' : '';
    card.refs.price.className = `price ${dir}`;
    card.refs.price.textContent = `${sign}${fmtNumber(prem, 2)}%`;

    if (item.kind === 'kimchi') {
      card.refs.sub.textContent =
        prem >= 0 ? '국내(업비트)가 더 비쌈' : '국내(업비트)가 더 쌈 (역프)';
      card.refs.figures.innerHTML = renderFigures([
        ['업비트 BTC', fmtNumber(d.upbitKrw, 0) + '원'],
        ['바이낸스 환산', fmtNumber(d.binanceKrwEquiv, 0) + '원'],
        ['적용 환율', fmtNumber(d.krw, 2) + '원'],
      ]);
    } else {
      card.refs.sub.textContent =
        prem >= 0 ? '국내 금이 더 비쌈 (네이버 매매기준율)' : '국내 금이 더 쌈 (네이버 매매기준율)';
      const domDate = String(d.domesticTradedAt || '').slice(0, 10) || '—';
      const krwDate = d.krwTradedAt ? String(d.krwTradedAt).slice(0, 10) : '실시간';
      card.refs.figures.innerHTML = renderFigures([
        ['국내 금', `${fmtNumber(d.domesticPerGram, 0)}원/g · ${domDate}`],
        ['국제 금 환산', `${fmtNumber(d.intlPerGram, 0)}원/g`],
        ['적용 환율', `${fmtNumber(d.krw, 2)}원 · ${d.krwSource || ''}`],
        ['국제금 시세', `$${fmtNumber(d.gcUsd, 2)}/oz · 환율기준 ${krwDate}`],
      ]);
    }

    // 추이 라인 (인메모리 누적)
    const t = nowSec();
    const last = card.trend[card.trend.length - 1];
    if (!last || last.time < t) {
      card.trend.push({ time: t, value: Number(prem.toFixed(4)) });
      if (card.trend.length > 720) card.trend.shift();
      card.series.setData(card.trend);
      card.series.applyOptions({ color: dir === 'down' ? '#f6465c' : '#2ebd85' });
      card.chart.timeScale().fitContent();
    }

    card.refs.fresh.className = 'freshness live';
    card.refs.freshtext.textContent = '실시간 · 방금';
    card.refs.updated.textContent = `갱신 ${new Date().toLocaleTimeString('ko-KR')}`;
    card.refs.range.textContent =
      item.kind === 'goldkimchi' && d.domesticTradedAt
        ? `국내 기준일 ${String(d.domesticTradedAt).slice(0, 10)}`
        : '실시간 계산 · 추이 누적';
  } catch (err) {
    card.refs.fresh.className = 'freshness error';
    card.refs.freshtext.textContent = '오류';
    card.refs.updated.textContent = String(err.message || err).slice(0, 40);
  }
}

// ---- 전체 갱신 -------------------------------------------------------------
let polling = false;
async function refreshAll(force) {
  if (polling && !force) return;
  polling = true;
  const status = document.getElementById('pollStatus');
  status.textContent = '갱신 중…';
  await Promise.all(
    ALL_ITEMS.map((it) =>
      it.type === 'premium' ? updatePremium(it.key) : updateCandle(it.key)
    )
  );
  status.textContent = `마지막 갱신 ${new Date().toLocaleTimeString('ko-KR')}`;
  polling = false;
}

// ---- 시계 -----------------------------------------------------------------
function tickClock() {
  document.getElementById('clock').textContent = new Date().toLocaleTimeString('ko-KR');
}

// ---- 이벤트 바인딩 ---------------------------------------------------------
function bindControls() {
  // 탭 네비게이션
  document.getElementById('tabbar').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tab]');
    if (!btn) return;
    showTab(btn.dataset.tab);
  });

  // 기간 버튼 (전역)
  document.getElementById('rangeBar').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-range]');
    if (!btn) return;
    state.range = btn.dataset.range;
    document.querySelectorAll('#rangeBar button').forEach((b) =>
      b.classList.toggle('active', b === btn)
    );
    refreshAll(true);
  });

  // 지수/선물 토글 (섹션 2 헤더에 생성됨)
  const modeToggle = document.getElementById('modeToggle');
  if (modeToggle) {
    modeToggle.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-mode]');
      if (!btn) return;
      state.mode = btn.dataset.mode;
      modeToggle.querySelectorAll('button').forEach((b) =>
        b.classList.toggle('active', b === btn)
      );
      refreshAll(true);
    });
  }
}

// ---- 시작 ------------------------------------------------------------------
document.getElementById('refreshSec').textContent = String(REFRESH_MS / 1000);
buildTabBar();
buildSections();
bindControls();
tickClock();
setInterval(tickClock, 1000);
refreshAll();
setInterval(refreshAll, REFRESH_MS);

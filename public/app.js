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
    newsCategory: 'bonds', // 카드 아래 "관련 뉴스" 섹션에 쓸 /api/news category
    bondYieldCurve: true, // 2년물 카드 옆에 수익률 곡선 그래프를 붙인다
    items: [
      { key: 'us30y', name: '미국 30년물 국채 금리', type: 'quote',
        symbol: '^TYX', unit: '%', label: '30년물 국채 수익률 (^TYX)', digits: 3,
        externalUrl: 'https://kr.tradingview.com/symbols/TVC-US30Y/' },
      { key: 'us10y', name: '미국 10년물 국채 금리', type: 'quote',
        symbol: '^TNX', unit: '%', label: '10년물 국채 수익률 (^TNX)', digits: 3,
        externalUrl: 'https://kr.tradingview.com/symbols/TVC-US10Y/' },
      { key: 'us2y', name: '미국 2년물 국채 금리', type: 'quote',
        symbol: 'US2Y=TREASURY', unit: '%', label: '2년물 금리 (미국 재무부 공식 일일 수익률)', digits: 2,
        externalUrl: 'https://kr.tradingview.com/symbols/TVC-US02Y/' },
    ],
  },
  {
    id: 'fx',
    title: '환율',
    tabLabel: '환율',
    newsCategory: 'fx',
    items: [
      { key: 'dxy', name: '달러인덱스', type: 'quote',
        symbol: 'DX-Y.NYB', unit: '', label: '달러인덱스 (DX-Y.NYB)', digits: 2,
        externalUrl: 'https://kr.tradingview.com/symbols/TVC-DXY/' },
      { key: 'usdkrw', name: '원/달러 환율', type: 'fx-krw',
        symbol: 'KRW=X', unit: '₩', label: 'USD/KRW (KRW=X)', digits: 2,
        externalUrl: 'https://kr.tradingview.com/symbols/FX_IDC-USDKRW/' },
      { key: 'usdjpy', name: '엔/달러 환율', type: 'quote',
        symbol: 'JPY=X', unit: '¥', label: 'USD/JPY (JPY=X)', digits: 2,
        externalUrl: 'https://kr.tradingview.com/symbols/FX-USDJPY/' },
      { key: 'krwjpy', name: '원/엔 환율', type: 'quote', scale: 100,
        symbol: 'JPYKRW=X', unit: '₩', label: '100엔당 원화 (JPYKRW=X×100)', digits: 2,
        externalUrl: 'https://kr.tradingview.com/symbols/FX_IDC-JPYKRW/' },
    ],
  },
  {
    id: 'indices',
    title: '지수',
    tabLabel: '지수',
    newsCategory: 'indices',
    toggle: true, // 지수/선물 토글은 이 섹션에만 적용
    items: [
      { key: 'us500', name: 'US 500', type: 'index', unit: '', digits: 2,
        spot: { symbol: '^GSPC', label: 'S&P 500 (^GSPC)' },
        fut: { symbol: 'ES=F', label: 'S&P 500 선물 (ES=F)' },
        externalUrl: 'https://kr.tradingview.com/symbols/TVC-SPX/' },
      { key: 'ustech100', name: 'US Tech 100', type: 'index', unit: '', digits: 2,
        spot: { symbol: '^NDX', label: '나스닥 100 (^NDX)' },
        fut: { symbol: 'NQ=F', label: '나스닥 100 선물 (NQ=F)' },
        externalUrl: 'https://kr.tradingview.com/symbols/TVC-NDX/' },
      { key: 'kospi', name: '코스피', type: 'index', unit: '', digits: 2,
        spot: { symbol: '^KS11', label: '코스피 (^KS11)' },
        fut: { symbol: '^KS11', label: '코스피 (^KS11)' },
        externalUrl: 'https://kr.tradingview.com/symbols/KRX-KOSPI/' },
    ],
  },
  {
    id: 'commodities',
    title: '원자재',
    tabLabel: '원자재',
    newsCategory: 'commodities',
    items: [
      { key: 'gold', name: '금', type: 'quote',
        symbol: 'GC=F', unit: '$', label: '금 선물 (GC=F, USD/oz)', digits: 2,
        externalUrl: 'https://kr.tradingview.com/symbols/TVC-GOLD/' },
      { key: 'silver', name: '은', type: 'quote',
        symbol: 'SI=F', unit: '$', label: '은 선물 (SI=F, USD/oz)', digits: 3,
        externalUrl: 'https://kr.tradingview.com/symbols/TVC-SILVER/' },
      { key: 'wti', name: '원유 (WTI)', type: 'quote',
        symbol: 'CL=F', unit: '$', label: 'WTI 원유 선물 (CL=F, USD/배럴)', digits: 2,
        externalUrl: 'https://kr.tradingview.com/symbols/TVC-USOIL/' },
      { key: 'btc', name: '비트코인', type: 'quote',
        symbol: 'BTC-USD', unit: '$', label: '비트코인 (BTC-USD)', digits: 2,
        externalUrl: 'https://kr.tradingview.com/symbols/BITSTAMP-BTCUSD/' },
      { key: 'eth', name: '이더리움', type: 'quote',
        symbol: 'ETH-USD', unit: '$', label: '이더리움 (ETH-USD)', digits: 2,
        externalUrl: 'https://kr.tradingview.com/symbols/BITSTAMP-ETHUSD/' },
    ],
  },
  {
    id: 'premium',
    title: '프리미엄',
    tabLabel: '프리미엄',
    newsCategory: 'premium',
    items: [
      { key: 'kimchi', name: '김치프리미엄', type: 'premium', kind: 'kimchi',
        endpoint: '/api/kimchi',
        link: 'https://upbit.com/exchange?code=CRIX.UPBIT.KRW-BTC' },
      { key: 'goldkimchi', name: '금치프리미엄', type: 'premium', kind: 'goldkimchi',
        endpoint: '/api/goldkimchi',
        link: 'https://finance.naver.com/marketindex/goldDetail.naver' },
    ],
  },
  {
    id: 'feargreed',
    title: '공포탐욕지수',
    tabLabel: '공포탐욕지수',
    custom: 'feargreed', // 일반 카드 그리드가 아닌 전용 레이아웃
    items: [],
  },
  {
    id: 'easyinvesting',
    title: '이지인베스팅',
    tabLabel: '이지인베스팅',
    custom: 'linkout', // 데이터 카드 없이 외부 앱으로 연결하는 탭
    externalUrl: 'https://easyinvesting.app',
    items: [],
  },
];

// 뉴스: 독립 탭이 아니라 각 섹션(section.newsCategory) 카드 아래에 붙는다.
// /api/news 는 이제 개수를 자르지 않고 중요도 임계값을 넘는 것만 돌려주므로
// 프론트에서도 받은 만큼 전부 그린다(추가 slice 없음).
const NEWS_CATEGORY_KEYS = SECTIONS.filter((s) => s.newsCategory).map((s) => s.newsCategory);
const NEWS_REFRESH_MS = 5 * 60 * 1000; // 5분 (시세보다 느긋하게)

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
const state = { mode: 'auto', range: '1d', tab: 'indices', view: 'cards' }; // 기본 탭: 지수, 기본 모드: 자동, 기본 뷰: 시세
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
    return { symbol: c.symbol, label: c.label, unit: item.unit, digits: item.digits, scale: item.scale || 1 };
  }
  return { symbol: item.symbol, label: item.label, unit: item.unit, digits: item.digits, scale: item.scale || 1 };
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
  syncViewControls();
  // 숨겨졌다 보이는 순간 차트가 0px 로 잡혀 있을 수 있으니 다시 맞춘다.
  if (tabId === 'feargreed' && fg.chart) {
    try {
      fg.chart.timeScale().fitContent();
    } catch (_) {}
  }
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

// 현재 탭에 뉴스가 있는지에 따라 "시세/뉴스" 토글과 기간 버튼의 노출을 맞춘다.
function syncViewControls() {
  const activeSection = SECTIONS.find((s) => s.id === state.tab);
  const hasNews = !!(activeSection && activeSection.newsCategory);
  const viewToggle = document.getElementById('viewToggle');
  const rangeGroup = document.getElementById('rangeButtonsGroup');
  if (viewToggle) viewToggle.hidden = !hasNews;
  // 뉴스 보기 중엔 "차트 기간"이 의미가 없으니 숨긴다.
  if (rangeGroup) rangeGroup.hidden = hasNews && state.view === 'news';
  applyViewMode();
}

// state.view('cards'|'news')에 따라 각 섹션의 카드 그리드(+채권 탭의 수익률 곡선 행) / 관련 뉴스 블록을 전환한다.
function applyViewMode() {
  document.querySelectorAll('.market-section').forEach((sec) => {
    const cardContainers = sec.querySelectorAll(':scope > .grid, :scope > .bond-yield-row');
    const newsBlock = sec.querySelector(':scope > .news-block');
    if (!cardContainers.length && !newsBlock) return; // 공포탐욕지수/이지인베스팅 같은 전용 레이아웃은 대상 아님
    const showNews = state.view === 'news';
    cardContainers.forEach((c) => { c.hidden = showNews; });
    if (newsBlock) newsBlock.hidden = !showNews;
  });
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
    root.appendChild(sec);

    if (section.custom === 'feargreed') {
      buildFearGreedPanel(sec);
      continue;
    }
    if (section.custom === 'linkout') {
      buildLinkoutPanel(sec, section);
      continue;
    }

    const grid = document.createElement('div');
    grid.className = 'grid';
    sec.appendChild(grid);

    // 채권 탭: 2년물 카드는 메인 그리드가 아니라 수익률 곡선 그래프와 나란히 놓는다.
    const sideKey = section.bondYieldCurve ? 'us2y' : null;
    for (const item of section.items) {
      if (item.key === sideKey) continue;
      if (item.type === 'premium') buildPremiumCard(grid, item);
      else buildCandleCard(grid, item);
    }
    if (sideKey) {
      const row = document.createElement('div');
      row.className = 'bond-yield-row';
      sec.appendChild(row);
      const sideItem = section.items.find((it) => it.key === sideKey);
      if (sideItem) buildCandleCard(row, sideItem);
      buildYieldCurvePanel(row);
    }

    // 카드들 아래에 이 섹션 주제의 "관련 뉴스" 블록을 붙인다.
    if (section.newsCategory) {
      buildSectionNewsBlock(sec, section.newsCategory);
    }
  }
}

// 국채/환율/지수/원자재 카드. 미니 차트 대신 가격·등락을 크게 보여주고
// 클릭하면 트레이딩뷰(또는 지정된 externalUrl)로 새 탭 연결.
function buildCandleCard(grid, item) {
  const el = document.createElement('section');
  el.className = 'card card-nochart';
  el.innerHTML = `
    <div class="card-head">
      <div>
        <div class="card-name">${item.name}</div>
        <div class="card-sub" data-ref="sub"></div>
      </div>
      <div class="badges">
        <span class="auto-badge" data-ref="autobadge" hidden></span>
        <span class="source-badge" data-ref="source" hidden></span>
      </div>
    </div>
    <div class="price-row-lg">
      <div class="price price-lg" data-ref="price">—</div>
      <div class="change change-lg" data-ref="change"></div>
    </div>
    <div class="card-status-row">
      <span class="freshness" data-ref="fresh"><span class="dot"></span><span data-ref="freshtext">연결 중…</span></span>
      <span class="updated-text" data-ref="updated"></span>
    </div>
    <div class="card-hint">${item.externalUrl ? '클릭하면 트레이딩뷰에서 자세히 보기 ↗' : '클릭하면 Yahoo Finance에서 자세히 보기 ↗'}</div>
  `;
  grid.appendChild(el);
  const refs = collectRefs(el);

  // 클릭 → item.externalUrl(트레이딩뷰 등)이 있으면 그 페이지로, 없으면 현재 표시 중인 심볼의 Yahoo Finance 페이지로
  el.addEventListener('click', () => {
    if (item.externalUrl) {
      window.open(item.externalUrl, '_blank', 'noopener');
      return;
    }
    const sym = cards[item.key].displaySymbol;
    window.open(`https://finance.yahoo.com/quote/${encodeURIComponent(sym)}`, '_blank', 'noopener');
  });

  cards[item.key] = {
    item, el, refs,
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

// ---- 공포탐욕지수(CNN Fear & Greed) 전용 패널 -------------------------------
const FEARGREED_REFRESH_MS = 60000; // 1분 간격 (다른 카드보다 느긋하게)
const fg = { refs: {}, chart: null, series: null }; // 패널 상태(참조) 보관

// 점수(0~100) → 색상 / 한국어 등급. 5구간 색상표는 게이지·배지 공통 사용.
function fgColor(score) {
  if (score == null) return '#8ba396';
  if (score < 25) return '#8b1a1a'; // 진한 빨강 - 극단적 공포
  if (score < 45) return '#f6465c'; // 빨강 - 공포
  if (score < 55) return '#f0b429'; // 노랑/회색 - 중립
  if (score < 75) return '#2ebd85'; // 초록 - 탐욕
  return '#1f8f5f'; // 진한 초록 - 극단적 탐욕
}
function fgLabel(score) {
  if (score == null) return '—';
  if (score < 25) return '극단적 공포';
  if (score < 45) return '공포';
  if (score < 55) return '중립';
  if (score < 75) return '탐욕';
  return '극단적 탐욕';
}
const FG_RATING_KO = {
  'extreme fear': '극단적 공포',
  fear: '공포',
  neutral: '중립',
  greed: '탐욕',
  'extreme greed': '극단적 탐욕',
};
function fgRatingKo(r) {
  return FG_RATING_KO[String(r || '').toLowerCase()] || r || '—';
}

// 반원형 게이지의 점수 → 각도(도, 0=오른쪽·180=왼쪽 기준 표준 수학각) 변환
function fgTheta(score) {
  const s = Math.max(0, Math.min(100, score == null ? 50 : score));
  return 180 * (1 - s / 100);
}
function fgPoint(cx, cy, r, thetaDeg) {
  const rad = (thetaDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
}
function fgArcPath(cx, cy, r, thetaStart, thetaEnd) {
  const p1 = fgPoint(cx, cy, r, thetaStart);
  const p2 = fgPoint(cx, cy, r, thetaEnd);
  return `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${r} ${r} 0 0 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
}

function buildFearGreedPanel(sec) {
  const GCX = 150, GCY = 150, GR = 110; // 게이지 중심/반지름
  const bands = [
    [0, 25, '#8b1a1a'],
    [25, 45, '#f6465c'],
    [45, 55, '#f0b429'],
    [55, 75, '#2ebd85'],
    [75, 100, '#1f8f5f'],
  ];
  const arcPaths = bands
    .map(
      ([a, b, color]) =>
        `<path d="${fgArcPath(GCX, GCY, GR, fgTheta(a), fgTheta(b))}" stroke="${color}" stroke-width="26" fill="none" stroke-linecap="butt" />`
    )
    .join('');

  const wrap = document.createElement('div');
  wrap.className = 'fg-panel';
  wrap.innerHTML = `
    <div class="fg-error" data-ref="fgError" hidden>⚠️ 일시적으로 데이터를 가져올 수 없음 (CNN 비공식 데이터 소스)</div>

    <div class="fg-top">
      <div class="card fg-gauge-card">
        <div class="fg-gauge-wrap">
          <svg viewBox="0 0 300 165" class="fg-gauge-svg">
            ${arcPaths}
            <line data-ref="fgNeedle" x1="${GCX}" y1="${GCY}" x2="${GCX}" y2="${GCY - 90}"
              stroke="#e6efe9" stroke-width="4" stroke-linecap="round" />
            <circle cx="${GCX}" cy="${GCY}" r="7" fill="#e6efe9" />
          </svg>
          <div class="fg-gauge-score" data-ref="fgScore">--</div>
          <div class="fg-gauge-rating" data-ref="fgRating">불러오는 중…</div>
        </div>
        <div class="card-foot">
          <span data-ref="fgUpdated"></span>
          <span class="fg-source">출처: CNN Business (비공식 데이터, 참고용)</span>
        </div>
      </div>

      <div class="card fg-chart-card">
        <div class="card-name">지난 1년 추이</div>
        <div class="chart fg-history-chart" data-ref="fgChart"></div>
      </div>
    </div>

    <div class="fg-featured-grid">
      <div class="card fg-featured" data-ref="fgVixCard">
        <div class="card-name">시장 변동성 (VIX)</div>
        <div class="fg-featured-value" data-ref="fgVixValue">--</div>
        <div class="fg-featured-badge" data-ref="fgVixBadge">--</div>
        <div class="fg-featured-sub" data-ref="fgVixSub"></div>
        <div class="card-hint">클릭하면 Yahoo Finance에서 자세히 보기 ↗</div>
      </div>
      <div class="card fg-featured" data-ref="fgPutCallCard">
        <div class="card-name">풋/콜 옵션 비율</div>
        <div class="fg-featured-value" data-ref="fgPutCallValue">--</div>
        <div class="fg-featured-badge" data-ref="fgPutCallBadge">--</div>
        <div class="fg-featured-sub" data-ref="fgPutCallSub"></div>
        <div class="card-hint">클릭하면 매크로마이크로에서 자세히 보기 ↗</div>
      </div>
    </div>

    <div class="fg-small-grid" data-ref="fgSmallGrid"></div>
  `;
  sec.appendChild(wrap);

  fg.refs = collectRefs(wrap);

  // 메인 게이지 카드는 클릭 연결 없음(정보 표시 전용).
  // VIX → 야후 파이낸스 ^VIX 페이지, 풋/콜 → 매크로마이크로 풋/콜 비율 차트 페이지로 연결.
  fg.refs.fgVixCard.addEventListener('click', () => {
    window.open('https://finance.yahoo.com/quote/%5EVIX', '_blank', 'noopener');
  });
  fg.refs.fgPutCallCard.addEventListener('click', () => {
    window.open('https://en.macromicro.me/charts/449/us-cboe-options-put-call-ratio', '_blank', 'noopener');
  });

  fg.chart = makeChart(fg.refs.fgChart);
  fg.chart.timeScale().applyOptions({ timeVisible: false });
  fg.series = fg.chart.addLineSeries({
    color: '#2ebd85',
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: false,
  });

  // 작은 하위 지표 5개 카드 틀을 미리 만들어 둔다.
  const smallDefs = [
    { key: 'momentum', name: '시장 모멘텀' },
    { key: 'priceStrength', name: '주식 가격 강도' },
    { key: 'priceBreadth', name: '주식 가격 폭' },
    { key: 'junkBond', name: '정크본드 수요' },
    { key: 'safeHaven', name: '안전자산 수요' },
  ];
  fg.refs.fgSmallGrid.innerHTML = smallDefs
    .map(
      (d) => `
      <div class="card fg-small" data-ref="fgSmall_${d.key}">
        <div class="card-name">${d.name}</div>
        <div class="fg-small-score" data-ref="fgSmallScore_${d.key}">--</div>
        <div class="fg-small-badge" data-ref="fgSmallBadge_${d.key}">--</div>
      </div>`
    )
    .join('');
  Object.assign(fg.refs, collectRefs(fg.refs.fgSmallGrid));
}

// 공포탐욕지수 + VIX 실시간 시세를 함께 갱신
async function updateFearGreed() {
  if (!fg.refs.fgScore) return; // 아직 패널이 안 만들어졌으면 skip

  try {
    const [fgRes, vixRes] = await Promise.all([
      fetch('/api/feargreed'),
      fetch('/api/chart?symbol=' + encodeURIComponent('^VIX') + '&range=1d&interval=5m'),
    ]);
    const fgData = await fgRes.json();
    if (!fgRes.ok || fgData.available === false) {
      throw new Error(fgData.error || `HTTP ${fgRes.status}`);
    }

    fg.refs.fgError.hidden = true;

    // --- 메인 게이지 ---
    const score = fgData.main.score;
    fg.refs.fgScore.textContent = fmtNumber(score, 0);
    fg.refs.fgScore.style.color = fgColor(score);
    fg.refs.fgRating.textContent = fgLabel(score);
    fg.refs.fgRating.style.color = fgColor(score);
    const needleP = fgPoint(150, 150, 90, fgTheta(score));
    fg.refs.fgNeedle.setAttribute('x2', needleP.x.toFixed(2));
    fg.refs.fgNeedle.setAttribute('y2', needleP.y.toFixed(2));
    fg.refs.fgUpdated.textContent = `갱신 ${new Date().toLocaleTimeString('ko-KR')}`;

    // --- 과거 1년 추이 차트 ---
    if (Array.isArray(fgData.historical) && fgData.historical.length) {
      const seen = new Set();
      const points = [];
      for (const p of fgData.historical) {
        if (seen.has(p.time)) continue;
        seen.add(p.time);
        points.push({ time: p.time, value: p.value });
      }
      fg.series.setData(points);
      fg.series.applyOptions({ color: fgColor(score) });
      fg.chart.timeScale().fitContent();
    }

    // --- 하위 지표: VIX 강조 카드 (CNN 등급 + 야후 실시간 실제 수치) ---
    const vix = fgData.subIndicators.vix;
    fg.refs.fgVixBadge.textContent = fgRatingKo(vix?.rating);
    fg.refs.fgVixBadge.style.background = fgColor(vix?.score) + '26';
    fg.refs.fgVixBadge.style.color = fgColor(vix?.score);
    try {
      const vixData = await vixRes.json();
      if (vixRes.ok && vixData.price != null) {
        fg.refs.fgVixValue.textContent = fmtNumber(vixData.price, 2);
        const age = vixData.marketTime ? nowSec() - vixData.marketTime : null;
        const freshWord = age == null ? '' : age <= LIVE_THRESHOLD_S ? '실시간' : '지연';
        fg.refs.fgVixSub.textContent =
          age != null ? `야후 ^VIX ${freshWord} · ${agoText(age)}` : '야후 ^VIX';
      } else {
        fg.refs.fgVixValue.textContent = vix?.lastValue != null ? fmtNumber(vix.lastValue, 2) : '—';
        fg.refs.fgVixSub.textContent = 'CNN 데이터 값 (야후 조회 실패)';
      }
    } catch {
      fg.refs.fgVixValue.textContent = vix?.lastValue != null ? fmtNumber(vix.lastValue, 2) : '—';
      fg.refs.fgVixSub.textContent = 'CNN 데이터 값 (야후 조회 실패)';
    }

    // --- 하위 지표: 풋/콜 옵션 비율 강조 카드 ---
    const putCall = fgData.subIndicators.putCall;
    fg.refs.fgPutCallValue.textContent = putCall?.lastValue != null ? fmtNumber(putCall.lastValue, 3) : '—';
    fg.refs.fgPutCallBadge.textContent = fgRatingKo(putCall?.rating);
    fg.refs.fgPutCallBadge.style.background = fgColor(putCall?.score) + '26';
    fg.refs.fgPutCallBadge.style.color = fgColor(putCall?.score);
    fg.refs.fgPutCallSub.textContent = `CNN 점수 ${fmtNumber(putCall?.score, 1)}`;

    // --- 나머지 5개 작은 하위 지표 카드 ---
    for (const key of ['momentum', 'priceStrength', 'priceBreadth', 'junkBond', 'safeHaven']) {
      const ind = fgData.subIndicators[key];
      const scoreEl = fg.refs['fgSmallScore_' + key];
      const badgeEl = fg.refs['fgSmallBadge_' + key];
      if (!scoreEl || !badgeEl) continue;
      scoreEl.textContent = fmtNumber(ind?.score, 1);
      scoreEl.style.color = fgColor(ind?.score);
      badgeEl.textContent = fgRatingKo(ind?.rating);
      badgeEl.style.background = fgColor(ind?.score) + '26';
      badgeEl.style.color = fgColor(ind?.score);
    }
  } catch (err) {
    console.error('[공포탐욕지수] 갱신 실패:', err);
    fg.refs.fgError.hidden = false;
    fg.refs.fgUpdated.textContent = String(err.message || err).slice(0, 40);
  }
}

// ---- 외부 앱 연결 전용 탭 (예: 이지인베스팅) --------------------------------
// 서드파티 SPA 는 iframe 안에서 정상 동작을 보장할 수 없어(프레임 차단 스크립트,
// 상대경로 깨짐 등) 데이터를 끌어오지 않고 새 탭으로 여는 링크 카드만 둔다.
function buildLinkoutPanel(sec, section) {
  const wrap = document.createElement('div');
  wrap.className = 'linkout-panel';
  wrap.innerHTML = `
    <div class="card linkout-card">
      <div class="linkout-icon">↗</div>
      <div class="linkout-title">${section.title}</div>
      <div class="linkout-desc">외부 웹앱으로 이동합니다 (새 탭에서 열림)</div>
      <button type="button" class="linkout-btn" data-ref="linkoutBtn">${section.title} 열기 ↗</button>
      <div class="linkout-url" data-ref="linkoutUrl"></div>
    </div>
  `;
  sec.appendChild(wrap);

  const refs = collectRefs(wrap);
  refs.linkoutUrl.textContent = section.externalUrl;
  const open = () => window.open(section.externalUrl, '_blank', 'noopener');
  refs.linkoutBtn.addEventListener('click', open);
  wrap.querySelector('.linkout-card').addEventListener('click', (e) => {
    if (e.target.closest('.linkout-btn')) return; // 버튼 클릭은 위에서 이미 처리(중복 방지)
    open();
  });
}

// ---- 채권 탭: 미국 국채 수익률 곡선 (2년물 카드 옆) -------------------------
// refs: 카드 안에 작게 들어간 뷰. modalRefs: 클릭 시 뜨는 확대 모달.
const yieldCurve = { refs: {}, modalRefs: {}, modalOverlay: null };

function buildYieldCurvePanel(container) {
  const panel = document.createElement('section');
  panel.className = 'yield-curve-panel';
  panel.innerHTML = `
    <div class="card-head">
      <div>
        <div class="card-name">미국 국채 수익률 곡선</div>
        <div class="card-sub" data-ref="ycDate">불러오는 중…</div>
      </div>
    </div>
    <div class="yield-curve-chart-wrap" data-ref="ycChartWrap">
      <svg class="yield-curve-svg" viewBox="0 0 640 260" preserveAspectRatio="none" data-ref="ycSvg"></svg>
      <div class="yc-tooltip" data-ref="ycTooltip" hidden></div>
    </div>
    <div class="yield-curve-legend" data-ref="ycLegend"></div>
    <div class="yield-curve-spread" data-ref="ycSpread"></div>
    <div class="yield-curve-source">출처: 미국 재무부(Treasury.gov) 공식 일일 수익률 곡선</div>
    <div class="card-hint">클릭하면 크게 보기 🔍</div>
  `;
  container.appendChild(panel);
  yieldCurve.refs = collectRefs(panel);

  // 그래프 배경 클릭 → 확대 모달. 점/선 위 클릭은 툴팁용이라 모달을 열지 않는다.
  yieldCurve.refs.ycChartWrap.addEventListener('click', (e) => {
    if (e.target.closest('.yc-point, .yc-line')) return;
    openYieldCurveModal();
  });
  attachYieldCurveTooltip(yieldCurve.refs.ycSvg, yieldCurve.refs.ycTooltip, yieldCurve.refs.ycChartWrap);

  buildYieldCurveModal();
  updateYieldCurve();
}

function buildYieldCurveModal() {
  const overlay = document.createElement('div');
  overlay.className = 'yc-modal-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="yc-modal">
      <button type="button" class="yc-modal-close" data-ref="ycModalClose" aria-label="닫기">✕</button>
      <div class="card-name">미국 국채 수익률 곡선</div>
      <div class="card-sub" data-ref="ycModalDate"></div>
      <div class="yield-curve-chart-wrap yc-modal-chart-wrap" data-ref="ycModalChartWrap">
        <svg class="yield-curve-svg yc-modal-svg" viewBox="0 0 640 260" preserveAspectRatio="none" data-ref="ycModalSvg"></svg>
        <div class="yc-tooltip yc-modal-tooltip" data-ref="ycModalTooltip" hidden></div>
      </div>
      <div class="yield-curve-legend yc-modal-legend" data-ref="ycModalLegend"></div>
      <div class="yield-curve-spread yc-modal-spread" data-ref="ycModalSpread"></div>
      <div class="yield-curve-source">출처: 미국 재무부(Treasury.gov) 공식 일일 수익률 곡선</div>
    </div>
  `;
  document.body.appendChild(overlay);
  yieldCurve.modalRefs = collectRefs(overlay);
  yieldCurve.modalOverlay = overlay;

  // 모달 바깥(오버레이 자체) 클릭 시 닫기 — 안쪽 .yc-modal 클릭은 버블링으로 여기까지 안 옴.
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeYieldCurveModal();
  });
  yieldCurve.modalRefs.ycModalClose.addEventListener('click', closeYieldCurveModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.hidden) closeYieldCurveModal();
  });
  attachYieldCurveTooltip(
    yieldCurve.modalRefs.ycModalSvg,
    yieldCurve.modalRefs.ycModalTooltip,
    yieldCurve.modalRefs.ycModalChartWrap
  );
}

function openYieldCurveModal() {
  if (!yieldCurve.modalOverlay) return;
  yieldCurve.modalOverlay.hidden = false;
}
function closeYieldCurveModal() {
  if (yieldCurve.modalOverlay) yieldCurve.modalOverlay.hidden = true;
}

// 그래프 위 점/선에 마우스를 올리거나(호버) 탭했을 때(모바일) 값을 보여주는 커스텀 툴팁.
// 네이티브 SVG <title> 은 모바일 탭에서 안정적으로 뜨지 않아 별도 div 로 직접 구현한다.
function attachYieldCurveTooltip(svgEl, tooltipEl, wrapEl) {
  const show = (target, evt) => {
    const tip = target.getAttribute('data-tip');
    if (!tip) return;
    tooltipEl.textContent = tip;
    tooltipEl.hidden = false;
    const wrapRect = wrapEl.getBoundingClientRect();
    const x = evt.clientX - wrapRect.left;
    const y = evt.clientY - wrapRect.top;
    tooltipEl.style.left = `${Math.min(Math.max(x + 12, 4), Math.max(wrapRect.width - 150, 4))}px`;
    tooltipEl.style.top = `${Math.max(y - 30, 4)}px`;
  };
  const hide = () => { tooltipEl.hidden = true; };

  svgEl.addEventListener('pointermove', (e) => {
    const target = e.target.closest('.yc-point, .yc-line');
    if (target) show(target, e); else hide();
  });
  svgEl.addEventListener('pointerleave', hide);
  svgEl.addEventListener('click', (e) => {
    const target = e.target.closest('.yc-point, .yc-line');
    if (target) show(target, e);
  });
}

function buildYieldCurveSvg(maturities, curves) {
  const width = 640;
  const height = 260;
  const padL = 38;
  const padR = 10;
  const padT = 12;
  const padB = 26;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const allValues = curves.flatMap((c) => c.points.map((p) => p.value)).filter((v) => v != null);
  if (allValues.length === 0) return '';
  const rawMin = Math.min(...allValues);
  const rawMax = Math.max(...allValues);
  const minV = Math.floor((rawMin - 0.25) * 2) / 2;
  const maxV = Math.ceil((rawMax + 0.25) * 2) / 2;

  const xFor = (i) => padL + (i / (maturities.length - 1)) * plotW;
  const yFor = (v) => padT + plotH - ((v - minV) / (maxV - minV)) * plotH;

  let svg = '';

  const tickCount = 4;
  for (let i = 0; i <= tickCount; i++) {
    const v = minV + ((maxV - minV) * i) / tickCount;
    const y = yFor(v);
    svg += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${width - padR}" y2="${y.toFixed(1)}" class="yc-gridline" />`;
    svg += `<text x="${padL - 6}" y="${(y + 3).toFixed(1)}" class="yc-axis-label" text-anchor="end">${v.toFixed(1)}%</text>`;
  }

  maturities.forEach((m, i) => {
    const x = xFor(i);
    svg += `<text x="${x.toFixed(1)}" y="${height - padB + 16}" class="yc-axis-label" text-anchor="middle">${m.label}</text>`;
  });

  [...curves].reverse().forEach((c) => {
    const linePts = [];
    c.points.forEach((p, i) => {
      if (p.value == null) return;
      linePts.push(`${xFor(i).toFixed(1)},${yFor(p.value).toFixed(1)}`);
    });
    if (linePts.length >= 2) {
      svg += `<polyline points="${linePts.join(' ')}" class="yc-line yc-line-${c.key}" fill="none" data-tip="${escapeXml(c.shortLabel)}"><title>${escapeXml(c.shortLabel)}</title></polyline>`;
    }
    c.points.forEach((p, i) => {
      if (p.value == null) return;
      const x = xFor(i);
      const y = yFor(p.value);
      const tip = `${c.shortLabel} · ${p.label}: ${p.value.toFixed(2)}%`;
      svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" class="yc-point yc-point-${c.key}" data-tip="${escapeXml(tip)}"><title>${escapeXml(tip)}</title></circle>`;
    });
  });

  return svg;
}

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildYieldCurveLegendHtml(curves) {
  return curves
    .map((c) => `<span class="yc-legend-item"><span class="yc-legend-swatch yc-legend-${c.key}"></span>${c.label}</span>`)
    .join('');
}

async function updateYieldCurve() {
  const refs = yieldCurve.refs;
  if (!refs.ycSvg) return;
  try {
    const res = await fetch('/api/treasury-yield-curve');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    const curves = [
      { key: 'latest', shortLabel: '오늘', label: `오늘 (${data.latest.date})`, points: data.latest.curve },
    ];
    if (data.oneMonthAgo) {
      curves.push({ key: 'oneMonthAgo', shortLabel: '1개월 전', label: `1개월 전 (${data.oneMonthAgo.date})`, points: data.oneMonthAgo.curve });
    }
    if (data.oneYearAgo) {
      curves.push({ key: 'oneYearAgo', shortLabel: '1년 전', label: `1년 전 (${data.oneYearAgo.date})`, points: data.oneYearAgo.curve });
    }

    const svgMarkup = buildYieldCurveSvg(data.maturities, curves);
    const dateText = `기준일 ${data.latest.date} (전 영업일 종가)`;
    const legendHtml = buildYieldCurveLegendHtml(curves);
    let spreadHtml;
    if (data.spread10y2y != null) {
      const inverted = data.spread10y2y < 0;
      const sign = data.spread10y2y >= 0 ? '+' : '';
      spreadHtml =
        `10년물-2년물 스프레드: <strong class="${inverted ? 'yc-spread-inverted' : ''}">${sign}${data.spread10y2y.toFixed(2)}%p</strong>` +
        (inverted ? ' (장단기 금리 역전)' : '');
    } else {
      spreadHtml = '스프레드 계산 불가';
    }

    // 작은 카드 뷰
    refs.ycSvg.innerHTML = svgMarkup;
    refs.ycDate.textContent = dateText;
    refs.ycLegend.innerHTML = legendHtml;
    refs.ycSpread.innerHTML = spreadHtml;

    // 확대 모달 (열려있지 않아도 동기화해 둔다 — 다음에 열 때 최신 데이터가 바로 보이도록)
    const mRefs = yieldCurve.modalRefs;
    if (mRefs.ycModalSvg) {
      mRefs.ycModalSvg.innerHTML = svgMarkup;
      mRefs.ycModalDate.textContent = dateText;
      mRefs.ycModalLegend.innerHTML = legendHtml;
      mRefs.ycModalSpread.innerHTML = spreadHtml;
    }
  } catch (e) {
    refs.ycDate.textContent = `조회 실패: ${String((e && e.message) || e).slice(0, 60)}`;
  }
}

// ---- 각 탭 하단 "관련 뉴스" 블록 --------------------------------------------
const news = { refs: {} };

function buildSectionNewsBlock(sec, categoryKey) {
  const block = document.createElement('div');
  block.className = 'news-block';
  block.innerHTML = `
    <h3 class="news-block-title">관련 뉴스</h3>
    <ul class="news-list" data-ref="newsList_${categoryKey}">
      <li class="news-empty">불러오는 중…</li>
    </ul>
  `;
  sec.appendChild(block);
  Object.assign(news.refs, collectRefs(block));
}

// 뉴스 목록에 안내 문구 한 줄만 표시(로딩/빈 목록/오류 공용)
function setNewsListMessage(listEl, msg) {
  listEl.innerHTML = '';
  const li = document.createElement('li');
  li.className = 'news-empty';
  li.textContent = msg;
  listEl.appendChild(li);
}

// 뉴스 1건을 <li><a> 로 만든다. 외부(RSS) 콘텐츠라 innerHTML 대신
// textContent 로 채워 넣어 XSS 위험 없이 안전하게 렌더링한다.
function buildNewsItemEl(item) {
  const li = document.createElement('li');
  li.className = 'news-item';

  const a = document.createElement('a');
  a.className = 'news-link';
  a.href = item.link;
  a.target = '_blank';
  a.rel = 'noopener';

  const titleEl = document.createElement('div');
  titleEl.className = 'news-title';
  titleEl.textContent = item.title;

  const metaEl = document.createElement('div');
  metaEl.className = 'news-meta';
  const age = item.timestamp != null ? agoText(nowSec() - item.timestamp) : '';
  metaEl.textContent = [item.source, age].filter(Boolean).join(' · ');

  a.appendChild(titleEl);
  a.appendChild(metaEl);
  li.appendChild(a);
  return li;
}

async function updateNews() {
  await Promise.all(
    NEWS_CATEGORY_KEYS.map(async (categoryKey) => {
      const listEl = news.refs['newsList_' + categoryKey];
      if (!listEl) return; // 해당 탭을 아직 한 번도 안 열었으면 블록이 없을 수 있음
      try {
        const res = await fetch(`/api/news?category=${categoryKey}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        // 서버가 이미 중요도 임계값으로 걸러서 정렬해 주므로 그대로 전부 그린다.
        const items = Array.isArray(data.items) ? data.items : [];
        if (!items.length) {
          setNewsListMessage(listEl, '지금은 특별히 중요한 뉴스가 없습니다');
          return;
        }
        listEl.innerHTML = '';
        items.forEach((it) => listEl.appendChild(buildNewsItemEl(it)));
      } catch (err) {
        console.error(`[뉴스] ${categoryKey} 갱신 실패:`, err);
        setNewsListMessage(listEl, '일시적으로 뉴스를 가져올 수 없음');
      }
    })
  );
}

// 한 leg('spot'|'fut')의 데이터를 가져온다.
async function fetchLeg(item, leg) {
  const conf = legConf(item, leg);
  const { interval } = RANGE_INTERVAL[state.range];
  const base =
    item.type === 'index' ? '/api/index' : item.type === 'fx-krw' ? '/api/fx-krw' : '/api/chart';
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

    // --- 출처 배지 (index / fx-krw 전용) ---
    if (item.type === 'index') {
      const src = data.source === 'investing' ? '인베스팅' : '야후';
      card.refs.source.hidden = false;
      card.refs.source.textContent = src;
      card.refs.source.className = `source-badge ${data.source === 'investing' ? 'inv' : 'yh'}`;
    } else if (item.type === 'fx-krw') {
      // 평소엔 야후, 야후 값이 네이버 환율과 2% 이상 어긋날 때만 "네이버 대체"로 표시
      const src = data.source === 'naver' ? '네이버 대체' : '야후';
      card.refs.source.hidden = false;
      card.refs.source.textContent = src;
      card.refs.source.className = `source-badge ${data.source === 'naver' ? 'inv' : 'yh'}`;
    }

    // --- 가격 / 등락 ---
    // scale: 원단위가 너무 작은 심볼(예: 원/엔 JPYKRW=X)을 한국 관행대로
    // "100엔당 원화" 처럼 배율을 곱해 표시하기 위함 (기본값 1, 등락률(%)엔 영향 없음)
    const scale = conf.scale || 1;
    const price = data.price != null ? data.price * scale : data.price;
    const prev = data.previousClose != null ? data.previousClose * scale : data.previousClose;
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

    // --- 신선도 ---
    setFresh(card, data.marketTime ? nowSec() - data.marketTime : null);
    card.refs.updated.textContent = `갱신 ${new Date().toLocaleTimeString('ko-KR')}`;
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
    document.querySelectorAll('#rangeButtonsGroup button').forEach((b) =>
      b.classList.toggle('active', b === btn)
    );
    refreshAll(true);
  });

  // 시세/뉴스 보기 전환 (기간 선택 옆)
  const viewToggle = document.getElementById('viewToggle');
  viewToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-view]');
    if (!btn) return;
    state.view = btn.dataset.view;
    viewToggle.querySelectorAll('button').forEach((b) =>
      b.classList.toggle('active', b === btn)
    );
    syncViewControls();
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
syncViewControls();
tickClock();
setInterval(tickClock, 1000);
refreshAll();
setInterval(refreshAll, REFRESH_MS);
updateFearGreed();
setInterval(updateFearGreed, FEARGREED_REFRESH_MS);
updateNews();
setInterval(updateNews, NEWS_REFRESH_MS);
setInterval(updateYieldCurve, NEWS_REFRESH_MS); // 하루 1회 갱신되는 데이터라 자주 돌 필요는 없지만 서버가 캐싱하므로 부담 없음

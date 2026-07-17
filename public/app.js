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
  {
    id: 'feargreed',
    title: '공포탐욕지수',
    tabLabel: '공포탐욕지수',
    custom: 'feargreed', // 일반 카드 그리드가 아닌 전용 레이아웃
    items: [],
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

    const grid = document.createElement('div');
    grid.className = 'grid';
    sec.appendChild(grid);

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
      </div>
      <div class="card fg-featured" data-ref="fgPutCallCard">
        <div class="card-name">풋/콜 옵션 비율</div>
        <div class="fg-featured-value" data-ref="fgPutCallValue">--</div>
        <div class="fg-featured-badge" data-ref="fgPutCallBadge">--</div>
        <div class="fg-featured-sub" data-ref="fgPutCallSub"></div>
      </div>
    </div>

    <div class="fg-small-grid" data-ref="fgSmallGrid"></div>
  `;
  sec.appendChild(wrap);

  fg.refs = collectRefs(wrap);
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
        fg.refs.fgVixSub.textContent =
          age != null
            ? `야후 ^VIX 실시간 · ${agoText(age)}`
            : '야후 ^VIX';
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
updateFearGreed();
setInterval(updateFearGreed, FEARGREED_REFRESH_MS);

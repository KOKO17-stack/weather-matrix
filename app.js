const CONFIG = {
  lat: 32.04551,
  lon: 73.43149,
  name: 'Mandi Bahauddin, Pakistan',
  hours: 8,
  forecastDays: 2,
  api: 'https://api.open-meteo.com/v1/forecast',
  geo: 'https://geocoding-api.open-meteo.com/v1/search',
  params: 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation_probability,precipitation,wind_speed_10m',
  models: [
    { id: 'ecmwf_ifs025', label: 'ECMWF IFS', short: 'EC', agency: 'European Centre' },
    { id: 'gfs_seamless', label: 'NOAA GFS', short: 'GF', agency: 'NOAA (US)' },
    { id: 'icon_seamless', label: 'DWD ICON', short: 'IC', agency: 'DWD (Germany)' },
    { id: 'jma_seamless', label: 'JMA GSM', short: 'GS', agency: 'JMA (Japan)' },
  ],
};

const state = {
  lat: CONFIG.lat,
  lon: CONFIG.lon,
  name: CONFIG.name,
  data: null,
  hours: [],
  activeModel: 'consensus',
  error: null,
};

const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];

const els = {
  locName: $('#location-name'),
  coords: $('#coords-display'),
  updated: $('#update-time'),
  currentTemp: $('#current-temp'),
  currentDesc: $('#current-desc'),
  currentIcon: $('#current-icon'),
  feelsLike: $('#feels-like'),
  humidity: $('#humidity'),
  currentRain: $('#current-rain'),
  currentWind: $('#current-wind'),
  matrixGrid: $('#matrix-grid'),
  modelBar: $('#model-bar'),
  refreshBtn: $('#refresh-btn'),
  searchInput: $('#search-input'),
  searchBtn: $('#search-btn'),
  searchResults: $('#search-results'),
  statusNotice: $('#status-notice'),
  statusIcon: $('#status-icon'),
  statusMsg: $('#status-msg'),
};

function fmt(v, d = 1) {
  if (v == null || Number.isNaN(Number(v))) return '\u2014';
  return Number(v).toFixed(d);
}

function tempClass(t) {
  if (t == null) return '';
  if (t >= 38) return 'temp-hot';
  if (t >= 30) return 'temp-warm';
  if (t >= 22) return 'temp-mild';
  if (t >= 14) return 'temp-cool';
  return 'temp-cold';
}

function timeStr(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function weatherIcon(rainChance, rainMm) {
  const rc = rainChance ?? 0;
  const rm = rainMm ?? 0;
  if (rc >= 70 && rm > 0) return '\u26C8\uFE0F';
  if (rc >= 50) return '\uD83C\uDF27\uFE0F';
  if (rc >= 30) return '\uD83C\uDF26\uFE0F';
  if (rc >= 10) return '\u26C5';
  return '\u2600\uFE0F';
}

function showStatus(icon, msg) {
  els.statusIcon.textContent = icon;
  els.statusMsg.textContent = msg;
  els.statusNotice.classList.remove('hidden');
}

function hideStatus() {
  els.statusNotice.classList.add('hidden');
}

function renderSkeleton() {
  els.matrixGrid.innerHTML =
    '<div class="matrix__skeleton">' +
    '<div class="skeleton-card"></div>'.repeat(8) +
    '</div>';
}

/* ── Multi-model data extraction ── */

function modelVal(hourly, modelId, varName, idx) {
  const key = varName + '_' + modelId;
  if (hourly[key] && hourly[key][idx] != null) return hourly[key][idx];
  if (hourly[varName] && hourly[varName][idx] != null) return hourly[varName][idx];
  return null;
}

function extractHours(data) {
  const { hourly } = data;
  if (!hourly || !hourly.time || !hourly.time.length) return [];

  const now = Date.now();
  let start = 0;
  for (let i = 0; i < hourly.time.length; i++) {
    const t = new Date(hourly.time[i]).getTime();
    const end = t + 3600000;
    if (now >= t && now < end) { start = i; break; }
    if (t > now) { start = i; break; }
  }

  const end = Math.min(start + CONFIG.hours, hourly.time.length);
  const hours = [];

  for (let i = start; i < end; i++) {
    const modelData = {};
    CONFIG.models.forEach(m => {
      modelData[m.id] = {
        temperature: modelVal(hourly, m.id, 'temperature_2m', i),
        feelsLike: modelVal(hourly, m.id, 'apparent_temperature', i),
        rainChance: modelVal(hourly, m.id, 'precipitation_probability', i),
        rainMm: modelVal(hourly, m.id, 'precipitation', i),
        wind: modelVal(hourly, m.id, 'wind_speed_10m', i),
      };
    });

    const temps = CONFIG.models.map(m => modelData[m.id].temperature).filter(v => v != null);
    const feels = CONFIG.models.map(m => modelData[m.id].feelsLike).filter(v => v != null);
    const rains = CONFIG.models.map(m => modelData[m.id].rainChance).filter(v => v != null);
    const raind = CONFIG.models.map(m => modelData[m.id].rainMm).filter(v => v != null);
    const winds = CONFIG.models.map(m => modelData[m.id].wind).filter(v => v != null);

    hours.push({
      time: hourly.time[i],
      models: modelData,
      consensus: {
        temperature: temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null,
        feelsLike: feels.length ? feels.reduce((a, b) => a + b, 0) / feels.length : null,
        rainChance: rains.length ? rains.reduce((a, b) => a + b, 0) / rains.length : null,
        rainMm: raind.length ? raind.reduce((a, b) => a + b, 0) / raind.length : null,
        wind: winds.length ? winds.reduce((a, b) => a + b, 0) / winds.length : null,
      },
      sourceCount: CONFIG.models.length,
    });
  }

  return hours;
}

function currentModelVal(current, modelId, varName) {
  const key = varName + '_' + modelId;
  if (current[key] != null) return current[key];
  if (current[varName] != null) return current[varName];
  return null;
}

function getCurrentConsensus(current, fallbackHour) {
  const temps = CONFIG.models.map(m => currentModelVal(current, m.id, 'temperature_2m')).filter(v => v != null);
  const feels = CONFIG.models.map(m => currentModelVal(current, m.id, 'apparent_temperature')).filter(v => v != null);
  const rains = CONFIG.models.map(m => currentModelVal(current, m.id, 'precipitation_probability')).filter(v => v != null);
  const hums = CONFIG.models.map(m => currentModelVal(current, m.id, 'relative_humidity_2m')).filter(v => v != null);
  const winds = CONFIG.models.map(m => currentModelVal(current, m.id, 'wind_speed_10m')).filter(v => v != null);

  if (temps.length) {
    return {
      temperature: temps.reduce((a, b) => a + b, 0) / temps.length,
      feelsLike: feels.length ? feels.reduce((a, b) => a + b, 0) / feels.length : null,
      rainChance: rains.length ? rains.reduce((a, b) => a + b, 0) / rains.length : null,
      humidity: hums.length ? hums.reduce((a, b) => a + b, 0) / hums.length : null,
      wind: winds.length ? winds.reduce((a, b) => a + b, 0) / winds.length : null,
    };
  }

  if (fallbackHour && fallbackHour.consensus) {
    return fallbackHour.consensus;
  }

  return { temperature: null, feelsLike: null, rainChance: null, humidity: null, wind: null };
}

/* ── Rendering ── */

function renderCurrent(data) {
  const c = data.current || {};
  const fb = state.hours[0] || null;
  const cons = getCurrentConsensus(c, fb);

  const rc = cons.rainChance ?? 0;
  els.currentIcon.textContent = weatherIcon(rc, 0);

  const t = cons.temperature;
  els.currentTemp.textContent = t != null ? fmt(t, 0) + '\u00B0' : '--\u00B0';
  els.currentTemp.className = 'current__temp ' + tempClass(t);
  const fl = cons.feelsLike;
  els.currentDesc.textContent = t != null
    ? (fl != null ? 'Feels like ' + fmt(fl, 0) + '\u00B0 \u00B7 ' : '') + state.name + ' \u00B7 ' + CONFIG.models.length + ' models'
    : 'Loading forecast\u2026';

  els.feelsLike.textContent = cons.feelsLike != null ? fmt(cons.feelsLike, 0) + '\u00B0' : '\u2014';
  els.humidity.textContent = cons.humidity != null ? fmt(cons.humidity, 0) + '%' : '\u2014';
  els.currentRain.textContent = cons.rainChance != null ? fmt(cons.rainChance, 0) + '%' : '\u2014';
  els.currentWind.textContent = cons.wind != null ? fmt(cons.wind, 0) + ' km/h' : '\u2014';
}

function renderHourCard(h, i) {
  const card = document.createElement('div');
  card.className = 'hour-card';
  card.style.animationDelay = (i * 0.04) + 's';

  const useConsensus = state.activeModel === 'consensus';
  const src = useConsensus ? h.consensus : (h.models[state.activeModel] || h.consensus);
  const label = useConsensus ? 'Consensus' : (CONFIG.models.find(m => m.id === state.activeModel)?.short || '');

  const tc = tempClass(src.temperature);
  const icon = weatherIcon(src.rainChance, src.rainMm);
  const rc = src.rainChance ?? 0;

  let footerHtml = '';
  if (useConsensus) {
    const dots = CONFIG.models.map(m => {
      const md = h.models[m.id];
      const hasRain = (md.rainChance ?? 0) > 20;
      return '<span class="model-dot' + (hasRain ? ' maybe' : '') + '" title="' + m.label + '"></span>';
    }).join('');
    footerHtml = '<div class="model-dots">' + dots + '</div>'
      + '<span style="font-size:0.62rem;color:var(--text-muted);text-align:center">' + CONFIG.models.length + ' model avg</span>';
  } else {
    footerHtml = '<span class="hour-card__model-badge">' + label + '</span>';
  }

  card.innerHTML =
    '<div class="hour-card__head">' +
      '<span class="hour-card__time">' + (i === 0 ? 'Now' : timeStr(h.time)) + '</span>' +
      '<span class="hour-card__offset">' + (i === 0 ? 'Current' : '+' + i + 'h') + '</span>' +
    '</div>' +
    '<div class="hour-card__icon">' + icon + '</div>' +
    '<div class="hour-card__temps">' +
      '<span class="hour-card__temp ' + tc + '">' + fmt(src.temperature, 0) + '\u00B0</span>' +
      '<span class="hour-card__feels">' + fmt(src.feelsLike, 0) + '\u00B0</span>' +
    '</div>' +
    '<div class="hour-card__rain">' +
      '<div class="rain-label">' +
        '<span class="rain-label__pct">' + fmt(rc, 0) + '%</span>' +
        '<span class="rain-label__mm">' + (src.rainMm != null ? fmt(src.rainMm, 2) + ' mm' : '\u2014') + '</span>' +
      '</div>' +
      '<div class="rain-track"><div class="rain-fill" style="width:' + Math.min(100, rc) + '%"></div></div>' +
    '</div>' +
    '<div class="hour-card__wind">' +
      '<span class="wind-icon">\uD83D\uDCA8</span>' +
      '<span>' + (src.wind != null ? fmt(src.wind, 0) + ' km/h' : '\u2014') + '</span>' +
    '</div>' +
    '<div style="display:flex;justify-content:center;align-items:center;gap:6px;min-height:18px">' + footerHtml + '</div>';

  return card;
}

function renderMatrix() {
  els.matrixGrid.innerHTML = '';
  state.hours.forEach((h, i) => {
    els.matrixGrid.appendChild(renderHourCard(h, i));
  });
  if (!state.hours.length) {
    showStatus('\u26A0\uFE0F', 'No forecast data available for this location.');
  }
}

function updateMeta() {
  els.locName.textContent = state.name;
  els.coords.textContent = state.lat.toFixed(4) + ', ' + state.lon.toFixed(4);
  if (state.data) {
    const n = new Date();
    els.updated.textContent = 'Updated ' + n.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }
}

function setActiveModel(modelId) {
  state.activeModel = modelId;
  $$('.model-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.model === modelId);
  });
  renderMatrix();
}

function setupModelTabs() {
  $$('.model-tab', els.modelBar).forEach(tab => {
    tab.addEventListener('click', () => setActiveModel(tab.dataset.model));
  });
}

/* ── API ── */

async function fetchForecast(lat, lon) {
  const p = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: CONFIG.params,
    hourly: CONFIG.params,
    models: CONFIG.models.map(m => m.id).join(','),
    forecast_days: CONFIG.forecastDays,
    timezone: 'auto',
  });
  const r = await fetch(CONFIG.api + '?' + p);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  if (j.error) throw new Error(j.reason || 'API error');
  return j;
}

async function loadForecast(lat, lon) {
  hideStatus();
  setActiveModel('consensus');
  renderSkeleton();
  els.refreshBtn.disabled = true;

  try {
    state.data = await fetchForecast(lat, lon);
    state.hours = extractHours(state.data);
    state.lat = lat;
    state.lon = lon;
    renderCurrent(state.data);
    renderMatrix();
    updateMeta();
  } catch (err) {
    state.error = err.message || 'Unknown error';
    els.matrixGrid.innerHTML = '';
    showStatus('\u26A0\uFE0F', 'Failed to load forecast: ' + state.error + '. Please try again.');
  } finally {
    els.refreshBtn.disabled = false;
  }
}

/* ── Search ── */

async function searchLocation(q) {
  if (!q || q.trim().length < 2) { els.searchResults.classList.add('hidden'); return; }
  try {
    const r = await fetch(CONFIG.geo + '?name=' + encodeURIComponent(q.trim()) + '&count=5&language=en&format=json');
    const j = await r.json();
    const results = j.results || [];
    if (!results.length) { els.searchResults.classList.add('hidden'); return; }
    els.searchResults.innerHTML = results.map((res, idx) =>
      '<li data-idx="' + idx + '" data-lat="' + res.latitude + '" data-lon="' + res.longitude + '" data-name="' + res.name + (res.admin1 ? ', ' + res.admin1 : '') + ', ' + res.country + '">' +
        res.name + (res.admin1 ? ', ' + res.admin1 : '') + '<span class="country">' + res.country + '</span>' +
      '</li>'
    ).join('');
    els.searchResults.classList.remove('hidden');
    $$('li', els.searchResults).forEach(li => {
      li.addEventListener('click', () => {
        state.name = li.dataset.name;
        els.searchInput.value = li.dataset.name.split(',')[0];
        els.searchResults.classList.add('hidden');
        loadForecast(parseFloat(li.dataset.lat), parseFloat(li.dataset.lon));
      });
    });
  } catch {
    els.searchResults.classList.add('hidden');
  }
}

function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

function init() {
  updateMeta();
  setupModelTabs();
  loadForecast(state.lat, state.lon);

  els.refreshBtn.addEventListener('click', () => loadForecast(state.lat, state.lon));

  const debouncedSearch = debounce(searchLocation, 300);
  els.searchInput.addEventListener('input', e => { debouncedSearch(e.target.value); });
  els.searchInput.addEventListener('keydown', e => { if (e.key === 'Escape') els.searchResults.classList.add('hidden'); });
  document.addEventListener('click', e => { if (!e.target.closest('.search')) els.searchResults.classList.add('hidden'); });
}

document.addEventListener('DOMContentLoaded', init);

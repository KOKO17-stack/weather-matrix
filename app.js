const CONFIG = {
  lat: 32.04551,
  lon: 73.43149,
  name: 'Mandi Bahauddin, Pakistan',
  hours: 8,
  forecastDays: 2,
  api: 'https://api.open-meteo.com/v1/forecast',
  geo: 'https://geocoding-api.open-meteo.com/v1/search',
  currentParams: 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation_probability,precipitation,wind_speed_10m',
  hourlyParams: 'temperature_2m,apparent_temperature,precipitation_probability,precipitation,wind_speed_10m',
};

const state = { lat: CONFIG.lat, lon: CONFIG.lon, name: CONFIG.name, data: null, hours: [], error: null };

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

function currentIcon(rc, rh) {
  const c = rc ?? 0;
  if (c >= 70) return '\uD83C\uDF27\uFE0F';
  if (c >= 40) return '\u26C5';
  if (c >= 10) return '\uD83C\uDF24\uFE0F';
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
  els.matrixGrid.innerHTML = `
    <div class="matrix__skeleton">
      ${'<div class="skeleton-card"></div>'.repeat(8)}
    </div>`;
}

async function fetchForecast(lat, lon) {
  const p = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: CONFIG.currentParams,
    hourly: CONFIG.hourlyParams,
    forecast_days: CONFIG.forecastDays,
    timezone: 'auto',
  });
  const r = await fetch(`${CONFIG.api}?${p}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(j.reason || 'API error');
  return j;
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
    hours.push({
      time: hourly.time[i],
      temperature: hourly.temperature_2m?.[i] ?? null,
      feelsLike: hourly.apparent_temperature?.[i] ?? null,
      rainChance: hourly.precipitation_probability?.[i] ?? null,
      rainMm: hourly.precipitation?.[i] ?? null,
      wind: hourly.wind_speed_10m?.[i] ?? null,
    });
  }
  return hours;
}

function renderCurrent(data) {
  const c = data.current;
  if (!c) return;
  const rc = c.precipitation_probability;
  els.currentIcon.textContent = currentIcon(rc, c.relative_humidity_2m);
  const t = c.temperature_2m;
  els.currentTemp.textContent = `${fmt(t, 0)}\u00B0`;
  els.currentTemp.className = `current__temp ${tempClass(t)}`;
  els.currentDesc.textContent = `Feels like ${fmt(c.apparent_temperature, 0)}\u00B0 \u00B7 ${state.name}`;
  els.feelsLike.textContent = `${fmt(c.apparent_temperature, 0)}\u00B0`;
  els.humidity.textContent = `${fmt(c.relative_humidity_2m, 0)}%`;
  els.currentRain.textContent = rc != null ? `${fmt(rc, 0)}%` : '\u2014';
  els.currentWind.textContent = c.wind_speed_10m != null ? `${fmt(c.wind_speed_10m, 0)} km/h` : '\u2014';
}

function renderHourCard(h, i) {
  const card = document.createElement('div');
  card.className = 'hour-card';
  card.style.animationDelay = `${i * 0.04}s`;

  const tc = tempClass(h.temperature);
  const icon = weatherIcon(h.rainChance, h.rainMm);
  const rc = h.rainChance ?? 0;

  card.innerHTML = `
    <div class="hour-card__head">
      <span class="hour-card__time">${i === 0 ? 'Now' : timeStr(h.time)}</span>
      <span class="hour-card__offset">${i === 0 ? 'Current' : `+${i}h`}</span>
    </div>
    <div class="hour-card__icon">${icon}</div>
    <div class="hour-card__temps">
      <span class="hour-card__temp ${tc}">${fmt(h.temperature, 0)}\u00B0</span>
      <span class="hour-card__feels">${fmt(h.feelsLike, 0)}\u00B0</span>
    </div>
    <div class="hour-card__rain">
      <div class="rain-label">
        <span class="rain-label__pct">${fmt(rc, 0)}%</span>
        <span class="rain-label__mm">${h.rainMm != null ? `${fmt(h.rainMm, 2)} mm` : '\u2014'}</span>
      </div>
      <div class="rain-track">
        <div class="rain-fill" style="width: ${Math.min(100, rc)}%"></div>
      </div>
    </div>
    <div class="hour-card__wind">
      <span class="wind-icon">\uD83D\uDCA8</span>
      <span>${h.wind != null ? `${fmt(h.wind, 0)} km/h` : '\u2014'}</span>
    </div>
  `;
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
  els.coords.textContent = `${state.lat.toFixed(4)}, ${state.lon.toFixed(4)}`;
  if (state.data) {
    const n = new Date();
    els.updated.textContent = `Updated ${n.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
  }
}

async function loadForecast(lat, lon) {
  hideStatus();
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
    showStatus('\u26A0\uFE0F', `Failed to load forecast: ${state.error}. Please try again.`);
  } finally {
    els.refreshBtn.disabled = false;
  }
}

async function searchLocation(q) {
  if (!q || q.trim().length < 2) { els.searchResults.classList.add('hidden'); return; }
  try {
    const r = await fetch(`${CONFIG.geo}?name=${encodeURIComponent(q.trim())}&count=5&language=en&format=json`);
    const j = await r.json();
    const results = j.results || [];
    if (!results.length) { els.searchResults.classList.add('hidden'); return; }
    els.searchResults.innerHTML = results.map((res, idx) =>
      `<li data-idx="${idx}" data-lat="${res.latitude}" data-lon="${res.longitude}" data-name="${res.name}${res.admin1 ? ', ' + res.admin1 : ''}, ${res.country}">
        ${res.name}${res.admin1 ? ', ' + res.admin1 : ''}<span class="country">${res.country}</span>
      </li>`
    ).join('');
    els.searchResults.classList.remove('hidden');
    $$('li', els.searchResults).forEach(li => {
      li.addEventListener('click', () => {
        const name = li.dataset.name;
        const lat = parseFloat(li.dataset.lat);
        const lon = parseFloat(li.dataset.lon);
        state.name = name;
        els.searchInput.value = name.split(',')[0];
        els.searchResults.classList.add('hidden');
        loadForecast(lat, lon);
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
  loadForecast(state.lat, state.lon);

  els.refreshBtn.addEventListener('click', () => loadForecast(state.lat, state.lon));

  const debouncedSearch = debounce(searchLocation, 300);
  els.searchInput.addEventListener('input', e => {
    debouncedSearch(e.target.value);
  });

  els.searchInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') els.searchResults.classList.add('hidden');
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.search')) els.searchResults.classList.add('hidden');
  });
}

document.addEventListener('DOMContentLoaded', init);

// webapp/static/app.js

// ---------------------------------------------------------------------------
// Optional client-side mock mode (?mock=1) for previewing the UI without a DB.
// It intercepts the API fetches and returns sample data. Inert without ?mock=1.
// ---------------------------------------------------------------------------
const MOCK = new URLSearchParams(location.search).has('mock');
if (MOCK) installMock();

const map = L.map('map').setView([37.5, -119], 6);

// USGS Topo tiles (National Map)
L.tileLayer('https://basemap.nationalmap.gov/ArcGIS/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 20,
  attribution: 'Tiles courtesy of the U.S. Geological Survey (USGS)'
}).addTo(map);

L.Control.geocoder().addTo(map);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
// id -> { props, latlng } for the lakes currently loaded in view.
const lakeIndex = new Map();
let selectedLakeId = null;

const LAKE_STYLE = { radius: 6, color: '#1f6fe0', weight: 1.5, fillColor: '#2b7ef7', fillOpacity: 0.6 };
const LAKE_STYLE_ACTIVE = { radius: 9, color: '#b4530a', weight: 2, fillColor: '#ff7f00', fillOpacity: 0.9 };

// ---------------------------------------------------------------------------
// Panel controller
// ---------------------------------------------------------------------------
const panel = document.getElementById('panel');
const panelTitle = document.getElementById('panel-title');
const panelStatus = document.getElementById('panel-status');
const panelList = document.getElementById('panel-list');
const panelDetail = document.getElementById('panel-detail');

function setPanelStatus(html) { panelStatus.innerHTML = html || ''; }

function showList() {
  panel.classList.remove('detail-mode');
  panel.classList.remove('collapsed');
  panelTitle.textContent = 'Waters in view';
  highlightLake(selectedLakeId, false);
  selectedLakeId = null;
}

function togglePanel() { panel.classList.toggle('collapsed'); }

document.getElementById('panel-toggle').addEventListener('click', togglePanel);
document.getElementById('back-btn').addEventListener('click', showList);

// ---------------------------------------------------------------------------
// List rendering
// ---------------------------------------------------------------------------
function fmtElevation(v) { return (v || v === 0) ? `${v} ft` : '—'; }
function fmtArea(v) { return (v || v === 0) ? `${v} ac` : '—'; }

function renderList(features) {
  panelList.innerHTML = '';
  if (!features.length) {
    panelList.innerHTML = '<div class="empty-state">No waters match the current view or filters.</div>';
    return;
  }
  const frag = document.createDocumentFragment();
  features.forEach(f => {
    const p = f.properties || {};
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.id = p.id;
    row.innerHTML =
      `<div class="name">${escapeHtml(p.name || 'Unnamed water')}</div>` +
      `<div class="meta">${fmtElevation(p.elevation)}</div>` +
      `<div class="meta">${fmtArea(p.area)}</div>`;
    row.addEventListener('click', () => selectLake(p.id, { fly: true }));
    row.addEventListener('mouseenter', () => highlightLake(p.id, true));
    row.addEventListener('mouseleave', () => { if (p.id !== selectedLakeId) highlightLake(p.id, false); });
    frag.appendChild(row);
  });
  panelList.appendChild(frag);
}

function showEmptyMessage(msg) {
  panelList.innerHTML = `<div class="empty-state">${escapeHtml(msg)}</div>`;
}

function showLoading(msg) {
  panelList.innerHTML = `<div class="empty-state"><span class="spinner"></span>${escapeHtml(msg)}</div>`;
}

// ---------------------------------------------------------------------------
// Detail rendering (relocated from the old popup)
// ---------------------------------------------------------------------------
const OBS_HEADERS = ['Date', 'Species', 'Count', 'Max (in)', 'Avg (in)', 'Min (in)', 'Type', 'Source', 'Notes', ''];

function linkifyUrls(text) {
  if (!text) return '';
  const urlRegex = /(https?:\/\/[^\s<>"']*[^\s<>"'.,!?;:()])/g;
  return escapeHtml(text).replace(/&lt;/g, '<').replace(/&gt;/g, '>') // keep escaped, then linkify raw urls
    .replace(urlRegex, (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">Link</a>`);
}

function observationsGrid(props, obs) {
  let html = '<div class="obs-table"><div class="obs-grid">';
  html += OBS_HEADERS.map(h => `<div class="hd">${h}</div>`).join('');

  // Inline add row
  html += `
    <div><input type="date" id="new-date"></div>
    <div><input type="text" id="new-species" placeholder="Species"></div>
    <div><input type="number" id="new-count" placeholder="#"></div>
    <div><input type="number" id="new-max" step="0.01" placeholder="Max"></div>
    <div><input type="number" id="new-avg" step="0.01" placeholder="Avg"></div>
    <div><input type="number" id="new-min" step="0.01" placeholder="Min"></div>
    <div><input type="text" id="new-type" placeholder="Type"></div>
    <div><input type="text" id="new-source" placeholder="Source"></div>
    <div><input type="text" id="new-notes" placeholder="Notes"></div>
    <div><button class="primary" onclick="addObservation(${props.id})">Add</button></div>`;

  if (obs && obs.length) {
    obs.forEach(o => {
      let max = o.length_max ?? null, avg = o.length_avg ?? null, min = o.length_min ?? null;
      if (avg == null && max != null && min != null) avg = (max + min) / 2;
      const num = v => (v == null ? '—' : Number(v).toFixed(2));
      html += `
        <div>${escapeHtml(o.date_string || '')}</div>
        <div><strong>${escapeHtml(o.species || '')}</strong></div>
        <div>${o.count ?? '—'}</div>
        <div>${num(max)}</div>
        <div>${num(avg)}</div>
        <div>${num(min)}</div>
        <div>${escapeHtml(o.type || '')}</div>
        <div>${linkifyUrls(o.source)}</div>
        <div class="notes">${escapeHtml(o.notes || '')}</div>
        <div><button onclick="rmvObservation(${o.id})" title="Delete observation">✕</button></div>`;
    });
  }
  html += '</div></div>';
  return html;
}

function renderDetail(props, obs, { loading } = {}) {
  const elev = (props.elevation || props.elevation === 0) ? `${props.elevation} ft` : 'N/A';
  const area = (props.area || props.area === 0) ? `${props.area} acres` : 'N/A';
  const ll = lakeIndex.get(props.id)?.latlng;
  const weather = ll
    ? `&nbsp;·&nbsp;<a href="https://forecast.weather.gov/MapClick.php?lon=${ll.lng}&lat=${ll.lat}" target="_blank" rel="noopener">Go to Weather ↗</a>`
    : '';

  let html = `<div class="section-title" style="font-size:16px">${escapeHtml(props.name || 'Lake')}</div>`;
  html += `<div class="detail-meta">Elevation: ${elev} · Area: ${area}${weather}</div>`;
  html += `<div class="section-title">Observations</div>`;
  html += loading
    ? `<div class="empty-state"><span class="spinner"></span>Loading observations…</div>`
    : observationsGrid(props, obs);
  panelDetail.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Selection / map sync
// ---------------------------------------------------------------------------
function selectLake(id, { fly } = {}) {
  const entry = lakeIndex.get(id);
  if (!entry) return;
  highlightLake(selectedLakeId, false);
  selectedLakeId = id;
  highlightLake(id, true);

  panel.classList.add('detail-mode');
  panel.classList.remove('collapsed');
  panelTitle.textContent = entry.props.name || 'Lake';
  setPanelStatus('');
  renderDetail(entry.props, null, { loading: true });

  if (fly && entry.latlng) {
    map.setView(entry.latlng, Math.max(map.getZoom(), 11), { animate: true });
  }
  loadObservations(entry.props);
}

function highlightLake(id, on) {
  if (id == null) return;
  const layer = findLayerById(id);
  if (layer && layer.setStyle) layer.setStyle(on ? LAKE_STYLE_ACTIVE : LAKE_STYLE);
}

function findLayerById(id) {
  let found = null;
  lakesLayer.eachLayer(layer => {
    if (layer.feature && layer.feature.properties && layer.feature.properties.id === id) found = layer;
  });
  return found;
}

// ---------------------------------------------------------------------------
// Lakes layer
// ---------------------------------------------------------------------------
const lakesLayer = L.geoJSON(null, {
  pointToLayer: (feature, latlng) => L.circleMarker(latlng, LAKE_STYLE),
  style: { color: '#2b7ef7', weight: 1, fillOpacity: 0.4 },
  onEachFeature: (feature, layer) => {
    const props = feature.properties || {};
    layer.on('click', () => selectLake(props.id, { fly: false }));
    layer.on('mouseover', () => { if (props.id !== selectedLakeId) highlightLake(props.id, true); });
    layer.on('mouseout', () => { if (props.id !== selectedLakeId) highlightLake(props.id, false); });
  }
}).addTo(map);

// ---------------------------------------------------------------------------
// Trails layer (popups kept as-is)
// ---------------------------------------------------------------------------
let selectedTrail = null;
const trailsLayer = L.geoJSON(null, {
  style: { color: '#ff7f00', weight: 4, opacity: 0.7, fillOpacity: 0 },
  onEachFeature: (feature, layer) => {
    const props = feature.properties || {};
    let popupContent = `<div><strong>${escapeHtml(props.name || 'Trail')}</strong><br>`;
    popupContent += `Trail #: ${escapeHtml(String(props.trail_number || 'N/A'))}<br>`;
    popupContent += `Length: ${props.length ? props.length.toFixed(2) + ' mi' : 'N/A'}<br>`;
    popupContent += `Owner: ${escapeHtml(props.owner || 'N/A')}<br></div>`;
    layer.bindPopup(popupContent, { maxWidth: 400, minWidth: 200 });

    layer.on('mouseover', function () { this.setStyle({ weight: 6, opacity: 1, color: '#ff4500' }); this.bringToFront(); });
    layer.on('mouseout', function () { if (selectedTrail !== layer) this.setStyle({ weight: 4, opacity: 0.7, color: '#ff7f00' }); });
    layer.on('click', () => {
      if (selectedTrail) selectedTrail.setStyle({ weight: 4, opacity: 0.7, color: '#ff7f00' });
      selectedTrail = layer;
      layer.setStyle({ weight: 6, opacity: 1, color: '#ff0000' });
      layer.bringToFront();
      layer.openPopup();
    });
  }
}).addTo(map);

function checkAndLoadTrails() {
  if (map.getZoom() < 8) { trailsLayer.clearLayers(); selectedTrail = null; return; }
  const b = map.getBounds();
  const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(',');
  fetch('/api/trails?bbox=' + encodeURIComponent(bbox))
    .then(r => { if (!r.ok) throw new Error('Trails request failed'); return r.json(); })
    .then(fc => {
      trailsLayer.clearLayers();
      selectedTrail = null;
      if (fc.features && fc.features.length) trailsLayer.addData(fc);
    })
    .catch(err => console.error('Error loading trails:', err));
}

// ---------------------------------------------------------------------------
// Observation actions
// ---------------------------------------------------------------------------
function currentDetailProps() {
  const entry = lakeIndex.get(selectedLakeId);
  return entry ? entry.props : null;
}

function loadObservations(props) {
  fetch(`/api/lakes/${props.id}/observations`)
    .then(r => r.json())
    .then(obs => { if (selectedLakeId === props.id) renderDetail(props, obs); })
    .catch(err => { console.error(err); panelDetail.innerHTML = '<div class="empty-state">Error loading observations.</div>'; });
}

async function rmvObservation(observation_id) {
  try {
    await fetch(`/api/observations/${observation_id}/remove`).then(r => r.json());
    const props = currentDetailProps();
    if (props) loadObservations(props);
  } catch (err) { console.error(err); alert('Error deleting observation'); }
}

async function addObservation(water_body_id) {
  const val = id => document.getElementById(id).value;
  const payload = {
    date: val('new-date'),
    species: val('new-species'),
    count: parseInt(val('new-count')) || null,
    length_max: parseFloat(val('new-max')) || null,
    length_avg: parseFloat(val('new-avg')) || null,
    length_min: parseFloat(val('new-min')) || null,
    type: val('new-type'),
    source: val('new-source'),
    notes: val('new-notes')
  };
  if (!payload.species) { alert('Species is required'); return; }
  try {
    const res = await fetch(`/api/lakes/${water_body_id}/new_observation`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    if (!res.ok) { console.error('Failed to add observation:', await res.text()); alert('Failed to add observation'); return; }
    const props = currentDetailProps();
    if (props) loadObservations(props);
  } catch (err) { console.error('Error adding observation:', err); }
}

// ---------------------------------------------------------------------------
// Loading lakes -> markers + list
// ---------------------------------------------------------------------------
function buildParamsWithBbox(bbox) {
  const species = document.getElementById('species').value.trim();
  const min_length = document.getElementById('min_length').value.trim();
  const params = new URLSearchParams();
  if (species) params.set('species', species);
  if (min_length) params.set('min_length', min_length);
  if (bbox) params.set('bbox', bbox);
  const s = params.toString();
  return s ? '?' + s : '';
}

function indexFeatures(fc) {
  lakeIndex.clear();
  (fc.features || []).forEach(f => {
    const p = f.properties || {};
    let latlng = null;
    if (f.geometry && f.geometry.type === 'Point') {
      latlng = L.latLng(f.geometry.coordinates[1], f.geometry.coordinates[0]);
    }
    lakeIndex.set(p.id, { props: p, latlng });
  });
}

function checkAndLoadLakes() {
  const b = map.getBounds();
  const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(',');
  const params = buildParamsWithBbox(bbox);

  // Only refresh the list when we're in list mode; keep detail open otherwise.
  const inList = !panel.classList.contains('detail-mode');
  if (inList) { setPanelStatus('<span class="spinner"></span>checking…'); showLoading('Checking visible waters…'); }

  fetch('/api/lakes/count' + params)
    .then(r => { if (!r.ok) throw new Error('Count request failed'); return r.json(); })
    .then(data => {
      const count = data.count || 0;
      if (count === 0) {
        lakesLayer.clearLayers(); lakeIndex.clear();
        setPanelStatus('0 waters');
        if (inList) showEmptyMessage('No waters in view (or matching filters).');
      } else if (count <= 100) {
        if (inList) setPanelStatus(`<span class="spinner"></span>loading ${count}…`);
        fetch('/api/lakes' + params)
          .then(r => { if (!r.ok) throw new Error('Lakes request failed'); return r.json(); })
          .then(fc => {
            lakesLayer.clearLayers();
            lakesLayer.addData(fc);
            indexFeatures(fc);
            setPanelStatus(`${count} water${count === 1 ? '' : 's'}`);
            if (inList) renderList(fc.features || []);
            else if (selectedLakeId != null) highlightLake(selectedLakeId, true);
          })
          .catch(err => { console.error(err); setPanelStatus('error'); if (inList) showEmptyMessage('Error loading waters.'); });
      } else {
        lakesLayer.clearLayers(); lakeIndex.clear();
        setPanelStatus(`${count} waters`);
        if (inList) showEmptyMessage(`${count} waters in view — zoom in or tighten filters to list individual waters (≤100).`);
      }
    })
    .catch(err => { console.error(err); setPanelStatus('error'); if (inList) showEmptyMessage('Error checking waters count.'); });
}

// ---------------------------------------------------------------------------
// Create new water body (right-click)
// ---------------------------------------------------------------------------
map.on('contextmenu', e => {
  const name = prompt('Enter name for new body of water:', '');
  if (name && name.trim()) createNewWaterBody(name.trim(), e.latlng);
});

function createNewWaterBody(name, latlng) {
  fetch('/api/lakes/new_water', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, latitude: latlng.lat, longitude: latlng.lng })
  })
    .then(r => { if (!r.ok) throw new Error('Failed to create water body'); return r.json(); })
    .then(() => { setPanelStatus(`Created “${name}”`); checkAndLoadLakes(); })
    .catch(err => { console.error('Error creating water body:', err); alert('Error creating water body: ' + err.message); });
}

// ---------------------------------------------------------------------------
// Controls / events
// ---------------------------------------------------------------------------
document.getElementById('controls-toggle').addEventListener('click', () => {
  document.getElementById('controls').classList.toggle('collapsed');
});
document.getElementById('apply').addEventListener('click', () => { showList(); checkAndLoadLakes(); });
document.getElementById('reset').addEventListener('click', () => {
  document.getElementById('species').value = '';
  document.getElementById('min_length').value = '';
  showList();
  checkAndLoadLakes();
});
['species', 'min_length'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') { showList(); checkAndLoadLakes(); } });
});

map.on('moveend', () => { checkAndLoadLakes(); checkAndLoadTrails(); });
map.on('resize', () => { checkAndLoadLakes(); checkAndLoadTrails(); });

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// initial load
checkAndLoadLakes();
checkAndLoadTrails();

// ---------------------------------------------------------------------------
// Mock implementation (only wired when ?mock=1)
// ---------------------------------------------------------------------------
function installMock() {
  const lakes = [
    { id: 1, name: 'Mono Lake', elevation: 6378, area: 70000, lng: -119.0, lat: 38.0 },
    { id: 2, name: 'Lake Tahoe', elevation: 6225, area: 122000, lng: -120.04, lat: 39.09 },
    { id: 3, name: 'Convict Lake', elevation: 7850, area: 170, lng: -118.85, lat: 37.59 },
    { id: 4, name: 'June Lake', elevation: 7616, area: 160, lng: -119.07, lat: 37.78 },
    { id: 5, name: 'Crowley Lake', elevation: 6781, area: 5280, lng: -118.74, lat: 37.66 }
  ];
  const obs = {
    1: [{ date_string: '06/01/2026', species: 'Brown Trout', count: 3, length_max: 18.5, length_avg: 15, length_min: 12, type: 'angler', source: 'https://example.com/report', notes: 'Evening bite near inlet', id: 101 }],
    2: [{ date_string: '05/20/2026', species: 'Rainbow Trout', count: 5, length_max: 14, length_avg: 11, length_min: 9, type: 'survey', source: 'CDFW survey', notes: '', id: 102 },
        { date_string: '05/02/2026', species: 'Mackinaw', count: 1, length_max: 26, length_avg: 26, length_min: 26, type: 'angler', source: '', notes: 'Deep troll', id: 103 }],
    3: [], 4: [], 5: []
  };
  const json = (body, ok = true) => Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });
  const feature = l => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [l.lng, l.lat] }, properties: { id: l.id, name: l.name, elevation: l.elevation, area: l.area } });

  const realFetch = window.fetch.bind(window);
  window.fetch = (url, opts) => {
    const u = String(url);
    if (u.includes('/api/lakes/count')) return json({ count: lakes.length });
    if (/\/api\/lakes\/\d+\/observations/.test(u)) {
      const id = parseInt(u.match(/lakes\/(\d+)\/observations/)[1]);
      return json(obs[id] || []);
    }
    if (/\/api\/lakes\/\d+\/new_observation/.test(u)) {
      const id = parseInt(u.match(/lakes\/(\d+)\//)[1]);
      const body = JSON.parse(opts.body);
      (obs[id] = obs[id] || []).unshift({ ...body, date_string: body.date || '', id: Math.floor(Date.now() % 100000) });
      return json({ success: 1 });
    }
    if (/\/api\/observations\/\d+\/remove/.test(u)) {
      const oid = parseInt(u.match(/observations\/(\d+)\//)[1]);
      Object.keys(obs).forEach(k => { obs[k] = obs[k].filter(o => o.id !== oid); });
      return json({ success: 1 });
    }
    if (u.includes('/api/lakes')) return json({ type: 'FeatureCollection', features: lakes.map(feature) });
    if (u.includes('/api/trails')) return json({ type: 'FeatureCollection', features: [] });
    return realFetch(url, opts);
  };
}

// webapp/static/app.js
const map = L.map('map').setView([37.5, -119], 6);
// USGS Topo tiles (National Map)
L.tileLayer('https://basemap.nationalmap.gov/ArcGIS/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 20,
  attribution: 'Tiles courtesy of the U.S. Geological Survey (USGS)'
}).addTo(map);

//some html constant strings
const OBS_TABLE_HEADERS = `<div><strong>Date</strong></div>
                            <div><strong>Species</strong></div>
                            <div><strong>Count</strong></div>
                            <div><strong>L, Max (In.)</strong></div>
                            <div><strong>L, Avg (In.)</strong></div>
                            <div><strong>L, Min (In.)</strong></div>
                            <div><strong>Type</strong></div>
                            <div><strong>Source</strong></div>
                            <div><strong>Notes</strong></div>
                            <div><strong>Action</strong></div>`;

function linkifyUrls(text) {
  const urlRegex = /(https?:\/\/[^\s<>"']*[^\s<>"'.,!?;:()])/g;

  return text.replace(urlRegex, (url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">Link</a>`;
  });
}

function observationTableContent(props, obs){
  let content = `<div style="
                display:grid;
                grid-template-columns: 120px 80px 70px 90px 90px 90px 100px 80px 125px 1fr;
                gap:6px;
                font-size:14px;
                ">`;
  content += OBS_TABLE_HEADERS;

  content += `<div><input type="date" id="new-date" style="width:100%"></div>
        <div><input type="text" id="new-species" placeholder="Species" style="width:100%"></div>
        <div><input type="number" id="new-count" placeholder="Count" style="width:100%"></div>
        <div><input type="number" id="new-max" placeholder="Max" step="0.01" style="width:100%"></div>
        <div><input type="number" id="new-avg" placeholder="Avg" step="0.01" style="width:100%"></div>
        <div><input type="number" id="new-min" placeholder="Min" step="0.01" style="width:100%"></div>
        <div><input type="text" id="new-type" placeholder="Type" style="width:100%"></div>
        <div><input type="text" id="new-source" placeholder="Source" style="width:100%"></div>
        <div><input type="text" id="new-notes" placeholder="Notes" style="width:70%"></div>
        <div><button onclick="addObservation(${props.id})">Add</button></div>`;
   if (obs && obs.length > 0) {
        obs.forEach(o => {
            let date_string = o.date_string ? o.date_string : "";

            let max = o.length_max ?? "NA";
            let avg = o.length_avg ?? "NA";
            let min = o.length_min ?? "NA";
            if (avg == "NA" && max != "NA" && min != "NA"){
              avg = (max+min)/2;
            }

            
            let source_str = linkifyUrls(o.source);
            content += `
                <div>${date_string}</div>
                <div><strong>${o.species}</strong></div>
                <div>${o.count}</div>
                <div>${max !== "NA" ? max.toFixed(2) : max}</div>
                <div>${avg !== "NA" ? avg.toFixed(2) : avg}</div>
                <div>${min !== "NA" ? min.toFixed(2) : min}</div>
                <div>${o.type || ""}</div>
                <div>${source_str}</div>
                <div class="observation_notes">${o.notes || ""}</div>
                <div><button onclick="editObservation(${o.id})">Edit</button><button onclick="rmvObservation(${o.id})">-</button></div>
            `;
        });
    }
    
    content += '</div>'; 
    return content;
}

function bowPopupContent(props, obs){
    let content = `<div><strong>${props.name || 'Lake'}</strong>`;
    content += ` Elevation: ${props.elevation || '?'}`
    if (activePopupState && activePopupState.id === props.id && activePopupState.latlng) {
      content += `<a href="https://forecast.weather.gov/MapClick.php?lon=${activePopupState.latlng.lng}&lat=${activePopupState.latlng.lat}" target="_blank">Go to Weather</a>`;
    }
    content+= `</div>`;
    content += `<div class="observation_list" id="bow_${props.id}_observations">`;

    content += observationTableContent(props, obs);

    content += '</div>';
    return content;
}


let activePopupState = null;

function getLayerLatLng(layer) {
  if (typeof layer.getLatLng === 'function') {
    return layer.getLatLng();
  }
  if (typeof layer.getBounds === 'function') {
    return layer.getBounds().getCenter();
  }
  return null;
}

function findLayerById(id) {
  let found = null;
  lakesLayer.eachLayer(layer => {
    if (layer.feature && layer.feature.properties && layer.feature.properties.id === id) {
      found = layer;
    }
  });
  return found;
}

function reopenActivePopup() {
  if (!activePopupState) {
    return;
  }
  const layer = findLayerById(activePopupState.id);
  if (layer) {
    layer.openPopup();
    return;
  }
  if (activePopupState.latlng && activePopupState.content) {
    L.popup({maxWidth: '600px', minWidth: '200px'})
      .setLatLng(activePopupState.latlng)
      .setContent(activePopupState.content)
      .openOn(map);
  }
}

let lakesLayer = L.geoJSON(null, {
  style: {
    color: '#2b7ef7',
    weight: 1,
    fillOpacity: 0.4
  },
  onEachFeature: function(feature, layer) {
    const props = feature.properties || {};

    layer.bindPopup(bowPopupContent(props, []), {maxWidth: '600px', minWidth: '200px'});

    layer.on('popupopen', function(e) {
      fetchObservations(props, e.popup);
      activePopupState = {
        id: props.id,
        latlng: e.popup.getLatLng(),
        content: e.popup.getContent()
      };
    });

    layer.on('popupclose', function() {
      if (activePopupState && activePopupState.id === props.id) {
        activePopupState = null;
      }
    });

    layer.on('click', () => {
      layer.openPopup();
    });
  }
}).addTo(map);

let trailsLayer = L.geoJSON(null, {
  style: {
    color: '#ff7f00',
    weight: 4,
    opacity: 0.7,
    fillOpacity: 0
  },
  onEachFeature: function(feature, layer) {
    const props = feature.properties || {};
    let popupContent = `<div class="popup-content"><strong>${props.name || 'Trail'}</strong><br>`;
    popupContent += `Trail #: ${props.trail_number || 'N/A'}<br>`;
    popupContent += `Length: ${props.length ? props.length.toFixed(2) + ' mi' : 'N/A'}<br>`;
    popupContent += `Owner: ${props.owner || 'N/A'}<br>`;
    
    layer.bindPopup(popupContent, {maxWidth: '400px', minWidth: '200px'});
    
    layer.on('mouseover', function() {
      this.setStyle({
        weight: 6,
        opacity: 1,
        color: '#ff4500'
      });
      this.bringToFront();
    });
    
    layer.on('mouseout', function() {
      if (selectedTrail !== layer) {
        this.setStyle({
          weight: 4,
          opacity: 0.7,
          color: '#ff7f00'
        });
      }
    });
    
    layer.on('click', (e) => {
      // Deselect previous trail
      if (selectedTrail) {
        selectedTrail.setStyle({
          weight: 4,
          opacity: 0.7,
          color: '#ff7f00'
        });
      }
      
      // Select new trail
      selectedTrail = layer;
      layer.setStyle({
        weight: 6,
        opacity: 1,
        color: '#ff0000'
      });
      layer.bringToFront();
      layer.openPopup();
    });
  }
}).addTo(map);

let selectedTrail = null;

function checkAndLoadTrails() {
  // Only load trails if zoom level is 8 or larger
  const zoomLevel = map.getZoom();
  if (zoomLevel < 8) {
    trailsLayer.clearLayers();
    selectedTrail = null;
    return;
  }

  const b = map.getBounds();
  // bbox order: minx,miny,maxx,maxy (west,south,east,north)
  const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(',');

  fetch('/api/trails?bbox=' + encodeURIComponent(bbox))
    .then(r => {
      if (!r.ok) throw new Error('Trails request failed');
      return r.json();
    })
    .then(fc => {
      trailsLayer.clearLayers();
      selectedTrail = null;
      if (fc.features && fc.features.length > 0) {
        trailsLayer.addData(fc);
      }
    })
    .catch(err => {
      console.error('Error loading trails:', err);
    });
}

function showMessage(msg) {
  let el = document.getElementById('status_message');
  if (!el) {
    el = document.createElement('div');
    el.id = 'status_message';
    el.style.marginTop = '6px';
    el.style.fontSize = '90%';
    document.getElementById('controls').appendChild(el);
  }
  el.innerHTML = msg;
}

async function rmvObservation(observation_id){
  fetch(`/api/observations/${observation_id}/remove`)
    .then(r => r.json())
    .then(response => {
      console.log(response);
      const popup = map._popup;
      if (popup && popup._content) {
        const activeLayer = findLayerById(activePopupState?.id);
        if (activeLayer) {
          fetchObservations(activeLayer.feature.properties, popup);
        }
      }
    })
    .catch(err => {
      console.error(err);
      alert('Error deleting');
    });
}

async function addObservation(water_body_id) {
    const payload = {
        date: document.getElementById("new-date").value,
        species: document.getElementById("new-species").value,
        count: parseInt(document.getElementById("new-count").value) || null,
        length_max: parseFloat(document.getElementById("new-max").value) || null,
        length_avg: parseFloat(document.getElementById("new-avg").value) || null,
        length_min: parseFloat(document.getElementById("new-min").value) || null,
        type: document.getElementById("new-type").value,
        source: document.getElementById("new-source").value,
        notes: document.getElementById("new-notes").value
    };

    try {
        const response = await fetch(`/api/lakes/${water_body_id}/new_observation`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const err = await response.text();
            console.error("Failed to add observation:", err);
            return;
        }



        const data = await response.json();
        console.log("Observation added:", data);

        const layer = findLayerById(water_body_id);
        if (layer && layer.getPopup()) {
          fetchObservations(layer.feature.properties, layer.getPopup());
        }

    } catch (error) {
        console.error("Error adding observation:", error);
    }
}

function fetchObservations(props, popup) {
  let waterID = props.id;
  fetch(`/api/lakes/${waterID}/observations`)
    .then(r => r.json())
    .then(obs => {
      popup.setContent(bowPopupContent(props, obs));
      if (activePopupState && activePopupState.id === props.id) {
        activePopupState = {
          ...activePopupState,
          content: popup.getContent()
        };
      }
    })
    .catch(err => {
      console.error(err);
      alert('Error loading observations');
    });
}

// Build query string including bbox and filters
function buildParamsWithBbox(bbox) {
  const species = document.getElementById('species').value.trim();
  const min_length = document.getElementById('min_length').value.trim();
  const params = new URLSearchParams();
  if (species) params.set('species', species);
  if (min_length) params.set('min_length', min_length);
  if (bbox) params.set('bbox', bbox);
  return params.toString() ? ('?' + params.toString()) : '';
}

function checkAndLoadLakes() {
  const b = map.getBounds();
  // bbox order: minx,miny,maxx,maxy (west,south,east,north)
  const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(',');
  const params = buildParamsWithBbox(bbox);
  const currentPopupState = activePopupState;

  showMessage('Checking visible lakes...');

  fetch('/api/lakes/count' + params)
    .then(r => {
      if (!r.ok) throw new Error('Count request failed');
      return r.json();
    })
    .then(data => {
      const count = data.count || 0;
      if (count === 0) {
        lakesLayer.clearLayers();
        showMessage('No lakes in view (or matching filters).');
      } else if (count <= 100) {
        showMessage(`Loading ${count} lakes in view...`);
        // fetch features for bbox + filters
        fetch('/api/lakes' + params)
          .then(r => {
            if (!r.ok) throw new Error('Lakes request failed');
            return r.json();
          })
          .then(fc => {
            lakesLayer.clearLayers();
            lakesLayer.addData(fc);
            if (currentPopupState) {
              activePopupState = currentPopupState;
              reopenActivePopup();
            }
            showMessage(`Showing ${count} lakes.`);
          })
          .catch(err => {
            console.error(err);
            showMessage('Error loading lakes.');
          });
      } else {
        lakesLayer.clearLayers();
        showMessage(`${count} lakes in view — zoom in or tighten filters to see individual lakes (<=50).`);
      }
    })
    .catch(err => {
      console.error(err);
      showMessage('Error checking lakes count.');
    });
}

document.getElementById('apply').addEventListener('click', () => {
  checkAndLoadLakes();
});
document.getElementById('reset').addEventListener('click', () => {
  document.getElementById('species').value = '';
  document.getElementById('min_length').value = '';
  checkAndLoadLakes();
});

// Re-check whenever the user moves/zooms the map
map.on('moveend', () => {
  checkAndLoadLakes();
  checkAndLoadTrails();
});

// Re-check on resize too
map.on('resize', () => {
  checkAndLoadLakes();
  checkAndLoadTrails();
});

// initial load
checkAndLoadLakes();
checkAndLoadTrails();
// IIFE (keeps everything out of global scope)
(() => {
  "use strict";

  // ====== CONFIG ======
  const API_URL = "https://halifax-transit-data.onrender.com/vehicles";
  const REFRESH_MS = 7000; // API updates ~ every 7 seconds (per assignment doc)

  // ====== MAP SETUP ======
  const map = L.map("theMap").setView([44.650627, -63.59714], 14);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  // Custom bus icon (bus.png is included in the starter zip)
  const busIcon = L.icon({
    iconUrl: "bus.png",
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -14],
  });

  // Layer reference so we can remove/replace markers on each refresh
  let vehiclesLayer = null;

  // Prevent overlapping refresh calls
  let fetchInProgress = false;

  // ====== OPTIONAL UI (dynamic filtering) ======
  // Routes 1..10 (no loops: created with Array.from)
  const ROUTES_1_TO_10 = Array.from({ length: 10 }, (_, i) => i + 1);

  // Default: show all 1..10
  let selectedRoutes = new Set(ROUTES_1_TO_10);

  // Build a tiny Leaflet control with checkboxes (no forEach/for/while)
  const filterControl = L.control({ position: "topright" });
  filterControl.onAdd = () => {
    const container = L.DomUtil.create("div", "route-filter");
    container.style.background = "rgba(255,255,255,0.92)";
    container.style.padding = "10px";
    container.style.borderRadius = "8px";
    container.style.boxShadow = "0 2px 10px rgba(0,0,0,0.15)";
    container.style.fontFamily = "system-ui, Arial";
    container.style.fontSize = "13px";
    container.style.maxWidth = "220px";

    // Stop map dragging when clicking inside the control
    L.DomEvent.disableClickPropagation(container);

    const title = document.createElement("div");
    title.textContent = "Routes (1–10)";
    title.style.fontWeight = "700";
    title.style.marginBottom = "6px";
    container.appendChild(title);

    const hint = document.createElement("div");
    hint.textContent = "Uncheck to hide routes.";
    hint.style.opacity = "0.75";
    hint.style.marginBottom = "8px";
    container.appendChild(hint);

    const makeCheckboxRow = (routeNum) => {
      const row = document.createElement("label");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.gap = "8px";
      row.style.margin = "2px 0";
      row.style.cursor = "pointer";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = true;

      cb.addEventListener("change", () => {
        const r = Number(routeNum);
        const next = new Set(selectedRoutes);

        cb.checked ? next.add(r) : next.delete(r);
        selectedRoutes = next;

        // Re-render using the last known layer (fast),
        // but easiest + safest is to just fetch fresh data again:
        updateOnce().catch(console.error);
      });

      const text = document.createElement("span");
      text.textContent = `Route ${routeNum}`;

      row.appendChild(cb);
      row.appendChild(text);
      return row;
    };

    // Append rows using reduce (no loops)
    const rowsFragment = ROUTES_1_TO_10.reduce((frag, r) => {
      frag.appendChild(makeCheckboxRow(r));
      return frag;
    }, document.createDocumentFragment());

    container.appendChild(rowsFragment);

    const footer = document.createElement("div");
    footer.style.marginTop = "8px";
    footer.style.opacity = "0.8";
    footer.textContent = `Auto-refresh: ${Math.round(REFRESH_MS / 1000)}s`;
    container.appendChild(footer);

    return container;
  };
  filterControl.addTo(map);

  // ====== DATA HELPERS ======

  // The API is GTFS-realtime-like JSON. Common structure:
  // { entity: [ { id, vehicle: { trip:{routeId}, position:{latitude,longitude,bearing,...}, timestamp, vehicle:{id/label} } } ] }
  // This is written defensively in case a property is missing.
  const getEntities = (data) => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.entity)) return data.entity;
    if (Array.isArray(data.vehicles)) return data.vehicles;
    return [];
  };

  const toNumberOrNull = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const pickRouteId = (entity) => {
    const route =
      entity?.vehicle?.trip?.routeId ??
      entity?.vehicle?.trip?.route_id ??
      entity?.trip?.routeId ??
      entity?.trip?.route_id ??
      entity?.routeId ??
      entity?.route_id ??
      null;

    // Some feeds use strings like "1", others "01", etc.
    // Convert to number when possible.
    return toNumberOrNull(route) ?? route;
  };

  const pickLatLng = (entity) => {
    const lat =
      entity?.vehicle?.position?.latitude ??
      entity?.position?.latitude ??
      entity?.lat ??
      null;

    const lng =
      entity?.vehicle?.position?.longitude ??
      entity?.position?.longitude ??
      entity?.lon ??
      entity?.lng ??
      null;

    const latN = toNumberOrNull(lat);
    const lngN = toNumberOrNull(lng);

    return latN !== null && lngN !== null ? { lat: latN, lng: lngN } : null;
  };

  const pickBearing = (entity) => {
    const b =
      entity?.vehicle?.position?.bearing ??
      entity?.position?.bearing ??
      entity?.bearing ??
      null;

    // Leaflet.RotatedMarker uses rotationAngle in degrees
    return toNumberOrNull(b) ?? 0;
  };

  const pickVehicleLabel = (entity) => {
    return (
      entity?.vehicle?.vehicle?.label ??
      entity?.vehicle?.vehicle?.id ??
      entity?.vehicle?.id ??
      entity?.id ??
      "Unknown"
    );
  };

  // ====== CORE PIPELINE ======

  const fetchRawData = async () => {
    const res = await fetch(API_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  };

  const filterRoutes1to10AndUI = (entities) => {
    // First: required filter 1..10
    // Second: optional UI filter (subset of 1..10)
    return entities
      .map((e) => ({ e, route: pickRouteId(e) }))
      .filter(({ route }) => {
        const r = toNumberOrNull(route);
        // Required: keep only 1..10
        if (r === null) return false;
        if (r < 1 || r > 10) return false;
        // UI selection
        return selectedRoutes.has(r);
      })
      .map(({ e }) => e);
  };

  const toGeoJSON = (entities) => {
    const features = entities
      .map((entity) => {
        const routeId = pickRouteId(entity);
        const pos = pickLatLng(entity);
        if (!pos) return null;

        const bearing = pickBearing(entity);
        const label = pickVehicleLabel(entity);

        return {
          type: "Feature",
          properties: {
            routeId,
            label,
            bearing,
            // Keep raw-ish bits for popups
            timestamp:
              entity?.vehicle?.timestamp ??
              entity?.timestamp ??
              null,
          },
          geometry: {
            type: "Point",
            // GeoJSON coordinates are [lng, lat]
            coordinates: [pos.lng, pos.lat],
          },
        };
      })
      .filter((f) => f !== null);

    return {
      type: "FeatureCollection",
      features,
    };
  };

  const renderGeoJSON = (geojson) => {
    // Remove previous layer to "refresh" marker positions
    if (vehiclesLayer) {
      map.removeLayer(vehiclesLayer);
      vehiclesLayer = null;
    }

    vehiclesLayer = L.geoJSON(geojson, {
      pointToLayer: (feature, latlng) => {
        // RotatedMarker plugin: rotationAngle option
        return L.marker(latlng, {
          icon: busIcon,
          rotationAngle: feature?.properties?.bearing ?? 0,
          rotationOrigin: "center center",
        });
      },
      onEachFeature: (feature, layer) => {
        const r = feature?.properties?.routeId ?? "Unknown";
        const label = feature?.properties?.label ?? "Unknown";
        const bearing = feature?.properties?.bearing ?? 0;

        const html = `
          <div style="font-family:system-ui, Arial; font-size:13px;">
            <div style="font-weight:700;">Bus: ${label}</div>
            <div>Route: <b>${r}</b></div>
            <div>Bearing: ${bearing}&deg;</div>
          </div>
        `;

        layer.bindPopup(html);
      },
    }).addTo(map);
  };

  const updateOnce = async () => {
    if (fetchInProgress) return;
    fetchInProgress = true;

    try {
      const raw = await fetchRawData();

      // REQ-001: show raw data (you can keep this during demo, remove later if you want)
      console.log("RAW API DATA:", raw);

      const entities = getEntities(raw);
      const filtered = filterRoutes1to10AndUI(entities);

      const geojson = toGeoJSON(filtered);

      // REQ-002: show GeoJSON
      console.log("GEOJSON:", geojson);

      renderGeoJSON(geojson);
    } finally {
      fetchInProgress = false;
    }
  };

  // ====== STARTUP + AUTO REFRESH ======
  updateOnce().catch(console.error);

  setInterval(() => {
    // Important: don’t start a new fetch if the previous one is still running
    if (!fetchInProgress) updateOnce().catch(console.error);
  }, REFRESH_MS);
})();
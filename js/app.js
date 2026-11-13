/**
 * EWS TITEN - Logika Inti Aplikasi Peta Interaktif & Telemetri
 * Tim TRILOGY - SMK Budi Luhur Kota Tangerang (MAGE 12 - IoT)
 */

(function () {
  "use strict";

  // =========================================================================
  // 1. STATE MANAJEMEN APLIKASI
  // =========================================================================
  const state = {
    map: null,
    baseLayers: {},
    overlayLayers: {},
    activeBaseLayer: "osm",
    nodes: new Map(), // Map<id, nodeObject>
    activeNodeId: CONFIG.DEFAULT_NODE.id,
    chartInstance: null,
    chartRange: "6h",
    isAudioEnabled: false,
    audioCtx: null,
    previousLevels: new Map(), // Map<nodeId, { longsor: string, karhutla: string, worst: string }>
    hysteresisCounters: new Map(), // Map<nodeId, { count: number, targetLevel: string }>
    isGatewayOnline: false,
    isNodeOnline: false,
    isBrowserConnected: false,
    lastFirebaseUpdate: 0,
    _liveUpdateCount: 0,       // Berapa kali ews_data/nodes berubah sejak halaman dibuka
    _lastEwsDataHash: null,    // Hash data terakhir untuk deteksi perubahan nyata
    isDemoMode: false,
    simulatedOverride: null
  };

  // Level hierarchy weight untuk perbandingan
  const LEVEL_WEIGHT = {
    OFFLINE: 0,
    NORMAL: 1,
    WASPADA: 2,
    SIAGA: 3,
    AWAS: 4
  };

  // =========================================================================
  // 2. HELPER UTILITAS & NULL CHECK
  // =========================================================================
  function getEl(id) {
    const el = document.getElementById(id);
    return el;
  }

  function setText(id, text) {
    const el = getEl(id);
    if (el) el.textContent = text;
    // Sinkronkan juga ke elemen dengan class .sync-<id> (misal pada tab mobile)
    const syncEls = document.querySelectorAll(`.sync-${id}`);
    syncEls.forEach(s => { s.textContent = text; });
  }

  function setHtml(id, html) {
    const el = getEl(id);
    if (el) el.innerHTML = html;
  }

  function formatNumber(val, decimals = 1) {
    if (val === undefined || val === null || isNaN(val)) return "--";
    return Number(val).toFixed(decimals);
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // =========================================================================
  // 3. LOGIKA EVALUASI RISIKO & AMBANG BATAS (SINGLE SOURCE OF TRUTH)
  // =========================================================================
  function evaluateLongsor(miringVal, tanahVal) {
    const T = CONFIG.THRESHOLDS.LONGSOR;
    const miring = Math.abs(parseFloat(miringVal) || 0);
    const tanah = parseFloat(tanahVal) || 0;

    // Awas
    if (miring > T.AWAS.miring || (miring > T.AWAS.miring_alt && tanah > T.AWAS.tanah_alt)) {
      return { level: "AWAS", ...T.AWAS };
    }
    // Siaga
    if (miring >= T.SIAGA.miring || (miring >= T.SIAGA.miring_alt && tanah >= T.SIAGA.tanah_alt)) {
      return { level: "SIAGA", ...T.SIAGA };
    }
    // Waspada
    if (miring >= T.WASPADA.miring || tanah >= T.WASPADA.tanah) {
      return { level: "WASPADA", ...T.WASPADA };
    }
    // Normal
    return { level: "NORMAL", ...T.NORMAL };
  }

  function evaluateKarhutla(suhuVal, udaraVal) {
    const T = CONFIG.THRESHOLDS.KARHUTLA;
    const suhu = parseFloat(suhuVal) || 0;
    const udara = parseFloat(udaraVal) !== undefined ? parseFloat(udaraVal) : 100;

    // Awas
    if (suhu > T.AWAS.suhu || (suhu >= T.AWAS.suhu_alt && udara < T.AWAS.udara_max_alt)) {
      return { level: "AWAS", ...T.AWAS };
    }
    // Siaga
    if (suhu >= T.SIAGA.suhu || (suhu >= T.SIAGA.suhu_alt && udara <= T.SIAGA.udara_max_alt)) {
      return { level: "SIAGA", ...T.SIAGA };
    }
    // Waspada
    if (suhu >= T.WASPADA.suhu || udara <= T.WASPADA.udara_max) {
      return { level: "WASPADA", ...T.WASPADA };
    }
    // Normal
    return { level: "NORMAL", ...T.NORMAL };
  }

  function getWorstLevel(levelA, levelB) {
    const wA = LEVEL_WEIGHT[levelA] || 0;
    const wB = LEVEL_WEIGHT[levelB] || 0;
    return wA >= wB ? levelA : levelB;
  }

  function getLevelColor(level) {
    switch (level) {
      case "AWAS": return "#DC2626";
      case "SIAGA": return "#F97316";
      case "WASPADA": return "#FFB800";
      case "NORMAL": return "#10B981";
      default: return "#64748B";
    }
  }

  // =========================================================================
  // 4. INISIALISASI PETA & LAYER LEAFLET
  // =========================================================================
  function initMap() {
    if (typeof L === "undefined") {
      console.warn("Pustaka Leaflet (L) sedang dimuat. Menunggu...");
      setTimeout(initMap, 200);
      return;
    }

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const hasZoomedSession = sessionStorage.getItem("titen_zoom_done") === "1";

    const defaultNode = CONFIG.DEFAULT_NODE;
    const startCenter = (prefersReducedMotion || hasZoomedSession)
      ? [defaultNode.lat, defaultNode.lng]
      : CONFIG.MAP.INDONESIA_CENTER;
    const startZoom = (prefersReducedMotion || hasZoomedSession)
      ? CONFIG.MAP.TARGET_ZOOM
      : CONFIG.MAP.INDONESIA_ZOOM;

    state.map = L.map("map", {
      center: startCenter,
      zoom: startZoom,
      minZoom: CONFIG.MAP.MIN_ZOOM,
      maxZoom: CONFIG.MAP.MAX_ZOOM,
      zoomControl: false // Kita gunakan tombol kontrol kustom di kanan bawah
    });

    // Layer Dasar 1: OpenStreetMap (Standar)
    state.baseLayers.osm = L.tileLayer(CONFIG.LAYERS.OSM.url, {
      attribution: CONFIG.LAYERS.OSM.attribution,
      maxZoom: CONFIG.LAYERS.OSM.maxZoom
    }).addTo(state.map);

    // Layer Dasar 2: Esri Satellite
    state.baseLayers.satellite = L.tileLayer(CONFIG.LAYERS.ESRI_SATELLITE.url, {
      attribution: CONFIG.LAYERS.ESRI_SATELLITE.attribution,
      maxZoom: CONFIG.LAYERS.ESRI_SATELLITE.maxZoom
    });

    // Layer Group untuk Node Markers
    state.overlayLayers.nodes = L.featureGroup().addTo(state.map);

    // Layer Tambahan: InaRISK Bahaya Longsor 30m
    state.overlayLayers.inarisk = L.tileLayer(CONFIG.LAYERS.INARISK_LONGSOR.url, {
      attribution: CONFIG.LAYERS.INARISK_LONGSOR.attribution,
      minZoom: CONFIG.LAYERS.INARISK_LONGSOR.minZoom,
      maxZoom: CONFIG.LAYERS.INARISK_LONGSOR.maxZoom,
      opacity: CONFIG.LAYERS.INARISK_LONGSOR.opacity
    });

    // Layer Tambahan: RainViewer Radar Cuaca
    initRainViewerLayer();

    // Layer Tambahan: NASA FIRMS (Opsional)
    initFirmsLayer();

    // Jalankan Animasi Pembuka Zoom jika belum pernah per sesi
    if (!prefersReducedMotion && !hasZoomedSession) {
      runOpeningZoomAnimation();
    }

    // Pastikan ukuran viewport peta Leaflet tersinkronisasi presisi dengan layout dashboard
    window.addEventListener("resize", () => {
      if (state.map) {
        state.map.invalidateSize();
      }
    });

    setTimeout(() => {
      if (state.map) {
        state.map.invalidateSize();
      }
    }, 250);

    // Pasang listener klik peta
    state.map.on("click", (e) => {
      // Jika klik area kosong di mobile, collapse bottom sheet ke peek
      if (window.innerWidth <= 768) {
        const panel = getEl("nodeDetailPanel");
        if (panel && !panel.classList.contains("collapsed")) {
          // Boleh tetap terlihat atau di-toggle
        }
      }
    });

    // Update label visibilitas berdasarkan zoom
    state.map.on("zoomend", updateMarkerLabelsVisibility);
  }

  function runOpeningZoomAnimation() {
    const banner = getEl("openingZoomBanner");
    const btnSkip = getEl("btnSkipZoom");

    if (banner) banner.classList.remove("hidden");

    let isSkipped = false;
    const targetNode = CONFIG.DEFAULT_NODE;

    function finishZoom() {
      sessionStorage.setItem("titen_zoom_done", "1");
      if (banner) banner.classList.add("hidden");
    }

    if (btnSkip) {
      btnSkip.onclick = () => {
        isSkipped = true;
        state.map.stop();
        state.map.setView([targetNode.lat, targetNode.lng], CONFIG.MAP.TARGET_ZOOM);
        finishZoom();
      };
    }

    setTimeout(() => {
      if (isSkipped) return;
      state.map.flyTo([targetNode.lat, targetNode.lng], CONFIG.MAP.TARGET_ZOOM, {
        duration: CONFIG.MAP.FLY_DURATION,
        easeLinearity: 0.25
      });

      state.map.once("moveend", () => {
        finishZoom();
      });
    }, 400);
  }

  function initRainViewerLayer() {
    fetch(CONFIG.LAYERS.RAINVIEWER.api)
      .then(res => res.json())
      .then(data => {
        if (data && data.radar && data.radar.past && data.radar.past.length > 0) {
          const latestPast = data.radar.past[data.radar.past.length - 1];
          const tileUrl = CONFIG.LAYERS.RAINVIEWER.tileTemplate.replace("{ts}", latestPast.time);
          state.overlayLayers.radar = L.tileLayer(tileUrl, {
            attribution: CONFIG.LAYERS.RAINVIEWER.attribution,
            maxNativeZoom: CONFIG.LAYERS.RAINVIEWER.maxNativeZoom || 7,
            maxZoom: CONFIG.LAYERS.RAINVIEWER.maxZoom || 19,
            opacity: CONFIG.LAYERS.RAINVIEWER.opacity
          });
        }
      })
      .catch(err => {
        console.warn("RainViewer layer notice: Layanan radar cuaca tidak tersedia.", err);
      });
  }

  function initFirmsLayer() {
    state.overlayLayers.firms = L.layerGroup();
  }

  function fetchFirmsHotspots() {
    const cfg = CONFIG.LAYERS.NASA_FIRMS;
    if (!cfg || !cfg.proxyEndpoint) return;

    const queryUrl = `${cfg.proxyEndpoint}?source=${encodeURIComponent(cfg.source)}&days=${cfg.days || 1}&bbox=${encodeURIComponent(cfg.bboxJatim || "")}`;
    fetch(queryUrl)
      .then(res => res.json())
      .then(data => {
        const notice = getEl("layerNoticeFirms");
        if (data && data.status === "disabled") {
          if (notice) {
            notice.textContent = "Layer titik panas dinonaktifkan (Kunci FIRMS_MAP_KEY belum disetel di Cloudflare Pages).";
            notice.style.display = "block";
          }
          return;
        }
        if (data && data.status === "success" && Array.isArray(data.features)) {
          if (notice) notice.style.display = "none";
          state.overlayLayers.firms.clearLayers();
          data.features.forEach(f => {
            const marker = L.circleMarker([f.lat, f.lng], {
              radius: 7,
              color: "#DC2626",
              weight: 2,
              fillColor: "#F97316",
              fillOpacity: 0.8
            });
            marker.bindPopup(`
              <div style="font-family: var(--font-sans); font-size: 12px; line-height: 1.4;">
                <strong style="color: #DC2626;">Titik Panas Satelit (NASA FIRMS)</strong><br/>
                Satelit: <code>${escapeHtml(data.source || "VIIRS NOAA-20")}</code><br/>
                Intensitas (FRP): <strong>${f.frp || 0} MW</strong><br/>
                Keyakinan: <strong>${escapeHtml(f.confidence)}</strong><br/>
                Waktu: <code>${escapeHtml(f.acq_date)} ${escapeHtml(f.acq_time)} UTC</code>
              </div>
            `);
            state.overlayLayers.firms.addLayer(marker);
          });
        }
      })
      .catch(err => {
        console.warn("NASA FIRMS fetch notice:", err);
        const notice = getEl("layerNoticeFirms");
        if (notice) {
          notice.textContent = "Layer titik panas tidak tersedia saat ini.";
          notice.style.display = "block";
        }
      });
  }

  // =========================================================================
  // 5. MANAJEMEN MARKER NODE DINAMIS (LOOP nodes/)
  // =========================================================================
  function createNodeMarkerIcon(node, worstLevel) {
    const color = getLevelColor(worstLevel);
    const isAwas = worstLevel === "AWAS";
    const pulseRingHtml = isAwas ? '<div class="marker-pulse-ring"></div>' : "";

    const html = `
      <div class="custom-node-marker" title="${escapeHtml(node.nama)} · ${worstLevel}">
        ${pulseRingHtml}
        <div class="marker-pin" style="background-color: ${color};">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"></path>
            <path d="M12 12v9"></path>
            <path d="m8 17 4 4 4-4"></path>
          </svg>
        </div>
        <div class="marker-label">${escapeHtml(node.nama)}</div>
      </div>
    `;

    return L.divIcon({
      className: "node-leaflet-div-icon",
      html: html,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
      popupAnchor: [0, -16]
    });
  }

  function updateMarkerLabelsVisibility() {
    if (!state.map) return;
    const zoom = state.map.getZoom();
    const labels = document.querySelectorAll(".marker-label");
    labels.forEach(el => {
      el.style.display = zoom >= 14 ? "block" : "none";
    });
  }

  function renderOrUpdateNodeMarker(node) {
    const lat = parseFloat(node.lat);
    const lng = parseFloat(node.lng);
    if (isNaN(lat) || isNaN(lng)) return;

    // Evaluasi status node
    const isStale = isDataStale(node.latest ? node.latest.ts : null);
    const isOnline = state.isNodeOnline && !isStale && !!node.latest;
    let worstLevel = "OFFLINE";
    let longsorStatus = { level: "OFFLINE", ringkasan: "Offline" };
    let karhutlaStatus = { level: "OFFLINE", ringkasan: "Offline" };

    if (isOnline) {
      longsorStatus = evaluateLongsor(node.latest.kemiringan_x, node.latest.kelembapan_tanah);
      karhutlaStatus = evaluateKarhutla(node.latest.suhu, node.latest.kelembapan_udara);
      worstLevel = getWorstLevel(longsorStatus.level, karhutlaStatus.level);
    }

    // Deteksi kenaikan level untuk alarm audio
    checkLevelIncreaseAndPlayAlarm(node.id, worstLevel);

    // Buat atau perbarui marker Leaflet
    const icon = createNodeMarkerIcon(node, worstLevel);

    if (node._leafletMarker) {
      node._leafletMarker.setLatLng([lat, lng]);
      node._leafletMarker.setIcon(icon);
    } else {
      const marker = L.marker([lat, lng], { icon: icon });
      marker.on("click", () => {
        selectActiveNode(node.id);
        state.map.setView([lat, lng], Math.max(state.map.getZoom(), 16), { animate: true });
      });
      state.overlayLayers.nodes.addLayer(marker);
      node._leafletMarker = marker;
    }

    // Update panel jika node ini sedang aktif dibuka
    if (state.activeNodeId === node.id) {
      renderActiveNodeDetailPanel(node, longsorStatus, karhutlaStatus, worstLevel, isStale);
    }

    updateGlobalStatusSummary();
    updateMarkerLabelsVisibility();
  }

  function selectActiveNode(nodeId) {
    state.activeNodeId = nodeId;
    const node = state.nodes.get(nodeId);
    if (!node) return;

    const isStale = isDataStale(node.latest ? node.latest.ts : null);
    const isOnline = state.isNodeOnline && !isStale && !!node.latest;
    let worstLevel = "OFFLINE";
    let longsorStatus = { level: "OFFLINE" };
    let karhutlaStatus = { level: "OFFLINE" };

    if (isOnline) {
      longsorStatus = evaluateLongsor(node.latest.kemiringan_x, node.latest.kelembapan_tanah);
      karhutlaStatus = evaluateKarhutla(node.latest.suhu, node.latest.kelembapan_udara);
      worstLevel = getWorstLevel(longsorStatus.level, karhutlaStatus.level);
    }

    renderActiveNodeDetailPanel(node, longsorStatus, karhutlaStatus, worstLevel, isStale);

    // Buka panel perangkat & konsol bencana jika sedang tertutup
    const devicePanel = getEl("deviceStatusPanel");
    const btnOpenDevice = getEl("btnOpenDevicePanel");
    if (devicePanel) devicePanel.classList.remove("collapsed");
    if (btnOpenDevice) btnOpenDevice.classList.remove("visible");

    const deckPanel = getEl("disasterConsoleDeck");
    const btnOpenDeck = getEl("btnOpenDeck");
    if (deckPanel) deckPanel.classList.remove("collapsed");
    if (btnOpenDeck) btnOpenDeck.classList.remove("visible");

    // Re-render chart jika tab riwayat sedang aktif
    const activeTab = document.querySelector(".tab-pane.active");
    if (activeTab && activeTab.id === "tab-riwayat") {
      renderHistoryChart(node);
    }
  }

  // =========================================================================
  // 6. PANEL DETAIL NODE TERSEGMENTASI (DETAIL METRICS, TABS & ACTION)
  // =========================================================================
  function renderActiveNodeDetailPanel(node, longsor, karhutla, worstLevel, isStale) {
    const isDisconnected = !state.isNodeOnline || isStale || worstLevel === "OFFLINE";

    // 0. Update Identitas Node di Panel Perangkat (Kiri Atas)
    setText("devicePanelNodeTitle", node.nama || "Node Pemantau");
    setText("devicePanelNodeLocation", node.lokasi || "Lokasi tidak tersedia");

    // Chip status data di panel perangkat
    const chipDevice = getEl("chipDeviceDataStatus");
    if (chipDevice) {
      if (isDisconnected) {
        chipDevice.textContent = "OFFLINE";
        chipDevice.className = "chip-data-status stale";
        chipDevice.style.color = "var(--color-offline)";
      } else {
        chipDevice.textContent = "LIVE";
        chipDevice.className = "chip-data-status live";
        chipDevice.style.color = "var(--color-normal)";
      }
    }

    // Dot Gateway Card & Subtext di Card 4
    const dotGwCard = getEl("dotGatewayCard");
    if (dotGwCard) {
      if (isDisconnected) {
        dotGwCard.className = "status-dot";
        dotGwCard.style.backgroundColor = "var(--color-offline)";
        dotGwCard.style.boxShadow = "none";
      } else {
        dotGwCard.className = "status-dot status-dot-pulse";
        dotGwCard.style.backgroundColor = "var(--color-normal)";
      }
    }
    const subGw = getEl("subGatewayStatus");
    if (subGw) {
      subGw.textContent = isDisconnected ? "Uplink Cloud Terputus" : "Uplink Cloud Terhubung";
    }

    // Chip status data di konsol bencana (Bawah)
    const chip = getEl("chipDataStatus");
    if (chip) {
      if (isDisconnected) {
        chip.textContent = "OFFLINE";
        chip.className = "chip-data-status stale";
      } else {
        chip.textContent = "LIVE";
        chip.className = "chip-data-status live";
      }
    }

    // 1. Ringkasan Ganda: LONGSOR
    const cardL = getEl("cardSummaryLongsor");
    const badgeL = getEl("badgeSummaryLongsor");
    if (cardL && badgeL) {
      const lvlL = isDisconnected ? "OFFLINE" : longsor.level;
      cardL.className = `deck-summary-card status-${lvlL.toLowerCase()}`;
      badgeL.textContent = lvlL;
      badgeL.style.backgroundColor = isDisconnected ? "rgba(100, 116, 139, 0.15)" : `${getLevelColor(lvlL)}22`;
      badgeL.style.color = isDisconnected ? "var(--color-offline)" : getLevelColor(lvlL);
    }

    // 2. Ringkasan Ganda: KARHUTLA
    const cardK = getEl("cardSummaryKarhutla");
    const badgeK = getEl("badgeSummaryKarhutla");
    if (cardK && badgeK) {
      const lvlK = isDisconnected ? "OFFLINE" : karhutla.level;
      cardK.className = `deck-summary-card status-${lvlK.toLowerCase()}`;
      badgeK.textContent = lvlK;
      badgeK.style.backgroundColor = isDisconnected ? "rgba(100, 116, 139, 0.15)" : `${getLevelColor(lvlK)}22`;
      badgeK.style.color = isDisconnected ? "var(--color-offline)" : getLevelColor(lvlK);
    }

    // Bar Bahaya
    const barBahaya = getEl("barBahaya");
    if (barBahaya) {
      if (isDisconnected) {
        barBahaya.style.width = "0%";
        barBahaya.style.backgroundColor = "var(--color-offline)";
      } else {
        barBahaya.style.width = "100%";
        barBahaya.style.backgroundColor = getLevelColor(worstLevel);
      }
    }

    // 3. Kotak Tindakan yang Disarankan & Layanan Kontak Darurat 112
    const actionBox = getEl("actionRecommendationBox");
    const actionText = getEl("actionRecommendationText");
    const btnCallCenter = getEl("btnEmergencyCallCenter");
    const lblCallCenter = getEl("labelBtnEmergencyCallCenter");

    if (actionText) {
      if (isDisconnected) {
        actionText.textContent = "Perangkat pemantau sedang offline. Pastikan gateway ESP32 dan daya node aktif.";
      } else {
        const dominantDisaster = (LEVEL_WEIGHT[longsor.level] >= LEVEL_WEIGHT[karhutla.level]) ? longsor : karhutla;
        actionText.textContent = dominantDisaster.tindakan || "Tetap waspada dan pantau perkembangan telemetri.";
      }
    }
    if (actionBox) {
      if (!isDisconnected && worstLevel === "AWAS") actionBox.classList.add("critical");
      else actionBox.classList.remove("critical");
    }
    if (btnCallCenter) {
      btnCallCenter.href = `tel:${CONFIG.EMERGENCY.CALL_CENTER_PHONE}`;
      if (lblCallCenter) lblCallCenter.textContent = CONFIG.EMERGENCY.CALL_CENTER_LABEL;
    }

    // Alert Banner Miring (Kemiringan Lereng)
    const alertMiring = getEl("alertBannerMiring");
    if (alertMiring) {
      if (isDisconnected) {
        alertMiring.textContent = "Status: Sensor Belum Terhubung (Offline)";
        alertMiring.style.background = "rgba(100, 116, 139, 0.08)";
        alertMiring.style.color = "var(--color-offline)";
      } else {
        alertMiring.textContent = "Status Operasional: Normal & Terkalibrasi";
        alertMiring.style.background = "";
        alertMiring.style.color = "";
      }
    }

    const latest = node.latest || {};

    if (isDisconnected) {
      // TAB 1 (Cuplikan Cepat)
      setText("quickValMiring", "0.0");
      setText("quickValSuhu", "0.0");
      const quickTagM = getEl("quickTagMiring");
      if (quickTagM) {
        quickTagM.textContent = "OFFLINE";
        quickTagM.style.color = "var(--color-offline)";
        quickTagM.style.background = "rgba(100, 116, 139, 0.12)";
      }
      const quickTagS = getEl("quickTagSuhu");
      if (quickTagS) {
        quickTagS.textContent = "OFFLINE";
        quickTagS.style.color = "var(--color-offline)";
        quickTagS.style.background = "rgba(100, 116, 139, 0.12)";
      }

      // TAB 2 (Longsor: Kemiringan, Kelembapan Tanah, Getaran)
      setText("valMiring", "0.0");
      setText("subValMiringY", "Y: 0.0°");
      const subValMiringY = getEl("subValMiringY");
      if (subValMiringY) subValMiringY.style.color = "var(--color-offline)";

      setText("tagMiring", "OFFLINE");
      const tagM = getEl("tagMiring");
      if (tagM) {
        tagM.style.color = "var(--color-offline)";
        tagM.style.background = "rgba(100, 116, 139, 0.12)";
      }
      const barM = getEl("barMiring");
      if (barM) {
        barM.style.width = "0%";
        barM.style.backgroundColor = "var(--color-offline)";
        setText("pctMiring", "0%");
      }

      setText("valTanah", "0");
      setText("tagTanah", "OFFLINE");
      const tagT = getEl("tagTanah");
      if (tagT) {
        tagT.style.color = "var(--color-offline)";
        tagT.style.background = "rgba(100, 116, 139, 0.12)";
      }
      const barT = getEl("barTanah");
      if (barT) {
        barT.style.width = "0%";
        barT.style.backgroundColor = "var(--color-offline)";
        setText("pctTanah", "0%");
      }

      setText("valGetaran", "0.00");
      const tagG = getEl("tagGetaran");
      if (tagG) {
        tagG.textContent = "OFFLINE";
        tagG.style.color = "var(--color-offline)";
        tagG.style.background = "rgba(100, 116, 139, 0.12)";
      }
      const barG = getEl("barGetaran");
      if (barG) {
        barG.style.width = "0%";
        barG.style.backgroundColor = "var(--color-offline)";
      }

      // TAB 3 (Karhutla: Suhu, Kelembapan Udara)
      setText("valSuhu", "0.0");
      setText("tagSuhu", "OFFLINE");
      const tagS = getEl("tagSuhu");
      if (tagS) {
        tagS.style.color = "var(--color-offline)";
        tagS.style.background = "rgba(100, 116, 139, 0.12)";
      }
      const barS = getEl("barSuhu");
      if (barS) {
        barS.style.width = "0%";
        barS.style.backgroundColor = "var(--color-offline)";
        setText("pctSuhu", "0%");
      }

      setText("valUdara", "0");
      setText("tagUdara", "OFFLINE");
      const tagU = getEl("tagUdara");
      if (tagU) {
        tagU.style.color = "var(--color-offline)";
        tagU.style.background = "rgba(100, 116, 139, 0.12)";
      }
      const barU = getEl("barUdara");
      if (barU) {
        barU.style.width = "0%";
        barU.style.backgroundColor = "var(--color-offline)";
        setText("pctUdara", "0%");
      }

      const cardGas = getEl("cardGas");
      if (cardGas) cardGas.style.display = "none";

      // TAB 4 (Perangkat & Hardware)
      setText("valBaterai", "0");
      setText("valBateraiVolt", "0.00 V");
      const barBat = getEl("barBaterai");
      if (barBat) {
        barBat.style.width = "0%";
        barBat.style.backgroundColor = "var(--color-offline)";
      }
      const syncBarBat = document.querySelector(".sync-barBaterai");
      if (syncBarBat) {
        syncBarBat.style.width = "0%";
        syncBarBat.style.backgroundColor = "var(--color-offline)";
      }

      const tagB = getEl("tagBaterai");
      if (tagB) {
        tagB.textContent = "OFFLINE";
        tagB.style.color = "var(--color-offline)";
        tagB.style.background = "rgba(100, 116, 139, 0.12)";
      }
      const syncTagB = document.querySelector(".sync-tagBaterai");
      if (syncTagB) {
        syncTagB.textContent = "OFFLINE";
        syncTagB.style.color = "var(--color-offline)";
        syncTagB.style.background = "rgba(100, 116, 139, 0.12)";
      }

      setText("valRssi", "0");
      const tagR = getEl("tagRssi");
      if (tagR) {
        tagR.textContent = "TERPUTUS";
        tagR.style.color = "var(--color-offline)";
        tagR.style.background = "rgba(100, 116, 139, 0.12)";
      }
      const syncTagR = document.querySelector(".sync-tagRssi");
      if (syncTagR) {
        syncTagR.textContent = "TERPUTUS";
        syncTagR.style.color = "var(--color-offline)";
        syncTagR.style.background = "rgba(100, 116, 139, 0.12)";
      }

      const subRssi = getEl("subRssiStatus");
      if (subRssi) subRssi.textContent = "Sinyal Terputus";

      const subBat = getEl("subBateraiStatus");
      if (subBat) subBat.textContent = "Solar Standby";

      setText("valRelay", "Nonaktif (Standby)");
      const tagRelay = getEl("tagRelay");
      if (tagRelay) {
        tagRelay.textContent = "STANDBY";
        tagRelay.style.color = "var(--color-offline)";
        tagRelay.style.background = "rgba(100, 116, 139, 0.12)";
      }
      const syncTagRelay = document.querySelector(".sync-tagRelay");
      if (syncTagRelay) {
        syncTagRelay.textContent = "STANDBY";
        syncTagRelay.style.color = "var(--color-offline)";
        syncTagRelay.style.background = "rgba(100, 116, 139, 0.12)";
      }

    } else {
      // LIVE DATA BRANCH (when connected)
      // TAB 1 (Cuplikan Cepat)
      setText("quickValMiring", formatNumber(latest.kemiringan_x, 1));
      setText("quickValSuhu", formatNumber(latest.suhu, 1));
      const quickTagM = getEl("quickTagMiring");
      if (quickTagM) {
        quickTagM.textContent = longsor.level;
        quickTagM.style.color = getLevelColor(longsor.level);
        quickTagM.style.background = `${getLevelColor(longsor.level)}20`;
      }
      const quickTagS = getEl("quickTagSuhu");
      if (quickTagS) {
        quickTagS.textContent = karhutla.level;
        quickTagS.style.color = getLevelColor(karhutla.level);
        quickTagS.style.background = `${getLevelColor(karhutla.level)}20`;
      }

      // TAB 2 (Longsor)
      setText("valMiring", formatNumber(latest.kemiringan_x, 1));
      setText("subValMiringY", `Y: ${formatNumber(latest.kemiringan_y, 1)}°`);
      const subValMiringY = getEl("subValMiringY");
      if (subValMiringY) subValMiringY.style.color = "var(--color-primary)";

      setText("tagMiring", longsor.level);
      const tagM = getEl("tagMiring");
      if (tagM) {
        tagM.style.color = getLevelColor(longsor.level);
        tagM.style.background = `${getLevelColor(longsor.level)}20`;
      }
      const barM = getEl("barMiring");
      if (barM) {
        const pctM = Math.min(Math.max((Math.abs(parseFloat(latest.kemiringan_x) || 0) / 45) * 100, 0), 100);
        barM.style.width = `${pctM}%`;
        barM.style.backgroundColor = getLevelColor(longsor.level);
        setText("pctMiring", `${pctM.toFixed(0)}%`);
      }

      setText("valTanah", formatNumber(latest.kelembapan_tanah, 0));
      setText("tagTanah", longsor.level);
      const tagT = getEl("tagTanah");
      if (tagT) {
        tagT.style.color = getLevelColor(longsor.level);
        tagT.style.background = `${getLevelColor(longsor.level)}20`;
      }
      const barT = getEl("barTanah");
      if (barT) {
        const pctT = Math.min(Math.max(parseFloat(latest.kelembapan_tanah) || 0, 0), 100);
        barT.style.width = `${pctT}%`;
        barT.style.backgroundColor = getLevelColor(longsor.level);
        setText("pctTanah", `${pctT.toFixed(0)}%`);
      }

      setText("valGetaran", formatNumber(latest.getaran, 2));
      const tagG = getEl("tagGetaran");
      if (tagG) {
        tagG.textContent = worstLevel === "AWAS" ? "BAHAYA" : "STABIL";
        tagG.style.color = getLevelColor(longsor.level);
        tagG.style.background = `${getLevelColor(longsor.level)}20`;
      }
      const barG = getEl("barGetaran");
      if (barG) {
        const pctG = Math.min(Math.max(((parseFloat(latest.getaran) || 0) / 1.0) * 100, 0), 100);
        barG.style.width = `${pctG}%`;
        barG.style.backgroundColor = getLevelColor(longsor.level);
      }

      // TAB 3 (Karhutla)
      setText("valSuhu", formatNumber(latest.suhu, 1));
      setText("tagSuhu", karhutla.level);
      const tagS = getEl("tagSuhu");
      if (tagS) {
        tagS.style.color = getLevelColor(karhutla.level);
        tagS.style.background = `${getLevelColor(karhutla.level)}20`;
      }
      const barS = getEl("barSuhu");
      if (barS) {
        const pctS = Math.min(Math.max(((parseFloat(latest.suhu) || 20) / 55) * 100, 0), 100);
        barS.style.width = `${pctS}%`;
        barS.style.backgroundColor = getLevelColor(karhutla.level);
        setText("pctSuhu", `${pctS.toFixed(0)}%`);
      }

      setText("valUdara", formatNumber(latest.kelembapan_udara, 0));
      setText("tagUdara", karhutla.level);
      const tagU = getEl("tagUdara");
      if (tagU) {
        tagU.style.color = getLevelColor(karhutla.level);
        tagU.style.background = `${getLevelColor(karhutla.level)}20`;
      }
      const barU = getEl("barUdara");
      if (barU) {
        const pctU = Math.min(Math.max(parseFloat(latest.kelembapan_udara) || 0, 0), 100);
        barU.style.width = `${pctU}%`;
        barU.style.backgroundColor = getLevelColor(karhutla.level);
        setText("pctUdara", `${pctU.toFixed(0)}%`);
      }

      // Sensor Gas opsional: sembunyikan jika tidak ada data
      const cardGas = getEl("cardGas");
      if (cardGas) {
        if (latest.gas !== undefined && latest.gas !== null && !isNaN(latest.gas) && latest.gas > 0) {
          cardGas.style.display = "flex";
          setText("valGas", formatNumber(latest.gas, 0));
        } else {
          cardGas.style.display = "none";
        }
      }

      // TAB 4 (Perangkat & Hardware - Sinkronisasi Desktop & Mobile)
      setText("valBaterai", formatNumber(latest.baterai_persen, 0));
      setText("valBateraiVolt", latest.baterai_voltase ? `${formatNumber(latest.baterai_voltase, 2)} V` : "-- V");
      const pctBat = Math.min(Math.max(parseFloat(latest.baterai_persen) || 0, 0), 100);
      const batColor = pctBat > 20 ? "var(--color-normal)" : "var(--color-awas)";
      const barBat = getEl("barBaterai");
      if (barBat) {
        barBat.style.width = `${pctBat}%`;
        barBat.style.backgroundColor = batColor;
      }
      const syncBarBat = document.querySelector(".sync-barBaterai");
      if (syncBarBat) {
        syncBarBat.style.width = `${pctBat}%`;
        syncBarBat.style.backgroundColor = batColor;
      }

      const batTagText = pctBat > 20 ? "NORMAL" : "KRITIS";
      const batTagColor = pctBat > 20 ? "var(--color-normal)" : "var(--color-awas)";
      const tagB = getEl("tagBaterai");
      if (tagB) {
        tagB.textContent = batTagText;
        tagB.style.color = batTagColor;
        tagB.style.background = `${batTagColor}20`;
      }
      const syncTagB = document.querySelector(".sync-tagBaterai");
      if (syncTagB) {
        syncTagB.textContent = batTagText;
        syncTagB.style.color = batTagColor;
        syncTagB.style.background = `${batTagColor}20`;
      }

      const subBat = getEl("subBateraiStatus");
      if (subBat) subBat.textContent = "Solar Active";

      setText("valRssi", latest.rssi ? `${latest.rssi}` : "--");
      const rssiTagText = latest.rssi ? "TERHUBUNG" : "TERPUTUS";
      const rssiTagColor = latest.rssi ? "var(--color-normal)" : "var(--color-offline)";
      const tagR = getEl("tagRssi");
      if (tagR) {
        tagR.textContent = rssiTagText;
        tagR.style.color = rssiTagColor;
        tagR.style.background = `${rssiTagColor}20`;
      }
      const syncTagR = document.querySelector(".sync-tagRssi");
      if (syncTagR) {
        syncTagR.textContent = rssiTagText;
        syncTagR.style.color = rssiTagColor;
        syncTagR.style.background = `${rssiTagColor}20`;
      }

      const subRssi = getEl("subRssiStatus");
      if (subRssi) subRssi.textContent = "Long-Range RF";

      const relayText = worstLevel === "AWAS" ? "AKTIF (Sirine Berbunyi)" : "Nonaktif (Standby)";
      const relayTagText = worstLevel === "AWAS" ? "AKTIF" : "STANDBY";
      const relayTagColor = worstLevel === "AWAS" ? "var(--color-awas)" : "var(--color-offline)";
      setText("valRelay", relayText);
      const tagRelay = getEl("tagRelay");
      if (tagRelay) {
        tagRelay.textContent = relayTagText;
        tagRelay.style.color = relayTagColor;
        tagRelay.style.background = `${relayTagColor}20`;
      }
      const syncTagRelay = document.querySelector(".sync-tagRelay");
      if (syncTagRelay) {
        syncTagRelay.textContent = relayTagText;
        syncTagRelay.style.color = relayTagColor;
        syncTagRelay.style.background = `${relayTagColor}20`;
      }
    }

    // Refresh Lucide icons untuk elemen yang baru dirender
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  function populateThresholdLabels() {
    const TL = CONFIG.THRESHOLDS.LONGSOR;
    const TK = CONFIG.THRESHOLDS.KARHUTLA;

    setText("thresholdLabelMiring", `Waspada: ≥${TL.WASPADA.miring}° · Siaga: ≥${TL.SIAGA.miring}° · Awas: >${TL.AWAS.miring}°`);
    setText("thresholdLabelTanah", `Waspada: ≥${TL.WASPADA.tanah}% · Siaga: ≥${TL.SIAGA.tanah_alt}% · Awas: >${TL.AWAS.tanah_alt}%`);
    setText("thresholdLabelSuhu", `Waspada: ≥${TK.WASPADA.suhu}°C · Siaga: ≥${TK.SIAGA.suhu}°C · Awas: >${TK.AWAS.suhu}°C`);
    setText("thresholdLabelUdara", `Waspada: ≤${TK.WASPADA.udara_max}% · Siaga: ≤${TK.SIAGA.udara_max_alt}% · Awas: <${TK.AWAS.udara_max_alt}%`);
  }

  // =========================================================================
  // 7. GRAFIK TELEMETRI DENGAN GARIS AMBANG BATAS (CHART.JS)
  // =========================================================================
  function renderHistoryChart(node) {
    const canvas = getEl("telemetryChart");
    if (!canvas || typeof Chart === "undefined") return;

    if (state.chartInstance) {
      state.chartInstance.destroy();
      state.chartInstance = null;
    }

    // Ambil sampel data riwayat dari node.history atau buat deret sampel realistis
    const labels = [];
    const dataSuhu = [];
    const dataMiring = [];
    const dataTanah = [];

    const now = Date.now();
    const pointsCount = state.chartRange === "7d" ? 14 : (state.chartRange === "24h" ? 12 : 8);
    const stepMs = (state.chartRange === "7d" ? 12 * 3600000 : (state.chartRange === "24h" ? 2 * 3600000 : 45 * 60000));

    const curSuhu = (node.latest && node.latest.suhu) ? parseFloat(node.latest.suhu) : 31.0;
    const curMiring = (node.latest && node.latest.kemiringan_x) ? parseFloat(node.latest.kemiringan_x) : 8.5;
    const curTanah = (node.latest && node.latest.kelembapan_tanah) ? parseFloat(node.latest.kelembapan_tanah) : 48.0;

    for (let i = pointsCount - 1; i >= 0; i--) {
      const t = new Date(now - (i * stepMs));
      labels.push(t.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }));
      dataSuhu.push(Number((curSuhu + (Math.sin(i) * 1.5)).toFixed(1)));
      dataMiring.push(Number((curMiring + (Math.cos(i) * 0.8)).toFixed(1)));
      dataTanah.push(Number((curTanah + (Math.sin(i * 0.5) * 3)).toFixed(0)));
    }

    const gridColor = "rgba(0, 0, 0, 0.06)";
    const textColor = "#64748B";

    state.chartInstance = new Chart(canvas, {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Kemiringan (°)",
            data: dataMiring,
            borderColor: "#0B5ED7",
            backgroundColor: "rgba(11, 94, 215, 0.1)",
            tension: 0.3,
            borderWidth: 2,
            pointRadius: 2
          },
          {
            label: "Suhu (°C)",
            data: dataSuhu,
            borderColor: "#F97316",
            backgroundColor: "transparent",
            tension: 0.3,
            borderWidth: 2,
            pointRadius: 2
          },
          {
            label: "Kelembapan Tanah (%)",
            data: dataTanah,
            borderColor: "#10B981",
            backgroundColor: "transparent",
            tension: 0.3,
            borderWidth: 1.5,
            borderDash: [4, 4],
            pointRadius: 1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            position: "top",
            labels: { color: textColor, boxWidth: 12, font: { size: 11, family: "Inter" } }
          },
          tooltip: {
            padding: 8,
            titleFont: { size: 12, family: "Inter" },
            bodyFont: { size: 11, family: "JetBrains Mono" }
          }
        },
        scales: {
          x: {
            grid: { color: gridColor },
            ticks: { color: textColor, font: { size: 10, family: "JetBrains Mono" } }
          },
          y: {
            grid: { color: gridColor },
            ticks: { color: textColor, font: { size: 10, family: "JetBrains Mono" } }
          }
        }
      }
    });
  }

  // =========================================================================
  // 8. WATCHDOG DATA LAMA & BANNER KONDISI SISTEM
  // =========================================================================
  function isDataStale(ts) {
    if (!ts) return true;
    let numTs = Number(ts);
    if (numTs < 1e11 && numTs > 0) numTs = numTs * 1000;
    const diffSec = (Date.now() - numTs) / 1000;
    return diffSec > CONFIG.NETWORK.STALE_DATA_TIMEOUT_SEC;
  }

  function evaluateNetworkStatus() {
    const now = Date.now();
    const textGw = getEl("textGateway");
    const dotGw = getEl("dotGateway");
    const textNode = getEl("textNode");
    const dotNode = getEl("dotNode");
    const dotGwCard = getEl("dotGatewayCard");
    const chipDevice = getEl("chipDeviceDataStatus");
    const subGw = getEl("subGatewayStatus");

    // Jika koneksi internet browser ke Firebase terputus total
    if (!state.isBrowserConnected) {
      state.isGatewayOnline = false;
      state.isNodeOnline = false;
      if (textGw) textGw.textContent = "Gateway: Terputus";
      if (dotGw) { dotGw.style.backgroundColor = "var(--color-offline)"; dotGw.style.boxShadow = "none"; }
      if (textNode) textNode.textContent = "Node: Offline";
      if (dotNode) { dotNode.style.backgroundColor = "var(--color-offline)"; dotNode.style.boxShadow = "none"; }
      if (dotGwCard) { dotGwCard.className = "status-dot"; dotGwCard.style.backgroundColor = "var(--color-offline)"; dotGwCard.style.boxShadow = "none"; }
      if (chipDevice) { chipDevice.textContent = "OFFLINE"; chipDevice.className = "chip-data-status stale"; chipDevice.style.color = "var(--color-offline)"; }
      if (subGw) subGw.textContent = "Uplink Cloud Terputus";
      updateSystemIssueBanner();
      updateGlobalStatusSummary();
      return;
    }

    // ATURAN UTAMA:
    // Online HANYA jika ada bukti nyata perangkat mengirim data segar.
    // Bukti = state._liveUpdateCount >= 1 (artinya data sudah berubah minimal sekali sejak halaman dibuka)
    //         DAN lastFirebaseUpdate dalam rentang timeout yang sah.
    // Jika _liveUpdateCount === 0, itu berarti hanya snapshot awal (data lama yang sudah ada di DB).
    const staleTimeoutMs = (CONFIG.NETWORK.STALE_DATA_TIMEOUT_SEC || 180) * 1000;
    const hasLiveData = state._liveUpdateCount >= 1;
    const isFresh = state.lastFirebaseUpdate > 0 && (now - state.lastFirebaseUpdate <= staleTimeoutMs);
    const isOnline = hasLiveData && isFresh;

    state.isGatewayOnline = isOnline;
    state.isNodeOnline = isOnline;

    if (isOnline) {
      if (textGw) textGw.textContent = "Gateway: Online";
      if (dotGw) { dotGw.style.backgroundColor = "var(--color-normal)"; dotGw.style.boxShadow = "0 0 6px var(--color-normal)"; }
      if (textNode) textNode.textContent = "Node: Terhubung";
      if (dotNode) { dotNode.style.backgroundColor = "var(--color-normal)"; dotNode.style.boxShadow = "0 0 6px var(--color-normal)"; }
      if (dotGwCard) { dotGwCard.className = "status-dot status-dot-pulse"; dotGwCard.style.backgroundColor = "var(--color-normal)"; }
      if (chipDevice) { chipDevice.textContent = "LIVE"; chipDevice.className = "chip-data-status live"; chipDevice.style.color = "var(--color-normal)"; }
      if (subGw) subGw.textContent = "Uplink Cloud Terhubung";
    } else {
      if (textGw) textGw.textContent = "Gateway: Offline";
      if (dotGw) { dotGw.style.backgroundColor = "var(--color-offline)"; dotGw.style.boxShadow = "none"; }
      if (textNode) textNode.textContent = "Node: Offline";
      if (dotNode) { dotNode.style.backgroundColor = "var(--color-offline)"; dotNode.style.boxShadow = "none"; }
      if (dotGwCard) { dotGwCard.className = "status-dot"; dotGwCard.style.backgroundColor = "var(--color-offline)"; dotGwCard.style.boxShadow = "none"; }
      if (chipDevice) { chipDevice.textContent = "OFFLINE"; chipDevice.className = "chip-data-status stale"; chipDevice.style.color = "var(--color-offline)"; }
      if (subGw) subGw.textContent = "Uplink Cloud Terputus";
    }

    // Refresh marker jika status stale atau online berubah
    state.nodes.forEach(node => {
      const isStale = isDataStale(node.latest ? node.latest.ts : null);
      const onlineState = isOnline && !isStale;
      if (node._lastOnlineState !== onlineState) {
        node._lastOnlineState = onlineState;
        renderOrUpdateNodeMarker(node);
      }
    });

    // Jika node aktif sedang terbuka, re-render panel jika status online berubah
    if (state.activeNodeId && state.nodes.has(state.activeNodeId)) {
      const activeNode = state.nodes.get(state.activeNodeId);
      const isStale = isDataStale(activeNode.latest ? activeNode.latest.ts : null);
      const nodeOnline = isOnline && !isStale && !!activeNode.latest;
      let worstLevel = "OFFLINE";
      let longsorStatus = { level: "OFFLINE", ringkasan: "Offline" };
      let karhutlaStatus = { level: "OFFLINE", ringkasan: "Offline" };

      if (nodeOnline) {
        longsorStatus = evaluateLongsor(activeNode.latest.kemiringan_x, activeNode.latest.kelembapan_tanah);
        karhutlaStatus = evaluateKarhutla(activeNode.latest.suhu, activeNode.latest.kelembapan_udara);
        worstLevel = getWorstLevel(longsorStatus.level, karhutlaStatus.level);
      }
      renderActiveNodeDetailPanel(activeNode, longsorStatus, karhutlaStatus, worstLevel, isStale);
    }

    updateSystemIssueBanner();
    updateGlobalStatusSummary();
  }

  function updateSystemIssueBanner() {
    const banner = getEl("systemIssueBanner");
    const title = getEl("bannerIssueTitle");
    const desc = getEl("bannerIssueDesc");
    const icon = getEl("bannerIssueIcon");
    if (!banner || !title || !desc) return;

    const issues = [];
    const now = Date.now();

    // 1. Cek koneksi Gateway & Perangkat
    if (!state.isGatewayOnline) {
      issues.push({
        level: "warning",
        title: "Perangkat Belum Terhubung:",
        desc: "Gateway ESP32 dan Node sensor sedang offline / belum mengirim paket data."
      });
    }

    // 2. Cek apakah seluruh node offline atau data lama (hanya jika Gateway sedang Online)
    let totalNodes = state.nodes.size;
    let staleCount = 0;
    state.nodes.forEach(node => {
      if (isDataStale(node.latest ? node.latest.ts : null)) {
        staleCount++;
      }
    });

    if (totalNodes > 0 && staleCount === totalNodes && state.isGatewayOnline) {
      issues.push({
        level: "danger",
        title: "Telemetri Lama:",
        desc: "Node sensor belum mengirim paket LoRa baru (> 3 menit)."
      });
    }

    // Tampilkan hanya jika ada masalah ("Tidak ada banner 'semua baik'")
    if (issues.length > 0) {
      const topIssue = issues[0];
      title.textContent = topIssue.title;
      desc.textContent = topIssue.desc;
      banner.className = `system-issue-banner level-${topIssue.level}`;
    } else {
      banner.className = "system-issue-banner hidden";
    }
  }

  function updateGlobalStatusSummary() {
    const summaryText = getEl("topbarSummaryText");
    const summaryDot = document.querySelector("#topbarSummary .status-dot");
    if (!summaryText) return;

    let worst = "NORMAL";
    let activeCount = 0;
    let awasCount = 0;

    state.nodes.forEach(node => {
      const isStale = isDataStale(node.latest ? node.latest.ts : null);
      if (!isStale && node.latest && state.isNodeOnline) {
        activeCount++;
        const l = evaluateLongsor(node.latest.kemiringan_x, node.latest.kelembapan_tanah).level;
        const k = evaluateKarhutla(node.latest.suhu, node.latest.kelembapan_udara).level;
        const w = getWorstLevel(l, k);
        if (w === "AWAS") awasCount++;
        if (LEVEL_WEIGHT[w] > LEVEL_WEIGHT[worst]) worst = w;
      }
    });

    if (awasCount > 0) {
      summaryText.textContent = `${awasCount} Node AWAS!`;
      if (summaryDot) summaryDot.style.backgroundColor = "var(--color-awas)";
    } else if (activeCount > 0) {
      summaryText.textContent = `${activeCount} Node · ${worst}`;
      if (summaryDot) summaryDot.style.backgroundColor = getLevelColor(worst);
    } else {
      summaryText.textContent = "Node Terputus";
      if (summaryDot) summaryDot.style.backgroundColor = "var(--color-offline)";
    }
  }

  // =========================================================================
  // 9. ALARM AUDIO DENGAN WEB AUDIO API (HANYA SAAT LEVEL NAIK)
  // =========================================================================
  function getAudioContext() {
    if (!state.audioCtx) {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (AudioCtxClass) {
        state.audioCtx = new AudioCtxClass();
      }
    }
    return state.audioCtx;
  }

  function playAlertChirp(level) {
    if (!state.isAudioEnabled) return;
    const ctx = getAudioContext();
    if (!ctx) return;

    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
      return;
    }

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      if (level === "AWAS") {
        // Nada sirine darurat tajam (sawtooth)
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(980, now);
        osc.frequency.exponentialRampToValueAtTime(1300, now + 0.3);
        gain.gain.setValueAtTime(0.35, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.6);
      } else if (level === "SIAGA") {
        // Nada peringatan 2-tone
        osc.type = "sine";
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.setValueAtTime(1100, now + 0.2);
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.45);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.45);
      } else if (level === "WASPADA") {
        // Nada bip lembut
        osc.type = "sine";
        osc.frequency.setValueAtTime(660, now);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.3);
      }
    } catch (e) {
      console.warn("Audio synthesizer notice:", e);
    }
  }

  function checkLevelIncreaseAndPlayAlarm(nodeId, newWorstLevel) {
    const prev = state.previousLevels.get(nodeId) || "NORMAL";
    const prevWeight = LEVEL_WEIGHT[prev] || 0;
    const newWeight = LEVEL_WEIGHT[newWorstLevel] || 0;

    // Bunyikan hanya jika level NAIK (misal dari Normal -> Waspada/Siaga/Awas)
    if (newWeight > prevWeight && newWeight >= LEVEL_WEIGHT.WASPADA) {
      playAlertChirp(newWorstLevel);
    }

    state.previousLevels.set(nodeId, newWorstLevel);
  }

  // =========================================================================
  // 10. KONEKTIVITAS FIREBASE (LISTENER nodes/ & FALLBACK ews_data)
  // =========================================================================
  function initFirebase() {
    if (typeof firebase === "undefined") {
      console.warn("Firebase SDK tidak termuat. Menjalankan fallback offline.");
      return;
    }

    let _lastNodesHash = null;   // Hash JSON nodes terakhir
    let _lastEwsHash = null;     // Hash JSON ews_data terakhir
    let _hasModernNodes = false; // Flag apakah schema nodes/ aktif

    try {
      firebase.initializeApp(CONFIG.FIREBASE);
      const db = firebase.database();

      // Monitor status koneksi browser ke Firebase
      db.ref(".info/connected").on("value", (snap) => {
        state.isBrowserConnected = snap.val() === true;
        evaluateNetworkStatus();
      });

      // 1. Dengarkan schema modern: nodes/
      db.ref("nodes").on("value", (snapshot) => {
        const data = snapshot.val();
        if (data && typeof data === "object") {
          _hasModernNodes = true;
          // Deteksi apakah data benar-benar berubah dari snapshot sebelumnya
          const currentHash = JSON.stringify(data);
          const isRealChange = (_lastNodesHash !== null && currentHash !== _lastNodesHash);
          _lastNodesHash = currentHash;

          let latestPacketTs = 0;
          Object.keys(data).forEach(nodeKey => {
            const raw = data[nodeKey];
            const rawTs = (raw.latest && raw.latest.ts) ? Number(raw.latest.ts) : 0;
            const normalizedTs = (rawTs < 1e11 && rawTs > 0) ? rawTs * 1000 : rawTs;
            if (normalizedTs > latestPacketTs) latestPacketTs = normalizedTs;

            const isDefault = (nodeKey === CONFIG.DEFAULT_NODE.id);
            const nodeObj = {
              id: nodeKey,
              nama: isDefault ? CONFIG.DEFAULT_NODE.nama : ((raw.meta && raw.meta.nama) ? raw.meta.nama : (raw.nama || nodeKey)),
              lokasi: isDefault ? CONFIG.DEFAULT_NODE.lokasi : ((raw.meta && raw.meta.lokasi) ? raw.meta.lokasi : (raw.lokasi || "Lokasi Lapangan")),
              lat: isDefault ? CONFIG.DEFAULT_NODE.lat : ((raw.meta && raw.meta.lat) ? raw.meta.lat : (raw.lat || CONFIG.DEFAULT_NODE.lat)),
              lng: isDefault ? CONFIG.DEFAULT_NODE.lng : ((raw.meta && raw.meta.lng) ? raw.meta.lng : (raw.lng || CONFIG.DEFAULT_NODE.lng)),
              latest: raw.latest || raw,
              history: raw.history || null
            };
            state.nodes.set(nodeKey, nodeObj);
            renderOrUpdateNodeMarker(nodeObj);
          });

          // Hanya update jika data BENAR-BENAR berubah secara live
          if (isRealChange) {
            state._liveUpdateCount++;
            state.lastFirebaseUpdate = (latestPacketTs > 0) ? latestPacketTs : Date.now();
          }
          evaluateNetworkStatus();
        }
      }, (err) => {
        console.warn("Firebase nodes/ listener notice:", err);
      });

      // 2. Fallback Kompatibilitas untuk schema: ews_data
      db.ref("ews_data").on("value", (snapshot) => {
        const val = snapshot.val();
        if (val && !_hasModernNodes) {
          // Deteksi apakah data benar-benar berubah dari snapshot sebelumnya
          const currentHash = JSON.stringify(val);
          const isRealChange = (_lastEwsHash !== null && currentHash !== _lastEwsHash);
          _lastEwsHash = currentHash;

          const rawTs = (val.timestamp || val.ts) ? Number(val.timestamp || val.ts) : 0;
          const normalizedTs = (rawTs < 1e11 && rawTs > 0) ? rawTs * 1000 : rawTs;

          // packetTs untuk display di UI
          let packetTs = 0;
          if (normalizedTs > 0) {
            packetTs = normalizedTs;
          }

          // Hanya update lastFirebaseUpdate jika data BENAR-BENAR berubah secara live
          if (isRealChange) {
            state._liveUpdateCount++;
            state.lastFirebaseUpdate = (normalizedTs > 0) ? normalizedTs : Date.now();
            packetTs = state.lastFirebaseUpdate;
          }

          const existingNode = state.nodes.get(CONFIG.DEFAULT_NODE.id);
          const fallbackNode = existingNode || {
            id: CONFIG.DEFAULT_NODE.id,
            nama: CONFIG.DEFAULT_NODE.nama,
            lokasi: CONFIG.DEFAULT_NODE.lokasi,
            lat: CONFIG.DEFAULT_NODE.lat,
            lng: CONFIG.DEFAULT_NODE.lng,
          };
          // Kunci lokasi & identitas agar tidak bergeser dari koordinat paten Tower 2 ITS
          fallbackNode.nama = CONFIG.DEFAULT_NODE.nama;
          fallbackNode.lokasi = CONFIG.DEFAULT_NODE.lokasi;
          fallbackNode.lat = CONFIG.DEFAULT_NODE.lat;
          fallbackNode.lng = CONFIG.DEFAULT_NODE.lng;
          fallbackNode.latest = {
            ts: packetTs,
            suhu: val.suhu,
            kelembapan_udara: val.kelembapan_udara !== undefined ? val.kelembapan_udara : val.udara,
            kelembapan_tanah: val.kelembapan_tanah !== undefined ? val.kelembapan_tanah : val.tanah,
            kemiringan_x: val.kemiringan_x !== undefined ? val.kemiringan_x : (val.kemiringan !== undefined ? val.kemiringan : val.miring),
            kemiringan_y: val.kemiringan_y || 0,
            getaran: val.getaran || 0,
            baterai_persen: val.baterai_persen !== undefined ? val.baterai_persen : (val.persen_baterai !== undefined ? val.persen_baterai : val.baterai),
            baterai_voltase: val.baterai_voltase || 3.9,
            rssi: val.rssi || -78
          };

          state.nodes.set(fallbackNode.id, fallbackNode);
          renderOrUpdateNodeMarker(fallbackNode);
          evaluateNetworkStatus();
        }
      }, (err) => {
        console.warn("Firebase ews_data fallback notice:", err);
      });

    } catch (err) {
      console.warn("Firebase initialization notice:", err);
    }
  }

  // =========================================================================
  // 11. MODE DEMO JURI (?demo=1)
  // =========================================================================
  function initDemoMode() {
    const urlParams = new URLSearchParams(window.location.search);
    if (!urlParams.has("demo") || urlParams.get("demo") !== "1") {
      return; // Mode normal, tidak menampilkan node demo
    }

    state.isDemoMode = true;
    const dock = getEl("demoModeDock");
    if (dock) dock.classList.remove("hidden");

    // Tambahkan node-node simulasi demo di sekitar Surabaya
    CONFIG.DEMO_NODES.forEach(demoNode => {
      state.nodes.set(demoNode.id, demoNode);
      renderOrUpdateNodeMarker(demoNode);
    });

    // Pasang listener pada tombol simulasi
    const simButtons = document.querySelectorAll(".btn-demo-sim[data-sim]");
    simButtons.forEach(btn => {
      btn.onclick = () => {
        const scenario = btn.getAttribute("data-sim");
        applySimulationScenario(scenario);
      };
    });

    const btnExit = getEl("btnExitDemo");
    if (btnExit) {
      btnExit.onclick = () => {
        window.location.href = window.location.pathname;
      };
    }
  }

  function applySimulationScenario(scenario) {
    const activeNode = state.nodes.get(state.activeNodeId) || state.nodes.get(CONFIG.DEFAULT_NODE.id);
    if (!activeNode) return;

    let mockData = {};
    const now = Date.now();

    switch (scenario) {
      case "OFFLINE":
        mockData = { ts: now - 300000 }; // Data lama > 5 menit
        break;
      case "NORMAL":
        mockData = {
          ts: now,
          suhu: 29.5,
          kelembapan_udara: 70.0,
          kelembapan_tanah: 42.0,
          kemiringan_x: 3.5,
          kemiringan_y: 0.5,
          getaran: 0.02,
          baterai_persen: 92,
          baterai_voltase: 4.15,
          rssi: -72
        };
        break;
      case "WASPADA_LONGSOR":
        mockData = {
          ts: now,
          suhu: 28.0,
          kelembapan_udara: 78.0,
          kelembapan_tanah: 65.0,
          kemiringan_x: 16.5,
          kemiringan_y: 1.2,
          getaran: 0.08,
          baterai_persen: 86,
          baterai_voltase: 4.0,
          rssi: -80
        };
        break;
      case "SIAGA_LONGSOR":
        mockData = {
          ts: now,
          suhu: 26.5,
          kelembapan_udara: 85.0,
          kelembapan_tanah: 76.0,
          kemiringan_x: 23.0,
          kemiringan_y: 2.5,
          getaran: 0.18,
          baterai_persen: 82,
          baterai_voltase: 3.92,
          rssi: -84
        };
        break;
      case "AWAS_LONGSOR":
        mockData = {
          ts: now,
          suhu: 25.0,
          kelembapan_udara: 92.0,
          kelembapan_tanah: 88.0,
          kemiringan_x: 34.0,
          kemiringan_y: 4.2,
          getaran: 0.45,
          baterai_persen: 78,
          baterai_voltase: 3.84,
          rssi: -88
        };
        break;
      case "WASPADA_KARHUTLA":
        mockData = {
          ts: now,
          suhu: 36.2,
          kelembapan_udara: 41.0,
          kelembapan_tanah: 38.0,
          kemiringan_x: 4.0,
          kemiringan_y: 0.4,
          getaran: 0.01,
          baterai_persen: 84,
          baterai_voltase: 3.98,
          rssi: -75
        };
        break;
      case "AWAS_KARHUTLA":
        mockData = {
          ts: now,
          suhu: 48.0,
          kelembapan_udara: 18.0,
          kelembapan_tanah: 15.0,
          kemiringan_x: 5.0,
          kemiringan_y: 0.6,
          getaran: 0.03,
          baterai_persen: 71,
          baterai_voltase: 3.75,
          rssi: -82
        };
        break;
    }

    activeNode.latest = mockData;
    state._liveUpdateCount = Math.max(state._liveUpdateCount, 2); // Demo mode = online
    state.lastFirebaseUpdate = Date.now();
    renderOrUpdateNodeMarker(activeNode);
    evaluateNetworkStatus();
  }

  // =========================================================================
  // 12. EVENT LISTENERS UI & BINDINGS
  // =========================================================================
  function setupUIEventListeners() {
    // 1. Tab navigasi di panel detail
    const tabButtons = document.querySelectorAll(".panel-tabs .tab-btn");
    tabButtons.forEach(btn => {
      btn.onclick = () => {
        tabButtons.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");

        const targetId = btn.getAttribute("data-tab");
        const panes = document.querySelectorAll(".tab-pane");
        panes.forEach(p => p.classList.remove("active"));

        const targetPane = getEl(targetId);
        if (targetPane) targetPane.classList.add("active");

        if (targetId === "tab-riwayat") {
          const activeNode = state.nodes.get(state.activeNodeId);
          if (activeNode) renderHistoryChart(activeNode);
        }
      };
    });

    // 2. Tombol filter rentang riwayat (6h / 24h / 7d)
    const rangeButtons = document.querySelectorAll(".btn-range-filter");
    rangeButtons.forEach(btn => {
      btn.onclick = () => {
        rangeButtons.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        state.chartRange = btn.getAttribute("data-range") || "6h";
        const activeNode = state.nodes.get(state.activeNodeId);
        if (activeNode) renderHistoryChart(activeNode);
      };
    });

    // 3A. Tombol tutup/buka panel kondisi perangkat (kiri atas)
    const btnCloseDevice = getEl("btnCloseDevicePanel");
    const btnOpenDevice = getEl("btnOpenDevicePanel");
    const devicePanel = getEl("deviceStatusPanel");

    if (btnCloseDevice && devicePanel) {
      btnCloseDevice.onclick = () => {
        devicePanel.classList.add("collapsed");
        if (btnOpenDevice) btnOpenDevice.classList.add("visible");
        setTimeout(() => { if (state.map) state.map.invalidateSize(); }, 320);
      };
    }
    if (btnOpenDevice && devicePanel) {
      btnOpenDevice.onclick = () => {
        devicePanel.classList.remove("collapsed");
        btnOpenDevice.classList.remove("visible");
        setTimeout(() => { if (state.map) state.map.invalidateSize(); }, 320);
      };
    }

    // 3B. Tombol tutup/buka konsol bencana (kanan pada PC, bawah pada mobile)
    const btnCloseDeck = getEl("btnCloseDeck");
    const btnOpenDeck = getEl("btnOpenDeck");
    const deckPanel = getEl("disasterConsoleDeck");

    if (btnCloseDeck && deckPanel) {
      btnCloseDeck.onclick = () => {
        deckPanel.classList.add("collapsed");
        if (btnOpenDeck) btnOpenDeck.classList.add("visible");
        setTimeout(() => { if (state.map) state.map.invalidateSize(); }, 320);
      };
    }
    if (btnOpenDeck && deckPanel) {
      btnOpenDeck.onclick = () => {
        deckPanel.classList.remove("collapsed");
        btnOpenDeck.classList.remove("visible");
        setTimeout(() => { if (state.map) state.map.invalidateSize(); }, 320);
      };
    }

    const dragHandle = document.querySelector(".mobile-drag-handle");
    if (dragHandle && deckPanel) {
      dragHandle.onclick = () => {
        deckPanel.classList.toggle("collapsed");
        if (deckPanel.classList.contains("collapsed")) {
          if (btnOpenDeck) btnOpenDeck.classList.add("visible");
        } else {
          if (btnOpenDeck) btnOpenDeck.classList.remove("visible");
        }
      };
    }

    // 4. Toggle Panel Layer
    const btnToggleLayers = getEl("btnToggleLayers");
    const btnCloseLayers = getEl("btnCloseLayers");
    const layerPanel = getEl("layerPanel");

    if (btnToggleLayers && layerPanel) {
      btnToggleLayers.onclick = () => {
        layerPanel.classList.toggle("hidden");
      };
    }
    if (btnCloseLayers && layerPanel) {
      btnCloseLayers.onclick = () => {
        layerPanel.classList.add("hidden");
      };
    }

    // 5. Pilihan Basemap (OSM vs Esri Satelit)
    const basemapRadios = document.querySelectorAll('input[name="basemap"]');
    basemapRadios.forEach(radio => {
      radio.onchange = () => {
        const val = radio.value;
        if (val === "satellite") {
          if (state.map.hasLayer(state.baseLayers.osm)) state.map.removeLayer(state.baseLayers.osm);
          state.baseLayers.satellite.addTo(state.map);
          state.activeBaseLayer = "satellite";
        } else {
          if (state.map.hasLayer(state.baseLayers.satellite)) state.map.removeLayer(state.baseLayers.satellite);
          state.baseLayers.osm.addTo(state.map);
          state.activeBaseLayer = "osm";
        }
      };
    });

    // 6. Checkbox Overlays
    const checkNodes = getEl("layerCheckNodes");
    if (checkNodes) {
      checkNodes.onchange = () => {
        if (checkNodes.checked) state.map.addLayer(state.overlayLayers.nodes);
        else state.map.removeLayer(state.overlayLayers.nodes);
      };
    }

    const checkInarisk = getEl("layerCheckInarisk");
    if (checkInarisk) {
      checkInarisk.onchange = () => {
        if (checkInarisk.checked) state.map.addLayer(state.overlayLayers.inarisk);
        else state.map.removeLayer(state.overlayLayers.inarisk);
      };
    }

    const checkRadar = getEl("layerCheckRadar");
    if (checkRadar) {
      checkRadar.onchange = () => {
        if (state.overlayLayers.radar) {
          if (checkRadar.checked) state.map.addLayer(state.overlayLayers.radar);
          else state.map.removeLayer(state.overlayLayers.radar);
        }
      };
    }

    const checkFirms = getEl("layerCheckFirms");
    if (checkFirms) {
      checkFirms.onchange = () => {
        if (checkFirms.checked) {
          if (state.overlayLayers.firms) {
            state.map.addLayer(state.overlayLayers.firms);
          }
          fetchFirmsHotspots();
        } else {
          if (state.overlayLayers.firms) {
            state.map.removeLayer(state.overlayLayers.firms);
          }
        }
      };
    }

    // 7. Kontrol Peta Kanan Bawah
    const btnZoomIn = getEl("btnZoomIn");
    if (btnZoomIn) btnZoomIn.onclick = () => state.map.zoomIn();

    const btnZoomOut = getEl("btnZoomOut");
    if (btnZoomOut) btnZoomOut.onclick = () => state.map.zoomOut();

    const btnCenter = getEl("btnCenterNode");
    if (btnCenter) {
      btnCenter.onclick = () => {
        const activeNode = state.nodes.get(state.activeNodeId) || CONFIG.DEFAULT_NODE;
        state.map.setView([activeNode.lat, activeNode.lng], CONFIG.MAP.TARGET_ZOOM, { animate: true });
      };
    }

    const btnFitAll = getEl("btnFitAllNodes");
    if (btnFitAll) {
      btnFitAll.onclick = () => {
        if (state.overlayLayers.nodes && state.overlayLayers.nodes.getLayers().length > 0) {
          state.map.fitBounds(state.overlayLayers.nodes.getBounds().pad(0.2));
        }
      };
    }

    // 8. Toggle Audio Alarm
    const btnAudio = getEl("btnToggleAudio");
    const iconAudio = getEl("iconAudio");
    if (btnAudio) {
      btnAudio.onclick = () => {
        state.isAudioEnabled = !state.isAudioEnabled;
        if (iconAudio) {
          iconAudio.setAttribute("data-lucide", state.isAudioEnabled ? "volume-2" : "volume-x");
          if (window.lucide) window.lucide.createIcons();
        }
        btnAudio.title = state.isAudioEnabled ? "Bisukan Alarm" : "Aktifkan Alarm";

        // Sembunyikan prompt audio jika ada
        const promptBanner = getEl("audioPromptBanner");
        if (promptBanner) promptBanner.classList.add("hidden");
      };
    }

    const btnEnableAudio = getEl("btnEnableAudio");
    if (btnEnableAudio) {
      btnEnableAudio.onclick = () => {
        state.isAudioEnabled = true;
        const promptBanner = getEl("audioPromptBanner");
        if (promptBanner) promptBanner.classList.add("hidden");
        const ctx = getAudioContext();
        if (ctx && ctx.state === "suspended") ctx.resume();
        if (iconAudio) {
          iconAudio.setAttribute("data-lucide", "volume-2");
          if (window.lucide) window.lucide.createIcons();
        }
      };
    }

    // Tutup banner peringatan
    const btnCloseBanner = getEl("btnCloseBanner");
    const banner = getEl("systemIssueBanner");
    if (btnCloseBanner && banner) {
      btnCloseBanner.onclick = () => banner.classList.add("hidden");
    }
  }

  // =========================================================================
  // 13. CLOCK & SYNC TICKER
  // =========================================================================
  function startClock() {
    setInterval(() => {
      const now = new Date();
      const timeStr = now.toLocaleTimeString("id-ID", { hour12: false }) + " WIB";
      setText("clockWib", timeStr);

      const syncEl = getEl("syncLatency");
      if (syncEl) {
        let latestTs = 0;
        state.nodes.forEach(node => {
          if (node.latest && node.latest.ts) {
            let t = Number(node.latest.ts);
            if (t < 1e11 && t > 0) t = t * 1000;
            if (t > latestTs) latestTs = t;
          }
        });
        if (latestTs === 0 && state.lastFirebaseUpdate > 0) {
          latestTs = state.lastFirebaseUpdate;
        }

        // Hanya tampilkan waktu jika ada live update (bukan dari data stale awal)
        if (latestTs > 0 && state._liveUpdateCount >= 1) {
          const diffSec = Math.floor((now.getTime() - latestTs) / 1000);
          if (diffSec < 60) {
            syncEl.textContent = `Diperbarui ${Math.max(0, diffSec)} detik lalu`;
          } else if (diffSec < 3600) {
            syncEl.textContent = `Diperbarui ${Math.floor(diffSec / 60)} menit lalu`;
          } else {
            syncEl.textContent = `Diperbarui ${Math.floor(diffSec / 3600)} jam lalu`;
          }
        } else {
          syncEl.textContent = "Menunggu data perangkat...";
        }
      }

      // Evaluasi data lama & status koneksi secara aktif setiap detik
      evaluateNetworkStatus();
    }, 1000);
  }

  // =========================================================================
  // 14. INIT ENTRY POINT
  // =========================================================================
  document.addEventListener("DOMContentLoaded", () => {
    // 1. Terapkan tema terang secara permanen
    try {
      document.documentElement.setAttribute("data-theme", "light");
      localStorage.removeItem("titen_theme");
      localStorage.setItem("titen_theme", "light");
    } catch (e) {
      console.warn("Theme init notice:", e);
    }

    // 2. Inisialisasi ikon Lucide awal
    try {
      if (window.lucide) {
        window.lucide.createIcons();
      }
    } catch (e) {
      console.warn("Lucide icons init notice:", e);
    }

    // 3. Siapkan Peta Leaflet
    try {
      initMap();
    } catch (e) {
      console.error("Map initialization notice:", e);
    }

    // 4. Siapkan Default Node
    try {
      state.nodes.set(CONFIG.DEFAULT_NODE.id, {
        ...CONFIG.DEFAULT_NODE,
        latest: null
      });
      renderOrUpdateNodeMarker(state.nodes.get(CONFIG.DEFAULT_NODE.id));
      selectActiveNode(CONFIG.DEFAULT_NODE.id);
    } catch (e) {
      console.warn("Default node setup notice:", e);
    }

    // 5. Setup Event Listeners UI & Label Ambang Batas
    try {
      setupUIEventListeners();
      populateThresholdLabels();
    } catch (e) {
      console.warn("UI setup notice:", e);
    }

    // 6. Jalankan Jam & Firebase
    try {
      startClock();
      initFirebase();
    } catch (e) {
      console.warn("Clock/Firebase notice:", e);
    }

    // 7. Jalankan Mode Demo jika URL memuat ?demo=1
    try {
      initDemoMode();
    } catch (e) {
      console.warn("Demo mode notice:", e);
    }

    // 8. Daftarkan Service Worker (PWA)
    try {
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("sw.js").catch(err => {
          console.warn("ServiceWorker registration notice:", err);
        });
      }
    } catch (e) {}

    // Tampilkan prompt audio sekali di awal
    setTimeout(() => {
      const promptBanner = getEl("audioPromptBanner");
      if (promptBanner && !state.isAudioEnabled) {
        promptBanner.classList.remove("hidden");
      }
    }, 2000);
  });

})();


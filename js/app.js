/**
 * EWS TITEN - Modern Minimalist IoT Early Warning System Telemetry
 * Tim TRILOGY - MAGE 12 (IoT)
 * Menara Sains Tower 2 ITS Sukolilo Surabaya
 */

(function () {
  "use strict";

  // State Telemetri Riil (Deteksi Hardware Gateway Riil)
  const state = {
    map: null,
    marker: null,
    circle: null,
    chart: null,
    audioEnabled: false,
    audioCtx: null,
    isGatewayLive: false,
    liveUpdateCount: 0,
    initialSnapshotReceived: false,
    initialDataString: null,
    lastPacketTime: 0,
    staleTimeoutSec: 35, // Gateway deep sleep ~20s, toleransi 35 detik
    history: {
      labels: [],
      suhu: [],
      tanah: [],
      miring: []
    },
    maxHistoryPoints: 15
  };

  // Helper ID
  function getEl(id) {
    return document.getElementById(id);
  }

  function setText(id, text) {
    const el = getEl(id);
    if (el) el.textContent = text;
  }

  // 1. Live Clock
  function initClock() {
    function tick() {
      const now = new Date();
      const timeStr = now.toLocaleTimeString("id-ID", { hour12: false });
      setText("clockWib", `Update: ${timeStr} WIB`);
    }
    setInterval(tick, 1000);
    tick();
  }

  // 2. Audio Web API Synthesizer
  function initAudio() {
    const btn = getEl("btnToggleAudio");
    if (!btn) return;

    btn.addEventListener("click", () => {
      if (!state.audioCtx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) state.audioCtx = new AudioCtx();
      }

      if (state.audioCtx && state.audioCtx.state === "suspended") {
        state.audioCtx.resume().catch(() => {});
      }

      state.audioEnabled = !state.audioEnabled;
      if (state.audioEnabled) {
        btn.classList.add("active");
        btn.textContent = "🔊";
        btn.title = "Matikan Suara Sirine";
      } else {
        btn.classList.remove("active");
        btn.textContent = "🔇";
        btn.title = "Aktifkan Sirine Audio";
      }
    });
  }

  function playAlertChirp(isDanger) {
    if (!state.audioEnabled || !state.audioCtx) return;
    try {
      const now = state.audioCtx.currentTime;
      const osc = state.audioCtx.createOscillator();
      const gain = state.audioCtx.createGain();

      if (isDanger) {
        // Sawtooth emergency siren
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(1320, now + 0.35);
        gain.gain.setValueAtTime(0.35, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
        osc.connect(gain);
        gain.connect(state.audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.5);
      } else {
        // Warning beep
        osc.type = "sine";
        osc.frequency.setValueAtTime(750, now);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
        osc.connect(gain);
        gain.connect(state.audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.25);
      }
    } catch (e) {
      console.warn("Audio synthesizer notice:", e);
    }
  }

  // 3. Inisialisasi Peta Leaflet (Lokasi Menara Sains Tower 2 ITS)
  function initMap() {
    if (typeof L === "undefined") {
      setTimeout(initMap, 200);
      return;
    }

    const tower2Coords = [-7.28197, 112.79532];
    
    // Cegah double initialization
    const mapContainer = getEl("map");
    if (!mapContainer || mapContainer._leaflet_id) {
      return;
    }

    state.map = L.map("map", {
      center: tower2Coords,
      zoom: 17,
      minZoom: 13,
      maxZoom: 20,
      zoomControl: true
    });

    // Layer Peta Handal (Google Maps Tiles API, CARTO, & Esri)
    const baseGoogleRoad = L.tileLayer("https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}", {
      attribution: '&copy; Google Maps &mdash; Menara Sains Tower 2 ITS',
      maxZoom: 20
    });
    const baseGoogleHybrid = L.tileLayer("https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}", {
      attribution: '&copy; Google Maps Satelit &mdash; Kampus ITS',
      maxZoom: 20
    });
    const baseCarto = L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; CARTO &copy; OpenStreetMap',
      maxZoom: 19
    });
    const baseEsri = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", {
      attribution: 'Tiles &copy; Esri &mdash; Tower 2 ITS',
      maxZoom: 19
    });

    // Default layer: Google Maps Road (Kampus ITS)
    baseGoogleRoad.addTo(state.map);

    L.control.layers({
      "Google Maps (Jalan)": baseGoogleRoad,
      "Google Maps (Satelit)": baseGoogleHybrid,
      "Peta Kota (CARTO)": baseCarto,
      "Peta Kampus (Esri)": baseEsri
    }, null, { position: "topright" }).addTo(state.map);

    // Marker Custom dengan Denyut Bouncing
    const customIcon = L.divIcon({
      className: "titen-leaflet-icon",
      html: `
        <div class="titen-marker-container" id="mapMarkerContainer">
          <div class="titen-marker-ring"></div>
          <div class="titen-marker-icon">
            <img src="assets/logo-mark-white.png" onerror="this.src='assets/logo-white-transparent.png'" alt="TITEN" />
          </div>
        </div>
      `,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
      popupAnchor: [0, -18]
    });

    state.marker = L.marker(tower2Coords, { icon: customIcon }).addTo(state.map);
    state.marker.bindPopup(`
      <div style="font-family:'Plus Jakarta Sans',sans-serif;min-width:210px;padding:4px 2px;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
          <span style="background:#004aad;color:#ffffff;font-size:10px;font-weight:800;padding:2px 7px;border-radius:4px;">NODE-01</span>
          <b style="color:#004aad;font-size:13px;">Menara Sains Tower 2 ITS</b>
        </div>
        <p style="font-size:11px;color:#64748b;margin:0 0 6px 0;line-height:1.35;">
          Institut Teknologi Sepuluh Nopember, Sukolilo, Surabaya<br>
          Sensor Pemantauan Lereng &amp; Karhutla
        </p>
        <div style="font-family:'JetBrains Mono',monospace;font-size:10.5px;color:#004aad;background:#eef4fc;padding:4px 8px;border-radius:4px;margin-bottom:8px;font-weight:600;">
          📍 Lat: -7.28197 | Long: 112.79532
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
          <span style="font-size:11px;font-weight:700;">Status: <b id="mapPopupStatus" style="color:#004aad;">Sedang Mencari...</b></span>
          <a href="https://maps.google.com/?q=-7.28197,112.79532" target="_blank" rel="noopener" style="background:#004aad;color:#ffffff;text-decoration:none;font-size:10px;font-weight:700;padding:4px 8px;border-radius:4px;white-space:nowrap;">Buka Maps ↗</a>
        </div>
      </div>
    `).openPopup();

    // Radius Lingkaran Jangkauan Sensor (120m di sekitar Tower 2 ITS)
    state.circle = L.circle(tower2Coords, {
      color: "#64748b",
      fillColor: "#64748b",
      fillOpacity: 0.12,
      radius: 120
    }).addTo(state.map);
  }

  // 4. Inisialisasi Grafik Real-Time (Chart.js) TANPA DATA PALSU
  function initChart() {
    const canvas = getEl("telemetryChart");
    if (!canvas || typeof Chart === "undefined") {
      setTimeout(initChart, 200);
      return;
    }

    // Hindari duplikasi chart instance
    if (state.chart) {
      state.chart.destroy();
      state.chart = null;
    }

    // Mulai dari array kosong (tidak ada data buatan/dummy)
    state.history.labels = [];
    state.history.suhu = [];
    state.history.tanah = [];
    state.history.miring = [];

    state.chart = new Chart(canvas, {
      type: "line",
      data: {
        labels: state.history.labels,
        datasets: [
          {
            label: "Kemiringan (°)",
            data: state.history.miring,
            borderColor: "#de350b",
            backgroundColor: "rgba(222, 53, 11, 0.08)",
            borderWidth: 2,
            tension: 0.3,
            pointRadius: 3
          },
          {
            label: "Suhu (°C)",
            data: state.history.suhu,
            borderColor: "#b89300",
            backgroundColor: "transparent",
            borderWidth: 2,
            tension: 0.3,
            pointRadius: 3
          },
          {
            label: "Kelembapan Tanah (%)",
            data: state.history.tanah,
            borderColor: "#004aad",
            backgroundColor: "transparent",
            borderWidth: 1.8,
            borderDash: [4, 4],
            tension: 0.3,
            pointRadius: 3
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
            labels: {
              boxWidth: 12,
              font: { family: "'Plus Jakarta Sans', sans-serif", size: 11, weight: "700" },
              color: "#475569"
            }
          },
          tooltip: {
            backgroundColor: "#0f172a",
            titleFont: { family: "'JetBrains Mono', monospace", size: 12 },
            bodyFont: { family: "'Plus Jakarta Sans', sans-serif", size: 11 },
            padding: 10,
            cornerRadius: 6
          }
        },
        scales: {
          x: {
            grid: { color: "rgba(226, 232, 240, 0.6)" },
            ticks: { font: { family: "'JetBrains Mono', monospace", size: 10 }, color: "#64748b" }
          },
          y: {
            grid: { color: "rgba(226, 232, 240, 0.6)" },
            ticks: { font: { family: "'JetBrains Mono', monospace", size: 10 }, color: "#64748b" }
          }
        }
      }
    });
  }

  function pushChartData(suhuVal, tanahVal, miringVal) {
    if (!state.chart) return;
    const nowStr = new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

    state.history.labels.push(nowStr);
    state.history.suhu.push(suhuVal);
    state.history.tanah.push(tanahVal);
    state.history.miring.push(miringVal);

    if (state.history.labels.length > state.maxHistoryPoints) {
      state.history.labels.shift();
      state.history.suhu.shift();
      state.history.tanah.shift();
      state.history.miring.shift();
    }

    state.chart.data.labels = state.history.labels;
    state.chart.data.datasets[0].data = state.history.miring;
    state.chart.data.datasets[1].data = state.history.suhu;
    state.chart.data.datasets[2].data = state.history.tanah;
    state.chart.update("none");
  }

  // 5. State Tampilan: SEDANG MENCARI GATEWAY
  function setUiSearching() {
    state.isGatewayLive = false;

    const cardStatus = getEl("cardStatusBanner");
    const textStatus = getEl("textStatusEws");
    if (cardStatus && textStatus) {
      cardStatus.className = "status-banner-card status-mencari";
      textStatus.textContent = "Sedang Mencari Gateway...";
      textStatus.className = "status-value val-mencari";
    }

    setText("badgeModeDaya", "Mencari...");
    setText("textPrediksiAi", "Menunggu transmisi telemetri dari Gateway ESP32 & Node sensor...");

    const pillCloud = getEl("pillCloud");
    const textCloud = getEl("textCloudStatus");
    if (pillCloud && textCloud) {
      pillCloud.className = "pill-cloud searching";
      textCloud.textContent = "SEDANG MENCARI GATEWAY";
    }

    // Set Sensor Placeholders
    setText("valSuhu", "--.-");
    setText("valUdara", "--.-");
    setText("valTanah", "--");
    setText("valMiring", "--");
    setText("valBateraiVolt", "-.--");
    setText("subBaterai", "Mencari Gateway...");
    setText("valRssi", "--");
    setText("subRssi", "Mencari LoRa...");

    const tags = ["tagSuhu", "tagUdara", "tagTanah", "tagMiring", "tagBaterai", "tagRssi"];
    tags.forEach(id => {
      const el = getEl(id);
      if (el) {
        el.textContent = "Sedang Mencari";
        el.className = "sensor-card-status status-mencari";
      }
    });

    const cards = ["cardSuhu", "cardUdara", "cardTanah", "cardMiring", "cardBaterai", "cardRssi"];
    cards.forEach(id => {
      const el = getEl(id);
      if (el) el.classList.remove("card-alert");
    });

    const mapPopupStatus = getEl("mapPopupStatus");
    if (mapPopupStatus) {
      mapPopupStatus.textContent = "Sedang Mencari...";
      mapPopupStatus.style.color = "#004aad";
    }

    const markerContainer = getEl("mapMarkerContainer");
    if (markerContainer) {
      markerContainer.classList.remove("danger");
    }

    if (state.circle) {
      state.circle.setStyle({ color: "#004aad", fillColor: "#004aad" });
    }
  }

  // 6. State Tampilan: TIDAK TERHUBUNG
  function setUiDisconnected(reason) {
    state.isGatewayLive = false;

    const cardStatus = getEl("cardStatusBanner");
    const textStatus = getEl("textStatusEws");
    if (cardStatus && textStatus) {
      cardStatus.className = "status-banner-card status-offline";
      textStatus.textContent = "Tidak Terhubung";
      textStatus.className = "status-value val-offline";
    }

    setText("badgeModeDaya", "Tidak Terhubung");
    setText("textPrediksiAi", reason ? `Gateway ESP32 belum dinyalakan atau sedang offline (${reason}).` : "Gateway ESP32 belum dinyalakan atau sedang offline.");

    const pillCloud = getEl("pillCloud");
    const textCloud = getEl("textCloudStatus");
    if (pillCloud && textCloud) {
      pillCloud.className = "pill-cloud offline";
      textCloud.textContent = "TIDAK TERHUBUNG";
    }

    // Sensor status offline
    setText("valSuhu", "--.-");
    setText("valUdara", "--.-");
    setText("valTanah", "--");
    setText("valMiring", "--");
    setText("valBateraiVolt", "-.--");
    setText("subBaterai", "Gateway Terputus");
    setText("valRssi", "--");
    setText("subRssi", "LoRa Terputus");

    const tags = ["tagSuhu", "tagUdara", "tagTanah", "tagMiring", "tagBaterai", "tagRssi"];
    tags.forEach(id => {
      const el = getEl(id);
      if (el) {
        el.textContent = "Tidak Terhubung";
        el.className = "sensor-card-status status-offline";
      }
    });

    const cards = ["cardSuhu", "cardUdara", "cardTanah", "cardMiring", "cardBaterai", "cardRssi"];
    cards.forEach(id => {
      const el = getEl(id);
      if (el) el.classList.remove("card-alert");
    });

    const badgeSirinePosko = getEl("badgeSirinePosko");
    const badgeSirineWrap = getEl("badgeSirineWrap");
    if (badgeSirinePosko && badgeSirineWrap) {
      badgeSirinePosko.textContent = "NON-AKTIF";
      badgeSirineWrap.classList.remove("siren-active");
    }

    const mapPopupStatus = getEl("mapPopupStatus");
    if (mapPopupStatus) {
      mapPopupStatus.textContent = "Tidak Terhubung";
      mapPopupStatus.style.color = "#64748b";
    }

    const markerContainer = getEl("mapMarkerContainer");
    if (markerContainer) {
      markerContainer.classList.remove("danger");
    }

    if (state.circle) {
      state.circle.setStyle({ color: "#64748b", fillColor: "#64748b" });
    }
  }

  // 7. Pembaharuan UI Telemetri Riil (HANYA SAAT ADA PAKET TRANSMISI AKTIF DARI GATEWAY)
  function updateTelemetryUI(data) {
    if (!data || typeof data !== "object") {
      setUiDisconnected("Paket Kosong");
      return;
    }

    // Verifikasi kelengkapan data minimal
    const hasCoreData = (data.suhu !== undefined || data.kelembapan_tanah !== undefined || data.kemiringan !== undefined || data.status_ews !== undefined);
    if (!hasCoreData) {
      setUiDisconnected("Format Tidak Sesuai");
      return;
    }

    state.isGatewayLive = true;
    state.lastPacketTime = Date.now();

    // Normalisasi Nilai Sensor Riil
    const suhu = (data.suhu !== undefined) ? parseFloat(data.suhu) : NaN;
    const udara = (data.kelembapan_udara !== undefined) ? parseFloat(data.kelembapan_udara) : (data.kelembapan !== undefined ? parseFloat(data.kelembapan) : NaN);
    const tanah = (data.kelembapan_tanah !== undefined) ? parseInt(data.kelembapan_tanah) : NaN;
    const miring = (data.kemiringan !== undefined) ? parseFloat(data.kemiringan) : (data.pitch !== undefined ? Math.abs(parseFloat(data.pitch)) : NaN);
    const persenBat = (data.persen_baterai !== undefined) ? parseInt(data.persen_baterai) : (data.baterai !== undefined ? parseInt(data.baterai) : NaN);
    const voltBat = (data.tegangan_baterai !== undefined) ? parseFloat(data.tegangan_baterai).toFixed(2) : (!isNaN(persenBat) ? (3.3 + (persenBat / 100) * 0.9).toFixed(2) : "-.--");
    const rssi = (data.rssi !== undefined) ? parseInt(data.rssi) : NaN;

    const rawStatus = (data.status_ews || "AMAN").toUpperCase();
    const modeDaya = data.mode_daya || "ECO DEEP SLEEP (20s)";
    const prediksiAi = data.prediksi_ai || "Lereng & Termal Stabil";
    const alarmAktif = data.alarm_aktif === true;

    // 1. Tampilkan Angka Sensor Riil
    setText("valSuhu", isNaN(suhu) ? "--.-" : suhu.toFixed(1));
    setText("valUdara", isNaN(udara) ? "--.-" : udara.toFixed(1));
    setText("valTanah", isNaN(tanah) ? "--" : tanah.toString());
    setText("valMiring", isNaN(miring) ? "--" : miring.toFixed(0));
    setText("valBateraiVolt", voltBat);
    setText("subBaterai", !isNaN(persenBat) ? `Kapasitas: ${persenBat}%` : "Kapasitas: --%");
    setText("valRssi", isNaN(rssi) ? "--" : rssi.toString());
    setText("subRssi", !isNaN(rssi) ? (rssi > -75 ? "Sinyal Sangat Kuat" : "Jarak Jauh") : "Tanpa Sinyal");

    // Evaluasi Status Ambang Batas Sensor Individual & Animasi Alert Kartu
    const cardSuhu = getEl("cardSuhu");
    const tagSuhu = getEl("tagSuhu");
    if (tagSuhu) {
      if (!isNaN(suhu)) {
        if (suhu >= 40) {
          tagSuhu.textContent = "Bahaya"; tagSuhu.className = "sensor-card-status status-danger";
          if (cardSuhu) cardSuhu.classList.add("card-alert");
        } else if (suhu >= 36) {
          tagSuhu.textContent = "Waspada"; tagSuhu.className = "sensor-card-status status-warn";
          if (cardSuhu) cardSuhu.classList.remove("card-alert");
        } else {
          tagSuhu.textContent = "Normal"; tagSuhu.className = "sensor-card-status";
          if (cardSuhu) cardSuhu.classList.remove("card-alert");
        }
      } else {
        tagSuhu.textContent = "--"; tagSuhu.className = "sensor-card-status";
      }
    }

    const cardUdara = getEl("cardUdara");
    const tagUdara = getEl("tagUdara");
    if (tagUdara) {
      if (!isNaN(udara)) {
        if (udara <= 30) {
          tagUdara.textContent = "Kering Kritis"; tagUdara.className = "sensor-card-status status-danger";
          if (cardUdara) cardUdara.classList.add("card-alert");
        } else if (udara <= 45) {
          tagUdara.textContent = "Kering"; tagUdara.className = "sensor-card-status status-warn";
          if (cardUdara) cardUdara.classList.remove("card-alert");
        } else {
          tagUdara.textContent = "Lembap"; tagUdara.className = "sensor-card-status";
          if (cardUdara) cardUdara.classList.remove("card-alert");
        }
      } else {
        tagUdara.textContent = "--"; tagUdara.className = "sensor-card-status";
      }
    }

    const cardTanah = getEl("cardTanah");
    const tagTanah = getEl("tagTanah");
    if (tagTanah) {
      if (!isNaN(tanah)) {
        if (tanah >= 75) {
          tagTanah.textContent = "Jenuh Bahaya"; tagTanah.className = "sensor-card-status status-danger";
          if (cardTanah) cardTanah.classList.add("card-alert");
        } else if (tanah >= 60) {
          tagTanah.textContent = "Jenuh Air"; tagTanah.className = "sensor-card-status status-warn";
          if (cardTanah) cardTanah.classList.remove("card-alert");
        } else {
          tagTanah.textContent = "Stabil"; tagTanah.className = "sensor-card-status";
          if (cardTanah) cardTanah.classList.remove("card-alert");
        }
      } else {
        tagTanah.textContent = "--"; tagTanah.className = "sensor-card-status";
      }
    }

    const cardMiring = getEl("cardMiring");
    const tagMiring = getEl("tagMiring");
    if (tagMiring) {
      if (!isNaN(miring)) {
        if (miring >= 25) {
          tagMiring.textContent = "Kritis"; tagMiring.className = "sensor-card-status status-danger";
          if (cardMiring) cardMiring.classList.add("card-alert");
        } else if (miring >= 12) {
          tagMiring.textContent = "Miring"; tagMiring.className = "sensor-card-status status-warn";
          if (cardMiring) cardMiring.classList.remove("card-alert");
        } else {
          tagMiring.textContent = "Tegak"; tagMiring.className = "sensor-card-status";
          if (cardMiring) cardMiring.classList.remove("card-alert");
        }
      } else {
        tagMiring.textContent = "--"; tagMiring.className = "sensor-card-status";
      }
    }

    // Evaluasi Status Baterai & LoRa
    const tagBaterai = getEl("tagBaterai");
    if (tagBaterai) {
      if (!isNaN(persenBat)) {
        tagBaterai.textContent = persenBat <= 20 ? "Lemah" : "Li-Ion Mandiri";
        tagBaterai.className = persenBat <= 20 ? "sensor-card-status status-warn" : "sensor-card-status";
      }
    }

    const tagRssi = getEl("tagRssi");
    if (tagRssi) {
      if (!isNaN(rssi)) {
        if (rssi > -75) tagRssi.textContent = "Sangat Kuat";
        else if (rssi >= -95) tagRssi.textContent = "Jarak Jauh";
        else tagRssi.textContent = "Lemah";
        tagRssi.className = rssi < -95 ? "sensor-card-status status-warn" : "sensor-card-status";
      }
    }

    // 2. Tampilkan Mode & Edge AI Riil
    setText("badgeModeDaya", modeDaya);
    setText("textPrediksiAi", prediksiAi);

    // 3. Status Sirine
    const badgeSirinePosko = getEl("badgeSirinePosko");
    const badgeSirineWrap = getEl("badgeSirineWrap");
    if (badgeSirinePosko && badgeSirineWrap) {
      if (alarmAktif || rawStatus.includes("BAHAYA") || rawStatus.includes("AWAS")) {
        badgeSirinePosko.textContent = "AKTIF (125dB)";
        badgeSirineWrap.classList.add("siren-active");
      } else {
        badgeSirinePosko.textContent = "NON-AKTIF";
        badgeSirineWrap.classList.remove("siren-active");
      }
    }

    // 4. Status Cloud Pill Navbar: GATEWAY TERHUBUNG
    const pillCloud = getEl("pillCloud");
    const textCloud = getEl("textCloudStatus");
    if (pillCloud && textCloud) {
      pillCloud.className = "pill-cloud";
      textCloud.textContent = "GATEWAY TERHUBUNG";
    }

    // 5. Evaluasi Status Peringatan Dini Global & Animasi Bahaya
    const cardStatus = getEl("cardStatusBanner");
    const textStatus = getEl("textStatusEws");
    const markerContainer = getEl("mapMarkerContainer");
    const mapPopupStatus = getEl("mapPopupStatus");

    let isDanger = rawStatus.includes("BAHAYA") || rawStatus.includes("AWAS") || (!isNaN(miring) && miring >= 25) || (!isNaN(suhu) && suhu >= 40);
    let isSiaga = rawStatus.includes("SIAGA") || (!isNaN(miring) && miring >= 20) || (!isNaN(suhu) && suhu >= 38);
    let isWaspada = rawStatus.includes("WASPADA") || (!isNaN(miring) && miring >= 12) || (!isNaN(suhu) && suhu >= 36) || (!isNaN(tanah) && tanah >= 60);

    let displayStatus = "AMAN";
    let statusClass = "status-aman";
    let statusColor = "#108a00";

    if (isDanger) {
      displayStatus = rawStatus.includes("BAHAYA") ? rawStatus : "BAHAYA";
      statusClass = "status-bahaya";
      statusColor = "#de350b";
    } else if (isSiaga) {
      displayStatus = "SIAGA";
      statusClass = "status-siaga";
      statusColor = "#e27d00";
    } else if (isWaspada) {
      displayStatus = "WASPADA";
      statusClass = "status-waspada";
      statusColor = "#b8860b";
    }

    if (cardStatus && textStatus) {
      cardStatus.className = `status-banner-card ${statusClass}`;
      textStatus.textContent = displayStatus;
      textStatus.className = "status-value";
      if (isDanger) textStatus.classList.add("val-bahaya");
      else if (isSiaga) textStatus.classList.add("val-siaga");
      else if (isWaspada) textStatus.classList.add("val-waspada");
    }

    // Marker Peta Animasi
    if (markerContainer) {
      if (isDanger) {
        markerContainer.classList.add("danger");
      } else {
        markerContainer.classList.remove("danger");
      }
    }

    if (mapPopupStatus) {
      mapPopupStatus.textContent = displayStatus;
      mapPopupStatus.style.color = statusColor;
    }

    // Update posisi marker jika koordinat valid
    if (data.latitude && data.longitude && !isNaN(parseFloat(data.latitude)) && !isNaN(parseFloat(data.longitude))) {
      const lat = parseFloat(data.latitude);
      const lng = parseFloat(data.longitude);
      if (state.marker) state.marker.setLatLng([lat, lng]);
      if (state.circle) state.circle.setLatLng([lat, lng]);
    }

    if (state.circle) {
      state.circle.setStyle({
        color: isDanger ? "#de350b" : (isWaspada ? "#ffde59" : "#004aad"),
        fillColor: isDanger ? "#de350b" : (isWaspada ? "#ffde59" : "#004aad")
      });
    }

    // Bunyikan Alarm Audio jika bahaya
    if (isDanger) {
      playAlertChirp(true);
    }

    // Perbarui Grafik Real-Time Hanya dengan Data Valid
    if (!isNaN(suhu) && !isNaN(tanah) && !isNaN(miring)) {
      pushChartData(suhu, tanah, miring);
    }
  }

  // 8. Koneksi Firebase Realtime Database
  function initFirebase() {
    if (typeof firebase === "undefined") {
      console.warn("Firebase SDK tidak termuat.");
      setUiDisconnected("Firebase SDK Offline");
      return;
    }

    try {
      const firebaseConfig = {
        databaseURL: "https://ews-titen-default-rtdb.asia-southeast1.firebasedatabase.app"
      };

      if (!firebase.apps || !firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
      }
      const db = firebase.database();

      // Monitor Status Koneksi Cloud Firebase (Koneksi Web Client ke Firebase)
      db.ref(".info/connected").on("value", (snap) => {
        const isConnected = snap.val() === true;
        if (!isConnected) {
          setUiDisconnected("Internet Terputus");
        } else if (!state.isGatewayLive) {
          setUiSearching();
        }
      });

      // Dengarkan Paket Data ews_data
      db.ref("ews_data").on("value", (snapshot) => {
        const data = snapshot.val();
        if (!data || typeof data !== "object") {
          setUiDisconnected("Data Kosong");
          return;
        }

        const dataStr = JSON.stringify(data);

        // Snapshot pertama kali pada saat buka web adalah data lama/stale di database
        if (!state.initialSnapshotReceived) {
          state.initialSnapshotReceived = true;
          state.initialDataString = dataStr;

          // Gateway belum tentu aktif dinyalakan saat buka web -> Tetap di state mencari!
          setUiSearching();

          // Beri jendela waktu 12 detik: jika gateway tidak mengirimkan pembaruan, nyatakan TIDAK TERHUBUNG
          setTimeout(() => {
            if (!state.isGatewayLive) {
              setUiDisconnected("Gateway Belum Dinyalakan");
            }
          }, 12000);
          return;
        }

        // Jika ada penulisan data baru berikutnya dari gateway ESP32:
        state.liveUpdateCount++;
        state.isGatewayLive = true;
        state.lastPacketTime = Date.now();
        updateTelemetryUI(data);

      }, (err) => {
        console.warn("Firebase ews_data error:", err);
        setUiDisconnected("Error Firebase");
      });

      // Watchdog Rutin: Cek setiap 3 detik apakah gateway masih aktif mengirim
      setInterval(() => {
        if (state.isGatewayLive) {
          const elapsedSec = (Date.now() - state.lastPacketTime) / 1000;
          if (elapsedSec > state.staleTimeoutSec) {
            // Lebih dari 35 detik tidak ada transmisi baru -> Gateway offline/dimatikan
            state.isGatewayLive = false;
            setUiDisconnected("Gateway Terputus");
          }
        }
      }, 3000);

    } catch (err) {
      console.warn("Firebase initialization notice:", err);
      setUiDisconnected("Gagal Inisialisasi");
    }
  }

  // Inisialisasi Dashboard
  document.addEventListener("DOMContentLoaded", () => {
    initClock();
    initAudio();
    initMap();
    initChart();
    setUiSearching(); // Default awal: Sedang Mencari Gateway
    initFirebase();
  });

})();

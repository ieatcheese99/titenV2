/**
 * EWS TITEN - Minimalist Modern IoT Early Warning System Telemetry
 * Tim TRILOGY - MAGE 12 (IoT)
 */

(function () {
  "use strict";

  // State Telemetri
  const state = {
    map: null,
    marker: null,
    markerEl: null,
    circle: null,
    chart: null,
    audioEnabled: false,
    audioCtx: null,
    history: {
      labels: [],
      suhu: [],
      tanah: [],
      miring: []
    },
    maxHistoryPoints: 12
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
      setText("clockWib", `Update: ${timeStr}`);
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

  // 3. Inisialisasi Peta Leaflet (Lokasi Statis Tower 2 ITS)
  function initMap() {
    if (typeof L === "undefined") {
      setTimeout(initMap, 200);
      return;
    }

    const tower2Coords = [-7.2819, 112.7953];
    state.map = L.map("map", {
      center: tower2Coords,
      zoom: 16,
      minZoom: 13,
      maxZoom: 19,
      zoomControl: true
    });

    // Basemap: CartoDB Voyager (cepat, andal, tanpa blokir tile 403)
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(state.map);

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
      <div style="font-family: var(--font-sans); font-size: 12px; line-height: 1.5; color: #ffffff;">
        <b style="color: var(--color-gold); font-size: 13px;">EWS TITEN NODE-01</b><br/>
        <b>Lokasi:</b> Gedung Tower 2 ITS, Kampus Sukolilo<br/>
        <b>Koordinat:</b> -7.2819, 112.7953<br/>
        <b>Status:</b> <span id="mapPopupStatus" style="color: var(--color-safe); font-weight: 700;">AMAN</span>
      </div>
    `);

    // Radius Lingkaran Jangkauan Sensor (120m)
    state.circle = L.circle(tower2Coords, {
      color: "#004aad",
      fillColor: "#004aad",
      fillOpacity: 0.15,
      radius: 120
    }).addTo(state.map);
  }

  // 4. Inisialisasi Grafik Real-Time (Chart.js)
  function initChart() {
    const canvas = getEl("telemetryChart");
    if (!canvas || typeof Chart === "undefined") {
      setTimeout(initChart, 200);
      return;
    }

    const now = Date.now();
    for (let i = state.maxHistoryPoints - 1; i >= 0; i--) {
      const t = new Date(now - i * 20000);
      state.history.labels.push(t.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      state.history.suhu.push(27.4);
      state.history.tanah.push(19);
      state.history.miring.push(1);
    }

    state.chart = new Chart(canvas, {
      type: "line",
      data: {
        labels: state.history.labels,
        datasets: [
          {
            label: "Kemiringan (°)",
            data: state.history.miring,
            borderColor: "#ef4444",
            backgroundColor: "rgba(239, 68, 68, 0.1)",
            borderWidth: 2,
            tension: 0.35,
            pointRadius: 2.5
          },
          {
            label: "Suhu (°C)",
            data: state.history.suhu,
            borderColor: "#ffde59",
            backgroundColor: "transparent",
            borderWidth: 2,
            tension: 0.35,
            pointRadius: 2.5
          },
          {
            label: "Kelembapan Tanah (%)",
            data: state.history.tanah,
            borderColor: "#38bdf8",
            backgroundColor: "transparent",
            borderWidth: 1.8,
            borderDash: [4, 4],
            tension: 0.35,
            pointRadius: 2
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
              color: "#94a3b8",
              boxWidth: 12,
              font: { size: 10.5, family: "Plus Jakarta Sans" }
            }
          },
          tooltip: {
            padding: 8,
            titleFont: { size: 11, family: "Plus Jakarta Sans" },
            bodyFont: { size: 11, family: "JetBrains Mono" }
          }
        },
        scales: {
          x: {
            grid: { color: "rgba(255, 255, 255, 0.05)" },
            ticks: { color: "#64748b", font: { size: 9.5, family: "JetBrains Mono" } }
          },
          y: {
            grid: { color: "rgba(255, 255, 255, 0.05)" },
            ticks: { color: "#64748b", font: { size: 9.5, family: "JetBrains Mono" } },
            suggestedMin: 0,
            suggestedMax: 60
          }
        }
      }
    });
  }

  function pushChartData(suhu, tanah, miring) {
    if (!state.chart) return;
    const now = new Date();
    const timeStr = now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

    state.history.labels.push(timeStr);
    state.history.suhu.push(suhu);
    state.history.tanah.push(tanah);
    state.history.miring.push(miring);

    if (state.history.labels.length > state.maxHistoryPoints) {
      state.history.labels.shift();
      state.history.suhu.shift();
      state.history.tanah.shift();
      state.history.miring.shift();
    }

    state.chart.update("none");
  }

  // 5. Update UI Telemetri dari Paket Data
  function updateTelemetryUI(data) {
    if (!data) return;

    // Nilai Sensor
    const suhu = (data.suhu !== undefined) ? parseFloat(data.suhu) : 0;
    const udara = (data.kelembapan_udara !== undefined) ? parseFloat(data.kelembapan_udara) : 0;
    const tanah = (data.kelembapan_tanah !== undefined) ? parseInt(data.kelembapan_tanah) : 0;
    const miring = (data.kemiringan !== undefined) ? parseFloat(data.kemiringan) : ((data.kemiringan_x !== undefined) ? parseFloat(data.kemiringan_x) : 0);
    const persenBat = (data.persen_baterai !== undefined) ? parseInt(data.persen_baterai) : 85;
    const voltBat = data.baterai_voltase ? parseFloat(data.baterai_voltase).toFixed(2) : (3.2 + (persenBat / 100) * 1.0).toFixed(2);
    const rssi = (data.rssi !== undefined) ? parseInt(data.rssi) : -54;

    const rawStatus = (data.status_ews || "AMAN").toUpperCase();
    const modeDaya = data.mode_daya || "ECO DEEP SLEEP (20s)";
    const prediksiAi = data.prediksi_ai || "Lereng & Termal Stabil";
    const alarmAktif = data.alarm_aktif === true;

    // 1. Tampilkan Angka Sensor
    setText("valSuhu", suhu.toFixed(1));
    setText("valUdara", udara.toFixed(1));
    setText("valTanah", tanah.toString());
    setText("valMiring", miring.toFixed(0));
    setText("valBateraiVolt", voltBat);
    setText("subBaterai", `Kapasitas: ${persenBat}%`);
    setText("valRssi", rssi.toString());

    // Evaluasi Status Ambang Batas Sensor Individual
    const tagSuhu = getEl("tagSuhu");
    if (tagSuhu) {
      if (suhu >= 40) { tagSuhu.textContent = "Bahaya"; tagSuhu.className = "sensor-card-status status-danger"; }
      else if (suhu >= 36) { tagSuhu.textContent = "Waspada"; tagSuhu.className = "sensor-card-status status-warn"; }
      else { tagSuhu.textContent = "Normal"; tagSuhu.className = "sensor-card-status"; }
    }

    const tagUdara = getEl("tagUdara");
    if (tagUdara) {
      if (udara <= 30) { tagUdara.textContent = "Kering Kritis"; tagUdara.className = "sensor-card-status status-danger"; }
      else if (udara <= 45) { tagUdara.textContent = "Kering"; tagUdara.className = "sensor-card-status status-warn"; }
      else { tagUdara.textContent = "Lembap"; tagUdara.className = "sensor-card-status"; }
    }

    const tagTanah = getEl("tagTanah");
    if (tagTanah) {
      if (tanah >= 75) { tagTanah.textContent = "Jenuh Bahaya"; tagTanah.className = "sensor-card-status status-danger"; }
      else if (tanah >= 60) { tagTanah.textContent = "Jenuh Air"; tagTanah.className = "sensor-card-status status-warn"; }
      else { tagTanah.textContent = "Stabil"; tagTanah.className = "sensor-card-status"; }
    }

    const tagMiring = getEl("tagMiring");
    if (tagMiring) {
      if (miring >= 25) { tagMiring.textContent = "Kritis"; tagMiring.className = "sensor-card-status status-danger"; }
      else if (miring >= 12) { tagMiring.textContent = "Miring"; tagMiring.className = "sensor-card-status status-warn"; }
      else { tagMiring.textContent = "Tegak"; tagMiring.className = "sensor-card-status"; }
    }

    // Evaluasi Status LoRa
    const tagRssi = getEl("tagRssi");
    if (tagRssi) {
      if (rssi > -75) tagRssi.textContent = "Sangat Kuat";
      else if (rssi >= -95) tagRssi.textContent = "Jarak Jauh";
      else tagRssi.textContent = "Lemah";
    }

    // 2. Tampilkan Mode & Edge AI
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

    // 4. Evaluasi Status Peringatan Dini Global & Animasi Bahaya
    const cardStatus = getEl("cardStatusBanner");
    const textStatus = getEl("textStatusEws");
    const markerContainer = getEl("mapMarkerContainer");
    const mapPopupStatus = getEl("mapPopupStatus");

    let isDanger = rawStatus.includes("BAHAYA") || rawStatus.includes("AWAS") || miring >= 25 || suhu >= 40;
    let isSiaga = rawStatus.includes("SIAGA") || miring >= 20 || suhu >= 38;
    let isWaspada = rawStatus.includes("WASPADA") || miring >= 12 || suhu >= 36 || tanah >= 60;

    let displayStatus = "AMAN";
    let statusClass = "status-aman";
    let statusColor = "var(--color-safe)";

    if (isDanger) {
      displayStatus = rawStatus.includes("BAHAYA") ? rawStatus : "BAHAYA";
      statusClass = "status-bahaya";
      statusColor = "var(--color-danger)";
    } else if (isSiaga) {
      displayStatus = "SIAGA";
      statusClass = "status-siaga";
      statusColor = "var(--color-siaga)";
    } else if (isWaspada) {
      displayStatus = "WASPADA";
      statusClass = "status-waspada";
      statusColor = "var(--color-warn)";
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

    if (state.circle) {
      state.circle.setStyle({
        color: isDanger ? "#ef4444" : (isWaspada ? "#ffde59" : "#004aad"),
        fillColor: isDanger ? "#ef4444" : (isWaspada ? "#ffde59" : "#004aad")
      });
    }

    // Bunyikan Alarm Audio jika bahaya
    if (isDanger) {
      playAlertChirp(true);
    }

    // Perbarui Grafik Real-Time
    pushChartData(suhu, tanah, miring);
  }

  // 6. Koneksi Firebase Realtime Database
  function initFirebase() {
    if (typeof firebase === "undefined") {
      console.warn("Firebase SDK tidak termuat.");
      return;
    }

    try {
      const firebaseConfig = {
        databaseURL: "https://ews-titen-default-rtdb.asia-southeast1.firebasedatabase.app"
      };
      firebase.initializeApp(firebaseConfig);
      const db = firebase.database();

      // Monitor Status Koneksi Cloud
      db.ref(".info/connected").on("value", (snap) => {
        const isConnected = snap.val() === true;
        const pillCloud = getEl("pillCloud");
        const textCloud = getEl("textCloudStatus");

        if (pillCloud && textCloud) {
          if (isConnected) {
            pillCloud.className = "pill-cloud";
            textCloud.textContent = "CLOUD CONNECTED";
          } else {
            pillCloud.className = "pill-cloud offline";
            textCloud.textContent = "OFFLINE";
          }
        }
      });

      // Dengarkan Paket Data ews_data
      db.ref("ews_data").on("value", (snapshot) => {
        const data = snapshot.val();
        if (data) {
          updateTelemetryUI(data);
        }
      }, (err) => {
        console.warn("Firebase ews_data error:", err);
      });

    } catch (err) {
      console.warn("Firebase initialization notice:", err);
    }
  }

  // Inisialisasi Dashboard
  document.addEventListener("DOMContentLoaded", () => {
    initClock();
    initAudio();
    initMap();
    initChart();
    initFirebase();
  });

})();

/**
 * EWS TITEN - Konfigurasi Terpusat (Single Source of Truth)
 * Tim TRILOGY - SMK Budi Luhur Kota Tangerang (MAGE 12 - IoT)
 */

const CONFIG = {
  // 1. Identitas Sistem & Warna Merek
  APP_NAME: "EWS TITEN",
  APP_VERSION: "3.1.0",
  COMPETITION: "MAGE 12 - Tahap 2 (IoT)",
  INSTITUTION: "SMK Budi Luhur Kota Tangerang",
  BRAND_COLOR: "#004aad", // Cobalt Blue resmi dari logo TITEN

  // 2. Lokasi Node Prototipe (Gedung Tower 2 ITS Sukolilo, Surabaya)
  DEFAULT_NODE: {
    id: "node-01",
    nama: "Node-01 · Tower 2 ITS",
    lokasi: "Gedung Tower 2 ITS, Kampus Sukolilo, Surabaya",
    lat: -7.28528,
    lng: 112.79530,
    deskripsi: "Stasiun pemantau multisensor tanah longsor dan iklim mikro karhutla"
  },

  // 3. Parameter Animasi Peta Awal (Opening Zoom)
  MAP: {
    INDONESIA_CENTER: [-2.5, 118.0],
    INDONESIA_ZOOM: 5,
    TARGET_ZOOM: 16,
    FLY_DURATION: 3.5, // Durasi terbang halus dalam detik
    MIN_ZOOM: 4,
    MAX_ZOOM: 19
  },

  // 4. Parameter Jaringan & Watchdog Data Lama
  NETWORK: {
    NODE_SEND_INTERVAL_SEC: 60, // Sesuai interval deep sleep node ESP32
    // Data dianggap data lama jika ts data lebih lampau dari 3x interval pengiriman (180 detik)
    STALE_DATA_TIMEOUT_SEC: 180,
    // Histeresis: Level status turun hanya jika parameter aman selama N pembacaan berturut-turut
    HYSTERESIS_COUNT: 3
  },

  // 5. Firebase Realtime Database
  FIREBASE: {
    databaseURL: "https://ews-titen-default-rtdb.asia-southeast1.firebasedatabase.app"
  },

  // 6. Kontak Darurat (Posko Lapangan & Call Center Terpadu)
  EMERGENCY: {
    // 1. Posko Lapangan Tim TRILOGY
    // TODO: Ganti dengan nomor WhatsApp / HP Posko Lapangan sebenarnya saat lomba
    POSKO_LABEL: "Posko Lapangan TRILOGY",
    POSKO_PHONE: "081234567890", // TODO: Masukkan nomor posko lapangan
    
    // 2. Call Center Darurat Pemerintah (Cadangan Terintegrasi)
    CALL_CENTER_LABEL: "Call Center Darurat 112",
    CALL_CENTER_PHONE: "112",

    // 3. Posko BPBD Daerah Jatim
    BPBD_DAERAH_LABEL: "Pusdalops BPBD Jatim",
    BPBD_DAERAH_PHONE: "031-8550101"
  },

  // 7. Layer Peta Layanan Publik Sah (Tanpa mengarang API)
  LAYERS: {
    OSM: {
      url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
      maxZoom: 19
    },
    ESRI_SATELLITE: {
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      attribution: 'Tiles &copy; <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a>, Earthstar Geographics',
      maxZoom: 18
    },
    // Layanan publik sah dari analisis reverse engineering BNPB InaRISK (30m raster tile)
    INARISK_LONGSOR: {
      url: "https://inarisk2.bnpb.go.id/api-portal/layer/tile/1/INDEKS_BAHAYA_TANAHLONGSOR_30/{z}/{x}/{y}.png?style=bahaya",
      attribution: '&copy; <a href="https://inarisk.bnpb.go.id" target="_blank" rel="noopener">BNPB inaRISK</a> Indeks Bahaya 30m',
      minZoom: 5,
      maxZoom: 15,
      opacity: 0.65
    },
    // RainViewer Radar Cuaca Terbuka (maxNativeZoom: 7 sesuai data asli)
    RAINVIEWER: {
      api: "https://api.rainviewer.com/public/weather-maps.json",
      tileTemplate: "https://tilecache.rainviewer.com/v2/radar/{ts}/256/{z}/{x}/{y}/2/1_1.png",
      attribution: 'Weather data by <a href="https://www.rainviewer.com/" target="_blank" rel="noopener">RainViewer</a>',
      maxNativeZoom: 7, // Resolusi asli radar satelit
      maxZoom: 19,
      opacity: 0.7
    },
    // NASA FIRMS VIIRS Active Fire (via Cloudflare Pages Function Proxy)
    NASA_FIRMS: {
      // Sumber NRT aktif yang sah: VIIRS_NOAA20_NRT (opsional: VIIRS_NOAA21_NRT atau MODIS_NRT)
      source: "VIIRS_NOAA20_NRT",
      proxyEndpoint: "/api/firms",
      attribution: '&copy; <a href="https://firms.modaps.eosdis.nasa.gov/" target="_blank" rel="noopener">NASA FIRMS</a> VIIRS NOAA-20',
      days: 1,
      // Bounding Box difokuskan di sekitar Jawa Timur (minLon, minLat, maxLon, maxLat)
      bboxJatim: "110.8,-8.8,114.6,-6.5"
    }
  },

  // 8. AMBANG BATAS TUNGGAL (SINGLE SOURCE OF TRUTH)
  // Rujukan Ilmiah & Regulasi Nasional:
  // - Peraturan Kepala BNPB No. 02 Tahun 2012 tentang Pedoman Penilaian Risiko Bencana.
  // - Klasifikasi kerentanan gerakan tanah PVMBG (Badan Geologi) & SNI 8460:2017.
  // - Standar Indeks Kebakaran Hutan & Lahan BMKG (FDRS - Fire Danger Rating System).
  THRESHOLDS: {
    // Sektor 1: TANAH LONGSOR
    LONGSOR: {
      WASPADA: {
        miring: 12,       // derajat (°): awal pergeseran lereng (Rujukan: PVMBG kelerengan sedang 10-15°)
        tanah: 60,        // % saturasi air pori tanah
        label: "WASPADA",
        color: "#FFB800",
        ringkasan: "Peningkatan kadar air tanah atau deviasi sudut lereng awal.",
        tindakan: "Tingkatkan pemantauan retakan tanah. Petugas posko bersiap di titik kumpul."
      },
      SIAGA: {
        miring: 20,       // derajat (≥20° atau ≥16° dan tanah ≥70%)
        miring_alt: 16,
        tanah_alt: 70,
        label: "SIAGA",
        color: "#F97316",
        ringkasan: "Pergerakan lereng mikro terdeteksi atau tanah mendekati titik jenuh air.",
        tindakan: "Siagakan tim tanggap darurat. Warga di radius lereng bersiap evakuasi."
      },
      AWAS: {
        miring: 30,       // derajat (>30° atau >25° dan tanah >80%)
        miring_alt: 25,
        tanah_alt: 80,
        label: "AWAS",
        color: "#DC2626",
        ringkasan: "Deformasi lereng kritis atau tanah melampaui ambang likuifaksi.",
        tindakan: "DARURAT! Segera evakuasi mandiri, jauhi lereng curam, dan menuju titik kumpul posko!"
      },
      NORMAL: {
        label: "NORMAL",
        color: "#10B981",
        ringkasan: "Kondisi lereng stabil dan kelembapan tanah dalam batas aman.",
        tindakan: "Kondisi aman. Tetap lakukan patroli pemeliharaan sensor berkala."
      }
    },

    // Sektor 2: KEBAKARAN HUTAN & LAHAN (KARHUTLA)
    KARHUTLA: {
      WASPADA: {
        suhu: 34,         // °C (Rujukan: Indeks FDRS BMKG suhu permukaan vegetasi)
        udara_max: 45,    // % RH (kelembapan relatif udara mulai kering)
        label: "WASPADA",
        color: "#FFB800",
        ringkasan: "Suhu udara meningkat dan kelembapan udara mulai menurun.",
        tindakan: "Pencegahan dini: hindari aktivitas pembakaran atau percikan api di area sekitar."
      },
      SIAGA: {
        suhu: 38,         // °C (≥38°C atau ≥35°C dan RH ≤35%)
        suhu_alt: 35,
        udara_max_alt: 35,
        label: "SIAGA",
        color: "#F97316",
        ringkasan: "Cuaca panas kering terik. Bahan bakar vegetasi rentan terbakar cepat.",
        tindakan: "Petugas posko karhutla siaga peralatan pemadam dan memantau perimeter titik panas."
      },
      AWAS: {
        suhu: 45,         // °C (>45°C atau ≥40°C dan RH <25%)
        suhu_alt: 40,
        udara_max_alt: 25,
        label: "AWAS",
        color: "#DC2626",
        ringkasan: "Suhu ekstrem atau anomali panas pekat. Indikasi titik api/kebakaran aktif!",
        tindakan: "BAHAYA KEBAKARAN! Luncurkan tim pemadam, hubungi posko, dan blokir akses ke zona hutan!"
      },
      NORMAL: {
        label: "NORMAL",
        color: "#10B981",
        ringkasan: "Suhu udara dan kelembapan hutan dalam rentang wajar dan aman.",
        tindakan: "Kondisi stabil. Tidak terdeteksi indikasi anomali termal lingkungan."
      }
    },

    // Status Offline / Putus Sinyal
    OFFLINE: {
      label: "TIDAK TERHUBUNG",
      color: "#64748B",
      ringkasan: "Belum menerima paket telemetri LoRa dari node.",
      tindakan: "Periksa daya baterai node lapangan dan antena transceiver LoRa."
    }
  },

  // 9. Node Tambahan untuk Mode Demo (Hanya aktif bila ?demo=1)
  DEMO_NODES: [
    {
      id: "node-demo-02",
      nama: "Node-02 · Tebing Wonokromo (SIMULASI)",
      lokasi: "Bantaran Tanggul Wonokromo, Surabaya",
      lat: -7.3005,
      lng: 112.7380,
      deskripsi: "Node pengujian simulasi skenario bahaya longsor tebing sungai",
      isDemo: true,
      latest: {
        ts: Date.now() - 25000,
        suhu: 31.2,
        kelembapan_udara: 72.0,
        kelembapan_tanah: 84.0,
        kemiringan_x: 24.5,
        kemiringan_y: 2.1,
        getaran: 0.12,
        baterai_persen: 88,
        baterai_voltase: 4.02,
        rssi: -82
      }
    },
    {
      id: "node-demo-03",
      nama: "Node-03 · Mangrove Rungkut (SIMULASI)",
      lokasi: "Kawasan Hutan Lindung Mangrove Rungkut, Surabaya",
      lat: -7.3180,
      lng: 112.8250,
      deskripsi: "Node pengujian simulasi skenario waspada karhutla pesisir",
      isDemo: true,
      latest: {
        ts: Date.now() - 40000,
        suhu: 36.8,
        kelembapan_udara: 38.0,
        kelembapan_tanah: 45.0,
        kemiringan_x: 3.2,
        kemiringan_y: 0.8,
        getaran: 0.02,
        baterai_persen: 79,
        baterai_voltase: 3.91,
        rssi: -95
      }
    }
  ]
};

// Bekukan objek konfigurasi agar tidak termodifikasi saat runtime
if (typeof Object.freeze === "function") {
  Object.freeze(CONFIG.THRESHOLDS.LONGSOR);
  Object.freeze(CONFIG.THRESHOLDS.KARHUTLA);
  Object.freeze(CONFIG.THRESHOLDS.OFFLINE);
}

/**
 * Cloudflare Pages Function: NASA FIRMS API Proxy
 * Endpoint: /api/firms?source=VIIRS_NOAA20_NRT&days=1
 * 
 * Fungsi:
 * - Meneruskan permintaan titik panas (hotspots) ke NASA FIRMS API.
 * - Menggunakan environment variable FIRMS_MAP_KEY (terlindungi di server, tidak terekspos ke klien).
 * - Menangani CORS secara otomatis.
 * - Membatasi area ke sekitar Jawa Timur (BBOX) dan menerapkan edge caching 10 menit
 *   agar konsumsi transaksi jauh di bawah batas kuota NASA FIRMS (5.000 transaksi/10 menit).
 */

export async function onRequest(context) {
  const { request, env } = context;

  // Header CORS dasar
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8"
  };

  // Tangani preflight OPTIONS request
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // 1. Periksa ketersediaan Kunci API FIRMS di Environment Variable Cloudflare Pages
  const apiKey = env.FIRMS_MAP_KEY;
  if (!apiKey || apiKey.trim() === "") {
    return new Response(
      JSON.stringify({
        status: "disabled",
        error: "FIRMS_MAP_KEY_EMPTY",
        message: "Kunci API NASA FIRMS belum dikonfigurasi di Cloudflare Pages (Environment Variable: FIRMS_MAP_KEY).",
        features: []
      }),
      { status: 200, headers: corsHeaders }
    );
  }

  // 2. Parse Parameter Query dari Klien
  const url = new URL(request.url);
  // Sumber sensor standar: VIIRS_NOAA20_NRT (opsional: VIIRS_NOAA21_NRT atau MODIS_NRT)
  const source = url.searchParams.get("source") || "VIIRS_NOAA20_NRT";
  const days = Math.min(Math.max(parseInt(url.searchParams.get("days") || "1", 10), 1), 3);

  // Batasi Bounding Box default ke area Jawa Timur (minLon, minLat, maxLon, maxLat)
  // Menjaga agar ukuran paket hemat dan fokus pada wilayah operasional EWS TITEN
  const bbox = url.searchParams.get("bbox") || "110.8,-8.8,114.6,-6.5";

  // URL resmi endpoint NASA FIRMS area CSV
  const firmsApiUrl = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${apiKey}/${source}/${bbox}/${days}`;

  // 3. Edge Cache: Cek cache Cloudflare (TTL 10 Menit = 600 Detik)
  const cacheKey = new Request(firmsApiUrl, request);
  const cache = caches.default;
  let response = await cache.match(cacheKey);

  if (response) {
    return response;
  }

  // 4. Fetch ke Server Upstream NASA FIRMS
  try {
    const upstreamRes = await fetch(firmsApiUrl, {
      headers: {
        "User-Agent": "EWS-TITEN-TRILOGY-Monitor/3.1 (MAGE12 Competition)"
      }
    });

    if (!upstreamRes.ok) {
      return new Response(
        JSON.stringify({
          status: "upstream_error",
          statusCode: upstreamRes.status,
          message: "Layanan NASA FIRMS sementara tidak merespons.",
          features: []
        }),
        { status: 200, headers: corsHeaders }
      );
    }

    const csvText = await upstreamRes.text();

    // 5. Parse Data CSV NASA Menjadi Objek JSON
    const lines = csvText.trim().split("\n");
    const features = [];

    if (lines.length > 1) {
      const headers = lines[0].split(",").map(h => h.trim());
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = line.split(",");
        if (cols.length >= 4) {
          const row = {};
          headers.forEach((h, idx) => {
            row[h] = cols[idx] ? cols[idx].trim() : "";
          });

          const lat = parseFloat(row.latitude);
          const lng = parseFloat(row.longitude);
          if (!isNaN(lat) && !isNaN(lng)) {
            features.push({
              lat,
              lng,
              bright_ti4: parseFloat(row.bright_ti4 || row.brightness || 0),
              confidence: row.confidence || "nominal",
              acq_date: row.acq_date || "",
              acq_time: row.acq_time || "",
              frp: parseFloat(row.frp || 0) // Fire Radiative Power (MW)
            });
          }
        }
      }
    }

    const jsonResult = JSON.stringify({
      status: "success",
      source: source,
      bbox: bbox,
      count: features.length,
      features: features,
      fetched_at: new Date().toISOString()
    });

    // Simpan di Edge Cache selama 10 Menit (600 Detik)
    response = new Response(jsonResult, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Cache-Control": "public, max-age=600, s-maxage=600"
      }
    });

    context.waitUntil(cache.put(cacheKey, response.clone()));
    return response;

  } catch (err) {
    return new Response(
      JSON.stringify({
        status: "exception",
        message: "Gagal menghubungkan ke satelit FIRMS: " + err.message,
        features: []
      }),
      { status: 200, headers: corsHeaders }
    );
  }
}


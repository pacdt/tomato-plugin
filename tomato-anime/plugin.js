// ═══════════════════════════════════════════════════════════════
// OtakuTV Anime — SkyStream Plugin
// Wraps the OtakuTV Proxy API for the SkyStream app.
// ═══════════════════════════════════════════════════════════════
(function () {

  const BASE = manifest.baseUrl;

  // ─── Helpers ──────────────────────────────────────────────────

  /**
   * GET request via SkyStream's http_get global.
   * Returns the parsed JSON body.
   */
  async function apiGet(path) {
    const res = await http_get(`${BASE}${path}`, {});

    const status = res.status || res.statusCode || 0;
    const body =
      typeof res.body === "string" ? res.body : JSON.stringify(res.body);

    if (status === 503) {
      let err = {};
      try { err = JSON.parse(body); } catch (_) {}
      throw new Error(
        `Proxy indisponível (${err.state || "unknown"}): ${err.message || "service unavailable"}`
      );
    }

    if (status < 200 || status >= 300) {
      throw new Error(`HTTP ${status} — ${path}`);
    }

    try {
      return JSON.parse(body);
    } catch (_) {
      return body;
    }
  }

  function toItem(anime) {
    // Collect the necessary IDs to construct the load URL.
    const ids = [anime.temp_id, anime.latest_temp_tid, anime.cat_id, anime.cid, anime.id, anime.latest_video_id, anime.anime_id].map(x => x || "").join("|");
    
    return new MultimediaItem({
      title: anime.category_name || anime.video_title || anime.title || anime.name || anime.anime_name || "Sem título",
      url: ids,
      posterUrl: anime.video_thumbnail_b || anime.category_image || anime.cover_url || anime.poster_url || anime.image || anime.thumbnail || anime.anime_cover_url || "",
      type: "anime",
      year: anime.ano_temp || anime.ano || anime.year || anime.date || anime.anime_date || undefined,
      score: anime.score || anime.rating || undefined,
      status: anime.status_temp === "Concluído" || anime.status_lanc === "Concluído" ? "completed" : (anime.status || undefined),
      description: anime.video_description || anime.sinopse || anime.synopsis || anime.description || anime.anime_description || undefined,
    });
  }

  // ─── 1. getHome — Dashboard feed ─────────────────────────────

  async function getHome(cb) {
    try {
      const [latestRes, popularRes] = await Promise.all([
        apiGet("/latest-videos").catch(() => ({})),
        apiGet("/most-viewed").catch(() => ({}))
      ]);

      const data = {};

      const latest = latestRes.OTAKU_V2_01 || latestRes.data || latestRes;
      if (Array.isArray(latest) && latest.length > 0) {
        data["Últimos Lançamentos"] = latest.map(toItem);
      }

      const popular = popularRes.OTAKU_V2_01 || popularRes.data || popularRes;
      if (Array.isArray(popular) && popular.length > 0) {
        data["Mais Visualizados"] = popular.map(toItem);
      }

      cb({ success: true, data });
    } catch (e) {
      console.error("[OtakuTV] getHome error:", e);
      cb({ success: false, errorCode: "HOME_ERROR", message: e.message || String(e) });
    }
  }

  // ─── 2. search — User query ──────────────────────────────────

  async function search(query, cb) {
    try {
      const resultsRes = await apiGet(`/search?keyword=${encodeURIComponent(query)}`);
      
      const results = resultsRes.OTAKU_V2_01 || resultsRes.data || resultsRes.result || resultsRes || [];
      const items = Array.isArray(results) ? results : [];

      cb({ success: true, data: items.map(toItem) });
    } catch (e) {
      console.error("[OtakuTV] search error:", e);
      cb({ success: false, errorCode: "SEARCH_ERROR", message: e.message || String(e) });
    }
  }

  // ─── 3. load — Full anime details + episode list ─────────────

  async function load(url, cb) {
    try {
      // url is expected to contain "temp_id|latest_temp_tid|cat_id|cid|id|latest_video_id|anime_id"
      const parts = url.split("|");
      let temp_id = parts[0] || parts[1];
      let cat_id = parts[2] || parts[3];
      const fallback_id = parts[4] || parts[5] || parts[6] || temp_id || cat_id;
      
      if (!temp_id) temp_id = fallback_id;
      if (!cat_id) cat_id = fallback_id;
      let current_id = cat_id;

      // Without a specific "details" endpoint, we return a generic item wrapper
      // and append the episodes list to it.
      const item = new MultimediaItem({
        title: "Lista de Episódios",
        url: url,
        type: "anime"
      });

      const episodes = [];

      try {
        const epData = await apiGet(`/video-temp?temp_id=${temp_id}&current_id=${current_id}&cat_id=${cat_id}`);
        const epList = epData.OTAKU_V2_01 || epData.data || epData.episodes || epData || [];
        const arrayList = Array.isArray(epList) ? epList : [];

        for (const ep of arrayList) {
          episodes.push(
            new Episode({
              name: ep.video_title || ep.video_ep || ep.title || ep.ep_name || ep.name || `Episódio ${ep.number || ep.episode || ep.ep_number || "?"}`,
              url: `${ep.rel_vid || ep.id || ep.ep_id || ep.video_id}`,
              season: 1,
              episode: ep.number || ep.episode || ep.ep_number || 0,
              dubStatus: (ep.video_ep && ep.video_ep.includes("DUB")) ? "dubbed" : "subbed",
            })
          );
        }
      } catch (epErr) {
        console.warn(`[OtakuTV] Failed to fetch episodes:`, epErr);
      }

      item.episodes = episodes;

      cb({ success: true, data: item });
    } catch (e) {
      console.error("[OtakuTV] load error:", e);
      cb({ success: false, errorCode: "LOAD_ERROR", message: e.message || String(e) });
    }
  }

  // ─── 4. loadStreams — HLS links for an episode ───────────────

  async function loadStreams(url, cb) {
    try {
      const episodeId = url.replace(/\D/g, "");
      const streamRes = await apiGet(`/single-video/${episodeId}`);
      
      // Sometimes it is nested in OTAKU_V2_01, sometimes directly returned
      let streams = streamRes.OTAKU_V2_01 || streamRes.data || streamRes;
      if (Array.isArray(streams) && streams.length > 0) {
        streams = streams[0];
      }

      const results = [];

      if (streams) {
        if (streams.video_url_fhd) {
          results.push(new StreamResult({ url: streams.video_url_fhd, source: "FHD 1080p" }));
        }
        if (streams.video_url) {
          results.push(new StreamResult({ url: streams.video_url, source: "HD 720p / Original" }));
        }
        if (streams.video_url_mhd) {
          results.push(new StreamResult({ url: streams.video_url_mhd, source: "HD 720p" }));
        }
        if (streams.video_url_shd) {
          results.push(new StreamResult({ url: streams.video_url_shd, source: "SD 480p" }));
        }
      }

      // Fallback: iterate any other keys that might contain stream URLs
      if (results.length === 0 && typeof streams === 'object') {
        for (const [key, value] of Object.entries(streams)) {
          if (
            typeof value === "string" &&
            value.startsWith("http") &&
            !["video_url_fhd", "video_url_mhd", "video_url_shd", "video_url"].includes(key)
          ) {
            results.push(new StreamResult({ url: value, source: key }));
          }
        }
      }

      cb({ success: true, data: results });
    } catch (e) {
      console.error("[OtakuTV] loadStreams error:", e);
      cb({ success: false, errorCode: "STREAM_ERROR", message: e.message || String(e) });
    }
  }

  // ─── Export to SkyStream runtime ─────────────────────────────

  globalThis.getHome = getHome;
  globalThis.search = search;
  globalThis.load = load;
  globalThis.loadStreams = loadStreams;
})();

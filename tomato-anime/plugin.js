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

  function cleanImageUrl(url) {
    if (!url || typeof url !== "string") return "";
    const idx = url.lastIndexOf("http");
    if (idx > 0) {
      return url.substring(idx);
    }
    return url;
  }

  function toItem(anime) {
    // Collect the necessary IDs to construct the load URL.
    const ids = [anime.temp_id, anime.latest_temp_tid, anime.cat_id, anime.cid, anime.id, anime.latest_video_id, anime.anime_id].map(x => x || "").join("|");
    
    // Convert year and score to numbers to satisfy SkyStream Dart typing
    const rawYear = anime.ano_temp || anime.ano || anime.year || anime.date || anime.anime_date;
    const numYear = parseInt(rawYear);
    
    const rawScore = anime.score || anime.rating;
    const numScore = parseFloat(rawScore);

    return new MultimediaItem({
      title: anime.category_name || anime.video_title || anime.title || anime.name || anime.anime_name || "Sem título",
      url: ids,
      posterUrl: cleanImageUrl(anime.video_thumbnail_b || anime.category_image || anime.cover_url || anime.poster_url || anime.image || anime.thumbnail || anime.anime_cover_url || ""),
      type: "anime",
      year: isNaN(numYear) ? undefined : numYear,
      score: isNaN(numScore) ? undefined : numScore,
      status: anime.status_temp === "Concluído" || anime.status_lanc === "Concluído" ? "completed" : (anime.status || undefined),
      description: anime.video_description || anime.sinopse || anime.synopsis || anime.description || anime.anime_description || undefined,
    });
  }

  // ─── 1. getHome — Dashboard feed ─────────────────────────────

  const GENEROS = [
    "Ação", "Aventura", "Comédia", "Drama", "Ecchi", "Esportes",
    "Fantasia", "Mecha", "Mistério", "Música", "Romance", "Sci-Fi",
    "Shoujo", "Shounen", "Slice of Life", "Sobrenatural"
  ];

  async function getHome(cb) {
    try {
      const data = {};

      // 1. Fetch main strips, calendar, and random anime in parallel
      const [stripsRes, calRes, randRes] = await Promise.all([
        apiGet("/home-strips").catch(() => ({})),
        apiGet("/calendar-releases").catch(() => ({})),
        apiGet("/random-anime").catch(() => ({}))
      ]);

      // Process Home Strips
      const baseStrips = stripsRes.OTAKU_V2_01 || stripsRes.PLAY_V2_02 || stripsRes.data || stripsRes;
      const strips = baseStrips.strips || [];
      for (const strip of strips) {
        if (!strip.items || !Array.isArray(strip.items) || strip.items.length === 0) continue;

        let cat = strip.id || strip.title || "Outros";
        if (cat === "slider_hero" || strip.type === "slider") {
          cat = "Trending";
        } else if (cat === "latest_animes") {
          cat = "Últimos Lançamentos";
        } else {
          cat = cat.charAt(0).toUpperCase() + cat.slice(1).replace(/_/g, " ");
        }

        data[cat] = strip.items.map(toItem);
      }

      // Process Random Anime
      const randItems = randRes.OTAKU_V2_01 || randRes.data || randRes;
      if (Array.isArray(randItems) && randItems.length > 0) {
        data["Recomendação Aleatória"] = randItems.map(toItem);
      }

      // Process Calendar Releases
      const calItems = calRes.OTAKU_V2_01 || calRes.data || calRes;
      if (Array.isArray(calItems) && calItems.length > 0) {
        data["Calendário de Lançamentos"] = calItems.map(toItem);
      }

      // 2. Fetch all genres to append as individual strips
      const genrePromises = GENEROS.map(g =>
        apiGet(`/home-strips?type=anime&generos=${encodeURIComponent(g)}`)
          .then(res => ({ genre: g, res }))
          .catch(() => ({ genre: g, res: {} }))
      );

      const genreResults = await Promise.all(genrePromises);

      for (const { genre, res } of genreResults) {
        const d = res.OTAKU_V2_01 || res.PLAY_V2_02 || res.data || res;
        const gStrips = d.strips || [];
        
        let items = [];
        for (const s of gStrips) {
          if (s.items && Array.isArray(s.items)) {
            items = items.concat(s.items);
          }
        }

        // Deduplicate items
        const uniqueItems = [];
        const seen = new Set();
        for (const item of items) {
          const id = item.cid || item.id || item.video_title;
          if (!seen.has(id)) {
            seen.add(id);
            uniqueItems.push(item);
          }
        }

        if (uniqueItems.length > 0) {
          data[`Gênero: ${genre}`] = uniqueItems.map(toItem);
        }
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
      let latest_video_id = parts[5];
      
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
        let seasonsToFetch = [];
        let seasonMeta = {}; // maps temp_id to { seasonNum, dubStatus }

        if (latest_video_id) {
          try {
            const singleRes = await apiGet(`/single-video/${latest_video_id}`);
            const data = singleRes.OTAKU_V2_01 || singleRes.data || singleRes || [];
            if (Array.isArray(data) && data.length > 0 && data[0].temp && Array.isArray(data[0].temp)) {
              for (const t of data[0].temp) {
                seasonsToFetch.push(t.temp_id);
                
                // Parse season and dubStatus from temp_name
                // e.g., "Temporada 04 | Dublado"
                let sNum = 1;
                let dStat = "subbed";
                if (t.temp_name) {
                  const sMatch = t.temp_name.match(/Temporada\s*(\d+)/i);
                  if (sMatch) sNum = parseInt(sMatch[1], 10);
                  
                  if (t.temp_name.toLowerCase().includes("dublado")) dStat = "dubbed";
                  else if (t.temp_name.toLowerCase().includes("legendado")) dStat = "subbed";
                }
                
                seasonMeta[t.temp_id] = { season: sNum, dubStatus: dStat };
              }
            }
          } catch (e) {
            console.warn("[OtakuTV] Failed to fetch single-video for seasons fallback", e);
          }
        }

        // If single-video failed or returned no seasons, fallback to the current temp_id
        if (seasonsToFetch.length === 0 && temp_id) {
          seasonsToFetch = [temp_id];
          seasonMeta[temp_id] = { season: 1, dubStatus: "subbed" };
        }

        // Fetch all seasons in parallel
        const seasonPromises = seasonsToFetch.map(tid => 
          apiGet(`/video-temp?temp_id=${tid}&current_id=${current_id}&cat_id=${cat_id}`)
            .then(res => ({ tid, data: res }))
            .catch(() => ({ tid, data: [] }))
        );

        const seasonResults = await Promise.all(seasonPromises);

        let gotItemDetails = false;

        for (const { tid, data } of seasonResults) {
          const epList = data.OTAKU_V2_01 || data.data || data.episodes || data || [];
          const arrayList = Array.isArray(epList) ? epList : [];

          if (arrayList.length > 0 && !gotItemDetails) {
            const sampleEp = arrayList[0];
            item.title = sampleEp.category_name || "Lista de Episódios";
            item.posterUrl = cleanImageUrl(sampleEp.video_thumbnail_b || sampleEp.category_image || "");
            gotItemDetails = true;
          }

          const meta = seasonMeta[tid] || { season: 1, dubStatus: "subbed" };

          // Reverse the array so episodes are listed in ascending order per season
          arrayList.reverse();

          for (const ep of arrayList) {
            const rawEp = ep.number || ep.episode || ep.ep_number || 0;
            let numEp = parseInt(rawEp);

            if (isNaN(numEp) || numEp === 0) {
               const epMatch = (ep.video_ep || ep.video_title || "").match(/EP\.?\s*(\d+)/i);
               if (epMatch) numEp = parseInt(epMatch[1], 10);
            }

            let finalDubStatus = meta.dubStatus;
            if (ep.video_ep && ep.video_ep.includes("DUB")) finalDubStatus = "dubbed";
            else if (ep.video_ep && ep.video_ep.includes("LEG")) finalDubStatus = "subbed";

            episodes.push(
              new Episode({
                name: ep.video_title || ep.video_ep || ep.title || ep.ep_name || ep.name || `Episódio ${numEp || "?"}`,
                url: `${ep.rel_vid || ep.id || ep.ep_id || ep.video_id}`,
                season: meta.season,
                episode: isNaN(numEp) ? 0 : numEp,
                description: ep.video_description || undefined,
                dubStatus: finalDubStatus,
                thumbnail: cleanImageUrl(ep.video_thumbnail_b || ep.category_image || ep.image || ep.thumbnail || ""),
                posterUrl: cleanImageUrl(ep.video_thumbnail_b || ep.category_image || ep.image || ep.thumbnail || ""),
              })
            );
          }
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

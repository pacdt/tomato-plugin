// ═══════════════════════════════════════════════════════════════
// Tomato Anime — SkyStream Plugin
// Wraps the Tomato Anime Proxy API for the SkyStream app.
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

  /**
   * POST request via SkyStream's http_post global (used for search).
   */
  async function apiPost(path) {
    const res = await http_post(`${BASE}${path}`, {}, "", null);

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

  /**
   * Build a MultimediaItem from the various shapes returned by the
   * Tomato proxy (feed sections, search results, anime details).
   */
  function toItem(anime) {
    return new MultimediaItem({
      title: anime.title || anime.name || anime.anime_name || "Sem título",
      url: `${anime.id || anime.anime_id}`,
      posterUrl: anime.cover_url || anime.poster_url || anime.image || anime.thumbnail || anime.anime_cover_url || "",
      type: "anime",
      year: anime.year || anime.date || anime.anime_date || undefined,
      score: anime.score || anime.rating || undefined,
      status: anime.status || undefined,
      description: anime.synopsis || anime.description || anime.anime_description || undefined,
    });
  }

  // ─── 1. getHome — Dashboard feed ─────────────────────────────

  async function getHome(cb) {
    try {
      const feed = await apiGet("/proxy/feed");

      const data = {};

      const feedData = feed.data || feed.sections || feed;

      if (Array.isArray(feedData)) {
        let isFirst = true;
        for (const section of feedData) {
          if (!section.title || !section.data || !Array.isArray(section.data) || section.data.length === 0) continue;
          const categoryName = isFirst ? "Trending" : section.title;
          data[categoryName] = section.data.map(toItem);
          isFirst = false;
        }
      } else {
        // Fallback for older formats
        const keys = Object.keys(feedData).filter(
          (k) => Array.isArray(feedData[k]) && feedData[k].length > 0
        );

        if (keys.length > 0) {
          let isFirst = true;
          for (const key of keys) {
            const categoryName = isFirst ? "Trending" : key;
            data[categoryName] = feedData[key].map(toItem);
            isFirst = false;
          }
        }
      }

      cb({ success: true, data });
    } catch (e) {
      console.error("[Tomato] getHome error:", e);
      cb({ success: false, errorCode: "HOME_ERROR", message: e.message || String(e) });
    }
  }

  // ─── 2. search — User query ──────────────────────────────────

  async function search(query, cb) {
    try {
      // The proxy search is POST /proxy/search?q=...
      const results = await apiPost(
        `/proxy/search?q=${encodeURIComponent(query)}`
      );

      // Normalise — response may be { data: [...] } or just [...]
      const items = Array.isArray(results)
        ? results
        : Array.isArray(results.data)
          ? results.data
          : results.result
            ? results.result
            : [];

      cb({ success: true, data: items.map(toItem) });
    } catch (e) {
      console.error("[Tomato] search error:", e);
      cb({ success: false, errorCode: "SEARCH_ERROR", message: e.message || String(e) });
    }
  }

  // ─── 3. load — Full anime details + episode list ─────────────

  async function load(url, cb) {
    try {
      const animeId = url.replace(/\D/g, "");
      const animeRaw = await apiGet(`/proxy/anime/${animeId}`);
      const anime = animeRaw.anime_details || animeRaw;

      // Build the base MultimediaItem with rich metadata
      const item = new MultimediaItem({
        title: anime.title || anime.name || anime.anime_name || "Sem título",
        url: `${animeId}`,
        posterUrl: anime.cover_url || anime.poster_url || anime.image || anime.anime_cover_url || anime.anime_cape_url || "",
        bannerUrl: anime.banner_url || anime.banner || anime.anime_banner_url || undefined,
        type: "anime",
        year: anime.year || anime.anime_date || undefined,
        score: anime.score || anime.rating || undefined,
        status: anime.status || undefined,
        description: anime.synopsis || anime.description || anime.anime_description || "",
        duration: anime.duration || undefined,
        contentRating: anime.content_rating || anime.anime_parental_rating || undefined,
      });

      // Collect seasons from the response
      const seasons =
        animeRaw.anime_seasons || anime.seasons || anime.temporadas || (anime.season_id ? [anime] : []);

      // Fetch episodes for all seasons
      const episodes = [];

      for (const season of seasons) {
        const seasonId = season.id || season.season_id;
        const seasonNumber = season.number || season.season_number || seasons.indexOf(season) + 1;

        if (!seasonId) continue;

        try {
          const epData = await apiGet(
            `/proxy/anime/${animeId}/episodes/${seasonId}`
          );

          const epList = epData.data || epData.episodes || (Array.isArray(epData) ? epData : []);

          for (const ep of epList) {
            episodes.push(
              new Episode({
                name: ep.title || ep.ep_name || `Episódio ${ep.number || ep.episode || ep.ep_number || "?"}`,
                url: `${ep.id || ep.ep_id}`,
                season: seasonNumber,
                episode: ep.number || ep.episode || ep.ep_number || 0,
                dubStatus: season.season_dubbed === 1 ? "dubbed" : (ep.dub_status || ep.dubStatus || "subbed"),
              })
            );
          }
        } catch (epErr) {
          console.warn(`[Tomato] Failed to fetch season ${seasonId}:`, epErr);
        }
      }

      item.episodes = episodes;

      cb({ success: true, data: item });
    } catch (e) {
      console.error("[Tomato] load error:", e);
      cb({ success: false, errorCode: "LOAD_ERROR", message: e.message || String(e) });
    }
  }

  // ─── 4. loadStreams — HLS links for an episode ───────────────

  async function loadStreams(url, cb) {
    try {
      const episodeId = url.replace(/\D/g, "");
      const streamsRes = await apiGet(`/proxy/episode/${episodeId}/streams`);
      const streams = streamsRes.streams || streamsRes;

      // The proxy returns { shd, mhd, fhd } with .m3u8 URLs
      const results = [];

      if (streams.fhd) {
        results.push(
          new StreamResult({ url: streams.fhd, source: "FHD 1080p" })
        );
      }
      if (streams.mhd) {
        results.push(
          new StreamResult({ url: streams.mhd, source: "HD 720p" })
        );
      }
      if (streams.shd) {
        results.push(
          new StreamResult({ url: streams.shd, source: "SD 480p" })
        );
      }

      // Fallback: iterate any other keys that might contain stream URLs
      for (const [key, value] of Object.entries(streams)) {
        if (
          typeof value === "string" &&
          value.startsWith("http") &&
          !["fhd", "mhd", "shd"].includes(key)
        ) {
          results.push(new StreamResult({ url: value, source: key }));
        }
      }

      cb({ success: true, data: results });
    } catch (e) {
      console.error("[Tomato] loadStreams error:", e);
      cb({ success: false, errorCode: "STREAM_ERROR", message: e.message || String(e) });
    }
  }

  // ─── Export to SkyStream runtime ─────────────────────────────

  globalThis.getHome = getHome;
  globalThis.search = search;
  globalThis.load = load;
  globalThis.loadStreams = loadStreams;
})();

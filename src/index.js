const MAX_BODY_BYTES = 48 * 1024;
const DEFAULT_RETENTION_DAYS = 180;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    try {
      if (url.pathname === "/api/health" && request.method === "GET") {
        return json({ ok: true, service: "visitor-analytics-d1-fresh" }, 200, request, env);
      }

      if (url.pathname === "/api/collect/pageview" && request.method === "POST") {
        return collectPageView(request, env);
      }
      if (url.pathname === "/api/collect/engagement" && request.method === "POST") {
        return collectEngagement(request, env);
      }
      if (url.pathname === "/api/collect/event" && request.method === "POST") {
        return collectEvent(request, env);
      }
      if (url.pathname === "/api/collect/performance" && request.method === "POST") {
        return collectPerformance(request, env);
      }
      if (url.pathname === "/api/collect/error" && request.method === "POST") {
        return collectError(request, env);
      }
      if (url.pathname === "/api/collect/heartbeat" && request.method === "POST") {
        return collectHeartbeat(request, env);
      }
      if (url.pathname === "/api/collect/identify" && request.method === "POST") {
        return identifyVisitor(request, env);
      }
      if (url.pathname === "/api/collect/location" && request.method === "POST") {
        return collectPreciseLocation(request, env);
      }

      if (url.pathname === "/api/admin/overview" && request.method === "GET") {
        requireAdmin(request, env);
        return adminOverview(request, env);
      }
      if (url.pathname === "/api/admin/live" && request.method === "GET") {
        requireAdmin(request, env);
        return adminLive(request, env);
      }
      if (url.pathname === "/api/admin/sessions" && request.method === "GET") {
        requireAdmin(request, env);
        return adminSessions(request, env);
      }
      if (url.pathname === "/api/admin/events" && request.method === "GET") {
        requireAdmin(request, env);
        return adminEvents(request, env);
      }
      if (url.pathname === "/api/admin/errors" && request.method === "GET") {
        requireAdmin(request, env);
        return adminErrors(request, env);
      }
      if (url.pathname === "/api/admin/funnel" && request.method === "GET") {
        requireAdmin(request, env);
        return adminFunnel(request, env);
      }
      if (url.pathname === "/api/admin/purge" && request.method === "POST") {
        requireAdmin(request, env);
        return purgeOldData(request, env);
      }

      if (url.pathname.startsWith("/api/")) {
        return json({ error: "Not found" }, 404, request, env);
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500;
      if (status >= 500) console.error(error);
      return json(
        { error: status >= 500 ? "Internal server error" : error.message },
        status,
        request,
        env
      );
    }
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runRetention(env));
  }
};

async function collectPageView(request, env) {
  assertOriginAllowed(request, env);
  const body = await readJson(request);

  const ids = requiredIds(body, ["visitorId", "sessionId", "pageViewId"]);
  const path = cleanPath(body.path);
  const now = cleanDate(body.occurredAt) || new Date().toISOString();
  const campaign = cleanCampaign(body);
  const device = cleanDevice(body);
  const network = networkFromRequest(request);
  const ipHash = await hashIp(request, env);

  const visitorInsert = await env.DB.prepare(`
    INSERT OR IGNORE INTO visitors (
      visitor_id, first_seen_at, last_seen_at,
      first_source, first_medium, first_campaign, first_referrer
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    ids.visitorId,
    now,
    now,
    campaign.source,
    campaign.medium,
    campaign.campaign,
    cleanString(body.referrer, 1000)
  ).run();

  const sessionInsert = await env.DB.prepare(`
    INSERT OR IGNORE INTO sessions (
      session_id, visitor_id, started_at, last_seen_at,
      landing_path, exit_path, referrer,
      source, medium, campaign, term, content,
      device_type, browser_name, browser_version,
      os_name, os_version, language, browser_timezone,
      screen_width, screen_height, viewport_width, viewport_height,
      pixel_ratio, touch_enabled, color_scheme,
      country, region, region_code, city, postal_code, continent,
      colo, asn, as_organization, http_protocol, tls_version, ip_hash
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `).bind(
    ids.sessionId,
    ids.visitorId,
    now,
    now,
    path,
    path,
    cleanString(body.referrer, 1000),
    campaign.source,
    campaign.medium,
    campaign.campaign,
    campaign.term,
    campaign.content,
    device.deviceType,
    device.browserName,
    device.browserVersion,
    device.osName,
    device.osVersion,
    cleanString(body.language, 50),
    cleanString(body.timezone, 100),
    cleanInteger(body.screenWidth, 0, 30000),
    cleanInteger(body.screenHeight, 0, 30000),
    cleanInteger(body.viewportWidth, 0, 30000),
    cleanInteger(body.viewportHeight, 0, 30000),
    cleanNumber(body.pixelRatio, 0, 20),
    body.touchEnabled === true ? 1 : 0,
    cleanString(body.colorScheme, 20),
    network.country,
    network.region,
    network.regionCode,
    network.city,
    network.postalCode,
    network.continent,
    network.colo,
    network.asn,
    network.asOrganization,
    network.httpProtocol,
    network.tlsVersion,
    ipHash
  ).run();

  const pageInsert = await env.DB.prepare(`
    INSERT OR IGNORE INTO page_views (
      page_view_id, session_id, visitor_id, started_at, path, title, referrer
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    ids.pageViewId,
    ids.sessionId,
    ids.visitorId,
    now,
    path,
    cleanString(body.title, 500),
    cleanString(body.referrer, 1000)
  ).run();

  const statements = [
    env.DB.prepare(`
      UPDATE visitors
      SET last_seen_at = ?
      WHERE visitor_id = ?
    `).bind(now, ids.visitorId),
    env.DB.prepare(`
      UPDATE sessions
      SET last_seen_at = ?, exit_path = ?,
          viewport_width = COALESCE(?, viewport_width),
          viewport_height = COALESCE(?, viewport_height)
      WHERE session_id = ?
    `).bind(
      now,
      path,
      cleanInteger(body.viewportWidth, 0, 30000),
      cleanInteger(body.viewportHeight, 0, 30000),
      ids.sessionId
    ),
    env.DB.prepare(`
      INSERT INTO live_presence (
        session_id, visitor_id, page_view_id, path, last_seen_at,
        is_active, country, city, device_type
      ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        page_view_id = excluded.page_view_id,
        path = excluded.path,
        last_seen_at = excluded.last_seen_at,
        is_active = 1
    `).bind(
      ids.sessionId,
      ids.visitorId,
      ids.pageViewId,
      path,
      now,
      network.country,
      network.city,
      device.deviceType
    )
  ];

  if (Number(sessionInsert.meta?.changes || 0) > 0) {
    statements.push(
      env.DB.prepare(`
        UPDATE visitors
        SET total_sessions = total_sessions + 1
        WHERE visitor_id = ?
      `).bind(ids.visitorId)
    );
  }

  if (Number(pageInsert.meta?.changes || 0) > 0) {
    statements.push(
      env.DB.prepare(`
        UPDATE visitors
        SET total_page_views = total_page_views + 1
        WHERE visitor_id = ?
      `).bind(ids.visitorId)
    );
  }

  await env.DB.batch(statements);

  return json(
    {
      ok: true,
      newVisitor: Number(visitorInsert.meta?.changes || 0) > 0,
      newSession: Number(sessionInsert.meta?.changes || 0) > 0,
      newPageView: Number(pageInsert.meta?.changes || 0) > 0
    },
    202,
    request,
    env
  );
}

async function collectEngagement(request, env) {
  assertOriginAllowed(request, env);
  const body = await readJson(request);
  const ids = requiredIds(body, ["visitorId", "sessionId", "pageViewId"]);
  const occurredAt = cleanDate(body.occurredAt) || new Date().toISOString();

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE page_views
      SET ended_at = ?,
          duration_ms = MAX(duration_ms, ?),
          active_ms = MAX(active_ms, ?),
          max_scroll_pct = MAX(max_scroll_pct, ?)
      WHERE page_view_id = ? AND session_id = ? AND visitor_id = ?
    `).bind(
      occurredAt,
      cleanInteger(body.durationMs, 0, 86400000) || 0,
      cleanInteger(body.activeMs, 0, 86400000) || 0,
      cleanInteger(body.maxScrollPct, 0, 100) || 0,
      ids.pageViewId,
      ids.sessionId,
      ids.visitorId
    ),
    env.DB.prepare(`
      UPDATE sessions
      SET last_seen_at = ?, ended_at = CASE WHEN ? = 1 THEN ? ELSE ended_at END,
          exit_path = COALESCE(?, exit_path)
      WHERE session_id = ? AND visitor_id = ?
    `).bind(
      occurredAt,
      body.sessionEnded === true ? 1 : 0,
      occurredAt,
      cleanPath(body.path),
      ids.sessionId,
      ids.visitorId
    ),
    env.DB.prepare(`
      UPDATE live_presence
      SET last_seen_at = ?, is_active = ?
      WHERE session_id = ?
    `).bind(occurredAt, body.sessionEnded === true ? 0 : 1, ids.sessionId)
  ]);

  return json({ ok: true }, 202, request, env);
}

async function collectEvent(request, env) {
  assertOriginAllowed(request, env);
  const body = await readJson(request);
  const ids = requiredIds(body, ["visitorId", "sessionId", "eventId"]);
  const metadata = sanitizeMetadata(body.metadata);

  await env.DB.prepare(`
    INSERT OR IGNORE INTO events (
      event_id, session_id, visitor_id, page_view_id,
      occurred_at, name, category, path, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    ids.eventId,
    ids.sessionId,
    ids.visitorId,
    cleanId(body.pageViewId),
    cleanDate(body.occurredAt) || new Date().toISOString(),
    requireString(body.name, "name", 100),
    cleanString(body.category, 100),
    cleanPath(body.path),
    metadata ? JSON.stringify(metadata) : null
  ).run();

  return json({ ok: true }, 202, request, env);
}

async function collectPerformance(request, env) {
  assertOriginAllowed(request, env);
  const body = await readJson(request);
  const ids = requiredIds(body, ["visitorId", "sessionId"]);
  const metrics = Array.isArray(body.metrics) ? body.metrics.slice(0, 25) : [];

  if (!metrics.length) throw httpError(400, "metrics must be a non-empty array");

  const statements = metrics
    .map((metric) => {
      const value = Number(metric.value);
      if (!Number.isFinite(value)) return null;

      return env.DB.prepare(`
        INSERT OR IGNORE INTO performance_metrics (
          metric_id, session_id, visitor_id, page_view_id,
          occurred_at, path, metric_name, metric_value, rating
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        cleanId(metric.id) || crypto.randomUUID(),
        ids.sessionId,
        ids.visitorId,
        cleanId(body.pageViewId),
        cleanDate(metric.occurredAt) || new Date().toISOString(),
        cleanPath(body.path),
        requireString(metric.name, "metric.name", 60),
        Math.max(0, Math.min(value, 1e9)),
        cleanString(metric.rating, 30)
      );
    })
    .filter(Boolean);

  if (statements.length) await env.DB.batch(statements);
  return json({ ok: true, accepted: statements.length }, 202, request, env);
}

async function collectError(request, env) {
  assertOriginAllowed(request, env);
  const body = await readJson(request);
  const ids = requiredIds(body, ["visitorId", "sessionId", "errorId"]);

  await env.DB.prepare(`
    INSERT OR IGNORE INTO errors (
      error_id, session_id, visitor_id, page_view_id,
      occurred_at, type, message, filename,
      line_number, column_number, stack, path
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    ids.errorId,
    ids.sessionId,
    ids.visitorId,
    cleanId(body.pageViewId),
    cleanDate(body.occurredAt) || new Date().toISOString(),
    cleanString(body.type, 50) || "javascript",
    requireString(body.message, "message", 1000),
    cleanString(body.filename, 1000),
    cleanInteger(body.lineNumber, 0, 10000000),
    cleanInteger(body.columnNumber, 0, 10000000),
    cleanString(body.stack, 5000),
    cleanPath(body.path)
  ).run();

  return json({ ok: true }, 202, request, env);
}

async function collectHeartbeat(request, env) {
  assertOriginAllowed(request, env);
  const body = await readJson(request);
  const ids = requiredIds(body, ["visitorId", "sessionId"]);
  const now = cleanDate(body.occurredAt) || new Date().toISOString();
  const network = networkFromRequest(request);

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE sessions
      SET last_seen_at = ?, exit_path = COALESCE(?, exit_path)
      WHERE session_id = ? AND visitor_id = ?
    `).bind(now, cleanPath(body.path), ids.sessionId, ids.visitorId),
    env.DB.prepare(`
      INSERT INTO live_presence (
        session_id, visitor_id, page_view_id, path,
        last_seen_at, is_active, country, city, device_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        page_view_id = excluded.page_view_id,
        path = excluded.path,
        last_seen_at = excluded.last_seen_at,
        is_active = excluded.is_active
    `).bind(
      ids.sessionId,
      ids.visitorId,
      cleanId(body.pageViewId),
      cleanPath(body.path),
      now,
      body.active === false ? 0 : 1,
      network.country,
      network.city,
      cleanString(body.deviceType, 30)
    )
  ]);

  return json({ ok: true }, 202, request, env);
}

async function identifyVisitor(request, env) {
  assertOriginAllowed(request, env);
  const body = await readJson(request);
  const visitorId = requireString(body.visitorId, "visitorId", 100);
  const internalUserId = requireString(body.internalUserId, "internalUserId", 200);

  await env.DB.prepare(`
    UPDATE visitors
    SET internal_user_id = ?, last_seen_at = ?
    WHERE visitor_id = ?
  `).bind(internalUserId, new Date().toISOString(), visitorId).run();

  return json({ ok: true }, 202, request, env);
}

async function collectPreciseLocation(request, env) {
  assertOriginAllowed(request, env);
  const body = await readJson(request);
  const ids = requiredIds(body, ["visitorId", "sessionId"]);

  if (body.consent !== true) {
    throw httpError(400, "Explicit location consent is required");
  }

  const latitude = coordinate(body.latitude, -90, 90, "latitude");
  const longitude = coordinate(body.longitude, -180, 180, "longitude");
  const accuracy = cleanNumber(body.accuracy, 0, 100000);

  await env.DB.prepare(`
    UPDATE sessions
    SET precise_latitude = ?,
        precise_longitude = ?,
        precise_accuracy_m = ?,
        precise_location_consent = 1
    WHERE session_id = ? AND visitor_id = ?
  `).bind(latitude, longitude, accuracy, ids.sessionId, ids.visitorId).run();

  return json({ ok: true }, 202, request, env);
}

async function adminOverview(request, env) {
  const url = new URL(request.url);
  const days = clampInt(url.searchParams.get("days"), 1, 365, 30);
  const modifier = `-${days} days`;

  const [totals, topPages, topSources, devices, performance] = await Promise.all([
    env.DB.prepare(`
      SELECT
        (SELECT COUNT(*) FROM visitors WHERE first_seen_at >= datetime('now', ?)) AS new_visitors,
        (SELECT COUNT(DISTINCT visitor_id) FROM sessions WHERE started_at >= datetime('now', ?)) AS unique_visitors,
        (SELECT COUNT(*) FROM sessions WHERE started_at >= datetime('now', ?)) AS sessions,
        (SELECT COUNT(*) FROM page_views WHERE started_at >= datetime('now', ?)) AS page_views,
        (SELECT COALESCE(AVG(active_ms), 0) FROM page_views WHERE started_at >= datetime('now', ?)) AS avg_active_ms,
        (SELECT COUNT(*) FROM events WHERE occurred_at >= datetime('now', ?)) AS events,
        (SELECT COUNT(*) FROM errors WHERE occurred_at >= datetime('now', ?)) AS errors
    `).bind(modifier, modifier, modifier, modifier, modifier, modifier, modifier).first(),
    env.DB.prepare(`
      SELECT path, COUNT(*) AS page_views,
             ROUND(AVG(active_ms)) AS avg_active_ms,
             ROUND(AVG(max_scroll_pct), 1) AS avg_scroll_pct
      FROM page_views
      WHERE started_at >= datetime('now', ?)
      GROUP BY path
      ORDER BY page_views DESC
      LIMIT 12
    `).bind(modifier).all(),
    env.DB.prepare(`
      SELECT COALESCE(source, 'Direct') AS source,
             COALESCE(medium, '') AS medium,
             COUNT(*) AS sessions
      FROM sessions
      WHERE started_at >= datetime('now', ?)
      GROUP BY source, medium
      ORDER BY sessions DESC
      LIMIT 12
    `).bind(modifier).all(),
    env.DB.prepare(`
      SELECT COALESCE(device_type, 'Unknown') AS device_type, COUNT(*) AS sessions
      FROM sessions
      WHERE started_at >= datetime('now', ?)
      GROUP BY device_type
      ORDER BY sessions DESC
    `).bind(modifier).all(),
    env.DB.prepare(`
      SELECT metric_name,
             ROUND(AVG(metric_value), 2) AS average,
             COUNT(*) AS samples
      FROM performance_metrics
      WHERE occurred_at >= datetime('now', ?)
      GROUP BY metric_name
      ORDER BY metric_name
    `).bind(modifier).all()
  ]);

  return json({
    days,
    totals,
    topPages: topPages.results,
    topSources: topSources.results,
    devices: devices.results,
    performance: performance.results
  }, 200, request, env);
}

async function adminLive(request, env) {
  const result = await env.DB.prepare(`
    SELECT
      session_id, visitor_id, page_view_id, path,
      last_seen_at, is_active, country, city, device_type
    FROM live_presence
    WHERE last_seen_at >= datetime('now', '-2 minutes')
    ORDER BY last_seen_at DESC
    LIMIT 200
  `).all();

  return json({
    online: result.results.filter((row) => row.is_active === 1).length,
    visitors: result.results
  }, 200, request, env);
}

async function adminSessions(request, env) {
  const url = new URL(request.url);
  const limit = clampInt(url.searchParams.get("limit"), 1, 200, 50);
  const result = await env.DB.prepare(`
    SELECT
      s.session_id, s.visitor_id, s.started_at, s.last_seen_at, s.ended_at,
      s.landing_path, s.exit_path, s.source, s.medium, s.campaign,
      s.device_type, s.browser_name, s.os_name,
      s.country, s.city, s.as_organization,
      COUNT(DISTINCT p.page_view_id) AS page_views,
      COALESCE(SUM(p.active_ms), 0) AS active_ms,
      COALESCE(MAX(p.max_scroll_pct), 0) AS max_scroll_pct
    FROM sessions s
    LEFT JOIN page_views p ON p.session_id = s.session_id
    GROUP BY s.session_id
    ORDER BY s.started_at DESC
    LIMIT ?
  `).bind(limit).all();

  return json({ sessions: result.results }, 200, request, env);
}

async function adminEvents(request, env) {
  const url = new URL(request.url);
  const limit = clampInt(url.searchParams.get("limit"), 1, 300, 100);
  const name = cleanString(url.searchParams.get("name"), 100);

  const statement = name
    ? env.DB.prepare(`
        SELECT event_id, session_id, visitor_id, page_view_id,
               occurred_at, name, category, path, metadata_json
        FROM events
        WHERE name = ?
        ORDER BY occurred_at DESC
        LIMIT ?
      `).bind(name, limit)
    : env.DB.prepare(`
        SELECT event_id, session_id, visitor_id, page_view_id,
               occurred_at, name, category, path, metadata_json
        FROM events
        ORDER BY occurred_at DESC
        LIMIT ?
      `).bind(limit);

  const result = await statement.all();
  return json({ events: result.results }, 200, request, env);
}

async function adminErrors(request, env) {
  const url = new URL(request.url);
  const limit = clampInt(url.searchParams.get("limit"), 1, 200, 100);
  const result = await env.DB.prepare(`
    SELECT
      message, type, path, filename,
      COUNT(*) AS occurrences,
      COUNT(DISTINCT session_id) AS affected_sessions,
      MIN(occurred_at) AS first_seen_at,
      MAX(occurred_at) AS last_seen_at
    FROM errors
    GROUP BY message, type, path, filename
    ORDER BY last_seen_at DESC
    LIMIT ?
  `).bind(limit).all();

  return json({ errors: result.results }, 200, request, env);
}

async function adminFunnel(request, env) {
  const url = new URL(request.url);
  const steps = (url.searchParams.get("steps") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 8);

  if (!steps.length) {
    throw httpError(400, "Provide comma-separated event names in ?steps=");
  }

  const counts = [];
  for (let stepIndex = 0; stepIndex < steps.length; stepIndex += 1) {
    const aliases = Array.from({ length: stepIndex + 1 }, (_, index) => `e${index + 1}`);
    const joins = aliases.slice(1).map((alias, index) => `
      JOIN events ${alias}
        ON ${alias}.session_id = e1.session_id
       AND ${alias}.name = ?
       AND ${alias}.occurred_at >= ${aliases[index]}.occurred_at
    `).join("");

    const sql = `
      SELECT COUNT(DISTINCT e1.session_id) AS sessions
      FROM events e1
      ${joins}
      WHERE e1.name = ?
        AND e1.occurred_at >= datetime('now', '-30 days')
    `;

    const bindValues = [...steps.slice(1, stepIndex + 1), steps[0]];
    const row = await env.DB.prepare(sql).bind(...bindValues).first();
    counts.push(Number(row?.sessions || 0));
  }

  return json({
    range: "30 days",
    ordered: true,
    steps: steps.map((name, index) => {
      const sessions = counts[index];
      const previous = index === 0 ? sessions : counts[index - 1];
      return {
        name,
        sessions,
        stepConversionPct: previous > 0 ? Math.round((sessions / previous) * 10000) / 100 : 0
      };
    })
  }, 200, request, env);
}

async function purgeOldData(request, env) {
  const body = await readJson(request).catch(() => ({}));
  const days = clampInt(body.days, 7, 3650, retentionDays(env));
  await runRetention(env, days);
  return json({ ok: true, retentionDays: days }, 200, request, env);
}

async function runRetention(env, overrideDays) {
  const days = overrideDays || retentionDays(env);
  const modifier = `-${days} days`;

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM errors WHERE occurred_at < datetime('now', ?)` ).bind(modifier),
    env.DB.prepare(`DELETE FROM performance_metrics WHERE occurred_at < datetime('now', ?)` ).bind(modifier),
    env.DB.prepare(`DELETE FROM events WHERE occurred_at < datetime('now', ?)` ).bind(modifier),
    env.DB.prepare(`DELETE FROM page_views WHERE started_at < datetime('now', ?)` ).bind(modifier),
    env.DB.prepare(`DELETE FROM live_presence WHERE last_seen_at < datetime('now', '-1 day')`),
    env.DB.prepare(`DELETE FROM sessions WHERE started_at < datetime('now', ?)` ).bind(modifier),
    env.DB.prepare(`
      DELETE FROM visitors
      WHERE last_seen_at < datetime('now', ?)
        AND visitor_id NOT IN (SELECT visitor_id FROM sessions)
    `).bind(modifier)
  ]);
}

function retentionDays(env) {
  return clampInt(env.RETENTION_DAYS, 7, 3650, DEFAULT_RETENTION_DAYS);
}

async function readJson(request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) throw httpError(413, "Payload too large");

  let body;
  try {
    body = await request.json();
  } catch {
    throw httpError(400, "Expected valid JSON");
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw httpError(400, "Expected a JSON object");
  }

  return body;
}

function requiredIds(body, names) {
  return Object.fromEntries(
    names.map((name) => [name, requireString(body[name], name, 100)])
  );
}

function cleanCampaign(body) {
  return {
    source: cleanString(body.source, 200),
    medium: cleanString(body.medium, 200),
    campaign: cleanString(body.campaign, 200),
    term: cleanString(body.term, 300),
    content: cleanString(body.content, 300)
  };
}

function cleanDevice(body) {
  return {
    deviceType: cleanString(body.deviceType, 30),
    browserName: cleanString(body.browserName, 80),
    browserVersion: cleanString(body.browserVersion, 40),
    osName: cleanString(body.osName, 80),
    osVersion: cleanString(body.osVersion, 40)
  };
}

function networkFromRequest(request) {
  const cf = request.cf || {};
  return {
    country: cleanString(cf.country, 10),
    region: cleanString(cf.region, 200),
    regionCode: cleanString(cf.regionCode, 20),
    city: cleanString(cf.city, 200),
    postalCode: cleanString(cf.postalCode, 30),
    continent: cleanString(cf.continent, 10),
    colo: cleanString(cf.colo, 20),
    asn: cleanInteger(cf.asn, 0, 4294967295),
    asOrganization: cleanString(cf.asOrganization, 300),
    httpProtocol: cleanString(cf.httpProtocol, 30),
    tlsVersion: cleanString(cf.tlsVersion, 30)
  };
}

async function hashIp(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  return sha256Hex(`${env.IP_HASH_SALT || "missing-salt"}:${ip}`);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function sanitizeMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const output = {};
  let count = 0;

  for (const [rawKey, rawValue] of Object.entries(value)) {
    if (count >= 25) break;
    const key = cleanString(rawKey, 80);
    if (!key || /password|passcode|secret|token|authorization|cookie|email|phone|card/i.test(key)) {
      continue;
    }

    if (typeof rawValue === "string") {
      output[key] = rawValue.slice(0, 500);
    } else if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      output[key] = rawValue;
    } else if (typeof rawValue === "boolean" || rawValue === null) {
      output[key] = rawValue;
    } else {
      output[key] = String(rawValue).slice(0, 500);
    }
    count += 1;
  }

  return output;
}

function requireAdmin(request, env) {
  const supplied =
    request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ||
    request.headers.get("X-Admin-Key") ||
    "";

  if (!env.ANALYTICS_ADMIN_KEY || !safeEqual(supplied, env.ANALYTICS_ADMIN_KEY)) {
    throw httpError(401, "Unauthorized");
  }
}

function safeEqual(a, b) {
  const left = new TextEncoder().encode(String(a));
  const right = new TextEncoder().encode(String(b));
  if (left.length !== right.length) return false;

  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left[index] ^ right[index];
  }
  return result === 0;
}

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || "*")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function assertOriginAllowed(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return;

  const allowed = allowedOrigins(env);
  if (!allowed.includes("*") && !allowed.includes(origin)) {
    throw httpError(403, "Origin not allowed");
  }
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = allowedOrigins(env);
  const allowOrigin = allowed.includes("*")
    ? "*"
    : allowed.includes(origin)
      ? origin
      : "null";

  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "Content-Type, Authorization, X-Admin-Key",
    "access-control-max-age": "86400",
    "vary": "Origin"
  };
}

function json(value, status, request, env) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...corsHeaders(request, env)
    }
  });
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function requireString(value, field, maxLength) {
  const result = cleanString(value, maxLength);
  if (!result) throw httpError(400, `${field} is required`);
  return result;
}

function cleanString(value, maxLength) {
  if (value === null || value === undefined) return null;
  const result = String(value).trim().slice(0, maxLength);
  return result || null;
}

function cleanId(value) {
  return cleanString(value, 100);
}

function cleanPath(value) {
  const raw = cleanString(value, 1000) || "/";
  try {
    const url = new URL(raw, "https://analytics.invalid");
    return `${url.pathname}${url.search}`.slice(0, 1000);
  } catch {
    return raw.startsWith("/") ? raw : `/${raw}`;
  }
}

function cleanDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function cleanNumber(value, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(max, Math.max(min, parsed));
}

function cleanInteger(value, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(max, Math.max(min, parsed));
}

function clampInt(value, min, max, fallback) {
  return cleanInteger(value, min, max) ?? fallback;
}

function coordinate(value, min, max, field) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw httpError(400, `${field} is invalid`);
  }
  return parsed;
}

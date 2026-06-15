(() => {
  "use strict";

  const currentScript = document.currentScript;
  const endpointBase = (
    currentScript?.dataset.endpoint ||
    new URL("/api", currentScript?.src || window.location.href).href
  ).replace(/\/$/, "");

  const options = {
    autoTrack: currentScript?.dataset.autoTrack !== "false",
    clicks: currentScript?.dataset.clicks !== "false",
    heatmap: currentScript?.dataset.heatmap === "true",
    performance: currentScript?.dataset.performance !== "false",
    errors: currentScript?.dataset.errors !== "false",
    heartbeatMs: Math.max(15000, Number(currentScript?.dataset.heartbeatMs || 25000)),
    idleMs: Math.max(30000, Number(currentScript?.dataset.idleMs || 60000))
  };

  const visitorStorageKey = "cfd1_analytics_visitor_id";
  const sessionStorageKey = "cfd1_analytics_session_id";

  const visitorId = getOrCreateId(localStorage, visitorStorageKey);
  const sessionId = getOrCreateId(sessionStorage, sessionStorageKey);

  let pageViewId = crypto.randomUUID();
  let pageStartedAt = Date.now();
  let activeMs = 0;
  let activeStartedAt = isActivelyEngaged() ? Date.now() : null;
  let lastInteractionAt = Date.now();
  let maxScrollPct = 0;
  let pageViewSent = false;
  let performanceSent = false;
  const scrollMilestones = new Set();

  function getOrCreateId(storage, key) {
    try {
      let value = storage.getItem(key);
      if (!value) {
        value = crypto.randomUUID();
        storage.setItem(key, value);
      }
      return value;
    } catch {
      return crypto.randomUUID();
    }
  }

  function pathNow() {
    return `${window.location.pathname}${window.location.search}`;
  }

  function campaignData() {
    const params = new URLSearchParams(window.location.search);
    const referrerHost = (() => {
      try {
        return document.referrer ? new URL(document.referrer).hostname : null;
      } catch {
        return null;
      }
    })();

    return {
      source: params.get("utm_source") || referrerHost,
      medium: params.get("utm_medium") || (referrerHost ? "referral" : null),
      campaign: params.get("utm_campaign"),
      term: params.get("utm_term"),
      content: params.get("utm_content")
    };
  }

  function deviceData() {
    const ua = navigator.userAgent || "";
    const isTablet = /iPad|Tablet|PlayBook|Silk/i.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const isMobile = !isTablet && /Mobi|Android|iPhone|iPod/i.test(ua);

    let browserName = "Other";
    let browserVersion = null;
    const browserRules = [
      ["Edge", /Edg\/([\d.]+)/],
      ["Opera", /OPR\/([\d.]+)/],
      ["Chrome", /Chrome\/([\d.]+)/],
      ["Firefox", /Firefox\/([\d.]+)/],
      ["Safari", /Version\/([\d.]+).*Safari/]
    ];
    for (const [name, pattern] of browserRules) {
      const match = ua.match(pattern);
      if (match) {
        browserName = name;
        browserVersion = match[1];
        break;
      }
    }

    let osName = "Other";
    let osVersion = null;
    const osRules = [
      ["Windows", /Windows NT ([\d.]+)/],
      ["Android", /Android ([\d.]+)/],
      ["iOS", /(?:iPhone OS|CPU OS) ([\d_]+)/],
      ["macOS", /Mac OS X ([\d_]+)/],
      ["ChromeOS", /CrOS [^ ]+ ([\d.]+)/],
      ["Linux", /Linux/]
    ];
    for (const [name, pattern] of osRules) {
      const match = ua.match(pattern);
      if (match) {
        osName = name;
        osVersion = match[1]?.replaceAll("_", ".") || null;
        break;
      }
    }

    return {
      deviceType: isTablet ? "tablet" : isMobile ? "mobile" : "desktop",
      browserName,
      browserVersion,
      osName,
      osVersion
    };
  }

  function commonPayload() {
    return {
      visitorId,
      sessionId,
      pageViewId,
      path: pathNow(),
      occurredAt: new Date().toISOString()
    };
  }

  async function post(route, payload, { beacon = false } = {}) {
    const body = JSON.stringify(payload);
    const url = `${endpointBase}${route}`;

    if (beacon && navigator.sendBeacon) {
      const accepted = navigator.sendBeacon(
        url,
        new Blob([body], { type: "application/json" })
      );
      if (accepted) return;
    }

    try {
      await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true,
        credentials: "omit"
      });
    } catch (error) {
      console.debug("Analytics delivery failed", error);
    }
  }

  function sendPageView() {
    pageViewSent = true;
    const campaign = campaignData();
    const device = deviceData();

    return post("/collect/pageview", {
      ...commonPayload(),
      ...campaign,
      ...device,
      title: document.title,
      referrer: document.referrer || null,
      language: navigator.language || null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
      screenWidth: window.screen?.width || null,
      screenHeight: window.screen?.height || null,
      viewportWidth: window.innerWidth || null,
      viewportHeight: window.innerHeight || null,
      pixelRatio: window.devicePixelRatio || 1,
      touchEnabled: navigator.maxTouchPoints > 0,
      colorScheme: window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light"
    });
  }

  function isActivelyEngaged() {
    return document.visibilityState === "visible" &&
      Date.now() - lastInteractionAt <= options.idleMs;
  }

  function updateActiveClock() {
    const activeNow = isActivelyEngaged();

    if (activeNow && activeStartedAt === null) {
      activeStartedAt = Date.now();
    } else if (!activeNow && activeStartedAt !== null) {
      activeMs += Date.now() - activeStartedAt;
      activeStartedAt = null;
    }
  }

  function currentActiveMs() {
    updateActiveClock();
    return activeMs + (activeStartedAt !== null ? Date.now() - activeStartedAt : 0);
  }

  function calculateScrollPct() {
    const root = document.documentElement;
    const scrollable = Math.max(1, root.scrollHeight - window.innerHeight);
    return Math.min(100, Math.max(0, Math.round((window.scrollY / scrollable) * 100)));
  }

  function updateScroll() {
    maxScrollPct = Math.max(maxScrollPct, calculateScrollPct());

    for (const milestone of [25, 50, 75, 100]) {
      if (maxScrollPct >= milestone && !scrollMilestones.has(milestone)) {
        scrollMilestones.add(milestone);
        track("scroll_depth", { percent: milestone }, "engagement");
      }
    }
  }

  function sendEngagement({ ended = false, beacon = false } = {}) {
    return post("/collect/engagement", {
      ...commonPayload(),
      durationMs: Math.min(Date.now() - pageStartedAt, 86400000),
      activeMs: Math.min(currentActiveMs(), 86400000),
      maxScrollPct,
      sessionEnded: ended
    }, { beacon });
  }

  function track(name, metadata = {}, category = "custom") {
    return post("/collect/event", {
      ...commonPayload(),
      eventId: crypto.randomUUID(),
      name: String(name).slice(0, 100),
      category: String(category).slice(0, 100),
      metadata
    });
  }

  function identify(internalUserId) {
    if (!internalUserId) return Promise.reject(new Error("internalUserId is required"));
    return post("/collect/identify", {
      visitorId,
      internalUserId: String(internalUserId).slice(0, 200)
    });
  }

  function requestPreciseLocation() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve({ ok: false, reason: "unsupported" });
        return;
      }

      navigator.geolocation.getCurrentPosition(
        async (position) => {
          await post("/collect/location", {
            visitorId,
            sessionId,
            consent: true,
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy
          });
          resolve({ ok: true });
        },
        (error) => resolve({ ok: false, reason: error.message }),
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 300000
        }
      );
    });
  }

  function heartbeat() {
    return post("/collect/heartbeat", {
      ...commonPayload(),
      active: isActivelyEngaged(),
      deviceType: deviceData().deviceType
    });
  }

  function trackClick(event) {
    const target = event.target instanceof Element ? event.target.closest("a,button,[data-analytics-event]") : null;
    if (!target) return;

    const explicitName = target.getAttribute("data-analytics-event");
    const anchor = target.closest("a");
    const href = anchor?.href || null;
    const isOutbound = href && (() => {
      try { return new URL(href).origin !== window.location.origin; } catch { return false; }
    })();
    const isDownload = Boolean(anchor?.download) ||
      /\.(pdf|zip|docx?|xlsx?|pptx?|csv|mp3|mp4|png|jpe?g|webp)(?:$|\?)/i.test(href || "");

    if (!explicitName && !isOutbound && !isDownload && !options.heatmap) return;

    const xPct = Math.round((event.clientX / Math.max(1, window.innerWidth)) * 10000) / 100;
    const yPct = Math.round((event.clientY / Math.max(1, window.innerHeight)) * 10000) / 100;

    track(
      explicitName || (isDownload ? "file_download" : isOutbound ? "outbound_click" : "heatmap_click"),
      {
        element: target.tagName.toLowerCase(),
        elementId: target.id || null,
        analyticsLabel: target.getAttribute("data-analytics-label") || null,
        href: href ? href.slice(0, 1000) : null,
        download: isDownload,
        xPct,
        yPct,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight
      },
      "click"
    );
  }

  function observePerformance() {
    if (!("PerformanceObserver" in window)) return;
    const metrics = [];
    let cls = 0;
    let lcp = 0;
    let inp = 0;

    const add = (name, value, rating = null) => {
      if (!Number.isFinite(value)) return;
      metrics.push({
        id: crypto.randomUUID(),
        name,
        value: Math.round(value * 100) / 100,
        rating,
        occurredAt: new Date().toISOString()
      });
    };

    try {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        lcp = entries.at(-1)?.startTime || lcp;
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch {}

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) cls += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {}

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          inp = Math.max(inp, entry.duration || 0);
        }
      }).observe({ type: "event", buffered: true, durationThreshold: 40 });
    } catch {}

    function flush() {
      if (performanceSent) return;
      performanceSent = true;

      const navigation = performance.getEntriesByType("navigation")[0];
      if (navigation) {
        add("TTFB", navigation.responseStart);
        add("DOMInteractive", navigation.domInteractive);
        add("DOMContentLoaded", navigation.domContentLoadedEventEnd);
        add("Load", navigation.loadEventEnd);
      }
      if (lcp) add("LCP", lcp, lcp <= 2500 ? "good" : lcp <= 4000 ? "needs-improvement" : "poor");
      add("CLS", cls, cls <= 0.1 ? "good" : cls <= 0.25 ? "needs-improvement" : "poor");
      if (inp) add("INP", inp, inp <= 200 ? "good" : inp <= 500 ? "needs-improvement" : "poor");

      if (metrics.length) {
        post("/collect/performance", {
          ...commonPayload(),
          metrics
        }, { beacon: true });
      }
    }

    addEventListener("load", () => setTimeout(flush, 3000), { once: true });
    addEventListener("pagehide", flush, { once: true });
  }

  function installErrorTracking() {
    addEventListener("error", (event) => {
      if (!event.message) return;
      post("/collect/error", {
        ...commonPayload(),
        errorId: crypto.randomUUID(),
        type: "javascript",
        message: String(event.message).slice(0, 1000),
        filename: event.filename || null,
        lineNumber: event.lineno || null,
        columnNumber: event.colno || null,
        stack: event.error?.stack || null
      }, { beacon: true });
    });

    addEventListener("unhandledrejection", (event) => {
      const reason = event.reason;
      post("/collect/error", {
        ...commonPayload(),
        errorId: crypto.randomUUID(),
        type: "unhandledrejection",
        message: String(reason?.message || reason || "Unhandled promise rejection").slice(0, 1000),
        stack: reason?.stack || null
      }, { beacon: true });
    });
  }

  function resetPageView() {
    sendEngagement({ ended: false, beacon: true });
    pageViewId = crypto.randomUUID();
    pageStartedAt = Date.now();
    activeMs = 0;
    activeStartedAt = isActivelyEngaged() ? Date.now() : null;
    maxScrollPct = 0;
    scrollMilestones.clear();
    performanceSent = false;
    sendPageView();
  }

  function installSpaTracking() {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
      const result = originalPushState.apply(this, args);
      queueMicrotask(resetPageView);
      return result;
    };

    history.replaceState = function (...args) {
      const result = originalReplaceState.apply(this, args);
      queueMicrotask(resetPageView);
      return result;
    };

    addEventListener("popstate", resetPageView);
  }

  for (const eventName of ["pointerdown", "keydown", "touchstart", "scroll"]) {
    addEventListener(eventName, () => {
      lastInteractionAt = Date.now();
      updateActiveClock();
    }, { passive: true });
  }

  addEventListener("scroll", updateScroll, { passive: true });
  addEventListener("resize", updateScroll, { passive: true });
  document.addEventListener("visibilitychange", () => {
    updateActiveClock();
    if (document.visibilityState === "hidden") {
      sendEngagement({ beacon: true });
    }
  });

  addEventListener("pagehide", () => {
    sendEngagement({ ended: true, beacon: true });
  });

  if (options.clicks) addEventListener("click", trackClick, { capture: true });
  if (options.errors) installErrorTracking();
  if (options.performance) observePerformance();
  installSpaTracking();

  if (options.autoTrack) {
    sendPageView();
    setInterval(heartbeat, options.heartbeatMs);
    setInterval(updateActiveClock, 5000);
  }

  window.visitorAnalytics = Object.freeze({
    visitorId,
    sessionId,
    track,
    identify,
    requestPreciseLocation,
    heartbeat,
    collectPageView: sendPageView,
    collectEngagement: sendEngagement
  });
})();

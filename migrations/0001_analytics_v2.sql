PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS visitors (
  visitor_id TEXT PRIMARY KEY,
  internal_user_id TEXT,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  first_source TEXT,
  first_medium TEXT,
  first_campaign TEXT,
  first_referrer TEXT,
  total_sessions INTEGER NOT NULL DEFAULT 0,
  total_page_views INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_visitors_internal_user_id
  ON visitors(internal_user_id)
  WHERE internal_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_visitors_last_seen
  ON visitors(last_seen_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  visitor_id TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TEXT,
  landing_path TEXT NOT NULL,
  exit_path TEXT,
  referrer TEXT,
  source TEXT,
  medium TEXT,
  campaign TEXT,
  term TEXT,
  content TEXT,
  device_type TEXT,
  browser_name TEXT,
  browser_version TEXT,
  os_name TEXT,
  os_version TEXT,
  language TEXT,
  browser_timezone TEXT,
  screen_width INTEGER,
  screen_height INTEGER,
  viewport_width INTEGER,
  viewport_height INTEGER,
  pixel_ratio REAL,
  touch_enabled INTEGER NOT NULL DEFAULT 0,
  color_scheme TEXT,
  country TEXT,
  region TEXT,
  region_code TEXT,
  city TEXT,
  postal_code TEXT,
  continent TEXT,
  colo TEXT,
  asn INTEGER,
  as_organization TEXT,
  http_protocol TEXT,
  tls_version TEXT,
  ip_hash TEXT,
  precise_latitude REAL,
  precise_longitude REAL,
  precise_accuracy_m REAL,
  precise_location_consent INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (visitor_id) REFERENCES visitors(visitor_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_visitor
  ON sessions(visitor_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_started
  ON sessions(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_ip_hash
  ON sessions(ip_hash);

CREATE INDEX IF NOT EXISTS idx_sessions_campaign
  ON sessions(source, medium, campaign);

CREATE TABLE IF NOT EXISTS page_views (
  page_view_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TEXT,
  path TEXT NOT NULL,
  title TEXT,
  referrer TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  active_ms INTEGER NOT NULL DEFAULT 0,
  max_scroll_pct INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
  FOREIGN KEY (visitor_id) REFERENCES visitors(visitor_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_page_views_session
  ON page_views(session_id, started_at);

CREATE INDEX IF NOT EXISTS idx_page_views_path
  ON page_views(path, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_page_views_started
  ON page_views(started_at DESC);

CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  page_view_id TEXT,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  name TEXT NOT NULL,
  category TEXT,
  path TEXT,
  metadata_json TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
  FOREIGN KEY (visitor_id) REFERENCES visitors(visitor_id) ON DELETE CASCADE,
  FOREIGN KEY (page_view_id) REFERENCES page_views(page_view_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_events_name_time
  ON events(name, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_session
  ON events(session_id, occurred_at);

CREATE TABLE IF NOT EXISTS performance_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  metric_id TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  page_view_id TEXT,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  path TEXT,
  metric_name TEXT NOT NULL,
  metric_value REAL NOT NULL,
  rating TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
  FOREIGN KEY (visitor_id) REFERENCES visitors(visitor_id) ON DELETE CASCADE,
  FOREIGN KEY (page_view_id) REFERENCES page_views(page_view_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_performance_name_time
  ON performance_metrics(metric_name, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_performance_page
  ON performance_metrics(page_view_id);

CREATE TABLE IF NOT EXISTS errors (
  error_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  page_view_id TEXT,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  filename TEXT,
  line_number INTEGER,
  column_number INTEGER,
  stack TEXT,
  path TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
  FOREIGN KEY (visitor_id) REFERENCES visitors(visitor_id) ON DELETE CASCADE,
  FOREIGN KEY (page_view_id) REFERENCES page_views(page_view_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_errors_time
  ON errors(occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_errors_message
  ON errors(message);

CREATE TABLE IF NOT EXISTS live_presence (
  session_id TEXT PRIMARY KEY,
  visitor_id TEXT NOT NULL,
  page_view_id TEXT,
  path TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_active INTEGER NOT NULL DEFAULT 1,
  country TEXT,
  city TEXT,
  device_type TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
  FOREIGN KEY (visitor_id) REFERENCES visitors(visitor_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_live_presence_seen
  ON live_presence(last_seen_at DESC);

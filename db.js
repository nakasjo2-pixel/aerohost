const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs   = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'aerohost.db'));

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           TEXT PRIMARY KEY,
    firstName    TEXT NOT NULL,
    lastName     TEXT NOT NULL,
    name         TEXT NOT NULL,
    username     TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    passwordHash TEXT NOT NULL,
    plan         TEXT NOT NULL DEFAULT 'Alap csomag',
    isVerified   INTEGER NOT NULL DEFAULT 0,
    verifyToken  TEXT,
    verifyExpires INTEGER,
    resetToken   TEXT,
    resetExpires INTEGER,
    isAdmin      INTEGER NOT NULL DEFAULT 0,
    createdAt    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id        TEXT PRIMARY KEY,
    userId    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token     TEXT NOT NULL UNIQUE,
    expiresAt INTEGER NOT NULL,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS services (
    id            TEXT PRIMARY KEY,
    userId        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    userEmail     TEXT NOT NULL,
    userName      TEXT NOT NULL,
    name          TEXT NOT NULL,
    type          TEXT NOT NULL,
    plan          TEXT NOT NULL,
    game          TEXT,
    ram           TEXT,
    price         INTEGER NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'pending',
    paymentMethod TEXT,
    refCode       TEXT,
    pteroId       INTEGER,
    txnId         TEXT,
    paidAt        TEXT,
    paidHuf       REAL,
    activatedAt   TEXT,
    createdAt     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id         INTEGER PRIMARY KEY,
    userId     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    userEmail  TEXT NOT NULL,
    userName   TEXT NOT NULL,
    subject    TEXT NOT NULL,
    category   TEXT NOT NULL DEFAULT 'Általános',
    status     TEXT NOT NULL DEFAULT 'open',
    refCode    TEXT,
    message    TEXT NOT NULL DEFAULT '',
    resolution TEXT,
    closedAt   TEXT,
    createdAt  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ticket_messages (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ticketId  INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    author    TEXT NOT NULL,
    email     TEXT NOT NULL,
    isAdmin   INTEGER NOT NULL DEFAULT 0,
    message   TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    txnId       TEXT UNIQUE,
    refCode     TEXT,
    amount      REAL NOT NULL DEFAULT 0,
    currency    TEXT NOT NULL DEFAULT 'HUF',
    serviceId   TEXT REFERENCES services(id),
    activatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    actorId    TEXT,
    actorEmail TEXT,
    action     TEXT NOT NULL,
    target     TEXT,
    detail     TEXT,
    ip         TEXT,
    createdAt  TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_refresh_userId  ON refresh_tokens(userId);
  CREATE INDEX IF NOT EXISTS idx_services_userId ON services(userId);
  CREATE INDEX IF NOT EXISTS idx_tickets_userId  ON tickets(userId);
  CREATE INDEX IF NOT EXISTS idx_tmsg_ticketId   ON ticket_messages(ticketId);
  CREATE INDEX IF NOT EXISTS idx_orders_txnId    ON orders(txnId);
  CREATE INDEX IF NOT EXISTS idx_audit_createdAt ON audit_log(createdAt);

  -- #2 Pause/Resume
  CREATE TABLE IF NOT EXISTS service_pauses (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    serviceId   TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    pausedAt    TEXT NOT NULL,
    resumeAt    TEXT,
    reason      TEXT,
    resumedAt   TEXT
  );

  -- #3 Publikus szerver lap
  CREATE TABLE IF NOT EXISTS server_public_profiles (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    serviceId   TEXT NOT NULL UNIQUE REFERENCES services(id) ON DELETE CASCADE,
    slug        TEXT NOT NULL UNIQUE,
    title       TEXT,
    description TEXT,
    tags        TEXT,
    showIp      INTEGER NOT NULL DEFAULT 1,
    createdAt   TEXT NOT NULL,
    updatedAt   TEXT NOT NULL
  );

  -- #4 Coming soon oldal
  CREATE TABLE IF NOT EXISTS server_coming_soon (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    serviceId   TEXT NOT NULL UNIQUE REFERENCES services(id) ON DELETE CASCADE,
    headline    TEXT NOT NULL DEFAULT 'Hamarosan nyitunk!',
    subtext     TEXT,
    launchAt    TEXT,
    bgColor     TEXT DEFAULT '#060611',
    discordUrl  TEXT,
    active      INTEGER NOT NULL DEFAULT 1,
    createdAt   TEXT NOT NULL
  );

  -- #5 Heti státusz email log
  CREATE TABLE IF NOT EXISTS weekly_report_log (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    userId    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sentAt    TEXT NOT NULL,
    weekStart TEXT NOT NULL
  );

  -- #7 Migráció kérések
  CREATE TABLE IF NOT EXISTS migration_requests (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    userId      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    userEmail   TEXT NOT NULL,
    userName    TEXT NOT NULL,
    fromHost    TEXT NOT NULL,
    game        TEXT,
    plan        TEXT,
    notes       TEXT,
    backupUrl   TEXT,
    status      TEXT NOT NULL DEFAULT 'pending',
    ticketId    INTEGER REFERENCES tickets(id),
    createdAt   TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_pauses_svcId      ON service_pauses(serviceId);
  CREATE INDEX IF NOT EXISTS idx_pub_slug          ON server_public_profiles(slug);
  CREATE INDEX IF NOT EXISTS idx_coming_svcId      ON server_coming_soon(serviceId);
  CREATE INDEX IF NOT EXISTS idx_weekly_userId     ON weekly_report_log(userId);
  CREATE INDEX IF NOT EXISTS idx_migration_userId  ON migration_requests(userId);
`);

module.exports = db;

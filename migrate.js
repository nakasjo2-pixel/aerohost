// Egyszeri migráció: JSON fájlok → SQLite
// Futtatás: npm run migrate
require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const db   = require('./db');

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
}

const USERS_FILE    = path.join(__dirname, 'data', 'users.json');
const SERVICES_FILE = path.join(__dirname, 'data', 'services.json');
const TICKETS_FILE  = path.join(__dirname, 'data', 'tickets.json');
const ORDERS_FILE   = path.join(__dirname, 'data', 'orders.json');

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

// ── Users ──────────────────────────────────────────────────────────────────
const users = readJSON(USERS_FILE);
db.exec('BEGIN');
try {
  for (const u of users) {
    db.prepare(`
      INSERT OR IGNORE INTO users (id, firstName, lastName, name, username, email, passwordHash, plan, isVerified, isAdmin, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      u.id,
      u.firstName || u.name?.split(' ')[0] || '',
      u.lastName  || u.name?.split(' ').slice(1).join(' ') || '',
      u.name || `${u.firstName} ${u.lastName}`,
      u.username,
      u.email.toLowerCase().trim(),
      u.passwordHash,
      u.plan || 'Alap csomag',
      ADMIN_EMAILS.includes(u.email.toLowerCase()) ? 1 : 0,
      u.createdAt || new Date().toISOString()
    );
  }
  db.exec('COMMIT');
  console.log(`✓ Felhasználók: ${users.length}`);
} catch(e) { db.exec('ROLLBACK'); throw e; }

// ── Services ───────────────────────────────────────────────────────────────
const services = readJSON(SERVICES_FILE);
db.exec('BEGIN');
try {
  for (const s of services) {
    db.prepare(`
      INSERT OR IGNORE INTO services (id, userId, userEmail, userName, name, type, plan, game, ram, price, status, paymentMethod, refCode, pteroId, txnId, paidAt, paidHuf, activatedAt, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      s.id, s.userId, s.userEmail || '', s.userName || '',
      s.name, s.type, s.plan,
      s.game || null, s.ram || null,
      s.price || 0, s.status || 'pending',
      s.paymentMethod || null, s.refCode || null,
      s.pteroId || null, s.txnId || null,
      s.paidAt || null, s.paidHuf || null,
      s.activatedAt || null,
      s.createdAt || new Date().toISOString()
    );
  }
  db.exec('COMMIT');
  console.log(`✓ Szolgáltatások: ${services.length}`);
} catch(e) { db.exec('ROLLBACK'); throw e; }

// ── Tickets ────────────────────────────────────────────────────────────────
const tickets = readJSON(TICKETS_FILE);
db.exec('BEGIN');
try {
  for (const t of tickets) {
    const exists = db.prepare('SELECT id FROM tickets WHERE id = ?').get(t.id);
    if (exists) continue;
    db.prepare(`
      INSERT OR IGNORE INTO tickets (id, userId, userEmail, userName, subject, category, status, refCode, message, resolution, closedAt, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      t.id, t.userId, t.userEmail || '', t.userName || '',
      t.subject, t.category || 'Általános', t.status || 'open',
      t.refCode || null, t.message || '',
      t.resolution || null, t.closedAt || null,
      t.createdAt || new Date().toISOString()
    );
    for (const m of (t.messages || [])) {
      db.prepare(`
        INSERT INTO ticket_messages (ticketId, author, email, isAdmin, message, createdAt)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(t.id, m.author || '', m.email || '', m.isAdmin ? 1 : 0, m.message || '', m.createdAt || new Date().toISOString());
    }
  }
  db.exec('COMMIT');
  console.log(`✓ Ticketek: ${tickets.length}`);
} catch(e) { db.exec('ROLLBACK'); throw e; }

// ── Orders ─────────────────────────────────────────────────────────────────
const orders = readJSON(ORDERS_FILE);
db.exec('BEGIN');
try {
  for (const o of orders) {
    db.prepare(`
      INSERT OR IGNORE INTO orders (txnId, refCode, amount, currency, serviceId, activatedAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      o.txnId || null, o.refCode || null,
      o.amount || 0, o.currency || 'HUF',
      o.serviceId || null,
      o.activatedAt || new Date().toISOString()
    );
  }
  db.exec('COMMIT');
  console.log(`✓ Rendelések: ${orders.length}`);
} catch(e) { db.exec('ROLLBACK'); throw e; }

console.log('\nMigráció kész! Adatbázis: data/aerohost.db');

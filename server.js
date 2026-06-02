require('dotenv').config();
const express   = require('express');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto    = require('crypto');
const path      = require('path');
const fs        = require('fs');
const axios     = require('axios');
const nodemailer = require('nodemailer');

const db   = require('./db');
const app  = express();
const PORT = process.env.PORT || 3000;

const JWT_SECRET         = process.env.JWT_SECRET || 'VALTOZTASD_MEG_EZT_ELESEN_MINIMUM_32_KARAKTER!';
const JWT_ACCESS_EXPIRES = '15m';
const JWT_REFRESH_DAYS   = 30;
const SITE_URL = (process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, '');

// ── Admin meghatározás ─────────────────────────────────────────────────────
function isAdmin(email) {
  const u = db.prepare('SELECT isAdmin FROM users WHERE email = ? COLLATE NOCASE').get(email);
  return !!(u?.isAdmin);
}

function requireAdmin(req, res, next) {
  if (!req.user || !isAdmin(req.user.email)) {
    return res.status(403).json({ error: 'Nincs admin jogosultságod.' });
  }
  next();
}

// ── Audit log ──────────────────────────────────────────────────────────────
const _audit = db.prepare(`
  INSERT INTO audit_log (actorId, actorEmail, action, target, detail, ip, createdAt)
  VALUES (@actorId, @actorEmail, @action, @target, @detail, @ip, @createdAt)
`);
function audit(req, action, target, detail) {
  _audit.run({
    actorId:    req.user?.id    || null,
    actorEmail: req.user?.email || null,
    action,
    target:  target || null,
    detail:  detail ? JSON.stringify(detail) : null,
    ip:      req.ip || null,
    createdAt: new Date().toISOString()
  });
}

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '10kb' }));
app.set('trust proxy', 1);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: { error: 'Túl sok bejelentkezési kísérlet. Próbáld 15 perc múlva.' },
  standardHeaders: true, legacyHeaders: false
});
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 5,
  message: { error: 'Túl sok regisztrációs kísérlet. Próbáld egy óra múlva.' },
  standardHeaders: true, legacyHeaders: false
});
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 100,
  message: { error: 'Túl sok kérés. Lassíts egy kicsit.' }
});
app.use('/api/', apiLimiter);

// index.htm → index.html redirect
app.get('/index.htm', (req, res) => res.redirect(301, '/index.html'));

// Subdomain middleware — minden kérést kezel
app.use((req, res, next) => {
  const host = req.hostname;
  const MAIN = 'https://aerohost.eu';

  // dashboard.aerohost.eu
  if (host === 'dashboard.aerohost.eu') {
    if (req.path === '/' || req.path === '/dashboard.html') {
      return res.sendFile(path.join(__dirname, 'dashboard.html'));
    }
    // API kérések mehetnek tovább
    if (req.path.startsWith('/api/') || req.path.startsWith('/_next/') || req.path.match(/\.(js|css|png|jpg|svg|ico|woff2?)$/)) {
      return next();
    }
    // Minden más oldalt (login.html, register.html stb.) a fődomainre küld
    return res.redirect(302, MAIN + req.path);
  }

  // status.aerohost.eu
  if (host === 'status.aerohost.eu') {
    if (req.path === '/' || req.path === '/status.html') {
      return res.sendFile(path.join(__dirname, 'status.html'));
    }
    if (req.path.startsWith('/api/') || req.path.startsWith('/_next/') || req.path.match(/\.(js|css|png|jpg|svg|ico|woff2?)$/)) {
      return next();
    }
    return res.redirect(302, MAIN + req.path);
  }

  // play.aerohost.eu
  if (host === 'play.aerohost.eu') {
    if (req.path === '/' || req.path === '/server.html') {
      return res.sendFile(path.join(__dirname, 'server.html'));
    }
    if (req.path.startsWith('/api/') || req.path.startsWith('/_next/') || req.path.match(/\.(js|css|png|jpg|svg|ico|woff2?)$/)) {
      return next();
    }
    return res.redirect(302, MAIN + req.path);
  }

  // Fődomainen: / → index.html
  if (host === 'aerohost.eu' || host === 'www.aerohost.eu') {
    if (req.path === '/') return res.redirect(301, '/index.html');
  }

  next();
});

app.use(express.static(path.join(__dirname)));

// ── JWT auth middleware ────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Nincs bejelentkezve.' });
  }
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Érvénytelen vagy lejárt session.' });
  }
}

// ── Token generátorok ──────────────────────────────────────────────────────
function makeAccessToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, username: user.username, plan: user.plan, isAdmin: !!user.isAdmin },
    JWT_SECRET,
    { expiresIn: JWT_ACCESS_EXPIRES }
  );
}

function makeRefreshToken(userId) {
  const token   = crypto.randomBytes(48).toString('hex');
  const id      = crypto.randomUUID();
  const expires = Date.now() + JWT_REFRESH_DAYS * 86400 * 1000;
  db.prepare(`INSERT INTO refresh_tokens (id, userId, token, expiresAt, createdAt) VALUES (?, ?, ?, ?, ?)`)
    .run(id, userId, token, expires, new Date().toISOString());
  return token;
}

// ── Email ──────────────────────────────────────────────────────────────────
const mailer = nodemailer.createTransport({
  host:   process.env.MAIL_HOST || 'smtp-mail.outlook.com',
  port:   parseInt(process.env.MAIL_PORT || '587'),
  secure: process.env.MAIL_SECURE === 'true',
  auth: { user: process.env.MAIL_USER || '', pass: process.env.MAIL_PASS || '' },
  tls: { rejectUnauthorized: false }
});
const MAIL_FROM = process.env.MAIL_FROM || 'AeroHost <noreply@aerohost.eu>';

async function sendMail(to, subject, html) {
  if (!process.env.MAIL_PASS) return;
  try {
    await mailer.sendMail({ from: MAIL_FROM, to, subject, html });
    console.log(`✉ Email: ${to} — ${subject}`);
  } catch(e) { console.error('Email hiba:', e.message); }
}

function emailTemplate(title, content) {
  const isPublic = SITE_URL && !SITE_URL.includes('localhost');
  const logoHtml = isPublic
    ? `<img src="${SITE_URL}/logo.png" alt="AeroHost" style="width:52px;height:52px;border-radius:50%;object-fit:cover">`
    : `<div style="width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,#4c1d95,#7c3aed);display:inline-flex;align-items:center;justify-content:center;font-weight:900;font-size:1rem;color:#fff">AE</div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#060611;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#e2e8f0}
.outer{background:#060611;padding:40px 16px}.wrap{max-width:580px;margin:0 auto}
.header{text-align:center;padding-bottom:28px}
.logo-wrap{display:inline-flex;align-items:center;gap:12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:50px;padding:8px 20px 8px 8px}
.brand{font-size:1.25rem;font-weight:800;color:#fff;letter-spacing:-0.02em}
.card{background:#0f0f1a;border:1px solid rgba(255,255,255,0.08);border-radius:24px;overflow:hidden}
.card-header{background:linear-gradient(135deg,#1e1b4b,#312e81,#4c1d95);padding:32px;text-align:center}
.card-title{font-size:1.5rem;font-weight:800;color:#fff;margin-bottom:6px}
.card-subtitle{color:rgba(196,181,253,0.8);font-size:0.88rem}
.card-body{padding:28px 32px}
.info-table{width:100%;border-collapse:collapse;margin-bottom:20px}
.info-table tr td{padding:10px 0;font-size:0.88rem;border-bottom:1px solid rgba(255,255,255,0.06)}
.info-table tr:last-child td{border-bottom:none}
.info-label{color:rgba(148,163,184,0.8);width:40%}.info-value{color:#fff;font-weight:600;text-align:right}
.btn-wrap{text-align:center;margin-top:24px}
.btn{display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#1d4ed8,#7c3aed,#4338ca);border-radius:50px;color:#fff!important;text-decoration:none;font-weight:700;font-size:0.9rem}
.highlight-box{background:rgba(124,58,237,0.08);border:1px solid rgba(124,58,237,0.25);border-radius:14px;padding:16px 20px;margin:16px 0}
.ref-code{font-family:monospace;font-size:1.2rem;font-weight:800;color:#a78bfa;letter-spacing:0.12em;text-align:center;display:block;margin-top:6px}
.bank-box{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:16px 20px;margin:16px 0}
.footer{text-align:center;padding:24px 16px 0;color:rgba(100,116,139,0.7);font-size:0.75rem;line-height:1.8}
.footer a{color:rgba(124,58,237,0.7);text-decoration:none}
.divider{height:1px;background:rgba(255,255,255,0.06);margin:18px 0}
.status-badge{display:inline-block;padding:4px 12px;border-radius:99px;font-size:0.75rem;font-weight:700;background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.25);color:#4ade80}
</style></head>
<body><div class="outer"><div class="wrap">
  <div class="header">
    <div class="logo-wrap">${logoHtml}<span class="brand">AeroHost</span></div>
  </div>
  <div class="card">
    <div class="card-header">
      <div class="card-title">${title}</div>
      <div class="card-subtitle">aerohost.eu · Prémium Game & Discord Hosting</div>
    </div>
    <div class="card-body">${content}</div>
  </div>
  <div class="footer">
    © 2026 AeroHost · Minden jog fenntartva<br>
    <a href="${SITE_URL}">aerohost.eu</a> ·
    <a href="${SITE_URL}/dashboard.html">Vezérlőpult</a>
  </div>
</div></div></body></html>`;
}

async function sendWelcomeEmail(user) {
  const html = emailTemplate('Üdvözlünk az AeroHoston! 🎉', `
    <p style="color:#e2e8f0;margin-bottom:20px;line-height:1.6">
      Szia <strong style="color:#fff">${user.name}</strong>! Örülünk hogy csatlakoztál az AeroHost közösségéhez. 🚀
    </p>
    <table class="info-table">
      <tr><td class="info-label">Felhasználónév</td><td class="info-value">@${user.username}</td></tr>
      <tr><td class="info-label">E-mail</td><td class="info-value">${user.email}</td></tr>
      <tr><td class="info-label">Csomag</td><td class="info-value">${user.plan || 'Alap csomag'}</td></tr>
    </table>
    <div class="divider"></div>
    <p style="color:rgba(148,163,184,0.9);font-size:0.88rem;line-height:1.7;margin-bottom:4px">
      Erősítsd meg az e-mail címedet a fiókod aktiválásához. A megerősítő linket külön emailben küldtük.
    </p>
    <div class="btn-wrap"><a href="${SITE_URL}/dashboard.html" class="btn">Vezérlőpult →</a></div>
  `);
  await sendMail(user.email, '🎉 Üdvözlünk az AeroHoston!', html);
}

async function sendVerifyEmail(user, token) {
  const link = `${SITE_URL}/api/auth/verify-email?token=${token}`;
  const html = emailTemplate('E-mail cím megerősítése 📧', `
    <p style="color:#e2e8f0;margin-bottom:20px;line-height:1.6">
      Szia <strong style="color:#fff">${user.name}</strong>! Kérjük erősítsd meg az e-mail címedet.
    </p>
    <p style="color:rgba(148,163,184,0.9);font-size:0.88rem;line-height:1.7;margin-bottom:20px">
      Kattints az alábbi gombra a fiókod aktiválásához. A link 24 óráig érvényes.
    </p>
    <div class="btn-wrap"><a href="${link}" class="btn">E-mail megerősítése →</a></div>
    <p style="color:rgba(100,116,139,0.6);font-size:0.78rem;text-align:center;margin-top:16px">
      Ha nem te regisztráltál, hagyd figyelmen kívül ezt az emailt.
    </p>
  `);
  await sendMail(user.email, '📧 Erősítsd meg az e-mail címedet — AeroHost', html);
}

async function sendPasswordResetEmail(user, token) {
  const link = `${SITE_URL}/reset-password.html?token=${token}`;
  const html = emailTemplate('Jelszó visszaállítás 🔐', `
    <p style="color:#e2e8f0;margin-bottom:20px;line-height:1.6">
      Szia <strong style="color:#fff">${user.name}</strong>! Jelszó-visszaállítást kértél a fiókodhoz.
    </p>
    <p style="color:rgba(148,163,184,0.9);font-size:0.88rem;line-height:1.7;margin-bottom:20px">
      Kattints az alábbi gombra az új jelszó beállításához. A link <strong>1 óráig</strong> érvényes.
    </p>
    <div class="btn-wrap"><a href="${link}" class="btn">Jelszó visszaállítása →</a></div>
    <p style="color:rgba(100,116,139,0.6);font-size:0.78rem;text-align:center;margin-top:16px">
      Ha nem te kérted, hagyd figyelmen kívül — a jelszavad nem változott.
    </p>
  `);
  await sendMail(user.email, '🔐 Jelszó visszaállítás — AeroHost', html);
}

async function sendServerReadyEmail(userEmail, userName, svc) {
  const TYPE_LABELS = { game: 'Game Szerver', discord: 'Discord Bot', web: 'Webtárhely' };
  const PLAN_LABELS = { starter: 'Starter', pro: 'Pro', elite: 'Elite' };
  const html = emailTemplate('A szervered készen áll! ✅', `
    <p style="color:#e2e8f0;margin-bottom:16px">Szia <strong style="color:#fff">${userName}</strong>! A szervered aktiválva lett.</p>
    <div style="text-align:center;margin-bottom:20px"><span class="status-badge">✅ Aktív</span></div>
    <table class="info-table">
      <tr><td class="info-label">Szerver neve</td><td class="info-value">${svc.name}</td></tr>
      <tr><td class="info-label">Típus</td><td class="info-value">${TYPE_LABELS[svc.type] || svc.type}</td></tr>
      <tr><td class="info-label">Csomag</td><td class="info-value">${PLAN_LABELS[svc.plan] || svc.plan} · ${svc.ram}GB RAM</td></tr>
      <tr><td class="info-label">Havi díj</td><td class="info-value">${(svc.price||0).toLocaleString('hu-HU')} Ft/hó</td></tr>
      ${svc.pteroId ? `<tr><td class="info-label">Panel ID</td><td class="info-value">#${svc.pteroId}</td></tr>` : ''}
    </table>
    <div class="btn-wrap"><a href="${SITE_URL}/dashboard.html" class="btn">Szerver kezelése →</a></div>
  `);
  await sendMail(userEmail, '✅ Szervered készen áll — ' + svc.name, html);
}

async function sendTicketEmail(userEmail, userName, ticket, isReply = false) {
  const subject = isReply
    ? `💬 Válasz érkezett — #${ticket.id} ${ticket.subject}`
    : `🎫 Ticket megnyitva — #${ticket.id} ${ticket.subject}`;
  const lastMsg = ticket.lastMessage || '';
  const html = emailTemplate(isReply ? 'Új válasz érkezett' : 'Ticketed megnyitva', `
    <p style="color:#e2e8f0;margin-bottom:16px">Szia <strong style="color:#fff">${userName}</strong>!</p>
    <table class="info-table">
      <tr><td class="info-label">Ticket #</td><td class="info-value">#${ticket.id}</td></tr>
      <tr><td class="info-label">Tárgy</td><td class="info-value">${ticket.subject}</td></tr>
      <tr><td class="info-label">Kategória</td><td class="info-value">${ticket.category || 'Általános'}</td></tr>
      <tr><td class="info-label">Státusz</td><td class="info-value">${ticket.status === 'closed' ? 'Lezárva' : 'Folyamatban'}</td></tr>
    </table>
    ${isReply && lastMsg ? `
    <div style="background:rgba(168,85,247,0.06);border:1px solid rgba(168,85,247,0.15);border-radius:12px;padding:14px;margin:16px 0">
      <div style="font-size:0.72rem;color:#a855f7;margin-bottom:6px;font-weight:700">LEGUTÓBBI VÁLASZ</div>
      <div style="font-size:0.85rem;color:rgba(209,213,219,0.9);white-space:pre-wrap;line-height:1.6">${lastMsg}</div>
    </div>` : ''}
    <div class="btn-wrap"><a href="${SITE_URL}/dashboard.html" class="btn">Ticket megtekintése →</a></div>
  `);
  await sendMail(userEmail, subject, html);
}

async function sendTransferOrderEmail(userEmail, userName, orderData) {
  const html = emailTemplate('Rendelésed rögzítve 📦', `
    <p style="color:#e2e8f0;margin-bottom:16px">Szia <strong style="color:#fff">${userName}</strong>! A rendelésed rögzítve. Utald át az összeget az alábbi adatokra.</p>
    <table class="info-table">
      <tr><td class="info-label">Szerver neve</td><td class="info-value">${orderData.name}</td></tr>
      <tr><td class="info-label">Összeg</td><td class="info-value">${(orderData.amount||0).toLocaleString('hu-HU')} Ft/hó</td></tr>
      <tr><td class="info-label">Ticket</td><td class="info-value">#${orderData.ticketId}</td></tr>
    </table>
    <div class="bank-box">
      <div style="font-size:0.7rem;color:rgba(148,163,184,0.6);margin-bottom:12px;font-weight:700;text-transform:uppercase">🏦 Bankszámla adatok</div>
      <table class="info-table">
        <tr><td class="info-label">Bank</td><td class="info-value">${orderData.bankName}</td></tr>
        <tr><td class="info-label">Számlaszám</td><td class="info-value">${orderData.bankAccount}</td></tr>
        <tr><td class="info-label">Kedvezményezett</td><td class="info-value">${orderData.beneficiary}</td></tr>
      </table>
    </div>
    <div class="highlight-box">
      <div style="font-size:0.72rem;color:#a78bfa;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px">📌 Közlemény (kötelező!)</div>
      <span class="ref-code">${orderData.refCode}</span>
    </div>
    <p style="color:rgba(148,163,184,0.7);font-size:0.82rem;margin-bottom:4px">Az utalás beérkezése után (1–2 munkanap) aktiváljuk a szerveredet.</p>
    <div class="btn-wrap"><a href="${SITE_URL}/dashboard.html" class="btn">Vezérlőpult →</a></div>
  `);
  await sendMail(userEmail, '📦 Rendelésed — ' + orderData.name, html);
}

// ════════════════════════════════════════════════════════════════════════════
// AUTH ENDPOINTS
// ════════════════════════════════════════════════════════════════════════════

app.post('/api/register', registerLimiter, async (req, res) => {
  const { firstName, lastName, username, email, password } = req.body;
  if (!firstName || !lastName || !username || !email || !password)
    return res.status(400).json({ error: 'Minden mező kitöltése kötelező.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Érvénytelen e-mail cím.' });
  if (password.length < 8)
    return res.status(400).json({ error: 'A jelszónak legalább 8 karakter hosszúnak kell lennie.' });
  if (!/^[a-zA-Z0-9_]{3,30}$/.test(username))
    return res.status(400).json({ error: 'A felhasználónév 3–30 karakter, csak betű, szám és _ lehet.' });

  const emailNorm = email.toLowerCase().trim();
  if (db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(emailNorm))
    return res.status(409).json({ error: 'Ez az e-mail cím már foglalt.' });
  if (db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(username))
    return res.status(409).json({ error: 'Ez a felhasználónév már foglalt.' });

  const passwordHash   = await bcrypt.hash(password, 12);
  const verifyToken    = crypto.randomBytes(32).toString('hex');
  const verifyExpires  = Date.now() + 24 * 3600 * 1000;
  const id = Date.now().toString();

  db.prepare(`
    INSERT INTO users (id, firstName, lastName, name, username, email, passwordHash, plan, isVerified, verifyToken, verifyExpires, isAdmin, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'Alap csomag', 0, ?, ?, 0, ?)
  `).run(id, firstName.trim(), lastName.trim(), `${firstName.trim()} ${lastName.trim()}`,
         username.trim(), emailNorm, passwordHash, verifyToken, verifyExpires, new Date().toISOString());

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);

  sendWelcomeEmail(user).catch(() => {});
  sendVerifyEmail(user, verifyToken).catch(() => {});
  audit(req, 'register', id, { email: emailNorm });

  const accessToken  = makeAccessToken(user);
  const refreshToken = makeRefreshToken(user.id);

  res.status(201).json({
    token: accessToken, // backward compat
    accessToken, refreshToken,
    user: { id: user.id, name: user.name, email: user.email, username: user.username, plan: user.plan, isVerified: false, isAdmin: false }
  });
});

app.post('/api/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'E-mail és jelszó megadása kötelező.' });

  const user = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email.toLowerCase().trim());

  if (!user) {
    await bcrypt.compare(password, '$2a$12$dummyhashthatshouldnotmatch00000000000000000000000000');
    return res.status(401).json({ error: 'Helytelen e-mail cím vagy jelszó.' });
  }

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    audit(req, 'login_fail', user.id, { email: user.email });
    return res.status(401).json({ error: 'Helytelen e-mail cím vagy jelszó.' });
  }

  audit(req, 'login', user.id, { email: user.email });

  const accessToken  = makeAccessToken(user);
  const refreshToken = makeRefreshToken(user.id);

  res.json({
    token: accessToken, // backward compat
    accessToken, refreshToken,
    user: { id: user.id, name: user.name, email: user.email, username: user.username, plan: user.plan, isAdmin: !!user.isAdmin, isVerified: !!user.isVerified }
  });
});

// Token frissítés refresh tokennel
app.post('/api/auth/refresh', (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'Refresh token szükséges.' });

  const row = db.prepare('SELECT * FROM refresh_tokens WHERE token = ?').get(refreshToken);
  if (!row || row.expiresAt < Date.now()) {
    if (row) db.prepare('DELETE FROM refresh_tokens WHERE id = ?').run(row.id);
    return res.status(401).json({ error: 'Érvénytelen vagy lejárt refresh token.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.userId);
  if (!user) return res.status(401).json({ error: 'Felhasználó nem található.' });

  // Régi refresh token törlése (rotation)
  db.prepare('DELETE FROM refresh_tokens WHERE id = ?').run(row.id);
  const newRefresh = makeRefreshToken(user.id);
  const accessToken = makeAccessToken(user);

  res.json({ accessToken, refreshToken: newRefresh });
});

// Kijelentkezés — refresh token törlése
app.post('/api/auth/logout', requireAuth, (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    db.prepare('DELETE FROM refresh_tokens WHERE token = ? AND userId = ?').run(refreshToken, req.user.id);
  }
  audit(req, 'logout', req.user.id);
  res.json({ success: true });
});

// E-mail verifikáció
app.get('/api/auth/verify-email', (req, res) => {
  const { token } = req.query;
  if (!token) return res.redirect('/verify-success.html?status=invalid');

  const user = db.prepare('SELECT * FROM users WHERE verifyToken = ?').get(token);
  if (!user) return res.redirect('/verify-success.html?status=invalid');
  if (user.verifyExpires < Date.now()) return res.redirect('/verify-success.html?status=expired');

  db.prepare('UPDATE users SET isVerified = 1, verifyToken = NULL, verifyExpires = NULL WHERE id = ?').run(user.id);
  audit({ user: { id: user.id, email: user.email }, ip: req.ip }, 'email_verified', user.id);
  res.redirect('/verify-success.html?status=ok');
});

// Új verifikációs email kérése
app.post('/api/auth/resend-verify', requireAuth, async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Felhasználó nem található.' });
  if (user.isVerified) return res.status(400).json({ error: 'Az e-mail cím már meg van erősítve.' });

  const token   = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + 24 * 3600 * 1000;
  db.prepare('UPDATE users SET verifyToken = ?, verifyExpires = ? WHERE id = ?').run(token, expires, user.id);
  await sendVerifyEmail(user, token);
  res.json({ success: true });
});

// Jelszó-visszaállítás kérése
app.post('/api/auth/forgot-password', rateLimit({ windowMs: 15 * 60 * 1000, max: 3 }), async (req, res) => {
  const { email } = req.body;
  // Mindig ugyanolyan választ adunk, ne derüljön ki hogy létezik-e az email
  res.json({ success: true, message: 'Ha létezik ez az e-mail cím, küldtünk egy visszaállító linket.' });

  if (!email) return;
  const user = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email.toLowerCase().trim());
  if (!user) return;

  const token   = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + 3600 * 1000; // 1 óra
  db.prepare('UPDATE users SET resetToken = ?, resetExpires = ? WHERE id = ?').run(token, expires, user.id);
  sendPasswordResetEmail(user, token).catch(() => {});
  audit({ user: { id: user.id, email: user.email }, ip: req.ip }, 'password_reset_request', user.id);
});

// Jelszó visszaállítás
app.post('/api/auth/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token és jelszó szükséges.' });
  if (password.length < 8) return res.status(400).json({ error: 'A jelszónak legalább 8 karakter hosszúnak kell lennie.' });

  const user = db.prepare('SELECT * FROM users WHERE resetToken = ?').get(token);
  if (!user || user.resetExpires < Date.now()) {
    return res.status(400).json({ error: 'Érvénytelen vagy lejárt link. Kérj újat.' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  db.prepare('UPDATE users SET passwordHash = ?, resetToken = NULL, resetExpires = NULL WHERE id = ?').run(passwordHash, user.id);
  // Minden refresh token törlése biztonsági okokból
  db.prepare('DELETE FROM refresh_tokens WHERE userId = ?').run(user.id);
  audit({ user: { id: user.id, email: user.email }, ip: req.ip }, 'password_reset', user.id);
  res.json({ success: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, name, email, username, plan, isVerified, isAdmin FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Felhasználó nem található.' });
  res.json({ user });
});

// Profil szerkesztés
app.patch('/api/me', requireAuth, async (req, res) => {
  const { name, username, currentPassword, newPassword } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Felhasználó nem található.' });

  if (username && username !== user.username) {
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(username))
      return res.status(400).json({ error: 'A felhasználónév 3–30 karakter, csak betű, szám és _ lehet.' });
    if (db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id != ?').get(username, user.id))
      return res.status(409).json({ error: 'Ez a felhasználónév már foglalt.' });
  }

  if (newPassword) {
    if (!currentPassword) return res.status(400).json({ error: 'A jelenlegi jelszó megadása kötelező.' });
    const match = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!match) return res.status(400).json({ error: 'Helytelen jelenlegi jelszó.' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'Az új jelszónak legalább 8 karakter hosszúnak kell lennie.' });
    const hash = await bcrypt.hash(newPassword, 12);
    db.prepare('UPDATE users SET passwordHash = ? WHERE id = ?').run(hash, user.id);
    db.prepare('DELETE FROM refresh_tokens WHERE userId = ?').run(user.id);
    audit(req, 'password_change', user.id);
  }

  const newName     = name?.trim() || user.name;
  const newUsername = username?.trim() || user.username;
  db.prepare('UPDATE users SET name = ?, username = ? WHERE id = ?').run(newName, newUsername, user.id);
  const updated = db.prepare('SELECT id, name, email, username, plan, isVerified, isAdmin FROM users WHERE id = ?').get(user.id);
  audit(req, 'profile_update', user.id);
  res.json({ user: updated });
});

// ════════════════════════════════════════════════════════════════════════════
// PAYMENT + PTERODACTYL
// ════════════════════════════════════════════════════════════════════════════

const PAYPAL_ME        = process.env.PAYPAL_ME || '';
const BANK_NAME        = process.env.BANK_NAME        || 'OTP Bank';
const BANK_ACCOUNT     = process.env.BANK_ACCOUNT     || '00000000-00000000-00000000';
const BANK_BENEFICIARY = process.env.BANK_BENEFICIARY || 'AeroHost';
const BANK_IBAN        = process.env.BANK_IBAN        || '';

const PLAN_PRICES = { starter: 2490, pro: 3990, elite: 6990 };
const PLAN_RAM    = { starter: '4',  pro: '8',  elite: '16' };
const PLAN_LABELS = { starter: 'Starter (4GB)', pro: 'Pro (8GB)', elite: 'Elite (16GB)' };
const TYPE_LABELS = { game: 'Game Szerver', discord: 'Discord Bot', web: 'Webtárhely' };

const PTERO_URL  = (process.env.PTERODACTYL_URL || '').replace(/\/$/, '');
const PTERO_KEY  = process.env.PTERODACTYL_API_KEY || '';
const PTERO_NODE = parseInt(process.env.PTERO_NODE_ID || '1');
const PTERO_NEST = parseInt(process.env.PTERO_NEST_ID || '1');
const PTERO_EGGS = {
  minecraft:         parseInt(process.env.PTERO_EGG_MINECRAFT || '1'),
  rust:              parseInt(process.env.PTERO_EGG_RUST      || '2'),
  cs2:               parseInt(process.env.PTERO_EGG_CS2       || '3'),
  palworld:          parseInt(process.env.PTERO_EGG_PALWORLD  || '4'),
  valheim:           parseInt(process.env.PTERO_EGG_VALHEIM   || '5'),
  ark:               parseInt(process.env.PTERO_EGG_ARK       || '6'),
  'project-zomboid': parseInt(process.env.PTERO_EGG_DISCORD   || '7'),
  discord:           parseInt(process.env.PTERO_EGG_DISCORD   || '7'),
};

app.get('/api/payment/config', (req, res) => {
  res.json({
    paypalMe:        PAYPAL_ME,
    bankConfigured:  !!(BANK_ACCOUNT && !BANK_ACCOUNT.startsWith('000')),
    pteroConfigured: !!(PTERO_URL && PTERO_KEY)
  });
});

function saveService({ userId, userEmail, userName, plan, type, name, game, paymentMethod, refCode, status, pteroId }) {
  const id  = Date.now().toString();
  const ram = type === 'discord' ? '512' : PLAN_RAM[plan];
  db.prepare(`
    INSERT INTO services (id, userId, userEmail, userName, name, type, plan, game, ram, price, status, paymentMethod, refCode, pteroId, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, userEmail, userName, name, type, plan, game || null, ram, PLAN_PRICES[plan] || 2490,
         status || 'pending', paymentMethod, refCode, pteroId || null, new Date().toISOString());
  return db.prepare('SELECT * FROM services WHERE id = ?').get(id);
}

app.post('/api/payment/pending', requireAuth, async (req, res) => {
  const { plan, type, name, game } = req.body;
  const amount    = PLAN_PRICES[plan] || PLAN_PRICES.starter;
  const refCode   = 'AH-' + Date.now().toString(36).toUpperCase();
  const planLabel = PLAN_LABELS[plan] || plan;
  const typeLabel = TYPE_LABELS[type]  || type;

  // Ticket
  const ticketId = (db.prepare('SELECT COUNT(*) as c FROM tickets').get().c || 0) + 2001;
  db.prepare(`
    INSERT INTO tickets (id, userId, userEmail, userName, subject, category, status, refCode, message, createdAt)
    VALUES (?, ?, ?, ?, ?, 'Számlázás', 'open', ?, ?, ?)
  `).run(ticketId, req.user.id, req.user.email, req.user.name,
         `PayPal fizetés megerősítése – ${name}`, refCode,
         `Kedves ${req.user.name}!\n\nKöszönjük a rendelésedet!\n📦 ${name}\n🎮 ${typeLabel}${game ? ' · '+game : ''}\n📋 ${planLabel}\n💰 ${amount.toLocaleString('hu-HU')} Ft/hó\n\nReferencia: ${refCode}`,
         new Date().toISOString());

  let pteroResult = null;
  if (PTERO_URL && PTERO_KEY) {
    try { pteroResult = await createPteroServer({ user: req.user, plan, type, name, game, refCode }); }
    catch (err) { console.error('Pterodactyl hiba:', err?.response?.data || err.message); }
  }

  const svc = saveService({ userId: req.user.id, userEmail: req.user.email, userName: req.user.name,
    plan, type, name, game, paymentMethod: 'paypal_me', refCode,
    status: pteroResult ? 'running' : 'pending', pteroId: pteroResult?.id || null });

  if (pteroResult) sendServerReadyEmail(req.user.email, req.user.name, svc).catch(() => {});
  else sendTicketEmail(req.user.email, req.user.name, { id: ticketId, subject: 'PayPal fizetés – ' + name, category: 'Számlázás', status: 'open' }).catch(() => {});

  audit(req, 'order_paypal', svc.id, { plan, type, name, refCode });
  res.json({ success: true, ticketId, refCode, pteroReady: !!pteroResult, service: svc });
});

app.post('/api/payment/transfer', requireAuth, async (req, res) => {
  const { plan, type, name, game } = req.body;
  const amount    = PLAN_PRICES[plan] || PLAN_PRICES.starter;
  const refCode   = 'AH-' + Date.now().toString(36).toUpperCase();
  const planLabel = PLAN_LABELS[plan] || plan;
  const typeLabel = TYPE_LABELS[type]  || type;

  const ticketId = (db.prepare('SELECT COUNT(*) as c FROM tickets').get().c || 0) + 2001;
  db.prepare(`
    INSERT INTO tickets (id, userId, userEmail, userName, subject, category, status, refCode, message, createdAt)
    VALUES (?, ?, ?, ?, ?, 'Számlázás', 'open', ?, ?, ?)
  `).run(ticketId, req.user.id, req.user.email, req.user.name,
         `Banki átutalásos rendelés – ${name}`, refCode,
         `Kedves ${req.user.name}!\n\n📦 ${name}\n🎮 ${typeLabel}${game ? ' · '+game : ''}\n📋 ${planLabel}\n💰 ${amount.toLocaleString('hu-HU')} Ft/hó\n\nBank: ${BANK_NAME}\nSzámlaszám: ${BANK_ACCOUNT}\nKedvezményezett: ${BANK_BENEFICIARY}\n\n📌 KÖZLEMÉNY: ${refCode}`,
         new Date().toISOString());

  let pteroResult = null;
  if (PTERO_URL && PTERO_KEY) {
    try { pteroResult = await createPteroServer({ user: req.user, plan, type, name, game, refCode }); }
    catch (err) { console.error('Pterodactyl hiba:', err?.response?.data || err.message); }
  }

  const svc = saveService({ userId: req.user.id, userEmail: req.user.email, userName: req.user.name,
    plan, type, name, game, paymentMethod: 'transfer', refCode,
    status: pteroResult ? 'pending_payment' : 'pending', pteroId: pteroResult?.id || null });

  sendTransferOrderEmail(req.user.email, req.user.name, {
    name: svc.name, amount: svc.price, ticketId,
    bankName: BANK_NAME, bankAccount: BANK_ACCOUNT, beneficiary: BANK_BENEFICIARY, refCode
  }).catch(() => {});

  audit(req, 'order_transfer', svc.id, { plan, type, name, refCode });
  res.json({ success: true, ticketId, refCode, amount, bankAccount: BANK_ACCOUNT, bankName: BANK_NAME,
             iban: BANK_IBAN, beneficiary: BANK_BENEFICIARY, pteroReady: !!pteroResult, service: svc });
});

// ── Pterodactyl ────────────────────────────────────────────────────────────
async function createPteroServer({ user, plan, type, name, game, refCode }) {
  const ram  = parseInt(PLAN_RAM[plan] || '4') * 1024;
  const disk = plan === 'elite' ? 102400 : plan === 'pro' ? 51200 : 20480;
  const cpu  = plan === 'elite' ? 600 : plan === 'pro' ? 400 : 200;
  const pteroUser = await getOrCreatePteroUser(user);
  const allocId   = await getFreeAllocation();
  const eggId     = type === 'discord' ? PTERO_EGGS.discord : (PTERO_EGGS[game] || PTERO_EGGS.minecraft);
  let eggData = null;
  try {
    const r = await axios.get(`${PTERO_URL}/api/application/nests/${PTERO_NEST}/eggs/${eggId}?include=variables`,
      { headers: { Authorization: `Bearer ${PTERO_KEY}`, Accept: 'application/json' } });
    eggData = r.data.attributes;
  } catch {}
  const dockerImage = eggData?.docker_image || 'ghcr.io/pterodactyl/yolks:java_21';
  const startup     = eggData?.startup      || 'java -Xms128M -XX:MaxRAMPercentage=95.0 -jar {{SERVER_JARFILE}}';
  const environment = { SERVER_JARFILE: 'server.jar', VANILLA_VERSION: 'latest' };
  if (eggData?.relationships?.variables?.data) {
    eggData.relationships.variables.data.forEach(v => {
      if (v.attributes.default_value) environment[v.attributes.env_variable] = v.attributes.default_value;
    });
  }
  const response = await axios.post(`${PTERO_URL}/api/application/servers`, {
    name: `${name} [${refCode}]`, user: pteroUser.id, egg: eggId,
    docker_image: dockerImage, startup, environment,
    limits: { memory: ram, swap: 0, disk, io: 500, cpu },
    feature_limits: { databases: 1, backups: 2, allocations: 1 },
    allocation: { default: allocId }
  }, { headers: { Authorization: `Bearer ${PTERO_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' } });
  return response.data.attributes;
}

async function getOrCreatePteroUser(user) {
  try {
    const s = await axios.get(`${PTERO_URL}/api/application/users?filter[email]=${encodeURIComponent(user.email)}`,
      { headers: { Authorization: `Bearer ${PTERO_KEY}`, Accept: 'application/json' } });
    if (s.data.data.length > 0) return s.data.data[0].attributes;
  } catch {}
  const c = await axios.post(`${PTERO_URL}/api/application/users`, {
    email: user.email, username: user.username || user.email.split('@')[0],
    first_name: user.name?.split(' ')[0] || 'User',
    last_name:  user.name?.split(' ').slice(1).join(' ') || 'User'
  }, { headers: { Authorization: `Bearer ${PTERO_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' } });
  return c.data.attributes;
}

async function getFreeAllocation() {
  const r = await axios.get(`${PTERO_URL}/api/application/nodes/${PTERO_NODE}/allocations?per_page=100`,
    { headers: { Authorization: `Bearer ${PTERO_KEY}`, Accept: 'application/json' } });
  const free = r.data.data.find(a => !a.attributes.assigned);
  if (!free) throw new Error('Nincs szabad port/allocation!');
  return free.attributes.id;
}

// PayPal IPN
app.use('/api/payment/paypal/ipn', express.text({ type: '*/*' }));
app.post('/api/payment/paypal/ipn', async (req, res) => {
  res.sendStatus(200);
  const rawBody = req.body || '';
  try {
    const v = await axios.post('https://ipnpb.paypal.com/cgi-bin/webscr',
      'cmd=_notify-validate&' + rawBody,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    if (v.data !== 'VERIFIED') return;
  } catch { return; }

  const params        = new URLSearchParams(rawBody);
  const paymentStatus = params.get('payment_status');
  const mcGross       = parseFloat(params.get('mc_gross') || '0');
  const mcCurrency    = params.get('mc_currency');
  const memo          = (params.get('memo') || '').trim().toUpperCase();
  const txnId         = params.get('txn_id') || '';

  if (paymentStatus !== 'Completed' || mcCurrency !== 'HUF') return;
  if (db.prepare('SELECT id FROM orders WHERE txnId = ?').get(txnId)) return;

  let svc = db.prepare('SELECT * FROM services WHERE refCode = ?').get(memo.match(/AH-[A-Z0-9]+/)?.[0] || '');
  if (!svc) {
    const matchedPlan = Object.entries(PLAN_PRICES).find(([, p]) => Math.abs(p - mcGross) < 10);
    if (matchedPlan) svc = db.prepare("SELECT * FROM services WHERE status = 'pending' AND price = ? ORDER BY createdAt DESC LIMIT 1").get(matchedPlan[1]);
  }

  if (svc) {
    if (PTERO_URL && PTERO_KEY) {
      try {
        if (svc.pteroId) {
          await axios.post(`${PTERO_URL}/api/application/servers/${svc.pteroId}/unsuspend`, {},
            { headers: { Authorization: `Bearer ${PTERO_KEY}`, Accept: 'application/json' } });
        } else {
          const u = db.prepare('SELECT * FROM users WHERE id = ?').get(svc.userId);
          const r = await createPteroServer({ user: u || { email: svc.userEmail, name: svc.userName, username: svc.userName }, plan: svc.plan, type: svc.type, name: svc.name, game: svc.game, refCode: svc.refCode });
          db.prepare('UPDATE services SET pteroId = ? WHERE id = ?').run(r.id, svc.id);
        }
      } catch (err) { console.error('Ptero aktiválás hiba:', err?.response?.data || err.message); }
    }
    db.prepare("UPDATE services SET status = 'running', paidAt = ?, txnId = ?, paidHuf = ? WHERE id = ?")
      .run(new Date().toISOString(), txnId, mcGross, svc.id);

    const t = db.prepare("SELECT * FROM tickets WHERE refCode = ? OR (category = 'Számlázás' AND status = 'open' AND userId = ?) ORDER BY createdAt DESC LIMIT 1").get(svc.refCode, svc.userId);
    if (t) {
      db.prepare("UPDATE tickets SET status = 'closed', closedAt = ?, resolution = ? WHERE id = ?")
        .run(new Date().toISOString(), `✅ Fizetés megerősítve! Összeg: ${mcGross.toLocaleString('hu-HU')} HUF\nPayPal txn: ${txnId}`, t.id);
    }
  }

  db.prepare('INSERT OR IGNORE INTO orders (txnId, refCode, amount, currency, serviceId, activatedAt) VALUES (?, ?, ?, ?, ?, ?)')
    .run(txnId, svc?.refCode || memo, mcGross, mcCurrency, svc?.id || null, new Date().toISOString());
});

// ════════════════════════════════════════════════════════════════════════════
// TICKETS
// ════════════════════════════════════════════════════════════════════════════

app.post('/api/tickets/new', requireAuth, (req, res) => {
  const { subject, category, message } = req.body;
  if (!subject?.trim()) return res.status(400).json({ error: 'A tárgy nem lehet üres.' });

  const ticketId = (db.prepare('SELECT COUNT(*) as c FROM tickets').get().c || 0) + 1001;
  db.prepare(`
    INSERT INTO tickets (id, userId, userEmail, userName, subject, category, status, message, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)
  `).run(ticketId, req.user.id, req.user.email, req.user.name,
         subject.trim(), category || 'Általános', message?.trim() || '', new Date().toISOString());

  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
  audit(req, 'ticket_open', String(ticketId), { subject: ticket.subject });
  sendTicketEmail(req.user.email, req.user.name, ticket).catch(() => {});
  res.json({ success: true, ticket });
});

app.post('/api/tickets/:id/message', requireAuth, (req, res) => {
  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Az üzenet nem lehet üres.' });

  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket nem található.' });
  if (String(ticket.userId) !== String(req.user.id) && !isAdmin(req.user.email)) {
    return res.status(403).json({ error: 'Nincs jogosultságod.' });
  }

  const adminFlag = isAdmin(req.user.email) ? 1 : 0;
  db.prepare(`INSERT INTO ticket_messages (ticketId, author, email, isAdmin, message, createdAt) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(ticket.id, req.user.name, req.user.email, adminFlag, message.trim(), new Date().toISOString());

  if (!adminFlag && ticket.status === 'closed') {
    db.prepare("UPDATE tickets SET status = 'open' WHERE id = ?").run(ticket.id);
  }

  const msgs    = db.prepare('SELECT * FROM ticket_messages WHERE ticketId = ? ORDER BY createdAt').all(ticket.id);
  const updated = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticket.id);
  const emailPayload = { ...updated, lastMessage: message.trim() };

  if (adminFlag) {
    if (ticket.userEmail) sendTicketEmail(ticket.userEmail, ticket.userName || 'Felhasználó', emailPayload, true).catch(() => {});
  } else {
    const adminEmails = db.prepare("SELECT email FROM users WHERE isAdmin = 1").all().map(r => r.email);
    adminEmails.forEach(e => sendTicketEmail(e, 'Admin', emailPayload, true).catch(() => {}));
  }

  res.json({ success: true, ticket: updated, messages: msgs });
});

app.get('/api/tickets/:id', requireAuth, (req, res) => {
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket nem található.' });
  if (String(ticket.userId) !== String(req.user.id) && !isAdmin(req.user.email)) {
    return res.status(403).json({ error: 'Nincs jogosultságod.' });
  }
  const messages = db.prepare('SELECT * FROM ticket_messages WHERE ticketId = ? ORDER BY createdAt').all(ticket.id);
  res.json({ ...ticket, messages });
});

// ════════════════════════════════════════════════════════════════════════════
// ADMIN API
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/admin/stats', requireAuth, requireAdmin, (req, res) => {
  const users    = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const services = db.prepare('SELECT COUNT(*) as c FROM services').get().c;
  const active   = db.prepare("SELECT COUNT(*) as c FROM services WHERE status = 'running'").get().c;
  const pending  = db.prepare("SELECT COUNT(*) as c FROM services WHERE status IN ('pending','pending_payment')").get().c;
  const tickets  = db.prepare('SELECT COUNT(*) as c FROM tickets').get().c;
  const open     = db.prepare("SELECT COUNT(*) as c FROM tickets WHERE status = 'open'").get().c;
  const revenue  = db.prepare('SELECT COALESCE(SUM(amount),0) as total FROM orders').get().total;
  res.json({ users, services, activeServices: active, pendingServices: pending, tickets, openTickets: open, revenue });
});

app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, name, email, username, plan, isVerified, isAdmin, createdAt FROM users ORDER BY createdAt DESC').all();
  res.json(users);
});

app.patch('/api/admin/users/:id/toggle-admin', requireAuth, requireAdmin, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Felhasználó nem található.' });
  const newVal = target.isAdmin ? 0 : 1;
  db.prepare('UPDATE users SET isAdmin = ? WHERE id = ?').run(newVal, target.id);
  audit(req, newVal ? 'grant_admin' : 'revoke_admin', target.id, { email: target.email });
  res.json({ success: true, isAdmin: !!newVal });
});

app.get('/api/admin/tickets', requireAuth, requireAdmin, (req, res) => {
  const tickets = db.prepare('SELECT * FROM tickets ORDER BY createdAt DESC').all();
  res.json(tickets);
});

app.patch('/api/admin/tickets/:id/close', requireAuth, requireAdmin, (req, res) => {
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket nem található.' });
  db.prepare("UPDATE tickets SET status = 'closed', closedAt = ?, resolution = ? WHERE id = ?")
    .run(new Date().toISOString(), req.body.resolution || 'Admin által lezárva.', ticket.id);
  audit(req, 'ticket_close', String(ticket.id));
  res.json({ success: true });
});

app.get('/api/admin/services', requireAuth, requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM services ORDER BY createdAt DESC').all());
});

app.patch('/api/admin/services/:id/activate', requireAuth, requireAdmin, async (req, res) => {
  const svc = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id);
  if (!svc) return res.status(404).json({ error: 'Szolgáltatás nem található.' });
  if (PTERO_URL && PTERO_KEY && svc.pteroId) {
    try {
      await axios.post(`${PTERO_URL}/api/application/servers/${svc.pteroId}/unsuspend`, {},
        { headers: { Authorization: `Bearer ${PTERO_KEY}`, Accept: 'application/json' } });
    } catch (err) { console.error('Unsuspend hiba:', err?.response?.data || err.message); }
  }
  db.prepare("UPDATE services SET status = 'running', activatedAt = ? WHERE id = ?").run(new Date().toISOString(), svc.id);
  audit(req, 'service_activate', svc.id, { name: svc.name });
  const updated = db.prepare('SELECT * FROM services WHERE id = ?').get(svc.id);
  sendServerReadyEmail(svc.userEmail, svc.userName, updated).catch(() => {});
  res.json({ success: true, service: updated });
});

app.patch('/api/admin/services/:id/suspend', requireAuth, requireAdmin, async (req, res) => {
  const svc = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id);
  if (!svc) return res.status(404).json({ error: 'Szolgáltatás nem található.' });
  if (PTERO_URL && PTERO_KEY && svc.pteroId) {
    try {
      await axios.post(`${PTERO_URL}/api/application/servers/${svc.pteroId}/suspend`, {},
        { headers: { Authorization: `Bearer ${PTERO_KEY}`, Accept: 'application/json' } });
    } catch (err) { console.error('Suspend hiba:', err?.response?.data || err.message); }
  }
  db.prepare("UPDATE services SET status = 'suspended' WHERE id = ?").run(svc.id);
  audit(req, 'service_suspend', svc.id, { name: svc.name });
  res.json({ success: true });
});

app.post('/api/admin/test-server', requireAuth, requireAdmin, async (req, res) => {
  const { userId, plan, type, name, game } = req.body;
  if (!name || !type) return res.status(400).json({ error: 'Név és típus kötelező.' });
  const target = userId
    ? db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
    : db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(req.user.email);
  if (!target) return res.status(404).json({ error: 'Felhasználó nem található.' });

  let pteroResult = null;
  if (PTERO_URL && PTERO_KEY) {
    try {
      pteroResult = await createPteroServer({ user: target, plan: plan || 'starter', type, name, game: game || 'minecraft', refCode: 'TEST-' + Date.now().toString(36).toUpperCase() });
    } catch(err) {
      return res.status(500).json({ error: 'Pterodactyl hiba: ' + (err?.response?.data?.errors?.[0]?.detail || err.message) });
    }
  }
  const svc = saveService({ userId: target.id, userEmail: target.email, userName: target.name,
    plan: plan || 'starter', type, name, game: game || undefined, paymentMethod: 'test',
    refCode: 'TEST-' + Date.now().toString(36).toUpperCase(), status: 'running', pteroId: pteroResult?.id || null });
  sendServerReadyEmail(target.email, target.name, svc).catch(() => {});
  audit(req, 'test_server', svc.id, { name, type });
  res.json({ success: true, service: svc, pteroReady: !!pteroResult, pteroId: pteroResult?.id });
});

app.get('/api/admin/check', requireAuth, (req, res) => {
  res.json({ isAdmin: isAdmin(req.user.email) });
});

// Audit log lekérése
app.get('/api/admin/audit', requireAuth, requireAdmin, (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit || '50'), 200);
  const offset = parseInt(req.query.offset || '0');
  const logs = db.prepare('SELECT * FROM audit_log ORDER BY createdAt DESC LIMIT ? OFFSET ?').all(limit, offset);
  const total = db.prepare('SELECT COUNT(*) as c FROM audit_log').get().c;
  res.json({ logs, total });
});

// ════════════════════════════════════════════════════════════════════════════
// USER ENDPOINTS — saját szerverek, ticketek, billing
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/services', requireAuth, (req, res) => {
  const svcs = db.prepare('SELECT * FROM services WHERE userId = ? ORDER BY createdAt DESC').all(req.user.id);
  res.json(svcs);
});

// Szerver power actions — csak a saját szerver
app.post('/api/services/:id/power', requireAuth, async (req, res) => {
  const { action } = req.body; // start | stop | restart | kill
  if (!['start','stop','restart','kill'].includes(action))
    return res.status(400).json({ error: 'Érvénytelen action. Lehetséges: start, stop, restart, kill' });

  const svc = db.prepare('SELECT * FROM services WHERE id = ? AND userId = ?').get(req.params.id, req.user.id);
  if (!svc) return res.status(404).json({ error: 'Szolgáltatás nem található.' });
  if (!svc.pteroId) return res.status(400).json({ error: 'Ehhez a szerverhez nincs Pterodactyl ID rendelve.' });

  if (!PTERO_URL || !PTERO_KEY)
    return res.status(503).json({ error: 'Pterodactyl nincs konfigurálva.' });

  try {
    await axios.post(
      `${PTERO_URL}/api/client/servers/${svc.pteroId}/power`,
      { signal: action },
      { headers: { Authorization: `Bearer ${process.env.PTERODACTYL_CLIENT_KEY || PTERO_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' } }
    );
    audit(req, `server_${action}`, svc.id, { name: svc.name });
    res.json({ success: true, action });
  } catch (err) {
    const detail = err?.response?.data?.errors?.[0]?.detail || err.message;
    res.status(500).json({ error: 'Pterodactyl hiba: ' + detail });
  }
});

// Szerver valós státusz lekérése Pterodactyl-ból
app.get('/api/services/:id/status', requireAuth, async (req, res) => {
  const svc = db.prepare('SELECT * FROM services WHERE id = ? AND userId = ?').get(req.params.id, req.user.id);
  if (!svc) return res.status(404).json({ error: 'Szolgáltatás nem található.' });
  if (!svc.pteroId || !PTERO_URL || !PTERO_KEY) return res.json({ status: svc.status, pteroStatus: null });

  try {
    const r = await axios.get(
      `${PTERO_URL}/api/client/servers/${svc.pteroId}/resources`,
      { headers: { Authorization: `Bearer ${process.env.PTERODACTYL_CLIENT_KEY || PTERO_KEY}`, Accept: 'application/json' } }
    );
    const state = r.data?.attributes?.current_state || 'unknown';
    const resources = r.data?.attributes?.resources || {};
    res.json({ status: svc.status, pteroStatus: state, resources });
  } catch {
    res.json({ status: svc.status, pteroStatus: null });
  }
});

app.get('/api/tickets', requireAuth, (req, res) => {
  const tickets = db.prepare('SELECT * FROM tickets WHERE userId = ? ORDER BY createdAt DESC').all(req.user.id);
  const result  = tickets.map(t => {
    const msgs = db.prepare('SELECT * FROM ticket_messages WHERE ticketId = ? ORDER BY createdAt').all(t.id);
    return { ...t, messages: msgs };
  });
  res.json(result);
});

app.get('/api/billing/summary', requireAuth, (req, res) => {
  const active  = db.prepare("SELECT * FROM services WHERE userId = ? AND status = 'running' ORDER BY createdAt DESC").all(req.user.id);
  const monthly = active.reduce((sum, s) => sum + (s.price || 0), 0);
  const orders  = db.prepare(`
    SELECT o.* FROM orders o
    JOIN services s ON o.serviceId = s.id
    WHERE s.userId = ?
    ORDER BY o.activatedAt DESC LIMIT 20
  `).all(req.user.id);
  res.json({ activeServices: active, monthlyTotal: monthly, recentOrders: orders });
});

// ════════════════════════════════════════════════════════════════════════════
// #2 — SZERVER SZÜNETELTETÉS (PAUSE / RESUME)
// Szüneteltetéskor: Pterodactyl suspend + DB jelölés, billing leáll
// Nincs hozzáférés semmihez addig.
// ════════════════════════════════════════════════════════════════════════════

app.post('/api/services/:id/pause', requireAuth, async (req, res) => {
  const { reason, resumeAt } = req.body;
  const svc = db.prepare('SELECT * FROM services WHERE id = ? AND userId = ?').get(req.params.id, req.user.id);
  if (!svc) return res.status(404).json({ error: 'Szolgáltatás nem található.' });
  if (svc.status === 'paused') return res.status(400).json({ error: 'A szerver már szünetel.' });
  if (!['running','pending'].includes(svc.status)) return res.status(400).json({ error: 'Csak futó szerver szüneteltethető.' });

  // Pterodactyl suspend
  if (PTERO_URL && PTERO_KEY && svc.pteroId) {
    try {
      await axios.post(`${PTERO_URL}/api/application/servers/${svc.pteroId}/suspend`, {},
        { headers: { Authorization: `Bearer ${PTERO_KEY}`, Accept: 'application/json' } });
    } catch (err) { console.error('Pause/suspend hiba:', err?.response?.data || err.message); }
  }

  db.prepare("UPDATE services SET status = 'paused', pausedAt = ? WHERE id = ?")
    .run(new Date().toISOString(), svc.id);

  db.prepare(`INSERT INTO service_pauses (serviceId, pausedAt, resumeAt, reason) VALUES (?, ?, ?, ?)`)
    .run(svc.id, new Date().toISOString(), resumeAt || null, reason || null);

  audit(req, 'service_pause', svc.id, { reason, resumeAt });
  res.json({ success: true });
});

app.post('/api/services/:id/resume', requireAuth, async (req, res) => {
  const svc = db.prepare('SELECT * FROM services WHERE id = ? AND userId = ?').get(req.params.id, req.user.id);
  if (!svc) return res.status(404).json({ error: 'Szolgáltatás nem található.' });
  if (svc.status !== 'paused') return res.status(400).json({ error: 'A szerver nincs szüneteltetve.' });

  // Pterodactyl unsuspend
  if (PTERO_URL && PTERO_KEY && svc.pteroId) {
    try {
      await axios.post(`${PTERO_URL}/api/application/servers/${svc.pteroId}/unsuspend`, {},
        { headers: { Authorization: `Bearer ${PTERO_KEY}`, Accept: 'application/json' } });
    } catch (err) { console.error('Resume/unsuspend hiba:', err?.response?.data || err.message); }
  }

  db.prepare("UPDATE services SET status = 'running', pausedAt = NULL WHERE id = ?").run(svc.id);

  const lastPause = db.prepare('SELECT id FROM service_pauses WHERE serviceId = ? AND resumedAt IS NULL ORDER BY pausedAt DESC LIMIT 1').get(svc.id);
  if (lastPause) {
    db.prepare('UPDATE service_pauses SET resumedAt = ? WHERE id = ?').run(new Date().toISOString(), lastPause.id);
  }

  audit(req, 'service_resume', svc.id);
  res.json({ success: true });
});

// Szüneteltetési előzmények
app.get('/api/services/:id/pauses', requireAuth, (req, res) => {
  const svc = db.prepare('SELECT * FROM services WHERE id = ? AND userId = ?').get(req.params.id, req.user.id);
  if (!svc) return res.status(404).json({ error: 'Szolgáltatás nem található.' });
  const pauses = db.prepare('SELECT * FROM service_pauses WHERE serviceId = ? ORDER BY pausedAt DESC LIMIT 20').all(svc.id);
  res.json(pauses);
});

// ════════════════════════════════════════════════════════════════════════════
// #3 — PUBLIKUS SZERVER LAP
// ════════════════════════════════════════════════════════════════════════════

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

// Beállítás / frissítés
app.put('/api/services/:id/public-profile', requireAuth, (req, res) => {
  const svc = db.prepare('SELECT * FROM services WHERE id = ? AND userId = ?').get(req.params.id, req.user.id);
  if (!svc) return res.status(404).json({ error: 'Szolgáltatás nem található.' });

  const { title, description, tags, showIp, enabled } = req.body;
  const now = new Date().toISOString();

  const existing = db.prepare('SELECT * FROM server_public_profiles WHERE serviceId = ?').get(svc.id);

  if (enabled === false) {
    if (existing) db.prepare('DELETE FROM server_public_profiles WHERE serviceId = ?').run(svc.id);
    return res.json({ success: true, enabled: false });
  }

  let slug = existing?.slug || slugify(title || svc.name || svc.id);
  // Ha más már foglalta ezt a slugot
  let attempt = slug;
  let counter = 2;
  while (true) {
    const conflict = db.prepare('SELECT serviceId FROM server_public_profiles WHERE slug = ? AND serviceId != ?').get(attempt, svc.id);
    if (!conflict) { slug = attempt; break; }
    attempt = slug + '-' + counter++;
  }

  if (existing) {
    db.prepare('UPDATE server_public_profiles SET title=?, description=?, tags=?, showIp=?, slug=?, updatedAt=? WHERE serviceId=?')
      .run(title || svc.name, description || null, tags || null, showIp !== false ? 1 : 0, slug, now, svc.id);
  } else {
    db.prepare('INSERT INTO server_public_profiles (serviceId, slug, title, description, tags, showIp, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)')
      .run(svc.id, slug, title || svc.name, description || null, tags || null, showIp !== false ? 1 : 0, now, now);
  }

  const profile = db.prepare('SELECT * FROM server_public_profiles WHERE serviceId = ?').get(svc.id);
  res.json({ success: true, profile, url: `${SITE_URL}/server/${slug}` });
});

app.get('/api/services/:id/public-profile', requireAuth, (req, res) => {
  const svc = db.prepare('SELECT * FROM services WHERE id = ? AND userId = ?').get(req.params.id, req.user.id);
  if (!svc) return res.status(404).json({ error: 'Szolgáltatás nem található.' });
  const profile = db.prepare('SELECT * FROM server_public_profiles WHERE serviceId = ?').get(svc.id);
  res.json({ profile: profile || null });
});

// Publikus oldal lekérése slug alapján (nincs auth)
app.get('/api/public/server/:slug', async (req, res) => {
  const profile = db.prepare('SELECT * FROM server_public_profiles WHERE slug = ?').get(req.params.slug);
  if (!profile) return res.status(404).json({ error: 'Szerver nem található.' });

  const svc = db.prepare('SELECT id, name, type, game, plan, ram, status, pteroId, createdAt FROM services WHERE id = ?').get(profile.serviceId);
  if (!svc) return res.status(404).json({ error: 'Szerver nem található.' });

  let pteroStatus = null;
  let playerCount = null;
  if (svc.status === 'running' && svc.pteroId && PTERO_URL && PTERO_KEY) {
    try {
      const r = await axios.get(
        `${PTERO_URL}/api/client/servers/${svc.pteroId}/resources`,
        { headers: { Authorization: `Bearer ${process.env.PTERODACTYL_CLIENT_KEY || PTERO_KEY}`, Accept: 'application/json' } }
      );
      pteroStatus = r.data?.attributes?.current_state || null;
    } catch {}
  }

  const comingSoon = db.prepare('SELECT * FROM server_coming_soon WHERE serviceId = ? AND active = 1').get(svc.id);

  res.json({
    profile,
    server: {
      name: profile.title || svc.name,
      type: svc.type,
      game: svc.game,
      plan: svc.plan,
      ram: svc.ram,
      status: svc.status,
      pteroStatus,
      playerCount,
      showIp: !!profile.showIp,
    },
    comingSoon: comingSoon || null
  });
});

// Összes publikus szerver listázása
app.get('/api/public/servers', (req, res) => {
  const { game, limit = 20, offset = 0 } = req.query;
  let query = `
    SELECT p.slug, p.title, p.description, p.tags, p.createdAt,
           s.game, s.type, s.plan, s.ram, s.status
    FROM server_public_profiles p
    JOIN services s ON s.id = p.serviceId
    WHERE s.status IN ('running','paused')
  `;
  const params = [];
  if (game) { query += ' AND s.game = ?'; params.push(game); }
  query += ' ORDER BY p.createdAt DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));
  const servers = db.prepare(query).all(...params);
  res.json(servers);
});

// ════════════════════════════════════════════════════════════════════════════
// #4 — COMING SOON OLDAL
// ════════════════════════════════════════════════════════════════════════════

app.put('/api/services/:id/coming-soon', requireAuth, (req, res) => {
  const svc = db.prepare('SELECT * FROM services WHERE id = ? AND userId = ?').get(req.params.id, req.user.id);
  if (!svc) return res.status(404).json({ error: 'Szolgáltatás nem található.' });

  const { headline, subtext, launchAt, bgColor, discordUrl, active } = req.body;
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT id FROM server_coming_soon WHERE serviceId = ?').get(svc.id);

  if (existing) {
    db.prepare(`UPDATE server_coming_soon SET headline=?, subtext=?, launchAt=?, bgColor=?, discordUrl=?, active=? WHERE serviceId=?`)
      .run(headline || 'Hamarosan nyitunk!', subtext || null, launchAt || null, bgColor || '#060611', discordUrl || null, active !== false ? 1 : 0, svc.id);
  } else {
    db.prepare(`INSERT INTO server_coming_soon (serviceId, headline, subtext, launchAt, bgColor, discordUrl, active, createdAt) VALUES (?,?,?,?,?,?,?,?)`)
      .run(svc.id, headline || 'Hamarosan nyitunk!', subtext || null, launchAt || null, bgColor || '#060611', discordUrl || null, active !== false ? 1 : 0, now);
  }

  const cs = db.prepare('SELECT * FROM server_coming_soon WHERE serviceId = ?').get(svc.id);
  audit(req, 'coming_soon_update', svc.id);
  res.json({ success: true, comingSoon: cs });
});

app.get('/api/services/:id/coming-soon', requireAuth, (req, res) => {
  const svc = db.prepare('SELECT * FROM services WHERE id = ? AND userId = ?').get(req.params.id, req.user.id);
  if (!svc) return res.status(404).json({ error: 'Szolgáltatás nem található.' });
  const cs = db.prepare('SELECT * FROM server_coming_soon WHERE serviceId = ?').get(svc.id);
  res.json({ comingSoon: cs || null });
});

// ════════════════════════════════════════════════════════════════════════════
// #5 — HETI STÁTUSZ EMAIL
// ════════════════════════════════════════════════════════════════════════════

async function sendWeeklyReportEmail(user, services) {
  const activeCount  = services.filter(s => s.status === 'running').length;
  const pausedCount  = services.filter(s => s.status === 'paused').length;
  const monthly      = services.reduce((a, s) => a + (s.price || 0), 0);
  const rows = services.map(s => {
    const statusLabel = s.status === 'running' ? '✅ Fut' : s.status === 'paused' ? '⏸ Szünetel' : '⚪ Egyéb';
    return `<tr>
      <td class="info-label">${s.name}</td>
      <td class="info-value">${statusLabel} · ${s.ram || '4'}GB RAM · ${(s.price || 0).toLocaleString('hu-HU')} Ft/hó</td>
    </tr>`;
  }).join('');

  const html = emailTemplate('Heti Szerver Összefoglaló 📊', `
    <p style="color:#e2e8f0;margin-bottom:20px;line-height:1.6">
      Szia <strong style="color:#fff">${user.name}</strong>! Íme a heti státusz összefoglalód.
    </p>
    <table class="info-table">
      <tr><td class="info-label">Aktív szerverek</td><td class="info-value">${activeCount} db</td></tr>
      <tr><td class="info-label">Szüneteltetve</td><td class="info-value">${pausedCount} db</td></tr>
      <tr><td class="info-label">Havi összköltség</td><td class="info-value">${monthly.toLocaleString('hu-HU')} Ft</td></tr>
    </table>
    <div class="divider"></div>
    <div style="font-size:0.72rem;color:rgba(148,163,184,0.6);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:10px">Szervereid</div>
    <table class="info-table">${rows}</table>
    <div class="divider"></div>
    <div class="highlight-box">
      <div style="font-size:0.82rem;color:rgba(196,181,253,0.9);line-height:1.6">
        💡 <strong>Tipp:</strong> Ha nem kell egy szerver egy időre, szüneteltesd — nem számolunk fel díjat addig.
      </div>
    </div>
    <div class="btn-wrap"><a href="${SITE_URL}/dashboard.html" class="btn">Vezérlőpult megnyitása →</a></div>
  `);

  await sendMail(user.email, '📊 Heti szerver összefoglaló — AeroHost', html);
}

// Kézi trigger (fejlesztői/admin teszt)
app.post('/api/admin/send-weekly-reports', requireAuth, requireAdmin, async (req, res) => {
  const users = db.prepare('SELECT * FROM users WHERE isVerified = 1').all();
  let sent = 0;
  for (const user of users) {
    const services = db.prepare('SELECT * FROM services WHERE userId = ?').all(user.id);
    if (services.length === 0) continue;
    try {
      await sendWeeklyReportEmail(user, services);
      db.prepare('INSERT INTO weekly_report_log (userId, sentAt, weekStart) VALUES (?, ?, ?)')
        .run(user.id, new Date().toISOString(), new Date().toISOString().slice(0, 10));
      sent++;
    } catch (e) { console.error('Weekly report hiba:', user.email, e.message); }
  }
  res.json({ success: true, sent });
});

// Saját heti email küldése (teszt)
app.post('/api/me/send-weekly-report', requireAuth, async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Felhasználó nem található.' });
  const services = db.prepare('SELECT * FROM services WHERE userId = ?').all(user.id);
  if (services.length === 0) return res.status(400).json({ error: 'Nincs aktív szervered.' });
  await sendWeeklyReportEmail(user, services);
  db.prepare('INSERT INTO weekly_report_log (userId, sentAt, weekStart) VALUES (?, ?, ?)')
    .run(user.id, new Date().toISOString(), new Date().toISOString().slice(0, 10));
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════════════
// #7 — ÁTKÖLTÖZTETÉSI (MIGRÁCIÓ) KÉRÉS
// ════════════════════════════════════════════════════════════════════════════

async function sendMigrationEmail(user, migration) {
  const GAME_LABELS = { minecraft: 'Minecraft', rust: 'Rust', cs2: 'CS2', palworld: 'Palworld', valheim: 'Valheim', ark: 'ARK', 'project-zomboid': 'Project Zomboid' };
  const html = emailTemplate('Migrációs kérés beérkezett 🚚', `
    <p style="color:#e2e8f0;margin-bottom:16px">Szia <strong style="color:#fff">${user.name}</strong>! Megkaptuk a migrációs kérésedet.</p>
    <table class="info-table">
      <tr><td class="info-label">Jelenlegi hoster</td><td class="info-value">${migration.fromHost}</td></tr>
      <tr><td class="info-label">Játék</td><td class="info-value">${GAME_LABELS[migration.game] || migration.game || '—'}</td></tr>
      <tr><td class="info-label">Kívánt csomag</td><td class="info-value">${migration.plan || 'Még nem döntöttem'}</td></tr>
      <tr><td class="info-label">Ticket</td><td class="info-value">#${migration.ticketId}</td></tr>
    </table>
    <div class="highlight-box">
      <div style="font-size:0.82rem;color:rgba(196,181,253,0.9);line-height:1.6">
        🔄 Csapatunk <strong>24-48 órán belül</strong> felveszi veled a kapcsolatot a ticketen keresztül. Az átköltöztetés <strong>teljesen ingyenes</strong> és adatvesztés nélkül történik.
      </div>
    </div>
    <div class="btn-wrap"><a href="${SITE_URL}/dashboard.html" class="btn">Ticket megtekintése →</a></div>
  `);
  await sendMail(user.email, '🚚 Migrációs kérésed beérkezett — AeroHost', html);
}

app.post('/api/migration/request', requireAuth, async (req, res) => {
  const { fromHost, game, plan, notes, backupUrl } = req.body;
  if (!fromHost?.trim()) return res.status(400).json({ error: 'Add meg, honnan költöznél.' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Felhasználó nem található.' });

  const ticketId = (db.prepare('SELECT COUNT(*) as c FROM tickets').get().c || 0) + 2001;
  const subject  = `Migráció kérés — ${fromHost}`;
  const message  = `Átköltöztetési kérés\n\nJelenlegi hoster: ${fromHost}\nJáték: ${game || '—'}\nKívánt csomag: ${plan || '—'}\n\nMegjegyzés:\n${notes || '(nincs)'}\n\nBackup URL: ${backupUrl || '(nem adott meg)'}`;

  db.prepare(`INSERT INTO tickets (id, userId, userEmail, userName, subject, category, status, message, createdAt)
    VALUES (?, ?, ?, ?, ?, 'Migráció', 'open', ?, ?)`)
    .run(ticketId, req.user.id, req.user.email, req.user.name, subject, message, new Date().toISOString());

  const migId = db.prepare(`INSERT INTO migration_requests (userId, userEmail, userName, fromHost, game, plan, notes, backupUrl, status, ticketId, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
    .run(req.user.id, req.user.email, req.user.name, fromHost, game || null, plan || null, notes || null, backupUrl || null, ticketId, new Date().toISOString());

  const migration = { fromHost, game, plan, ticketId };
  sendMigrationEmail(user, migration).catch(() => {});

  // Admin értesítés
  const adminEmails = db.prepare('SELECT email FROM users WHERE isAdmin = 1').all().map(r => r.email);
  adminEmails.forEach(e => sendMail(e, `🚚 Új migrációs kérés — ${req.user.name}`, emailTemplate('Új migrációs kérés', `
    <table class="info-table">
      <tr><td class="info-label">Felhasználó</td><td class="info-value">${req.user.name} (${req.user.email})</td></tr>
      <tr><td class="info-label">Honnan</td><td class="info-value">${fromHost}</td></tr>
      <tr><td class="info-label">Játék</td><td class="info-value">${game || '—'}</td></tr>
      <tr><td class="info-label">Ticket</td><td class="info-value">#${ticketId}</td></tr>
    </table>
    <div class="btn-wrap"><a href="${SITE_URL}/dashboard.html" class="btn">Ticket kezelése →</a></div>
  `)).catch(() => {}));

  audit(req, 'migration_request', String(migId.lastInsertRowid), { fromHost, game, plan });
  res.json({ success: true, ticketId, migrationId: migId.lastInsertRowid });
});

app.get('/api/migration/requests', requireAuth, (req, res) => {
  const reqs = db.prepare('SELECT * FROM migration_requests WHERE userId = ? ORDER BY createdAt DESC').all(req.user.id);
  res.json(reqs);
});

// Admin: összes migráció
app.get('/api/admin/migrations', requireAuth, requireAdmin, (req, res) => {
  const reqs = db.prepare('SELECT * FROM migration_requests ORDER BY createdAt DESC').all();
  res.json(reqs);
});

app.patch('/api/admin/migrations/:id/status', requireAuth, requireAdmin, (req, res) => {
  const { status } = req.body;
  if (!['pending','in_progress','done','cancelled'].includes(status))
    return res.status(400).json({ error: 'Érvénytelen státusz.' });
  db.prepare('UPDATE migration_requests SET status = ? WHERE id = ?').run(status, req.params.id);
  audit(req, 'migration_status', req.params.id, { status });
  res.json({ success: true });
});

// ── Catchall ───────────────────────────────────────────────────────────────
app.get('/server/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, 'server.html'));
});

app.get('*', (req, res) => {
  const htmlFile = path.join(__dirname, req.path.endsWith('.html') ? req.path : 'index.html');
  if (fs.existsSync(htmlFile)) res.sendFile(htmlFile);
  else res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  ✓ AeroHost backend fut: http://localhost:${PORT}`);
  if (JWT_SECRET.startsWith('VALTOZTASD')) console.warn('  ⚠ Állítsd be a JWT_SECRET env változót!');
});

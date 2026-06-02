// AeroHost – frontend javítások és interaktivitás
// Fut minden oldalon az aero-animations.js után

(function () {
  'use strict';

  // ── Segédek ─────────────────────────────────────────────────────────────
  function qs(sel, ctx)  { return (ctx || document).querySelector(sel); }
  function qsa(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }
  var path = window.location.pathname;
  var isGame = path.includes('/games/');
  var gameSlug = isGame ? path.split('/games/')[1].replace('.html','') : null;

  // Játék neve a slug alapján (checkout URL paraméterhez)
  var GAME_NAMES = {
    'minecraft': 'minecraft',
    'rust': 'rust',
    'cs2': 'cs2',
    'palworld': 'palworld',
    'valheim': 'valheim',
    'ark-survival-ascended': 'ark',
    'satisfactory': 'satisfactory',
    'project-zomboid': 'project-zomboid'
  };

  // Plan ár → slug megfeleltetés (Ft alapú + csomag sorrend)
  var PLAN_ORDER = ['starter', 'pro', 'elite'];

  // ── 1. DEPLOY GOMBOK JAVÍTÁSA — game/* oldalak ──────────────────────────
  // A "Szerver Telepítése" gombok discord.gg-re mutatnak, checkout-ra irányítjuk
  if (isGame) {
    var game = GAME_NAMES[gameSlug] || gameSlug;
    var planIdx = 0;

    // Minden pricing kártyán belüli deploy gomb
    qsa('a[href*="discord.gg"]').forEach(function (link) {
      var btn = qs('button', link);
      if (!btn) return;
      var txt = btn.textContent.trim().toLowerCase();
      // Csak a "Szerver Telepítése" gombok, ne a Discord csatlakozás gombok
      if (!txt.includes('telepít') && !txt.includes('szerver') && !txt.includes('rendel')) return;

      var plan = PLAN_ORDER[planIdx] || 'starter';
      planIdx++;

      link.href = '../checkout.html?plan=' + plan + '&type=game&game=' + encodeURIComponent(game);
      link.removeAttribute('target');
      link.removeAttribute('rel');
      btn.style.cursor = 'pointer';
    });
  }

  // ── 2. DISCORD.HTML DEPLOY GOMBOK ───────────────────────────────────────
  if (path.includes('discord.html')) {
    var discordPlanIdx = 0;
    qsa('a[href*="discord.gg"]').forEach(function (link) {
      var btn = qs('button', link);
      if (!btn) return;
      var txt = btn.textContent.trim().toLowerCase();
      if (!txt.includes('rendel') && !txt.includes('deploy') && !txt.includes('indít') && !txt.includes('bot')) return;
      var plan = PLAN_ORDER[discordPlanIdx] || 'starter';
      discordPlanIdx++;
      link.href = 'checkout.html?plan=' + plan + '&type=discord';
      link.removeAttribute('target');
      link.removeAttribute('rel');
    });

    // Feature tabs — Live Console / Git Integration / Always Online
    var tabButtons = qsa('button, [role="tab"], .cursor-pointer').filter(function(el) {
      var t = el.textContent.trim();
      return t === 'Live Console' || t === 'Git Integration' || t === 'Always Online';
    });

    // Feature content panelek — az opacity/hidden elemek
    var featurePanels = qsa('[class*="opacity"]').filter(function(el) {
      return el.closest('section') && el.textContent.length > 50;
    }).slice(0, 3);

    if (tabButtons.length >= 2) {
      tabButtons.forEach(function(btn, i) {
        btn.style.cursor = 'pointer';
        btn.addEventListener('click', function() {
          tabButtons.forEach(function(b, j) {
            b.classList.remove('bg-white/10', 'text-white');
            b.classList.add('text-gray-400');
            if (featurePanels[j]) {
              featurePanels[j].style.opacity = '0';
              featurePanels[j].style.pointerEvents = 'none';
            }
          });
          btn.classList.add('bg-white/10', 'text-white');
          btn.classList.remove('text-gray-400');
          if (featurePanels[i]) {
            featurePanels[i].style.opacity = '1';
            featurePanels[i].style.pointerEvents = '';
          }
        });
      });
    }

    // Discord FAQ accordion
    initFAQ();
  }

  // ── 3. WEB.HTML DEPLOY GOMBOK ───────────────────────────────────────────
  if (path.includes('web.html')) {
    var webPlanIdx = 0;
    qsa('a[href*="discord.gg"]').forEach(function (link) {
      var btn = qs('button', link);
      if (!btn) return;
      var txt = btn.textContent.trim().toLowerCase();
      if (!txt.includes('rendel') && !txt.includes('deploy') && !txt.includes('indít')) return;
      var plan = PLAN_ORDER[webPlanIdx] || 'starter';
      webPlanIdx++;
      link.href = 'checkout.html?plan=' + plan + '&type=web';
      link.removeAttribute('target');
      link.removeAttribute('rel');
    });

    // "View Documentation" gomb javítása
    qsa('a, button').forEach(function(el) {
      var t = el.textContent.trim().toLowerCase();
      if (t.includes('dokumentáció') || t.includes('documentation') || t.includes('docs')) {
        if (!el.href || el.href === '#' || el.href === '') {
          el.href = 'https://discord.gg/UsRytX4xZa';
          el.target = '_blank';
        }
      }
    });

    initFAQ();
  }

  // ── 4. GAME FAQ ACCORDION ───────────────────────────────────────────────
  if (isGame) initFAQ();

  function initFAQ() {
    // Kérdés+válasz párokat keressük — a Next.js FAQ szekcióban <p> vagy <div> tagek
    // A kérdések általában rövidebbek, a válaszok hosszabbak
    var faqSection = qsa('section, div').find(function(el) {
      return el.textContent.toLowerCase().includes('gyak') || el.textContent.toLowerCase().includes('kérdés') || el.textContent.toLowerCase().includes('faq');
    });
    if (!faqSection) return;

    // Keressük a kérdés-válasz párokat
    var qaPairs = [];
    qsa('div, p', faqSection).forEach(function(el) {
      var t = el.textContent.trim();
      if (t.endsWith('?') && t.length < 200 && el.children.length === 0) {
        // Ez egy kérdés — a következő testvér a válasz
        var next = el.nextElementSibling || el.parentElement.nextElementSibling;
        if (next) qaPairs.push({ q: el, a: next });
      }
    });

    if (!qaPairs.length) return;

    // Accordion stílus hozzáadása
    if (!document.getElementById('faq-accordion-style')) {
      var s = document.createElement('style');
      s.id = 'faq-accordion-style';
      s.textContent = `
        .faq-q {
          cursor: pointer;
          user-select: none;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 4px 0;
          transition: color 0.2s;
        }
        .faq-q:hover { color: #a78bfa; }
        .faq-q::after {
          content: '+';
          font-size: 1.3rem;
          font-weight: 300;
          color: #a78bfa;
          flex-shrink: 0;
          margin-left: 12px;
          transition: transform 0.3s;
        }
        .faq-q.open::after { transform: rotate(45deg); }
        .faq-a {
          overflow: hidden;
          max-height: 0;
          transition: max-height 0.35s ease, opacity 0.3s;
          opacity: 0;
        }
        .faq-a.open { max-height: 600px; opacity: 1; }
      `;
      document.head.appendChild(s);
    }

    qaPairs.forEach(function(pair) {
      pair.q.classList.add('faq-q');
      pair.a.classList.add('faq-a');
      pair.a.style.maxHeight = '0';
      pair.a.style.overflow = 'hidden';

      pair.q.addEventListener('click', function() {
        var isOpen = pair.q.classList.contains('open');
        // Zárjuk az összes többi
        qaPairs.forEach(function(p) {
          p.q.classList.remove('open');
          p.a.classList.remove('open');
        });
        if (!isOpen) {
          pair.q.classList.add('open');
          pair.a.classList.add('open');
        }
      });
    });
  }

  // ── 5. GAMES.HTML — SZŰRŐ + KERESÉS ────────────────────────────────────
  if (path.includes('games.html') || path.endsWith('/games') || path === '/' && qs('.game-card')) {
    initGamesFilter();
  }

  function initGamesFilter() {
    // Kártyák: minden game card
    var cards = qsa('a[href*="games/"]').map(function(a) {
      return a.closest('[class*="rounded"]') || a.closest('div[class]') || a.parentElement;
    }).filter(function(el, i, arr) { return el && arr.indexOf(el) === i; });

    if (!cards.length) return;

    // Minden kártyához meghatározzuk a kategóriát a szövege alapján
    var CAT_MAP = {
      'Túlélés': ['minecraft','rust','palworld','ark','project-zomboid','valheim'],
      'FPS':     ['cs2','counter-strike'],
      'RPG':     ['valheim'],
      'Szimuláció': ['satisfactory'],
      'Stratégia':  []
    };

    function getCardCategory(card) {
      var text = card.textContent.toLowerCase();
      for (var cat in CAT_MAP) {
        if (CAT_MAP[cat].some(function(g) { return text.includes(g); })) return cat;
      }
      // Keresés a badge-ből
      var badge = qs('[class*="badge"], [class*="tag"], span', card);
      if (badge) {
        var bt = badge.textContent.trim();
        if (CAT_MAP[bt]) return bt;
      }
      return 'Egyéb';
    }

    // Filter gombok
    var filterBtns = qsa('button').filter(function(btn) {
      var t = btn.textContent.trim();
      return ['Összes','Túlélés','FPS','RPG','Szimuláció','Stratégia'].includes(t);
    });

    filterBtns.forEach(function(btn) {
      btn.style.cursor = 'pointer';
      btn.addEventListener('click', function() {
        var cat = btn.textContent.trim();
        filterBtns.forEach(function(b) {
          b.classList.remove('bg-white', 'text-black', 'shadow-lg');
          b.classList.add('text-gray-300');
        });
        btn.classList.add('bg-white', 'text-black', 'shadow-lg');
        btn.classList.remove('text-gray-300');

        var search = (qs('input[type="text"]') || {}).value || '';
        applyFilter(cat === 'Összes' ? null : cat, search);
      });
    });

    // Keresés
    var searchInput = qs('input[type="text"]');
    if (searchInput) {
      searchInput.addEventListener('input', function() {
        var activeCat = null;
        filterBtns.forEach(function(b) {
          if (b.classList.contains('text-black') && b.textContent.trim() !== 'Összes') {
            activeCat = b.textContent.trim();
          }
        });
        applyFilter(activeCat, searchInput.value);
      });
      // Placeholder frissítése
      searchInput.placeholder = 'Játék keresése...';
    }

    function applyFilter(cat, search) {
      var q = (search || '').toLowerCase().trim();
      cards.forEach(function(card) {
        var text = card.textContent.toLowerCase();
        var catMatch = !cat || getCardCategory(card) === cat;
        var searchMatch = !q || text.includes(q);
        card.style.display = (catMatch && searchMatch) ? '' : 'none';
      });
    }
  }

  // ── 6. TERMS LINK TYPO JAVÍTÁS ──────────────────────────────────────────
  qsa('a[href*="terms-of-services"]').forEach(function(a) {
    a.href = a.href.replace('terms-of-services', 'terms-of-service');
  });
  // About oldal social linkek
  if (path.includes('about.html')) {
    qsa('a[href="#"]').forEach(function(a) {
      var t = a.textContent.trim().toLowerCase();
      if (t.includes('twitter') || t.includes('x.com') || a.innerHTML.includes('twitter')) {
        a.href = 'https://twitter.com/aerohost';
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      } else if (t.includes('linkedin') || a.innerHTML.includes('linkedin')) {
        a.href = 'https://linkedin.com/company/aerohost';
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      }
    });
  }

  // ── 7. AFFILIATE — CTA GOMB JAVÍTÁS ─────────────────────────────────────
  if (path.includes('affiliate.html')) {
    qsa('a, button').forEach(function(el) {
      var t = el.textContent.trim();
      if (t.includes('Kezdj Keresni') || t.includes('Csatlakozz') || t.includes('Regisztrálj')) {
        if (el.tagName === 'A' && (!el.href || el.href.endsWith('#'))) {
          el.href = 'register.html';
        } else if (el.tagName === 'BUTTON') {
          el.addEventListener('click', function() {
            window.location.href = 'register.html';
          });
        }
      }
    });
  }

  // ── 8. INDEX.HTML "Ingyenes Próba" gomb ─────────────────────────────────
  if (path === '/' || path.endsWith('index.html') || path.endsWith('index.htm')) {
    qsa('a, button').forEach(function(el) {
      var t = el.textContent.trim();
      if (t.includes('Ingyenes Próba') || t.includes('Free Trial')) {
        if (el.tagName === 'A' && (!el.href || el.href.endsWith('#'))) {
          el.href = 'games.html';
        }
      }
    });
  }

  // ── 9. STATUS OLDAL LINK FOOTER-BEN ─────────────────────────────────────
  // Minden oldalon a footer "Minden Rendszer Működik" linkké válik
  qsa('span, div').forEach(function(el) {
    var t = el.textContent.trim();
    if (t === 'Minden Rendszer Működik' && !el.querySelector('a')) {
      el.style.cursor = 'pointer';
      el.title = 'Rendszer státusz megtekintése';
      el.addEventListener('click', function() {
        var base = path.includes('/games/') ? '../' : '';
        window.location.href = base + 'status.html';
      });
    }
  });

  // ── 10. NAVBAR AKTÍV LINK KIEMELÉS ──────────────────────────────────────
  // Az aktuális oldal nav linkjét kiemeli
  (function() {
    var FILE_NAV = {
      'index': ['index.html','index.htm',''],
      'games.html': ['games.html'],
      'discord.html': ['discord.html'],
      'web.html': ['web.html'],
      'about.html': ['about.html'],
      'affiliate.html': ['affiliate.html']
    };
    var base = path.split('/').pop() || '';
    qsa('nav a').forEach(function(a) {
      var href = (a.getAttribute('href') || '').split('/').pop() || '';
      var isActive = false;
      for (var key in FILE_NAV) {
        if (FILE_NAV[key].indexOf(href) !== -1 && FILE_NAV[key].indexOf(base) !== -1) {
          isActive = true; break;
        }
      }
      if (isActive) {
        a.style.color = '#fff';
        a.style.fontWeight = '700';
        // Ha van inner span mint bg, emeljük ki
        var bg = qs('span[class*="bg"]', a) || qs('.absolute', a);
        if (bg) { bg.style.opacity = '0.7'; bg.style.transform = 'scale(1)'; }
      }
    });
  })();

  // ── 11. GAMES OLDAL ÜRES SZŰRŐ ÁLLAPOT ──────────────────────────────────
  // Ha minden kártya el van rejtve, "Nincs találat" üzenet jelenik meg
  (function() {
    if (!path.includes('games.html') && !path.endsWith('/games')) return;
    var grid = qs('.grid');
    if (!grid) return;

    var emptyMsg = document.createElement('div');
    emptyMsg.id = 'games-empty-msg';
    emptyMsg.style.cssText = 'display:none;grid-column:1/-1;text-align:center;padding:60px 20px;color:rgba(156,163,175,0.5)';
    emptyMsg.innerHTML = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin:0 auto 16px;display:block;opacity:0.3"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>'
      + '<div style="font-size:1rem;font-weight:600;margin-bottom:6px">Nincs találat</div>'
      + '<div style="font-size:0.85rem">Próbálj másik keresési feltételt!</div>';
    grid.appendChild(emptyMsg);

    function checkEmpty() {
      var cards = qsa('a[href*="games/"]', grid).map(function(a) {
        return a.closest('[class*="rounded"]') || a.parentElement;
      }).filter(function(el, i, arr) { return el && arr.indexOf(el) === i; });

      var visibleCount = cards.filter(function(c) { return c.style.display !== 'none'; }).length;
      emptyMsg.style.display = visibleCount === 0 ? 'block' : 'none';
    }

    // MutationObserver figyeli a kártyák display változását
    var mo = new MutationObserver(checkEmpty);
    qsa('a[href*="games/"]', grid).forEach(function(a) {
      var card = a.closest('[class*="rounded"]') || a.parentElement;
      if (card) mo.observe(card, { attributes: true, attributeFilter: ['style'] });
    });
  })();

  // ── 12. MOBIL NAV: LOGIN/REGISTER GOMBOK ────────────────────────────────
  // Az aero-animations.js mobil menüjébe login/register gombok hozzáadása
  document.addEventListener('DOMContentLoaded', function() {
    var origAnimMob = null;
    // Hookolunk az aero-animations.js mobil menü nyitójára
    var menuBtn = qs('nav button[aria-label="Open menu"]');
    if (!menuBtn) return;

    var _origClick = menuBtn.onclick;
    menuBtn.addEventListener('click', function() {
      // Kis késleltetéssel ellenőrizzük hogy a mob div létrejött
      setTimeout(function() {
        var mob = document.querySelector('body > div[style*="position:fixed"][style*="top:76px"]');
        if (!mob || mob.querySelector('.mob-auth-btns')) return;

        var authDiv = document.createElement('div');
        authDiv.className = 'mob-auth-btns';
        authDiv.style.cssText = 'border-top:1px solid rgba(255,255,255,0.07);padding:10px 6px 6px;display:flex;gap:8px;margin-top:4px';

        var base = path.includes('/games/') ? '../' : '';
        var isLoggedIn = false;
        try { isLoggedIn = !!(localStorage.getItem('ah_token') && JSON.parse(localStorage.getItem('ah_session') || 'null')); } catch(e) {}

        if (isLoggedIn) {
          var dashA = document.createElement('a');
          dashA.href = base + 'dashboard.html';
          dashA.textContent = 'Vezérlőpult →';
          dashA.style.cssText = 'flex:1;text-align:center;padding:10px;border-radius:10px;background:linear-gradient(135deg,#1d4ed8,#7c3aed);color:#fff;font-size:0.88rem;font-weight:700;text-decoration:none';
          authDiv.appendChild(dashA);
        } else {
          var loginA = document.createElement('a');
          loginA.href = base + 'login.html';
          loginA.textContent = 'Bejelentkezés';
          loginA.style.cssText = 'flex:1;text-align:center;padding:10px;border-radius:10px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:#d1d5db;font-size:0.88rem;font-weight:600;text-decoration:none';

          var regA = document.createElement('a');
          regA.href = base + 'register.html';
          regA.textContent = 'Regisztráció';
          regA.style.cssText = 'flex:1;text-align:center;padding:10px;border-radius:10px;background:linear-gradient(135deg,#1d4ed8,#7c3aed);color:#fff;font-size:0.88rem;font-weight:700;text-decoration:none';

          authDiv.appendChild(loginA);
          authDiv.appendChild(regA);
        }
        mob.appendChild(authDiv);
      }, 50);
    }, true);
  });

  // ── 13. FOOTER STÁTUSZ LINK — LOGIN/REGISTER/CHECKOUT OLDALAK ───────────
  // Ezeken az oldalakon az aero-animations.js nem fut (nincs nav), külön kezelés
  (function() {
    var footerStatusEls = qsa('span, div').filter(function(el) {
      return el.textContent.trim() === 'Minden Rendszer Működik' && !el.querySelector('a');
    });
    footerStatusEls.forEach(function(el) {
      el.style.cursor = 'pointer';
      el.title = 'Rendszer státusz megtekintése';
      el.addEventListener('click', function() {
        var base = path.includes('/games/') ? '../' : '';
        window.location.href = base + 'status.html';
      });
    });
  })();

  // ── 14. CHECKOUT: SZERVER NÉV SZERKESZTŐ ────────────────────────────────
  if (path.includes('checkout.html')) {
    // Az order-name elemet szerkeszthetővé tesszük
    setTimeout(function() {
      var nameEl = document.getElementById('order-name');
      if (!nameEl) return;

      nameEl.style.cursor = 'pointer';
      nameEl.title = 'Kattints a szerver neve módosításához';

      // Ceruza ikon hozzáadása
      var editIcon = document.createElement('span');
      editIcon.style.cssText = 'display:inline-block;margin-left:7px;opacity:0;transition:opacity 0.2s;vertical-align:middle;cursor:pointer';
      editIcon.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>';
      nameEl.parentElement && nameEl.parentElement.appendChild && nameEl.appendChild(editIcon);

      nameEl.addEventListener('mouseenter', function() { editIcon.style.opacity = '1'; });
      nameEl.addEventListener('mouseleave', function() { editIcon.style.opacity = '0'; });

      function startEdit() {
        var current = nameEl.firstChild ? (nameEl.firstChild.textContent || nameEl.textContent).replace(/\s*$/, '').trim() : nameEl.textContent.trim();
        var input = document.createElement('input');
        input.value = current;
        input.style.cssText = 'background:rgba(255,255,255,0.06);border:1px solid rgba(168,85,247,0.5);border-radius:8px;padding:4px 10px;color:#fff;font-size:1rem;font-weight:700;font-family:inherit;outline:none;width:100%;box-shadow:0 0 0 3px rgba(168,85,247,0.08)';
        nameEl.style.display = 'none';
        var wrapper = document.createElement('div');
        wrapper.style.cssText = 'display:flex;align-items:center;gap:6px';
        var ok = document.createElement('button');
        ok.textContent = '✓';
        ok.style.cssText = 'background:rgba(168,85,247,0.15);border:1px solid rgba(168,85,247,0.3);border-radius:6px;color:#c084fc;font-size:0.85rem;padding:4px 8px;cursor:pointer;font-family:inherit;flex-shrink:0';
        wrapper.appendChild(input);
        wrapper.appendChild(ok);
        nameEl.parentElement.insertBefore(wrapper, nameEl);
        input.focus();
        input.select();

        function confirm() {
          var val = input.value.trim() || current;
          wrapper.remove();
          nameEl.style.display = '';
          // Frissítjük a szövegcsomópontot, nem a teljes innerHTML-t (editIcon megmarad)
          var firstText = nameEl.firstChild;
          if (firstText && firstText.nodeType === 3) {
            firstText.textContent = val;
          } else {
            nameEl.textContent = val;
          }
          // Globális svcName frissítése a checkout script-ben
          try { window.svcName = val; } catch(e){}
          // URL param frissítése
          try {
            var u = new URL(window.location.href);
            u.searchParams.set('name', val);
            history.replaceState(null, '', u.toString());
          } catch(e){}
        }
        ok.addEventListener('click', confirm);
        input.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') confirm();
          if (e.key === 'Escape') { wrapper.remove(); nameEl.style.display = ''; }
        });
        input.addEventListener('blur', function() { setTimeout(confirm, 150); });
      }

      nameEl.addEventListener('click', startEdit);
    }, 600);
  }

  // ── 15. CHECKOUT: BEJELENTKEZÉS REDIRECT JAVÍTÁS ────────────────────────
  // Ha a felhasználó nincs bejelentkezve, a checkout login-ra küldi.
  // Visszatérés után az URL-ből visszaállítjuk a checkout-ot.
  if (path.includes('checkout.html')) {
    var _session = null;
    try { _session = JSON.parse(localStorage.getItem('ah_session')); } catch(e) {}
    if (!_session) {
      // Mentjük a teljes checkout URL-t a visszatéréshez
      localStorage.setItem('ah_redirect_after_login', window.location.href);
    }
  }

  // Login/register oldalon: ha van mentett redirect, visszairányítjuk
  if (path.includes('login.html') || path.includes('register.html')) {
    // Az auth success után redirect kezelése — a login/register JS után fut
    var _origHref = localStorage.getItem('ah_redirect_after_login');
    if (_origHref) {
      // Figyeljük a localStorage változást (bejelentkezés után)
      var _checkRedirectInterval = setInterval(function() {
        try {
          var _tok = localStorage.getItem('ah_token');
          var _sess = JSON.parse(localStorage.getItem('ah_session') || 'null');
          if (_tok && _sess && _sess.email) {
            clearInterval(_checkRedirectInterval);
            localStorage.removeItem('ah_redirect_after_login');
            window.location.href = _origHref;
          }
        } catch(e) { clearInterval(_checkRedirectInterval); }
      }, 500);
    }
  }

  // ── 16. GAME OLDALAK: ÁRAK SZINKRONIZÁLÁSA A CHECKOUT PLANS-szal ────────
  // A game/* HTML-ekben kemény-kódolt árak (1800/3600 stb.) helyett
  // a checkout-ból ismert valós árakat jelenítjük meg (2490/3990/6990 Ft)
  if (isGame) {
    var CORRECT_PRICES = {
      starter: { price: '2 490 Ft', label: 'Starter · 4 GB RAM' },
      pro:     { price: '3 990 Ft', label: 'Pro · 8 GB RAM' },
      elite:   { price: '6 990 Ft', label: 'Elite · 16 GB RAM' }
    };
    // Regex: háromjegyű vagy négyjegyű Ft árak cseréje a pricing kártyákon
    var pricePattern = /^\d[\s\d]*Ft$/;
    var pricingCards = qsa('[class*="rounded"]').filter(function(el) {
      return el.textContent.includes('Ft') && el.textContent.includes('RAM');
    });

    pricingCards.forEach(function(card, i) {
      var planKey = PLAN_ORDER[i] || 'starter';
      var correctPrice = CORRECT_PRICES[planKey];
      if (!correctPrice) return;

      // Minden szöveg-csomópontot keresünk a kártyán belül, ami Ft-ot tartalmaz
      qsa('*', card).forEach(function(el) {
        if (el.children.length > 0) return;
        var txt = el.textContent.trim();
        if (pricePattern.test(txt) && txt !== correctPrice.price) {
          // Csak ha eltér a helyes ártól
          el.textContent = correctPrice.price;
        }
        // "/mo" vagy "/hó" után is igazítás
        if (/^\d[\s\d]*Ft\s*\/\s*(mo|hó)$/.test(txt)) {
          el.textContent = correctPrice.price + '/hó';
        }
      });
    });
  }

  // ── 17. CHECKOUT.HTML QUERY PARAMS KITÖLTÉSE ────────────────────────────
  if (path.includes('checkout.html')) {
    var params = new URLSearchParams(window.location.search);
    var planParam = params.get('plan');
    var typeParam = params.get('type');
    var gameParam = params.get('game');

    // Plan selector automatikus kijelölés
    if (planParam) {
      var planMap = { starter: 'Starter', pro: 'Pro', elite: 'Elite' };
      var planLabel = planMap[planParam] || planParam;
      qsa('button, [data-plan]').forEach(function(btn) {
        if (btn.textContent.trim() === planLabel || btn.dataset.plan === planParam) {
          btn.click();
        }
      });
      // Rejtett input ha van
      var planInput = qs('#selected-plan, input[name="plan"]');
      if (planInput) planInput.value = planParam;
    }

    // Szerver típus kijelölés
    if (typeParam) {
      var typeInput = qs('#svc-type, input[name="type"]');
      if (typeInput) typeInput.value = typeParam;
      var typeMap = { game: 'game', discord: 'discord', web: 'web' };
      qsa('[data-type]').forEach(function(el) {
        if (el.dataset.type === typeParam) el.click();
      });
    }

    // Játék kijelölés
    if (gameParam) {
      var gameInput = qs('#svc-game, input[name="game"], select[name="game"]');
      if (gameInput) {
        gameInput.value = gameParam;
        gameInput.dispatchEvent(new Event('change'));
      }
    }
  }

  // ── 18. AFFILIATE: REFERRAL LINK GENERÁLÁS + MÁSOLÁS ───────────────────
  if (path.includes('affiliate.html')) {
    document.addEventListener('DOMContentLoaded', function() {
      var _sess = null;
      try { _sess = JSON.parse(localStorage.getItem('ah_session') || 'null'); } catch(e) {}
      var username = (_sess && (_sess.username || _sess.email)) ? (_sess.username || _sess.email.split('@')[0]) : null;

      function makeRefCode(u) {
        return 'aero-' + u.toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,10) || 'partner';
      }
      var refCode = username ? makeRefCode(username) : null;
      var refUrl  = refCode ? (window.location.origin + '/register.html?ref=' + refCode) : null;

      var calcSection = qsa('section').find(function(s) {
        return s.textContent.includes('Ajánlás') || s.textContent.includes('Becsült');
      });
      if (!calcSection) return;

      var widget = document.createElement('div');
      widget.id = 'aff-ref-widget';

      if (refUrl) {
        widget.style.cssText = 'margin-top:24px;padding:20px 24px;background:rgba(168,85,247,0.06);border:1px solid rgba(168,85,247,0.2);border-radius:20px;max-width:700px;margin-left:auto;margin-right:auto';
        widget.innerHTML = ''
          + '<div style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:rgba(168,85,247,0.8);margin-bottom:12px">Az egyedi referral linked</div>'
          + '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">'
          + '<div style="flex:1;min-width:0;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:11px 16px;font-family:monospace;font-size:0.85rem;color:#c084fc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" id="aff-ref-url">' + refUrl + '</div>'
          + '<button id="aff-copy-btn" style="padding:11px 20px;background:rgba(168,85,247,0.12);border:1px solid rgba(168,85,247,0.3);border-radius:12px;color:#c084fc;font-weight:700;font-size:0.85rem;cursor:pointer;font-family:inherit;white-space:nowrap;transition:background 0.2s">Link másolása</button>'
          + '</div>'
          + '<div style="margin-top:10px;font-size:0.75rem;color:rgba(107,114,128,0.7)">Kód: <span style="font-family:monospace;color:rgba(196,181,253,0.8)">' + refCode + '</span> · Minden fizető ügyfél után jutalékot kapsz.</div>';

        widget.querySelector('#aff-copy-btn').addEventListener('click', function() {
          var urlEl = document.getElementById('aff-ref-url');
          var btn   = document.getElementById('aff-copy-btn');
          navigator.clipboard.writeText(urlEl.textContent.trim()).then(function() {
            btn.textContent = '✓ Másolva!';
            btn.style.background = 'rgba(34,197,94,0.15)';
            btn.style.borderColor = 'rgba(34,197,94,0.3)';
            btn.style.color = '#4ade80';
            setTimeout(function() {
              btn.textContent = 'Link másolása';
              btn.style.background = '';
              btn.style.borderColor = '';
              btn.style.color = '';
            }, 2000);
          });
        });
      } else {
        widget.style.cssText = 'margin-top:24px;padding:20px 24px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);border-radius:20px;text-align:center;max-width:700px;margin-left:auto;margin-right:auto';
        widget.innerHTML = '<div style="font-size:0.88rem;color:rgba(156,163,175,0.8);margin-bottom:14px">Regisztrálj vagy lépj be az egyedi referral linkedhez!</div>'
          + '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">'
          + '<a href="register.html" style="padding:10px 24px;background:linear-gradient(135deg,#1d4ed8,#7c3aed);border-radius:50px;color:#fff;font-weight:700;font-size:0.88rem;text-decoration:none">Regisztrálj ingyen</a>'
          + '<a href="login.html" style="padding:10px 24px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:50px;color:#d1d5db;font-weight:600;font-size:0.88rem;text-decoration:none">Bejelentkezés</a>'
          + '</div>';
      }
      calcSection.appendChild(widget);
    });
  }

  // ── 19. FAQ ACCORDION ROBUSZTUSÍTÁS ─────────────────────────────────────
  (function() {
    if (!isGame && !path.includes('discord.html') && !path.includes('web.html')) return;
    if (document.querySelector('.faq-q')) return;

    var headings = qsa('h3, h4, [class*="text-xl"], [class*="text-lg"]').filter(function(el) {
      var t = el.textContent.trim();
      return t.endsWith('?') && t.length > 10 && t.length < 250;
    });
    if (!headings.length) return;

    if (!document.getElementById('faq-accordion-style')) {
      var s2 = document.createElement('style');
      s2.id = 'faq-accordion-style';
      s2.textContent = '.faq-q{cursor:pointer;user-select:none;display:flex;align-items:center;justify-content:space-between;padding:4px 0;transition:color 0.2s}.faq-q:hover{color:#a78bfa}.faq-q::after{content:"+";font-size:1.3rem;font-weight:300;color:#a78bfa;flex-shrink:0;margin-left:12px;transition:transform 0.3s}.faq-q.open::after{transform:rotate(45deg)}.faq-a{overflow:hidden;max-height:0;transition:max-height 0.35s ease,opacity 0.3s;opacity:0}.faq-a.open{max-height:600px;opacity:1}';
      document.head.appendChild(s2);
    }

    headings.forEach(function(h) {
      var ans = h.nextElementSibling
        || (h.parentElement && h.parentElement.nextElementSibling);
      if (!ans) return;
      h.classList.add('faq-q');
      ans.classList.add('faq-a');
      h.addEventListener('click', function() {
        var isOpen = h.classList.contains('open');
        qsa('.faq-q.open').forEach(function(q) {
          q.classList.remove('open');
          var a = q.nextElementSibling || (q.parentElement && q.parentElement.nextElementSibling);
          if (a) a.classList.remove('open');
        });
        if (!isOpen) {
          h.classList.add('open');
          ans.classList.add('open');
        }
      });
    });
  })();

  // ── 20. CHECKOUT: PUBLIKUS URL-SLUG ELŐNÉZET ────────────────────────────
  if (path.includes('checkout.html')) {
    setTimeout(function() {
      var nameEl = document.getElementById('order-name');
      if (!nameEl) return;
      var previewEl = document.createElement('div');
      previewEl.id = 'slug-preview';
      previewEl.style.cssText = 'margin-top:8px;font-size:0.72rem;color:rgba(107,114,128,0.6);font-family:monospace;display:none';
      var parent = nameEl.closest('.card') || nameEl.parentElement;
      if (parent) parent.appendChild(previewEl);

      function toSlug(s) {
        return s.toLowerCase()
          .replace(/[áàä]/g,'a').replace(/[éè]/g,'e').replace(/[íì]/g,'i')
          .replace(/[óöő]/g,'o').replace(/[úüű]/g,'u')
          .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,30) || 'szerver';
      }
      function updateSlug() {
        var raw = nameEl.firstChild && nameEl.firstChild.nodeType === 3
          ? nameEl.firstChild.textContent.trim()
          : nameEl.textContent.replace(/\s*$/, '').trim();
        if (!raw || raw === '–') { previewEl.style.display = 'none'; return; }
        previewEl.style.display = 'block';
        previewEl.textContent = '🔗 aerohost.eu/server/' + toSlug(raw);
      }
      updateSlug();
      var mo = new MutationObserver(updateSlug);
      mo.observe(nameEl, { childList: true, subtree: true, characterData: true });
    }, 700);
  }

  // ── 21. LOGIN: "EMLÉKEZZ RÁM" FLAG ELKÜLDÉSE ────────────────────────────
  if (path.includes('login.html')) {
    var _origFetch = window.fetch;
    window.fetch = function(url, opts) {
      if (typeof url === 'string' && url.includes('/api/login') && opts && opts.body) {
        try {
          var body = JSON.parse(opts.body);
          var rememberEl = document.getElementById('remember');
          body.remember = !!(rememberEl && rememberEl.checked);
          opts.body = JSON.stringify(body);
        } catch(e) {}
      }
      return _origFetch.apply(this, arguments);
    };
  }

  // ── 22. REGISTER: GYENGE JELSZÓ BLOKKOLJA A SUBMIT-OT ──────────────────
  if (path.includes('register.html')) {
    document.addEventListener('DOMContentLoaded', function() {
      var form = document.getElementById('registerForm');
      var pwEl = document.getElementById('password');
      if (!form || !pwEl) return;

      var weakWarn = document.createElement('div');
      weakWarn.style.cssText = 'display:none;font-size:0.75rem;color:#f97316;margin-top:4px;padding-left:2px';
      weakWarn.textContent = 'A jelszó túl gyenge — adj hozzá nagybetűt, számot vagy speciális karaktert.';
      var strengthEl = document.getElementById('strengthFill');
      if (strengthEl) strengthEl.closest('div').parentElement.appendChild(weakWarn);

      function getScore(val) {
        var score = 0;
        if (val.length >= 8) score++;
        if (val.length >= 12) score++;
        if (/[A-Z]/.test(val)) score++;
        if (/[0-9]/.test(val)) score++;
        if (/[^A-Za-z0-9]/.test(val)) score++;
        return score;
      }

      form.addEventListener('submit', function(e) {
        if (getScore(pwEl.value) < 2) {
          e.preventDefault();
          e.stopImmediatePropagation();
          weakWarn.style.display = 'block';
          pwEl.style.borderColor = 'rgba(249,115,22,0.6)';
          pwEl.focus();
        } else {
          weakWarn.style.display = 'none';
          pwEl.style.borderColor = '';
        }
      }, true);

      pwEl.addEventListener('input', function() {
        if (getScore(pwEl.value) >= 2) { weakWarn.style.display = 'none'; pwEl.style.borderColor = ''; }
      });
    });
  }

  // ── 23. ABOUT: CSAPATTAGOK SOCIAL LINKEK ────────────────────────────────
  if (path.includes('about.html')) {
    document.addEventListener('DOMContentLoaded', function() {
      var TEAM_LINKS = {
        'haider': { github: 'https://github.com/Just-Haider' }
      };
      qsa('h3, h4, [class*="font-bold"]').forEach(function(el) {
        var name = el.textContent.trim().toLowerCase().replace(/\s+/g,'');
        var found = null;
        for (var key in TEAM_LINKS) {
          if (name.includes(key)) { found = TEAM_LINKS[key]; break; }
        }
        if (!found) return;
        qsa('a', el.parentElement).forEach(function(a) {
          var href = a.getAttribute('href') || '';
          var inner = (a.innerHTML + a.textContent).toLowerCase();
          if (href === '#' || href === '') {
            if (inner.includes('github') && found.github) {
              a.href = found.github; a.target = '_blank'; a.rel = 'noopener noreferrer';
            } else if ((inner.includes('twitter') || inner.includes('x.com')) && found.twitter) {
              a.href = found.twitter; a.target = '_blank'; a.rel = 'noopener noreferrer';
            } else if (inner.includes('linkedin') && found.linkedin) {
              a.href = found.linkedin; a.target = '_blank'; a.rel = 'noopener noreferrer';
            }
          }
        });
      });
    });
  }

  // ── 24. MOBIL NAV: /games/*.html OLDALON A "JÁTÉKOK" AKTÍV ──────────────
  if (isGame) {
    document.addEventListener('DOMContentLoaded', function() {
      var menuBtn = qs('nav button[aria-label="Open menu"]');
      if (!menuBtn) return;
      menuBtn.addEventListener('click', function() {
        setTimeout(function() {
          var mob = document.querySelector('body > div[style*="position:fixed"][style*="top:76px"]');
          if (!mob) return;
          qsa('a', mob).forEach(function(a) {
            var href = a.getAttribute('href') || '';
            if (href.includes('games.html') || a.textContent.trim() === 'Játékok') {
              a.style.background = 'rgba(168,85,247,0.1)';
              a.style.color = '#c084fc';
              a.style.fontWeight = '700';
            }
          });
        }, 60);
      }, true);
    });
  }

  // ── 25. DASHBOARD: LOADPUBLICSERVERS + KÁRTYÁK ──────────────────────────
  if (path.includes('dashboard.html')) {
    window.loadPublicServers = window.loadPublicServers || function(game) {
      var grid = document.getElementById('public-servers-list');
      if (!grid) return;
      grid.innerHTML = '<div style="grid-column:1/-1;padding:40px;text-align:center;color:rgba(107,114,128,0.5);font-size:0.85rem">Betöltés...</div>';

      var url = '/api/public/servers' + (game ? '?game=' + encodeURIComponent(game) : '');
      var tok = localStorage.getItem('ah_token');
      fetch(url, tok ? { headers: { 'Authorization': 'Bearer ' + tok } } : {})
        .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
        .then(function(servers) {
          if (!servers || !servers.length) {
            grid.innerHTML = '<div style="grid-column:1/-1;padding:60px;text-align:center;color:rgba(107,114,128,0.5);font-size:0.88rem">Még nincs nyilvánosan megosztott szerver.</div>';
            return;
          }
          var IMGS = { minecraft:'games/minecraft-bg.jpg', rust:'games/rust-bg.jpg', cs2:'games/cs2-bg.jpg', palworld:'games/palworld-bg.jpg', valheim:'games/valheim-bg.jpg', ark:'games/ark-bg.jpg', satisfactory:'games/satisfactory-bg.jpg', 'project-zomboid':'games/zomboid-bg.jpg' };
          var LBL  = { minecraft:'Minecraft', rust:'Rust', cs2:'CS2', palworld:'Palworld', valheim:'Valheim', ark:'ARK', satisfactory:'Satisfactory', 'project-zomboid':'Project Zomboid' };
          grid.innerHTML = servers.map(function(s) {
            var img  = IMGS[s.game] || 'Backgrounds/game-bg.png';
            var tags = s.tags ? s.tags.split(',').map(function(t){ return '<span style="padding:2px 8px;background:rgba(168,85,247,0.08);border:1px solid rgba(168,85,247,0.18);border-radius:6px;font-size:0.7rem;color:#c084fc">'+t.trim()+'</span>'; }).join('') : '';
            var ip   = s.showIp && s.ip ? '<div style="margin-top:8px;font-family:monospace;font-size:0.78rem;color:rgba(156,163,175,0.7);cursor:pointer" onclick="navigator.clipboard&&navigator.clipboard.writeText(\''+s.ip+'\')" title="Kattints az IP másolásához">'+s.ip+'</div>' : '';
            return '<div class="card card-hover" style="overflow:hidden;cursor:pointer" onclick="window.open(\'server.html#'+(s.slug||'')+'\',\'_blank\')">'
              + '<div style="height:90px;overflow:hidden;position:relative"><img src="'+img+'" style="width:100%;height:100%;object-fit:cover"><div style="position:absolute;inset:0;background:linear-gradient(to bottom,transparent 30%,rgba(0,0,0,0.8))"></div>'
              + '<span style="position:absolute;top:8px;right:8px;padding:2px 8px;border-radius:99px;background:rgba(34,197,94,0.15);border:1px solid rgba(34,197,94,0.25);color:#4ade80;font-size:0.65rem;font-weight:700">'+(LBL[s.game]||s.game||'Szerver')+'</span></div>'
              + '<div style="padding:14px">'
              + '<div style="font-size:0.95rem;font-weight:700;color:#fff;margin-bottom:3px">'+(s.title||s.name||'Szerver')+'</div>'
              + (s.description ? '<div style="font-size:0.78rem;color:rgba(107,114,128,0.8);margin-bottom:8px;line-height:1.4">'+s.description+'</div>' : '')
              + (tags ? '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px">'+tags+'</div>' : '')
              + ip + '</div></div>';
          }).join('');
        })
        .catch(function() {
          grid.innerHTML = '<div style="grid-column:1/-1;padding:40px;text-align:center;color:rgba(107,114,128,0.5);font-size:0.85rem">Nem sikerült betölteni.<br><span style="font-size:0.75rem;opacity:0.6">Ellenőrizd hogy fut-e a backend.</span></div>';
        });
    };

    window.filterPublicServers = window.filterPublicServers || function(btn, game) {
      document.querySelectorAll('#page-servers-public .tab').forEach(function(t) { t.classList.remove('active'); });
      btn.classList.add('active');
      window.loadPublicServers(game);
    };
  }

})();

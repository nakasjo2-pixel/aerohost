// AeroHost – animációk és interaktivitás
document.addEventListener('DOMContentLoaded', function () {

  // ── Discord valós online szám betöltése ─────────────────────────
  var DC_GUILD = '1355087978033504259'; // AeroHost Discord szerver ID
  // Discord widget API – public, nem kell auth
  fetch('https://discord.com/api/guilds/' + DC_GUILD + '/widget.json')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var count = data.presence_count || 0;
      var text  = count > 0 ? count + '+ Online Tag' : 'Discord Szerver';
      // Footer CTA badge minden oldalon
      document.querySelectorAll('#dc-online-count').forEach(function(el) {
        el.textContent = text;
      });
      // Játék oldalakon kis widget
      document.querySelectorAll('.dc-online-small').forEach(function(el) {
        el.textContent = count > 0 ? count : '';
      });
    })
    .catch(function() {
      // Ha az API nem elérhető, csendben marad
      document.querySelectorAll('#dc-online-count').forEach(function(el) {
        el.textContent = 'Discord Szerver';
      });
    });

  // ── Navbar slide-in ──────────────────────────────────────────────
  var nav = document.querySelector('nav');
  if (nav) {
    nav.style.opacity = '0';
    nav.style.transform = 'translateY(-20px)';
    nav.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
    setTimeout(function () {
      nav.style.opacity = '1';
      nav.style.transform = 'translateY(0)';
    }, 100);
  }

  // ── Nav linkek egyenként ─────────────────────────────────────────
  document.querySelectorAll('nav .space-x-1 > div').forEach(function (el, i) {
    el.style.opacity = '0';
    el.style.transform = 'translateY(-10px)';
    el.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
    setTimeout(function () {
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
    }, 300 + i * 80);
  });

  // ── Scroll: nav feljebb csúszik ──────────────────────────────────
  window.addEventListener('scroll', function () {
    if (!nav) return;
    nav.style.top = window.scrollY > 40 ? '8px' : '20px';
  });


  // ── Typewriter ───────────────────────────────────────────────────
  var tw = document.querySelector('.Typewriter');
  if (tw) {
    var words = ['Korlátlan.', 'Villámgyors.', 'Megbízható.', 'Skálázható.'];
    var wi = 0, ci = 0, del = false;

    var textSpan = document.createElement('span');
    textSpan.className = 'Typewriter__wrapper';
    var cursorSpan = document.createElement('span');
    cursorSpan.className = 'Typewriter__cursor';
    cursorSpan.textContent = '|';
    tw.appendChild(textSpan);
    tw.appendChild(cursorSpan);

    if (!document.getElementById('tw-cursor-style')) {
      var s = document.createElement('style');
      s.id = 'tw-cursor-style';
      s.textContent = '.Typewriter__cursor{animation:tw-blink 0.8s step-start infinite}'
        + '@keyframes tw-blink{0%,100%{opacity:1}50%{opacity:0}}';
      document.head.appendChild(s);
    }

    function tick() {
      var w = words[wi];
      if (del) {
        textSpan.textContent = w.substring(0, --ci);
        if (ci === 0) { del = false; wi = (wi + 1) % words.length; }
        setTimeout(tick, ci === 0 ? 350 : 45);
      } else {
        textSpan.textContent = w.substring(0, ++ci);
        if (ci === w.length) { del = true; setTimeout(tick, 1800); }
        else setTimeout(tick, 75);
      }
    }
    setTimeout(tick, 600);
  }

  // ── Affiliate kalkulátor ─────────────────────────────────────────
  var slider = document.querySelector('input[type="range"]');
  if (slider) {
    var calcRoot    = slider.closest('.space-y-12');
    var refCountEl  = calcRoot ? calcRoot.querySelector('.tabular-nums') : null;
    // Fix: use direct child selector (>) to get the badge span, not the inner percentage span
    var statusBadge = calcRoot ? calcRoot.querySelector('.rounded-2xl > span:last-child') : null;
    // Find the monthly payout span: text-6xl inside the payout card (not the hero h1)
    var monthlyEl = null;
    document.querySelectorAll('.text-6xl').forEach(function(el) {
      if (el.closest('h1') === null) { monthlyEl = el; }
    });
    // Find yearly and per-user spans: text-2xl inside the 2-col grid that's a sibling of the payout card
    var yearlyEl = null, perUserEl = null;
    if (monthlyEl) {
      var payoutCard = monthlyEl.closest('.p-10');
      var sibling = payoutCard ? payoutCard.nextElementSibling : null;
      if (sibling) {
        var spans = sibling.querySelectorAll('.text-2xl');
        if (spans[0]) yearlyEl  = spans[0];
        if (spans[1]) perUserEl = spans[1];
      }
    }

    function update() {
      var r    = parseInt(slider.value, 10);
      var rate = r <= 10 ? 0.10 : r <= 50 ? 0.15 : r <= 200 ? 0.20 : 0.30;
      var avg  = 3600; // átlagos HUF megrendelési érték
      var monthly  = Math.round(r * avg * rate);
      var yearly   = Math.round(monthly * 12);
      var perUser  = Math.round(avg * rate);

      function fmt(n) { return n.toLocaleString('hu-HU') + ' Ft'; }

      if (refCountEl)  refCountEl.textContent = r;
      if (monthlyEl)   monthlyEl.textContent  = fmt(monthly);
      if (yearlyEl)    yearlyEl.textContent   = fmt(yearly);
      if (perUserEl)   perUserEl.textContent  = fmt(perUser);

      var tiers = [
        { max: 10,  label: 'Ezüst',   pct: 10, cls: 'text-blue-400 border-blue-500/30 bg-blue-500/10' },
        { max: 50,  label: 'Arany',   pct: 15, cls: 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10' },
        { max: 200, label: 'Platina', pct: 20, cls: 'text-purple-400 border-purple-500/30 bg-purple-500/10' },
        { max: 500, label: 'Gyémánt', pct: 30, cls: 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10' },
      ];
      var tier = tiers.find(function(t) { return r <= t.max; }) || tiers[3];
      if (statusBadge) {
        statusBadge.className = 'px-4 py-1.5 rounded-lg text-sm font-bold border transition-colors duration-500 ' + tier.cls;
        statusBadge.innerHTML = tier.label + ' <span class="opacity-70 ml-2">(' + tier.pct + '%)</span>';
      }
    }

    slider.addEventListener('input', update);
    update();
  }

  // ── Scroll-reveal animáció – minden oldalon ──────────────────────
  // 1. Elemek amik már opacity:0-val vannak a HTML-ben (játék oldalak spec kártyák, stb.)
  // 2. Frissen kijelölt elemek amiket JS-ből inicializálunk (section tartalmak, kártyák, heading-ek)

  var REVEAL_SELECTORS = [
    // Főbb szekciók tartalma
    'main section h1',
    'main section h2',
    'main section h3',
    'main section > div > p',
    // Kártyák és grid elemek
    'main .rounded-3xl',
    'main .rounded-2xl:not(nav *)',
    'main .rounded-xl:not(nav *):not(button)',
    // Feature listák, stat boxok
    'main .grid > div',
    'main .flex.flex-col > div:not(nav *)',
    // Gombok a hero szekcióban
    'main section .flex.gap-4 > *',
    'main section .flex.gap-5 > *',
    'main section .flex.gap-6 > *',
  ];

  // Kizárások: nav, footer, már animált elemek gyermekei
  function isExcluded(el) {
    return (
      el.closest('nav') ||
      el.closest('footer') ||
      el.closest('[data-revealed]') ||
      el.tagName === 'SCRIPT' ||
      el.tagName === 'STYLE'
    );
  }

  var revealSet = new Set();

  // Hozzáadjuk a már inline opacity:0-s elemeket
  document.querySelectorAll('[style*="opacity:0"]').forEach(function (el) {
    if (!isExcluded(el)) revealSet.add(el);
  });

  // Hozzáadjuk a selectorok alapján kijelölt elemeket
  REVEAL_SELECTORS.forEach(function (sel) {
    try {
      document.querySelectorAll(sel).forEach(function (el) {
        if (!isExcluded(el) && !revealSet.has(el)) {
          // Csak akkor adjuk hozzá, ha még látható (opacity nem 0)
          var computed = window.getComputedStyle(el);
          if (computed.opacity !== '0') {
            el.style.opacity = '0';
            el.style.transform = 'translateY(18px)';
          }
          revealSet.add(el);
        }
      });
    } catch(e) {}
  });

  // IntersectionObserver – staggerelt reveal a testvér elemekhez
  var revealIO = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      var el = entry.target;

      // Stagger: ha a szülőn belül több testvér is vár, sorrend alapján késlelteti
      var siblings = el.parentElement
        ? Array.from(el.parentElement.children).filter(function (c) {
            return revealSet.has(c);
          })
        : [];
      var idx = siblings.indexOf(el);
      var delay = Math.min(idx * 80, 400); // max 400ms stagger

      setTimeout(function () {
        el.style.transition = 'opacity 0.55s ease, transform 0.55s ease';
        el.style.opacity    = '1';
        el.style.transform  = 'translateY(0)';
        el.setAttribute('data-revealed', '1');
      }, delay);

      revealIO.unobserve(el);
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

  revealSet.forEach(function (el) { revealIO.observe(el); });

  // ── Mobil menü ───────────────────────────────────────────────────
  var menuBtn = document.querySelector('nav button[aria-label="Open menu"]');
  if (menuBtn) {
    var mob = null;

    function closeMob() { if (mob) { mob.remove(); mob = null; } }

    menuBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (mob) { closeMob(); return; }

      mob = document.createElement('div');
      mob.style.cssText = 'position:fixed;top:76px;left:2.5%;right:2.5%;'
        + 'background:rgba(5,5,5,0.97);border:1px solid rgba(255,255,255,0.12);'
        + 'border-radius:16px;padding:12px;z-index:9999;'
        + 'display:flex;flex-direction:column;gap:4px;'
        + 'backdrop-filter:blur(24px);animation:mobIn 0.2s ease';

      if (!document.getElementById('mob-style')) {
        var ms = document.createElement('style');
        ms.id = 'mob-style';
        ms.textContent = '@keyframes mobIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}';
        document.head.appendChild(ms);
      }

      [
        ['Főoldal', 'index.html'],
        ['Játékok', 'games.html'],
        ['Discord Hosting', 'discord.html'],
        ['Webtárhely', 'web.html'],
        ['Rólunk', 'about.html'],
        ['Partner Program', 'affiliate.html'],
      ].forEach(function (item) {
        var a = document.createElement('a');
        a.textContent = item[0];
        a.href = item[1];
        a.style.cssText = 'display:block;color:#d1d5db;padding:11px 16px;border-radius:10px;'
          + 'font-size:15px;font-weight:500;text-decoration:none;transition:background 0.15s,color 0.15s;';
        a.addEventListener('mouseenter', function () { this.style.background = 'rgba(255,255,255,0.08)'; this.style.color = '#fff'; });
        a.addEventListener('mouseleave', function () { this.style.background = ''; this.style.color = '#d1d5db'; });
        mob.appendChild(a);
      });

      document.body.appendChild(mob);
    });

    document.addEventListener('click', function (e) {
      if (mob && !menuBtn.contains(e.target) && !mob.contains(e.target)) closeMob();
    });
  }

});

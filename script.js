/* ============================================================
   vivian yu — site behaviour
   vanilla js, no dependencies, no build step.
   ============================================================ */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  /* ---------------------------------------------------------
     0 · tiny helpers
     --------------------------------------------------------- */
  function $(sel, ctx) { return (ctx || doc).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); }
  function rand(min, max) { return Math.random() * (max - min) + min; }


  /* ---------------------------------------------------------
     1 · footer year
     --------------------------------------------------------- */
  var yearEl = $('#year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();


  /* ---------------------------------------------------------
     2 · starfield
     --------------------------------------------------------- */
  (function stars() {
    var host = $('#stars');
    if (!host) return;

    var count = window.innerWidth < 700 ? 55 : 110;
    var frag = doc.createDocumentFragment();

    for (var i = 0; i < count; i++) {
      var s = doc.createElement('span');
      var size = rand(1.2, 3.1);
      s.className = 'star';
      s.style.left = rand(0, 100).toFixed(2) + '%';
      // bias toward the upper sky, where stars actually live
      s.style.top = (Math.pow(Math.random(), 1.55) * 100).toFixed(2) + '%';
      s.style.width = size.toFixed(2) + 'px';
      s.style.height = size.toFixed(2) + 'px';
      s.style.setProperty('--dur', rand(2.6, 6.4).toFixed(2) + 's');
      s.style.setProperty('--delay', rand(0, 5).toFixed(2) + 's');
      s.style.opacity = rand(0.45, 1).toFixed(2);
      frag.appendChild(s);
    }
    host.appendChild(frag);
  }());


  /* ---------------------------------------------------------
     3 · day / night sky
     --------------------------------------------------------- */
  (function sky() {
    var btn = $('#daynight');
    var KEY = 'vy-sky';
    var saved = null;

    try { saved = localStorage.getItem(KEY); } catch (e) { /* private mode */ }

    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var mode = saved || (prefersDark ? 'night' : 'day');
    apply(mode);

    function apply(next) {
      root.setAttribute('data-sky', next);
      if (!btn) return;
      var night = next === 'night';
      btn.setAttribute('aria-pressed', night ? 'true' : 'false');
      btn.setAttribute('aria-label', night ? 'Switch to daytime sky' : 'Switch to night sky');
      var meta = $('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', night ? '#0b1730' : '#dceaf7');
    }

    if (!btn) return;
    btn.addEventListener('click', function () {
      var next = root.getAttribute('data-sky') === 'night' ? 'day' : 'night';
      apply(next);
      try { localStorage.setItem(KEY, next); } catch (e) { /* ignore */ }
      burst(btn, next === 'night' ? '#cfe0f5' : '#f2d79c');
      toast(next === 'night' ? 'good night ✦' : 'good morning ☀');
    });
  }());


  /* ---------------------------------------------------------
     3.5 · typewriter titles
     split the heading text into characters so CSS can deal
     them out one at a time. The <svg> underline is left alone.
     --------------------------------------------------------- */
  (function typewriter() {
    $$('.spread__title').forEach(function (h) {
      var node = null, i;
      for (i = 0; i < h.childNodes.length; i++) {
        if (h.childNodes[i].nodeType === 3 && h.childNodes[i].nodeValue.trim()) {
          node = h.childNodes[i];
          break;
        }
      }
      if (!node) return;

      var text = node.nodeValue.trim();
      h.setAttribute('aria-label', text);          // keep it one word to a screen reader

      var wrap = doc.createElement('span');
      wrap.className = 'tw';
      wrap.setAttribute('aria-hidden', 'true');

      for (i = 0; i < text.length; i++) {
        var c = doc.createElement('span');
        c.className = 'tw__c';
        c.textContent = text.charAt(i);
        c.style.setProperty('--i', i);
        wrap.appendChild(c);
      }

      var caret = doc.createElement('span');
      caret.className = 'tw__caret';
      wrap.appendChild(caret);

      wrap.dataset.ms = (text.length * 52) + 900;  // when to retire the caret
      node.parentNode.replaceChild(wrap, node);
    });
  }());


  /* ---------------------------------------------------------
     4 · reveal on scroll (with per-group stagger)
     --------------------------------------------------------- */
  (function reveals() {
    var items = $$('.reveal');
    if (!items.length) return;

    if (reduced || !('IntersectionObserver' in window)) {
      items.forEach(function (el) { el.classList.add('is-in'); });
      return;
    }

    // stagger siblings inside the same grid so cards deal out like cards
    $$('.grid').forEach(function (grid) {
      $$('.reveal', grid).forEach(function (el, i) {
        el.style.setProperty('--d', (i * 90) + 'ms');
      });
    });

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);

        var tw = entry.target.querySelector('.tw');
        if (tw) {
          setTimeout(function () { tw.classList.add('tw--done'); },
                     parseInt(tw.dataset.ms, 10) || 1200);
        }
      });
    }, { rootMargin: '0px 0px -9% 0px', threshold: 0.08 });

    items.forEach(function (el) { io.observe(el); });
  }());


  /* ---------------------------------------------------------
     5 · scroll: progress ribbon, cloud parallax, nav scrollspy
     --------------------------------------------------------- */
  (function onScroll() {
    var fill = $('#ribbonFill');
    var clouds = $$('.cloud');
    var tabs = $$('.tab');
    var sections = tabs
      .map(function (t) { return doc.querySelector(t.getAttribute('href')); })
      .filter(Boolean);

    var ticking = false;

    function frame() {
      ticking = false;
      var y = window.pageYOffset || root.scrollTop;
      var max = doc.documentElement.scrollHeight - window.innerHeight;

      if (fill) fill.style.width = (max > 0 ? Math.min(100, (y / max) * 100) : 0).toFixed(2) + '%';

      if (!reduced) {
        for (var i = 0; i < clouds.length; i++) {
          var depth = parseFloat(clouds[i].getAttribute('data-depth')) || 0.1;
          clouds[i].style.transform = 'translate3d(0,' + (-y * depth).toFixed(1) + 'px,0)';
        }
      }

      // scrollspy — the section whose top has most recently passed the tab bar
      var current = null;
      var line = y + 140;
      for (var j = 0; j < sections.length; j++) {
        if (sections[j].offsetTop <= line) current = sections[j];
      }
      // near the very bottom, always light the last tab
      if (max - y < 60 && sections.length) current = sections[sections.length - 1];

      for (var k = 0; k < tabs.length; k++) {
        var on = current && tabs[k].getAttribute('href') === '#' + current.id;
        tabs[k].classList.toggle('is-active', !!on);
        if (on) tabs[k].setAttribute('aria-current', 'true');
        else tabs[k].removeAttribute('aria-current');
      }
    }

    function request() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(frame);
    }

    window.addEventListener('scroll', request, { passive: true });
    window.addEventListener('resize', request);
    frame();
  }());


  /* ---------------------------------------------------------
     6 · clickable bullet-journal checkboxes
     --------------------------------------------------------- */
  $$('.bujo[data-checkable] li').forEach(function (li) {
    li.setAttribute('role', 'button');
    li.setAttribute('tabindex', '0');
    li.setAttribute('aria-pressed', 'false');

    function toggle(e) {
      // a link inside a bullet should just follow the link
      if (e && e.target && e.target.closest && e.target.closest('a')) return;
      var done = li.classList.toggle('is-done');
      li.setAttribute('aria-pressed', done ? 'true' : 'false');
      if (done) burst(li, 'var(--blue)');
    }

    li.addEventListener('click', toggle);
    li.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
  });


  /* ---------------------------------------------------------
     7 · expandable game-score entries
     --------------------------------------------------------- */
  $$('[data-expand]').forEach(function (box) {
    var head = $('.score__top', box);
    if (!head) return;
    head.addEventListener('click', function () {
      var open = box.classList.toggle('is-open');
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  });


  /* ---------------------------------------------------------
     7.5 · demo audio player
     Files live in assets/audio/ and are served as plain static
     files, so this works unchanged on GitHub Pages. Nothing is
     fetched until a play button is actually pressed.
     --------------------------------------------------------- */
  (function demoPlayer() {
    var rows = $$('.demo');
    if (!rows.length) return;

    var players = [];     // one entry per row: {row, btn, fill, audio}
    var current = null;

    function stop(entry) {
      if (!entry || !entry.audio) return;
      entry.audio.pause();
      entry.row.classList.remove('is-playing');
      entry.row.classList.add('is-paused');
    }

    function load(entry) {
      var audio = new Audio();
      audio.preload = 'none';
      audio.src = entry.btn.getAttribute('data-src');

      audio.addEventListener('timeupdate', function () {
        if (!audio.duration) return;
        entry.fill.style.width = ((audio.currentTime / audio.duration) * 100).toFixed(2) + '%';
      });
      audio.addEventListener('ended', function () {
        entry.row.classList.remove('is-playing', 'is-paused');
        entry.fill.style.width = '0%';
        if (current === entry) current = null;
      });
      // no file uploaded yet, or a bad path: say so rather than failing silently
      audio.addEventListener('error', function () {
        entry.row.classList.add('is-missing');
        entry.row.classList.remove('is-playing', 'is-paused');
        entry.btn.setAttribute('aria-disabled', 'true');
        entry.btn.title = 'audio coming soon';
        if (current === entry) current = null;
      });

      entry.audio = audio;
      return audio;
    }

    rows.forEach(function (row) {
      var entry = { row: row, btn: $('.demo__play', row), fill: $('.demo__bar i', row), audio: null };
      players.push(entry);

      entry.btn.addEventListener('click', function () {
        if (row.classList.contains('is-missing')) return;
        if (!entry.audio) load(entry);

        if (row.classList.contains('is-playing')) {   // toggle off
          stop(entry);
          current = null;
          return;
        }

        if (current && current !== entry) stop(current);   // only one at a time

        var started = entry.audio.play();
        if (started && started.catch) {
          started.catch(function () { row.classList.add('is-missing'); });
        }
        row.classList.add('is-playing');
        row.classList.remove('is-paused');
        current = entry;
      });
    });
  }());


  /* ---------------------------------------------------------
     8 · copy email
     --------------------------------------------------------- */
  (function copyMail() {
    var btn = $('#copyMail');
    if (!btn) return;

    btn.addEventListener('click', function () {
      var mail = btn.getAttribute('data-mail');

      function done() {
        btn.classList.add('is-copied');
        burst(btn, 'var(--blush)');
        toast('copied ' + mail);
        setTimeout(function () { btn.classList.remove('is-copied'); }, 2400);
      }

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(mail).then(done, fallback);
      } else {
        fallback();
      }

      function fallback() {
        var ta = doc.createElement('textarea');
        ta.value = mail;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
        doc.body.appendChild(ta);
        ta.select();
        try { doc.execCommand('copy'); done(); }
        catch (e) { window.location.href = 'mailto:' + mail; }
        doc.body.removeChild(ta);
      }
    });
  }());


  /* ---------------------------------------------------------
     9 · back to top
     --------------------------------------------------------- */
  var totop = $('#totop');
  if (totop) {
    totop.addEventListener('click', function () {
      flutter(-1);
      window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    });
  }


  /* ---------------------------------------------------------
     9.5 · loose pages fluttering by on the way to a section
     --------------------------------------------------------- */
  function flutter(dir) {
    if (reduced) return;
    var down = dir >= 0;

    for (var i = 0; i < 7; i++) {
      var p = doc.createElement('span');
      var w = rand(24, 46);
      p.className = 'pagefly';
      p.style.width = w.toFixed(0) + 'px';
      p.style.left = rand(3, 90).toFixed(1) + 'vw';
      p.style.top = down ? (-w * 1.4).toFixed(0) + 'px' : '100vh';
      p.style.setProperty('--dir', down ? 1 : -1);
      p.style.setProperty('--dur', rand(0.78, 1.2).toFixed(2) + 's');
      p.style.setProperty('--delay', (i * 42) + 'ms');
      p.style.setProperty('--rot', rand(-45, 45).toFixed(0) + 'deg');
      p.style.setProperty('--drift', rand(-80, 80).toFixed(0) + 'px');
      doc.body.appendChild(p);
      window.setTimeout(function (el) {
        return function () { el.remove(); };
      }(p), 1600);
    }
  }

  // any in-page jump gets the flutter; the browser still does the smooth scroll
  doc.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
    var id = a.getAttribute('href');
    if (id.length < 2) return;
    var target = doc.querySelector(id);
    if (!target) return;

    var here = window.pageYOffset || root.scrollTop;
    var there = target.getBoundingClientRect().top + here;
    if (Math.abs(there - here) < 80) return;   // already there, skip it
    flutter(there > here ? 1 : -1);
  });


  /* ---------------------------------------------------------
     10 · gentle card tilt (fine pointers only)
     --------------------------------------------------------- */
  if (finePointer && !reduced) {
    $$('[data-tilt]').forEach(function (el) {
      var base = getComputedStyle(el).getPropertyValue('--tilt') || '0deg';

      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width - 0.5;
        var py = (e.clientY - r.top) / r.height - 0.5;
        el.style.transform =
          'rotate(' + base + ') perspective(760px) rotateY(' + (px * 6).toFixed(2) +
          'deg) rotateX(' + (-py * 6).toFixed(2) + 'deg) translateY(-4px)';
      });

      el.addEventListener('pointerleave', function () {
        el.style.transform = '';
      });
    });
  }


  /* ---------------------------------------------------------
     11 · sparkle trail + click bursts
     --------------------------------------------------------- */
  function spark(x, y, color) {
    var s = doc.createElement('span');
    s.className = 'spark';
    s.style.left = x + 'px';
    s.style.top = y + 'px';
    s.style.background = color || 'var(--blush)';
    s.style.setProperty('--dx', rand(-22, 22).toFixed(1) + 'px');
    s.style.setProperty('--dy', rand(-26, 24).toFixed(1) + 'px');
    s.style.width = s.style.height = rand(6, 12).toFixed(1) + 'px';
    doc.body.appendChild(s);
    setTimeout(function () { s.remove(); }, 820);
  }

  function burst(el, color) {
    if (reduced) return;
    var r = el.getBoundingClientRect();
    var cx = r.left + r.width / 2;
    var cy = r.top + r.height / 2;
    for (var i = 0; i < 8; i++) {
      spark(cx + rand(-r.width / 3, r.width / 3), cy + rand(-14, 14), color);
    }
  }

  if (finePointer && !reduced) {
    var last = 0;
    doc.addEventListener('pointermove', function (e) {
      var now = Date.now();
      if (now - last < 110) return;          // keep the trail sparse and cheap
      last = now;
      if (Math.random() > 0.55) spark(e.clientX, e.clientY, 'var(--blue-soft)');
    }, { passive: true });
  }


  /* ---------------------------------------------------------
     12 · toast
     --------------------------------------------------------- */
  var toastEl = $('#toast');
  var toastTimer;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('is-on'); }, 2200);
  }

}());

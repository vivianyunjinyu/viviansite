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
     3 · typewriter titles
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
     3.5 · book: page-flip engine
     Every top-level section is a ".leaf" absolutely stacked in
     "#bookStage". Only one leaf is ever the current page; the
     rest sit turned (rotateY(-180deg), already-read) or waiting
     (rotateY(0deg), not yet reached). Flipping is driven by
     corner drag, swipe, arrow keys, prev/next buttons, and the
     existing tab bar / in-page anchor links (intercepted rather
     than left to native scroll-to-anchor).

     If #bookStage isn't in the DOM this quietly does nothing,
     and the page renders as a normal scrolling document.
     --------------------------------------------------------- */
  (function book() {
    var stage = $('#bookStage');
    if (!stage) return;

    var leaves = $$('.leaf', stage);
    var total = leaves.length;
    if (!total) return;

    root.classList.add('book-active');

    var HASH_TO_LEAF = { top: 0, about: 1, research: 2, projects: 3, music: 4, music2: 5, contact: 6, crochetH: 7 };
    var LEAF_HASH     = ['#top', '#about', '#research', '#projects', '#music', '#music2', '#contact', '#crochetH'];
    var TIME_FOR_LEAF = ['day', 'day', 'midday', 'midday', 'dusk', 'dusk', 'night', 'night'];
    var THEME_COLOR   = ['#dceaf7', '#dceaf7', '#bfe3f7', '#bfe3f7', '#f4b483', '#f4b483', '#0b1730', '#0b1730'];
    var CONTACT_LEAF  = 6;

    function initialLeaf() {
      var h = (location.hash || '').replace('#', '');
      return HASH_TO_LEAF.hasOwnProperty(h) ? HASH_TO_LEAF[h] : 0;
    }

    // `current` is the ONLY source of truth for which page the book is on.
    // It's committed synchronously the instant a navigation is decided
    // (goTo/flipToCover/dragEnd), never deferred to a transitionend or
    // timeout. Everything downstream of that (the 3D rotation, z-index
    // shuffling) is purely presentational: it can be interrupted, abandoned
    // mid-flight, or skipped entirely (reduced motion) without ever leaving
    // bookkeeping out of sync with what the user actually asked for.
    var current = Math.max(0, Math.min(total - 1, initialLeaf()));

    var ribbonFill = $('#ribbonFill');
    var tabs = $$('.tab');
    var pagePrev = $('#pagePrev'), pageNext = $('#pageNext'), pageNo = $('#pageNo');
    var resumeIframe = $('.resume__pdf');
    // hidden by default; prepare() reveals it once, permanently, the first
    // time the book reaches contact (see the "load early, keep loaded" latch)
    if (resumeIframe) resumeIframe.style.visibility = 'hidden';

    var FLIP_MS = 650;     // one page turn — the ONLY flip duration; near or far, it's one turn

    // Fraction of the turn at which the turning leaf crosses 90deg. Past that
    // angle its backface is toward us (backface-visibility:hidden), so the
    // page behind it is fully uncovered — that's the moment the destination
    // becomes visible, and therefore the moment its pop-up must start.
    //
    // Derived from --ease-flip, cubic-bezier(.45,.05,.25,1): solving for the
    // input time where the curve's output reaches 0.5 gives 0.38. If that
    // curve is ever retuned, RECOMPUTE this — the old --ease was so
    // front-loaded it crossed 90deg at 0.136, which is how the pop-up ended
    // up firing a full second after the page had visually arrived.
    var POP_AT = 0.38;

    // .leaf's CSS transition has three legs: transform (rewritten inline on
    // every flip, since duration/easing/delay vary per leaf per turn) and
    // background-color/border-color (never touched by JS, so a leaf's palette
    // always eases over .8s regardless of how fast it's turning). Writing
    // transitionDuration on its own would apply to all three and drag the
    // colour change along with the flip, so every site that used to poke
    // transitionDuration/Delay/TimingFunction goes through here instead.
    var PALETTE_LEGS = 'background-color .8s var(--ease),border-color .8s var(--ease)';
    function setTransformLeg(leaf, spec) {
      leaf.style.transition = 'transform ' + spec + ',' + PALETTE_LEGS;
    }
    function clearLegs(leaf) { leaf.style.transition = ''; }

    /* ---- layout / theming ---- */
    // Only the leaves a turn actually involves may paint. Everything else is
    // visibility:hidden, so no compositor quirk can surface a page that isn't
    // part of what's happening. `visible` is a list of leaf indices; anything
    // not in it is hidden. visibility (not display) keeps them in layout, so
    // rect reads elsewhere stay valid.
    function showOnly(visible) {
      leaves.forEach(function (leaf, i) {
        leaf.style.visibility = visible.indexOf(i) === -1 ? 'hidden' : '';
      });
    }

    function layout(cur) {
      // The resting state: exactly one page on screen. Because snap() calls
      // layout(current) and every path ends in snap(), this is also what
      // makes the whole scheme self-healing — a turn that computed its
      // visible set wrongly is corrected the moment it lands.
      showOnly([cur]);
      leaves.forEach(function (leaf, i) {
        // Turned/already-read pages (i<cur) and not-yet-reached pages
        // (i>=cur) need two disjoint z-index ranges — `i` and `total-i`
        // overlap for several (i, cur) combinations (e.g. cur=4, total=8:
        // leaf3 and leaf5 both land on z-index 3). Offsetting the turned
        // range fully negative guarantees no collision regardless of DOM
        // order.
        leaf.style.zIndex = i < cur ? (i - total) : (total - i);
        leaf.style.transform = i < cur ? 'rotateY(-180deg)' : 'rotateY(0deg)';
      });
    }

    // Presentational side-effects that should happen the instant `current` is
    // committed — before any visible rotation — because the destination leaf
    // is still face-down (or, for the outgoing leaf, about to turn away) at
    // that moment. Splitting these out of layout() keeps them off the frame
    // where the flip actually lands: the destination's decorative SVG loops
    // un-pause, and the résumé PDF viewer warms up, *during* the flip.
    function prepare(cur) {
      leaves.forEach(function (leaf, i) { leaf.classList.toggle('is-current', i === cur); });
    }

    // The résumé PDF is the most expensive thing on the site to bring to
    // life: un-hiding it instantiates the browser's PDF viewer, which blocks
    // the main thread hard. It must share a frame with neither the click (it
    // would stall the flip before it starts — the old behaviour, and why
    // cover→contact froze worst) nor the landing (it would stall the pop-up),
    // so it gets its own idle slot once everything else has settled.
    // One-way latch: instantiated at most once per session.
    var resumeWarmed = false;
    function warmResume() {
      if (resumeWarmed || !resumeIframe || current !== CONTACT_LEAF) return;
      resumeWarmed = true;
      var reveal = function () { resumeIframe.style.visibility = ''; };
      if (window.requestIdleCallback) window.requestIdleCallback(reveal, { timeout: 600 });
      else setTimeout(reveal, 200);
    }

    // Focus is deferred to the landing rather than fired at commit time:
    // cheaper (no forced layout on the click frame) and more correct, since
    // it moves the caret to a page that has actually arrived.
    var pendingFocus = false;
    function focusIfPending() {
      if (!pendingFocus) return;
      pendingFocus = false;
      var h = leaves[current].querySelector('h1, h2');
      if (!h) return;
      h.setAttribute('tabindex', '-1');
      h.focus({ preventScroll: true });
    }

    // Instantly (transitions disabled, reflow flushed) reconciles every
    // leaf's z-index/transform to exactly what layout(current) says. Safe to
    // call from any state — mid-drag, mid-flip, freshly loaded — which is
    // what makes an abandoned animation harmless: no matter where a leaf's
    // transform was left, the next snap() always wins.
    function snap() {
      // Convergence point for the mid-flip handover. These normally already
      // ran (animate() fires them when the leading leaf is edge-on), and both
      // are genuinely idempotent, so this is a no-op on every normal path —
      // it exists so a handover that got superseded before firing can never
      // strand the palette or is-current out of sync with `current`. Done
      // before the reflow below so one flush covers everything.
      applyTime(current);
      prepare(current);

      leaves.forEach(function (l) {
        setTransformLeg(l, '0s');
        l.classList.remove('is-turning');   // drop the layer promotion
      });
      layout(current);
      void leaves[0].offsetHeight;
      leaves.forEach(clearLegs);
      liveLeaf = null;
      liveIndex = -1;

      // The single place the open page's pop-up is armed. Idempotent, so it's
      // a no-op wherever the page was already armed. It also covers the
      // abandonment cases: if whatever we just superseded left `current`
      // primed but never armed — a riffle cancelled by a drag that was then
      // released without committing, say — the page would otherwise sit blank
      // until the next navigation.
      // Called synchronously — the reflow above just left layout clean and
      // nothing since has touched geometry, so activateLeaf's measurements
      // are cheap and the cards start moving on the very next paint instead
      // of a frame or two later.
      activateLeaf(current);
      focusIfPending();
      warmResume();
    }

    // At most one leaf is ever "elevated" (z-index total+5, actively
    // rotating) at a time. If a new leaf is about to take that role while a
    // different one still holds it — e.g. two rapid same-direction presses,
    // where the first leaf is abandoned mid-turn before its own leg ends —
    // demote the old one back to its correct resting z-index first, WITHOUT
    // touching its transform (it keeps rotating on its own via its own
    // still-live CSS transition; it just stops fighting for the top spot).
    // This is what lets an abandoned leg fade into the background instead of
    // instantly and visibly snapping under the new one.
    var liveLeaf = null, liveIndex = -1;
    function elevate(leaf, i) {
      if (liveLeaf && liveLeaf !== leaf) {
        liveLeaf.style.zIndex = liveIndex < current ? (liveIndex - total) : (total - liveIndex);
      }
      leaf.style.zIndex = total + 5;
      liveLeaf = leaf;
      liveIndex = i;
    }

    function applyTime(cur) {
      var t = TIME_FOR_LEAF[cur];
      var want = (t === 'day') ? null : t;
      // genuinely idempotent — re-setting the attribute to the value it
      // already holds would still invalidate style for the whole document,
      // and snap() calls this on every single navigation
      if ((root.getAttribute('data-time') || null) === want) return;
      if (want === null) root.removeAttribute('data-time');
      else root.setAttribute('data-time', want);
      var meta = $('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', THEME_COLOR[cur]);
    }

    function updateRibbon(cur) {
      if (!ribbonFill) return;
      ribbonFill.style.width = (total > 1 ? (cur / (total - 1)) * 100 : 100).toFixed(2) + '%';
    }

    function updateTabs(cur) {
      tabs.forEach(function (tab) {
        var id = (tab.getAttribute('href') || '').replace('#', '');
        var on = HASH_TO_LEAF[id] === cur;
        tab.classList.toggle('is-active', on);
        if (on) tab.setAttribute('aria-current', 'true');
        else tab.removeAttribute('aria-current');
      });
    }

    function updateControls(cur) {
      if (pageNo) pageNo.textContent = (cur + 1) + ' / ' + total;
      if (pagePrev) pagePrev.disabled = cur === 0;
      if (pageNext) pageNext.disabled = cur === total - 1;
    }

    /* ---- per-leaf reveal, re-armed every time the page is opened so the
       pop-up replays like a real pop-up book, not just on first visit.
       Split into two halves so a multi-page riffle can do the cheap,
       invisible part (primeLeaf) the instant navigation is committed, and
       defer the actual pop-up trigger (activateLeaf) to the moment the turn
       lands — see animate()/flipToCover() below. ---- */
    function primeLeaf(i) {
      var leaf = leaves[i];
      if (!leaf) return;

      var items = $$('.reveal', leaf);
      var decos = $$('.deco', leaf);
      if (!items.length && !decos.length) return;

      if (leaf.__revealIO) { leaf.__revealIO.disconnect(); leaf.__revealIO = null; }

      // Strip with transitions suppressed, so the reveals jump back to their
      // hidden state instead of playing the pop-up in reverse. This runs at
      // commit time, while the destination leaf is still occluded (upcoming
      // pages sit under the un-turned stack; already-read ones are face-down
      // behind backface-visibility:hidden), so the reset is never seen.
      leaf.classList.add('is-priming');
      items.forEach(function (el) { el.classList.remove('is-in'); });
      leaf.classList.remove('is-open');   // the decorations' switch — same reset, same frame
      void leaf.offsetHeight; // flush the hidden state before transitions come back
      leaf.classList.remove('is-priming');

      if (reduced || !('IntersectionObserver' in window)) return; // activateLeaf's fallback handles this case

      var cards = 0;
      $$('.grid', leaf).forEach(function (grid) {
        $$('.reveal', grid).forEach(function (el, idx) {
          el.style.setProperty('--d', (idx * STAGGER_CARD) + 'ms');
          if (idx + 1 > cards) cards = idx + 1;
        });
      });

      // Decorations trail the cards rather than competing with them: the page
      // builds heading -> cards -> ambient art. Offset by the longest card
      // run on this leaf so the art always starts after the last card has
      // begun, whatever the page's card count.
      var decoStart = cards * STAGGER_CARD;
      decos.forEach(function (el, idx) {
        el.style.setProperty('--dd', (decoStart + idx * STAGGER_CARD) + 'ms');
      });
    }

    // Shared by both reveal paths (synchronous first pass and the observer's
    // scroll-driven deliveries) so they behave identically.
    function revealItem(el) {
      el.classList.add('is-in');
      var tw = el.querySelector('.tw');
      if (!tw) return;
      tw.classList.remove('tw--done');
      setTimeout(function () { tw.classList.add('tw--done'); },
                 parseInt(tw.dataset.ms, 10) || 1200);
    }

    var STAGGER_CARD = 60;                    // ms between consecutive cards popping
    var BOTTOM_MARGIN = 0.09;                 // keep these two in lockstep:
    var ROOT_MARGIN_STR = '0px 0px -9% 0px';  // the synchronous pass reimplements them
    var THRESHOLD = 0.08;

    function activateLeaf(i) {
      var leaf = leaves[i];
      if (!leaf) return;

      var items = $$('.reveal', leaf);

      // The decorations' pop is driven purely by this class, NOT by the
      // .reveal/IntersectionObserver path: decos are display:none below
      // 900px, so they'd report zeroed rects and get handed to an observer
      // that can never fire. A class on the leaf sidesteps that entirely.
      leaf.classList.add('is-open');

      if (!items.length) return;

      // Already armed — calling again would stack a second observer on the
      // same items. primeLeaf() nulls this out, so a leaf that was primed but
      // never armed is correctly NOT skipped here; that's what lets snap()
      // call this defensively on every path.
      if (leaf.__revealIO) return;

      if (reduced || !('IntersectionObserver' in window)) {
        items.forEach(function (el) { el.classList.add('is-in'); });
        return;
      }

      var scrollRoot = leaf.querySelector('.leaf__scroll') || leaf;
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          io.unobserve(entry.target);
          revealItem(entry.target);
        });
      }, { root: scrollRoot, rootMargin: ROOT_MARGIN_STR, threshold: THRESHOLD });

      leaf.__revealIO = io;

      // An IntersectionObserver's FIRST delivery is asynchronous — a frame or
      // two before anything visibly moves. That latency is only actually
      // needed for cards below the fold, which reveal on scroll. So measure
      // once, reveal what's already on screen synchronously (the pop then
      // starts on the very next paint), and hand only the rest to the
      // observer. The maths mirrors the observer's own rootMargin/threshold
      // so both paths agree on what counts as "in view".
      var rootRect = scrollRoot.getBoundingClientRect();
      var effBottom = rootRect.bottom - rootRect.height * BOTTOM_MARGIN;

      // Pages are sized to fit the viewport now, so .leaf__scroll is
      // overflow:hidden above the 480px-tall floor and CANNOT scroll. Handing
      // an out-of-view item to the observer there would strand it invisible
      // forever, because no scroll event will ever bring it into view. So the
      // observer is only used when the root can genuinely scroll; otherwise
      // everything is revealed now and the stagger does the sequencing.
      var canScroll = scrollRoot.scrollHeight > scrollRoot.clientHeight + 1;

      items.forEach(function (el) {
        var r = el.getBoundingClientRect();
        var vis = Math.min(r.bottom, effBottom) - Math.max(r.top, rootRect.top);
        var inView = r.height && (vis / r.height) >= THRESHOLD;
        if (inView || !canScroll) revealItem(el);
        else io.observe(el);
      });
    }

    // The cheap chrome — ribbon, tabs, page counter, URL — updated
    // immediately at commit time. Text-only writes, nothing that forces
    // layout, so this is safe on the click frame. Everything expensive lives
    // elsewhere: the pop-up trigger (activateLeaf), the palette handover
    // (applyTime/prepare), focus, and the résumé warm-up all fire later, so a
    // multi-page riffle doesn't pop or repaint the destination mid-flight.
    function updateChrome(cur) {
      updateRibbon(cur);
      updateTabs(cur);
      updateControls(cur);
      try { history.replaceState(null, '', LEAF_HASH[cur]); } catch (e) { /* file://, ignore */ }
    }

    /* ---- the flip itself ----
       navToken guards against overlapping animations: mashing next/prev, a
       tab-jump riffle interrupted by an arrow key, a drag that starts
       mid-riffle. Each animate()/flipToCover/dragEnd stamps a new token; any
       in-flight leg whose token has since been superseded just stops —
       since `current` is committed synchronously at decision time (goTo),
       an abandoned animation can never leave bookkeeping pointing at the
       wrong page. At worst it leaves one leaf's *transform* stale until the
       next snap() (always called by whatever superseded it) papers over it. */
    var navToken = 0;

    // Plays the navigation from `from` to the already-committed `current` as
    // a SINGLE page turn, no matter how far the jump. An earlier version
    // riffled through the intervening leaves; the problem is that a riffle
    // necessarily makes pages you didn't ask for face-up and visible on their
    // way past — a cover->contact jump flashed the projects page for ~350ms.
    // One turn has no such state: the only two pages ever visible are the one
    // you left and the one you asked for.
    function animate(from) {
      var target = current; // committed by goTo() just before this was called
      if (from === target) return;
      navToken++;
      var token = navToken;

      var dir = target > from ? 1 : -1;

      // Exactly ONE leaf ever turns, however far the jump. Forward, it's the
      // page you're leaving, turning away to uncover the destination behind
      // it. Backward, it's the destination itself, turning back toward you.
      var movingIndex = dir === 1 ? from : target;
      var moving = leaves[movingIndex];
      var endAngle = dir === 1 ? 'rotateY(-180deg)' : 'rotateY(0deg)';

      // Stage every OTHER leaf at a resting layout chosen so that the only
      // thing the turning leaf can ever uncover is the destination:
      //
      //   forward  -> layout(target). Leaves between `from` and `target` land
      //               face-down (rotateY(-180deg), negative z) and cannot be
      //               seen; the destination sits at the top of the un-turned
      //               stack, directly beneath the turning page. This is what
      //               kills the old "projects flashes past" bug — the skipped
      //               pages are never face-up at any point.
      //
      //   backward -> layout(from). Subtle but important: at layout(target)
      //               the in-between leaves would take z-indices ABOVE the
      //               outgoing page and cover it. Staged at layout(from) they
      //               stay face-down instead, so the page being left remains
      //               visible behind the leaf turning back toward the viewer —
      //               which is what a real book does.
      //
      // snap() reconciles to layout(target) at the end, and that reconcile is
      // invisible either way because the turning leaf finishes on top of
      // everything it would otherwise expose (forward: face-down at -180deg
      // with the destination already top of stack; backward: at 0deg as the
      // highest leaf).
      var stageAt = dir === 1 ? target : from;
      leaves.forEach(function (leaf, idx) {
        if (idx === movingIndex) return;
        leaf.style.zIndex = idx < stageAt ? (idx - total) : (total - idx);
        setTransformLeg(leaf, '0s');
        leaf.style.transform = idx < stageAt ? 'rotateY(-180deg)' : 'rotateY(0deg)';
      });

      // The only two pages that can legitimately be seen during this turn:
      // the leaf that's turning, and the one it uncovers behind it. Forward
      // that's the destination; backward the turning leaf IS the destination
      // and the page behind is the one being left.
      showOnly([movingIndex, dir === 1 ? target : from]);

      moving.style.zIndex = total + 5;
      moving.classList.add('is-turning');
      setTransformLeg(moving, FLIP_MS + 'ms var(--ease-flip) 0ms');

      void moving.offsetHeight; // one flush: commits the staging AND the new leg

      leaves.forEach(function (leaf, idx) {
        if (idx !== movingIndex) clearLegs(leaf);
      });
      moving.style.transform = endAngle;

      var lastLeaf = moving;

      var totalMs = FLIP_MS;

      // The single most important timer in the engine. At POP_AT the turning
      // leaf is edge-on: the destination is fully uncovered, and the page the
      // user was looking at is side-on and can't show a colour change. So this
      // is simultaneously
      //   - the moment the destination's pop-up must start (waiting for
      //     transitionend instead left the arrived page sitting empty for
      //     hundreds of ms), and
      //   - the moment the palette can hand over without repainting the
      //     outgoing page in the destination's colours.
      // Both are idempotent and both are re-applied by snap(), so if this is
      // superseded before it fires nothing is ever stranded.
      setTimeout(function () {
        if (token !== navToken) return;
        applyTime(current);
        prepare(current);
        activateLeaf(current);
      }, FLIP_MS * POP_AT);

      // Land on either transitionend (normal case) or a safety timeout,
      // whichever fires first — transitionend never fires when a transform
      // is set to the value it's already at (e.g. re-targeting a leaf that
      // happens to already be mid-flight toward that exact angle), so the
      // timeout is what keeps navigation from ever stranding on that edge
      // case.
      function land() {
        if (token !== navToken) return; // superseded — a newer navigation owns the DOM now
        lastLeaf.removeEventListener('transitionend', onEnd);
        clearTimeout(safety);
        // snap() reconciles, converges the handover, arms the destination's
        // pop-up synchronously, moves focus, and queues the résumé warm-up —
        // so the pop fires once the turn has actually landed rather than at
        // commit time, and a riffle never pops its cards mid-flight
        snap();
      }
      function onEnd(e) {
        if (e.target === lastLeaf && e.propertyName === 'transform') land();
      }
      lastLeaf.addEventListener('transitionend', onEnd);
      var safety = setTimeout(land, totalMs + 80);
    }

    // Commits `current` synchronously — the single moment navigation intent
    // becomes bookkeeping truth — updates the chrome immediately, then kicks
    // off the animation as a purely presentational follow-up.
    function goTo(target, opts) {
      opts = opts || {};
      target = Math.max(0, Math.min(total - 1, target));
      if (target === current) {
        // already there (e.g. re-clicking the active tab) — nothing to
        // flip, but replay the pop-up if explicitly asked to focus it
        if (opts.focus) {
          pendingFocus = true;
          updateChrome(current);
          primeLeaf(current);
          activateLeaf(current);
          focusIfPending();
        }
        return;
      }
      var from = current;
      current = target;
      pendingFocus = !!opts.focus;
      // Deliberately NOT applying the palette or is-current here: animate()
      // hands both over mid-flip instead, so the page being left never
      // repaints in the destination's colours before it starts turning. The
      // click frame is kept to this cheap strip plus text-only chrome.
      primeLeaf(current);
      updateChrome(current);

      if (reduced) { snap(); return; } // snap() applies the handover, arms, focuses

      animate(from);
    }

    /* ---- corner drag / swipe ---- */
    var drag = { active: false, dir: 0, moving: null, startX: 0, ratio: 0 };

    function dragStart(e, dir) {
      var atEdge = (dir === 1 && current === total - 1) || (dir === -1 && current === 0);
      if (atEdge) return;
      navToken++; // cancel any in-flight animation so it can't fight the drag
      var idx = dir === 1 ? current : current - 1;
      var leaf = leaves[idx];
      // the leaf being grabbed might still be mid-transition from an
      // abandoned previous flip — snap just this one leaf (instantly) to the
      // resting angle the drag math below expects to start from
      setTransformLeg(leaf, '0s');
      leaf.style.transform = dir === 1 ? 'rotateY(0deg)' : 'rotateY(-180deg)';
      void leaf.offsetHeight;
      clearLegs(leaf);

      // Both drag directions expose the same pair: the leaf being turned and
      // the one immediately after it. dir=1 grabs leaf `current` and turns it
      // away to uncover current+1; dir=-1 grabs leaf current-1 and turns it
      // back over `current`. Either way that's {idx, idx+1}.
      showOnly([idx, idx + 1]);

      elevate(leaf, idx);
      leaf.classList.add('is-turning');
      drag.active = true;
      drag.dir = dir;
      drag.startX = e.clientX;
      drag.ratio = 0;
      drag.moving = leaf;
      drag.moving.classList.add('is-dragging');
      doc.addEventListener('pointermove', dragMove, { passive: true });
      try { e.target.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }

    function dragMove(e) {
      if (!drag.active) return;
      var dx = e.clientX - drag.startX;
      var w = window.innerWidth || 1;
      var t = Math.max(0, Math.min(1, (drag.dir === 1 ? -dx : dx) / (w * 0.55)));
      drag.ratio = t;
      var angle = drag.dir === 1 ? -180 * t : -180 * (1 - t);
      drag.moving.style.transform = 'rotateY(' + angle.toFixed(2) + 'deg)';
    }

    function dragEnd(commit) {
      if (!drag.active) return;
      drag.active = false;
      doc.removeEventListener('pointermove', dragMove);
      drag.moving.classList.remove('is-dragging');
      var doCommit = commit !== undefined ? commit : drag.ratio > 0.5;
      var ratio = drag.ratio;
      var moving = drag.moving;
      var dir = drag.dir;
      drag.moving = null;

      navToken++;
      var token = navToken;
      // however much of the turn is left to animate — a 90%-complete drag
      // shouldn't spend a full FLIP_MS crossing just the last 10%
      var remaining = doCommit ? (1 - ratio) : ratio;
      var ms = Math.max(60, FLIP_MS * remaining);
      var endTransform = doCommit
        ? (dir === 1 ? 'rotateY(-180deg)' : 'rotateY(0deg)')
        : (dir === 1 ? 'rotateY(0deg)' : 'rotateY(-180deg)');

      if (doCommit) {
        // commit bookkeeping synchronously, same as goTo() — the rest of
        // this leaf's turn (below) is just finishing the visual
        current = dir === 1 ? current + 1 : current - 1;
        // a committed drag is past the halfway point by definition, so the
        // outgoing page is already side-on — unlike the click path, the
        // palette handover is safe to do immediately here
        applyTime(current);
        prepare(current);
        primeLeaf(current);
        updateChrome(current);
        activateLeaf(current);
      }

      setTransformLeg(moving, ms + 'ms var(--ease-flip)');
      void moving.offsetHeight;
      moving.style.transform = endTransform;
      setTimeout(function () {
        if (token !== navToken) return;
        clearLegs(moving);
        snap();
      }, ms);
    }

    function bindCorners() {
      var prev = $('.book__corner--prev'), next = $('.book__corner--next');
      if (prev) prev.addEventListener('pointerdown', function (e) { dragStart(e, -1); });
      if (next) next.addEventListener('pointerdown', function (e) { dragStart(e, 1); });
      // Bound only for the duration of an actual drag. Left on the document
      // permanently it fired on every pointermove across the whole page just
      // to hit an early `if (!drag.active) return`.
      doc.addEventListener('pointerup', function () { dragEnd(); });
      doc.addEventListener('pointercancel', function () { dragEnd(false); });
      window.addEventListener('blur', function () { dragEnd(false); });
      doc.addEventListener('visibilitychange', function () { if (doc.hidden) dragEnd(false); });
    }

    function bindControls() {
      if (pagePrev) pagePrev.addEventListener('click', function () { goTo(current - 1); });
      if (pageNext) pageNext.addEventListener('click', function () { goTo(current + 1); });
    }

    function bindKeyboard() {
      doc.addEventListener('keydown', function (e) {
        if (e.target && e.target.closest && e.target.closest('input,textarea,[contenteditable]')) return;
        if (e.key === 'ArrowRight') goTo(current + 1);
        else if (e.key === 'ArrowLeft') goTo(current - 1);
      });
    }

    function bindTabsAndAnchors() {
      doc.addEventListener('click', function (e) {
        var a = e.target.closest && e.target.closest('a[href^="#"]');
        if (!a) return;
        var id = a.getAttribute('href').slice(1);
        if (!HASH_TO_LEAF.hasOwnProperty(id)) return; // unknown hash, let default happen
        e.preventDefault();
        goTo(HASH_TO_LEAF[id], { focus: true });
      });
    }

    /* ---- init: lay out instantly (no flip animation on first paint) ---- */
    applyTime(current);
    leaves.forEach(function (l) { setTransformLeg(l, '0s'); });
    layout(current);
    // The stage has been hidden since the inline boot script ran; every leaf
    // now has its z-index and transform, so it's safe to show.
    root.classList.remove('book-booting');
    requestAnimationFrame(function () { leaves.forEach(clearLegs); });
    prepare(current);
    updateChrome(current);
    primeLeaf(current);
    activateLeaf(current);
    warmResume();

    bindCorners();
    bindControls();
    bindKeyboard();
    bindTabsAndAnchors();

    /* "back to the cover": rather than rewinding backward through every
       page in between (goTo(0) would riffle back leaf-by-leaf), this plays
       a single forward flip — as if continuing to turn pages past the end
       loops back around to the front cover. */
    function flipToCover(opts) {
      opts = opts || {};
      if (current === 0) {
        if (opts.focus) {
          pendingFocus = true;
          updateChrome(0);
          primeLeaf(0);
          activateLeaf(0);
          focusIfPending();
        }
        return;
      }
      navToken++;
      var token = navToken;
      var outgoingIndex = current;
      var outgoing = leaves[outgoingIndex];

      current = 0;
      pendingFocus = !!opts.focus;
      primeLeaf(0);
      updateChrome(0);

      if (reduced) { snap(); return; }

      // Exactly the same POP_AT handover as animate(): the outgoing page is
      // edge-on, so the cover behind it is just being uncovered. Popping the
      // cover's cards at click time (as this used to) meant their whole
      // entrance played out while they were still hidden behind the outgoing
      // page — by the time you could see the cover, its pop-up was over.
      setTimeout(function () {
        if (token !== navToken) return;
        applyTime(0);
        prepare(0);
        activateLeaf(0);
      }, FLIP_MS * POP_AT);

      // stage the cover exactly like a normal forward flip's incoming leaf:
      // sitting flat and ready underneath, instantly (no transition) so it
      // doesn't itself animate in — only the outgoing page's turn should.
      // z-index matches what layout(0)'s own formula would give leaf 0
      // (the new current page): total, i.e. above every other "upcoming"
      // leaf's [1, total-1] range.
      var incoming = leaves[0];
      setTransformLeg(incoming, '0s');
      incoming.style.zIndex = total;
      incoming.style.transform = 'rotateY(0deg)';
      void incoming.offsetHeight; // flush the instant style before re-enabling transitions
      clearLegs(incoming);

      showOnly([outgoingIndex, 0]);   // the page turning away, and the cover behind it

      elevate(outgoing, outgoingIndex);
      outgoing.classList.add('is-turning');
      setTransformLeg(outgoing, FLIP_MS + 'ms var(--ease-flip)');
      void outgoing.offsetHeight;
      outgoing.style.transform = 'rotateY(-180deg)';

      setTimeout(function () {
        if (token !== navToken) return;
        clearLegs(outgoing);
        snap();
      }, FLIP_MS);
    }

    window.BookEngine = { flipTo: goTo, flipToCover: flipToCover };
  }());


  /* ---------------------------------------------------------
     4 · clickable bullet-journal checkboxes
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
     5 · expandable game-score entries
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
     6 · demo audio player
     Files live in assets/audio/ and are served as plain static
     files, so this works unchanged on GitHub Pages. Nothing is
     fetched until a play button is actually pressed.
     --------------------------------------------------------- */
  (function demoPlayer() {
    var rows = $$('.demo');
    if (!rows.length) return;

    var players = [];     // one entry per row: {row, btn, fill, audio}
    var current = null;

    // the speaker (below the demos card) and the EQ bars (in leaf5's header)
    // both pulse faster while something is actually playing
    var audioLeaf = rows[0] && rows[0].closest('.leaf');
    function syncAudioClass() {
      if (audioLeaf) audioLeaf.classList.toggle('is-audio-playing', !!current);
    }

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
        syncAudioClass();
      });
      // no file uploaded yet, or a bad path: say so rather than failing silently
      audio.addEventListener('error', function () {
        entry.row.classList.add('is-missing');
        entry.row.classList.remove('is-playing', 'is-paused');
        entry.btn.setAttribute('aria-disabled', 'true');
        entry.btn.title = 'audio coming soon';
        if (current === entry) current = null;
        syncAudioClass();
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
          syncAudioClass();
          return;
        }

        if (current && current !== entry) stop(current);   // only one at a time

        var started = entry.audio.play();
        if (started && started.catch) {
          started.catch(function () { row.classList.add('is-missing'); syncAudioClass(); });
        }
        row.classList.add('is-playing');
        row.classList.remove('is-paused');
        current = entry;
        syncAudioClass();
      });
    });
  }());


  /* ---------------------------------------------------------
     7 · copy email
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
     7.5 · projects page: looping code typewriter
     A small decorative line of code at the foot of the projects
     page that types itself out, holds, deletes, and moves on to
     the next of three lines, forever. Pauses its own ticking
     (rather than relying on the CSS offscreen-pause rule, which
     only touches CSS animations) while its leaf isn't current, so
     it doesn't burn cycles typing on a hidden page.
     --------------------------------------------------------- */
  (function codeTypewriter() {
    var host = $('#projectsCode');
    if (!host) return;
    var textEl = $('.deco-code__text', host);
    if (!textEl) return;
    var leaf = host.closest('.leaf');

    var LINES = [
      'buf[i] = lerp(hrir[a], hrir[b], t);',
      'dac.write(osc.tick() * env);',
      'if (d < 0.30f) pitch = map(d);'
    ];

    if (reduced) { textEl.textContent = LINES[0]; return; }

    var TYPE_MS = 45, DELETE_MS = 25, HOLD_MS = 1400, GAP_MS = 400, IDLE_POLL_MS = 500;
    var line = 0, pos = 0, phase = 'typing';   // 'typing' | 'holding' | 'deleting' | 'gap'

    function isCurrent() { return !leaf || leaf.classList.contains('is-current'); }

    function step() {
      if (!isCurrent()) { setTimeout(step, IDLE_POLL_MS); return; }

      var text = LINES[line];

      if (phase === 'typing') {
        pos++;
        textEl.textContent = text.slice(0, pos);
        if (pos >= text.length) { phase = 'holding'; setTimeout(step, HOLD_MS); }
        else { setTimeout(step, TYPE_MS); }
        return;
      }
      if (phase === 'holding') {
        phase = 'deleting';
        setTimeout(step, DELETE_MS);
        return;
      }
      if (phase === 'deleting') {
        pos--;
        textEl.textContent = text.slice(0, pos);
        if (pos <= 0) { phase = 'gap'; setTimeout(step, GAP_MS); }
        else { setTimeout(step, DELETE_MS); }
        return;
      }
      // phase === 'gap': move to the next line
      line = (line + 1) % LINES.length;
      pos = 0;
      phase = 'typing';
      setTimeout(step, TYPE_MS);
    }

    setTimeout(step, 500);
  }());


  /* ---------------------------------------------------------
     8 · back to the cover
     --------------------------------------------------------- */
  var totop = $('#totop');
  if (totop) {
    totop.addEventListener('click', function () {
      if (window.BookEngine && window.BookEngine.flipToCover) window.BookEngine.flipToCover({ focus: true });
      else window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    });
  }


  /* ---------------------------------------------------------
     9 · gentle card tilt (fine pointers only)
     --------------------------------------------------------- */
  if (finePointer && !reduced) {
    // The naive version read getBoundingClientRect() AND wrote style.transform
    // on every single pointermove — a forced synchronous layout per mouse
    // move, per card. Instead: measure once when the pointer enters (the card
    // can't move while you're hovering it), and coalesce the write into one
    // rAF so a burst of moves in a frame produces exactly one style write.
    $$('[data-tilt]').forEach(function (el) {
      var base = getComputedStyle(el).getPropertyValue('--tilt') || '0deg';
      var rect = null, queued = false, mx = 0, my = 0;

      function paint() {
        queued = false;
        if (!rect) return;
        var px = (mx - rect.left) / rect.width - 0.5;
        var py = (my - rect.top) / rect.height - 0.5;
        el.style.transform =
          'rotate(' + base + ') perspective(760px) rotateY(' + (px * 6).toFixed(2) +
          'deg) rotateX(' + (-py * 6).toFixed(2) + 'deg) translateY(-4px)';
      }

      el.addEventListener('pointerenter', function () {
        rect = el.getBoundingClientRect();   // the one and only measurement
      });

      el.addEventListener('pointermove', function (e) {
        if (!rect) rect = el.getBoundingClientRect(); // pointerenter can be missed
        mx = e.clientX; my = e.clientY;
        if (queued) return;
        queued = true;
        requestAnimationFrame(paint);
      }, { passive: true });

      el.addEventListener('pointerleave', function () {
        rect = null;
        el.style.transform = '';
      });
    });
  }


  /* ---------------------------------------------------------
     10 · sparkle trail + click bursts
     --------------------------------------------------------- */
  // Fixed pool instead of create-append-setTimeout-remove per spark. The
  // trail fires ~9x/sec for as long as the pointer is moving, so the naive
  // version meant continuous DOM churn plus a live timer per particle, for
  // the entire session. The pool allocates once; recycling a node is a class
  // toggle plus a reflow to restart its animation. 14 is comfortably more
  // than the ~7 that can be alive at once (820ms lifetime / 110ms throttle).
  var SPARK_POOL = 14;
  var sparks = [], sparkAt = 0;

  function spark(x, y, color) {
    var s = sparks[sparkAt];
    if (!s) {
      s = doc.createElement('span');
      s.className = 'spark';
      doc.body.appendChild(s);
      sparks[sparkAt] = s;
    }
    sparkAt = (sparkAt + 1) % SPARK_POOL;

    // restart the animation on a recycled node: drop the class, flush, re-add
    s.classList.remove('spark--on');
    void s.offsetWidth;

    s.style.left = x + 'px';
    s.style.top = y + 'px';
    s.style.background = color || 'var(--blush)';
    s.style.setProperty('--dx', rand(-22, 22).toFixed(1) + 'px');
    s.style.setProperty('--dy', rand(-26, 24).toFixed(1) + 'px');
    s.style.width = s.style.height = rand(6, 12).toFixed(1) + 'px';
    s.classList.add('spark--on');
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
     11 · toast
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

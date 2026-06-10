/* =========================================================================
 * MarineTrade Sourcing Co. — script.js
 * Lightweight vanilla JS: nav, RFQ cross-link, validation, modal,
 * and Google Sheets → live stock dashboard sync.
 * ========================================================================= */

(() => {
  'use strict';

  /* -------------------------------------------------------------
   * 0. Utilities
   * ----------------------------------------------------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* -------------------------------------------------------------
   * 1. Mobile nav toggle
   * ----------------------------------------------------------- */
  const navToggle = $('#navToggle');
  const navLinks  = $('.nav-links');
  if (navToggle && navLinks) {
    navToggle.addEventListener('click', () => navLinks.classList.toggle('open'));
    navLinks.addEventListener('click', (e) => {
      if (e.target.tagName === 'A') navLinks.classList.remove('open');
    });
  }

  /* -------------------------------------------------------------
   * 2. "Select for RFQ" cross-link from catalog → contact form
   * ----------------------------------------------------------- */
  $$('.select-rfq').forEach((btn) => {
    btn.addEventListener('click', () => {
      const variety = btn.dataset.variety;
      const select  = $('#variety');
      if (select) {
        select.value = variety;
        select.dispatchEvent(new Event('change'));
      }
      document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' });
      // Briefly highlight the form
      const form = $('#rfqForm');
      if (form) {
        form.animate(
          [{ boxShadow: '0 0 0 0 rgba(42,157,143,.6)' }, { boxShadow: '0 0 0 14px rgba(42,157,143,0)' }],
          { duration: 900, easing: 'cubic-bezier(.2,.7,.2,1)' }
        );
      }
    });
  });

  /* -------------------------------------------------------------
   * 3. RFQ form: validation + modal feedback
   * ----------------------------------------------------------- */
  const form  = $('#rfqForm');
  const modal = $('#modal');
  const modalTitle = $('#modalTitle');
  const modalBody  = $('#modalBody');
  const modalIcon  = $('#modalIcon');

  const openModal = ({ ok, title, body }) => {
    modalIcon.textContent = ok ? '✓' : '!';
    modalIcon.classList.toggle('error', !ok);
    modalTitle.textContent = title;
    modalBody.textContent  = body;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  };
  const closeModal = () => {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  };
  $('#modalClose')?.addEventListener('click', closeModal);
  modal?.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();

      // Reset error states
      $$('.field', form).forEach((f) => f.classList.remove('invalid'));

      const data = {
        variety: $('#variety').value.trim(),
        volume:  $('#volume').value.trim(),
        terms:   $('#terms').value.trim(),
        email:   $('#email').value.trim(),
        port:    $('#port').value.trim(),
      };

      const errors = [];
      if (!data.variety) errors.push('#variety');
      if (!data.volume || Number(data.volume) < 1) errors.push('#volume');
      if (!data.terms) errors.push('#terms');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.push('#email');
      if (!data.port) errors.push('#port');

      if (errors.length) {
        errors.forEach((sel) => $(sel)?.closest('.field')?.classList.add('invalid'));
        openModal({
          ok: false,
          title: 'Please complete required fields',
          body: 'A few fields need attention before we can route your RFQ to the export desk.',
        });
        return;
      }

      // Submission stub — wire to your backend / email service
      openModal({
        ok: true,
        title: 'RFQ Successfully Initialized',
        body: `Your request for ${data.volume} MT of ${data.variety} (${data.terms} → ${data.port}) is queued. Our export desk will respond within 1 business day.`,
      });
      form.reset();
    });
  }

  /* -------------------------------------------------------------
   * 4. Footer year + session id
   * ----------------------------------------------------------- */
  const yearEl = $('#year'); if (yearEl) yearEl.textContent = new Date().getFullYear();
  const sidEl  = $('#sessionId');
  if (sidEl) sidEl.textContent = 'MT-' + Math.random().toString(36).slice(2, 8).toUpperCase();

  /* =========================================================================
   * 5. LIVE BODEGA STOCK — Google Sheets → Web sync
   * =========================================================================
   *
   * HOW THIS WORKS
   * --------------
   * The client maintains an Excel-style master sheet in Google Sheets that
   * lists current warehouse inventory. We pull it as CSV directly from the
   * "Publish to web" endpoint Google provides — no API key, no OAuth, no
   * server. Whenever the client edits the spreadsheet, this page updates
   * the next time it loads (or on the polling interval below).
   *
   * STEP-BY-STEP SETUP (one-time, by the client)
   * --------------------------------------------
   *  1. Open the master inventory Google Sheet.
   *  2. Ensure the first tab has a simple header + value layout, for example:
   *
   *       A                  | B
   *       -------------------+--------
   *       metric             | value
   *       cottonii_mt        | 482
   *       spinosum_mt        | 316
   *       pending_cargo_mt   | 128
   *       last_updated       | 2026-06-10 09:14 WITA
   *
   *  3. File → Share → "Publish to the web".
   *  4. In the dialog, choose:
   *       - Link
   *       - Entire Document  (or just the first sheet)
   *       - Format: Comma-separated values (.csv)
   *  5. Click "Publish", confirm, and COPY the generated URL. It looks like:
   *
   *       https://docs.google.com/spreadsheets/d/e/2PACX-1vXXXXXXXXXXXXXXXXXX/pub?output=csv
   *
   *  6. Paste that URL below into SHEET_CSV_URL.
   *  7. (Optional) For multi-tab sheets, append &gid=<TAB_GID> to target a
   *     specific sheet tab.
   *
   * That's it — edits in Excel/Google Sheets flow live to this page.
   * ----------------------------------------------------------------------- */

  // ⬇️ Replace this with the client's published CSV URL when ready.
  const SHEET_CSV_URL = '';   // e.g. 'https://docs.google.com/spreadsheets/d/e/2PACX-.../pub?output=csv'
  const POLL_INTERVAL_MS = 5 * 60 * 1000;  // re-sync every 5 minutes
  const MAX_BAR_MT = 600; // visual ceiling for the meter bars

  // Placeholder mock data — used until SHEET_CSV_URL is configured.
  const MOCK = {
    cottonii_mt: 482,
    spinosum_mt: 316,
    last_updated: 'Mock data · configure SHEET_CSV_URL',
  };

  /**
   * Minimal CSV parser. Handles quoted fields containing commas and escaped
   * double-quotes. Not a full RFC 4180 parser — enough for a 2-column
   * key/value sheet or a simple header+rows export.
   */
  function parseCSV(text) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') { inQuotes = false; }
        else { field += c; }
      } else {
        if (c === '"') { inQuotes = true; }
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else if (c === '\r') { /* skip */ }
        else { field += c; }
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  /**
   * Convert a 2-column "metric,value" CSV (with or without header row) into
   * a flat object: { metric_name: value, ... }.
   */
  function csvToObject(text) {
    const rows = parseCSV(text).filter((r) => r.length >= 2 && r[0].trim() !== '');
    const out = {};
    for (const [k, v] of rows) {
      const key = k.trim().toLowerCase();
      if (key === 'metric') continue; // skip header
      out[key] = v.trim();
    }
    return out;
  }

  function renderStock(data) {
    const cottonii = Number(data.cottonii_mt) || 0;
    const spinosum = Number(data.spinosum_mt) || 0;

    const fmt = (n) => n.toLocaleString('en-US');

    $('#stockCottonii').textContent = fmt(cottonii);
    $('#stockSpinosum').textContent = fmt(spinosum);

    const c = $('#meterCottonii'); if (c) c.style.width = Math.min(100, (cottonii / MAX_BAR_MT) * 100) + '%';
    const s = $('#meterSpinosum'); if (s) s.style.width = Math.min(100, (spinosum / MAX_BAR_MT) * 100) + '%';

    const stamp = data.last_updated || new Date().toLocaleString();
    const sync = $('#lastSync'); if (sync) sync.textContent = stamp;
    const dot = $('#liveDot');
    if (dot) {
      dot.childNodes.forEach((n) => { if (n.nodeType === 3) n.textContent = 'LIVE'; });
    }
  }

  async function syncStock() {
    if (!SHEET_CSV_URL) {
      renderStock(MOCK);
      return;
    }
    try {
      const res = await fetch(SHEET_CSV_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      const data = csvToObject(text);
      renderStock(data);
    } catch (err) {
      console.warn('[MarineTrade] Live stock sync failed, using mock data:', err);
      renderStock(MOCK);
    }
  }

  // Kick off + recurring poll
  syncStock();
  setInterval(syncStock, POLL_INTERVAL_MS);

  /* -------------------------------------------------------------
   * 6. Scroll Reveal — depth push-forward
   * Auto-tags section headers, cards, and grid items, then uses
   * IntersectionObserver to fade + scale them forward on entry.
   * ----------------------------------------------------------- */
  const revealTargets = [
    '.section-head',
    '.product-card',
    '.stock-card',
    '.ceo-frame',
    '.ceo-copy',
    '.rfq-form',
    '.contact-meta',
  ];
  const revealGroups = ['.catalog-grid', '.stock-grid'];

  $$(revealTargets.join(',')).forEach((el) => el.classList.add('reveal'));
  $$(revealGroups.join(',')).forEach((el) => el.classList.add('reveal-group'));

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        entry.target.classList.toggle('in-view', entry.isIntersecting);
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -80px 0px' });
    $$('.reveal').forEach((el) => io.observe(el));
  } else {
    $$('.reveal').forEach((el) => el.classList.add('in-view'));
  }

})();
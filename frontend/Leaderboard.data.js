/*
 * Leaderboard.data.js
 * Loads leaderboard data from the backend API (or a JSON fallback) and renders the table. Integrates with existing
 * filter UI via 'filter:change' events and supports simple client-side pagination.
 */
(function () {
  'use strict';

  // Determine DATA_URL dynamically so the API or JSON is loaded correctly.
  // Strategy:
  // 1) If the script tag has `data-api`, prefer that.
  // 2) Otherwise, if it has `data-json`, use that.
  // 3) Otherwise, fall back to localhost backend for integration work.
  let DATA_URL = 'http://localhost:8080/api/leaderboard';
  try {
    const current = document.currentScript || Array.from(document.scripts).reverse().find(s => s.src && s.src.includes('Leaderboard.data.js'));
    if (current && current.src) {
      const apiOverride = current.getAttribute('data-api');
      const jsonOverride = current.getAttribute('data-json');
      if (apiOverride) {
        DATA_URL = apiOverride;
      } else if (jsonOverride) {
        DATA_URL = new URL(jsonOverride, current.src).href;
      } else {
        DATA_URL = 'http://localhost:8080/api/leaderboard';
      }
    }
  } catch (err) {
    DATA_URL = 'http://localhost:8080/api/leaderboard';
  }
  console.info('Leaderboard.data: will fetch data from', DATA_URL);
  const PER_PAGE = 8;
  const AUTH_TOKEN_KEY = 'authToken';
  const AUTH_NAME_KEY = 'authName';
  const AUTH_ROLE_KEY = 'authRole';
  const AUTH_USER_ID_KEY = 'authUserId';
  const RECRUITER_ROLE = 'RECRUITER';

  // allRows: the full dataset loaded from JSON
  // filteredRows: the viewable subset after applying filters
  // currentPage: which page of results is currently shown for pagination
  let allRows = [];
  let filteredRows = [];
  let currentPage = 1;
  // simple filter state we update from events
  let selectedFilters = { assessment: 'all', category: 'all', company: 'all' };

  // Fetch control + polling
  let _fetchController = null;
  let _pollTimer = null;
  const POLL_INTERVAL_MS = 30_000; // 30s default polling interval
  const FETCH_TIMEOUT_MS = 15_000; // 15s timeout for fetch

  const tableBody = document.querySelector('.leaderboard-table tbody');
  const devStatusEl = document.getElementById('leaderboard-dev-status');
  const authStatusEl = document.getElementById('auth-status');
  const loginBtn = document.getElementById('recruiter-login-btn');
  const pageCurrentEl = document.querySelector('.page-current');
  const prevBtn = document.querySelector('.pagination-btn:first-of-type');
  const nextBtn = document.querySelector('.pagination-btn:last-of-type');
  let authBootstrapPromise = null;

  // Safe HTML escaping to avoid injection when writing user-controlled strings into the DOM
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','\'':'&#39;','"':'&quot;' }[c]));
  }

  function escapeAttr(s){ return String(s ?? '').replace(/"/g, '&quot;'); }

  function getPortfolioPath(name) {
    const basePath = window.location.pathname.includes('/src/Features/')
      ? '../../Talent Search/graduateportfolio.html'
      : '../Talent Search/graduateportfolio.html';
    return `${basePath}#${encodeURIComponent(name || 'Graduate')}`;
  }

  function resolveContactPath(row) {
    const path = String(row?.contactPath || '').trim();
    if (!path) return null;
    if (path.startsWith('/profiles/') || path.startsWith('/contact/')) {
      return getPortfolioPath(row?.name);
    }
    return path;
  }

  function getAuthToken() {
    try {
      return localStorage.getItem(AUTH_TOKEN_KEY);
    } catch (err) {
      return null;
    }
  }

  function getStoredAuthName() {
    try {
      return localStorage.getItem(AUTH_NAME_KEY);
    } catch (err) {
      return '';
    }
  }

  function getStoredAuthRole() {
    try {
      return localStorage.getItem(AUTH_ROLE_KEY);
    } catch (err) {
      return '';
    }
  }

  function setAuthState(auth) {
    try {
      if (auth?.token) localStorage.setItem(AUTH_TOKEN_KEY, auth.token);
      if (auth?.name) localStorage.setItem(AUTH_NAME_KEY, auth.name);
      if (auth?.role) localStorage.setItem(AUTH_ROLE_KEY, auth.role);
      if (typeof auth?.userId !== 'undefined' && auth?.userId !== null) {
        localStorage.setItem(AUTH_USER_ID_KEY, String(auth.userId));
      }
    } catch (err) {
      // Ignore storage failures and continue with the in-memory session only.
    }
    refreshAuthUi(auth?.name, auth?.role);
  }

  function clearAuthState() {
    try {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      localStorage.removeItem(AUTH_NAME_KEY);
      localStorage.removeItem(AUTH_ROLE_KEY);
      localStorage.removeItem(AUTH_USER_ID_KEY);
    } catch (err) {
      // Ignore storage failures.
    }
    refreshAuthUi();
  }

  function refreshAuthUi(name = getStoredAuthName(), role = getStoredAuthRole()) {
    if (loginBtn) {
      loginBtn.textContent = role === RECRUITER_ROLE && name
        ? `Signed in: ${name}`
        : 'Sign In as Recruiter';
    }
    if (authStatusEl) {
      authStatusEl.textContent = role === RECRUITER_ROLE && name
        ? `Viewing the leaderboard as recruiter ${name}.`
        : 'Sign in as a recruiter to load leaderboard results.';
    }
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }
    return response.json();
  }

  async function signInAsRecruiter() {
    if (authStatusEl) authStatusEl.textContent = 'Signing you in as the seeded recruiter account...';
    if (loginBtn) loginBtn.disabled = true;

    try {
      const users = await fetchJson('http://localhost:8080/api/auth/options', { cache: 'no-store' });
      const recruiter = Array.isArray(users)
        ? users.find(user => String(user?.role || '').toUpperCase() === RECRUITER_ROLE)
        : null;

      if (!recruiter?.userId) {
        throw new Error('No recruiter account is available from the backend seed data.');
      }

      const auth = await fetchJson('http://localhost:8080/api/auth/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ userId: recruiter.userId })
      });

      setAuthState(auth);
      return auth;
    } finally {
      if (loginBtn) loginBtn.disabled = false;
    }
  }

  async function ensureRecruiterSession() {
    const token = getAuthToken();
    const role = getStoredAuthRole();
    if (token && (!role || role === RECRUITER_ROLE)) {
      refreshAuthUi();
      return null;
    }

    if (!authBootstrapPromise) {
      authBootstrapPromise = signInAsRecruiter().finally(() => {
        authBootstrapPromise = null;
      });
    }
    return authBootstrapPromise;
  }

  // renderRow: create a <tr> for a single data object
  // - builds the DOM elements for the row (rank, graduate, degree, score, contact)
  // - attaches data-* attributes used later for filtering/debugging
  function renderRow(row){
    const tr = document.createElement('tr');
    tr.dataset.assessment = row.assessmentType || '';
    tr.dataset.category = row.category || '';
    tr.dataset.company = row.company || '';

    // rank
    const tdRank = document.createElement('td');
    const rankBadge = document.createElement('span');
    rankBadge.className = 'rank-badge';
    if (row.rank === 1) rankBadge.classList.add('rank-gold');
    if (row.rank === 2) rankBadge.classList.add('rank-silver');
    if (row.rank === 3) rankBadge.classList.add('rank-bronze');
    rankBadge.textContent = String(row.rank ?? '');
    tdRank.appendChild(rankBadge);
    tr.appendChild(tdRank);

    // graduate
    const tdGrad = document.createElement('td');
    tdGrad.className = 'graduate-col';
    tdGrad.innerHTML = `\n      <div class="graduate-info">\n        <div class="avatar">${escapeHtml(row.initials||'')}</div>\n        <div class="graduate-name">${escapeHtml(row.name||'')}</div>\n      </div>\n    `;
    tr.appendChild(tdGrad);

    // degree
    const tdDegree = document.createElement('td');
    tdDegree.innerHTML = `\n      <div class="degree-info">\n        <div class="degree-name">${escapeHtml(row.degree||'')}</div>\n        <div class="degree-year">${escapeHtml(String(row.year||''))}</div>\n      </div>\n    `;
    tr.appendChild(tdDegree);

    // score
    const tdScore = document.createElement('td');
    tdScore.innerHTML = `<span class="skill-score">${escapeHtml(String(row.score ?? ''))}/100</span>`;
    tr.appendChild(tdScore);

    // contact
    const tdContact = document.createElement('td');
    tdContact.className = 'text-center';
    const contactPath = resolveContactPath(row);
    if (contactPath) {
      tdContact.innerHTML = `<a class="btn-contact" href="${escapeAttr(contactPath)}" aria-label="Open profile for ${escapeHtml(row.name||'')}">✉</a>`;
    } else {
      tdContact.innerHTML = '<span class="btn-contact" aria-hidden="true" style="opacity:.35;cursor:not-allowed">✉</span>';
    }
    tr.appendChild(tdContact);

    // return the fully-built <tr> node for insertion into the table body
    return tr;
  }

  // Update the ARIA live region so assistive technologies are informed of changes
  function updateLiveStatus(){
    const el = document.getElementById('leaderboard-status');
    if (!el) return;
    const total = filteredRows.length ?? 0;
    if (total === 0) {
      el.textContent = 'No results found';
      return;
    }
    const start = (currentPage - 1) * PER_PAGE + 1;
    const end = Math.min(currentPage * PER_PAGE, total);
    // Compose a concise message that includes the total, range, page,
    // and a short top-result summary (name + score) so screen readers
    // immediately hear who is currently ranked #1 in the filtered view.
    let msg = `${total} results — showing ${start} to ${end}. Page ${currentPage}.`;
    if (filteredRows && filteredRows.length > 0) {
      const top = filteredRows[0];
      // Only append a short top-result snippet to keep the announcement concise.
      if (top && top.name) {
        const scoreText = (typeof top.score !== 'undefined' && top.score !== null) ? `${top.score}/100` : '';
        msg += ` Top: ${top.name}${scoreText ? `, ${scoreText}` : ''}.`;
      }
    }
    el.textContent = msg;
  }

  // renderPage: show rows for a given page (client-side pagination)
  // - slices filteredRows for the requested page and appends row nodes
  // - writes a simple 'No results' row when nothing matches
  function renderPage(page = 1){
    currentPage = Math.max(1, page);
    const start = (currentPage - 1) * PER_PAGE;
    const pageRows = filteredRows.slice(start, start + PER_PAGE);

    tableBody.innerHTML = '';
    if (!pageRows.length){
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="5" style="text-align:center;padding:1rem;color:#666">No results</td>';
      tableBody.appendChild(tr);
    } else {
      pageRows.forEach(r => tableBody.appendChild(renderRow(r)));
    }

    // update the page number UI if present
    if (pageCurrentEl) pageCurrentEl.textContent = String(currentPage);

    // Announce results to screen readers using the live region if present
    updateLiveStatus();

    // Update dev status to show how many rows are currently in the filtered view
    if (devStatusEl) {
      const totalFiltered = filteredRows.length ?? 0;
      const showingStart = totalFiltered === 0 ? 0 : start + 1;
      const showingEnd = Math.min(start + pageRows.length, totalFiltered);
      devStatusEl.textContent = `Showing ${showingStart} to ${showingEnd} of ${totalFiltered} rows (fetched ${allRows.length}).`;
    }
  }

  // applyFilters: filter allRows using the provided filters object and re-render
  // - expects simple keys: assessment, category, company (each 'all' or an exact match)
  // - sorts the resulting rows by score desc before rendering
  function applyFilters(filters = {}){
    const { assessment, category, company } = filters;
    filteredRows = allRows.filter(r => {
      // perform case-insensitive comparisons so UI data-values like
      // "instream" match JSON values like "InStream"
      const rowAssessment = String(r.assessmentType || '').toLowerCase();
      const rowCategory = String(r.category || '').toLowerCase();
      const rowCompany = String(r.company || '').toLowerCase();
      const wantAssessment = String(assessment || '').toLowerCase();
      const wantCategory = String(category || '').toLowerCase();
      const wantCompany = String(company || '').toLowerCase();

      if (wantAssessment && wantAssessment !== 'all' && rowAssessment !== wantAssessment) return false;
      if (wantCategory && wantCategory !== 'all' && rowCategory !== wantCategory) return false;
      if (wantCompany && wantCompany !== 'all' && rowCompany !== wantCompany) return false;
      return true;
    });
    // sort by score desc so top performers appear first
    filteredRows.sort((a,b) => (b.score ?? 0) - (a.score ?? 0));
    // Recompute ranks based on the filtered & sorted list so the rank shown
    // matches the current view (i.e. when filters change the ranking updates).
    filteredRows = filteredRows.map((r, idx) => ({ ...r, rank: idx + 1 }));
    console.info('Leaderboard.data: applied filters, rows after filter =', filteredRows.length);
    renderPage(1);
  }

  // loadData: fetch API/JSON data and initialize the in-memory arrays
  // - converts the loaded array to a consistent format and ensures each row has a rank
  async function loadData(url = DATA_URL){
    await ensureRecruiterSession();

    // Abort any in-flight request (we'll create a fresh one)
    if (_fetchController) {
      try { _fetchController.abort(); } catch (e) { /* ignore */ }
      _fetchController = null;
    }
    _fetchController = new AbortController();
    const signal = _fetchController.signal;

    // Append a short cache-busting query during development so the
    // browser doesn't return a cached copy while you're iterating on the JSON.
    const fetchUrl = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
    console.info('Leaderboard.data: loading data from', url, '-> fetch URL:', fetchUrl);

    // show a small loading row in the table while fetching
    if (tableBody) tableBody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:1rem;color:#666">Loading…</td></tr>';

    // setup a timeout to abort if the fetch takes too long
    const timeoutId = setTimeout(() => {
      if (_fetchController) {
        try { _fetchController.abort(); } catch (e) { /* ignore */ }
      }
    }, FETCH_TIMEOUT_MS);

    try {
      const token = getAuthToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(fetchUrl, { signal, cache: 'no-store', headers });
      clearTimeout(timeoutId);
      if (res.status === 401) {
        clearAuthState();
        throw new Error('Please choose a user account before viewing the leaderboard.');
      }
      if (res.status === 403) {
        clearAuthState();
        throw new Error('You do not have permission to view this leaderboard data.');
      }
      if (!res.ok) throw new Error('fetch failed ' + res.status);
      allRows = await res.json();
      console.info('Leaderboard.data: fetch returned', Array.isArray(allRows) ? allRows.length + ' rows' : typeof allRows);
      if (devStatusEl) devStatusEl.textContent = `Fetched ${Array.isArray(allRows) ? allRows.length : 0} rows from ${fetchUrl} at ${new Date().toLocaleTimeString()}`;
      if (!Array.isArray(allRows)) allRows = [];
      // give fallback rank if missing
      allRows = allRows.map((r, idx) => ({ rank: r.rank ?? (idx + 1), ...r }));
      // Use applyFilters so we compute ranks according to current filters
      // (initially selectedFilters are defaults like 'all'). This ensures
      // the rank shown reflects the filtered/sorted ordering rather than
      // the static rank embedded in the JSON.
      applyFilters(selectedFilters);
    } catch (err){
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        console.info('Leaderboard.data: fetch aborted or timed out');
        if (devStatusEl) devStatusEl.textContent = `Fetch aborted or timed out for ${fetchUrl} at ${new Date().toLocaleTimeString()}`;
      } else {
        console.error('Leaderboard data load failed', err);
        if (tableBody) tableBody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#b53">Failed to load data</td></tr>';
        if (devStatusEl) devStatusEl.textContent = `Fetch error for ${fetchUrl}: ${err.message}`;
      }
    } finally {
      _fetchController = null;
    }
  }

  // Start/stop polling helpers
  function startPolling(){
    if (_pollTimer) return; // already running
    _pollTimer = setInterval(() => {
      if (document.hidden) return; // pause while not visible
      loadData();
    }, POLL_INTERVAL_MS);
  }
  function stopPolling(){
    if (!_pollTimer) return;
    clearInterval(_pollTimer);
    _pollTimer = null;
  }

  // helpers to read UI labels -> normalized values (kept as a fallback)
  // These functions were used earlier; we still keep them so the data module
  // works if events don't include detail.value for some reason.
  function getLabelForControls(ctrlId){
    return document.querySelector(`[aria-controls="${ctrlId}"] .filter-label`)?.textContent?.trim() ?? 'all';
  }

  // normalizeLabel: convert friendly button text into the data-value style keys
  // e.g. 'Recruiter Challenges' -> 'recruiter-challenges'
  function normalizeLabel(label){
    if (!label) return 'all';
    const l = label.toLowerCase().trim();
    if (
      l === 'all assessments' ||
      l === 'all companies' ||
      l === 'all categories' ||
      l === 'all levels' ||
      l === 'select category' ||
      l === 'all'
    ) return 'all';
    if (l === 'recruiter challenges') return 'recruiter-challenges';
    if (l === 'psychometric tests') return 'psychometric-tests';
    return l.replace(/[\s&]+/g,'-');
  }

  // onFilterChange: handler for 'filter:change' events produced by the UI
  // - The event emits detail.value (the option's data-value) and detail.button
  // - Using data-value is simpler and less error-prone than parsing label text -> preferred
  // - If data-value is missing we fall back to the visible label parsing for backwards compatibility
  function onFilterChange(e){
    const value = e?.detail?.value;
    const btn = e?.detail?.button;

    if (value && btn){
      // Map which control changed based on the button's aria-controls attribute
      const controls = btn.getAttribute('aria-controls');
      if (controls === 'filter-skills') selectedFilters.assessment = value;
      else if (controls === 'filter-category') selectedFilters.category = value;
      else if (controls === 'filter-companies') selectedFilters.company = value;
    } else {
      // fallback behaviour: if no value present, derive values from the visible labels
      selectedFilters.assessment = normalizeLabel(getLabelForControls('filter-skills'));
      selectedFilters.category = normalizeLabel(getLabelForControls('filter-category'));
      selectedFilters.company = normalizeLabel(getLabelForControls('filter-companies'));
    }

    // Apply the new filter set to the dataset and re-render the table
    applyFilters(selectedFilters);
  }

  function syncFiltersFromUi() {
    selectedFilters.assessment = normalizeLabel(getLabelForControls('filter-skills'));
    selectedFilters.category = normalizeLabel(getLabelForControls('filter-category'));
    selectedFilters.company = normalizeLabel(getLabelForControls('filter-companies'));
  }

  document.addEventListener('DOMContentLoaded', () => {
    syncFiltersFromUi();
    refreshAuthUi();
    if (loginBtn) {
      loginBtn.addEventListener('click', async () => {
        try {
          await signInAsRecruiter();
          await loadData();
        } catch (err) {
          if (authStatusEl) authStatusEl.textContent = `Recruiter sign-in failed: ${err.message}`;
        }
      });
    }

    loadData();
    // start polling for backend changes (will fetch periodically)
    startPolling();

    // pause polling when the page is hidden to save resources
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopPolling(); else startPolling();
    });

    // wire filter events (fired by Leaderboard.js)
    document.addEventListener('filter:change', onFilterChange);

    // wire pagination
    if (prevBtn) prevBtn.addEventListener('click', () => { if (currentPage > 1) renderPage(currentPage - 1); });
    if (nextBtn) nextBtn.addEventListener('click', () => { renderPage(currentPage + 1); });
  });

})();

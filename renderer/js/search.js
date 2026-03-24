/* ========================================
   NALANDA SEARCH - Search Functionality
   ======================================== */

let currentSearchEngine = 'nalanda';
const ResultsState = {
    view: 'list',
    selectedIndex: -1
};

// Initialize search functionality
function initializeSearch() {
    const searchForm = document.getElementById('searchForm');
    const searchInput = document.getElementById('searchInput');
    const resultsContainer = document.getElementById('resultsContainer');
    const resultsList = document.getElementById('resultsList');
    const closeResultsBtn = document.getElementById('closeResults');
    const indexBtn = document.getElementById('indexBtn');
    const resetIndexBtn = document.getElementById('resetIndexBtn');
    const crawlStatus = document.getElementById('crawlStatus');
    const crawlProgressFill = document.getElementById('crawlProgressFill');
    const snippetModal = setupSnippetModal();
    let statusTimer = null;
    
    // Load search preferences
    loadSearchPreferences();
    
    // Handle search form submission
    searchForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const query = searchInput.value.trim();
        if (!query) {
            window.App.notify('Please enter a search query', 'error');
            return;
        }
        
        await performSearch(query);
    });
    
    // Handle close results button
    closeResultsBtn.addEventListener('click', () => {
        hideResults();
        searchInput.focus();
    });

    setupResultsViewControls(resultsContainer, resultsList);
    setupResultsKeyboardNavigation(resultsContainer, resultsList, searchInput, snippetModal);

    // Handle index button
    if (indexBtn) {
        indexBtn.addEventListener('click', async () => {
            await startIndexing(indexBtn, resetIndexBtn, crawlStatus, () => {
                statusTimer = startStatusPolling(indexBtn, resetIndexBtn, crawlStatus, crawlProgressFill);
            });
        });
    }

    if (resetIndexBtn) {
        resetIndexBtn.addEventListener('click', async () => {
            if (!confirm('Reset the local index? This deletes indexed pages.')) {
                return;
            }
            await resetIndex(resetIndexBtn, crawlStatus, crawlProgressFill);
        });
    }
    
    // Handle Enter key in search input
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            searchForm.dispatchEvent(new Event('submit'));
        }
    });

    if (!statusTimer && crawlStatus) {
        statusTimer = startStatusPolling(indexBtn, resetIndexBtn, crawlStatus, crawlProgressFill);
    }
    ensureIndexOnLoad();
}

async function ensureIndexOnLoad() {
    try {
        const statusResponse = await fetch('/api/crawl-status');
        if (!statusResponse.ok) {
            return;
        }

        const status = await statusResponse.json();
        if (status.running || (status.indexed || 0) > 0) {
            return;
        }

        await fetch('/api/crawl', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                max_pages: 300,
                max_depth: 2
            })
        });
    } catch (error) {
        // silent fail to avoid blocking search UI
    }
}

// Load search preferences from settings
async function loadSearchPreferences() {
    try {
        const settings = await window.StorageAPI.getSettings();
        currentSearchEngine = settings.searchEngine || 'nalanda';
        if (settings.resultsView) {
            window.App.updateState('resultsView', settings.resultsView);
        }
    } catch (error) {
        console.error('Error loading search preferences:', error);
    }
}

// Perform search
async function performSearch(query) {
    try {
        console.log(`🔍 Searching for: "${query}" using ${currentSearchEngine}`);
        window.App.updateState('isSearching', true);

        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        if (!response.ok) {
            throw new Error('Search request failed');
        }
        const data = await response.json();
        showResults(data.results || [], query);
        
    } catch (error) {
        console.error('Search error:', error);
        window.App.notify('Search failed. Please try again.', 'error');
    } finally {
        window.App.updateState('isSearching', false);
    }
}

// Show results in webview
function showResults(results, query) {
    const resultsContainer = document.getElementById('resultsContainer');
    const resultsList = document.getElementById('resultsList');
    const resultsMeta = document.getElementById('resultsMeta');
    const uniqueDomains = new Set(
        results
            .map((result) => getHostname(result.url))
            .filter(Boolean)
    ).size;

    renderResults(resultsList, results);
    applyResultsView(resultsList);
    resultsMeta.innerHTML = [
        `<span class="meta-pill">${results.length} result${results.length === 1 ? '' : 's'}</span>`,
        `<span class="meta-pill">${uniqueDomains} source${uniqueDomains === 1 ? '' : 's'}</span>`,
        `<span class="meta-pill meta-query">${escapeHtml(query)}</span>`
    ].join('');
    resultsContainer.classList.remove('hidden');
    resultsList.scrollTop = 0;
    setSelectedResult(resultsList, results.length ? 0 : -1, false);
}

// Hide results and return to search
function hideResults() {
    const resultsContainer = document.getElementById('resultsContainer');
    const resultsList = document.getElementById('resultsList');
    const resultsMeta = document.getElementById('resultsMeta');

    resultsList.innerHTML = '';
    resultsMeta.textContent = '';
    resultsContainer.classList.add('hidden');
    setSelectedResult(resultsList, -1, false);
    closeSnippetPreview();
}

// Update search engine preference
function updateSearchEngine(engine) {
    currentSearchEngine = engine;
    console.log(`Search engine updated to: ${engine}`);
}

// Quick search suggestions (for future implementation)
function getSearchSuggestions(query) {
    // This can be implemented to fetch suggestions from search engines
    // For now, return empty array
    return [];
}

// Export functions for use in other modules
window.Search = {
    updateEngine: updateSearchEngine,
    loadPreferences: loadSearchPreferences
};

function renderResults(container, results) {
    if (!results.length) {
        container.innerHTML = `
            <div class="results-empty">
                <div class="results-empty-title">No matches yet</div>
                <div class="results-empty-text">Try another phrase or index more pages.</div>
            </div>
        `;
        return;
    }

    container.innerHTML = '';
    results.forEach((result, index) => {
        const hostname = getHostname(result.url);
        const path = getUrlPath(result.url);
        const relevance = Math.max(40, 100 - index * 8);
        const favicon = hostname
            ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=64`
            : '';

        const item = document.createElement('div');
        item.className = 'result-item';
        item.tabIndex = 0;
        item.dataset.resultIndex = String(index);
        item.style.setProperty('--result-delay', `${index * 60}ms`);
        item.addEventListener('focus', () => setSelectedResult(container, index, false));
        item.addEventListener('click', () => setSelectedResult(container, index, false));

        const title = document.createElement('a');
        title.className = 'result-title';
        title.href = result.url;
        title.target = '_blank';
        title.rel = 'noopener noreferrer';
        title.textContent = result.title || result.url;

        const top = document.createElement('div');
        top.className = 'result-top';

        const domain = document.createElement('div');
        domain.className = 'result-domain';
        domain.innerHTML = `
            ${favicon ? `<img class="result-favicon" src="${favicon}" alt="" loading="lazy">` : ''}
            <span>${escapeHtml(hostname || 'Unknown source')}</span>
        `;

        const score = document.createElement('div');
        score.className = 'result-score';
        score.textContent = `${relevance}% relevant`;

        top.appendChild(domain);
        top.appendChild(score);

        const snippet = document.createElement('div');
        snippet.className = 'result-snippet';
        snippet.innerHTML = sanitizeSnippet(result.snippet || '');

        const footer = document.createElement('div');
        footer.className = 'result-footer';

        const url = document.createElement('div');
        url.className = 'result-url';
        url.textContent = path ? `${hostname}${path}` : result.url;

        const openLink = document.createElement('a');
        openLink.className = 'result-open-link';
        openLink.href = result.url;
        openLink.target = '_blank';
        openLink.rel = 'noopener noreferrer';
        openLink.textContent = 'Open';

        const actions = document.createElement('div');
        actions.className = 'result-actions';

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'result-action-btn';
        copyBtn.textContent = 'Copy link';
        copyBtn.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            const copied = await copyToClipboard(result.url);
            window.App.notify(copied ? 'Link copied' : 'Copy failed', copied ? 'success' : 'error');
        });

        const cachedBtn = document.createElement('button');
        cachedBtn.type = 'button';
        cachedBtn.className = 'result-action-btn';
        cachedBtn.textContent = 'Cached snippet';
        cachedBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            openSnippetPreview(result);
        });

        const rankBar = document.createElement('div');
        rankBar.className = 'result-rankbar';
        rankBar.innerHTML = `<span style="width:${relevance}%"></span>`;

        actions.appendChild(copyBtn);
        actions.appendChild(cachedBtn);
        actions.appendChild(openLink);
        footer.appendChild(url);
        footer.appendChild(actions);

        item.appendChild(top);
        item.appendChild(title);
        item.appendChild(snippet);
        item.appendChild(rankBar);
        item.appendChild(footer);
        container.appendChild(item);
    });
}

function setupResultsViewControls(resultsContainer, resultsList) {
    const existing = document.getElementById('resultsViewControls');
    if (existing) {
        return;
    }

    const storedView = window.App.getState('resultsView');
    if (storedView === 'list' || storedView === 'grid' || storedView === 'compact') {
        ResultsState.view = storedView;
    }

    const header = resultsContainer.querySelector('.results-header');
    if (!header) {
        return;
    }

    const controls = document.createElement('div');
    controls.id = 'resultsViewControls';
    controls.className = 'results-view-controls';
    controls.innerHTML = `
        <button type="button" class="results-view-btn" data-view="list" title="List view (L)">List</button>
        <button type="button" class="results-view-btn" data-view="grid" title="Grid view (G)">Grid</button>
        <button type="button" class="results-view-btn" data-view="compact" title="Compact view (C)">Compact</button>
    `;

    controls.addEventListener('click', (event) => {
        const button = event.target.closest('.results-view-btn');
        if (!button) {
            return;
        }
        const nextView = button.dataset.view;
        if (!nextView) {
            return;
        }
        ResultsState.view = nextView;
        persistResultsView(nextView);
        updateResultsViewButtons();
        applyResultsView(resultsList);
    });

    header.insertBefore(controls, document.getElementById('resultsMeta'));
    updateResultsViewButtons();
    applyResultsView(resultsList);
}

function applyResultsView(resultsList) {
    resultsList.classList.remove('view-list', 'view-grid', 'view-compact');
    resultsList.classList.add(`view-${ResultsState.view}`);
}

function updateResultsViewButtons() {
    document.querySelectorAll('.results-view-btn').forEach((button) => {
        const isActive = button.dataset.view === ResultsState.view;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
}

function setupResultsKeyboardNavigation(resultsContainer, resultsList, searchInput, snippetModal) {
    document.addEventListener('keydown', (event) => {
        if (resultsContainer.classList.contains('hidden')) {
            return;
        }

        if (snippetModal && !snippetModal.classList.contains('hidden') && event.key === 'Escape') {
            event.preventDefault();
            closeSnippetPreview();
            return;
        }

        const target = event.target;
        const isTypingTarget = target instanceof HTMLElement &&
            (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

        if (isTypingTarget) {
            return;
        }

        switch (event.key.toLowerCase()) {
            case 'arrowdown':
            case 'j':
                event.preventDefault();
                moveSelectedResult(resultsList, 1);
                break;
            case 'arrowup':
            case 'k':
                event.preventDefault();
                moveSelectedResult(resultsList, -1);
                break;
            case 'enter': {
                const current = getCurrentSelectedResult(resultsList);
                if (!current) {
                    return;
                }
                const link = current.querySelector('.result-title');
                if (link instanceof HTMLElement) {
                    event.preventDefault();
                    link.click();
                }
                break;
            }
            case 'g':
                event.preventDefault();
                setResultsView('grid', resultsList);
                break;
            case 'c':
                event.preventDefault();
                setResultsView('compact', resultsList);
                break;
            case 'l':
                event.preventDefault();
                setResultsView('list', resultsList);
                break;
            case 'escape':
                event.preventDefault();
                hideResults();
                searchInput.focus();
                break;
            default:
                break;
        }
    });
}

function setResultsView(view, resultsList) {
    ResultsState.view = view;
    persistResultsView(view);
    applyResultsView(resultsList);
    updateResultsViewButtons();
}

function persistResultsView(view) {
    window.App.updateState('resultsView', view);
    window.StorageAPI.saveSettings({ resultsView: view }).catch(() => {});
}

function moveSelectedResult(resultsList, delta) {
    const cards = getResultCards(resultsList);
    if (!cards.length) {
        return;
    }
    const nextIndex = ResultsState.selectedIndex < 0
        ? 0
        : Math.min(cards.length - 1, Math.max(0, ResultsState.selectedIndex + delta));
    setSelectedResult(resultsList, nextIndex);
}

function setSelectedResult(resultsList, index, focus = true) {
    const cards = getResultCards(resultsList);
    cards.forEach((card) => card.classList.remove('is-selected'));

    if (index < 0 || index >= cards.length) {
        ResultsState.selectedIndex = -1;
        return;
    }

    ResultsState.selectedIndex = index;
    const selected = cards[index];
    selected.classList.add('is-selected');

    if (focus) {
        selected.focus({ preventScroll: true });
    }

    selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function getCurrentSelectedResult(resultsList) {
    if (ResultsState.selectedIndex < 0) {
        return null;
    }
    return getResultCards(resultsList)[ResultsState.selectedIndex] || null;
}

function getResultCards(resultsList) {
    return Array.from(resultsList.querySelectorAll('.result-item'));
}

function setupSnippetModal() {
    let modal = document.getElementById('snippetPreviewModal');
    if (modal) {
        return modal;
    }

    modal = document.createElement('div');
    modal.id = 'snippetPreviewModal';
    modal.className = 'snippet-preview-modal hidden';
    modal.innerHTML = `
        <div class="snippet-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="snippetPreviewTitle">
            <div class="snippet-preview-header">
                <h3 id="snippetPreviewTitle" class="snippet-preview-title">Cached snippet</h3>
                <button type="button" class="snippet-preview-close" aria-label="Close preview">×</button>
            </div>
            <a id="snippetPreviewLink" class="snippet-preview-link" href="#" target="_blank" rel="noopener noreferrer"></a>
            <div id="snippetPreviewBody" class="snippet-preview-body"></div>
        </div>
    `;

    modal.addEventListener('click', (event) => {
        if (event.target === modal || event.target.closest('.snippet-preview-close')) {
            closeSnippetPreview();
        }
    });

    document.body.appendChild(modal);
    return modal;
}

function openSnippetPreview(result) {
    const modal = document.getElementById('snippetPreviewModal');
    if (!modal) {
        return;
    }

    const titleEl = modal.querySelector('.snippet-preview-title');
    const linkEl = document.getElementById('snippetPreviewLink');
    const bodyEl = document.getElementById('snippetPreviewBody');

    titleEl.textContent = result.title || 'Cached snippet';
    linkEl.href = result.url;
    linkEl.textContent = result.url;
    bodyEl.innerHTML = sanitizeSnippet(result.snippet || 'No snippet available for this result.');

    modal.classList.remove('hidden');
}

function closeSnippetPreview() {
    const modal = document.getElementById('snippetPreviewModal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

async function copyToClipboard(text) {
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }

        const input = document.createElement('textarea');
        input.value = text;
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        input.remove();
        return true;
    } catch (error) {
        return false;
    }
}

function sanitizeSnippet(raw) {
    return escapeHtml(raw)
        .replace(/&lt;mark&gt;/g, '<mark>')
        .replace(/&lt;\/mark&gt;/g, '</mark>');
}

function escapeHtml(value) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    };
    return String(value).replace(/[&<>"']/g, (char) => map[char]);
}

function getHostname(url) {
    try {
        return new URL(url).hostname;
    } catch (error) {
        return '';
    }
}

function getUrlPath(url) {
    try {
        const parsed = new URL(url);
        return parsed.pathname === '/' ? '' : parsed.pathname;
    } catch (error) {
        return '';
    }
}

async function startIndexing(indexBtn, resetBtn, statusEl, onStarted) {
    try {
        window.App.notify('Indexing started...', 'info');
        setIndexButtonsState(indexBtn, resetBtn, true);
        updateCrawlStatus(statusEl, 'Index status: starting...');
        updateProgress(null, 0);

        const response = await fetch('/api/crawl', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                max_pages: 200,
                max_depth: 2
            })
        });

        if (response.status === 409) {
            updateCrawlStatus(statusEl, 'Index status: already running');
            return;
        }

        if (!response.ok) {
            let message = 'Indexing request failed';
            try {
                const payload = await response.json();
                if (payload && payload.error) {
                    message = payload.error;
                }
            } catch (error) {
                // Keep fallback message
            }
            throw new Error(message);
        }

        if (onStarted) {
            onStarted();
        }
    } catch (error) {
        console.error('Indexing error:', error);
        window.App.notify(`Indexing failed: ${error.message}`, 'error');
        setIndexButtonsState(indexBtn, resetBtn, false);
        updateCrawlStatus(statusEl, `Index status: error (${error.message})`);
    }
}

async function resetIndex(resetBtn, statusEl, progressEl) {
    try {
        resetBtn.disabled = true;
        updateCrawlStatus(statusEl, 'Index status: resetting...');
        updateProgress(progressEl, 0);
        const response = await fetch('/api/reset', {
            method: 'POST'
        });

        if (!response.ok) {
            let message = 'Reset request failed';
            try {
                const payload = await response.json();
                if (payload && payload.error) {
                    message = payload.error;
                }
            } catch (error) {
                // Keep fallback message
            }
            throw new Error(message);
        }

        updateCrawlStatus(statusEl, 'Index status: reset');
        updateProgress(progressEl, 0);
        window.App.notify('Index reset complete', 'success');
    } catch (error) {
        console.error('Reset error:', error);
        window.App.notify(`Reset failed: ${error.message}`, 'error');
        updateCrawlStatus(statusEl, `Index status: error (${error.message})`);
    } finally {
        resetBtn.disabled = false;
    }
}

function startStatusPolling(indexBtn, resetBtn, statusEl, progressEl) {
    const timer = setInterval(async () => {
        try {
            const response = await fetch('/api/crawl-status');
            if (!response.ok) {
                return;
            }
            const data = await response.json();
            const indexed = data.indexed || 0;
            const maxPages = data.max_pages || 0;
            const lastUrl = data.last_url ? ` • ${data.last_url}` : '';

            if (data.running) {
                const totalText = maxPages ? `${indexed}/${maxPages}` : `${indexed}`;
                updateCrawlStatus(statusEl, `Index status: running (${totalText})${lastUrl}`);
                setIndexButtonsState(indexBtn, resetBtn, true);
                if (maxPages > 0) {
                    updateProgress(progressEl, Math.min(100, Math.round((indexed / maxPages) * 100)));
                }
            } else {
                setIndexButtonsState(indexBtn, resetBtn, false);
                if (data.error) {
                    updateCrawlStatus(statusEl, `Index status: error (${data.error})`);
                    updateProgress(progressEl, 0);
                } else if (indexed > 0) {
                    updateCrawlStatus(statusEl, `Index status: done (${indexed} pages)`);
                    if (maxPages > 0) {
                        updateProgress(progressEl, Math.min(100, Math.round((indexed / maxPages) * 100)));
                    } else {
                        updateProgress(progressEl, 100);
                    }
                } else {
                    updateCrawlStatus(statusEl, 'Index status: idle');
                    updateProgress(progressEl, 0);
                }
                clearInterval(timer);
            }
        } catch (error) {
            clearInterval(timer);
        }
    }, 1000);

    return timer;
}

function setIndexButtonsState(indexBtn, resetBtn, isRunning) {
    if (indexBtn) {
        indexBtn.disabled = isRunning;
    }
    if (resetBtn) {
        resetBtn.disabled = isRunning;
    }
}

function updateCrawlStatus(statusEl, message) {
    if (statusEl) {
        statusEl.textContent = message;
    }
}

function updateProgress(progressEl, percent) {
    if (!progressEl) {
        return;
    }
    progressEl.style.width = `${percent}%`;
}

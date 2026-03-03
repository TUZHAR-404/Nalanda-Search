/* ========================================
   NALANDA SEARCH - Search Functionality
   ======================================== */

let currentSearchEngine = 'duckduckgo';
let openInBrowser = false;

// Initialize search functionality
function initializeSearch() {
    const searchForm = document.getElementById('searchForm');
    const searchInput = document.getElementById('searchInput');
    const resultsContainer = document.getElementById('resultsContainer');
    const resultsWebview = document.getElementById('resultsWebview');
    const closeResultsBtn = document.getElementById('closeResults');
    
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
    
    // Handle Enter key in search input
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            searchForm.dispatchEvent(new Event('submit'));
        }
    });
}

// Load search preferences from settings
async function loadSearchPreferences() {
    try {
        const settings = await window.electronAPI.getSettings();
        currentSearchEngine = settings.searchEngine || 'duckduckgo';
        openInBrowser = settings.openInBrowser || false;
    } catch (error) {
        console.error('Error loading search preferences:', error);
    }
}

// Perform search
async function performSearch(query) {
    try {
        console.log(`🔍 Searching for: "${query}" using ${currentSearchEngine}`);
        window.App.updateState('isSearching', true);
        
        // Get search URL from main process
        const result = await window.electronAPI.search(query, currentSearchEngine);
        
        if (openInBrowser) {
            // Open in external browser
            await window.electronAPI.openExternal(result.url);
            window.App.notify('Opening in browser...', 'success');
        } else {
            // Open in built-in webview
            showResults(result.url, query);
        }
        
        // Clear search input
        // document.getElementById('searchInput').value = '';
        
    } catch (error) {
        console.error('Search error:', error);
        window.App.notify('Search failed. Please try again.', 'error');
    } finally {
        window.App.updateState('isSearching', false);
    }
}

// Show results in webview
function showResults(url, query) {
    const resultsContainer = document.getElementById('resultsContainer');
    const resultsWebview = document.getElementById('resultsWebview');
    const mainContent = document.getElementById('mainContent');
    
    // Set webview source
    resultsWebview.src = url;
    
    // Show results container
    resultsContainer.classList.remove('hidden');
    
    // Add event listeners to webview
    setupWebviewListeners(resultsWebview);
    
    console.log(`📄 Loading results for: ${query}`);
}

// Hide results and return to search
function hideResults() {
    const resultsContainer = document.getElementById('resultsContainer');
    const resultsWebview = document.getElementById('resultsWebview');
    
    // Clear webview
    resultsWebview.src = '';
    
    // Hide results container
    resultsContainer.classList.add('hidden');
}

// Setup webview event listeners
function setupWebviewListeners(webview) {
    // Loading started
    webview.addEventListener('did-start-loading', () => {
        console.log('🔄 Loading...');
    });
    
    // Loading finished
    webview.addEventListener('did-finish-load', () => {
        console.log('✅ Page loaded');
    });
    
    // Loading failed
    webview.addEventListener('did-fail-load', (e) => {
        if (e.errorCode !== -3) { // Ignore aborted loads
            console.error('❌ Failed to load:', e);
            window.App.notify('Failed to load page', 'error');
        }
    });
    
    // New window requested
    webview.addEventListener('new-window', (e) => {
        e.preventDefault();
        window.electronAPI.openExternal(e.url);
    });
}

// Update search engine preference
function updateSearchEngine(engine) {
    currentSearchEngine = engine;
    console.log(`Search engine updated to: ${engine}`);
}

// Update open in browser preference
function updateOpenInBrowser(value) {
    openInBrowser = value;
    console.log(`Open in browser: ${value}`);
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
    updateOpenInBrowser: updateOpenInBrowser,
    loadPreferences: loadSearchPreferences
};

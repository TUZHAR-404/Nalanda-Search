/* ========================================
   NALANDA SEARCH - Main Application Logic
   ======================================== */

// Application state
const AppState = {
    settings: null,
    isSearching: false,
    sidebarOpen: false
};

// Initialize the application
async function initializeApp() {
    console.log('🐘 Nalanda Search - Starting...');
    
    try {
        // Load saved settings
        AppState.settings = await window.electronAPI.getSettings();
        console.log('Settings loaded:', AppState.settings);
        
        // Apply saved settings
        applySettings();
        
        // Setup event listeners
        setupEventListeners();
        
        // Initialize modules
        initializeSearch();
        initializeSpeech();
        initializeSettings();
        
        console.log('✅ Nalanda Search - Ready!');
        
        // Focus search input on startup
        setTimeout(() => {
            document.getElementById('searchInput').focus();
        }, 300);
        
    } catch (error) {
        console.error('❌ Error initializing app:', error);
    }
}

// Apply loaded settings to the UI
function applySettings() {
    const { theme, backgroundType, backgroundColor, backgroundGradient, backgroundImage } = AppState.settings;
    
    // Apply theme
    document.body.className = `theme-${theme}`;
    
    // Apply background
    document.body.classList.add(`bg-${backgroundType}`);
    
    switch (backgroundType) {
        case 'solid':
            document.body.style.setProperty('--bg-color', backgroundColor);
            break;
        case 'gradient':
            document.body.style.setProperty('--bg-gradient', backgroundGradient);
            break;
        case 'image':
            if (backgroundImage) {
                document.body.style.setProperty('--bg-image', `url('${backgroundImage}')`);
            }
            break;
    }
}

// Setup global event listeners
function setupEventListeners() {
    // Settings button
    const settingsBtn = document.getElementById('settingsBtn');
    const sidebar = document.getElementById('sidebar');
    const closeSidebarBtn = document.getElementById('closeSidebar');
    const mainContent = document.getElementById('mainContent');
    
    settingsBtn.addEventListener('click', () => {
        sidebar.classList.add('open');
        mainContent.classList.add('sidebar-open');
        AppState.sidebarOpen = true;
    });
    
    closeSidebarBtn.addEventListener('click', () => {
        sidebar.classList.remove('open');
        mainContent.classList.remove('sidebar-open');
        AppState.sidebarOpen = false;
    });
    
    // Close sidebar on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && AppState.sidebarOpen) {
            sidebar.classList.remove('open');
            mainContent.classList.remove('sidebar-open');
            AppState.sidebarOpen = false;
        }
    });
    
    // Global keyboard shortcuts
    setupKeyboardShortcuts();
}

// Setup keyboard shortcuts
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Ctrl/Cmd + K: Focus search
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            const searchInput = document.getElementById('searchInput');
            searchInput.focus();
            searchInput.select();
        }
        
        // Ctrl/Cmd + ,: Open settings
        if ((e.ctrlKey || e.metaKey) && e.key === ',') {
            e.preventDefault();
            const sidebar = document.getElementById('sidebar');
            const mainContent = document.getElementById('mainContent');
            sidebar.classList.add('open');
            mainContent.classList.add('sidebar-open');
            AppState.sidebarOpen = true;
        }
        
        // Alt + M: Activate microphone
        if (e.altKey && e.key === 'm') {
            e.preventDefault();
            const micBtn = document.getElementById('micBtn');
            micBtn.click();
        }
    });
}

// Update application state
function updateAppState(key, value) {
    AppState[key] = value;
}

// Get application state
function getAppState(key) {
    return AppState[key];
}

// Utility: Show notification
function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 1rem 1.5rem;
        background: ${type === 'error' ? '#e53e3e' : type === 'success' ? '#38a169' : '#3182ce'};
        color: white;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        z-index: 10000;
        animation: slideInRight 0.3s ease;
    `;
    
    document.body.appendChild(notification);
    
    // Auto remove after 3 seconds
    setTimeout(() => {
        notification.style.animation = 'slideOutRight 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Add slide animations to CSS dynamically
const style = document.createElement('style');
style.textContent = `
    @keyframes slideInRight {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOutRight {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}

// Export for use in other modules
window.App = {
    updateState: updateAppState,
    getState: getAppState,
    notify: showNotification,
    applySettings: applySettings
};

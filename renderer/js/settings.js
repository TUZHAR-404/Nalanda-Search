/* ========================================
   NALANDA SEARCH - Settings Management
   ======================================== */

let currentSettings = {};
let agents = [];

// Initialize settings
function initializeSettings() {
    loadSettings();
    setupSettingsEventListeners();
    loadAgents();
}

// Load settings from storage
async function loadSettings() {
    try {
        currentSettings = await window.StorageAPI.getSettings();
        populateSettingsUI();
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

// Populate settings UI with current values
function populateSettingsUI() {
    // Theme
    const themeSelect = document.getElementById('themeSelect');
    themeSelect.value = currentSettings.theme || 'dark';
    
    // Background type
    const backgroundType = document.getElementById('backgroundType');
    backgroundType.value = currentSettings.backgroundType || 'solid';
    updateBackgroundOptions(currentSettings.backgroundType);
    
    // Background color
    const backgroundColor = document.getElementById('backgroundColor');
    backgroundColor.value = currentSettings.backgroundColor || '#1a1a1a';
    
    // Search engine
    const searchEngine = document.getElementById('searchEngine');
    searchEngine.value = currentSettings.searchEngine || 'duckduckgo';
    
    // Privacy mode
    const privacyMode = document.getElementById('privacyMode');
    if (privacyMode) {
        privacyMode.checked = currentSettings.privacyMode !== false;
    }
}

// Setup settings event listeners
function setupSettingsEventListeners() {
    // Theme change
    document.getElementById('themeSelect').addEventListener('change', async (e) => {
        const theme = e.target.value;
        document.body.className = `theme-${theme}`;
        
        // Keep background class
        document.body.classList.add(`bg-${currentSettings.backgroundType}`);
        
        await saveSetting('theme', theme);
        window.App.notify('Theme updated', 'success');
    });
    
    // Background type change
    document.getElementById('backgroundType').addEventListener('change', async (e) => {
        const bgType = e.target.value;
        updateBackgroundOptions(bgType);
        await applyBackgroundSetting(bgType);
    });
    
    // Background color change
    document.getElementById('backgroundColor').addEventListener('change', async (e) => {
        const color = e.target.value;
        document.body.style.setProperty('--bg-color', color);
        await saveSetting('backgroundColor', color);
    });
    
    // Gradient buttons
    document.querySelectorAll('.gradient-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const gradient = e.target.dataset.gradient || e.target.style.background;
            document.body.style.setProperty('--bg-gradient', gradient);
            await saveSetting('backgroundGradient', gradient);
            window.App.notify('Gradient applied', 'success');
        });
    });
    
    // Background image
    document.getElementById('backgroundImage').addEventListener('change', async (e) => {
        const imageUrl = e.target.value.trim();
        if (imageUrl) {
            document.body.style.setProperty('--bg-image', `url('${imageUrl}')`);
            await saveSetting('backgroundImage', imageUrl);
            window.App.notify('Background image applied', 'success');
        }
    });
    
    // Search engine change
    document.getElementById('searchEngine').addEventListener('change', async (e) => {
        const engine = e.target.value;
        await saveSetting('searchEngine', engine);
        window.Search.updateEngine(engine);
        window.App.notify(`Search engine: ${engine}`, 'success');
    });
    
    // Privacy mode toggle
    const privacyMode = document.getElementById('privacyMode');
    if (privacyMode) {
        privacyMode.addEventListener('change', async (e) => {
            await saveSetting('privacyMode', e.target.checked);
        });
    }
    
    // Agent management
    document.getElementById('addAgent').addEventListener('click', showAgentModal);
    document.getElementById('cancelAgent').addEventListener('click', hideAgentModal);
    document.getElementById('agentForm').addEventListener('submit', handleAddAgent);
    
    // Close modal on background click
    document.getElementById('agentModal').addEventListener('click', (e) => {
        if (e.target.id === 'agentModal') {
            hideAgentModal();
        }
    });
}

// Update background options visibility
function updateBackgroundOptions(bgType) {
    const solidOption = document.getElementById('solidColorOption');
    const gradientOption = document.getElementById('gradientOption');
    const imageOption = document.getElementById('imageOption');
    
    solidOption.classList.add('hidden');
    gradientOption.classList.add('hidden');
    imageOption.classList.add('hidden');
    
    switch (bgType) {
        case 'solid':
            solidOption.classList.remove('hidden');
            break;
        case 'gradient':
            gradientOption.classList.remove('hidden');
            break;
        case 'image':
            imageOption.classList.remove('hidden');
            break;
    }
}

// Apply background setting
async function applyBackgroundSetting(bgType) {
    // Remove all background classes
    document.body.classList.remove('bg-solid', 'bg-gradient', 'bg-image');
    
    // Add new background class
    document.body.classList.add(`bg-${bgType}`);
    
    // Apply the appropriate background
    switch (bgType) {
        case 'solid':
            document.body.style.setProperty('--bg-color', currentSettings.backgroundColor || '#1a1a1a');
            break;
        case 'gradient':
            document.body.style.setProperty('--bg-gradient', currentSettings.backgroundGradient || 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)');
            break;
        case 'image':
            if (currentSettings.backgroundImage) {
                document.body.style.setProperty('--bg-image', `url('${currentSettings.backgroundImage}')`);
            }
            break;
    }
    
    await saveSetting('backgroundType', bgType);
    window.App.notify('Background updated', 'success');
}

// Save a single setting
async function saveSetting(key, value) {
    try {
        currentSettings[key] = value;
        await window.StorageAPI.saveSettings({ [key]: value });
        console.log(`Setting saved: ${key} = ${value}`);
    } catch (error) {
        console.error('Error saving setting:', error);
        window.App.notify('Failed to save setting', 'error');
    }
}

// ========================================
// AGENT MANAGEMENT
// ========================================

// Load agents
async function loadAgents() {
    try {
        agents = await window.StorageAPI.getAgents();
        renderAgents();
    } catch (error) {
        console.error('Error loading agents:', error);
    }
}

// Render agents list
function renderAgents() {
    const agentsList = document.getElementById('agentsList');
    
    if (agents.length === 0) {
        agentsList.innerHTML = '<p style="color: #888; font-size: 0.9rem;">No agents configured yet.</p>';
        return;
    }
    
    agentsList.innerHTML = agents.map((agent, index) => `
        <div class="agent-card">
            <div class="agent-info">
                <h4>${escapeHtml(agent.name)}</h4>
                <p>${escapeHtml(agent.description || 'No description')}</p>
                ${agent.endpoint ? `<small style="color: #888; font-size: 0.75rem;">${escapeHtml(agent.endpoint)}</small>` : ''}
            </div>
            <div class="agent-actions">
                <div class="agent-toggle ${agent.enabled ? 'active' : ''}" data-index="${index}"></div>
                <button class="delete-agent" data-index="${index}" title="Delete agent">🗑️</button>
            </div>
        </div>
    `).join('');
    
    // Add event listeners
    document.querySelectorAll('.agent-toggle').forEach(toggle => {
        toggle.addEventListener('click', (e) => {
            const index = parseInt(e.target.dataset.index);
            toggleAgent(index);
        });
    });
    
    document.querySelectorAll('.delete-agent').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const index = parseInt(e.target.dataset.index);
            deleteAgent(index);
        });
    });
}

// Show agent modal
function showAgentModal() {
    const modal = document.getElementById('agentModal');
    modal.classList.remove('hidden');
    document.getElementById('agentName').focus();
}

// Hide agent modal
function hideAgentModal() {
    const modal = document.getElementById('agentModal');
    modal.classList.add('hidden');
    document.getElementById('agentForm').reset();
}

// Handle add agent
async function handleAddAgent(e) {
    e.preventDefault();
    
    const name = document.getElementById('agentName').value.trim();
    const description = document.getElementById('agentDescription').value.trim();
    const endpoint = document.getElementById('agentEndpoint').value.trim();
    
    if (!name) {
        window.App.notify('Please enter an agent name', 'error');
        return;
    }
    
    const newAgent = {
        id: Date.now(),
        name,
        description,
        endpoint,
        enabled: true,
        createdAt: new Date().toISOString()
    };
    
    agents.push(newAgent);
    await saveAgents();
    renderAgents();
    hideAgentModal();
    
    window.App.notify('Agent added successfully', 'success');
}

// Toggle agent enabled state
async function toggleAgent(index) {
    if (agents[index]) {
        agents[index].enabled = !agents[index].enabled;
        await saveAgents();
        renderAgents();
        
        const status = agents[index].enabled ? 'enabled' : 'disabled';
        window.App.notify(`Agent ${status}`, 'info');
    }
}

// Delete agent
async function deleteAgent(index) {
    if (agents[index]) {
        const agentName = agents[index].name;
        agents.splice(index, 1);
        await saveAgents();
        renderAgents();
        window.App.notify(`Agent "${agentName}" deleted`, 'info');
    }
}

// Save agents to storage
async function saveAgents() {
    try {
        await window.StorageAPI.saveAgents(agents);
    } catch (error) {
        console.error('Error saving agents:', error);
        window.App.notify('Failed to save agents', 'error');
    }
}

// Utility: Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Export for use in other modules
window.Settings = {
    load: loadSettings,
    save: saveSetting,
    getAgents: () => agents,
    loadAgents: loadAgents
};

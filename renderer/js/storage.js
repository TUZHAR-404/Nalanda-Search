const DEFAULT_SETTINGS = {
    theme: "dark",
    backgroundType: "solid",
    backgroundColor: "#1a1a1a",
    backgroundGradient: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    backgroundImage: "",
    searchEngine: "webfast",
    privacyMode: true,
    resultsView: "list"
};

const StorageAPI = {
    async getSettings() {
        try {
            const response = await fetch('/api/settings');
            if (!response.ok) {
                throw new Error('Failed to fetch settings');
            }
            const payload = await response.json();
            const stored = payload.settings || {};
            return { ...DEFAULT_SETTINGS, ...stored };
        } catch (error) {
            return { ...DEFAULT_SETTINGS };
        }
    },
    async saveSettings(partial) {
        const current = await StorageAPI.getSettings();
        const next = { ...current, ...partial };
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(partial)
        });
        if (!response.ok) {
            throw new Error('Failed to save settings');
        }
        const payload = await response.json();
        return { ...DEFAULT_SETTINGS, ...(payload.settings || next) };
    },
    async getAgents() {
        const response = await fetch('/api/agents');
        if (!response.ok) {
            return [];
        }
        const payload = await response.json();
        return payload.agents || [];
    },
    async saveAgents(agents) {
        const response = await fetch('/api/agents', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ agents })
        });
        if (!response.ok) {
            throw new Error('Failed to save agents');
        }
        const payload = await response.json();
        return payload.agents || agents;
    }
};

window.StorageAPI = StorageAPI;

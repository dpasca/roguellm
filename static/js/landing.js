// Language configuration
const SUPPORTED_LANGUAGES = [
    { code: 'en', name: 'English' },
    { code: 'it', name: 'Italiano' },
];

// Translations
const TRANSLATIONS = {
    en: {
        title: 'RogueLLM',
        subtitle: 'An experimental roguelike game powered by AI',
        selectTheme: 'Select Your Theme',
        fantasyTheme: 'Fantasy Theme',
        customTheme: 'Custom Theme',
        generatorTheme: 'Generator Theme',
        useGameId: 'Use Game ID',
        customThemeDescription: 'Enter a description for your custom theme:',
        generatorIdLabel: 'Enter Game ID:',
        startGame: 'Start Game',
        createGame: 'Create Game',
        errorGameId: 'Please enter a Game ID',
        by: 'by'
    },
    it: {
        title: 'RogueLLM',
        subtitle: 'Un gioco roguelike sperimentale basato su IA',
        selectTheme: 'Seleziona il tuo Tema',
        fantasyTheme: 'Tema Fantasy',
        customTheme: 'Tema Personalizzato',
        generatorTheme: 'Tema Generatore',
        useGameId: 'Usa ID Gioco',
        customThemeDescription: 'Inserisci una descrizione per il tuo tema personalizzato:',
        generatorIdLabel: 'Inserisci ID Gioco:',
        startGame: 'Inizia Gioco',
        createGame: 'Crea Gioco',
        errorGameId: 'Inserisci un ID Gioco',
        by: 'di'
    }
};

const app = Vue.createApp({
    data() {
        return {
            selectedTheme: 'custom',
            customDescription: '',
            generatorId: '',
            errorMessage: null,
            doWebSearch: true,
            selectedLanguage: this.getDefaultLanguage(),
            supportedLanguages: SUPPORTED_LANGUAGES,
            translations: TRANSLATIONS
        }
    },
    watch: {
        // Add watcher for generatorId to clean up pasted URLs
        generatorId(newValue) {
            if (!newValue) return;

            try {
                // Try to parse as URL first
                const url = new URL(newValue);
                const searchParams = new URLSearchParams(url.search);
                const id = searchParams.get('generator_id') || searchParams.get('game_id');
                if (id) {
                    this.generatorId = id; // This will trigger the watcher again, but with just the ID
                    return;
                }
            } catch (e) {
                // Not a URL, treat as raw ID (no change needed)
            }
        }
    },
    methods: {
        t(key) {
            return this.translations[this.selectedLanguage][key] || key;
        },
        clearError() {
            this.errorMessage = null;
        },
        async launchGame() {
            this.clearError();

            // Validate generator ID if generator theme selected
            if (this.selectedTheme === 'generator' && !this.generatorId.trim()) {
                this.errorMessage = this.t('errorGameId');
                return;
            }

            try {
                const response = await fetch('/api/create_game', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        theme: this.selectedTheme === 'custom' ? this.customDescription : null,
                        generator_id: this.selectedTheme === 'generator' ? this.generatorId.trim() : null,
                        language: this.selectedLanguage,
                        do_web_search: this.doWebSearch
                    })
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Failed to create game');
                }

                if (data.error) {
                    this.errorMessage = data.error;
                    return;
                }

                // Redirect to game page with game_id if it exists
                const params = new URLSearchParams();
                if (this.selectedTheme === 'generator') {
                    params.append('game_id', this.generatorId.trim());
                }
                window.location.href = `/game${params.toString() ? '?' + params.toString() : ''}`;
            } catch (error) {
                this.errorMessage = error.message || "Failed to start game. Please try again.";
            }
        },
        getDefaultLanguage() {
            const browserLang = navigator.language || navigator.userLanguage;

            // Handle special cases for Chinese
            if (browserLang.startsWith('zh')) {
                return browserLang.includes('TW') || browserLang.includes('HK') ? 'zh-TW' : 'zh-CN';
            }

            // For other languages, just take the first part before the dash
            const shortLang = browserLang.split('-')[0];
            const supportedCodes = SUPPORTED_LANGUAGES.map(lang => lang.code);
            return supportedCodes.includes(shortLang) ? shortLang : 'en';
        }
    },
    mounted() {
        // Check if there's a generator_id in the URL
        const urlParams = new URLSearchParams(window.location.search);
        const generatorId = urlParams.get('generator');
        if (generatorId) {
            this.selectedTheme = 'generator';
            this.generatorId = generatorId;
        }
    }
});

app.mount('#app');

// Language configuration
const SUPPORTED_LANGUAGES = [
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Español' },
    { code: 'it', name: 'Italiano' },
    { code: 'ja', name: '日本語' },
    { code: 'zh-Hans', name: '简体中文' },
    { code: 'zh-Hant', name: '繁體中文' },
];

// Configuration for external links and common values
const CONFIG = {
    links: {
        author: {
            url: 'https://newtypekk.com/',
            text: 'NEWTYPE'
        }
    },
    defaultLanguage: 'en',
    fallbackLanguage: 'en'
};

const app = Vue.createApp({
    data() {
        return {
            selectedTheme: 'custom',
            customDescription: '',
            generatorId: '',
            errorMessage: null,
            doWebSearch: true,
            selectedLanguage: 'en',
            supportedLanguages: SUPPORTED_LANGUAGES,
            rawTranslations: {},
            config: CONFIG,
            isLoading: true
        }
    },
    computed: {
        currentTranslations() {
            return this.rawTranslations[this.selectedLanguage] || {};
        },
        fallbackTranslations() {
            return this.rawTranslations[CONFIG.fallbackLanguage] || {};
        }
    },
    watch: {
        async selectedLanguage(newLang) {
            console.log(`Language changed to: ${newLang}`);
            if (!this.rawTranslations[newLang]) {
                await this.loadTranslations(newLang);
            }
            localStorage.setItem('preferredLanguage', newLang);
        },
        rawTranslations: {
            deep: true,
            handler(newVal) {
                console.log('Translations updated:', {
                    currentLang: this.selectedLanguage,
                    hasCurrentLang: !!newVal[this.selectedLanguage],
                    selectThemeTranslation: newVal[this.selectedLanguage]?.selectTheme
                });
                // Force a re-render when translations change
                this.$forceUpdate();
            }
        },
        generatorId(newValue) {
            if (!newValue) return;

            try {
                // Try to parse as URL first
                const url = new URL(newValue);
                const searchParams = new URLSearchParams(url.search);
                const id = searchParams.get('generator_id') || searchParams.get('game_id');
                if (id) {
                    this.generatorId = id;
                    return;
                }
            } catch (e) {
                // Not a URL, treat as raw ID (no change needed)
            }
        }
    },
    methods: {
        async loadTranslations(lang) {
            try {
                console.log(`Loading translations for ${lang}...`);
                const response = await fetch(`static/translations/${lang}.json`);

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const translations = await response.json();
                console.log(`Raw translations loaded for ${lang}:`, translations);

                // Filter out comment keys (those starting with //)
                const filteredTranslations = Object.fromEntries(
                    Object.entries(translations).filter(([key]) => !key.startsWith('//'))
                );

                // Update translations object ensuring reactivity
                const newTranslations = { ...this.rawTranslations };
                newTranslations[lang] = filteredTranslations;
                this.rawTranslations = newTranslations;

                return filteredTranslations;
            } catch (error) {
                console.error(`Error loading translations for ${lang}:`, error);
                return null;
            }
        },
        t(key, params = {}) {
            //console.log(`Translation requested for key: "${key}"`);
            //console.log(`Current language: ${this.selectedLanguage}`);
            //console.log(`Current translations:`, this.currentTranslations);
            //console.log(`Fallback translations:`, this.fallbackTranslations);

            // Get translation from current language or fallback
            const translation = this.currentTranslations[key] || this.fallbackTranslations[key] || key;

            //console.log(`Translation result for "${key}": "${translation}"`);

            if (!this.currentTranslations[key] && !this.fallbackTranslations[key]) {
                console.warn(`Missing translation for key: ${key} in language: ${this.selectedLanguage}`);
            }

            if (Object.keys(params).length === 0) {
                return translation;
            }

            return translation.replace(/\{(\w+)\}/g, (match, paramKey) => {
                return params[paramKey] !== undefined ? params[paramKey] : match;
            });
        },
        clearError() {
            this.errorMessage = null;
        },
        async launchGame() {
            this.clearError();

            if (this.selectedTheme === 'generator' && !this.generatorId.trim()) {
                this.errorMessage = this.t('errorGameId');
                return;
            }

            // Show loading screen immediately
            const loadingOverlay = document.querySelector('.loading-overlay');
            const loadingMessage = document.querySelector('#loading-message');
            if (loadingOverlay && loadingMessage) {
                loadingMessage.textContent = 'Creating game session...';
                loadingOverlay.style.display = 'flex';
            }

            // Track game launch
            if (window.analytics) {
                analytics.logEvent('game_started', {
                    theme: this.selectedTheme,
                    language: this.selectedLanguage,
                    do_web_search: this.doWebSearch
                });
            }

            try {
                // Use the new session-based API
                const response = await fetch('/api/create_game_session', {
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

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'Failed to create game session');
                }

                const data = await response.json();

                // Redirect to the session-specific game URL
                const gameUrl = `/game/${data.session_id}?lang=${this.selectedLanguage}`;
                window.location.href = gameUrl;

            } catch (error) {
                console.error('Error creating game session:', error);
                this.errorMessage = error.message || this.t('errors.failedToCreate');

                // Hide loading screen on error
                if (loadingOverlay) {
                    loadingOverlay.style.display = 'none';
                }
            }
        },
        handleKeyDown(event) {
            if (event.key === 'Enter') {
                if (!event.shiftKey) {
                    event.preventDefault();
                    this.launchGame();
                }
            }
        },
        async initialize() {
            console.log('Starting initialization...');
            try {
                // Load fallback language first
                console.log(`Loading fallback language: ${CONFIG.fallbackLanguage}`);
                const fallbackResult = await this.loadTranslations(CONFIG.fallbackLanguage);
                console.log('Fallback language loaded:', fallbackResult);

                // Set initial language
                const initialLang = this.getDefaultLanguage();
                console.log(`Initial language determined: ${initialLang}`);

                // Load selected language if different from fallback
                if (initialLang !== CONFIG.fallbackLanguage) {
                    console.log(`Loading initial language: ${initialLang}`);
                    await this.loadTranslations(initialLang);
                }

                this.selectedLanguage = initialLang;
                console.log('Setting isLoading to false');
                this.isLoading = false;
                console.log('Initialization complete');
            } catch (error) {
                console.error('Error during initialization:', error);
                // Even if there's an error, we should still show the interface
                this.isLoading = false;
            }
        },
        getDefaultLanguage() {
            const urlParams = new URLSearchParams(window.location.search);
            const urlLang = urlParams.get('lang');
            if (urlLang && SUPPORTED_LANGUAGES.some(lang => lang.code === urlLang)) {
                return urlLang;
            }

            const storedLang = localStorage.getItem('preferredLanguage');
            if (storedLang && SUPPORTED_LANGUAGES.some(lang => lang.code === storedLang)) {
                return storedLang;
            }

            const browserLang = navigator.language || navigator.userLanguage;
            if (browserLang.startsWith('zh')) {
                return browserLang.includes('TW') || browserLang.includes('HK') || browserLang.includes('MO') ? 'zh-Hant' : CONFIG.defaultLanguage;
            }

            const shortLang = browserLang.split('-')[0];
            const supportedCodes = SUPPORTED_LANGUAGES.map(lang => lang.code);
            return supportedCodes.includes(shortLang) ? shortLang : CONFIG.defaultLanguage;
        }
    },
    async mounted() {
        await this.initialize();

        const urlParams = new URLSearchParams(window.location.search);
        const generatorId = urlParams.get('generator');
        if (generatorId) {
            this.selectedTheme = 'generator';
            this.generatorId = generatorId;
        }

        // Track page view
        if (window.analytics) {
            analytics.logEvent('page_view', {
                page_title: 'Landing Page',
                page_location: window.location.href,
                page_path: window.location.pathname
            });
        }
    }
});

app.mount('#app');

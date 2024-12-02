// Language configuration
const SUPPORTED_LANGUAGES = [
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Español' },
    { code: 'it', name: 'Italiano' },
    { code: 'ja', name: '日本語' },
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
            selectedLanguage: this.getDefaultLanguage(),
            supportedLanguages: SUPPORTED_LANGUAGES,
            translations: {},
            config: CONFIG
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
        },
        async selectedLanguage(newLang) {
            await this.loadTranslations(newLang);
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
                console.log(`Successfully loaded translations for ${lang}:`, translations);
                this.translations[lang] = translations;
            } catch (error) {
                console.error(`Error loading translations for ${lang}:`, error);
                // If we failed to load a non-fallback language, try to use fallback
                if (lang !== CONFIG.fallbackLanguage) {
                    console.log(`Falling back to ${CONFIG.fallbackLanguage} translations`);
                }
            }
        },
        t(key, params = {}) {
            // Helper function to get nested value
            const getNestedValue = (obj, path) => {
                return path.split('.').reduce((current, part) => current?.[part], obj);
            };

            // Try selected language first
            let translation = getNestedValue(this.translations[this.selectedLanguage], key);

            // Fall back to default language if translation is missing
            if (!translation && this.selectedLanguage !== CONFIG.fallbackLanguage) {
                translation = getNestedValue(this.translations[CONFIG.fallbackLanguage], key);
            }

            // Return key if no translation found
            if (!translation) {
                console.warn(`Missing translation for key: ${key} in language: ${this.selectedLanguage}`);
                return key;
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
                // Always add the selected language to the URL
                params.append('lang', this.selectedLanguage);
                
                // Store the language preference
                localStorage.setItem('preferredLanguage', this.selectedLanguage);
                
                window.location.href = `/game${params.toString() ? '?' + params.toString() : ''}`;
            } catch (error) {
                this.errorMessage = error.message || "Failed to start game. Please try again.";
            }
        },
        getDefaultLanguage() {
            // Try to get language from URL first
            const urlParams = new URLSearchParams(window.location.search);
            const urlLang = urlParams.get('lang');
            if (urlLang && SUPPORTED_LANGUAGES.some(lang => lang.code === urlLang)) {
                return urlLang;
            }

            // Then try localStorage
            const storedLang = localStorage.getItem('preferredLanguage');
            if (storedLang && SUPPORTED_LANGUAGES.some(lang => lang.code === storedLang)) {
                return storedLang;
            }

            // Finally, try browser language
            const browserLang = navigator.language || navigator.userLanguage;

            // Handle special cases for Chinese
            if (browserLang.startsWith('zh')) {
                // For Traditional Chinese regions (TW, HK, MO), use zh-Hant
                return browserLang.includes('TW') || browserLang.includes('HK') || browserLang.includes('MO') ? 'zh-Hant' : CONFIG.defaultLanguage;
            }

            // For other languages, just take the first part before the dash
            const shortLang = browserLang.split('-')[0];
            const supportedCodes = SUPPORTED_LANGUAGES.map(lang => lang.code);
            return supportedCodes.includes(shortLang) ? shortLang : CONFIG.defaultLanguage;
        }
    },
    async mounted() {
        // Check if there's a generator_id in the URL
        const urlParams = new URLSearchParams(window.location.search);
        const generatorId = urlParams.get('generator');
        if (generatorId) {
            this.selectedTheme = 'generator';
            this.generatorId = generatorId;
        }

        // First load the fallback language (English)
        await this.loadTranslations(CONFIG.fallbackLanguage);
        
        // Then load the selected language if different from fallback
        if (this.selectedLanguage !== CONFIG.fallbackLanguage) {
            await this.loadTranslations(this.selectedLanguage);
            // Store the selected language preference
            localStorage.setItem('preferredLanguage', this.selectedLanguage);
        }

        // Add a watch for selectedLanguage changes to store preference
        this.$watch('selectedLanguage', (newLang) => {
            localStorage.setItem('preferredLanguage', newLang);
        });
    }
});

app.mount('#app');

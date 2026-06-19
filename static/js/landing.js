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
    devWorlds: {
        piedoneTheme: 'dev:piedone-a-tokyo'
    },
    defaultLanguage: 'en',
    fallbackLanguage: 'en'
};

const app = Vue.createApp({
    data() {
        return {
            selectedTheme: 'world',
            customDescription: '',
            generatorId: '',
            selectedWorldId: '',
            currentUser: null,
            accountStats: null,
            authMode: 'login',
            authForm: {
                username: '',
                password: ''
            },
            isAuthenticating: false,
            publicReviewDialog: {
                isOpen: false,
                status: 'idle',
                reason: '',
                reviewAfter: null,
                reviewedAt: null,
                canClose: false
            },
            worldTab: 'public',
            worldLists: {
                public: [],
                my: [],
                recentDev: []
            },
            isLoadingWorlds: false,
            errorMessage: null,
            infoMessage: null,
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
        },
        selectedGeneratorId() {
            if (this.selectedTheme !== 'world') {
                return null;
            }
            return this.selectedWorldId || this.generatorId.trim() || null;
        },
        worlds() {
            return this.worldLists[this.worldTab] || [];
        },
        allWorlds() {
            const worldsById = new Map();
            Object.values(this.worldLists).forEach((worlds) => {
                worlds.forEach((world) => worldsById.set(world.id, world));
            });
            return Array.from(worldsById.values());
        },
        hasCurrentWorldOptions() {
            return this.worlds.length > 0;
        },
        availableWorldTabs() {
            const tabs = [];
            if (this.currentUser) {
                tabs.push({ id: 'my', label: this.t('myWorlds') });
            }
            tabs.push({ id: 'public', label: this.t('publicWorlds') });
            if (this.isLocalDev) {
                tabs.push({ id: 'recentDev', label: this.t('recentDevWorlds') });
            }
            return tabs;
        },
        isLocalDev() {
            return ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
        },
        emptyWorldsTitle() {
            if (this.worldTab === 'my') {
                return this.t('myWorldsEmptyTitle');
            }

            if (this.worldTab === 'recentDev') {
                return this.t('recentDevWorldsEmptyTitle');
            }

            return this.t('publicWorldsEmptyTitle');
        },
        emptyWorldsMessage() {
            if (this.worldTab === 'my') {
                return this.t('myWorldsEmptyBody');
            }

            if (this.worldTab === 'recentDev') {
                return this.t('recentDevWorldsEmptyBody');
            }

            return this.currentUser
                ? this.t('publicWorldsEmptyBodySignedIn')
                : this.t('publicWorldsEmptyBodyAnonymous');
        },
        showEmptySignupPrompt() {
            return !this.currentUser && this.worldTab === 'public';
        },
        dashboardInitial() {
            const username = this.currentUser?.username || this.t('guestUser');
            return username.trim().charAt(0).toUpperCase() || '?';
        },
        dashboardStats() {
            const stats = this.accountStats || {};
            return [
                {
                    label: this.t('dashboardWorlds'),
                    value: stats.total_worlds || 0
                },
                {
                    label: this.t('dashboardPrivate'),
                    value: stats.private_worlds || 0
                },
                {
                    label: this.t('dashboardPublic'),
                    value: stats.public_worlds || 0
                },
                {
                    label: this.t('dashboardEntities'),
                    value: stats.total_entities || 0
                }
            ];
        },
        requiresAuthForSelectedCreation() {
            return !this.currentUser && this.selectedTheme !== 'world' && !this.isLocalDev;
        },
        launchButtonLabel() {
            if (this.requiresAuthForSelectedCreation) {
                return this.t('signupToCreate');
            }

            return this.selectedTheme === 'world' ? this.t('startRun') : this.t('createWorld');
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
        },
        worldTab() {
            this.selectFirstWorldForTab();
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
        translationForKey(translations, key) {
            if (!translations) {
                return undefined;
            }

            if (Object.prototype.hasOwnProperty.call(translations, key)) {
                return translations[key];
            }

            return key.split('.').reduce((value, part) => {
                return value && typeof value === 'object' ? value[part] : undefined;
            }, translations);
        },
        t(key, params = {}) {
            //console.log(`Translation requested for key: "${key}"`);
            //console.log(`Current language: ${this.selectedLanguage}`);
            //console.log(`Current translations:`, this.currentTranslations);
            //console.log(`Fallback translations:`, this.fallbackTranslations);

            // Get translation from current language or fallback
            const translation = this.translationForKey(this.currentTranslations, key)
                || this.translationForKey(this.fallbackTranslations, key)
                || key;

            //console.log(`Translation result for "${key}": "${translation}"`);

            if (
                !this.translationForKey(this.currentTranslations, key) &&
                !this.translationForKey(this.fallbackTranslations, key)
            ) {
                console.warn(`Missing translation for key: ${key} in language: ${this.selectedLanguage}`);
            }

            if (Object.keys(params).length === 0) {
                return translation;
            }

            if (typeof translation !== 'string') {
                return key;
            }

            return translation.replace(/\{(\w+)\}/g, (match, paramKey) => {
                return params[paramKey] !== undefined ? params[paramKey] : match;
            });
        },
        clearError() {
            this.errorMessage = null;
        },
        clearInfo() {
            this.infoMessage = null;
        },
        async responseErrorMessage(response, fallbackMessage) {
            const fallback = typeof fallbackMessage === 'string' && fallbackMessage.trim()
                ? fallbackMessage
                : 'Request failed';

            try {
                const rawText = await response.text();
                if (!rawText.trim()) {
                    return fallback;
                }

                try {
                    const data = JSON.parse(rawText);
                    const message = data && (data.error || data.message);
                    return typeof message === 'string' && message.trim()
                        ? message
                        : fallback;
                } catch (parseError) {
                    return rawText.trim();
                }
            } catch (readError) {
                return fallback;
            }
        },
        formatWorldCounts(world) {
            return this.t('worldCounts', {
                enemies: world.enemy_count,
                items: world.item_count,
                terrain: world.terrain_count
            });
        },
        worldVisibilityLabel(world) {
            const status = world?.moderation_status || 'not_requested';
            if (status === 'pending') {
                return this.t('visibilityPublicPending');
            }
            if (status === 'rejected') {
                return this.t('visibilityPublicRejected');
            }
            if (status === 'needs_human_review') {
                return this.t('visibilityNeedsHumanReview');
            }
            if (status === 'error') {
                return this.t('visibilityReviewError');
            }

            const labels = {
                private: this.t('visibilityPrivate'),
                unlisted: this.t('visibilityUnlisted'),
                public: this.t('visibilityPublic')
            };
            const visibility = world?.visibility || 'unlisted';
            return labels[visibility] || labels.unlisted;
        },
        formatReviewTimestamp(timestamp) {
            if (!timestamp) {
                return this.t('reviewSoon');
            }

            const normalizedTimestamp = String(timestamp).replace(' ', 'T');
            const date = new Date(normalizedTimestamp.endsWith('Z')
                ? normalizedTimestamp
                : `${normalizedTimestamp}Z`);
            if (Number.isNaN(date.getTime())) {
                return timestamp;
            }

            return date.toLocaleString();
        },
        publicReviewIcon() {
            const icons = {
                approved: 'fas fa-check',
                pending: 'fas fa-clock',
                rejected: 'fas fa-exclamation-triangle',
                needs_human_review: 'fas fa-user-shield',
                error: 'fas fa-exclamation-circle'
            };
            return icons[this.publicReviewDialog.status] || 'fas fa-info-circle';
        },
        publicReviewTitle() {
            const titles = {
                reviewing: this.t('publicReviewTitle'),
                approved: this.t('publicReviewApprovedTitle'),
                pending: this.t('publicReviewQueuedTitle'),
                rejected: this.t('publicReviewRejectedTitle'),
                needs_human_review: this.t('publicReviewNeedsHumanTitle'),
                error: this.t('publicReviewErrorTitle')
            };
            return titles[this.publicReviewDialog.status] || this.t('publicReviewTitle');
        },
        publicReviewBody() {
            const status = this.publicReviewDialog.status;
            if (status === 'reviewing') {
                return this.t('publicReviewBody');
            }
            if (status === 'approved') {
                return this.t('publicReviewApprovedBody', {
                    reviewedAt: this.formatReviewTimestamp(this.publicReviewDialog.reviewedAt)
                });
            }
            if (status === 'pending') {
                return this.t('publicReviewQueuedBody', {
                    reviewAfter: this.formatReviewTimestamp(this.publicReviewDialog.reviewAfter)
                });
            }
            if (status === 'rejected') {
                return this.publicReviewDialog.reason || this.t('publicReviewRejectedBody');
            }
            if (status === 'needs_human_review') {
                return this.publicReviewDialog.reason || this.t('publicReviewNeedsHumanBody');
            }
            if (status === 'error') {
                return this.publicReviewDialog.reason || this.t('publicReviewErrorBody');
            }
            return this.t('publicReviewBody');
        },
        openPublicReviewDialog() {
            this.publicReviewDialog = {
                isOpen: true,
                status: 'reviewing',
                reason: '',
                reviewAfter: null,
                reviewedAt: null,
                canClose: false
            };
        },
        finishPublicReviewDialog(data) {
            const moderationStatus = data?.moderation_status || 'error';
            const status = moderationStatus === 'approved' && data?.visibility === 'public'
                ? 'approved'
                : moderationStatus;
            this.publicReviewDialog = {
                isOpen: true,
                status,
                reason: data?.moderation_reason || '',
                reviewAfter: data?.public_review_after || null,
                reviewedAt: data?.public_reviewed_at || null,
                canClose: true
            };
        },
        failPublicReviewDialog(message) {
            this.publicReviewDialog = {
                isOpen: true,
                status: 'error',
                reason: message || this.t('publicReviewErrorBody'),
                reviewAfter: null,
                reviewedAt: null,
                canClose: true
            };
        },
        closePublicReviewDialog() {
            this.publicReviewDialog = {
                isOpen: false,
                status: 'idle',
                reason: '',
                reviewAfter: null,
                reviewedAt: null,
                canClose: false
            };
        },
        isOwnedWorld(world) {
            return this.currentUser && world.can_manage === true;
        },
        setAuthMode(mode) {
            this.authMode = mode === 'signup' ? 'signup' : 'login';
            this.clearError();
            this.clearInfo();
            this.authForm.password = '';
        },
        promptSignupForSave() {
            this.setAuthMode('signup');
            window.scrollTo({ top: 0, behavior: 'smooth' });
            this.$nextTick(() => {
                const usernameInput = document.querySelector('.auth-input');
                if (usernameInput) {
                    usernameInput.focus();
                }
            });
        },
        resetAuthForm() {
            this.authForm = {
                username: '',
                password: ''
            };
        },
        async refreshAuthWorldState(preferredTab = null) {
            await this.loadCurrentUser();
            await this.loadAccountStats();
            await this.loadWorlds();

            if (preferredTab && this.availableWorldTabs.some(tab => tab.id === preferredTab)) {
                this.worldTab = preferredTab;
            }
        },
        async submitAuth() {
            this.clearError();
            this.clearInfo();

            const username = this.authForm.username.trim();
            const password = this.authForm.password;
            if (!username || !password) {
                this.errorMessage = this.t('authMissingFields');
                return;
            }

            this.isAuthenticating = true;
            try {
                const endpoint = this.authMode === 'signup' ? '/api/signup' : '/api/login';
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ username, password })
                });

                if (!response.ok) {
                    throw new Error(await this.responseErrorMessage(response, this.t('authFailed')));
                }

                this.resetAuthForm();
                await this.refreshAuthWorldState('my');
                this.infoMessage = this.t('authSignedIn', {
                    username: this.currentUser?.username || username
                });
            } catch (error) {
                this.errorMessage = error.message || this.t('authFailed');
            } finally {
                this.isAuthenticating = false;
            }
        },
        async logout() {
            this.clearError();
            this.clearInfo();
            this.isAuthenticating = true;

            try {
                const response = await fetch('/api/logout', { method: 'POST' });
                if (!response.ok) {
                    throw new Error(await this.responseErrorMessage(response, this.t('logoutFailed')));
                }

                this.currentUser = null;
                this.accountStats = null;
                this.worldLists.my = [];
                await this.loadWorlds();
                this.infoMessage = this.t('authSignedOut');
            } catch (error) {
                this.errorMessage = error.message || this.t('logoutFailed');
            } finally {
                this.isAuthenticating = false;
            }
        },
        selectFirstWorldForTab() {
            if (!this.availableWorldTabs.some(tab => tab.id === this.worldTab)) {
                this.worldTab = this.isLocalDev ? 'recentDev' : 'public';
                return;
            }

            if (!this.worlds.some(world => world.id === this.selectedWorldId)) {
                this.selectedWorldId = this.worlds[0]?.id || '';
            }

        },
        chooseInitialWorldTab() {
            if (this.currentUser) {
                this.worldTab = 'my';
            } else if (this.isLocalDev && this.worldLists.recentDev.length > 0) {
                this.worldTab = 'recentDev';
            } else {
                this.worldTab = 'public';
            }
            this.selectFirstWorldForTab();

            if (!this.hasCurrentWorldOptions) {
                this.selectedTheme = 'custom';
            }
        },
        async loadCurrentUser() {
            try {
                const response = await fetch('/api/me');
                this.currentUser = response.ok ? await response.json() : null;
            } catch (error) {
                console.warn('User session unavailable:', error);
                this.currentUser = null;
            }
        },
        async loadAccountStats() {
            if (!this.currentUser) {
                this.accountStats = null;
                return;
            }

            try {
                const response = await fetch('/api/my/stats');
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                const data = await response.json();
                this.accountStats = data.stats || null;
            } catch (error) {
                console.warn('Account stats unavailable:', error);
                this.accountStats = null;
            }
        },
        async loadWorlds() {
            this.isLoadingWorlds = true;

            try {
                const response = await fetch('/api/worlds/recent?limit=12');
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const data = await response.json();
                const recentWorlds = Array.isArray(data.worlds) ? data.worlds : [];
                this.worldLists.public = this.isLocalDev
                    ? recentWorlds.filter(world => world.visibility === 'public')
                    : recentWorlds;
                this.worldLists.recentDev = this.isLocalDev ? recentWorlds : [];

                if (this.currentUser) {
                    const myResponse = await fetch('/api/my/worlds?limit=50');
                    if (myResponse.ok) {
                        const myData = await myResponse.json();
                        this.worldLists.my = Array.isArray(myData.worlds) ? myData.worlds : [];
                    } else {
                        this.worldLists.my = [];
                    }
                } else {
                    this.worldLists.my = [];
                }

                this.chooseInitialWorldTab();
            } catch (error) {
                console.warn('World list unavailable:', error);
                this.worldLists = {
                    public: [],
                    my: [],
                    recentDev: []
                };
            } finally {
                this.isLoadingWorlds = false;
            }
        },
        async startWorld(worldId) {
            this.selectedTheme = 'world';
            this.selectedWorldId = worldId;
            this.generatorId = '';
            await this.launchGame();
        },
        getDebugSeedFromUrl() {
            if (!this.isLocalDev) {
                return null;
            }

            const rawSeed = new URLSearchParams(window.location.search).get('debug_seed');
            if (!rawSeed) {
                return null;
            }

            const parsedSeed = Number(rawSeed);
            return Number.isSafeInteger(parsedSeed) ? parsedSeed : null;
        },
        async quickStartPiedone(languageCode = null) {
            if (!this.isLocalDev) {
                return;
            }

            if (typeof languageCode !== 'string') {
                languageCode = null;
            }

            if (languageCode) {
                if (!this.rawTranslations[languageCode]) {
                    await this.loadTranslations(languageCode);
                }
                this.selectedLanguage = languageCode;
            }

            const piedoneWorld = this.allWorlds.find(world => {
                return world.theme === CONFIG.devWorlds.piedoneTheme;
            }) || this.allWorlds.find(world => {
                const haystack = `${world.title || ''} ${world.theme || ''}`.toLowerCase();
                return haystack.includes('piedone');
            });

            if (!piedoneWorld) {
                this.errorMessage = this.t('errorWorld');
                return;
            }

            await this.startWorld(piedoneWorld.id);
        },
        async copyWorldLink(world) {
            this.clearError();
            this.clearInfo();

            const shareUrl = new URL('/game', window.location.origin);
            shareUrl.searchParams.set('generator_id', world.id);
            shareUrl.searchParams.set('lang', this.selectedLanguage);

            try {
                await navigator.clipboard.writeText(shareUrl.toString());
                this.infoMessage = this.t('shareLinkCopied');
            } catch (error) {
                console.warn('Clipboard unavailable:', error);
                this.infoMessage = shareUrl.toString();
            }
        },
        replaceWorldInLists(updatedWorld) {
            const nextLists = {};
            Object.entries(this.worldLists).forEach(([listName, worlds]) => {
                let nextWorlds = worlds.map((world) => {
                    return world.id === updatedWorld.id ? { ...world, ...updatedWorld } : world;
                });

                if (listName === 'public') {
                    nextWorlds = nextWorlds.filter(world => world.visibility === 'public');
                    if (
                        updatedWorld.visibility === 'public' &&
                        !nextWorlds.some(world => world.id === updatedWorld.id)
                    ) {
                        nextWorlds = [{ ...updatedWorld }, ...nextWorlds];
                    }
                }

                nextLists[listName] = nextWorlds;
            });
            this.worldLists = nextLists;
            this.selectFirstWorldForTab();
        },
        async updateWorldVisibility(world, event) {
            this.clearError();
            this.clearInfo();

            const previousWorld = { ...world };
            const visibility = event.target.value;
            const isPublicReviewRequest = visibility === 'public';
            if (isPublicReviewRequest) {
                this.openPublicReviewDialog();
            }

            try {
                const response = await fetch(`/api/worlds/${world.id}/visibility`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ visibility })
                });

                if (!response.ok) {
                    throw new Error(await this.responseErrorMessage(response, this.t('visibilityUpdateFailed')));
                }

                const data = await response.json();
                this.replaceWorldInLists({ ...world, ...data });
                if (isPublicReviewRequest) {
                    this.finishPublicReviewDialog(data);
                } else if (data.message) {
                    this.infoMessage = data.message;
                }
            } catch (error) {
                Object.assign(world, previousWorld);
                event.target.value = previousWorld.visibility;
                if (isPublicReviewRequest) {
                    this.failPublicReviewDialog(error.message || this.t('visibilityUpdateFailed'));
                } else {
                    this.errorMessage = error.message || this.t('visibilityUpdateFailed');
                }
            }
        },
        async applyDevQuickStartFromUrl() {
            if (!this.isLocalDev) {
                return;
            }

            const urlParams = new URLSearchParams(window.location.search);
            const quickWorldId = urlParams.get('quick_world');
            if (quickWorldId) {
                await this.startWorld(quickWorldId);
                return;
            }

            const devQuick = urlParams.get('dev_quick');
            if (devQuick === 'piedone') {
                await this.quickStartPiedone();
                return;
            }

            const languageQuickStarts = {
                'en-piedone': 'en',
                'it-piedone': 'it',
                'ja-piedone': 'ja'
            };
            if (languageQuickStarts[devQuick]) {
                await this.quickStartPiedone(languageQuickStarts[devQuick]);
            }
        },
        async launchGame() {
            this.clearError();

            if (this.selectedTheme === 'world' && !this.selectedGeneratorId) {
                this.errorMessage = this.t('errorWorld');
                return;
            }

            if (this.requiresAuthForSelectedCreation) {
                this.promptSignupForSave();
                this.errorMessage = this.t('authRequiredToCreateWorld');
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
                    do_web_search: true
                });
            }

            try {
                // Use the new session-based API
                const requestBody = {
                    theme: this.selectedTheme === 'custom' ? this.customDescription : null,
                    generator_id: this.selectedGeneratorId,
                    language: this.selectedLanguage,
                    do_web_search: true
                };
                const debugSeed = this.getDebugSeedFromUrl();
                if (debugSeed !== null) {
                    requestBody.debug_seed = debugSeed;
                }

                const response = await fetch('/api/create_game_session', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(requestBody)
                });

                if (!response.ok) {
                    throw new Error(await this.responseErrorMessage(response, this.t('errors.failedToCreate')));
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
                await this.loadCurrentUser();
                await this.loadAccountStats();
                await this.loadWorlds();
                await this.applyDevQuickStartFromUrl();
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
            this.selectedTheme = 'world';
            this.generatorId = generatorId;
            this.selectedWorldId = '';
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

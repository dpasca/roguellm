const app = Vue.createApp({
    data() {
        return {
            selectedTheme: 'fantasy',
            customDescription: '',
            generatorId: '',
            errorMessage: null,
            doWebSearch: false,
            selectedLanguage: 'en'
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
                const id = searchParams.get('generator_id');
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
        clearError() {
            this.errorMessage = null;
        },
        async launchGame() {
            this.clearError();

            // Validate generator ID if generator theme selected
            if (this.selectedTheme === 'generator' && !this.generatorId.trim()) {
                this.errorMessage = "Please enter a Game ID";
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

                // Redirect to game page with generator_id if it exists
                const params = new URLSearchParams();
                if (this.selectedTheme === 'generator') {
                    params.append('generator_id', this.generatorId.trim());
                }
                window.location.href = `/game.html${params.toString() ? '?' + params.toString() : ''}`;
            } catch (error) {
                this.errorMessage = error.message || "Failed to start game. Please try again.";
            }
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

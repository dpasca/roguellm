const { createApp } = Vue;

createApp({
    data() {
        return {
            selectedTheme: 'fantasy',
            selectedLanguage: 'en',
            customDescription: '',
            generatorId: '',
            doWebSearch: false,
            errorMessage: null
        }
    },
    created() {
        // Check if there's a generator ID in the URL
        const urlParams = new URLSearchParams(window.location.search);
        const generatorId = urlParams.get('generator');
        if (generatorId) {
            this.selectedTheme = 'generator';
            this.generatorId = generatorId;
        }
    },
    methods: {
        async launchGame() {
            try {
                let params = {
                    language: this.selectedLanguage
                };

                if (this.selectedTheme === 'fantasy') {
                    params.theme = 'fantasy';
                } else if (this.selectedTheme === 'custom') {
                    if (!this.customDescription.trim()) {
                        this.errorMessage = 'Please enter a theme description';
                        return;
                    }
                    params.theme = this.customDescription;
                    params.do_web_search = this.doWebSearch;
                } else if (this.selectedTheme === 'generator') {
                    if (!this.generatorId.trim()) {
                        this.errorMessage = 'Please enter a generator ID';
                        return;
                    }
                    params.generator_id = this.generatorId;
                }

                const response = await fetch('/api/create_game', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(params)
                });

                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.message || 'Failed to create game');
                }

                const data = await response.json();
                window.location.href = `/game.html?id=${data.game_id}`;
            } catch (error) {
                this.errorMessage = error.message;
            }
        }
    }
}).mount('#app');

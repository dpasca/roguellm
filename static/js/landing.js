const { createApp } = Vue

createApp({
    data() {
        return {
            selectedTheme: 'custom',
            selectedLanguage: 'en',
            customDescription: '',
            errorMessage: null,
            doWebSearch: true
        }
    },
    methods: {
        launchGame() {
            if (this.selectedTheme === 'custom' && !this.customDescription.trim()) {
                this.errorMessage = "Please provide a description for your custom theme";
                return;
            }

            const description = this.selectedTheme === 'custom'
                ? this.customDescription.trim()
                : 'fantasy';

            fetch('/set-theme', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    theme: description, 
                    language: this.selectedLanguage,
                    do_web_search: this.selectedTheme === 'custom' ? this.doWebSearch : false
                }),
                credentials: 'include'
            })
            .then(response => {
                if (response.ok) {
                    window.location.href = '/game';
                }
            });
        }
    },
    watch: {
        selectedTheme(newTheme) {
            if (newTheme === 'fantasy') {
                this.errorMessage = null;
                this.doWebSearch = false;
            } else {
                this.doWebSearch = true;
            }
        }
    }
}).mount('#app')

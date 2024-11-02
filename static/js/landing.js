const { createApp } = Vue

createApp({
    data() {
        return {
            selectedTheme: 'custom',
            customDescription: '',
            errorMessage: null
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
                body: JSON.stringify({ theme: description }),
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
            }
        }
    }
}).mount('#app') 
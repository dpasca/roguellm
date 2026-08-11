(function () {
    function addLanguage(url, language) {
        if (language) {
            url.searchParams.set('lang', language);
        }
        return url.toString();
    }

    window.RogueLLMRuntime = {
        isNative: false,
        resolveRemoteUrl(value) {
            return value;
        },
        resolveRemoteUrls(value) {
            return value;
        },
        homeUrl(language) {
            return addLanguage(new URL('/', window.location.origin), language);
        },
        gameUrl(sessionId, language) {
            return addLanguage(
                new URL(`/game/${encodeURIComponent(sessionId)}`, window.location.origin),
                language
            );
        },
        getGameSessionId() {
            return window.location.pathname.split('/')[2] || null;
        },
        websocketUrl(sessionId) {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            return `${protocol}//${window.location.host}/ws/game/${encodeURIComponent(sessionId)}`;
        },
        publicWorldUrl(worldId, language) {
            const url = new URL('/game', window.location.origin);
            url.searchParams.set('generator_id', worldId);
            return addLanguage(url, language);
        },
        async logout() {
            return window.fetch('/api/logout', { method: 'POST' });
        }
    };
})();

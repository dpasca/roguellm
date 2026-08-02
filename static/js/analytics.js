(function () {
    const firebaseConfig = window.ROGUELLM_FIREBASE_CONFIG;

    window.analytics = null;
    window.trackAnalyticsEvent = function () {};

    if (!firebaseConfig) {
        return;
    }

    try {
        if (!window.firebase) {
            throw new Error('Firebase SDK did not load');
        }

        if (!window.firebase.apps.length) {
            window.firebase.initializeApp(firebaseConfig);
        }

        const analytics = window.firebase.analytics();
        window.analytics = analytics;
        window.trackAnalyticsEvent = function (eventName, eventParameters = {}) {
            try {
                analytics.logEvent(eventName, eventParameters);
            } catch (error) {
                console.warn('Firebase Analytics event failed:', eventName, error);
            }
        };
    } catch (error) {
        console.warn('Firebase Analytics initialization failed:', error);
    }
})();

import {
    getApp,
    getApps,
    initializeApp
} from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js';
import {
    getAuth,
    GoogleAuthProvider,
    OAuthProvider,
    onAuthStateChanged,
    reauthenticateWithPopup,
    revokeAccessToken,
    signInWithPopup,
    signOut as firebaseSignOut
} from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js';


const firebaseConfig = window.ROGUELLM_FIREBASE_CONFIG || {};
const authConfig = window.ROGUELLM_AUTH_CONFIG || {};
let analytics = null;
let analyticsLogEvent = null;

function providerFor(providerName) {
    if (providerName === 'google') {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        return provider;
    }
    if (providerName === 'apple') {
        const provider = new OAuthProvider('apple.com');
        provider.addScope('email');
        provider.addScope('name');
        return provider;
    }
    throw new Error('Unsupported sign-in provider');
}

function waitForInitialUser(auth) {
    return new Promise((resolve, reject) => {
        const unsubscribe = onAuthStateChanged(
            auth,
            (user) => {
                unsubscribe();
                resolve(user);
            },
            (error) => {
                unsubscribe();
                reject(error);
            }
        );
    });
}

function friendlyAuthError(error) {
    if (error?.code === 'auth/popup-closed-by-user') {
        return new Error('Sign-in was cancelled.');
    }
    if (error?.code === 'auth/account-exists-with-different-credential') {
        return new Error('That email is already connected to another sign-in provider.');
    }
    if (error?.code === 'auth/popup-blocked') {
        return new Error('Your browser blocked the sign-in window. Allow popups and try again.');
    }
    return error instanceof Error ? error : new Error('Unable to sign in.');
}

async function initializeRuntime() {
    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const initialUserPromise = waitForInitialUser(auth);

    if (authConfig.analyticsEnabled) {
        try {
            const analyticsModule = await import(
                'https://www.gstatic.com/firebasejs/12.6.0/firebase-analytics.js'
            );
            if (await analyticsModule.isSupported()) {
                analytics = analyticsModule.getAnalytics(app);
                analyticsLogEvent = analyticsModule.logEvent;
            }
        } catch (error) {
            console.warn('Firebase Analytics is unavailable:', error);
        }
    }

    window.trackAnalyticsEvent = (eventName, parameters = {}) => {
        if (analytics && analyticsLogEvent) {
            analyticsLogEvent(analytics, eventName, parameters);
        }
    };

    const api = {
        async signIn(providerName) {
            try {
                const result = await signInWithPopup(
                    auth,
                    providerFor(providerName)
                );
                return {
                    idToken: await result.user.getIdToken(true),
                    provider: providerName
                };
            } catch (error) {
                throw friendlyAuthError(error);
            }
        },

        async restoreSession() {
            const user = auth.currentUser || await initialUserPromise;
            if (!user) {
                return null;
            }
            return { idToken: await user.getIdToken() };
        },

        async prepareAccountDeletion(providerName) {
            const user = auth.currentUser || await initialUserPromise;
            if (!user) {
                throw new Error('Sign in again before deleting your account.');
            }

            try {
                const result = await reauthenticateWithPopup(
                    user,
                    providerFor(providerName)
                );
                if (providerName === 'apple') {
                    const credential = OAuthProvider.credentialFromResult(result);
                    if (!credential?.accessToken) {
                        throw new Error('Apple did not return a revocation token.');
                    }
                    await revokeAccessToken(auth, credential.accessToken);
                }
                return {
                    idToken: await result.user.getIdToken(true),
                    provider: providerName
                };
            } catch (error) {
                throw friendlyAuthError(error);
            }
        },

        async signOut() {
            await firebaseSignOut(auth);
        }
    };

    window.RogueLLMAuth = api;
    return api;
}

try {
    const authRuntime = await initializeRuntime();
    window.__resolveRogueLLMAuthReady?.(authRuntime);
} catch (error) {
    console.error('Firebase runtime failed to initialize:', error);
    window.ROGUELLM_AUTH_ERROR = error;
    window.__resolveRogueLLMAuthReady?.(null);
}
delete window.__resolveRogueLLMAuthReady;

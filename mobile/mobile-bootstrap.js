import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import {
    KeychainAccess,
    SecureStorage
} from '@aparajita/capacitor-secure-storage';
import {
    Platform,
    ProductType,
    store
} from 'capacitor-plugin-cdv-purchase';


const config = window.ROGUELLM_MOBILE_CONFIG || {};
const apiBaseUrl = String(config.apiBaseUrl || '').replace(/\/$/, '');
const publicWebUrl = String(config.publicWebUrl || apiBaseUrl).replace(/\/$/, '');
const nativeFetch = window.fetch.bind(window);
const refreshTokenKey = 'mobile_refresh_token';
const nativePlatform = Capacitor.getPlatform();
const purchasePlatform = nativePlatform === 'ios'
    ? Platform.APPLE_APPSTORE
    : Platform.GOOGLE_PLAY;
const purchaseProvider = nativePlatform === 'ios' ? 'apple' : 'google';

window.ROGUELLM_AUTH_CONFIG = {
    socialEnabled: true,
    legacyPasswordEnabled: false,
    providers: ['google', 'apple'],
    accountDeletionUrl: '/delete-account',
    analyticsEnabled: false
};

if (!apiBaseUrl || !apiBaseUrl.startsWith('https://')) {
    throw new Error('ROGUELLM_MOBILE_CONFIG.apiBaseUrl must be an HTTPS URL');
}

let accessToken = null;
let refreshPromise = null;

const storageReady = (async () => {
    await SecureStorage.setKeyPrefix('roguellm_');
    await SecureStorage.setSynchronize(false);
    await SecureStorage.setDefaultKeychainAccess(
        KeychainAccess.whenUnlockedThisDeviceOnly
    );
})();

async function saveAuthPayload(payload) {
    if (!payload?.access_token || !payload?.refresh_token) {
        return false;
    }
    await storageReady;
    accessToken = payload.access_token;
    await SecureStorage.setItem(refreshTokenKey, payload.refresh_token);
    return true;
}

async function clearAuth() {
    await storageReady;
    accessToken = null;
    await SecureStorage.removeItem(refreshTokenKey);
}

async function refreshAccessToken() {
    if (refreshPromise) {
        return refreshPromise;
    }

    refreshPromise = (async () => {
        await storageReady;
        const refreshToken = await SecureStorage.getItem(refreshTokenKey);
        if (!refreshToken) {
            return false;
        }

        let response;
        try {
            response = await nativeFetch(`${apiBaseUrl}/api/mobile/auth/refresh`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-RogueLLM-Mobile': '1'
                },
                body: JSON.stringify({ refresh_token: refreshToken })
            });
        } catch (error) {
            console.warn('Unable to refresh the RogueLLM mobile session:', error);
            return false;
        }

        if (!response.ok) {
            await clearAuth();
            return false;
        }
        return saveAuthPayload(await response.json());
    })();

    try {
        return await refreshPromise;
    } finally {
        refreshPromise = null;
    }
}

function isBackendUrl(url) {
    return url.origin === new URL(apiBaseUrl).origin;
}

function isLocalAppUrl(url) {
    return url.origin === window.location.origin;
}

function resolveRemoteUrl(value) {
    if (typeof value !== 'string') {
        return value;
    }
    if (value.startsWith('/assets/worlds/')) {
        return `${apiBaseUrl}${value}`;
    }
    return value;
}

function resolveRemoteUrls(value) {
    if (Array.isArray(value)) {
        return value.map(resolveRemoteUrls);
    }
    if (value && typeof value === 'object') {
        Object.keys(value).forEach((key) => {
            value[key] = resolveRemoteUrls(value[key]);
        });
        return value;
    }
    return resolveRemoteUrl(value);
}

async function rewriteJsonResponse(response) {
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
        return response;
    }

    let payload;
    try {
        payload = await response.clone().json();
    } catch (error) {
        return response;
    }
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    return new Response(JSON.stringify(resolveRemoteUrls(payload)), {
        status: response.status,
        statusText: response.statusText,
        headers
    });
}

function requestDetails(input, init = {}) {
    const inputUrl = typeof input === 'string' ? input : input.url;
    const inputHeaders = typeof input === 'string' ? undefined : input.headers;
    const url = new URL(inputUrl, window.location.href);
    const headers = new Headers(inputHeaders || init.headers || {});
    const options = { ...init, headers };
    return { url, options };
}

async function mobileFetch(input, init = {}) {
    const { url, options } = requestDetails(input, init);
    const localRequest = isLocalAppUrl(url);
    let backendPath = null;

    if (localRequest && (url.pathname.startsWith('/api/') || url.pathname === '/logout')) {
        backendPath = `${url.pathname}${url.search}`;
    } else if (isBackendUrl(url) && url.pathname.startsWith('/api/')) {
        backendPath = `${url.pathname}${url.search}`;
    }
    if (!backendPath) {
        return nativeFetch(input, init);
    }

    const originalPath = new URL(backendPath, apiBaseUrl).pathname;
    const isLogin = originalPath === '/api/login';
    const isSignup = originalPath === '/api/signup';
    const isSocialLogin = originalPath === '/api/auth/firebase';
    const isLogout = originalPath === '/api/logout' || originalPath === '/logout';
    const isAccountDeletion = originalPath === '/api/account'
        && String(options.method || 'GET').toUpperCase() === 'DELETE';
    const isRefresh = originalPath === '/api/mobile/auth/refresh';
    if (isLogin) {
        backendPath = '/api/mobile/auth/login';
    } else if (isSignup) {
        backendPath = '/api/mobile/auth/signup';
    } else if (isLogout) {
        backendPath = '/api/mobile/auth/logout';
    }

    if ((isLogin || isSignup || isSocialLogin) && typeof options.body === 'string') {
        try {
            options.body = JSON.stringify({
                ...JSON.parse(options.body),
                platform: nativePlatform
            });
        } catch (error) {
            console.warn('Unable to add mobile login metadata:', error);
        }
    }

    if (!isLogin && !isSignup && !isSocialLogin && !isRefresh && !accessToken) {
        await refreshAccessToken();
    }
    options.headers.set('X-RogueLLM-Mobile', '1');
    if (accessToken && !isLogin && !isSignup && !isSocialLogin && !isRefresh) {
        options.headers.set('Authorization', `Bearer ${accessToken}`);
    } else {
        options.headers.delete('Authorization');
    }

    const send = () => nativeFetch(`${apiBaseUrl}${backendPath}`, options);
    let response;
    try {
        response = await send();
        if (
            response.status === 401 &&
            !isLogin && !isSignup && !isSocialLogin && !isRefresh &&
            await refreshAccessToken()
        ) {
            options.headers.set('Authorization', `Bearer ${accessToken}`);
            response = await send();
        }

        if ((isLogin || isSignup || isSocialLogin) && response.ok) {
            await saveAuthPayload(await response.clone().json());
        }
        if (isAccountDeletion && response.ok) {
            await clearAuth();
        }
        return await rewriteJsonResponse(response);
    } finally {
        if (isLogout) {
            await clearAuth();
        }
    }
}

window.fetch = mobileFetch;

async function getFreshFirebaseIdToken() {
    const result = await FirebaseAuthentication.getIdToken({
        forceRefresh: true
    });
    if (!result?.token) {
        throw new Error('Firebase did not return an identity token.');
    }
    return result.token;
}

async function signInWithProvider(providerName) {
    let result;
    if (providerName === 'google') {
        result = await FirebaseAuthentication.signInWithGoogle();
    } else if (providerName === 'apple') {
        result = await FirebaseAuthentication.signInWithApple();
    } else {
        throw new Error('Unsupported sign-in provider');
    }
    if (!result?.user) {
        throw new Error('The sign-in did not complete.');
    }
    return result;
}

window.RogueLLMAuth = {
    async signIn(providerName) {
        await signInWithProvider(providerName);
        return {
            idToken: await getFreshFirebaseIdToken(),
            provider: providerName
        };
    },

    async restoreSession() {
        const result = await FirebaseAuthentication.getCurrentUser();
        if (!result?.user) {
            return null;
        }
        return { idToken: await getFreshFirebaseIdToken() };
    },

    async prepareAccountDeletion(providerName) {
        const result = await signInWithProvider(providerName);
        if (providerName === 'apple') {
            const revocationToken = result.credential?.authorizationCode
                || result.credential?.accessToken;
            if (!revocationToken) {
                throw new Error('Apple did not return a revocation token.');
            }
            await FirebaseAuthentication.revokeAccessToken({
                token: revocationToken
            });
        }
        return {
            idToken: await getFreshFirebaseIdToken(),
            provider: providerName
        };
    },

    async signOut() {
        await FirebaseAuthentication.signOut();
    }
};
window.ROGUELLM_AUTH_READY = Promise.resolve(window.RogueLLMAuth);

function addLanguage(url, language) {
    if (language) {
        url.searchParams.set('lang', language);
    }
    return url.toString();
}

window.RogueLLMRuntime = {
    isNative: true,
    apiBaseUrl,
    resolveRemoteUrl,
    resolveRemoteUrls,
    homeUrl(language) {
        return addLanguage(new URL('/index.html', window.location.origin), language);
    },
    gameUrl(sessionId, language) {
        const url = new URL('/game.html', window.location.origin);
        url.searchParams.set('session_id', sessionId);
        return addLanguage(url, language);
    },
    getGameSessionId() {
        return new URLSearchParams(window.location.search).get('session_id');
    },
    websocketUrl(sessionId) {
        const url = new URL(apiBaseUrl);
        const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${protocol}//${url.host}/ws/game/${encodeURIComponent(sessionId)}`;
    },
    publicWorldUrl(worldId, language) {
        const url = new URL('/game', publicWebUrl);
        url.searchParams.set('generator_id', worldId);
        return addLanguage(url, language);
    },
    async logout() {
        return mobileFetch('/api/logout', { method: 'POST' });
    }
};

let storeConfiguration = null;
let storeInitialization = null;
let storeListenersAttached = false;
const pendingPurchases = new Map();
const processingTransactions = new Set();

async function responseError(response, fallback) {
    try {
        const payload = await response.json();
        return payload.error || fallback;
    } catch (error) {
        return fallback;
    }
}

async function loadStoreConfiguration() {
    const response = await mobileFetch('/api/mobile/store/config');
    if (!response.ok) {
        throw new Error(await responseError(response, 'The credit store is unavailable.'));
    }
    storeConfiguration = await response.json();
    return storeConfiguration;
}

function settlePurchase(productId, method, value) {
    const pending = pendingPurchases.get(productId);
    if (!pending) {
        return;
    }
    pendingPurchases.delete(productId);
    clearTimeout(pending.timeout);
    pending[method](value);
}

async function verifyApprovedTransaction(transaction) {
    if (!transaction?.transactionId || processingTransactions.has(transaction.transactionId)) {
        return;
    }
    processingTransactions.add(transaction.transactionId);
    const productId = transaction.products?.[0]?.id;

    try {
        const configuration = await loadStoreConfiguration();
        if (!configuration.enabled) {
            throw new Error('Mobile credit purchases are not enabled yet.');
        }
        store.applicationUsername = configuration.store_account_token;
        store.obfuscator = 'disabled';

        const requestBody = {
            provider: purchaseProvider
        };
        if (purchaseProvider === 'apple') {
            requestBody.transaction_id = transaction.transactionId;
            requestBody.environment = config.appleEnvironment || 'production';
        } else {
            requestBody.purchase_token = transaction.parentReceipt?.purchaseToken;
        }

        const response = await mobileFetch('/api/mobile/purchases/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });
        if (!response.ok) {
            throw new Error(await responseError(response, 'The purchase could not be verified.'));
        }

        const result = await response.json();
        if (result.verified !== true) {
            throw new Error('The purchase could not be verified.');
        }

        // Both stores redeliver unfinished transactions. Finishing only after
        // the idempotent server grant makes an app crash safe to retry.
        await transaction.finish();
        settlePurchase(productId, 'resolve', result);
    } catch (error) {
        console.error('Credit purchase verification failed:', error);
        settlePurchase(productId, 'reject', error);
    } finally {
        processingTransactions.delete(transaction.transactionId);
    }
}

function attachStoreListeners() {
    if (storeListenersAttached) {
        return;
    }
    storeListenersAttached = true;
    store.when().approved(verifyApprovedTransaction);
}

async function initializeStore(productKeys) {
    if (storeInitialization) {
        return storeInitialization;
    }

    attachStoreListeners();
    store.register(productKeys.map(productId => ({
        id: productId,
        type: ProductType.CONSUMABLE,
        platform: purchasePlatform
    })));
    storeInitialization = (async () => {
        const errors = await store.initialize([purchasePlatform]);
        if (errors.length) {
            throw new Error(errors[0].message || 'The native store could not initialize.');
        }
    })();
    return storeInitialization;
}

window.RogueLLMCreditPurchaseProvider = {
    async isAvailable() {
        if (!['ios', 'android'].includes(nativePlatform)) {
            return false;
        }
        try {
            const configuration = await loadStoreConfiguration();
            return configuration.enabled === true;
        } catch (error) {
            console.warn('Native credit store unavailable:', error);
            return false;
        }
    },
    async getProducts(productKeys) {
        await initializeStore(productKeys);
        return productKeys.map((productKey) => {
            const product = store.get(productKey, purchasePlatform);
            return {
                productKey,
                localizedPrice: product?.pricing?.price || null
            };
        });
    },
    async purchase(productKey) {
        const configuration = storeConfiguration || await loadStoreConfiguration();
        if (!configuration.enabled) {
            throw new Error('Mobile credit purchases are not enabled yet.');
        }
        await initializeStore(
            configuration.products.map(product => product.product_id)
        );
        store.applicationUsername = configuration.store_account_token;
        store.obfuscator = 'disabled';

        const product = store.get(productKey, purchasePlatform);
        const offer = product?.getOffer();
        if (!offer || !offer.canPurchase) {
            throw new Error('This credit pack is not available from the store.');
        }
        if (pendingPurchases.has(productKey)) {
            throw new Error('This credit pack purchase is already in progress.');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                pendingPurchases.delete(productKey);
                reject(new Error('The store purchase timed out. Please try again.'));
            }, 120000);
            pendingPurchases.set(productKey, { resolve, reject, timeout });

            offer.order({
                applicationUsername: configuration.store_account_token
            }).then((error) => {
                if (error) {
                    settlePurchase(productKey, 'reject', new Error(error.message));
                }
            }).catch((error) => {
                settlePurchase(productKey, 'reject', error);
            });
        });
    }
};

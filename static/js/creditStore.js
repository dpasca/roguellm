const BASE_CREDIT_PACKS = Object.freeze([
    Object.freeze({
        id: 'spark',
        productKey: 'credits_40',
        credits: 40,
        previewPrice: '$1.99',
        titleKey: 'creditStorePackSpark',
        captionKey: 'creditStorePackSparkCaption',
        tone: 'spark',
        featured: false
    }),
    Object.freeze({
        id: 'adventure',
        productKey: 'credits_120',
        credits: 120,
        previewPrice: '$4.99',
        titleKey: 'creditStorePackAdventure',
        captionKey: 'creditStorePackAdventureCaption',
        tone: 'adventure',
        featured: true
    }),
    Object.freeze({
        id: 'worldsmith',
        productKey: 'credits_300',
        credits: 300,
        previewPrice: '$9.99',
        titleKey: 'creditStorePackWorldsmith',
        captionKey: 'creditStorePackWorldsmithCaption',
        tone: 'worldsmith',
        featured: false
    })
]);

export function createPreviewCreditPacks() {
    return BASE_CREDIT_PACKS.map(pack => ({
        ...pack,
        displayPrice: pack.previewPrice
    }));
}

export function getCreditPurchaseProvider() {
    const provider = window.RogueLLMCreditPurchaseProvider;
    return provider && typeof provider.purchase === 'function' ? provider : null;
}

export async function loadCreditPackCatalog() {
    const packs = createPreviewCreditPacks();
    const provider = getCreditPurchaseProvider();
    if (!provider) {
        return { available: false, packs, provider: null };
    }

    const available = typeof provider.isAvailable === 'function'
        ? await provider.isAvailable()
        : true;
    if (!available) {
        return { available: false, packs, provider };
    }

    if (typeof provider.getProducts !== 'function') {
        return { available: true, packs, provider };
    }

    const products = await provider.getProducts(packs.map(pack => pack.productKey));
    const productsByKey = new Map((Array.isArray(products) ? products : []).map(product => [
        product.productKey || product.id,
        product
    ]));
    const localizedPacks = packs.map((pack) => {
        const product = productsByKey.get(pack.productKey);
        return {
            ...pack,
            displayPrice: product?.localizedPrice || product?.displayPrice || pack.previewPrice
        };
    });

    return { available: true, packs: localizedPacks, provider };
}

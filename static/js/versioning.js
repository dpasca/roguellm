function addVersionToUrl(url) {
    return `${url}?v=${new Date().getTime()}`;
}

window.onload = function() {
    document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
        if (!link.href.includes('cdnjs.cloudflare.com')) {  // Skip CDN files
            link.href = addVersionToUrl(link.href.split('?')[0]);
        }
    });
}

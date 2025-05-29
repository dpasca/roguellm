// FontAwesome Icon Unicode Map Generator
// This script generates a comprehensive mapping of FontAwesome icon names to their unicode values
// Run this in browser console on a page with FontAwesome loaded to generate the map

function generateIconMap() {
    // Common FontAwesome Free icons and their unicode values
    const iconMap = {
        // Basic icons
        'fa-user': '\uf007',
        'fa-users': '\uf0c0',
        'fa-skull': '\uf54c',
        'fa-skull-crossbones': '\uf714',
        'fa-box': '\uf466',
        'fa-cube': '\uf1b2',
        'fa-gem': '\uf3a5',
        'fa-star': '\uf005',
        'fa-heart': '\uf004',
        'fa-circle': '\uf111',
        'fa-square': '\uf0c8',
        'fa-question': '\uf128',
        'fa-question-circle': '\uf059',

        // Nature and environment
        'fa-tree': '\uf1bb',
        'fa-mountain': '\uf6fc',
        'fa-sun': '\uf185',
        'fa-moon': '\uf186',
        'fa-cloud': '\uf0c2',
        'fa-snowflake': '\uf2dc',
        'fa-leaf': '\uf06c',
        'fa-fire': '\uf06d',
        'fa-bolt': '\uf0e7',
        'fa-water': '\uf773',
        'fa-eye': '\uf06e',
        'fa-cave': '\uf6a0',
        'fa-desert': '\uf3ff',
        'fa-forest': '\uf6fa',

        // Weapons and equipment
        'fa-sword': '\uf71c',
        'fa-shield': '\uf132',
        'fa-shield-alt': '\uf3ed',
        'fa-flask': '\uf0c3',
        'fa-hammer': '\uf6e3',
        'fa-bow-arrow': '\uf6b9',
        'fa-magic': '\uf0d0',
        'fa-wand-magic': '\uf72a',

        // Items and treasures
        'fa-coins': '\uf51e',
        'fa-key': '\uf084',
        'fa-lock': '\uf023',
        'fa-unlock': '\uf09c',
        'fa-ring': '\uf70b',
        'fa-crown': '\uf521',
        'fa-chess-rook': '\uf447',
        'fa-chess-king': '\uf43f',
        'fa-chess-queen': '\uf445',

        // Creatures and monsters
        'fa-dragon': '\uf6d5',
        'fa-spider': '\uf717',
        'fa-bug': '\uf188',
        'fa-ghost': '\uf6e2',
        'fa-wolf-pack-battalion': '\uf514',

        // Actions and movement
        'fa-walking': '\uf554',
        'fa-running': '\uf70c',
        'fa-fist-raised': '\uf6de',
        'fa-hand-paper': '\uf256',
        'fa-arrows-alt': '\uf0b2',
        'fa-arrow-up': '\uf062',
        'fa-arrow-down': '\uf063',
        'fa-arrow-left': '\uf060',
        'fa-arrow-right': '\uf061',

        // Buildings and structures
        'fa-home': '\uf015',
        'fa-castle': '\uf6da',
        'fa-church': '\uf51d',
        'fa-store': '\uf54e',
        'fa-warehouse': '\uf494',
        'fa-building': '\uf1ad',
        'fa-door-open': '\uf52b',
        'fa-door-closed': '\uf52a',

        // Tools and objects
        'fa-tools': '\uf7d9',
        'fa-cog': '\uf013',
        'fa-wrench': '\uf0ad',
        'fa-screwdriver': '\uf54a',
        'fa-book': '\uf02d',
        'fa-scroll': '\uf70e',
        'fa-map': '\uf279',
        'fa-compass': '\uf14e',

        // Food and potions
        'fa-apple-alt': '\uf5d1',
        'fa-bread-slice': '\uf7ec',
        'fa-cheese': '\uf7ef',
        'fa-fish': '\uf578',
        'fa-beer': '\uf0fc',
        'fa-wine-bottle': '\uf72f',

        // Elements and magic
        'fa-icicles': '\uf7ad',
        'fa-temperature-high': '\uf769',
        'fa-temperature-low': '\uf76b',
        'fa-wind': '\uf72e',
        'fa-meteor': '\uf753',
        'fa-radiation': '\uf7b9',

        // Status and effects
        'fa-plus': '\uf067',
        'fa-minus': '\uf068',
        'fa-times': '\uf00d',
        'fa-check': '\uf00c',
        'fa-exclamation': '\uf12a',
        'fa-exclamation-triangle': '\uf071',
        'fa-ban': '\uf05e',
        'fa-skull-crossbones': '\uf714'
    };

    return iconMap;
}

// Function to test if an icon renders correctly
function testIcon(unicode) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 64;
    canvas.height = 64;

    ctx.font = '900 48px "Font Awesome 6 Free"';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillText(unicode, 32, 32);

    // Check if anything was drawn (non-transparent pixels)
    const imageData = ctx.getImageData(0, 0, 64, 64);
    for (let i = 3; i < imageData.data.length; i += 4) { // Check alpha channel
        if (imageData.data[i] > 0) {
            return true;
        }
    }
    return false;
}

// Export the icon map for use in TextureManager
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { generateIconMap, testIcon };
} else if (typeof window !== 'undefined') {
    window.FontAwesomeIconMap = generateIconMap();
    window.testFontAwesomeIcon = testIcon;
}

console.log('FontAwesome Icon Map generated. Access via window.FontAwesomeIconMap');
console.log('Total icons:', Object.keys(generateIconMap()).length);
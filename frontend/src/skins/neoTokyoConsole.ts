import type { FixedSkinProfile, GameSkin } from './types';

const fixedAssetUrls = import.meta.glob<string>('./neo-tokyo-console/fixed/**/*.png', {
  eager: true,
  query: '?url',
  import: 'default'
});

function fixedAsset(path: string): string {
  const asset = fixedAssetUrls[`./neo-tokyo-console/fixed/${path}`];
  if (!asset) {
    throw new Error(`Missing fixed skin asset: ${path}`);
  }
  return asset;
}

function fixedButton(
  profile: 'mobile' | 'desktop',
  name: 'attack' | 'run' | 'dpad' | 'log'
): Record<'idle' | 'hover' | 'pressed' | 'disabled', string> {
  return {
    idle: fixedAsset(`${profile}/${name}-idle.png`),
    hover: fixedAsset(`${profile}/${name}-hover.png`),
    pressed: fixedAsset(`${profile}/${name}-pressed.png`),
    disabled: fixedAsset(`${profile}/${name}-disabled.png`)
  };
}

function fixedIndicators(profile: 'mobile' | 'desktop') {
  return {
    status: {
      ready: fixedAsset(`${profile}/status-ready.png`),
      thinking: fixedAsset(`${profile}/status-thinking.png`),
      error: fixedAsset(`${profile}/status-error.png`),
      offline: fixedAsset(`${profile}/status-offline.png`)
    },
    combatLed: {
      on: fixedAsset(`${profile}/led-on.png`),
      off: fixedAsset(`${profile}/led-off.png`)
    }
  };
}

const mobileIndicators = fixedIndicators('mobile');
const desktopIndicators = fixedIndicators('desktop');

const fixedProfiles: FixedSkinProfile[] = [
  {
    id: 'mobile-portrait',
    label: 'Mobile Portrait Cyberdeck',
    width: 390,
    height: 844,
    background: fixedAsset('mobile/chassis.png'),
    regions: {
      map: { x: 24, y: 48, width: 342, height: 300 },
      title: { x: 26, y: 356, width: 270, height: 34 },
      latest: { x: 32, y: 394, width: 326, height: 56 },
      log: { x: 34, y: 398, width: 320, height: 210 },
      playerHp: { x: 30, y: 484, width: 330, height: 70 },
      playerHpFill: { x: 86, y: 508, width: 242, height: 10 },
      playerStats: { x: 34, y: 524, width: 318, height: 25 },
      combat: { x: 31, y: 594, width: 328, height: 44 },
      enemyHpFill: { x: 150, y: 624, width: 168, height: 9 }
    },
    buttons: {
      attack: {
        rect: { x: 176, y: 666, width: 186, height: 64 },
        label: 'Attack',
        icon: 'fa-solid fa-hand-fist',
        states: fixedButton('mobile', 'attack')
      },
      run: {
        rect: { x: 176, y: 746, width: 186, height: 64 },
        label: 'Run',
        icon: 'fa-solid fa-person-running',
        states: fixedButton('mobile', 'run')
      },
      log: {
        rect: { x: 298, y: 368, width: 64, height: 34 },
        label: 'Log',
        icon: 'fa-solid fa-list',
        states: fixedButton('mobile', 'log')
      },
      moveN: {
        rect: { x: 78, y: 684, width: 42, height: 42 },
        label: 'N',
        icon: 'fa-solid fa-caret-up',
        states: fixedButton('mobile', 'dpad')
      },
      moveS: {
        rect: { x: 78, y: 764, width: 42, height: 42 },
        label: 'S',
        icon: 'fa-solid fa-caret-down',
        states: fixedButton('mobile', 'dpad')
      },
      moveE: {
        rect: { x: 118, y: 724, width: 42, height: 42 },
        label: 'E',
        icon: 'fa-solid fa-caret-right',
        states: fixedButton('mobile', 'dpad')
      },
      moveW: {
        rect: { x: 38, y: 724, width: 42, height: 42 },
        label: 'W',
        icon: 'fa-solid fa-caret-left',
        states: fixedButton('mobile', 'dpad')
      }
    },
    indicators: {
      status: {
        rect: { x: 300, y: 356, width: 70, height: 32 },
        states: mobileIndicators.status
      },
      combatLed: {
        rect: { x: 344, y: 672, width: 18, height: 18 },
        states: mobileIndicators.combatLed
      }
    }
  },
  {
    id: 'desktop-wide',
    label: 'Desktop Wide Cyberdeck',
    width: 1280,
    height: 900,
    background: fixedAsset('desktop/chassis.png'),
    regions: {
      map: { x: 34, y: 56, width: 808, height: 792 },
      title: { x: 874, y: 24, width: 300, height: 40 },
      latest: { x: 892, y: 746, width: 334, height: 78 },
      log: { x: 892, y: 746, width: 334, height: 106 },
      playerHp: { x: 890, y: 86, width: 336, height: 86 },
      playerHpFill: { x: 956, y: 116, width: 220, height: 11 },
      playerStats: { x: 892, y: 136, width: 326, height: 28 },
      combat: { x: 892, y: 220, width: 332, height: 48 },
      enemyHpFill: { x: 1028, y: 254, width: 154, height: 10 }
    },
    buttons: {
      attack: {
        rect: { x: 1004, y: 330, width: 240, height: 58 },
        label: 'Attack',
        icon: 'fa-solid fa-hand-fist',
        states: fixedButton('desktop', 'attack')
      },
      run: {
        rect: { x: 1004, y: 402, width: 240, height: 58 },
        label: 'Run',
        icon: 'fa-solid fa-person-running',
        states: fixedButton('desktop', 'run')
      },
      log: {
        rect: { x: 1172, y: 714, width: 72, height: 36 },
        label: 'Log',
        icon: 'fa-solid fa-list',
        states: fixedButton('desktop', 'log')
      },
      moveN: {
        rect: { x: 916, y: 332, width: 44, height: 44 },
        label: 'N',
        icon: 'fa-solid fa-caret-up',
        states: fixedButton('desktop', 'dpad')
      },
      moveS: {
        rect: { x: 916, y: 416, width: 44, height: 44 },
        label: 'S',
        icon: 'fa-solid fa-caret-down',
        states: fixedButton('desktop', 'dpad')
      },
      moveE: {
        rect: { x: 958, y: 374, width: 44, height: 44 },
        label: 'E',
        icon: 'fa-solid fa-caret-right',
        states: fixedButton('desktop', 'dpad')
      },
      moveW: {
        rect: { x: 874, y: 374, width: 44, height: 44 },
        label: 'W',
        icon: 'fa-solid fa-caret-left',
        states: fixedButton('desktop', 'dpad')
      }
    },
    indicators: {
      status: {
        rect: { x: 1176, y: 20, width: 84, height: 34 },
        states: desktopIndicators.status
      },
      combatLed: {
        rect: { x: 1228, y: 336, width: 18, height: 18 },
        states: desktopIndicators.combatLed
      }
    }
  }
];

export const neoTokyoConsoleSkin: GameSkin = {
  id: 'neo-tokyo-console',
  name: 'Neo Tokyo Console',
  className: 'skin-neo-tokyo-console',
  tags: ['cyberpunk', 'city', 'neon', 'technology', 'crime', 'modern'],
  mood: ['dense', 'electric', 'urban', 'tactical'],
  map: {
    canvasBackground: '#070b0d',
    exploredTileScale: 0.78,
    unexploredTileScale: 0.28,
    exploredTileStroke: 0x30414a,
    unexploredTileStroke: 0x172025,
    unexploredTileOverlay: 0x071014,
    unexploredTileOverlayAlpha: 0.42,
    playerMarker: 0x8cff8d,
    defeatedPlayerMarker: 0xff4f61,
    victoryPlayerMarker: 0xffc857
  },
  fixedProfiles
};

import type {
  FixedSkinMaterial,
  FixedSkinMaterialKind,
  FixedSkinProfile,
  FixedSkinProfileMeta,
  FixedSkinRuntimeLayout,
  FixedSkinRenderTheme,
  GameSkin
} from './types';

type FixedAssetProfile =
  | 'mobile'
  | 'desktop'
  | 'reference-mobile'
  | 'reference-mobile-v2'
  | 'reference-mobile-v3'
  | 'reference-mobile-compact'
  | 'rain-city-derived-compact'
  | 'signal-noir-mobile-compact'
  | 'gold-mobile-compact'
  | 'amber-mobile-compact'
  | 'terminal-green-mobile-compact'
  | 'obsidian-rain-proto'
  | 'gold-mobile'
  | 'amber-mobile'
  | 'signal-noir-mobile';
type FixedButtonAssetName =
  | 'attack'
  | 'run'
  | 'restart'
  | 'dpad'
  | 'dpad-n'
  | 'dpad-s'
  | 'dpad-e'
  | 'dpad-w'
  | 'log'
  | 'inventory';
type ManifestButtonId = 'attack' | 'run' | 'restart' | 'log' | 'inventory' | 'moveN' | 'moveS' | 'moveE' | 'moveW';
type SkinKitRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};
type SkinKitImageAsset = {
  path: string;
  width?: number;
  height?: number;
  alpha?: boolean;
  sourceProfile?: FixedAssetProfile;
};
type SkinKitMaterial = {
  fill: SkinKitImageAsset;
  frame: SkinKitImageAsset;
  slice: number;
  renderMode?: FixedSkinMaterial['renderMode'];
};
type SkinKitRenderTheme = Record<keyof FixedSkinRenderTheme, string>;
type FixedSkinKit = {
  id: FixedAssetProfile;
  meta?: FixedSkinProfileMeta & {
    label: string;
  };
  kind: FixedSkinProfile['kind'];
  size: {
    width: number;
    height: number;
  };
  regions: {
    map: SkinKitRect;
    title: SkinKitRect;
    latest: SkinKitRect;
    log: SkinKitRect;
    inventory: SkinKitRect;
    player: SkinKitRect;
    combat: SkinKitRect;
    controls: SkinKitRect;
    endState: SkinKitRect;
  };
  layout: {
    buttons: Record<ManifestButtonId, SkinKitRect>;
    indicators: {
      status: SkinKitRect;
      combatLed: SkinKitRect;
    };
    fills: {
      playerHp: SkinKitRect;
      enemyHp: SkinKitRect;
      playerStats: SkinKitRect;
    };
  };
  renderTheme?: SkinKitRenderTheme;
  runtime?: FixedSkinRuntimeLayout;
  assets: {
    chassis: {
      path: string;
    };
    buttons: Record<ManifestButtonId, {
      prefix: FixedButtonAssetName;
      sourceProfile?: FixedAssetProfile;
      label?: string;
      icon?: string;
      hideLabel?: boolean;
    }>;
    indicators?: {
      status?: {
        sourceProfile?: FixedAssetProfile;
      };
      combatLed?: {
        sourceProfile?: FixedAssetProfile;
      };
    };
    materials?: Record<FixedSkinMaterialKind, SkinKitMaterial>;
  };
};

const fixedAssetUrls = import.meta.glob<string>([
  './neo-tokyo-console/fixed/**/*.png',
  '!./neo-tokyo-console/fixed/**/source-*.png'
], {
  eager: true,
  query: '?url',
  import: 'default'
});
const materialAssetUrls = import.meta.glob<string>('./neo-tokyo-console/assets/*.png', {
  eager: true,
  query: '?url',
  import: 'default'
});
const fixedSkinKitSources = import.meta.glob<string>('./neo-tokyo-console/fixed/**/skin-kit.json', {
  eager: true,
  query: '?raw',
  import: 'default'
});

function fixedAsset(path: string): string {
  const asset = fixedAssetUrls[`./neo-tokyo-console/fixed/${path}`];
  if (!asset) {
    throw new Error(`Missing fixed skin asset: ${path}`);
  }
  return asset;
}

function materialAsset(path: string): string {
  const asset = materialAssetUrls[`./neo-tokyo-console/assets/${path}`];
  if (!asset) {
    throw new Error(`Missing fixed skin material asset: ${path}`);
  }
  return asset;
}

function skinKitImageAsset(profile: FixedAssetProfile, asset: SkinKitImageAsset): string {
  const normalizedPath = asset.path.replaceAll('\\', '/');
  if (normalizedPath.startsWith('../../assets/')) {
    return materialAsset(normalizedPath.slice('../../assets/'.length));
  }

  if (normalizedPath.includes('../')) {
    throw new Error(`Skin kit asset path cannot escape the skin directory: ${asset.path}`);
  }

  return fixedAsset(`${asset.sourceProfile ?? profile}/${normalizedPath}`);
}

const sharedNeoTokyoMaterials = {
  panel: {
    fill: materialAsset('panel-fill-tile.png'),
    frame: materialAsset('panel-frame-9slice.png'),
    slice: 14
  },
  lcd: {
    fill: materialAsset('lcd-fill-tile.png'),
    frame: materialAsset('lcd-frame-9slice.png'),
    slice: 13
  },
  button: {
    fill: materialAsset('button-fill-tile.png'),
    frame: materialAsset('button-frame-9slice.png'),
    slice: 13
  }
} satisfies Record<FixedSkinMaterialKind, FixedSkinMaterial>;

function manifestMaterials(profile: FixedAssetProfile, kit: FixedSkinKit): Record<FixedSkinMaterialKind, FixedSkinMaterial> {
  const materials = kit.assets.materials;
  if (!materials) {
    return sharedNeoTokyoMaterials;
  }

  return {
    panel: manifestMaterial(profile, materials.panel),
    lcd: manifestMaterial(profile, materials.lcd),
    button: manifestMaterial(profile, materials.button)
  };
}

function manifestMaterial(profile: FixedAssetProfile, material: SkinKitMaterial): FixedSkinMaterial {
  if (!material?.fill || !material.frame) {
    throw new Error(`Missing fixed skin material asset for ${profile}`);
  }

  return {
    fill: skinKitImageAsset(profile, material.fill),
    frame: skinKitImageAsset(profile, material.frame),
    slice: material.slice,
    renderMode: material.renderMode
  };
}

function manifestRenderTheme(profile: FixedAssetProfile, theme: SkinKitRenderTheme | undefined): FixedSkinRenderTheme | undefined {
  if (!theme) {
    return undefined;
  }

  return {
    primary: manifestTint(profile, 'primary', theme.primary),
    primaryText: manifestTextColor(profile, 'primaryText', theme.primaryText),
    primaryDimText: manifestTextColor(profile, 'primaryDimText', theme.primaryDimText),
    secondary: manifestTint(profile, 'secondary', theme.secondary),
    secondaryText: manifestTextColor(profile, 'secondaryText', theme.secondaryText),
    lcdFill: manifestTint(profile, 'lcdFill', theme.lcdFill),
    panelFill: manifestTint(profile, 'panelFill', theme.panelFill),
    controlFrame: manifestTint(profile, 'controlFrame', theme.controlFrame),
    buttonFrame: manifestTint(profile, 'buttonFrame', theme.buttonFrame),
    titleText: manifestTextColor(profile, 'titleText', theme.titleText),
    bodyText: manifestTextColor(profile, 'bodyText', theme.bodyText),
    mutedText: manifestTextColor(profile, 'mutedText', theme.mutedText),
    combat: manifestTint(profile, 'combat', theme.combat),
    combatText: manifestTextColor(profile, 'combatText', theme.combatText)
  };
}

function manifestTint(profile: FixedAssetProfile, key: keyof FixedSkinRenderTheme, value: string): number {
  const hex = manifestTextColor(profile, key, value);
  return Number.parseInt(hex.slice(1), 16);
}

function manifestTextColor(profile: FixedAssetProfile, key: keyof FixedSkinRenderTheme, value: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(value ?? '')) {
    throw new Error(`Skin kit ${profile} renderTheme.${key} must be a #rrggbb color`);
  }
  return value.toLowerCase();
}

function fixedButton(
  profile: FixedAssetProfile,
  name: FixedButtonAssetName
): Record<'idle' | 'hover' | 'pressed' | 'disabled', string> {
  return {
    idle: fixedAsset(`${profile}/${name}-idle.png`),
    hover: fixedAsset(`${profile}/${name}-hover.png`),
    pressed: fixedAsset(`${profile}/${name}-pressed.png`),
    disabled: fixedAsset(`${profile}/${name}-disabled.png`)
  };
}

function fixedIndicators(profile: FixedAssetProfile) {
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
const referenceMobileIndicators = fixedIndicators('reference-mobile');

const buttonLabels: Record<ManifestButtonId, string> = {
  attack: 'Attack',
  run: 'Run',
  restart: 'Restart',
  log: 'Log',
  inventory: 'Inventory',
  moveN: 'N',
  moveS: 'S',
  moveE: 'E',
  moveW: 'W'
};

function fixedSkinKit(profile: FixedAssetProfile): FixedSkinKit {
  const source = fixedSkinKitSources[`./neo-tokyo-console/fixed/${profile}/skin-kit.json`];
  if (!source) {
    throw new Error(`Missing fixed skin kit: ${profile}/skin-kit.json`);
  }
  return JSON.parse(source) as FixedSkinKit;
}

function createManifestProfile(id: FixedAssetProfile, fallbackLabel?: string): FixedSkinProfile {
  const kit = fixedSkinKit(id);
  const indicators = {
    status: fixedIndicators(kit.assets.indicators?.status?.sourceProfile ?? id).status,
    combatLed: fixedIndicators(kit.assets.indicators?.combatLed?.sourceProfile ?? id).combatLed
  };

  return {
    id: kit.id ?? id,
    label: kit.meta?.label ?? fallbackLabel ?? id,
    meta: kit.meta ? {
      family: kit.meta.family,
      role: kit.meta.role,
      tags: kit.meta.tags,
      mood: kit.meta.mood,
      palette: kit.meta.palette,
      defaultPriority: kit.meta.defaultPriority,
      generation: kit.meta.generation
    } : undefined,
    kind: kit.kind,
    width: kit.size.width,
    height: kit.size.height,
    background: fixedAsset(`${id}/${kit.assets.chassis.path}`),
    materials: manifestMaterials(id, kit),
    renderTheme: manifestRenderTheme(id, kit.renderTheme),
    runtime: kit.runtime,
    regions: {
      map: kit.regions.map,
      title: kit.regions.title,
      latest: kit.regions.latest,
      log: kit.regions.log,
      playerHp: kit.regions.player,
      playerHpFill: kit.layout.fills.playerHp,
      playerStats: kit.layout.fills.playerStats,
      combat: kit.regions.combat,
      controls: kit.regions.controls,
      enemyHpFill: kit.layout.fills.enemyHp,
      endState: kit.regions.endState,
      inventory: kit.regions.inventory
    },
    buttons: {
      attack: manifestButton(id, kit, 'attack'),
      run: manifestButton(id, kit, 'run'),
      log: manifestButton(id, kit, 'log'),
      inventory: manifestButton(id, kit, 'inventory'),
      moveN: manifestButton(id, kit, 'moveN'),
      moveS: manifestButton(id, kit, 'moveS'),
      moveE: manifestButton(id, kit, 'moveE'),
      moveW: manifestButton(id, kit, 'moveW'),
      restart: manifestButton(id, kit, 'restart')
    },
    indicators: {
      status: {
        rect: kit.layout.indicators.status,
        states: indicators.status
      },
      combatLed: {
        rect: kit.layout.indicators.combatLed,
        states: indicators.combatLed
      }
    }
  };
}

function manifestButton(profile: FixedAssetProfile, kit: FixedSkinKit, buttonId: ManifestButtonId) {
  const asset = kit.assets.buttons[buttonId];
  const sourceProfile = asset.sourceProfile ?? profile;

  return {
    rect: kit.layout.buttons[buttonId],
    label: asset.label ?? buttonLabels[buttonId],
    icon: asset.icon,
    hideLabel: asset.hideLabel ?? true,
    states: fixedButton(sourceProfile, asset.prefix)
  };
}

const fixedProfiles: FixedSkinProfile[] = [
  createManifestProfile('reference-mobile-compact'),
  createManifestProfile('rain-city-derived-compact'),
  createManifestProfile('signal-noir-mobile-compact'),
  createManifestProfile('gold-mobile-compact'),
  createManifestProfile('amber-mobile-compact'),
  createManifestProfile('terminal-green-mobile-compact'),
  createManifestProfile('obsidian-rain-proto'),
  createManifestProfile('reference-mobile-v3'),
  createManifestProfile('signal-noir-mobile'),
  createManifestProfile('gold-mobile'),
  createManifestProfile('amber-mobile'),
  {
    id: 'mobile-portrait',
    label: 'Mobile Portrait Cyberdeck',
    kind: 'mobilePortrait',
    width: 390,
    height: 844,
    background: fixedAsset('mobile/chassis.png'),
    materials: sharedNeoTokyoMaterials,
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
        icon: 'fa-solid fa-bolt',
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
    id: 'reference-mobile',
    label: 'Reference Cyberdeck Mobile',
    kind: 'mobilePortrait',
    width: 390,
    height: 844,
    background: fixedAsset('reference-mobile/chassis.png'),
    materials: sharedNeoTokyoMaterials,
    regions: {
      map: { x: 24, y: 45, width: 342, height: 371 },
      title: { x: 26, y: 538, width: 268, height: 36 },
      latest: { x: 25, y: 454, width: 276, height: 50 },
      log: { x: 20, y: 444, width: 292, height: 72 },
      playerHp: { x: 24, y: 574, width: 340, height: 48 },
      playerHpFill: { x: 84, y: 594, width: 177, height: 8 },
      playerStats: { x: 32, y: 614, width: 310, height: 20 },
      combat: { x: 31, y: 623, width: 318, height: 40 },
      enemyHpFill: { x: 178, y: 644, width: 112, height: 8 }
    },
    buttons: {
      attack: {
        rect: { x: 202, y: 646, width: 156, height: 69 },
        label: 'Attack',
        hideLabel: true,
        states: fixedButton('reference-mobile', 'attack')
      },
      run: {
        rect: { x: 213, y: 723, width: 150, height: 68 },
        label: 'Run',
        hideLabel: true,
        states: fixedButton('reference-mobile', 'run')
      },
      log: {
        rect: { x: 316, y: 436, width: 43, height: 31 },
        label: 'Log',
        hideLabel: true,
        states: fixedButton('reference-mobile', 'log')
      },
      moveN: {
        rect: { x: 74, y: 675, width: 55, height: 55 },
        label: 'N',
        hideLabel: true,
        states: fixedButton('reference-mobile', 'dpad-n')
      },
      moveS: {
        rect: { x: 74, y: 764, width: 55, height: 55 },
        label: 'S',
        hideLabel: true,
        states: fixedButton('reference-mobile', 'dpad-s')
      },
      moveE: {
        rect: { x: 116, y: 717, width: 55, height: 55 },
        label: 'E',
        hideLabel: true,
        states: fixedButton('reference-mobile', 'dpad-e')
      },
      moveW: {
        rect: { x: 27, y: 717, width: 55, height: 55 },
        label: 'W',
        hideLabel: true,
        states: fixedButton('reference-mobile', 'dpad-w')
      }
    },
    indicators: {
      status: {
        rect: { x: 310, y: 529, width: 52, height: 24 },
        states: referenceMobileIndicators.status
      },
      combatLed: {
        rect: { x: 344, y: 654, width: 18, height: 18 },
        states: referenceMobileIndicators.combatLed
      }
    }
  },
  createManifestProfile('reference-mobile-v2'),
  createManifestProfile('desktop')
];

export const neoTokyoConsoleSkin: GameSkin = {
  id: 'neo-tokyo-console',
  name: 'Neo Tokyo Console',
  tags: ['cyberpunk', 'city', 'neon', 'technology', 'crime', 'modern'],
  mood: ['dense', 'electric', 'urban', 'tactical'],
  map: {
    canvasBackground: '#070b0d',
    exploredTileScale: 0.96,
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

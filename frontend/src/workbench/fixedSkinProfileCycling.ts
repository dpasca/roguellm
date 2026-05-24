import type { FixedSkinProfile, GameSkin } from '../skins/types';

export function cycleFixedSkinProfile(skin: GameSkin, currentProfile: FixedSkinProfile, event: KeyboardEvent): boolean {
  const direction = fixedSkinProfileCycleDirection(event);
  if (!direction) {
    return false;
  }

  const profiles = cycleCandidateProfiles(skin, currentProfile);
  if (profiles.length <= 1) {
    return false;
  }

  const currentIndex = profiles.findIndex((profile) => profile.id === currentProfile.id);
  const baseIndex = currentIndex >= 0
    ? currentIndex
    : direction > 0
      ? -1
      : 0;
  const nextIndex = (baseIndex + direction + profiles.length) % profiles.length;
  const nextProfile = profiles[nextIndex];
  const url = new URL(window.location.href);
  url.searchParams.set('profile', nextProfile.id);
  event.preventDefault();
  window.location.assign(url.toString());
  return true;
}

function cycleCandidateProfiles(skin: GameSkin, currentProfile: FixedSkinProfile): FixedSkinProfile[] {
  const sameKindProfiles = (skin.fixedProfiles ?? []).filter((profile) => profile.kind === currentProfile.kind);
  const productionProfiles = sameKindProfiles.filter(isProductionCycleProfile);
  return productionProfiles.length > 1 ? productionProfiles : sameKindProfiles;
}

function isProductionCycleProfile(profile: FixedSkinProfile): boolean {
  return profile.meta?.role === 'default' || profile.meta?.role === 'variant';
}

function fixedSkinProfileCycleDirection(event: KeyboardEvent): -1 | 1 | null {
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return null;
  }

  if (event.key === '[') {
    return -1;
  }

  if (event.key === ']') {
    return 1;
  }

  return null;
}

import type { FixedSkinProfile, GameSkin } from '../skins/types';

export function selectFixedSkinProfile(
  skin: GameSkin,
  location: Location = window.location,
  viewportWidth = window.innerWidth,
  viewportHeight = window.innerHeight
): FixedSkinProfile | null {
  const profiles = skin.fixedProfiles ?? [];
  if (profiles.length === 0) {
    return null;
  }

  const params = new URL(location.href).searchParams;
  const preferredId = params.get('profile');
  const preferred = profiles.find((profile) => profile.id === preferredId);
  if (preferred) {
    return preferred;
  }

  if (viewportWidth >= 900) {
    return selectPreferredProfile(profiles, 'desktopWide') ?? profiles[0] ?? null;
  }

  if (viewportHeight <= 700) {
    return selectThemedProfile(profiles, 'mobileCompact', params) ??
      selectThemedProfile(profiles, 'mobilePortrait', params) ??
      selectPreferredProfile(profiles, 'mobileCompact') ??
      selectPreferredProfile(profiles, 'mobilePortrait') ??
      profiles[0] ??
      null;
  }

  const themed = selectThemedProfile(profiles, 'mobilePortrait', params);
  if (themed) {
    return themed;
  }

  return selectPreferredProfile(profiles, 'mobilePortrait') ?? profiles[0] ?? null;
}

function selectThemedProfile(
  profiles: FixedSkinProfile[],
  kind: FixedSkinProfile['kind'],
  params: URLSearchParams
): FixedSkinProfile | null {
  const request = {
    tags: readTokenParams(params, 'skin_tags'),
    mood: readTokenParams(params, 'skin_mood'),
    palette: readTokenParams(params, 'skin_palette')
  };

  if (request.tags.length === 0 && request.mood.length === 0 && request.palette.length === 0) {
    return null;
  }

  return profiles
    .filter((profile) => profile.kind === kind)
    .reduce<{ profile: FixedSkinProfile; score: number } | null>((best, profile) => {
      const score = themedProfileScore(profile, request);
      if (score <= 0) {
        return best;
      }

      if (!best || score > best.score || (score === best.score && profilePriority(profile) > profilePriority(best.profile))) {
        return { profile, score };
      }

      return best;
    }, null)?.profile ?? null;
}

function selectPreferredProfile(
  profiles: FixedSkinProfile[],
  kind: FixedSkinProfile['kind']
): FixedSkinProfile | null {
  return profiles
    .filter((profile) => profile.kind === kind)
    .reduce<FixedSkinProfile | null>((best, profile) => {
      if (!best) {
        return profile;
      }

      return profilePriority(profile) > profilePriority(best) ? profile : best;
    }, null);
}

function profilePriority(profile: FixedSkinProfile): number {
  return profile.meta?.defaultPriority ?? 0;
}

function themedProfileScore(
  profile: FixedSkinProfile,
  request: { tags: string[]; mood: string[]; palette: string[] }
): number {
  return countTokenMatches(profile.meta?.tags, request.tags) * 4 +
    countTokenMatches(profile.meta?.mood, request.mood) * 2 +
    countTokenMatches(profile.meta?.palette, request.palette);
}

function countTokenMatches(profileTokens: string[] | undefined, requestTokens: string[]): number {
  if (!profileTokens || requestTokens.length === 0) {
    return 0;
  }

  const available = new Set(profileTokens.map((token) => token.toLowerCase()));
  return requestTokens.filter((token) => available.has(token)).length;
}

function readTokenParams(params: URLSearchParams, key: string): string[] {
  return params.getAll(key)
    .flatMap((value) => value.split(','))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

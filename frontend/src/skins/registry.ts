import { neoTokyoConsoleSkin } from './neoTokyoConsole';
import type { GameSkin } from './types';

export const DEFAULT_SKIN_ID = neoTokyoConsoleSkin.id;
export const gameSkins: readonly GameSkin[] = [neoTokyoConsoleSkin];

const skinsById = new Map(gameSkins.map((skin) => [skin.id, skin]));

export function getSkinById(id: string | null | undefined): GameSkin {
  return skinsById.get(id ?? '') ?? neoTokyoConsoleSkin;
}

export function getSkinFromLocation(location: Location = window.location): GameSkin {
  const params = new URL(location.href).searchParams;
  return getSkinById(params.get('skin'));
}

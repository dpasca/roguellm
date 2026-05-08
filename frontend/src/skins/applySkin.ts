import type { GameSkin } from './types';

let appliedSkinClass: string | null = null;

export function applySkin(skin: GameSkin, root: HTMLElement = document.body): void {
  if (appliedSkinClass && appliedSkinClass !== skin.className) {
    root.classList.remove(appliedSkinClass);
  }

  root.classList.add(skin.className);
  root.dataset.skin = skin.id;
  appliedSkinClass = skin.className;
}

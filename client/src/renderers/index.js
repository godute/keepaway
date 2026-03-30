import { KeepawayRenderer } from './KeepawayRenderer.js';
import { TagRenderer } from './TagRenderer.js';
import { SumoRenderer } from './SumoRenderer.js';
import { HotPotatoRenderer } from './HotPotatoRenderer.js';
import { TerritoryRenderer } from './TerritoryRenderer.js';
import { DodgeballRenderer } from './DodgeballRenderer.js';
import { HideSeekRenderer } from './HideSeekRenderer.js';
import { SnowballRenderer } from './SnowballRenderer.js';

const RENDERER_MAP = {
  keepaway: KeepawayRenderer,
  tag: TagRenderer,
  sumo: SumoRenderer,
  hotpotato: HotPotatoRenderer,
  territory: TerritoryRenderer,
  dodgeball: DodgeballRenderer,
  hideseek: HideSeekRenderer,
  snowball: SnowballRenderer,
};

/**
 * Factory function that creates the appropriate renderer for a game type.
 * @param {string} gameType - The game mode identifier (e.g. 'keepaway', 'tag')
 * @param {Phaser.Scene} scene - The GameScene instance
 * @returns {BaseRenderer} A renderer instance for the given game type
 */
export function createRenderer(gameType, scene) {
  const RendererClass = RENDERER_MAP[gameType];
  if (!RendererClass) {
    console.warn(`No renderer found for game type "${gameType}", falling back to keepaway`);
    return new KeepawayRenderer(scene);
  }
  return new RendererClass(scene);
}

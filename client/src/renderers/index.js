import { KeepawayRenderer } from './KeepawayRenderer.js';
import { TagRenderer } from './TagRenderer.js';
import { SumoRenderer } from './SumoRenderer.js';
import { HotPotatoRenderer } from './HotPotatoRenderer.js';
import { TerritoryRenderer } from './TerritoryRenderer.js';

const RENDERER_MAP = {
  keepaway: KeepawayRenderer,
  tag: TagRenderer,
  sumo: SumoRenderer,
  hot_potato: HotPotatoRenderer,
  territory: TerritoryRenderer,
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

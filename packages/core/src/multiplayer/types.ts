import type { MultiplayerSettings } from './settings.js';
import type { ToolFamilyCandidate } from './tool-discovery.js';

/** The person's settings for meeting people and calling remote tools, kept on this device, and the search for tool families. */
export interface KernlMultiplayer extends MultiplayerSettings {
  /** Find tool families from an announcement reference, a schema hash or a website, over the servers in use (D-043). */
  discover(input: string): Promise<readonly ToolFamilyCandidate[]>;
}

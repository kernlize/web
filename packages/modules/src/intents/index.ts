/**
 * `@kernlize/modules/intents`: the intents module on its own, so a host that lists it bundles only what it needs (D-068).
 *
 * @packageDocumentation
 */
export { intentsModule } from '../modules/intents.js';
export { createInstalledApplets, type InstallableApplet, type InstalledApplet, type InstalledApplets, type InstalledContract } from '../intents/installed.js';
export {
  HANDLER_PREFERENCES_KIND,
  catalogIdForRef,
  parseHandlerPreferences,
  preferenceTemplate,
  preferredHandlers,
  refForCatalogId,
  type HandlerPreferences,
} from '../intents/preferences.js';
export { createHandlerDefaults, preferenceRelays, type HandlerDefaults, type HandlerDefaultsOptions, type PreferenceSigner } from '../intents/defaults.js';
export { createIntentRouter, type IntentRouter, type IntentRouterOptions } from '../intents/router.js';
export { DELIVERY_RETRY, createIntentDelivery, type IntentDeliveryOptions } from '../intents/delivery.js';
export { createKernlIntents, type KernlIntentDeps, type KernlIntents } from '../kernl-intents.js';

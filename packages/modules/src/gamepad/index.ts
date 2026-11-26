/**
 * The gamepad module on its own, without importing kernl’s other modules.
 *
 * @packageDocumentation
 */
export { gamepadModule } from '../modules/gamepad.js';
export { createControllerService, type ControllerDeps, type ControllerSettings } from './controllers.js';

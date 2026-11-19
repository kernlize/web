import { createPeople, type People } from '@kernlize/core';
import { EMPTY } from 'rxjs';

/** The preview's way of finding a person: every form of an identity is read, and the servers one names hold nothing, since the preview is offline. */
export const createPreviewPeople = (): People => createPeople({ store: {} as never, pool: { request: () => EMPTY } as never });

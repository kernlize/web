/**
 * `@kernlize/modules/uploads`: uploads (the files module) on its own, so a host that lists it bundles only what it needs (D-068).
 *
 * @packageDocumentation
 */
export { createAccountFileServers, DEFAULT_FILE_SERVERS, fileServersFromEvent, fileServerTags, type AccountFileServers, type AccountFileServersOptions, type FileServerState } from '../files/file-servers.js';
export { askUploadConsent, createBlossomUploader, describeUpload, sizeWords, type BlossomUploaderOptions, type MultiServerUpload, type UploadDetails } from '../files/uploader.js';
export { filesModule } from '../modules/files.js';

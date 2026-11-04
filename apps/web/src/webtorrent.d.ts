// The browser build of the download library ships without types; the shell reads it through
// the structural WebTorrentLike type from @kernl/bridges (D-017).
declare module 'webtorrent/dist/webtorrent.min.js' {
  const WebTorrent: new () => unknown;
  export default WebTorrent;
}

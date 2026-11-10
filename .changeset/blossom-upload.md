---
"@kernlize/core": minor
---

Applets can upload files (NAP-UPLOAD) through Blossom. `kernl.files` follows the account's file-server list (kind 10063) with well-known defaults. `createBlossomUploader` uses `blossom-client-sdk` to upload to the first server and mirror to the rest, succeeds when any server stores the file, and asks the person before each file leaves with a new `public` consent severity. The shell offers the `upload` domain.

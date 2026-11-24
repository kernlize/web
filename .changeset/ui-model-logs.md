---
'@kernlize/ui-model': minor
---

Logs (#74): `createGuardLog`, `createTrafficLog`, `createNoticeStore` and `createUnreadCount` keep the newest events, per-window traffic with its marks, notices that go by themselves, and the shell's own unread count, framework-free and in memory only. `@kernlize/guard` and `@kernlize/messaging` are now dependencies, for their types.

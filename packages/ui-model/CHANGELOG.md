# @kernlize/ui-model

## 0.2.4

### Patch Changes

- 2794231: The view models read the message seal and the ask kinds from `@kernlize/kernel/seal` and `@kernlize/kernel/asks`, and depend on `@kernlize/kernel` instead of `@kernlize/core` (D-068). Nothing they export changes.

## 0.2.3

### Patch Changes

- Updated dependencies [c6402c7]
  - @kernlize/core@0.30.0

## 0.2.2

### Patch Changes

- Updated dependencies [9478570]
  - @kernlize/core@0.29.0

## 0.2.1

### Patch Changes

- Updated dependencies [cbc86fd]
  - @kernlize/core@0.28.0

## 0.2.0

### Minor Changes

- 87dfd5b: Ask queues (#74): `createAskQueue` shows asks one at a time in arrival order, answers each to its own ask, and dismisses a revoked window's asks and withdrawn ones with their refusal, streaming what waits as `waiting$` and `current$`. `createAskQueues` makes one per kind, and `createAskRenderers` turns queues into `KernlHost.asks`; several kinds may share one queue.
- c887af4: Logs (#74): `createGuardLog`, `createTrafficLog`, `createNoticeStore` and `createUnreadCount` keep the newest events, per-window traffic with its marks, notices that go by themselves, and the shell's own unread count, framework-free and in memory only. `@kernlize/guard` and `@kernlize/messaging` are now dependencies, for their types.

### Patch Changes

- Updated dependencies [87dfd5b]
- Updated dependencies [f2996c2]
  - @kernlize/core@0.27.0

## 0.1.0

- First release: the grants list model (`startingChoices`, `grantGroups`, `grantsToApply`), its words and byte counts, moved from the web shell unchanged (D-060).

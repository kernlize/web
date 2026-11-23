---
'@kernlize/core': minor
---

Applets' settings, the `config` domain, are a module, `settingsModule(present)`, in `kernlModules({ presentSettings })`. With no module list, `createKernl` hands it the host's `presentSettings`; a host that names its modules passes the form itself. Without a form, or without the module, `config` is not offered.

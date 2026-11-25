---
'@kernlize/kernel': patch
---

An applet's `outbox.publish` reaches the person's write relays again. Under the firewall kehto plans the publish for the signer's key before signing, and the outbox router was given none, so the plan was empty and every publish came back `publish denied`. The relay pool also answered each relay by its normalized address (`wss://host/`), which kehto looked up by the address it planned (`wss://host`), so a publish the relays took still read as failed. The router now gets the signer's key, and publish results are keyed by the addresses kehto asked for.

# @kernlize/kernel

## 0.1.2

### Patch Changes

- d0e2306: An applet's `outbox.publish` reaches the person's write relays again. Under the firewall kehto plans the publish for the signer's key before signing, and the outbox router was given none, so the plan was empty and every publish came back `publish denied`. The relay pool also answered each relay by its normalized address (`wss://host/`), which kehto looked up by the address it planned (`wss://host`), so a publish the relays took still read as failed. The router now gets the signer's key, and publish results are keyed by the addresses kehto asked for.

## 0.1.1

### Patch Changes

- 7bf6b0b: Replay cached public tree events on approved Outbox subscriptions before opening the live relay read. One-shot Outbox queries merge cached events into the normal relay response. The cache module enables this without changes to applets or the Outbox API.

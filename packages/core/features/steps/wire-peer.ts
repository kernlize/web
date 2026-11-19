import { createHash } from 'node:crypto';
import type { RelayPool } from 'applesauce-relay';
import { PrivateKeySigner } from 'applesauce-signers';
import type { NostrEvent } from '@napplet/core';
import { DIRECT_SIGNAL_KIND, DIRECT_SIGNALING_PROFILE } from '@kernlize/core';

/** What a wire peer needs from the scenario: where to publish, how to name an applet's rooms, and a peer factory. */
export interface WireWorld {
  readonly relayUrl: string;
  readonly namespace: (applet: string) => string;
  readonly createPeer: () => RTCPeerConnection;
  readonly track: (closeable: { close(): void }) => void;
}

/**
 * A peer written from the wire format alone, sharing no code with the shell:
 * it signs and seals its own signals, answers offers, and can send anything
 * over the data channel, which is how a hostile or broken peer is played.
 */
export class WirePeer {
  readonly signer: PrivateKeySigner;
  pubkey = '';
  nonce = crypto.randomUUID();
  wire = '';
  connection?: RTCPeerConnection;
  channel?: RTCDataChannel;
  side?: RTCDataChannel;
  sideClosed = false;
  /** The nonce the other side said hello with, by key. */
  readonly theirs = new Map<string, string>();
  /** Every answer the other side sent, in order. */
  readonly answers: string[] = [];

  constructor(private readonly world: WireWorld, private readonly pool: RelayPool, key: Uint8Array) {
    this.signer = new PrivateKeySigner(key);
  }

  static async make(world: WireWorld, pool: RelayPool, above: string | undefined, below: string | undefined): Promise<WirePeer> {
    for (;;) {
      const candidate = new PrivateKeySigner();
      const pubkey = await candidate.getPublicKey();
      if ((above === undefined || pubkey > above) && (below === undefined || pubkey < below)) {
        const peer = new WirePeer(world, pool, candidate.key);
        peer.pubkey = pubkey;
        return peer;
      }
    }
  }

  wireFor(applet: string, room: string): string {
    const identity = JSON.stringify([DIRECT_SIGNALING_PROFILE, this.world.namespace(applet), ['room', room], 'napplet', '']);
    return createHash('sha256').update(identity).digest('hex');
  }

  async signal(body: Record<string, unknown>, recipient?: string, nonce = this.nonce): Promise<void> {
    const raw = JSON.stringify({ v: DIRECT_SIGNALING_PROFILE, wire: this.wire, nonce, ...body });
    const now = Math.floor(Date.now() / 1000);
    const event = await this.signer.signEvent({
      kind: DIRECT_SIGNAL_KIND, created_at: now,
      content: recipient ? await this.signer.nip44.encrypt(recipient, raw) : raw,
      tags: [['d', this.wire], ['expiration', String(now + 60)], ...(recipient ? [['p', recipient]] : [])],
    });
    await this.pool.publish([this.world.relayUrl], event);
  }

  listen(applet: string, room: string): void {
    this.wire = this.wireFor(applet, room);
    this.pool.subscription([this.world.relayUrl], [{ kinds: [DIRECT_SIGNAL_KIND], '#d': [this.wire] }]).subscribe((event: NostrEvent) => {
      void this.receive(event).catch(() => undefined);
    });
  }

  private async receive(event: NostrEvent): Promise<void> {
    if (event.pubkey === this.pubkey) return;
    const recipient = event.tags.find((tag) => tag[0] === 'p')?.[1];
    if (recipient && recipient !== this.pubkey) return;
    const body = JSON.parse(recipient ? await this.signer.nip44.decrypt(event.pubkey, event.content) : event.content) as { type: string; nonce: string; to?: string; sdp?: string };
    if (body.type === 'hello') this.theirs.set(event.pubkey, body.nonce);
    if (body.type === 'answer' && body.to === this.nonce && this.connection && !this.connection.remoteDescription) {
      this.answers.push(body.sdp as string);
      await this.connection.setRemoteDescription({ type: 'answer', sdp: body.sdp as string });
      return;
    }
    if (body.type === 'answer') this.answers.push(body.sdp as string);
    if (body.type === 'offer' && body.to === this.nonce && this.connection) {
      const connection = this.connection;
      await connection.setRemoteDescription({ type: 'offer', sdp: body.sdp as string });
      await connection.setLocalDescription(await connection.createAnswer());
      await new Promise((resolve) => setTimeout(resolve, 300));
      await this.signal({ type: 'answer', to: body.nonce, sdp: (connection.localDescription as RTCSessionDescription).sdp }, event.pubkey);
    }
  }

  /** Offer `to` a connection over the default channel, sending the same offer `times` times. */
  async offer(to: string, theirNonce: string, times: number): Promise<void> {
    const connection = this.connection as RTCPeerConnection;
    this.channel = connection.createDataChannel('napplet', { ordered: true });
    await connection.setLocalDescription(await connection.createOffer());
    await new Promise((resolve) => setTimeout(resolve, 300));
    const sdp = (connection.localDescription as RTCSessionDescription).sdp;
    for (let sent = 0; sent < times; sent += 1) await this.signal({ type: 'offer', to: theirNonce, sdp }, to);
  }

  /** Say hello with a fresh connection ready to take an offer. */
  async hello(extra: Record<string, unknown> = {}): Promise<void> {
    const connection = this.world.createPeer();
    this.world.track(connection);
    connection.addEventListener('datachannel', (event: RTCDataChannelEvent) => {
      this.channel = event.channel;
    });
    this.connection = connection;
    await this.signal({ type: 'hello', ...extra });
  }
}


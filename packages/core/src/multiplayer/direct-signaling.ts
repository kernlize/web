import { verifyEvent } from 'applesauce-core/helpers';
import type { WebrtcOpenPlan, WebrtcServiceContext, WebrtcServiceOptions } from '@kehto/services';
import type { EventTemplate, NostrEvent, NostrFilter, WebrtcEvent, WebrtcOpenRequest, WebrtcOpenResult } from '@napplet/core';

/**
 * The signaling format, shared with Paja so one applet meets the same rooms in either shell.
 *
 * @example
 * ```ts
 * JSON.parse(signal.content).v === DIRECT_SIGNALING_PROFILE; // a hello carries the format it speaks
 * ```
 */
export const DIRECT_SIGNALING_PROFILE = 'soy-rtc/1';

/**
 * The event kind signals travel in.
 *
 * @example
 * ```ts
 * const filter = { kinds: [DIRECT_SIGNAL_KIND], '#d': [wire] };
 * ```
 */
export const DIRECT_SIGNAL_KIND = 25_050;

/**
 * The largest JSON payload one message may carry, in bytes.
 *
 * @example
 * ```ts
 * new TextEncoder().encode(JSON.stringify(payload)).length <= DIRECT_MAX_PAYLOAD_BYTES; // else the send is refused
 * ```
 */
export const DIRECT_MAX_PAYLOAD_BYTES = 16_384;

const MAX_SESSIONS = 4;
const MAX_PEERS = 8;
const HELLO_EVERY_MS = 2_000;
const JOIN_PATIENCE_MS = 45_000;
const GATHER_PATIENCE_MS = 8_000;
const SIGNAL_LIFETIME_S = 60;
const SIGNALS_PER_SECOND = 32;
const MESSAGES_PER_SECOND = 240;
const BYTES_PER_SECOND = 524_288;
const MAX_SIGNAL_CHARS = 64_000;
const MAX_SDP_CHARS = 32_000;
/** How libwebrtc outside a browser reports a reliability limit that was never set. */
const UNSET_LIMIT = 65_535;
const HEX_KEY = /^[0-9a-f]{64}$/u;
const encoder = new TextEncoder();

/** The window's own signer: a key that belongs to no account. */
export interface SignalSigner {
  getPublicKey(): Promise<string>;
  signEvent(template: EventTemplate): Promise<NostrEvent>;
  readonly nip44: { encrypt(pubkey: string, plaintext: string): Promise<string>; decrypt(pubkey: string, ciphertext: string): Promise<string> };
}

/** Where signals are published and read. */
export interface SignalRelay {
  subscribe(relays: readonly string[], filters: NostrFilter[], onEvent: (event: NostrEvent) => void): { close(): void };
  publish(relays: readonly string[], event: NostrEvent): Promise<void>;
}

/** What one window's direct connections run on. */
export interface DirectSignalingOptions {
  readonly signer: SignalSigner;
  /** The applet's stable address; rooms of different applets never meet. */
  readonly namespace: string;
  readonly relays: readonly string[];
  readonly relay: SignalRelay;
  /** STUN and TURN addresses the host configured, approved with the session. */
  readonly iceEndpoints: readonly string[];
  readonly createPeer: () => RTCPeerConnection;
}

interface Peer {
  readonly key: string;
  readonly nonce: string;
  readonly connection: RTCPeerConnection;
  readonly started: number;
  channel?: RTCDataChannel;
  joined: boolean;
  chain: Promise<void>;
  offer?: string;
  answer?: string;
}

interface Session {
  readonly id: string;
  readonly wire: string;
  readonly nonce: string;
  readonly request: WebrtcOpenRequest;
  readonly channel: string;
  readonly context: WebrtcServiceContext;
  readonly peers: Map<string, Peer>;
  /** Signal ids and old peer incarnations, with when they were met; forgotten once no signal of theirs can still be accepted. */
  readonly retired: Map<string, number>;
  readonly seen: Map<string, number>;
  readonly signals: { since: number; count: number };
  subscription?: { close(): void };
  timer?: ReturnType<typeof setInterval>;
  open: boolean;
}

interface SignalBody {
  readonly v: string;
  readonly wire: string;
  readonly nonce: string;
  readonly type: 'hello' | 'offer' | 'answer';
  readonly to?: string;
  readonly sdp?: string;
  readonly realtime?: unknown;
}

function invalid(message: string): never {
  throw new Error(message);
}

function validate(request: WebrtcOpenRequest): void {
  const { scope } = request;
  if (scope.type === 'room') {
    if (typeof scope.room !== 'string' || !scope.room || scope.room.length > 256) invalid('invalid room');
    if (scope.peers && (scope.peers.length > MAX_PEERS || !scope.peers.every((key) => HEX_KEY.test(key)))) invalid('invalid peers');
  } else if (scope.type !== 'direct' || !HEX_KEY.test(scope.pubkey)) invalid('invalid scope');
  if (request.channel !== undefined && (!request.channel || request.channel.length > 64)) invalid('invalid channel');
  if (request.protocol !== undefined && request.protocol.length > 128) invalid('invalid protocol');
}

/** Only reliable, ordered delivery is offered; a peer that asks for anything else is left out. */
function reliable(body: SignalBody): boolean {
  if (body.realtime === undefined) return true;
  const realtime = body.realtime as { profile?: unknown; ordered?: unknown; maxRetransmits?: unknown } | null;
  return realtime?.profile === 'soy-rtc/realtime-1' && realtime.ordered === true && realtime.maxRetransmits === null;
}

function reliableChannel(channel: RTCDataChannel): boolean {
  return channel.ordered && [channel.maxRetransmits, channel.maxPacketLifeTime].every((limit) => limit === null || limit === UNSET_LIMIT);
}

function gathered(connection: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer);
      connection.removeEventListener('icegatheringstatechange', changed);
      resolve();
    };
    const changed = (): void => {
      if (connection.iceGatheringState === 'complete') finish();
    };
    const timer = setTimeout(finish, GATHER_PATIENCE_MS);
    connection.addEventListener('icegatheringstatechange', changed);
    changed();
  });
}

async function wireOf(namespace: string, self: string, request: WebrtcOpenRequest, channel: string): Promise<string> {
  const { scope } = request;
  const where = scope.type === 'room' ? ['room', scope.room] : ['direct', ...[self, scope.pubkey].sort()];
  const identity = JSON.stringify([DIRECT_SIGNALING_PROFILE, namespace, where, channel, request.protocol ?? '']);
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(identity));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Forget what is older than a signal can be, so the memory a peer can fill stays bounded by the signal rate. */
function forgetStale(memory: Map<string, number>, now: number): void {
  for (const [key, at] of memory) {
    if (now - at <= SIGNAL_LIFETIME_S * 1000) break;
    memory.delete(key);
  }
}

/**
 * kehto's WebRTC hooks for one window, speaking the `soy-rtc/1` signaling
 * format over the shell's pool.
 *
 * Signals are signed by the window's own key and carry the session's room
 * address, never the account. Offers and answers are encrypted to the one
 * peer they are for. Application data goes only through the data channel;
 * delivery is reliable and ordered, and a peer that asks for otherwise is
 * left out. A message is at most 16 KiB of JSON; at most four sessions per
 * window and eight peers per session (D-042).
 *
 * @param options - The window's signer and namespace, the relays, and the peer factory.
 * @returns Options for kehto's `createWebrtcService`.
 * @example
 * ```ts
 * createWebrtcService(createDirectSignaling({ signer, namespace, relays, relay, iceEndpoints: [], createPeer }));
 * ```
 */
export function createDirectSignaling(options: DirectSignalingOptions): WebrtcServiceOptions {
  const signaling = new DirectSignaling(options);
  return {
    planOpen: (request) => signaling.planOpen(request),
    open: (request, context) => signaling.open(request, context),
    send: (id, payload, context) => signaling.send(id, payload, context),
    close: (id, reason, context) => signaling.close(signaling.sessionFor(id, context), reason),
    destroyWindow: () => signaling.closeAll(),
    revokeWindow: () => signaling.closeAll(),
  };
}

/** One window's sessions: who is in each, what they negotiated, and the signals already heard. */
class DirectSignaling {
  private readonly sessions = new Map<string, Session>();
  private readonly self: Promise<string>;

  constructor(private readonly options: DirectSignalingOptions) {
    this.self = options.signer.getPublicKey();
  }

  planOpen(request: WebrtcOpenRequest): WebrtcOpenPlan {
    validate(request);
    if (this.options.relays.length === 0) invalid('signaling unavailable');
    const resource = request.scope.type === 'room' ? `room:${request.scope.room}` : `peer:${request.scope.pubkey}`;
    return { signalingRelayUrls: this.options.relays, iceEndpoints: this.options.iceEndpoints, resource };
  }

  async open(request: WebrtcOpenRequest, context: WebrtcServiceContext): Promise<WebrtcOpenResult> {
    validate(request);
    const me = await this.self;
    if (this.sessions.size >= MAX_SESSIONS) invalid('session limit reached');
    if (request.scope.type === 'direct' && request.scope.pubkey === me) invalid('cannot connect to self');
    const channel = request.channel ?? 'napplet';
    const wire = await wireOf(this.options.namespace, me, request, channel);
    if ([...this.sessions.values()].some((session) => session.wire === wire)) invalid('scope already open');
    const session: Session = {
      id: crypto.randomUUID(), wire, nonce: crypto.randomUUID(), request, channel, context,
      peers: new Map(), retired: new Map(), seen: new Map(), signals: { since: Date.now(), count: 0 }, open: false,
    };
    this.sessions.set(session.id, session);
    context.signal?.addEventListener('abort', () => this.close(session), { once: true });
    this.start(session);
    const { protocol } = request;
    return { session: { id: session.id, scope: request.scope, channel, ...(protocol ? { protocol } : {}), state: 'connecting' } };
  }

  send(id: string, payload: unknown, context: WebrtcServiceContext): void {
    const session = this.sessionFor(id, context);
    const json = JSON.stringify(payload) as string | undefined;
    const size = json === undefined ? Infinity : encoder.encode(json).length;
    if (size > DIRECT_MAX_PAYLOAD_BYTES) invalid('payload is not JSON of at most 16 KiB');
    const channels = [...session.peers.values()].filter((peer) => peer.joined && peer.channel?.readyState === 'open').map((peer) => peer.channel as RTCDataChannel);
    if (channels.length === 0) invalid('peer unavailable');
    // The browser refuses a send its queue cannot take, and that refusal is the applet's answer.
    for (const channel of channels) channel.send(json as string);
  }

  sessionFor(id: string, context: WebrtcServiceContext): Session {
    const session = this.sessions.get(id);
    if (!session || session.context.windowId !== context.windowId || !this.live(session)) throw new Error('session not found');
    return session;
  }

  close(session: Session, reason?: string): void {
    if (!this.sessions.has(session.id)) return;
    this.emit(session, { type: 'closed', sessionId: session.id, ...(reason ? { reason } : {}) });
    this.sessions.delete(session.id);
    clearInterval(session.timer);
    session.subscription?.close();
    for (const peer of session.peers.values()) this.removePeer(session, peer);
  }

  closeAll(): void {
    for (const session of this.sessions.values()) this.close(session);
  }

  private live(session: Session): boolean {
    return this.sessions.get(session.id) === session && !session.context.signal?.aborted;
  }

  private emit(session: Session, event: WebrtcEvent): void {
    if (this.live(session)) session.context.emit(event);
  }

  private activePeer(session: Session, peer: Peer): boolean {
    return this.live(session) && session.peers.get(peer.key) === peer;
  }

  private removePeer(session: Session, peer: Peer): void {
    if (session.peers.get(peer.key) !== peer) return;
    session.peers.delete(peer.key);
    if (peer.joined) this.emit(session, { type: 'peer', sessionId: session.id, pubkey: peer.key, state: 'left' });
    peer.channel?.close();
    peer.connection.close();
  }

  private async publish(session: Session, body: Partial<SignalBody>, recipient?: string): Promise<void> {
    const { signer } = this.options;
    const raw = JSON.stringify({ v: DIRECT_SIGNALING_PROFILE, wire: session.wire, nonce: session.nonce, ...body });
    const now = Math.floor(Date.now() / 1000);
    const event = await signer.signEvent({
      kind: DIRECT_SIGNAL_KIND,
      created_at: now,
      content: recipient ? await signer.nip44.encrypt(recipient, raw) : raw,
      tags: [['d', session.wire], ['expiration', String(now + SIGNAL_LIFETIME_S)], ...(recipient ? [['p', recipient]] : [])],
    });
    try {
      await this.options.relay.publish(this.options.relays, event);
    } catch {
      // No relay took it; the next hello, and the offer that goes with it, are sent again in two seconds.
    }
  }

  private attach(session: Session, peer: Peer, channel: RTCDataChannel): void {
    if (!this.activePeer(session, peer) || peer.channel || channel.label !== session.channel || channel.protocol !== '' || !reliableChannel(channel)) {
      channel.close();
      return;
    }
    peer.channel = channel;
    channel.addEventListener('open', () => {
      peer.joined = true;
      this.emit(session, { type: 'peer', sessionId: session.id, pubkey: peer.key, state: 'joined' });
      if (session.open) return;
      session.open = true;
      this.emit(session, { type: 'state', sessionId: session.id, state: 'open' });
    });
    const budget = { since: Date.now(), messages: 0, bytes: 0 };
    channel.addEventListener('message', (event: MessageEvent) => {
      if (!this.activePeer(session, peer) || typeof event.data !== 'string') return;
      const size = encoder.encode(event.data).length;
      if (Date.now() - budget.since > 1000) Object.assign(budget, { since: Date.now(), messages: 0, bytes: 0 });
      budget.messages += 1;
      budget.bytes += size;
      if (size > DIRECT_MAX_PAYLOAD_BYTES || budget.messages > MESSAGES_PER_SECOND || budget.bytes > BYTES_PER_SECOND) return;
      try {
        this.emit(session, { type: 'message', sessionId: session.id, from: peer.key, payload: JSON.parse(event.data) as unknown });
      } catch {
        // A peer's malformed data never reaches the applet.
      }
    });
    channel.addEventListener('close', () => this.removePeer(session, peer));
  }

  /** Run a peer's negotiation steps one at a time; a step that fails drops the peer. */
  private queue(session: Session, peer: Peer, step: () => Promise<void>): void {
    peer.chain = peer.chain.then(step).catch(() => this.removePeer(session, peer));
  }

  private async meet(session: Session, key: string, nonce: string): Promise<void> {
    const known = session.peers.get(key);
    if (known && known.nonce !== nonce) {
      // The peer reloaded: forget the old one and ignore anything it still sends.
      session.retired.set(`${key}:${known.nonce}`, Date.now());
      this.removePeer(session, known);
    } else if (known) return;
    if (session.peers.size >= MAX_PEERS) return;
    const peer: Peer = { key, nonce, connection: this.options.createPeer(), started: Date.now(), joined: false, chain: Promise.resolve() };
    session.peers.set(key, peer);
    peer.connection.addEventListener('datachannel', (event: RTCDataChannelEvent) => this.attach(session, peer, event.channel));
    peer.connection.addEventListener('connectionstatechange', () => {
      if (peer.connection.connectionState === 'failed' || peer.connection.connectionState === 'closed') this.removePeer(session, peer);
    });
    void this.publish(session, { type: 'hello' });
    if ((await this.self) < key) this.queue(session, peer, () => this.offer(session, peer));
  }

  private async offer(session: Session, peer: Peer): Promise<void> {
    this.attach(session, peer, peer.connection.createDataChannel(session.channel, { ordered: true }));
    await peer.connection.setLocalDescription(await peer.connection.createOffer());
    await gathered(peer.connection);
    peer.offer = (peer.connection.localDescription as RTCSessionDescription).sdp;
    await this.publish(session, { type: 'offer', to: peer.nonce, sdp: peer.offer }, peer.key);
  }

  private async answer(session: Session, peer: Peer, sdp: string): Promise<void> {
    if (!peer.answer) {
      await peer.connection.setRemoteDescription({ type: 'offer', sdp });
      await peer.connection.setLocalDescription(await peer.connection.createAnswer());
      await gathered(peer.connection);
      peer.answer = (peer.connection.localDescription as RTCSessionDescription).sdp;
    }
    await this.publish(session, { type: 'answer', to: peer.nonce, sdp: peer.answer }, peer.key);
  }

  private async negotiate(session: Session, peer: Peer, body: SignalBody): Promise<void> {
    const me = await this.self;
    const sdp = body.sdp as string;
    if (body.type === 'offer' && peer.key < me) this.queue(session, peer, () => this.answer(session, peer, sdp));
    else if (body.type === 'answer' && me < peer.key && !peer.connection.remoteDescription) {
      this.queue(session, peer, () => peer.connection.setRemoteDescription({ type: 'answer', sdp }));
    }
  }

  private admitted(session: Session, event: NostrEvent, me: string): boolean {
    const now = Date.now();
    forgetStale(session.seen, now);
    forgetStale(session.retired, now);
    if (now - session.signals.since > 1000) Object.assign(session.signals, { since: now, count: 0 });
    session.signals.count += 1;
    const { scope } = session.request;
    const fromAllowed = scope.type === 'direct' ? event.pubkey === scope.pubkey : !scope.peers || scope.peers.includes(event.pubkey);
    return session.signals.count <= SIGNALS_PER_SECOND
      && event.kind === DIRECT_SIGNAL_KIND
      && event.pubkey !== me
      && event.content.length <= MAX_SIGNAL_CHARS
      && Math.abs(now / 1000 - event.created_at) <= SIGNAL_LIFETIME_S
      && !session.seen.has(event.id)
      && event.tags.some((tag) => tag[0] === 'd' && tag[1] === session.wire)
      && fromAllowed
      && verifyEvent(event);
  }

  private async receive(session: Session, event: NostrEvent): Promise<void> {
    const me = await this.self;
    if (!this.live(session) || !this.admitted(session, event, me)) return;
    const recipient = event.tags.find((tag) => tag[0] === 'p')?.[1];
    if (recipient !== undefined && recipient !== me) return;
    session.seen.set(event.id, Date.now());
    const body = JSON.parse(recipient ? await this.options.signer.nip44.decrypt(event.pubkey, event.content) : event.content) as SignalBody;
    const shaped = body.v === DIRECT_SIGNALING_PROFILE && body.wire === session.wire && typeof body.nonce === 'string' && body.nonce.length > 0 && body.nonce.length <= 64;
    if (!shaped || session.retired.has(`${event.pubkey}:${body.nonce}`) || !reliable(body)) return;
    if (!recipient) {
      if (body.type === 'hello') await this.meet(session, event.pubkey, body.nonce);
      return;
    }
    const peer = session.peers.get(event.pubkey);
    if (!peer || peer.nonce !== body.nonce || body.to !== session.nonce || typeof body.sdp !== 'string' || body.sdp.length > MAX_SDP_CHARS) return;
    await this.negotiate(session, peer, body);
  }

  private start(session: Session): void {
    const filter = { kinds: [DIRECT_SIGNAL_KIND], '#d': [session.wire], since: Math.floor(Date.now() / 1000) - 10 } as NostrFilter;
    session.subscription = this.options.relay.subscribe(this.options.relays, [filter], (event) => {
      void this.receive(session, event).catch(() => undefined);
    });
    const tick = (): void => {
      void this.publish(session, { type: 'hello' });
      for (const peer of session.peers.values()) {
        if (!peer.joined && Date.now() - peer.started > JOIN_PATIENCE_MS) this.removePeer(session, peer);
        else if (peer.offer && !peer.connection.remoteDescription) void this.publish(session, { type: 'offer', to: peer.nonce, sdp: peer.offer }, peer.key);
      }
    };
    tick();
    session.timer = setInterval(tick, HELLO_EVERY_MS);
  }
}

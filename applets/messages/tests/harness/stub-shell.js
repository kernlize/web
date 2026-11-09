/*
  STUB SHELL. Not a runtime, not kehto, not kernl.

  A hand-written `window.napplet` with just enough behaviour to drive the built
  applet for layout screenshots and a smoke check: seeded conversations, paged
  history, a send that can succeed, be refused or stay unanswered, a scripted
  reply, and a request guard modelled on a strict shell's (a token bucket that
  silently drops what goes over budget). It proves nothing about any real shell. frames.mjs injects it
  ahead of dist/index.html inside a sandbox="allow-scripts" iframe; it is never
  part of the artifact.
*/
(() => {
  const config = window.__HARNESS__ ?? {};
  const OWNER = 'a1'.repeat(32);
  const ADA = 'b2'.repeat(32);
  const GRACE = 'c3'.repeat(32);
  const UNNAMED = '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d';
  const STRANGER = '7e7e9c42a91bfef19fa929e5fda1b72e0ebc1a4c1141673e2794234d86addf4e';
  const PAGE_SIZE = 4;
  const BUDGET = config.budget ?? 8;
  const THEMES = {
    dark: { background: '#101114', text: '#e9eaee', primary: '#8fb4ff' },
    light: { background: '#fbfbfa', text: '#1b1d22', primary: '#2854c5' },
  };

  const startedAt = Date.now();
  const minutesAgo = (minutes) => Math.floor((startedAt - minutes * 60_000) / 1000);
  const DAY = 24 * 60;
  let sequence = 0;
  const nextId = (prefix) => `${prefix}-${(sequence += 1)}`;

  const conversations = [];
  const history = new Map();
  const listeners = new Set();
  const themeListeners = new Set();
  const stored = new Map();
  const actions = new Map();
  window.__stub = { notices: [], sends: [], actions, calls: [], dropped: [] };

  // The guard: BUDGET requests a second, refilled continuously, the excess
  // dropped without a reply (or refused, with config.guard === 'refuse').
  const bucket = { tokens: BUDGET, at: performance.now() };
  function admit(name) {
    const now = performance.now();
    bucket.tokens = Math.min(BUDGET, bucket.tokens + ((now - bucket.at) / 1000) * BUDGET);
    bucket.at = now;
    window.__stub.calls.push({ name, at: now });
    if (bucket.tokens < 1) {
      window.__stub.dropped.push(name);
      return false;
    }
    bucket.tokens -= 1;
    return true;
  }
  function guarded(domain, methods) {
    const wrapped = { ...methods };
    for (const name of Object.keys(methods)) {
      if (name.startsWith('on')) continue;
      wrapped[name] = (...args) => {
        if (admit(`${domain}.${name}`)) return methods[name](...args);
        // Some bindings answer a refused dm request by resolving with an error record.
        if (config.guard === 'refuse-record' && domain === 'dm') return Promise.resolve({ error: 'firewall:rate-limited' });
        return config.guard === 'drop' || !config.guard ? new Promise(() => {}) : Promise.reject(new Error('firewall:rate-limited'));
      };
    }
    return wrapped;
  }

  function seed(id, kind, participants, lines, subject) {
    const messages = lines.map(([from, minutes, content]) => ({
      id: nextId('seed'),
      conversationId: id,
      senderPubkey: from,
      createdAt: minutesAgo(minutes),
      content,
      status: from === OWNER ? 'sent' : 'received',
    }));
    history.set(id, messages);
    conversations.push({
      id,
      kind,
      participants,
      ...(subject ? { subject } : {}),
      unread: 40 + conversations.length,
      updatedAt: messages.at(-1).createdAt,
    });
  }

  function seedAll() {
    const me = { pubkey: OWNER, label: 'Me' };
    const ada = { pubkey: ADA, label: 'Ada Lovelace' };
    seed('legacy:71ab-old-route', 'direct', [me, ada], [
      [ADA, 3 * DAY + 40, 'Did you get the notes from Tuesday?'],
      [OWNER, 3 * DAY + 31, 'Yes, reading them tonight.'],
      [ADA, DAY + 125, 'No rush. The second half is the interesting part.'],
      [OWNER, DAY + 120, 'Agreed. The table on page four could use a second look though, the totals do not add up the way the summary says they do.'],
      [ADA, DAY + 100, 'I will check the totals.'],
    ]);
    seed('private:9f2c-new-route', 'direct', [me, ada], [
      [ADA, 190, 'Switched over. Does this reach you?'],
      [OWNER, 185, 'It does.'],
      [ADA, 62, 'Good. Dinner on Thursday?'],
      [ADA, 61, 'Around six.'],
    ]);
    seed('private:group-hike', 'group', [me, { pubkey: GRACE, label: 'Grace Hopper' }, { pubkey: UNNAMED }, ada], [
      [GRACE, DAY + 300, 'Trail report says the north side is still icy.'],
      [OWNER, DAY + 280, 'South loop then.'],
      [UNNAMED, 48, 'I can drive. Leaving at eight.'],
      [GRACE, 35, 'Bringing the stove and far too much coffee.'],
    ], 'Weekend hike');
    seed('legacy:unnamed-thread', 'direct', [me, { pubkey: UNNAMED }], [
      [UNNAMED, 2 * DAY + 15, 'Sent you the address.'],
    ]);
    // Everything older than 90 minutes was seen in an earlier session.
    const seen = { baseline: startedAt - 90 * 60_000, threads: {} };
    stored.set(`state:${OWNER}`, JSON.stringify({ seen, drafts: {} }));
  }

  function deliver(message) {
    const messages = history.get(message.conversationId) ?? [];
    history.set(message.conversationId, [...messages, message]);
    const conversation = conversations.find((item) => item.id === message.conversationId);
    if (conversation) conversation.updatedAt = message.createdAt;
    else {
      // A conversation the applet has never been told about: it has to ask.
      const participants = [{ pubkey: OWNER }, { pubkey: message.senderPubkey }];
      conversations.push({ id: message.conversationId, kind: 'direct', participants, unread: 0, updatedAt: message.createdAt });
    }
    for (const listener of listeners) listener(message, 'live-1');
  }

  function incoming(conversationId, from, content) {
    deliver({
      id: nextId('live'),
      conversationId,
      senderPubkey: from,
      createdAt: Math.floor(Date.now() / 1000),
      content,
      status: 'received',
    });
  }

  function conversationFor(request) {
    if (request.conversationId) return request.conversationId;
    const peer = request.recipients[0];
    const known = conversations.find(
      (item) => item.kind === 'direct' && item.id.startsWith('private:') && item.participants.some((p) => p.pubkey === peer),
    );
    if (known) return known.id;
    const id = `private:${nextId('new')}`;
    conversations.push({ id, kind: 'direct', participants: [{ pubkey: OWNER }, { pubkey: peer }], unread: 0 });
    return id;
  }

  function sentMessage(request) {
    return {
      id: nextId('sent'),
      conversationId: conversationFor(request),
      senderPubkey: OWNER,
      createdAt: Math.floor(Date.now() / 1000),
      content: request.content,
      status: 'sent',
    };
  }

  function settleSend(request, resolve, reject) {
    if (request.content.includes('[[refuse]]')) return reject(new Error('denied:user'));
    // The person declined in the shell, reported as a resolved error record.
    if (request.content.includes('[[cancel]]')) return resolve({ error: 'denied:cancelled' });
    if (request.content.includes('[[provider]]')) return reject(new Error('unavailable:no-default-provider'));
    if (request.content.includes('[[late]]')) {
      // What a real binding does when the shell takes longer than its request
      // timeout: the call rejects, and the message is still sent afterwards.
      setTimeout(() => deliver(sentMessage(request)), 900);
      return reject(new Error('dm.send timed out'));
    }
    const message = sentMessage(request);
    deliver(message);
    resolve({ ok: true, message });
    const peer = request.recipients[0];
    if (peer) setTimeout(() => incoming(message.conversationId, peer, 'Sounds good. See you then.'), 500);
    return undefined;
  }

  const dm = {
    async status() {
      if (config.scenario === 'unavailable' || config.scenario === 'signed-out') {
        return { available: false, implementations: [], capabilities: [] };
      }
      return { available: true, ownerPubkey: OWNER, implementations: ['stub'], capabilities: ['direct', 'group'] };
    },
    async conversations() {
      return { conversations: conversations.map((item) => ({ ...item })) };
    },
    async messages(query) {
      const all = history.get(query.conversationId) ?? [];
      const offset = Number(query.cursor ?? 0);
      const next = offset + PAGE_SIZE;
      const page = { messages: all.slice(offset, next) };
      return next < all.length ? { ...page, cursor: String(next) } : page;
    },
    send(request) {
      window.__stub.sends.push(request);
      return new Promise((resolve, reject) => {
        // "[[hold]]" models a shell that is still asking the person a question.
        if (!request.content.includes('[[hold]]')) setTimeout(() => settleSend(request, resolve, reject), 250);
      });
    },
    async subscribe() {
      if (config.scenario === 'seeded') {
        setTimeout(() => incoming('private:unnamed-new-route', UNNAMED, 'Are you around this week?'), 400);
      }
      return { subscriptionId: 'live-1' };
    },
    async unsubscribe() {
      return { ok: true };
    },
    onMessage(handler) {
      listeners.add(handler);
      return { close: () => listeners.delete(handler) };
    },
  };

  const identity = {
    async getPublicKey() {
      return config.scenario === 'signed-out' ? '' : OWNER;
    },
    onChanged() {
      return { close() {} };
    },
  };

  const storage = {
    async getItem(key) {
      return stored.get(key) ?? null;
    },
    async setItem(key, value) {
      stored.set(key, value);
    },
    async removeItem(key) {
      stored.delete(key);
    },
    async keys() {
      return [...stored.keys()];
    },
  };

  const notify = {
    async send(notice) {
      window.__stub.notices.push(notice);
      return { notificationId: nextId('notice') };
    },
  };

  const keys = {
    async registerAction(action) {
      actions.set(action.id, { ...action, run: null });
      return { actionId: action.id, binding: action.defaultKey };
    },
    unregisterAction(actionId) {
      actions.delete(actionId);
    },
    onAction(actionId, callback) {
      const action = actions.get(actionId);
      if (action) action.run = callback;
      return { close() {} };
    },
  };

  let themeName = config.theme;
  const theme = {
    async get() {
      return { colors: THEMES[themeName] };
    },
    onChanged(handler) {
      themeListeners.add(handler);
      return { close: () => themeListeners.delete(handler) };
    },
  };
  window.__stub.setTheme = (name) => {
    themeName = name;
    for (const listener of themeListeners) listener({ colors: THEMES[name] });
  };
  window.__stub.runAction = (id) => actions.get(id)?.run?.();

  if (config.scenario === 'seeded') seedAll();
  window.__stub.stranger = STRANGER;

  const napplet = {
    dm: guarded('dm', dm),
    identity: guarded('identity', identity),
    storage: guarded('storage', storage),
    notify: guarded('notify', notify),
    keys: guarded('keys', keys),
  };
  if (config.omit) for (const domain of config.omit) delete napplet[domain];
  if (THEMES[config.theme]) napplet.theme = guarded('theme', theme);
  window.napplet = napplet;
})();

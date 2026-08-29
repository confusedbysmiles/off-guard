/**
 * Live updates.
 *
 * Server-Sent Events rather than WebSockets: the traffic is one-directional --
 * the GM changes something, the shared screen and the players' sheets find out
 * -- and SSE reconnects on its own, which matters more than anything else for a
 * screen cast to a TV that nobody is going to walk over and refresh.
 *
 * Every event carries the whole current view rather than a delta. The table
 * view is a few hundred bytes and a missed event then costs nothing, which
 * removes the entire class of bug where a client's state drifts from the
 * server's after a dropped connection.
 *
 * Channels are `campaign:<id>` and `character:<id>`, which are the two scopes a
 * token can hold. A subscriber is only ever attached to the channel its own
 * token resolved to, so this cannot leak across campaigns.
 */
export function createEventBus({ heartbeatMs = 25_000 } = {}) {
  const channels = new Map();
  let nextId = 1;
  let heartbeat = null;

  function ensure(channel) {
    if (!channels.has(channel)) channels.set(channel, new Set());
    return channels.get(channel);
  }

  function startHeartbeat() {
    if (heartbeat || heartbeatMs <= 0) return;
    // A comment line keeps proxies and phone radios from deciding the
    // connection is idle and closing it.
    heartbeat = setInterval(() => {
      for (const subscribers of channels.values()) {
        for (const subscriber of subscribers) subscriber.ping();
      }
    }, heartbeatMs);
    heartbeat.unref?.();
  }

  function stopHeartbeatIfIdle() {
    if (!heartbeat) return;
    for (const subscribers of channels.values()) if (subscribers.size) return;
    clearInterval(heartbeat);
    heartbeat = null;
  }

  return {
    /**
     * @param {string} channel
     * @param {{send: (event: object) => void, ping: () => void}} subscriber
     * @returns {() => void} unsubscribe
     */
    subscribe(channel, subscriber) {
      const subscribers = ensure(channel);
      subscribers.add(subscriber);
      startHeartbeat();
      return () => {
        subscribers.delete(subscriber);
        if (!subscribers.size) channels.delete(channel);
        stopHeartbeatIfIdle();
      };
    },

    publish(channel, type, data) {
      const subscribers = channels.get(channel);
      if (!subscribers?.size) return 0;
      const event = { id: nextId, type, data };
      nextId += 1;
      for (const subscriber of subscribers) {
        try {
          subscriber.send(event);
        } catch {
          // A dead connection is not the publisher's problem; the stream's own
          // close handler removes it.
        }
      }
      return subscribers.size;
    },

    counts() {
      return Object.fromEntries([...channels].map(([name, set]) => [name, set.size]));
    },

    close() {
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
      channels.clear();
    },
  };
}

export const campaignChannel = (campaignId) => `campaign:${Number(campaignId)}`;
export const characterChannel = (characterId) => `character:${Number(characterId)}`;

/**
 * Attach a Fastify reply to a channel and stream to it.
 *
 * Writes to `reply.raw` rather than using `reply.send`, because the response
 * must stay open. That is the cost of Fastify over Express for this one job,
 * and it is contained here.
 */
export function streamTo(reply, request, { bus, channel, snapshot }) {
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    // nginx buffers proxied responses by default, which would hold events until
    // the buffer filled. The deploy config sets this too; belt and braces.
    'x-accel-buffering': 'no',
  });

  const write = (chunk) => {
    if (!reply.raw.writableEnded) reply.raw.write(chunk);
  };

  const subscriber = {
    send(event) {
      write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
    },
    ping() {
      write(': keep-alive\n\n');
    },
  };

  // Tell the client how long to wait before reconnecting, then send the current
  // state immediately so a fresh connection is never blank.
  write('retry: 3000\n\n');
  subscriber.send({ id: 0, type: 'snapshot', data: snapshot() });

  const unsubscribe = bus.subscribe(channel, subscriber);
  const close = () => { unsubscribe(); if (!reply.raw.writableEnded) reply.raw.end(); };

  request.raw.on('close', close);
  request.raw.on('error', close);

  return close;
}

const http = require('http');
const WebSocket = require('ws');
const url = require('url');
const { v4: uuidv4 } = require('uuid');
const { token } = require("./config.json")
const PORT = process.env.PORT || 8080;
const AUTH_TOKEN = token;
const pendingStreams = new Map();
const wsClients = new Map();

let hostSocket = null;
let authenticated = false;

const server = http.createServer((req, res) => {
  if (!authenticated || !hostSocket || hostSocket.readyState !== WebSocket.OPEN) {
    res.writeHead(503);
    res.end("Tunnel client not connected or not authenticated");
    return;
  }

  const id = uuidv4();
  pendingStreams.set(id, { res });

  hostSocket.send(JSON.stringify({
    type: "request",
    id,
    method: req.method,
    url: req.url,
    headers: req.headers
  }));

  req.on('data', chunk => {
    const idBuf = Buffer.from(id, 'utf-8');
    const header = Buffer.alloc(12);
    header.write("CHNK", 0);
    header.writeUInt32BE(idBuf.length, 4);
    header.writeUInt32BE(chunk.length, 8);
    hostSocket.send(Buffer.concat([header, idBuf, chunk]));
  });

  req.on('end', () => {
    hostSocket.send(JSON.stringify({ type: "end", id }));
  });
});

const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws, request) => {
  if (request.url === '/c97ad31f9fc13ff4e6bd022e74dd561ce93cf67e624dc061d461c1226e70') {
    if (authenticated && hostSocket && hostSocket.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "error",
        message: "A tunnel is already connected"
      }));
      ws.close(4002, "Tunnel already connected");
      return;
    }
    console.log("🌐 Tunnel client connected");
    authenticated = false;
    hostSocket = ws;

    const streamStates = {};
    let buffer = Buffer.alloc(0);

    ws.on('message', (data, isBinary) => {
      try {
        if (!authenticated) {
          const authMsg = JSON.parse(data.toString());
          if (authMsg.type === 'auth' && authMsg.token === AUTH_TOKEN) {
            authenticated = true;
            console.log("✅ Authenticated tunnel client");
            return;
          }
          ws.close(4001, "Unauthorized");
          return;
        }

        if (!isBinary) {
          const msg = JSON.parse(data.toString());

          // Handle HTTP response
          if (msg.type === 'response') {
            const stream = pendingStreams.get(msg.id);
            if (stream) {
              stream.res.writeHead(msg.status || 200, msg.headers || {});
              streamStates[msg.id] = stream;
            }

          } else if (msg.type === 'end') {
            const stream = streamStates[msg.id];
            if (stream) {
              stream.res.end();
              pendingStreams.delete(msg.id);
              delete streamStates[msg.id];
            }
          }

          // Handle WebSocket proxying
          else if (msg.type === 'ws-frame') {
            const client = wsClients.get(msg.id);
            if (client && client.readyState === WebSocket.OPEN) {
              const buf = Buffer.from(msg.data, 'base64');
              client.send(msg.isBinary ? buf : buf.toString());
            }
          } else if (msg.type === 'ws-close') {
            const client = wsClients.get(msg.id);
            if (client) client.close();
          }

        } else {
          buffer = Buffer.concat([buffer, data]);

          while (buffer.length >= 12) {
            if (buffer.toString('utf-8', 0, 4) !== "CHNK") break;

            const idLen = buffer.readUInt32BE(4);
            const payloadLen = buffer.readUInt32BE(8);

            if (buffer.length < 12 + idLen + payloadLen) break;

            const id = buffer.toString('utf-8', 12, 12 + idLen);
            const payload = buffer.slice(12 + idLen, 12 + idLen + payloadLen);

            const stream = streamStates[id];
            if (stream) {
              stream.res.write(payload);
            }

            buffer = buffer.slice(12 + idLen + payloadLen);
          }
        }
      } catch (e) {
        console.error("❌ Error handling message:", e);
      }
    });

    ws.on('close', () => {
      console.log("❌ Tunnel client disconnected");

      // Cleanup streamStates
      for (const id in streamStates) {
        const stream = streamStates[id];
        if (stream && stream.res) {
          try {
            stream.res.end();
          } catch (e) {
            console.warn(`⚠️ Failed to end response for stream ${id}:`, e);
          }
        }
        pendingStreams.delete(id);
        delete streamStates[id];
      }

      // close any open proxy WebSockets
      for (const [id, clientWs] of wsClients.entries()) {
        try {
          clientWs.close();
        } catch (e) {
          console.warn(`⚠️ Failed to close ws client ${id}:`, e);
        }
      }
      wsClients.clear();

     hostSocket = null;
      authenticated = false;
    });

  }
});

// Handle 3rd-party WebSocket upgrades
server.on('upgrade', (req, socket, head) => {
  const pathname = url.parse(req.url).pathname;

  if (pathname === '/c97ad31f9fc13ff4e6bd022e74dd561ce93cf67e624dc061d461c1226e70') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.upgradeReq = req;
      wss.emit('connection', ws, req);
    });
    return;
  }

  const id = uuidv4();

  wss.handleUpgrade(req, socket, head, (ws) => {
    if (!hostSocket || !authenticated) {
      socket.destroy();
      return;
    }

    wsClients.set(id, ws);

    hostSocket.send(JSON.stringify({
      type: 'ws-init',
      id,
      url: req.url,
      headers: req.headers
    }));

    ws.on('message', msg => {
      if (hostSocket && authenticated) {
        hostSocket.send(JSON.stringify({
          type: 'ws-frame',
          id,
          data: Buffer.isBuffer(msg) ? msg.toString('base64') : Buffer.from(msg).toString('base64')
        }));
      }
    });

    ws.on('close', () => {
      if (hostSocket && authenticated) {
        hostSocket.send(JSON.stringify({ type: 'ws-close', id }));
      }
      wsClients.delete(id);
    });
  });
});

server.listen(PORT, () => {
  console.log("🚀 Tunnel server running");
});

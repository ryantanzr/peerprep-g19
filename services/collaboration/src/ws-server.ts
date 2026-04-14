import { createServer } from "node:http";
import { parse } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { verifyToken } from "./firebase.js";
import {
  createSession,
  addUser,
  removeUser,
  endSession,
  changeLanguage,
  getUserCount,
  type SessionState,
} from "./session.js";
import type { ClientMessage, ServerMessage } from "./types.js";

const PORT = parseInt(process.env.PORT || "1999", 10);
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;

// ── Yjs protocol constants ──────────────────────────────────────────────────
const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

// ── Yjs room management ─────────────────────────────────────────────────────
interface Room {
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  /** ws → set of awareness client IDs this connection controls */
  conns: Map<WebSocket, Set<number>>;
}

const rooms = new Map<string, Room>();

function getOrCreateRoom(name: string): Room {
  let room = rooms.get(name);
  if (room) return room;

  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);
  room = { doc, awareness, conns: new Map() };
  const r = room; // stable ref for closures

  // Broadcast doc updates to every connected client except the origin
  doc.on("update", (update: Uint8Array, origin: unknown) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const msg = encoding.toUint8Array(encoder);
    for (const [conn] of r.conns) {
      if (conn !== origin && conn.readyState === WebSocket.OPEN) {
        conn.send(msg);
      }
    }
  });

  // Broadcast awareness changes and track which client IDs each conn owns
  awareness.on(
    "update",
    (
      { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ) => {
      const changed = added.concat(updated, removed);
      if (changed.length === 0) return;

      // Track controlled client IDs per connection
      if (origin !== null && r.conns.has(origin as WebSocket)) {
        const controlled = r.conns.get(origin as WebSocket)!;
        added.forEach((id) => controlled.add(id));
        removed.forEach((id) => controlled.delete(id));
      }

      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_AWARENESS);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(awareness, changed),
      );
      const msg = encoding.toUint8Array(encoder);
      for (const [conn] of r.conns) {
        if (conn.readyState === WebSocket.OPEN) {
          conn.send(msg);
        }
      }
    },
  );

  rooms.set(name, room);
  return room;
}

function handleYjsMessage(ws: WebSocket, room: Room, data: Uint8Array) {
  try {
    const decoder = decoding.createDecoder(data);
    const msgType = decoding.readVarUint(decoder);

    switch (msgType) {
      case MSG_SYNC: {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MSG_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, room.doc, ws);
        if (encoding.length(encoder) > 1) {
          ws.send(encoding.toUint8Array(encoder));
        }
        break;
      }
      case MSG_AWARENESS: {
        awarenessProtocol.applyAwarenessUpdate(
          room.awareness,
          decoding.readVarUint8Array(decoder),
          ws,
        );
        break;
      }
    }
  } catch (err) {
    console.error("Yjs message error:", err);
  }
}

/** Send SyncStep1 + current awareness to a newly connected client */
function sendInitialSync(ws: WebSocket, room: Room) {
  // SyncStep1 — server sends its state vector so the client can diff
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MSG_SYNC);
  syncProtocol.writeSyncStep1(encoder, room.doc);
  ws.send(encoding.toUint8Array(encoder));

  // Current awareness states so the new client sees existing cursors
  const states = room.awareness.getStates();
  if (states.size > 0) {
    const enc2 = encoding.createEncoder();
    encoding.writeVarUint(enc2, MSG_AWARENESS);
    encoding.writeVarUint8Array(
      enc2,
      awarenessProtocol.encodeAwarenessUpdate(room.awareness, Array.from(states.keys())),
    );
    ws.send(encoding.toUint8Array(enc2));
  }
}

function destroyRoom(name: string) {
  const room = rooms.get(name);
  if (!room) return;
  room.awareness.destroy();
  room.doc.destroy();
  rooms.delete(name);
}

// ── Custom session management (join / leave / language / end) ────────────────
const sessions = new Map<string, SessionState>();

interface ConnMeta {
  connId: string;
  roomId: string;
  uid: string;
}

const connMeta = new Map<WebSocket, ConnMeta>();

function getOrCreateSession(roomId: string): SessionState {
  let s = sessions.get(roomId);
  if (!s) {
    s = createSession();
    sessions.set(roomId, s);
  }
  return s;
}

function sendJSON(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function broadcastJSON(roomId: string, msg: ServerMessage) {
  const data = JSON.stringify(msg);
  for (const [ws, meta] of connMeta) {
    if (meta.roomId === roomId && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

function handleCustomMessage(ws: WebSocket, roomId: string, msg: ClientMessage) {
  const meta = connMeta.get(ws);
  if (!meta) return;
  const session = getOrCreateSession(roomId);

  switch (msg.type) {
    case "join": {
      if (!msg.userId || !msg.username) {
        sendJSON(ws, { type: "error", code: "JOIN_FAILED", message: "userId and username required" });
        ws.close(4001, "Missing userId or username");
        return;
      }
      const result = addUser(session, meta.connId, msg.userId, msg.username);
      if (!result.ok) {
        sendJSON(ws, { type: "error", code: "JOIN_FAILED", message: result.error });
        ws.close(4001, result.error);
        return;
      }
      if (result.replacedConnId) {
        for (const [conn, cMeta] of connMeta) {
          if (cMeta.connId === result.replacedConnId) {
            conn.close(1000, "Replaced by new connection");
            break;
          }
        }
      }
      broadcastJSON(roomId, {
        type: "user-joined",
        userId: msg.userId,
        username: msg.username,
        userCount: getUserCount(session),
      });
      if (session.language !== "python3") {
        sendJSON(ws, { type: "language-changed", language: session.language, changedBy: "system" });
      }
      break;
    }

    case "end-session": {
      const user = session.users.get(meta.connId);
      if (!user) return;
      endSession(session);
      broadcastJSON(roomId, { type: "session-ended", endedBy: user.username || "unknown" });
      setTimeout(() => {
        for (const [conn, cMeta] of connMeta) {
          if (cMeta.roomId === roomId) conn.close(1000, "Session ended");
        }
      }, 500);
      break;
    }

    case "language-change": {
      const langUser = session.users.get(meta.connId);
      if (!langUser) return;
      if (changeLanguage(session, msg.language)) {
        broadcastJSON(roomId, {
          type: "language-changed",
          language: msg.language,
          changedBy: langUser.username,
        });
      }
      break;
    }
  }
}

// ── HTTP + WebSocket server ──────────────────────────────────────────────────
const httpServer = createServer((_req, res) => {
  if (_req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (req, socket, head) => {
  const url = parse(req.url || "", true);
  const token = url.query.token as string | undefined;
  console.log(`WS upgrade: ${url.pathname} token=${token ? "present" : "missing"}`);

  if (!token) {
    console.log("WS rejected: no token");
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }

  verifyToken(token, FIREBASE_PROJECT_ID)
    .then((user) => {
      if (!user) {
        console.log("WS rejected: token verification failed");
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      console.log(`WS accepted: uid=${user.uid}`);
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req, user);
      });
    })
    .catch((err) => {
      console.error("WS rejected: verifyToken threw", err);
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
    });
});

wss.on("connection", (ws: WebSocket, req: import("http").IncomingMessage, user: { uid: string }) => {
  const url = parse(req.url || "", true);
  const pathname = url.pathname || "/";
  const roomId = pathname.split("/").filter(Boolean).pop() || "default";
  const connId = Math.random().toString(36).slice(2) + Date.now().toString(36);

  // Store metadata
  connMeta.set(ws, { connId, roomId, uid: user.uid });

  // Set up Yjs room + sync
  const room = getOrCreateRoom(roomId);
  room.conns.set(ws, new Set());
  sendInitialSync(ws, room);

  ws.on("message", (data: Buffer, isBinary: boolean) => {
    if (isBinary) {
      handleYjsMessage(ws, room, new Uint8Array(data));
    } else {
      try {
        const msg: ClientMessage = JSON.parse(data.toString());
        handleCustomMessage(ws, roomId, msg);
      } catch {
        // Not valid JSON — ignore
      }
    }
  });

  ws.on("close", () => {
    // Clean up Yjs awareness
    const tracked = room.conns.get(ws);
    room.conns.delete(ws);
    if (tracked && tracked.size > 0) {
      awarenessProtocol.removeAwarenessStates(room.awareness, Array.from(tracked), null);
    }
    if (room.conns.size === 0) destroyRoom(roomId);

    // Clean up session
    const meta = connMeta.get(ws);
    if (meta) {
      const session = sessions.get(meta.roomId);
      if (session) {
        const removed = removeUser(session, meta.connId);
        if (removed) {
          broadcastJSON(meta.roomId, {
            type: "user-disconnected",
            userId: removed.userId,
            username: removed.username,
          });
        }
      }
      connMeta.delete(ws);
    }
  });

  ws.on("error", console.error);
});

httpServer.listen(PORT, () => {
  console.log(`Collaboration server running on port ${PORT}`);
});

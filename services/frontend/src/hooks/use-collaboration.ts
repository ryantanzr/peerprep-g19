"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import type { Awareness } from "y-protocols/awareness";
import { getToken } from "@/lib/auth";
import type { SupportedLanguage, ServerMessage } from "@/types/collaboration";

interface UseCollaborationOptions {
  sessionId: string;
  userId: string;
  username: string;
}

interface CollaborationState {
  ytext: Y.Text | null;
  awareness: Awareness | null;
  undoManager: Y.UndoManager | null;
  connected: boolean;
  userCount: number;
  language: SupportedLanguage;
  sessionEnded: boolean;
  endedBy: string | null;
  partnerDisconnected: boolean;
}

export function useCollaboration({ sessionId, userId, username }: UseCollaborationOptions) {
  const [state, setState] = useState<CollaborationState>({
    ytext: null,
    awareness: null,
    undoManager: null,
    connected: false,
    userCount: 0,
    language: "python3",
    sessionEnded: false,
    endedBy: null,
    partnerDisconnected: false,
  });

  const providerRef = useRef<WebsocketProvider | null>(null);
  const docRef = useRef<Y.Doc | null>(null);

  useEffect(() => {
    const doc = new Y.Doc();
    docRef.current = doc;

    const host = process.env.NEXT_PUBLIC_PARTYKIT_HOST || "localhost:1999";
    const token = getToken();
    if (!token) {
      console.error("No auth token available — cannot connect to collaboration server");
      return () => { doc.destroy(); };
    }

    const provider = new WebsocketProvider(`ws://${host}`, sessionId, doc, {
      connect: true,
      params: { token },
    });
    providerRef.current = provider;

    const ytext = doc.getText("code");
    const undoManager = new Y.UndoManager(ytext);

    // Set awareness local state
    provider.awareness.setLocalStateField("user", {
      name: username,
      color: "#4A90D9",
      colorLight: "#4A90D940",
    });

    setState((prev) => ({
      ...prev,
      ytext,
      awareness: provider.awareness,
      undoManager,
    }));

    // Send join message once connected
    const onStatus = ({ status }: { status: string }) => {
      const isConnected = status === "connected";
      setState((prev) => ({ ...prev, connected: isConnected }));
      if (isConnected) {
        provider.ws?.send(
          JSON.stringify({ type: "join", userId, username, token }),
        );
      }
    };
    provider.on("status", onStatus);

    // Listen for custom server messages
    const onMessage = (event: MessageEvent) => {
      // Ignore binary Yjs sync messages
      if (typeof event.data !== "string") return;
      try {
        const msg: ServerMessage = JSON.parse(event.data);
        switch (msg.type) {
          case "user-joined":
            setState((prev) => ({ ...prev, userCount: msg.userCount, partnerDisconnected: false }));
            break;
          case "session-ended":
            setState((prev) => ({ ...prev, sessionEnded: true, endedBy: msg.endedBy }));
            break;
          case "user-disconnected":
            setState((prev) => ({ ...prev, partnerDisconnected: true, userCount: Math.max(0, prev.userCount - 1) }));
            break;
          case "language-changed":
            setState((prev) => ({ ...prev, language: msg.language as SupportedLanguage }));
            break;
          case "error":
            console.error("Collaboration error:", msg.message);
            break;
        }
      } catch {
        // Not a JSON message (Yjs binary), ignore
      }
    };

    // Intercept websocket messages: route text frames to our custom handler,
    // binary frames to y-websocket. This prevents y-websocket from trying to
    // decode JSON strings as Yjs binary messages.
    const attachMessageListener = () => {
      if (provider.ws) {
        const yjsHandler = provider.ws.onmessage;
        provider.ws.onmessage = (event: MessageEvent) => {
          if (typeof event.data === "string") {
            // Text frame → custom JSON protocol (join, language, etc.)
            onMessage(event);
            return;
          }
          // Binary frame → Yjs sync protocol
          if (yjsHandler) {
            (yjsHandler as (event: MessageEvent) => void)(event);
          }
        };
      }
    };

    provider.on("status", ({ status }: { status: string }) => {
      if (status === "connected") attachMessageListener();
    });

    return () => {
      provider.disconnect();
      provider.destroy();
      doc.destroy();
    };
  }, [sessionId, userId, username]);

  const endSession = useCallback(() => {
    providerRef.current?.ws?.send(JSON.stringify({ type: "end-session" }));
  }, []);

  const changeLanguage = useCallback((lang: SupportedLanguage) => {
    setState((prev) => ({ ...prev, language: lang }));
    providerRef.current?.ws?.send(JSON.stringify({ type: "language-change", language: lang }));
  }, []);

  return { ...state, endSession, changeLanguage };
}

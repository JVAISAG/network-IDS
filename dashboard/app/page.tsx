"use client";

import { useEffect, useState, useCallback } from "react";
import { getSocket } from "@/lib/socket";
import type { EventRow } from "@/lib/types";
import EventTable from "@/components/EventTable";
import HistoryPanel from "@/components/HistoryPanel";

export default function Home() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [selectedIp, setSelectedIp] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState("connecting");

  // Initial fetch
  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";
    fetch(`${apiUrl}/api/events/recent`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setEvents(data);
      })
      .catch(() => {});
  }, []);

  // Socket.io live updates
  useEffect(() => {
    const socket = getSocket();

    socket.on("connect", () => setConnectionState("connected"));
    socket.on("disconnect", () => setConnectionState("disconnected"));
    socket.on("connect_error", () => setConnectionState("error"));

    socket.on("event", (evt: EventRow) => {
      setEvents((prev) => {
        const idx = prev.findIndex((e) => e.event_id === evt.event_id);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = { ...copy[idx], ...evt };
          return copy;
        }
        return [evt, ...prev].slice(0, 500);
      });
    });

    socket.on("alert", (alert: { event_id: string; anomaly_score: number }) => {
      setEvents((prev) => {
        const idx = prev.findIndex((e) => e.event_id === alert.event_id);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = { ...copy[idx], anomaly_score: alert.anomaly_score };
          return copy;
        }
        return prev;
      });
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("connect_error");
      socket.off("event");
      socket.off("alert");
    };
  }, []);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">XDR Dashboard</h1>
        <span className={`text-xs px-3 py-1 rounded-full ${statusBadge(connectionState)}`}>
          {connectionState}
        </span>
      </div>

      <EventTable events={events} onSelectIp={setSelectedIp} />

      <div className="mt-4 text-xs text-gray-500">
        {events.length} events displayed &middot; Click any row to see IP history
      </div>

      {selectedIp && (
        <HistoryPanel ip={selectedIp} onClose={() => setSelectedIp(null)} />
      )}
    </div>
  );
}

function statusBadge(state: string): string {
  switch (state) {
    case "connected": return "bg-green-900/50 text-green-300";
    case "disconnected": return "bg-yellow-900/50 text-yellow-300";
    case "error": return "bg-red-900/50 text-red-300";
    default: return "bg-gray-800 text-gray-400";
  }
}

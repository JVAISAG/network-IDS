"use client";

import { useEffect, useState } from "react";
import type { HistoryEntry } from "@/lib/types";

interface Props {
  ip: string;
  onClose: () => void;
}

export default function HistoryPanel({ ip, onClose }: Props) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";
    fetch(`${apiUrl}/api/history/${encodeURIComponent(ip)}`)
      .then((r) => r.json())
      .then((data) => {
        setHistory(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [ip]);

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-gray-900 border-l border-gray-700 shadow-2xl z-50 overflow-y-auto">
      <div className="sticky top-0 bg-gray-900 border-b border-gray-700 p-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{ip}</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">&times;</button>
      </div>
      <div className="p-4">
        {loading ? (
          <p className="text-gray-400">Loading...</p>
        ) : history.length === 0 ? (
          <p className="text-gray-400">No events found</p>
        ) : (
          <div className="space-y-3">
            {history.map((e) => (
              <div key={e.event_id} className="bg-gray-800 rounded p-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-300">{e.event_type}</span>
                  <span className={severityColor(e.severity)}>{e.severity}</span>
                </div>
                <div className="text-gray-400 text-xs">{new Date(e.received_at).toLocaleString()}</div>
                <div className="text-xs">
                  Score:{" "}
                  {e.anomaly_score !== null && e.anomaly_score !== undefined
                    ? e.anomaly_score.toFixed(4)
                    : "—"}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function severityColor(s: string): string {
  switch (s) {
    case "high": return "text-red-400";
    case "medium": return "text-yellow-400";
    default: return "text-green-400";
  }
}

"use client";

import type { EventRow } from "@/lib/types";

interface Props {
  events: EventRow[];
  onSelectIp: (ip: string) => void;
}

export default function EventTable({ events, onSelectIp }: Props) {
  // Build a set of IPs that have >=2 distinct event types
  const distinctCounts = new Map<string, Set<string>>();
  for (const e of events) {
    if (!distinctCounts.has(e.src_ip)) distinctCounts.set(e.src_ip, new Set());
    distinctCounts.get(e.src_ip)!.add(e.event_type);
  }
  const escalatedIps = new Set<string>();
  for (const [ip, types] of distinctCounts) {
    if (types.size >= 2) escalatedIps.add(ip);
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-700 text-gray-400 uppercase text-xs tracking-wider">
            <th className="text-left py-3 px-4">Timestamp</th>
            <th className="text-left py-3 px-4">Source</th>
            <th className="text-left py-3 px-4">Src IP</th>
            <th className="text-left py-3 px-4">Event Type</th>
            <th className="text-left py-3 px-4">Severity</th>
            <th className="text-left py-3 px-4">Anomaly Score</th>
            <th className="text-left py-3 px-4">Escalated</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => {
            const escalated = escalatedIps.has(e.src_ip);
            return (
              <tr
                key={e.event_id}
                className={`border-b border-gray-800 cursor-pointer transition-colors ${rowBg(e.anomaly_score)}`}
                onClick={() => onSelectIp(e.src_ip)}
              >
                <td className="py-2 px-4 whitespace-nowrap text-gray-300">
                  {new Date(e.received_at).toLocaleTimeString()}
                </td>
                <td className="py-2 px-4">{e.source}</td>
                <td className="py-2 px-4 font-mono text-cyan-300">{e.src_ip}</td>
                <td className="py-2 px-4">{e.event_type}</td>
                <td className="py-2 px-4">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${sevBadge(e.severity)}`}>
                    {e.severity}
                  </span>
                </td>
                <td className="py-2 px-4 font-mono">
                  {e.anomaly_score !== null && e.anomaly_score !== undefined
                    ? e.anomaly_score.toFixed(4)
                    : "—"}
                </td>
                <td className="py-2 px-4">
                  {escalated ? <span className="text-red-400 font-bold">YES</span> : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function rowBg(score: number | null | undefined): string {
  if (score === null || score === undefined) return "hover:bg-gray-800/50";
  if (score === 0) return "hover:bg-gray-800/50 bg-gray-800/20";
  if (score < 0.3) return "hover:bg-green-900/30 bg-green-950/40";
  if (score < 0.7) return "hover:bg-yellow-900/30 bg-yellow-950/40";
  return "hover:bg-red-900/30 bg-red-950/40";
}

function sevBadge(s: string): string {
  switch (s) {
    case "high": return "bg-red-900/50 text-red-300";
    case "medium": return "bg-yellow-900/50 text-yellow-300";
    default: return "bg-green-900/50 text-green-300";
  }
}

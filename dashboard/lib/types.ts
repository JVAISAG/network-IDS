export interface EventRow {
  event_id: string;
  source: string;
  src_ip: string;
  event_type: string;
  severity: string;
  detail?: string;
  received_at: string;
  anomaly_score: number | null;
}

export interface HistoryEntry extends EventRow {}

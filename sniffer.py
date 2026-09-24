"""
Lightweight network sniffer that feeds events into the mini-XDR pipeline.
Captures TCP SYN packets and DNS queries, extracts src_ip + event_type,
and batches POSTs to the ingestion API using a worker thread.

Requires: pip install scapy requests
Run: python sniffer.py
"""
import os
import time
import threading
import queue
from collections import defaultdict

import requests
from scapy.all import sniff, IP, TCP, UDP, DNS

API_URL = "http://localhost:4000/events"
API_KEY = os.getenv("API_KEY", "dev-secret-key")
BATCH_INTERVAL = 1.0

# Queue for inter-thread communication
event_queue = queue.Queue()

def batch_worker():
    headers = {"Authorization": f"Bearer {API_KEY}"}
    while True:
        batch = []
        try:
            # wait for first event in batch
            evt = event_queue.get(timeout=BATCH_INTERVAL)
            batch.append(evt)
            
            # gather remaining events in this window without blocking
            while True:
                try:
                    evt = event_queue.get_nowait()
                    batch.append(evt)
                except queue.Empty:
                    break
        except queue.Empty:
            continue
        
        # Aggregate syn_scans per IP
        aggregated = []
        syn_counts = defaultdict(lambda: {"count": 0, "ports": set()})
        
        for e in batch:
            if e["event_type"] == "syn_scan":
                ip = e["src_ip"]
                syn_counts[ip]["count"] += 1
                if "dst_port" in e["detail"]:
                    syn_counts[ip]["ports"].add(e["detail"]["dst_port"])
            else:
                aggregated.append(e)
                
        for ip, stats in syn_counts.items():
            aggregated.append({
                "source": "sniffer",
                "src_ip": ip,
                "event_type": "syn_scan",
                "severity": "low",
                "detail": {"count": stats["count"], "dst_ports": list(stats["ports"])},
            })

        for e in aggregated:
            try:
                resp = requests.post(API_URL, json=e, headers=headers, timeout=2)
                print(f"  -> {resp.status_code}  {e['src_ip']}  {e['event_type']}")
            except Exception as ex:
                print(f"  -> API error: {ex}")

def send_event(src_ip, event_type, detail=None):
    event_queue.put({
        "source": "sniffer",
        "src_ip": src_ip,
        "event_type": event_type,
        "severity": "low",  # let downstream handle escalation
        "detail": detail or {},
    })

def handle_packet(pkt):
    if IP not in pkt:
        return
    src_ip = pkt[IP].src

    # SYN packet (without ACK = connection attempt)
    if TCP in pkt and pkt[TCP].flags & 0x02 and not (pkt[TCP].flags & 0x10):
        detail = {"dst_port": pkt[TCP].dport, "ttl": pkt[IP].ttl}
        send_event(src_ip, "syn_scan", detail)

    # DNS query
    if UDP in pkt and pkt[UDP].dport == 53 and DNS in pkt and pkt[DNS].qd:
        for q in pkt[DNS].qd:
            domain = q.qname.decode(errors="replace").rstrip(".")
            if domain:
                send_event(src_ip, "dns_query", {"domain": domain})

print("Starting worker thread...")
threading.Thread(target=batch_worker, daemon=True).start()

print("Sniffing for SYN packets and DNS queries...")
print("Press Ctrl+C to stop.\n")
sniff(prn=handle_packet, store=False, filter="not port 4000")

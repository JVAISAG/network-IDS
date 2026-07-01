"""
Lightweight network sniffer that feeds events into the mini-XDR pipeline.
Captures TCP SYN packets and DNS queries, extracts src_ip + event_type,
and POSTs them to the ingestion API.

Requires: pip install scapy requests
Run: python sniffer.py
"""
import json
import time
from collections import defaultdict

import requests
from scapy.all import sniff, IP, TCP, UDP, DNS

API_URL = "http://localhost:4000/events"
SRC_TRACKER = {}  # ip -> list of event types seen (for severity heuristic)

def send_event(src_ip, event_type, detail=None):
    sev = "low"
    now = time.time()
    prev = SRC_TRACKER.get(src_ip, [])
    # escalate severity if this IP has been active recently
    prev = [t for t in prev if now - t[0] < 300]
    prev.append((now, event_type))
    SRC_TRACKER[src_ip] = prev
    distinct = len({t for _, t in prev})
    if distinct >= 3:
        sev = "high"
    elif distinct >= 2:
        sev = "medium"

    try:
        resp = requests.post(API_URL, json={
            "source": "sniffer",
            "src_ip": src_ip,
            "event_type": event_type,
            "severity": sev,
            "detail": detail or {},
        }, timeout=2)
        print(f"  -> {resp.json().get('id', 'error')}  {src_ip}  {event_type}  ({sev})")
    except Exception as e:
        print(f"  -> API error: {e}")

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

print("Sniffing for SYN packets and DNS queries...")
print("Press Ctrl+C to stop.\n")
sniff(prn=handle_packet, store=False)

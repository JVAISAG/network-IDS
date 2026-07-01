import json
import time
from collections import defaultdict
from typing import Any

import numpy as np
from sklearn.ensemble import IsolationForest

CORRELATION_WINDOW_S = 300
FEATURE_DIM = 4
SEVERITY_MAP = {"low": 0, "medium": 1, "high": 2}


class FeatureExtractor:
    def __init__(self):
        self.activity: dict[str, list[dict[str, Any]]] = defaultdict(list)

    def extract(self, *, src_ip: str, event_type: str, severity: str,
                detail_str: str) -> list[float]:
        events = self._prune(self.activity[src_ip])
        ports = _parse_ports(detail_str)

        events.append({
            "event_type": event_type,
            "severity": severity,
            "ports": ports,
            "ts": time.time(),
        })
        self.activity[src_ip] = events

        return [
            float(SEVERITY_MAP.get(severity, 0)),
            float(len(events)),
            float(len({e["event_type"] for e in events})),
            float(len({p for e in events for p in e["ports"]})),
        ]

    @staticmethod
    def _prune(events: list) -> list:
        cutoff = time.time() - CORRELATION_WINDOW_S
        return [e for e in events if e["ts"] >= cutoff]


def _parse_ports(detail_str: str) -> set[int]:
    try:
        detail = json.loads(detail_str) if isinstance(detail_str, str) else {}
    except (json.JSONDecodeError, TypeError):
        return set()
    if not isinstance(detail, dict):
        return set()

    ports: set[int] = set()
    for key in ("dst_port", "src_port", "port"):
        val = detail.get(key)
        if isinstance(val, (int, float)) and 0 < int(val) < 65536:
            ports.add(int(val))
    for key in ("ports", "dst_ports", "src_ports"):
        val = detail.get(key)
        if isinstance(val, (list, tuple)):
            for p in val:
                if isinstance(p, (int, float)) and 0 < int(p) < 65536:
                    ports.add(int(p))
    return ports


class AnomalyScorer:
    def __init__(self, buffer_size: int = 500, retrain_every: int = 100,
                 min_samples: int = 20):
        self.buffer_size = buffer_size
        self.retrain_every = retrain_every
        self.min_samples = min_samples

        self._buffer: list[list[float]] = []
        self._model = IsolationForest(
            n_estimators=100,
            contamination="auto",
            random_state=42,
        )
        self._trained = False
        self._events_since_retrain = 0

    def score(self, features: list[float]) -> float:
        self._buffer.append(features)
        if len(self._buffer) > self.buffer_size:
            self._buffer.pop(0)

        if not self._trained:
            if len(self._buffer) >= self.min_samples:
                self._retrain()
        else:
            self._events_since_retrain += 1
            if self._events_since_retrain >= self.retrain_every:
                self._retrain()

        if not self._trained:
            return 0.0

        X = np.array([features], dtype=np.float64)
        raw = float(self._model.decision_function(X)[0])
        return float(1.0 / (1.0 + np.exp(raw)))

    def _retrain(self) -> None:
        if len(self._buffer) < self.min_samples:
            return
        X = np.array(self._buffer, dtype=np.float64)
        self._model.fit(X)
        self._trained = True
        self._events_since_retrain = 0

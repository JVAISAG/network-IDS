import pytest
from scorer import FeatureExtractor, AnomalyScorer

def test_feature_extractor():
    ext = FeatureExtractor()
    feats = ext.extract(src_ip="1.1.1.1", event_type="syn_scan", severity="low", detail_str='{"dst_port": 80}')
    assert len(feats) == 4
    assert feats[1] == 1.0  # count
    
    feats = ext.extract(src_ip="1.1.1.1", event_type="failed_login", severity="medium", detail_str="{}")
    assert feats[1] == 2.0  # count
    assert feats[2] == 2.0  # distinct types

def test_anomaly_scorer():
    scorer = AnomalyScorer(buffer_size=10, min_samples=2, retrain_every=5)
    
    # Not trained initially
    assert scorer.score([0, 1, 1, 1]) == 0.0
    
    # Adding a second sample triggers training
    s = scorer.score([1, 2, 2, 2])
    assert s > 0.0
    
    # Adding more samples
    for _ in range(5):
        scorer.score([0, 1, 1, 1])

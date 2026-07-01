import os
import asyncio
from contextlib import asynccontextmanager

import redis.asyncio as aioredis
from fastapi import FastAPI
from motor.motor_asyncio import AsyncIOMotorClient

from scorer import FeatureExtractor, AnomalyScorer

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
STREAM_KEY = os.getenv("STREAM_KEY", "security-events")
MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
MONGO_DB = os.getenv("MONGO_DB", "xdr")
MONGO_COLLECTION = os.getenv("MONGO_COLLECTION", "security-alerts")

extractor = FeatureExtractor()
scorer = AnomalyScorer()


@asynccontextmanager
async def lifespan(app: FastAPI):
    redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    mongo = AsyncIOMotorClient(MONGO_URL)
    collection = mongo[MONGO_DB][MONGO_COLLECTION]

    consumer_task = asyncio.create_task(_consume_loop(redis, collection))

    yield

    consumer_task.cancel()
    await asyncio.gather(consumer_task, return_exceptions=True)
    await redis.aclose()
    mongo.close()


app = FastAPI(lifespan=lifespan, title="ML Scorer")


async def _consume_loop(redis, collection):
    last_id = "$"
    while True:
        try:
            results = await redis.xread(
                streams={STREAM_KEY: last_id},
                block=5000,
                count=10,
            )
            if not results:
                continue
            for _stream_name, entries in results:
                for entry_id, fields in entries:
                    await _process_event(entry_id, fields, collection)
                    last_id = entry_id
        except Exception as exc:
            print(f"[ml-scorer] consumer error: {exc}")
            await asyncio.sleep(2)


async def _process_event(entry_id, fields, collection):
    src_ip = fields.get("src_ip", "")
    event_type = fields.get("event_type", "")
    severity = fields.get("severity", "low")
    detail_str = fields.get("detail", "{}")

    features = extractor.extract(
        src_ip=src_ip,
        event_type=event_type,
        severity=severity,
        detail_str=detail_str,
    )
    score = scorer.score(features)

    doc = {"event_id": entry_id, "anomaly_score": score}
    await collection.insert_one(doc)
    print(f"[scored] {entry_id}  ip={src_ip}  score={score:.4f}")


@app.get("/health")
async def health():
    return {"ok": True}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

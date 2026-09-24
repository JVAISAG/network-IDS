import os
import asyncio
from datetime import datetime, timezone
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
GROUP = "ml-scorer-group"
CONSUMER = f"scorer-{os.getpid()}"

extractor = FeatureExtractor()
scorer = AnomalyScorer()


@asynccontextmanager
async def lifespan(app: FastAPI):
    redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    mongo = AsyncIOMotorClient(MONGO_URL)
    collection = mongo[MONGO_DB][MONGO_COLLECTION]

    try:
        await redis.xgroup_create(STREAM_KEY, GROUP, "$", mkstream=True)
    except Exception as e:
        if "BUSYGROUP" not in str(e):
            print(f"Group create error: {e}")

    consumer_task = asyncio.create_task(_consume_loop(redis, collection))

    yield

    consumer_task.cancel()
    await asyncio.gather(consumer_task, return_exceptions=True)
    await redis.aclose()
    mongo.close()


app = FastAPI(lifespan=lifespan, title="ML Scorer")


async def _reclaim(redis, collection):
    try:
        # XAUTOCLAIM returns (next_start_id, [entries], [deleted_ids])
        # We reclaim messages idle for > 10000ms
        res = await redis.xautoclaim(STREAM_KEY, GROUP, CONSUMER, 10000, "0-0", count=100)
        if res and len(res) > 1 and res[1]:
            for entry_id, fields in res[1]:
                await _process_event(entry_id, fields, collection)
                await redis.xack(STREAM_KEY, GROUP, entry_id)
    except Exception as e:
        print(f"Reclaim error: {e}")


async def _consume_loop(redis, collection):
    import random
    while True:
        try:
            results = await redis.xreadgroup(
                GROUP, CONSUMER,
                {STREAM_KEY: ">"},
                block=5000,
                count=10,
            )
            if results:
                for _stream_name, entries in results:
                    for entry_id, fields in entries:
                        await _process_event(entry_id, fields, collection)
                        await redis.xack(STREAM_KEY, GROUP, entry_id)
            
            if random.random() < 0.1:
                await _reclaim(redis, collection)
                
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
    
    loop = asyncio.get_running_loop()
    score = await loop.run_in_executor(None, scorer.score, features)

    doc = {
        "event_id": entry_id, 
        "anomaly_score": score,
        "_created_at": datetime.now(timezone.utc)
    }
    await collection.insert_one(doc)
    print(f"[scored] {entry_id}  ip={src_ip}  score={score:.4f}")


@app.get("/health")
async def health():
    return {"ok": True}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

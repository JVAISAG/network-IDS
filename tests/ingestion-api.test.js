const request = require("supertest");
const app = require("../ingestion-api");
const Redis = require("ioredis-mock");
jest.mock("ioredis", () => require("ioredis-mock"));

describe("Ingestion API", () => {
  it("should return 401 without valid API key", async () => {
    const res = await request(app).post("/events").send({
      source: "test",
      src_ip: "1.1.1.1",
      event_type: "test_event"
    });
    expect(res.statusCode).toEqual(401);
  });

  it("should accept valid event with API key", async () => {
    const res = await request(app)
      .post("/events")
      .set("Authorization", `Bearer dev-secret-key`)
      .send({
        source: "test",
        src_ip: "1.1.1.1",
        event_type: "test_event"
      });
    expect(res.statusCode).toEqual(201);
    expect(res.body.ok).toBe(true);
  });
  
  it("should return 400 for invalid data", async () => {
    const res = await request(app)
      .post("/events")
      .set("Authorization", `Bearer dev-secret-key`)
      .send({
        source: "test",
        src_ip: "invalid-ip",
        event_type: "test_event"
      });
    expect(res.statusCode).toEqual(400);
  });
});

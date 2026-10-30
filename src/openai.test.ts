import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { createOpenAiSpeechSynthesizer } from "./index.js";

test("adapter sends the speech contract and rejects oversized or non-WAV bodies", async (t) => {
  let response = Buffer.from("not a wave");
  const requests: { path: string; body: unknown; authorized: boolean }[] = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    requests.push({ path: req.url!, body: JSON.parse(Buffer.concat(chunks).toString()), authorized: req.headers.authorization === "Bearer test-only" });
    res.end(response);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const client = createOpenAiSpeechSynthesizer({ baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: "test-only", maxAudioBytes: 48 });
  await assert.rejects(client.synthesize("Hello.", { signal: new AbortController().signal }), /invalid WAV/);
  assert.deepEqual(requests[0], { path: "/v1/audio/speech", authorized: true, body: { model: "kokoro", voice: "af_heart", input: "Hello.", response_format: "wav" } });
  response = Buffer.alloc(49);
  await assert.rejects(client.synthesize("Hello.", { signal: new AbortController().signal }), /byte limit/);
  response = Buffer.alloc(46);
  response.write("RIFF", 0); response.write("WAVE", 8);
  response.writeUInt32LE(38, 4);
  response.write("fmt ", 12); response.writeUInt32LE(16, 16);
  response.writeUInt16LE(1, 20); response.writeUInt16LE(1, 22);
  response.writeUInt32LE(24000, 24); response.writeUInt32LE(48000, 28);
  response.writeUInt16LE(2, 32); response.writeUInt16LE(16, 34);
  response.write("data", 36); response.writeUInt32LE(2, 40);
  assert.equal((await client.synthesize("Hello.", { signal: new AbortController().signal })).data.length, 46);
});

import assert from "node:assert/strict";
import { ReadableStream } from "node:stream/web";
import { TextEncoder } from "node:util";
import { forwardServerStream } from "../../dist-electron/conversations/server-stream.js";

const encoder = new TextEncoder();
const response = (body) => ({
  body: new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  }),
});

const events = [];
const requests = await forwardServerStream(response([
  'data: {"type":"message.started"}\n\n',
  'data: {"type":"message.delta","content":"hello"}\n\n',
  "data: [DONE]\n\n",
].join("")), (event) => events.push(event));

assert.deepEqual(events.map((event) => event.type), ["message.started", "message.delta"]);
assert.deepEqual(requests, []);

await assert.rejects(
  forwardServerStream(response('data: {"type":"message.started"}\n\n'), () => undefined),
  /unexpected_stream_eof/,
);

const trailingEvents = [];
await forwardServerStream(
  response('data: {"type":"run.failed","errorCode":"provider_failed"}\n\ndata: [DONE]'),
  (event) => trailingEvents.push(event),
);
assert.equal(trailingEvents[0]?.type, "run.failed");

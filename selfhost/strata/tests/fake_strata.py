import asyncio
import json
from dataclasses import dataclass

from aiohttp import web


@dataclass
class RecordedRequest:
    method: str
    path: str
    headers: dict[str, str]
    body: bytes


def event(payload: object) -> bytes:
    return f"data: {json.dumps(payload)}\n\n".encode()


class FakeStrata:
    def __init__(self) -> None:
        self.url = ""
        self.requests: list[RecordedRequest] = []
        self.loading_remaining = 0
        self.tool_call = True
        self.health_status = 200
        self.redirect = False
        self.cors = True
        self.stream_gate: asyncio.Event | None = None
        self.stream_pause = 0.0
        self.long_stream = False
        self.disconnected = False

    def app(self) -> web.Application:
        app = web.Application()
        app.router.add_get("/health", self.health)
        app.router.add_get("/v1/models", self.models)
        app.router.add_post("/v1/chat/completions", self.chat)
        return app

    def headers(self) -> dict[str, str]:
        headers: dict[str, str] = {}
        if self.cors:
            headers["Access-Control-Allow-Origin"] = "*"
            headers["Access-Control-Allow-Headers"] = "Authorization"
        return headers

    def record(self, request: web.Request, body: bytes) -> None:
        self.requests.append(
            RecordedRequest(
                method=request.method,
                path=request.path,
                headers=dict(request.headers),
                body=body,
            )
        )

    async def health(self, request: web.Request) -> web.Response:
        self.record(request, b"")
        return web.json_response({"status": "ok"}, status=self.health_status, headers=self.headers())

    async def models(self, request: web.Request) -> web.Response:
        self.record(request, b"")
        body = {"object": "list", "data": [{"id": "strata", "object": "model"}]}
        return web.json_response(body, headers=self.headers())

    async def chat(self, request: web.Request) -> web.StreamResponse:
        body = await request.read()
        self.record(request, body)
        try:
            payload = json.loads(body)
        except ValueError:
            payload = {}
        if self.loading_remaining > 0:
            self.loading_remaining -= 1
            return web.json_response(
                {"error": {"message": "loading", "type": "service_unavailable", "code": "loading"}},
                status=503,
                headers=self.headers(),
            )
        if self.redirect:
            return web.Response(
                status=302,
                headers={"Location": "http://example.invalid/", **self.headers()},
            )
        if payload.get("stream") is True:
            return await self.stream_response(request)
        return web.json_response(self.completion(), headers=self.headers())

    def completion(self) -> dict:
        if self.tool_call:
            message = {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "call-1",
                        "type": "function",
                        "function": {"name": "ping", "arguments": '{"word":"ok"}'},
                    }
                ],
            }
            finish_reason = "tool_calls"
        else:
            message = {"role": "assistant", "content": "ok"}
            finish_reason = "stop"
        return {"choices": [{"index": 0, "message": message, "finish_reason": finish_reason}]}

    async def stream_response(self, request: web.Request) -> web.StreamResponse:
        response = web.StreamResponse(status=200, headers={**self.headers(), "Content-Type": "text/event-stream"})
        await response.prepare(request)
        try:
            await response.write(self.first_chunk())
            if self.stream_gate is not None:
                await self.stream_gate.wait()
            if self.stream_pause:
                await asyncio.sleep(self.stream_pause)
            if self.long_stream:
                for _ in range(40):
                    await asyncio.sleep(0.05)
                    await response.write(event({"choices": [{"index": 0, "delta": {}}]}))
            else:
                for chunk in self.remaining_chunks():
                    await response.write(chunk)
            await response.write_eof()
        except (ConnectionResetError, RuntimeError):
            self.disconnected = True
        return response

    def first_chunk(self) -> bytes:
        if self.tool_call:
            call = {
                "index": 0,
                "id": "call-1",
                "type": "function",
                "function": {"name": "ping", "arguments": '{"word":'},
            }
            return event({"choices": [{"index": 0, "delta": {"tool_calls": [call]}}]})
        return event({"choices": [{"index": 0, "delta": {"content": "ok"}}]})

    def remaining_chunks(self) -> list[bytes]:
        if self.tool_call:
            call = {"index": 0, "function": {"arguments": '"ok"}'}}
            first = event({"choices": [{"index": 0, "delta": {"tool_calls": [call]}}]})
            finish = event({"choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls"}]})
        else:
            first = event({"choices": [{"index": 0, "delta": {"content": " done"}}]})
            finish = event({"choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]})
        return [first, finish, b"data: [DONE]\n\n"]

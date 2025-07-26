import asyncio
import websockets
import aiohttp
import json
import base64

config = json.load(open("config.json"))


TUNNEL_TOKEN = config.get("token")
LOCAL_HOST = config.get("host")
TUNNEL_SERVER = f"wss://{config.get("tunnel")}/c97ad31f9fc13ff4e6bd022e74dd561ce93cf67e624dc061d461c1226e70"

pending_requests = {}
ws_sessions = {}

async def send_chunk(ws, req_id, chunk):
    id_bytes = req_id.encode()
    header = b"CHNK" + len(id_bytes).to_bytes(4, 'big') + len(chunk).to_bytes(4, 'big')
    await ws.send(header + id_bytes + chunk)

async def tunnel_loop():
    while True:
        try:
            async with websockets.connect(TUNNEL_SERVER, max_size=None) as ws:
                print("✅ Connected to tunnel server")
                await ws.send(json.dumps({ "type": "auth", "token": TUNNEL_TOKEN }))
                await handle_tunnel(ws)
        except Exception as e:
            if "Unauthorized" in str(e):
                print("Invalid security token. Disconnected.")
                exit(1)
            print(f"❌ Error: {e}. Reconnecting in 5s...")
            await asyncio.sleep(5)

async def handle_tunnel(ws):
    request_streams = {}
    binary_buffer = bytearray()

    async for msg in ws:
        if isinstance(msg, bytes):
            binary_buffer.extend(msg)
            await parse_chunks(binary_buffer, request_streams)
        else:
            data = json.loads(msg)
            msg_type = data.get("type")

            if msg_type == "request":
                req_id = data["id"]
                request_streams[req_id] = {
                    "meta": data,
                    "body": []
                }

            elif msg_type == "end":
                req = request_streams.pop(data["id"], None)
                if req:
                    asyncio.create_task(
                        handle_http_request(ws, req["meta"], b''.join(req["body"]))
                    )

            elif msg_type == "ws-init":
                asyncio.create_task(handle_ws_proxy(ws, data))

            elif msg_type == "ws-frame":
                session = ws_sessions.get(data["id"])
                if session:
                    await session.send(base64.b64decode(data["data"]))

            elif msg_type == "ws-close":
                session = ws_sessions.pop(data["id"], None)
                if session:
                    await session.close()

# Binary chunk parser for HTTP
async def parse_chunks(buffer, request_streams):
    while len(buffer) >= 12:
        if buffer[0:4] != b"CHNK":
            print("❌ Invalid chunk magic")
            buffer.clear()
            break

        id_len = int.from_bytes(buffer[4:8], 'big')
        chunk_len = int.from_bytes(buffer[8:12], 'big')
        total_len = 12 + id_len + chunk_len

        if len(buffer) < total_len:
            break  # Wait for more data

        id_bytes = buffer[12:12 + id_len]
        payload = buffer[12 + id_len:total_len]
        stream_id = id_bytes.decode()

        if stream_id in request_streams:
            request_streams[stream_id]["body"].append(payload)

        del buffer[:total_len]

# Handle HTTP request locally
async def handle_http_request(ws, meta, body):
    try:
        url = f"{LOCAL_HOST}{meta['url']}"

        headers = {
            k: v for k, v in meta.get("headers", {}).items()
            if k.lower() not in ['host', 'content-length', 'transfer-encoding']
        }
        async with aiohttp.request(meta["method"], url, headers=headers, data=body) as resp:
            raw_headers = {}
            for key, value in resp.headers.items():
                if key.lower() == 'set-cookie':
                    raw_headers.setdefault('Set-Cookie', []).append(value)
                else:
                    raw_headers[key] = value

            await ws.send(json.dumps({
                "type": "response",
                "id": meta["id"],
                "status": resp.status,
                "headers": raw_headers
            }))

            async for chunk in resp.content.iter_chunked(4096):
                await send_chunk(ws, meta["id"], chunk)

            await ws.send(json.dumps({ "type": "end", "id": meta["id"] }))

    except Exception as e:
        err = str(e).encode()
        await ws.send(json.dumps({
            "type": "response",
            "id": meta["id"],
            "status": 500,
            "headers": { "Content-Type": "text/plain" }
        }))
        await send_chunk(ws, meta["id"], err)
        await ws.send(json.dumps({ "type": "end", "id": meta["id"] }))

# Handle proxied WebSocket session
async def handle_ws_proxy(ws, meta):
    req_id = meta["id"]
    ws_url = f"{LOCAL_HOST.replace('http', 'ws')}{meta['url']}"
    headers = {k: v for k, v in meta.get("headers", {}).items() if k.lower() not in ['host', 'connection', 'upgrade', 'sec-websocket-key', 'sec-websocket-version', 'sec-websocket-extensions']}
    try:
        async with websockets.connect(ws_url,additional_headers=headers) as local_ws:
            ws_sessions[req_id] = local_ws

            async for msg in local_ws:
                encoded = base64.b64encode(msg if isinstance(msg, bytes) else msg.encode()).decode()
                
                await ws.send(json.dumps({
                    "type": "ws-frame",
                    "id": req_id,
                    "data": encoded,
                    "isBinary": isinstance(msg, bytes)
                }))
    except Exception as e:
        print(f"❌ WebSocket proxy error [{req_id}]:", e)
    finally:
        await ws.send(json.dumps({ "type": "ws-close", "id": req_id }))
        ws_sessions.pop(req_id, None)


asyncio.run(tunnel_loop())

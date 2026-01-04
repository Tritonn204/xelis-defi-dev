import json
import asyncio
import websockets

RPC_ADDRESS = "ws://76.216.16.66:8080/json_rpc"

async def subscribe_to_swap():
    while True:
        try:
            async with websockets.connect(RPC_ADDRESS, ping_interval=20, ping_timeout=60) as ws:
                message = {
                    "id": 1,
                    "jsonrpc": "2.0",
                    "method": "subscribe",
                    "params": {
                        "notify": {"contract_event": {
                            "contract": "14be5e85fb83d84aa50e64091ca583af7e3f39ef8ecabdb9133340d1b754f0d3",
                            "id": 1
                        }},
                    }
                }

                await ws.send(json.dumps(message))

                while True:
                    response = await ws.recv()
                    data = json.loads(response)
                    print(data)
        except websockets.exceptions.ConnectionClosedError as e:
            print("WebSocket connection lost, reconnecting...", e)
            await asyncio.sleep(5)
        except Exception as e:
            print("Error processing WebSocket message:", e)
            await asyncio.sleep(5)


if __name__ == "__main__":
    asyncio.run(subscribe_to_swap())
import asyncio
import aiohttp

HTTP_RPC = "https://testnet-node.xelis.io/json_rpc"

async def call_once_http():
    msg = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "get_contract_assets",
        "params": {
            "contract": "964c09ef67b9122ff4e3fa840b8ef39756ac12ba27861fda93623ee53f887fc3"
        }
    }
    async with aiohttp.ClientSession() as session:
        async with session.post(HTTP_RPC, json=msg, timeout=10) as r:
            data = await r.json()
            if "error" in data:
                raise RuntimeError(f"RPC error: {data['error']}")
            print(data)

if __name__ == "__main__":
    asyncio.run(call_once_http())

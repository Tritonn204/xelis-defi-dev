import requests
from requests.auth import HTTPBasicAuth

# ======= CONFIG (edit these for your target method) =======
URL = "http://127.0.0.1:8081/json_rpc"
AUTH = HTTPBasicAuth("forge", "a")
HEADERS = {"Content-Type": "application/json"}

CONTRACT_ID = "0f58d557b2ad583f56b694c7f9716f819dc893f376551307d42c54562ed1572b"  # <-- change if needed
entry_id = 1  # <-- method selector / chunk id for the no-arg method
maxGas = 200_000_000
BROADCAST = True

def call_contract_once():
    payload = {
        "jsonrpc": "2.0",
        "method": "build_transaction",
        "id": 1,
        "params": {
            "invoke_contract": {
                "contract": CONTRACT_ID,
                "maxGas": maxGas,
                "entry_id": entry_id,
                "parameters": [],          # no input params
                # "deposits": {}           # omit if the method takes no deposits
            },
            "broadcast": BROADCAST
        }
    }

    resp = requests.post(URL, json=payload, headers=HEADERS, auth=AUTH, timeout=30)
    resp.raise_for_status()
    print(resp.json())

if __name__ == "__main__":
    try:
        call_contract_once()
    except Exception as e:
        print("Error calling contract:", e)

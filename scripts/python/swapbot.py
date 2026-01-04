import requests
import time
import random
from requests.auth import HTTPBasicAuth

# ======= CONFIG =======
SECONDS = 5          # main loop delay
MINAMOUNT = 0.005    # swap minimum 0.5%
MAXAMOUNT = 0.03     # swap maximum 3%

MINTIME = 16         # minimum trend length (seconds)
MAXTIME = 100        # maximum trend length (seconds)

# Volatility
LOW_VOL = 0.01
HIGH_VOL = 0.05
VOL_SWITCH_PROB = 0.1   # chance to switch regimes

# Momentum & reversal
MOMENTUM_BIAS = 0.1     # extra bias for continuing same trend
REVERSAL_PROB = 0.05    # chance to flip trend early

# Shocks
SHOCK_PROB = 0.01       # chance of sudden big swap
SHOCK_MULTIPLIER = 5    # how much bigger a shock is

url = "http://127.0.0.1:8081/json_rpc"
auth = HTTPBasicAuth("forge", "a")

assets = [
    "d72382ae9e0aab83768dfbace62a59cc78f1dcff238acd4af4a7ba3c6dca96b2",  # down
    "0000000000000000000000000000000000000000000000000000000000000000"   # up
]

headers = {"Content-Type": "application/json"}

# --- Trend State ---
trend_asset = None
trend_end_time = 0
trend_rate = 0.7
volatility = LOW_VOL


def rescan():
    payload = {
        "jsonrpc": "2.0",
        "method": "rescan",
        "id": 1,
        "params": {"until_topoheight": 0}
    }
    try:
        resp = requests.post(url, json=payload, headers=headers, auth=auth)
        data = resp.json()
        # print(f"Rescan: {data}")
        return data.get("result", 0)
    except Exception as e:
        print(f"Error rescanning: {e}")
        return 0


def get_balance(asset_id: str) -> int:
    payload = {
        "jsonrpc": "2.0",
        "method": "get_balance",
        "id": 1,
        "params": {
            "type": "primitive",
            "value": {
                "type": "opaque",
                "value": {"type": "Hash", "value": asset_id}
            }
        }
    }
    try:
        resp = requests.post(url, json=payload, headers=headers, auth=auth)
        return int(resp.json().get("result", 0))
    except Exception as e:
        # print(f"Error fetching balance for {asset_id}: {e}")
        return 0


def pick_asset():
    """Pick an asset with trend, momentum, reversal, and volatility effects."""
    global trend_asset, trend_end_time, trend_rate, volatility

    now = time.time()

    # volatility regime switch
    if random.random() < VOL_SWITCH_PROB:
        volatility = HIGH_VOL if volatility == LOW_VOL else LOW_VOL
        print(f"Volatility switched to {'HIGH' if volatility == HIGH_VOL else 'LOW'}")

    # trend expired or not set
    if trend_asset is None or now > trend_end_time or random.random() < REVERSAL_PROB:
        trend_asset = random.choice(assets)
        trend_duration = random.randint(MINTIME, MAXTIME)
        trend_rate = random.uniform(0.51, 0.75) + MOMENTUM_BIAS
        trend_end_time = now + trend_duration

        if trend_asset == assets[1]:
            print(f"Trend: UP for {trend_duration}s (bias {trend_rate:.2f})")
        else:
            print(f"Trend: DOWN for {trend_duration}s (bias {trend_rate:.2f})")

    # biased pick
    return trend_asset if random.random() < trend_rate else (assets[1] if trend_asset == assets[0] else assets[0])


while True:
    try:
        chosen_asset = pick_asset()

        balance = get_balance(chosen_asset)
        if balance <= 0:
            print(f"No balance for {chosen_asset}, skipping.")
            time.sleep(SECONDS)
            continue

        # normal or shock size
        if random.random() < SHOCK_PROB:
            percent = random.uniform(MINAMOUNT, MAXAMOUNT) * SHOCK_MULTIPLIER
            print(f"*** SHOCK event! size {percent:.2%}")
        else:
            percent = random.uniform(MINAMOUNT, MAXAMOUNT) * (1 + volatility)

        amount = int(balance * percent)

        payload = {
            "jsonrpc": "2.0",
            "method": "build_transaction",
            "id": 1,
            "params": {
                "invoke_contract": {
                    "contract": "6d9bfb4fe47d077c1bfc18a148cd68c8f32579b0fb8845c85640a2c06e8df090",
                    "maxGas": 50000000,
                    "entry_id": 14,
                    "parameters": [
                        {"type": "primitive", "value": {"type": "opaque", "value": {"type": "Hash", "value": chosen_asset}}},
                        {"type": "primitive", "value": {"type": "opaque", "value": {"type": "Hash",
                                          "value": assets[1] if chosen_asset == assets[0] else assets[0]}}},
                        {"type": "primitive", "value": {"type": "u64", "value": 0}}
                    ],
                    "deposits": {chosen_asset: {"amount": amount}}
                },
                "broadcast": True
            }
        }

        response = requests.post(url, json=payload, headers=headers, auth=auth)
        data = response.json()

        if data.get("result") is None:
            rescan()

    except Exception as e:
        print("Error:", e)
        rescan()

    time.sleep(SECONDS)
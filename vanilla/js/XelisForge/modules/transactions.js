import { showNotification } from './ui/notifications.js';
import { sendRPCCall } from './handler.js';

let ws = null;

export function setWebSocketInstance(wsInstance) {
    ws = wsInstance;
}

const contract = "6f9910e6a993540e944821d955388d3714bdafd490de9b1e2f0eb927cdbdf490";

// Create Token
export async function createToken() {
    const name = document.getElementById("name").value;
    const ticker = document.getElementById("ticker").value;
    const decimals = Number(document.getElementById("decimals").value);
    const supply = Number(document.getElementById("supply").value) * 10 ** decimals;
    const mintable = document.getElementById("mintable").checked;
    const maxSupply = Number(document.getElementById("maxSupply").value * 10 ** decimals)

    const params = {
        invoke_contract: {
            contract: contract,
            max_gas: 200000000,
            chunk_id: 2,
            deposits: {
                "0000000000000000000000000000000000000000000000000000000000000000": {
                    "amount": 100000000
                }
            },
            parameters: [
                { type: "default", value: { type: "string", value: name } },
                { type: "default", value: { type: "string", value: ticker } },
                { type: "default", value: { type: "u64", value: supply } },
                { type: "default", value: { type: "u8", value: decimals } },
                { type: "default", value: { type: "boolean", value: mintable } },
                { type: "default", value: { type: "u64", value: maxSupply } }
            ]
        },
        broadcast: true
    };
    
    showNotification("Transaction sent, approve in wallet.", "info");
    const transactionData = await sendRPCCall(ws, "wallet.build_transaction", params);
    if (transactionData.hash) {
        showNotification(`TX Hash: ${transactionData.hash}`, "success", 8000);
    }
}

// Mint Tokens
export async function mintTokens() {
    const AssetHash = document.getElementById("mintAssetHash").value;
    const mintAmount = Number(document.getElementById("mintAmount").value);

    const params = {
        invoke_contract: {
            contract: contract,
            max_gas: 200000000,
            chunk_id: 3,
            parameters: [
                { type: "default", value: { type: "opaque", value: { type: "Hash", value: AssetHash } } },
                { type: "default", value: { type: "u64", value: mintAmount } }
            ]
        },
        broadcast: true
    };
    
    showNotification("Transaction sent, approve in wallet.", "info");
    const transactionData = await sendRPCCall(ws, "wallet.build_transaction", params);
    if (transactionData.hash) {
        showNotification(`TX Hash: ${transactionData.hash}`, "success", 8000);
    }
}

// Manage Ownership
export async function ownership() {
    if (document.getElementById('renounce').checked) {
        renounceOwnership();
    } else {
        transferOwnership();
    }
}

// Transfer Ownership
async function transferOwnership() {
    const assetHash = document.getElementById("transferAssetHash").value;
    const address = document.getElementById("ownerAddress").value;

    const params = {
        invoke_contract: {
            contract: contract,
            max_gas: 200000000,
            chunk_id: 4,
            parameters: [
                { type: "default", value: { type: "opaque", value: { type: "Hash", value: assetHash } } },
                { type: "default", value: { type: "opaque", value: { type: "Address", value: address } } }
            ]
        },
        broadcast: true
    };
    
    showNotification("Transaction sent, approve in wallet.", "info");
    const transactionData = await sendRPCCall(ws, "wallet.build_transaction", params);
    if (transactionData.hash) {
        showNotification(`TX Hash: ${transactionData.hash}`, "success", 8000);
    }
}

// Renounce Ownership
async function renounceOwnership() {
    const assetHash = document.getElementById("transferAssetHash").value;

    const params = {
        invoke_contract: {
            contract: contract,
            max_gas: 200000000,
            chunk_id: 5,
            parameters: [
                { type: "default", value: { type: "opaque", value: { type: "Hash", value: assetHash } } }
            ]
        },
        broadcast: true
    };
    
    showNotification("Transaction sent, approve in wallet.", "info");
    const transactionData = await sendRPCCall(ws, "wallet.build_transaction", params);
    if (transactionData.hash) {
        showNotification(`TX Hash: ${transactionData.hash}`, "success", 8000);
    }
}

// Deploy Contract
export async function deployContract() {
    const bytecode = document.getElementById("bytecode").value;

    const params = {
        deploy_contract: { module: bytecode },
        broadcast: true
    };
    
    showNotification("Transaction sent, approve in wallet.", "info");
    const transactionData = await sendRPCCall(ws, "wallet.build_transaction", params);
    if (transactionData.hash) {
        showNotification(`TX Hash: ${transactionData.hash}`, "success", 8000);
    }
}

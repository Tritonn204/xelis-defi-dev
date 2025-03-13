import { showNotification } from './ui/notifications.js';
import { sendRPCCall } from './handler.js';

let ws = null;

export function setWebSocketInstance(wsInstance) {
    ws = wsInstance;
}

// Create Token
export async function createToken() {
    const name = document.getElementById("name").value;
    const ticker = document.getElementById("ticker").value;
    const decimals = Number(document.getElementById("decimals").value);
    const supply = Number(document.getElementById("supply").value) * 10 ** decimals;
    const mintable = document.getElementById("mintable").checked;

    const params = {
        invoke_contract: {
            contract: contract,
            max_gas: 200000000,
            chunk_id: 0,
            parameters: [
                { type: "default", value: { type: "string", value: name } },
                { type: "default", value: { type: "string", value: ticker } },
                { type: "default", value: { type: "u64", value: supply } },
                { type: "default", value: { type: "u8", value: decimals } },
                { type: "default", value: { type: "boolean", value: mintable } }
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
            chunk_id: 1,
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

// Transfer Ownership
export async function transferOwnership() {
    const AssetHash = document.getElementById("transferAssetHash").value;
    const address = Number(document.getElementById("ownerAddress").value);

    const params = {
        invoke_contract: {
            contract: contract,
            max_gas: 200000000,
            chunk_id: 2,
            parameters: [
                { type: "default", value: { type: "opaque", value: { type: "Hash", value: AssetHash } } },
                { type: "default", value: { type: "u64", value: address } }
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
        deploy_contract: bytecode,
        broadcast: true
    };
    
    showNotification("Transaction sent, approve in wallet.", "info");
    const transactionData = await sendRPCCall(ws, "wallet.build_transaction", params);
    if (transactionData.hash) {
        showNotification(`TX Hash: ${transactionData.hash}`, "success", 8000);
    }
}

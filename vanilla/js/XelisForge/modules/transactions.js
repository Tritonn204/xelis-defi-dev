import { showNotification } from './ui/notifications.js';
import { sendRPCCall } from './handler.js';

let ws = null;

export function setWebSocketInstance(wsInstance) {
    ws = wsInstance;
}

const contract = "f0788407550d200b6b65cf3df311831d746218489dca18b6c3d066655b4a1753";

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

// Transfer Ownership
export async function transferOwnership() {
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
export async function renounceOwnership() {
    const assetHash = document.getElementById("renounceAssetHash").value;

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

import { showNotification } from './ui/notifications.js';
import { enableButton } from './ui/walletConnect.js';

const pendingCalls = new Map();

export function sendRPCCall(ws, method, params = {}) {
    return new Promise((resolve, reject) => {
        let id = 1;
        while (id === 1 || pendingCalls.has(id)) {
            id = Math.floor(Math.random() * 100000); // Generate a unique ID
        }
        pendingCalls.set(id, resolve);
        const requestData = {
            id,
            jsonrpc: "2.0",
            method,
            ...(Object.keys(params).length > 0 && {
                params
            }) // Conditionally add params
        };
        ws.send(JSON.stringify(requestData));

        setTimeout(() => {
            if (pendingCalls.has(id)) {
                pendingCalls.delete(id);
                reject(new Error(`Timeout for method: ${method}`));
            }
        }, 10000); // Timeout after 10 seconds
    });
}

export function handleMessage(event) {
    try {
        const data = JSON.parse(event.data);
        console.log("Received message:", data);
        if (data.id && pendingCalls.has(data.id)) {
            const resolve = pendingCalls.get(data.id);
            pendingCalls.delete(data.id);
            resolve(data.result);
        } else if ((data.id === null) && (data.result) && (data.result.message === "Application has been registered")) {
            showNotification("Wallet connected successfully!", "success");
            enableButton();
            return; 
        }

    } catch (err) {
        console.error("Failed to handle message:", err);
    }
}


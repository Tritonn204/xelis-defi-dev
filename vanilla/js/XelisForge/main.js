import { resetButton, enableButton } from './modules/ui/walletConnect.js';
import { showNotification } from './modules/ui/notifications.js';
import { showSection } from './modules/ui/page.js';
import { updateNavbar } from './modules/ui/navBar.js';
import { handleMessage } from './modules/handler.js';
import { setWebSocketInstance, createToken, mintTokens, transferOwnership, deployContract } from './modules/transactions.js';

window.dapp = {
    showSection,
    updateNavbar,
    toggleWalletConnection,
    createToken,
    mintTokens,
    transferOwnership,
    deployContract
};


// URL of the XSWD WebSocket server
const websocketUrl = "ws://localhost:44325/xswd";
let ws = null;
let connectionFailed = false; // Prevents duplicate error/disconnect messages



// Connect/Disconnect Wallet function
function toggleWalletConnection() {
    const connectButton = document.getElementById("connectWalletButton");

    if (ws && ws.readyState === WebSocket.OPEN) {
        console.log("Disconnecting WebSocket...");
        ws.close();
        return;
    }

    showNotification("Connecting to wallet...", "info"); // Show notification before attempting connection
    connectionFailed = false; // Reset flag before new connection attempt

    ws = new WebSocket(websocketUrl);

    ws.onopen = () => {
        console.log("Connected to WebSocket.");
        setWebSocketInstance(ws);
        ws.onmessage = handleMessage;

        // Prepare ApplicationData message
        const applicationData = {
            id: "a47f83dbb22c559dfe06b5b7d535520dfe1e5cb07990b846bdb794b14b0e5cff",
            name: "XELIS Forge",
            description: "Deploy and manage your own XELIS Tokens!",
            url: "https://xelisforge.app",
            permissions: ["build_transaction"]
        };

        ws.send(JSON.stringify(applicationData));
        console.log("ApplicationData sent:", applicationData);        
    };

    ws.onerror = (error) => {
        console.error("WebSocket Error:", error);
        connectionFailed = true; // Mark that an error occurred
        showNotification("WebSocket connection failed. Please try again.", "error");
    };

    ws.onclose = () => {
        console.log("Connection closed.");
        resetButton();
        setWebSocketInstance(null);
        if (!connectionFailed) { // Only show disconnect message if there was no prior error
            showNotification("Wallet disconnected.", "info");
        }
    };
}


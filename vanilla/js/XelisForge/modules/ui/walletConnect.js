// Reset button to initial state
export function resetButton() {
    const connectButton = document.getElementById("connectWalletButton");
    connectButton.textContent = "Connect Wallet";
    connectButton.style.backgroundColor = "#000";
}

export function enableButton() {
    const connectButton = document.getElementById("connectWalletButton");
    connectButton.textContent = "Connected";
    connectButton.style.backgroundColor = "#007BFF";
}
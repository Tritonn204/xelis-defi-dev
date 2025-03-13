// Create notification container if not present
if (!document.getElementById("notificationContainer")) {
    const container = document.createElement("div");
    container.id = "notificationContainer";
    document.body.appendChild(container);
}

// Show stacked notifications
export function showNotification(message, type, duration = 3000) {
    const notification = document.createElement("div");
    notification.className = `notification ${type}`;
    notification.innerHTML = `${message} <button class="close-btn">&times;</button>`;

    const container = document.getElementById("notificationContainer");
    container.appendChild(notification);

    // Close on click
    notification.querySelector(".close-btn").addEventListener("click", () => {
        removeNotification(notification);
    });

    // Auto-remove after duration
    setTimeout(() => removeNotification(notification), duration);
}

// Remove notification smoothly
function removeNotification(notification) {
    notification.classList.add("fade-out");
    setTimeout(() => notification.remove(), 500); // Wait for fade-out effect
}
import { updateNavbar } from './navBar.js';

export function showSection(sectionId) {
    document.querySelectorAll('.container').forEach(section => {
        section.style.display = section.id === sectionId ? 'block' : 'none';
    });

    document.querySelectorAll('.nav-button').forEach(button => {
        button.classList.toggle('active', button.getAttribute("onclick")?.includes(`showSection('${sectionId}')`));
    });
}

// Ensure "Token Generator" is selected by default
document.addEventListener("DOMContentLoaded", () => {
    showSection('generator');
    updateNavbar();
});

document.getElementById('mintable').addEventListener('change', function() {
    document.getElementById('maxSupply').style.display = this.checked ? 'flex' : 'none';
});

document.getElementById('renounce').addEventListener('change', function() {
    document.getElementById('ownerAddress').style.display = this.checked ? 'none' : 'flex';
});

const tickerInput = document.getElementById("ticker");

tickerInput.addEventListener("input", function () {
    this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
});

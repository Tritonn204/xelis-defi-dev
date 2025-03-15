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

const nameInput = document.getElementById("name");
const tickerInput = document.getElementById("ticker");

nameInput.addEventListener("input", function () {
    this.value = this.value.replace(/[^A-Z0-9]/g, "");
});

tickerInput.addEventListener("input", function () {
    this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
});

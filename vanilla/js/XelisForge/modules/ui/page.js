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
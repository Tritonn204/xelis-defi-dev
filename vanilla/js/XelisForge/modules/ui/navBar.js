export function updateNavbar() {
    const navbar = document.querySelector('.navbar');
    const navbarLinks = document.querySelector('.navbar-links');
    const dropdown = document.querySelector('.nav-dropdown');
    const dropdownSelect = dropdown.querySelector('select');

    // Temporarily show navbar buttons to check if they fit
    navbarLinks.style.display = 'flex';
    dropdown.classList.remove('show');
    dropdownSelect.style.width = '185px';


    if (navbarLinks.scrollWidth > (navbar.clientWidth * .999)) {
        navbarLinks.style.display = 'none';
        dropdown.classList.add('show');
        dropdownSelect.style.width = '10px'; 
    } else if (navbarLinks.scrollWidth > (navbar.clientWidth * .62)) {
        navbarLinks.style.display = 'none';
        dropdown.classList.add('show');
        dropdownSelect.style.width = '185px';
    } else {
        navbarLinks.style.display = 'flex';
        dropdownSelect.style.width = '185px';
        dropdown.classList.remove('show');
    }
}
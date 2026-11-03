function toggleMobileMenu() {
            const menu = document.getElementById('mobile-menu');
            const icon = document.getElementById('menu-icon');
            if (menu.classList.contains('hidden')) {
                menu.classList.remove('hidden');
                icon.className = 'fa-solid fa-xmark text-lg text-amber-400';
            } else {
                menu.classList.add('hidden');
                icon.className = 'fa-solid fa-bars text-lg';
            }
        }
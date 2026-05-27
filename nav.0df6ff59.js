"use strict";
(function () {
    const navToggle = document.querySelector('.nav-toggle');
    const siteNav = document.getElementById('site-nav');
    if (!navToggle || !siteNav) {
        return;
    }
    const closeSubmenus = () => {
        siteNav.querySelectorAll('.has-submenu').forEach((item) => {
            item.classList.remove('is-open');
        });
        siteNav.querySelectorAll('.submenu-toggle').forEach((toggle) => {
            toggle.setAttribute('aria-expanded', 'false');
        });
    };
    const closeNav = () => {
        siteNav.classList.remove('is-open');
        navToggle.classList.remove('is-open');
        navToggle.setAttribute('aria-expanded', 'false');
        navToggle.setAttribute('aria-label', 'Open navigation');
        closeSubmenus();
    };
    navToggle.addEventListener('click', () => {
        const isOpen = navToggle.getAttribute('aria-expanded') === 'true';
        navToggle.setAttribute('aria-expanded', String(!isOpen));
        navToggle.setAttribute('aria-label', isOpen ? 'Open navigation' : 'Close navigation');
        navToggle.classList.toggle('is-open', !isOpen);
        siteNav.classList.toggle('is-open', !isOpen);
        if (isOpen) {
            closeSubmenus();
        }
    });
    siteNav.querySelectorAll('.submenu-toggle').forEach((toggle) => {
        toggle.addEventListener('click', () => {
            if (window.innerWidth > 768) {
                return;
            }
            const parent = toggle.closest('.has-submenu');
            if (!parent) {
                return;
            }
            const isOpen = toggle.getAttribute('aria-expanded') === 'true';
            parent.classList.toggle('is-open', !isOpen);
            toggle.setAttribute('aria-expanded', String(!isOpen));
        });
    });
    siteNav.querySelectorAll('a').forEach((link) => {
        link.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                closeNav();
            }
        });
    });
    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) {
            closeNav();
        }
    });
}());

(function (): void {
    const navToggle = document.querySelector<HTMLButtonElement>('.nav-toggle');
    const siteNav = document.getElementById('site-nav');

    if (!navToggle || !siteNav) {
        return;
    }

    const closeSubmenus = (): void => {
        siteNav.querySelectorAll<HTMLElement>('.has-submenu').forEach((item) => {
            item.classList.remove('is-open');
        });

        siteNav.querySelectorAll<HTMLButtonElement>('.submenu-toggle').forEach((toggle) => {
            toggle.setAttribute('aria-expanded', 'false');
        });
    };

    const closeNav = (): void => {
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

    siteNav.querySelectorAll<HTMLButtonElement>('.submenu-toggle').forEach((toggle) => {
        toggle.addEventListener('click', () => {
            if (window.innerWidth > 768) {
                return;
            }

            const parent = toggle.closest<HTMLElement>('.has-submenu');
            if (!parent) {
                return;
            }
            const isOpen = toggle.getAttribute('aria-expanded') === 'true';

            parent.classList.toggle('is-open', !isOpen);
            toggle.setAttribute('aria-expanded', String(!isOpen));
        });
    });

    siteNav.querySelectorAll<HTMLAnchorElement>('a').forEach((link) => {
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

// Fund index bar on showcase pages (the funds page). A sticky horizontal
// menu lists every fund; as the reader scrolls, the fund currently under
// the bar becomes active and a gilt marker slides to its menu entry.
// Plain sticky + rAF-throttled scroll tracking — identical behavior in
// every browser. Without JS the bar still works as plain anchor links.
(function (): void {
    const index = document.querySelector<HTMLElement>('.showcase-index');
    const funds = Array.from(document.querySelectorAll<HTMLElement>('.showcase-fund'));
    if (!index || funds.length === 0) {
        return;
    }

    const links = Array.from(index.querySelectorAll<HTMLAnchorElement>('a'));
    const marker = index.querySelector<HTMLElement>('.showcase-index-marker');
    const nav = document.getElementById('site-nav');

    // The bar docks under the nav — except on mobile, where the nav is
    // static (hamburger) and the bar docks at the very viewport top.
    // Tuck 1px under the opaque nav so no canvas sliver peeks through.
    const placeBar = (): void => {
        const sticky = nav && getComputedStyle(nav).position === 'sticky';
        const offset = sticky ? nav.getBoundingClientRect().height : 0;
        index.style.top = `${Math.max(0, Math.floor(offset) - 1)}px`;
    };

    let current = -1;
    const setActive = (i: number): void => {
        links.forEach((link, j) => link.classList.toggle('is-active', j === i));
        const link = links[i];
        if (marker && link) {
            marker.style.width = `${link.offsetWidth}px`;
            marker.style.transform = `translateX(${link.offsetLeft}px)`;
            marker.style.opacity = '1';
        }
    };

    // Active fund = the last one whose top has passed under the bar.
    const update = (): void => {
        const line = index.getBoundingClientRect().bottom + 1;
        let active = 0;
        funds.forEach((fund, i) => {
            if (fund.getBoundingClientRect().top <= line) {
                active = i;
            }
        });
        if (active !== current) {
            current = active;
            setActive(active);
        }
    };

    let ticking = false;
    const refresh = (): void => {
        if (ticking) {
            return;
        }
        ticking = true;
        requestAnimationFrame(() => {
            update();
            ticking = false;
        });
    };

    placeBar();
    update();
    window.addEventListener('scroll', refresh, { passive: true });
    window.addEventListener('resize', () => {
        placeBar();
        // Re-seat the marker for the new layout metrics.
        current = -1;
        refresh();
    });
    // Web fonts shift metrics after first paint — re-seat the marker.
    window.addEventListener('load', () => {
        current = -1;
        refresh();
    });
}());

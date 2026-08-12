// =============================================
// LAVIJU LANDING PAGE — JavaScript
// Scroll animations and nav behavior
// =============================================

(function () {
  'use strict';

  // Supabase Dashboard-generated recovery emails use the project's Site URL
  // because they cannot receive the admin app's redirectTo option. Forward
  // those callbacks from the public landing site to the admin reset form while
  // preserving the one-time recovery fragment.
  const authParameters = new URLSearchParams(window.location.hash.slice(1));
  const isRecoveryCallback = authParameters.get('type') === 'recovery';
  const isExpiredRecoveryCallback =
    authParameters.get('error') === 'access_denied' &&
    authParameters.get('error_code') === 'otp_expired';

  if (isRecoveryCallback || isExpiredRecoveryCallback) {
    const isLocalhost =
      window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const adminOrigin = isLocalhost ? 'http://localhost:5173' : 'https://admin.laviju.lt';
    window.location.replace(`${adminOrigin}/reset-password${window.location.hash}`);
    return;
  }

  // --- Navigation scroll effect ---
  const nav = document.getElementById('nav');

  function handleNavScroll() {
    const scrollY = window.scrollY;
    if (scrollY > 40) {
      nav.classList.add('nav--scrolled');
    } else {
      nav.classList.remove('nav--scrolled');
    }
  }

  window.addEventListener('scroll', handleNavScroll, { passive: true });
  handleNavScroll();

  // --- Mobile menu toggle ---
  const menuBtn = document.getElementById('nav-menu-btn');
  const mobileMenu = document.getElementById('mobile-menu');
  const navLogo = document.getElementById('nav-logo');
  const desktopNavLinks = document.getElementById('nav-links');
  const mobileMenuLinks = Array.from(mobileMenu.querySelectorAll('.mobile-menu__link'));
  const pageRegions = Array.from(document.body.children).filter(function (element) {
    return element !== nav && element !== mobileMenu && element.tagName !== 'SCRIPT';
  });
  let menuOpen = false;

  function setMenuOpen(nextOpen) {
    menuOpen = nextOpen;
    mobileMenu.classList.toggle('mobile-menu--open', menuOpen);
    mobileMenu.setAttribute('aria-hidden', String(!menuOpen));
    menuBtn.setAttribute('aria-expanded', String(menuOpen));
    menuBtn.setAttribute('aria-label', menuOpen ? 'Uždaryti meniu' : 'Atidaryti meniu');
    navLogo.inert = menuOpen;
    desktopNavLinks.inert = menuOpen;
    pageRegions.forEach(function (element) {
      element.inert = menuOpen;
    });

    const spans = menuBtn.querySelectorAll('span');
    if (menuOpen) {
      spans[0].style.transform = 'rotate(45deg) translate(5px, 5px)';
      spans[1].style.opacity = '0';
      spans[2].style.transform = 'rotate(-45deg) translate(5px, -5px)';
      document.body.style.overflow = 'hidden';
      window.requestAnimationFrame(function () {
        mobileMenuLinks[0]?.focus();
      });
    } else {
      spans[0].style.transform = '';
      spans[1].style.opacity = '';
      spans[2].style.transform = '';
      document.body.style.overflow = '';
    }
  }

  function toggleMenu() {
    setMenuOpen(!menuOpen);
  }

  menuBtn.addEventListener('click', toggleMenu);

  // Close mobile menu on link click
  mobileMenuLinks.forEach(function (link) {
    link.addEventListener('click', function () {
      if (menuOpen) setMenuOpen(false);
    });
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && menuOpen) {
      setMenuOpen(false);
      menuBtn.focus();
      return;
    }

    if (event.key === 'Tab' && menuOpen) {
      const focusableElements = [menuBtn].concat(mobileMenuLinks);
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }
  });

  window.addEventListener('resize', function () {
    if (window.innerWidth > 768 && menuOpen) {
      setMenuOpen(false);
    }
  });

  // --- Smooth scroll for nav links ---
  document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
    anchor.addEventListener('click', function (e) {
      const href = this.getAttribute('href');
      const target = href && href.length > 1 ? document.getElementById(href.slice(1)) : null;
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // --- Scroll reveal animations ---
  const revealElements = document.querySelectorAll(
    '.feature-card, .step, .domain-card, .contact__card, .contact__form-wrap, .section__header, .cta__inner'
  );

  revealElements.forEach(function (el) {
    el.classList.add('reveal');
  });

  if ('IntersectionObserver' in window) {
    const revealObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('reveal--visible');
            revealObserver.unobserve(entry.target);
          }
        });
      },
      {
        threshold: 0.1,
        rootMargin: '0px 0px -40px 0px',
      }
    );

    revealElements.forEach(function (el) {
      revealObserver.observe(el);
    });
  } else {
    revealElements.forEach(function (el) {
      el.classList.add('reveal--visible');
    });
  }

  // --- Active nav link highlight on scroll ---
  var sections = document.querySelectorAll('section[id]');
  var navLinks = document.querySelectorAll('.nav__link');

  function highlightNav() {
    var scrollY = window.scrollY + 100;

    sections.forEach(function (section) {
      var top = section.offsetTop;
      var height = section.offsetHeight;
      var id = section.getAttribute('id');

      if (scrollY >= top && scrollY < top + height) {
        navLinks.forEach(function (link) {
          link.classList.remove('nav__link--active');
          if (link.getAttribute('href') === '#' + id) {
            link.classList.add('nav__link--active');
          }
        });
      }
    });
  }

  window.addEventListener('scroll', highlightNav, { passive: true });
  highlightNav();
})();

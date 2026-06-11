// =============================================
// LAVIJU LANDING PAGE — JavaScript
// Scroll animations and nav behavior
// =============================================

(function () {
  'use strict';

  // --- Navigation scroll effect ---
  const nav = document.getElementById('nav');
  let lastScrollY = 0;

  function handleNavScroll() {
    const scrollY = window.scrollY;
    if (scrollY > 40) {
      nav.classList.add('nav--scrolled');
    } else {
      nav.classList.remove('nav--scrolled');
    }
    lastScrollY = scrollY;
  }

  window.addEventListener('scroll', handleNavScroll, { passive: true });

  // --- Mobile menu toggle ---
  const menuBtn = document.getElementById('nav-menu-btn');
  const mobileMenu = document.getElementById('mobile-menu');
  let menuOpen = false;

  function toggleMenu() {
    menuOpen = !menuOpen;
    mobileMenu.classList.toggle('mobile-menu--open', menuOpen);
    // Animate hamburger icon
    const spans = menuBtn.querySelectorAll('span');
    if (menuOpen) {
      spans[0].style.transform = 'rotate(45deg) translate(5px, 5px)';
      spans[1].style.opacity = '0';
      spans[2].style.transform = 'rotate(-45deg) translate(5px, -5px)';
      document.body.style.overflow = 'hidden';
    } else {
      spans[0].style.transform = '';
      spans[1].style.opacity = '';
      spans[2].style.transform = '';
      document.body.style.overflow = '';
    }
  }

  menuBtn.addEventListener('click', toggleMenu);

  // Close mobile menu on link click
  mobileMenu.querySelectorAll('.mobile-menu__link').forEach(function (link) {
    link.addEventListener('click', function () {
      if (menuOpen) toggleMenu();
    });
  });

  // --- Smooth scroll for nav links ---
  document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
    anchor.addEventListener('click', function (e) {
      const target = document.querySelector(this.getAttribute('href'));
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
          link.style.color = '';
          if (link.getAttribute('href') === '#' + id) {
            link.style.color = 'var(--primary)';
          }
        });
      }
    });
  }

  window.addEventListener('scroll', highlightNav, { passive: true });
})();

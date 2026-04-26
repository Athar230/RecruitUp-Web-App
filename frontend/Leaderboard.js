/*
 * Leaderboard.js
 * Small, dependency-free script to make filter dropdowns usable and accessible.
 * Behavior:
 *  - toggles menus referenced by buttons with aria-controls
 *  - updates aria-expanded state
 *  - keyboard support: Enter/Space open, ArrowDown/ArrowUp move within menu, Esc closes
 *  - click outside closes menus
 *  - emits a custom 'filter:change' event when an option is selected
 *
 * Usage:
 *  - Include this script on pages with .filter-dropdown buttons.
 *  - Buttons should have aria-controls pointing to the menu element id (menu should contain role="option" items)
 *  - Option elements should have [data-value] attributes (string) or textContent will be used.
 */
(function () {
  'use strict';

  const SELECTOR_BTN = '.filter-dropdown';
  const SELECTOR_OPTION = '[role="option"]';

  function isHidden(el) {
    return el.hasAttribute('hidden') || getComputedStyle(el).display === 'none';
  }

  function openMenu(btn, menu) {
    closeAllExcept(btn);
    btn.setAttribute('aria-expanded', 'true');
    menu.removeAttribute('hidden');
    menu.classList.add('open');
  }

  function closeMenu(btn, menu) {
    btn.setAttribute('aria-expanded', 'false');
    menu.setAttribute('hidden', '');
    menu.classList.remove('open');
  }

  function toggleMenu(btn, menu) {
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    if (expanded) closeMenu(btn, menu);
    else openMenu(btn, menu);
  }

  function closeAllExcept(exceptBtn = null) {
    document.querySelectorAll(SELECTOR_BTN + '[aria-expanded="true"]').forEach((otherBtn) => {
      if (otherBtn === exceptBtn) return;
      const id = otherBtn.getAttribute('aria-controls');
      if (!id) return;
      const menu = document.getElementById(id);
      if (menu) closeMenu(otherBtn, menu);
    });
  }

  function focusOption(options, index) {
    if (!options || !options.length) return;
    const i = Math.max(0, Math.min(index, options.length - 1));
    options[i].focus();
  }

  function registerButton(btn) {
    const menuId = btn.getAttribute('aria-controls');
    const menu = menuId ? document.getElementById(menuId) : btn.nextElementSibling;
    if (!menu) {
      // No menu found for button — nothing to do.
      return;
    }

    // Ensure the menu is initially hidden for assistive tech
    if (!menu.hasAttribute('hidden')) menu.setAttribute('hidden', '');

    // Ensure existing menu options are focusable; (we compute options dynamically)
    function ensureOptionsFocusable() {
      menu.querySelectorAll(SELECTOR_OPTION).forEach((opt) => {
        if (!opt.hasAttribute('tabindex')) opt.setAttribute('tabindex', '-1');
      });
    }
    ensureOptionsFocusable();

    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      toggleMenu(btn, menu);
    });

    btn.addEventListener('keydown', (ev) => {
      // Open on Enter/Space
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        toggleMenu(btn, menu);
        // focus first option if opening
        if (btn.getAttribute('aria-expanded') === 'true') focusOption(options, 0);
      }

      // Down arrow opens and focuses
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        if (btn.getAttribute('aria-expanded') !== 'true') openMenu(btn, menu);
        focusOption(options, 0);
      }

      // Up arrow opens and focuses last
      if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        if (btn.getAttribute('aria-expanded') !== 'true') openMenu(btn, menu);
        focusOption(options, options.length - 1);
      }
    });

    // Keyboard navigation inside menu (handles dynamic options)
    menu.addEventListener('keydown', (ev) => {
      const target = ev.target;
      const opts = Array.from(menu.querySelectorAll(SELECTOR_OPTION));
      const currentIndex = opts.indexOf(target);
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        focusOption(opts, currentIndex + 1);
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        focusOption(opts, currentIndex - 1);
      } else if (ev.key === 'Home') {
        ev.preventDefault();
        focusOption(opts, 0);
      } else if (ev.key === 'End') {
        ev.preventDefault();
        focusOption(opts, opts.length - 1);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        closeMenu(btn, menu);
        btn.focus();
      } else if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        if (target && target.matches(SELECTOR_OPTION)) {
          selectOption(btn, menu, target);
        }
      }
    });

    // Click on option -> select (delegation so we can change options dynamically)
    menu.addEventListener('click', (ev) => {
      const opt = ev.target.closest(SELECTOR_OPTION);
      if (!opt) return;
      ev.stopPropagation();
      selectOption(btn, menu, opt);
    });
  }

  function selectOption(btn, menu, optionEl) {
    // Determine a value and label for the selected option
    const value = optionEl.getAttribute('data-value') ?? optionEl.textContent.trim();
    const label = optionEl.textContent.trim();

    // If button has an inner .filter-label, update it (reflect selection visually)
    const labelEl = btn.querySelector('.filter-label');
    if (labelEl) labelEl.textContent = label;

    // Close menu
    closeMenu(btn, menu);
    btn.focus();

    // Dispatch a custom event with selection details
    const ev = new CustomEvent('filter:change', {
      bubbles: true,
      detail: { value, label, button: btn, menu: menu, option: optionEl }
    });
    btn.dispatchEvent(ev);
  }

  function init(root = document) {
    // Attach global click handler to close menus when clicking outside
    document.addEventListener('click', (ev) => {
      // If click outside any .filter-item, close all
      if (!ev.target.closest('.filter-item')) closeAllExcept(null);
    });

    // Close menus on Escape globally
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        closeAllExcept(null);
      }
    });

    // Register existing buttons
    root.querySelectorAll(SELECTOR_BTN).forEach(registerButton);

      // Add Reset Filters button logic
      const resetBtn = document.getElementById('reset-filters');
      if (resetBtn) {
        resetBtn.addEventListener('click', () => {
          // For each filter button, set its label to 'All' and select the 'All' option
          const btns = [
            { btn: document.querySelector('[aria-controls="filter-skills"]'), menu: document.getElementById('filter-skills'), label: 'All Assessments' },
            { btn: document.querySelector('[aria-controls="filter-companies"]'), menu: document.getElementById('filter-companies'), label: 'All Companies' },
            { btn: document.querySelector('[aria-controls="filter-category"]'), menu: document.getElementById('filter-category'), label: 'All Categories' },
            { btn: document.querySelector('[aria-controls="filter-level"]'), menu: document.getElementById('filter-level'), label: 'All Levels' }
          ];
          btns.forEach(({ btn, menu, label }) => {
            if (btn && menu) {
              // Find the 'all' option in the menu
              const allOpt = menu.querySelector('[data-value="all"]');
              if (allOpt) {
                // Update button label
                const labelEl = btn.querySelector('.filter-label');
                if (labelEl) labelEl.textContent = label;
                // Dispatch filter:change event
                const ev = new CustomEvent('filter:change', {
                  bubbles: true,
                  detail: { value: 'all', label, button: btn, menu, option: allOpt }
                });
                btn.dispatchEvent(ev);
              }
            }
          });
        });
      }

    // When a skill is selected, update category options accordingly
    document.addEventListener('filter:change', (ev) => {
      // The event bubbles from the skill button. We check which button/menu triggered it.
      try {
        const button = ev.detail.button;
        const controls = button && button.getAttribute('aria-controls');
        const selectedValue = ev.detail.value;
        if (controls === 'filter-skills') {
          // determine category menu
          const categoryMenu = document.getElementById('filter-category');
          if (!categoryMenu) return;

          // mapping: skill value => category options
          const mapping = {
            'recruiter-challenges': [
              { value: 'coding', label: 'Coding' },
              { value: 'situational-judgement', label: 'Situational Judgement' },
              { value: 'critical-thinking', label: 'Critical Thinking' }
            ],
            'psychometric-tests': [
              { value: 'logical', label: 'Logical' },
              { value: 'abstract', label: 'Abstract' },
              { value: 'numerical', label: 'Numerical' }
            ],
            // keep lower-level mappings available if a future change selects these directly
            coding: [
              { value: 'java', label: 'Java' },
              { value: 'python', label: 'Python' },
              { value: 'javascript', label: 'JavaScript' },
              { value: 'html', label: 'HTML' }
            ],
            'critical-thinking': [
              { value: 'logical-analysis', label: 'Logical Analysis' },
              { value: 'assumption-identification', label: 'Assumption Identification' },
              { value: 'argument-evaluation', label: 'Argument Evaluation' },
              { value: 'interpretation', label: 'Interpretation' },
              { value: 'evidence-use', label: 'Evidence Use' }
            ],
            'situational-judgement': [
              { value: 'communication-professional-interaction', label: 'Communication & Professional Interaction' },
              { value: 'teamwork-collaboration', label: 'Teamwork & Collaboration' },
              { value: 'prioritisation-time', label: 'Prioritisation & Time Management' },
              { value: 'ethical-professional-judgement', label: 'Ethical & Professional Judgement' }
            ]
          };

          // default categories when skill isn't in mapping
          const defaultCats = [
            { value: 'all', label: 'All Categories' },
            { value: 'logical', label: 'Logical' },
            { value: 'numerical', label: 'Numerical' },
            { value: 'verbal', label: 'Verbal' }
          ];

          const newOptions = mapping[selectedValue?.toLowerCase()] ?? defaultCats;

          // Clear existing menu items
          categoryMenu.innerHTML = '';
          newOptions.forEach((opt) => {
            const li = document.createElement('li');
            li.setAttribute('role', 'option');
            li.setAttribute('data-value', opt.value);
            li.setAttribute('tabindex', '-1');
            li.textContent = opt.label;
            categoryMenu.appendChild(li);
          });

          // If the category button exists, reset its label (prompt selection)
          const catBtn = document.querySelector('[aria-controls="filter-category"]');
          if (catBtn) {
            const labelEl = catBtn.querySelector('.filter-label');
            if (labelEl) labelEl.textContent = 'All Categories';
            // Also reset aria-expanded false and hide the menu if open
            catBtn.setAttribute('aria-expanded', 'false');
            categoryMenu.setAttribute('hidden', '');
          }
        }
      } catch (e) {
        // Defensive: ignore malformed events
        // console.error('filter:change handler error', e);
      }
    });
  }

  // Auto-initialize when the DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init(document));
  } else {
    init(document);
  }

  // Expose to window for manual control or tests
  window.LeaderboardFilters = { init, closeAllExcept };

})();

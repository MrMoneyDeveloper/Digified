(function () {
  'use strict';

  const segmentSettings = {
    internalOrgId: "{{settings.internal_org_id}}",
    tenantOrgId: "{{settings.tenant_org_id}}",
    internalTag: "{{settings.internal_tag}}",
    tenantTag: "{{settings.tenant_tag}}",
    internalFormId: "{{settings.internal_form_id}}",
    tenantFormId: "{{settings.tenant_form_id}}"
  };

  const helpCenterUser = (window.HelpCenter && window.HelpCenter.user) || {};

  /**
   * Determine if the current user is internal or tenant based on tags or organization IDs.
   * If neither tags nor organizations are available yet, return false so we can retry later.
   */
  function detectSegment() {
    const helpCenterUser = window.HelpCenter && window.HelpCenter.user;
    if (!helpCenterUser || (!helpCenterUser.tags && !helpCenterUser.organizations)) {
      console.info("[DigifiedSegments] HelpCenter.user not ready yet", helpCenterUser);
      return false;
    }

    const userTags = helpCenterUser.tags || [];
    const userOrganizations = helpCenterUser.organizations || [];

    const hasOrg = (orgId) => {
      if (!orgId) {
        return false;
      }
      return userOrganizations.some((org) => String(org.id) === String(orgId));
    };

    const isInternalUser =
      (segmentSettings.internalTag && userTags.includes(segmentSettings.internalTag)) ||
      hasOrg(segmentSettings.internalOrgId);
    const isTenantUser =
      (segmentSettings.tenantTag && userTags.includes(segmentSettings.tenantTag)) ||
      hasOrg(segmentSettings.tenantOrgId);

    // Expose for debugging
    window.DigifiedSegments = {
      isInternalUser,
      isTenantUser,
      hasOrg,
      userTags,
      userOrganizations
    };

    if (isInternalUser) {
      console.info("[DigifiedSegments] Internal user detected", {
        userTags,
        userOrganizations
      });
      document.documentElement.classList.add("hc-internal-user");
      document.documentElement.classList.remove("hc-tenant-user", "hc-unknown-user");
    } else if (isTenantUser) {
      console.info("[DigifiedSegments] Tenant user detected", {
        userTags,
        userOrganizations
      });
      document.documentElement.classList.add("hc-tenant-user");
      document.documentElement.classList.remove("hc-internal-user", "hc-unknown-user");
    } else {
      console.warn("[DigifiedSegments] Unknown user \u2013 no matching tag or org", {
        userTags,
        userOrganizations
      });
      document.documentElement.classList.add("hc-unknown-user");
      document.documentElement.classList.remove("hc-internal-user", "hc-tenant-user");
    }

    return true;
  }

  // Try to detect the segment immediately. If tags/orgs are not ready, retry for a short time.
  if (!detectSegment()) {
    let attempts = 0;
    const maxAttempts = 10;
    const retryInterval = setInterval(() => {
      attempts += 1;
      if (detectSegment() || attempts >= maxAttempts) {
        clearInterval(retryInterval);
      }
    }, 500);
  }

  // Key map
  const ENTER = 13;
  const ESCAPE = 27;

  function toggleNavigation(toggle, menu) {
    const isExpanded = menu.getAttribute("aria-expanded") === "true";
    menu.setAttribute("aria-expanded", !isExpanded);
    toggle.setAttribute("aria-expanded", !isExpanded);
  }

  function closeNavigation(toggle, menu) {
    menu.setAttribute("aria-expanded", false);
    toggle.setAttribute("aria-expanded", false);
    toggle.focus();
  }

  const hideUnknownNavItems = () => {
    const segments = window.DigifiedSegments || {};
    if (!segments.isInternalUser && !segments.isTenantUser) {
      const navItems = document.querySelectorAll(".nav-internal, .nav-tenant");
      navItems.forEach((item) => {
        item.style.display = "none";
      });
    }
  };

  function showSegmentHero() {
    const isSignedIn = !!(window.HelpCenter && window.HelpCenter.user);
    if (!isSignedIn) {
      return;
    }

    const internalHero = document.querySelector(".js-internal-hero");
    const tenantHero = document.querySelector(".js-tenant-hero");
    const genericHero = document.querySelector(".js-generic-hero");

    const hideAll = () => {
      [internalHero, tenantHero, genericHero].forEach((el) => {
        if (el) {
          el.classList.add("is-hidden");
        }
      });
    };

    hideAll();

    if (document.documentElement.classList.contains("hc-internal-user")) {
      if (internalHero) {
        internalHero.classList.remove("is-hidden");
      }
    } else if (document.documentElement.classList.contains("hc-tenant-user")) {
      if (tenantHero) {
        tenantHero.classList.remove("is-hidden");
      }
    } else {
      if (genericHero) {
        genericHero.classList.remove("is-hidden");
      }
    }
  }

  // Navigation

  window.addEventListener("DOMContentLoaded", () => {
    hideUnknownNavItems();
    showSegmentHero();
    const menuButton = document.querySelector(".header .menu-button-mobile");
    const menuList = document.querySelector("#user-nav-mobile");

    if (menuButton && menuList) {
      menuButton.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleNavigation(menuButton, menuList);
      });

      menuList.addEventListener("keyup", (event) => {
        if (event.keyCode === ESCAPE) {
          event.stopPropagation();
          closeNavigation(menuButton, menuList);
        }
      });
    }

    // Toggles expanded aria to collapsible elements
    const collapsible = document.querySelectorAll(
      ".collapsible-nav, .collapsible-sidebar"
    );

    collapsible.forEach((element) => {
      const toggle = element.querySelector(
        ".collapsible-nav-toggle, .collapsible-sidebar-toggle"
      );

      if (!toggle) {
        return;
      }

      element.addEventListener("click", () => {
        toggleNavigation(toggle, element);
      });

      element.addEventListener("keyup", (event) => {
        if (event.keyCode === ESCAPE) {
          closeNavigation(toggle, element);
        }
      });
    });

    // If multibrand search has more than 5 help centers or categories collapse the list
    const multibrandFilterLists = document.querySelectorAll(
      ".multibrand-filter-list"
    );
    multibrandFilterLists.forEach((filter) => {
      if (filter.children.length > 6) {
        const trigger = filter.querySelector(".see-all-filters");
        if (!trigger) {
          return;
        }

        trigger.setAttribute("aria-hidden", false);

        trigger.addEventListener("click", (event) => {
          event.stopPropagation();
          trigger.parentNode.removeChild(trigger);
          filter.classList.remove("multibrand-filter-list--collapsed");
        });
      }
    });

    (function () {
      if (!/\/requests\/new/.test(window.location.pathname)) {
        return;
      }

      const removeIneligibleForms = () => {
        if (!segmentSettings.internalFormId && !segmentSettings.tenantFormId) {
          return true;
        }

        const select = document.getElementById("request_issue_type_select");
        if (!select) {
          return false;
        }

        if (isInternalUser && segmentSettings.tenantFormId) {
          const tenantOption = select.querySelector(
            `option[value="${segmentSettings.tenantFormId}"]`
          );
          if (tenantOption) {
            tenantOption.remove();
          }
        } else if (isTenantUser && segmentSettings.internalFormId) {
          const internalOption = select.querySelector(
            `option[value="${segmentSettings.internalFormId}"]`
          );
          if (internalOption) {
            internalOption.remove();
          }
        }

        const selected = select.value;
        if (
          (isInternalUser && selected === segmentSettings.tenantFormId) ||
          (isTenantUser && selected === segmentSettings.internalFormId)
        ) {
          const nextId = isInternalUser
            ? segmentSettings.internalFormId
            : segmentSettings.tenantFormId;
          if (nextId) {
            select.value = nextId;
            const changeEvent = document.createEvent("HTMLEvents");
            changeEvent.initEvent("change", true, false);
            select.dispatchEvent(changeEvent);
          }
        }

        return true;
      };

      const ensureFormPruning = () => {
        if (removeIneligibleForms()) {
          return;
        }
        let attempts = 0;
        const interval = window.setInterval(() => {
          attempts += 1;
          if (removeIneligibleForms() || attempts > 20) {
            window.clearInterval(interval);
          }
        }, 150);
      };

      const params = new URLSearchParams(window.location.search);
      const lockedId = params.get("ticket_form_id");
      if (!lockedId || !/^\d+$/.test(lockedId)) {
        ensureFormPruning();
        return;
      }

      const hideChooser = () => {
        document.body.classList.add("ticket-form-locked", "form-locked");

        const wrap = document.querySelector(".request_ticket_form_id");
        if (wrap) {
          wrap.style.setProperty("display", "none", "important");
          wrap.classList.add("ticket-form-selector-hidden");
        }

        const formSelect = document.getElementById("request_issue_type_select");
        if (formSelect) {
          formSelect.style.setProperty("display", "none", "important");
          formSelect.setAttribute("aria-hidden", "true");
          formSelect.setAttribute("tabindex", "-1");
        }

        const formRow = document.getElementById("request_issue_type_row");
        if (formRow) {
          formRow.style.setProperty("display", "none", "important");
        }

        const formLabel = document.querySelector(
          "label[for='request_issue_type_select']"
        );
        if (formLabel) {
          formLabel.style.setProperty("display", "none", "important");
        }
      };

      const showChooser = () => {
        document.body.classList.remove("ticket-form-locked", "form-locked");

        const wrap = document.querySelector(".request_ticket_form_id");
        if (wrap) {
          wrap.style.removeProperty("display");
          wrap.classList.remove("ticket-form-selector-hidden");
        }

        const formSelect = document.getElementById("request_issue_type_select");
        if (formSelect) {
          formSelect.style.removeProperty("display");
          formSelect.removeAttribute("aria-hidden");
          formSelect.removeAttribute("tabindex");
        }

        const formRow = document.getElementById("request_issue_type_row");
        if (formRow) {
          formRow.style.removeProperty("display");
        }

        const formLabel = document.querySelector(
          "label[for='request_issue_type_select']"
        );
        if (formLabel) {
          formLabel.style.removeProperty("display");
        }
      };

      const setForm = () => {
        const formSelect = document.getElementById("request_issue_type_select");
        if (!formSelect || !formSelect.options.length) {
          return "pending";
        }

        const optionExists = Array.from(formSelect.options).some(
          (option) => option.value === lockedId
        );

        if (!optionExists) {
          showChooser();
          return "invalid";
        }

        if (formSelect.value !== lockedId) {
          formSelect.value = lockedId;
          formSelect.dispatchEvent(new Event("change", { bubbles: true }));
        }

        hideChooser();
        return "locked";
      };

      const initialStatus = setForm();

      if (initialStatus === "pending") {
        const observer = new MutationObserver(() => {
          const status = setForm();
          if (status !== "pending") {
            observer.disconnect();
          }
        });

        observer.observe(document.body, {
          childList: true,
          subtree: true,
        });
      }
      ensureFormPruning();
    })();
  });


  const isPrintableChar = (str) => {
    return str.length === 1 && str.match(/^\S$/);
  };

  function Dropdown(toggle, menu) {
    this.toggle = toggle;
    this.menu = menu;

    this.menuPlacement = {
      top: menu.classList.contains("dropdown-menu-top"),
      end: menu.classList.contains("dropdown-menu-end"),
    };

    this.toggle.addEventListener("click", this.clickHandler.bind(this));
    this.toggle.addEventListener("keydown", this.toggleKeyHandler.bind(this));
    this.menu.addEventListener("keydown", this.menuKeyHandler.bind(this));
    document.body.addEventListener("click", this.outsideClickHandler.bind(this));

    const toggleId = this.toggle.getAttribute("id") || crypto.randomUUID();
    const menuId = this.menu.getAttribute("id") || crypto.randomUUID();

    this.toggle.setAttribute("id", toggleId);
    this.menu.setAttribute("id", menuId);

    this.toggle.setAttribute("aria-controls", menuId);
    this.menu.setAttribute("aria-labelledby", toggleId);

    this.menu.setAttribute("tabindex", -1);
    this.menuItems.forEach((menuItem) => {
      menuItem.tabIndex = -1;
    });

    this.focusedIndex = -1;
  }

  Dropdown.prototype = {
    get isExpanded() {
      return this.toggle.getAttribute("aria-expanded") === "true";
    },

    get menuItems() {
      return Array.prototype.slice.call(
        this.menu.querySelectorAll("[role='menuitem'], [role='menuitemradio']")
      );
    },

    dismiss: function () {
      if (!this.isExpanded) return;

      this.toggle.removeAttribute("aria-expanded");
      this.menu.classList.remove("dropdown-menu-end", "dropdown-menu-top");
      this.focusedIndex = -1;
    },

    open: function () {
      if (this.isExpanded) return;

      this.toggle.setAttribute("aria-expanded", true);
      this.handleOverflow();
    },

    handleOverflow: function () {
      var rect = this.menu.getBoundingClientRect();

      var overflow = {
        right: rect.left < 0 || rect.left + rect.width > window.innerWidth,
        bottom: rect.top < 0 || rect.top + rect.height > window.innerHeight,
      };

      if (overflow.right || this.menuPlacement.end) {
        this.menu.classList.add("dropdown-menu-end");
      }

      if (overflow.bottom || this.menuPlacement.top) {
        this.menu.classList.add("dropdown-menu-top");
      }

      if (this.menu.getBoundingClientRect().top < 0) {
        this.menu.classList.remove("dropdown-menu-top");
      }
    },

    focusByIndex: function (index) {
      if (!this.menuItems.length) return;

      this.menuItems.forEach((item, itemIndex) => {
        if (itemIndex === index) {
          item.tabIndex = 0;
          item.focus();
        } else {
          item.tabIndex = -1;
        }
      });

      this.focusedIndex = index;
    },

    focusFirstMenuItem: function () {
      this.focusByIndex(0);
    },

    focusLastMenuItem: function () {
      this.focusByIndex(this.menuItems.length - 1);
    },

    focusNextMenuItem: function (currentItem) {
      if (!this.menuItems.length) return;

      const currentIndex = this.menuItems.indexOf(currentItem);
      const nextIndex = (currentIndex + 1) % this.menuItems.length;

      this.focusByIndex(nextIndex);
    },

    focusPreviousMenuItem: function (currentItem) {
      if (!this.menuItems.length) return;

      const currentIndex = this.menuItems.indexOf(currentItem);
      const previousIndex =
        currentIndex <= 0 ? this.menuItems.length - 1 : currentIndex - 1;

      this.focusByIndex(previousIndex);
    },

    focusByChar: function (currentItem, char) {
      char = char.toLowerCase();

      const itemChars = this.menuItems.map((menuItem) =>
        menuItem.textContent.trim()[0].toLowerCase()
      );

      const startIndex =
        (this.menuItems.indexOf(currentItem) + 1) % this.menuItems.length;

      // look up starting from current index
      let index = itemChars.indexOf(char, startIndex);

      // if not found, start from start
      if (index === -1) {
        index = itemChars.indexOf(char, 0);
      }

      if (index > -1) {
        this.focusByIndex(index);
      }
    },

    outsideClickHandler: function (e) {
      if (
        this.isExpanded &&
        !this.toggle.contains(e.target) &&
        !e.composedPath().includes(this.menu)
      ) {
        this.dismiss();
        this.toggle.focus();
      }
    },

    clickHandler: function (event) {
      event.stopPropagation();
      event.preventDefault();

      if (this.isExpanded) {
        this.dismiss();
        this.toggle.focus();
      } else {
        this.open();
        this.focusFirstMenuItem();
      }
    },

    toggleKeyHandler: function (e) {
      const key = e.key;

      switch (key) {
        case "Enter":
        case " ":
        case "ArrowDown":
        case "Down": {
          e.stopPropagation();
          e.preventDefault();

          this.open();
          this.focusFirstMenuItem();
          break;
        }
        case "ArrowUp":
        case "Up": {
          e.stopPropagation();
          e.preventDefault();

          this.open();
          this.focusLastMenuItem();
          break;
        }
        case "Esc":
        case "Escape": {
          e.stopPropagation();
          e.preventDefault();

          this.dismiss();
          this.toggle.focus();
          break;
        }
      }
    },

    menuKeyHandler: function (e) {
      const key = e.key;
      const currentElement = this.menuItems[this.focusedIndex];

      if (e.ctrlKey || e.altKey || e.metaKey) {
        return;
      }

      switch (key) {
        case "Esc":
        case "Escape": {
          e.stopPropagation();
          e.preventDefault();

          this.dismiss();
          this.toggle.focus();
          break;
        }
        case "ArrowDown":
        case "Down": {
          e.stopPropagation();
          e.preventDefault();

          this.focusNextMenuItem(currentElement);
          break;
        }
        case "ArrowUp":
        case "Up": {
          e.stopPropagation();
          e.preventDefault();
          this.focusPreviousMenuItem(currentElement);
          break;
        }
        case "Home":
        case "PageUp": {
          e.stopPropagation();
          e.preventDefault();
          this.focusFirstMenuItem();
          break;
        }
        case "End":
        case "PageDown": {
          e.stopPropagation();
          e.preventDefault();
          this.focusLastMenuItem();
          break;
        }
        case "Tab": {
          if (e.shiftKey) {
            e.stopPropagation();
            e.preventDefault();
            this.dismiss();
            this.toggle.focus();
          } else {
            this.dismiss();
          }
          break;
        }
        default: {
          if (isPrintableChar(key)) {
            e.stopPropagation();
            e.preventDefault();
            this.focusByChar(currentElement, key);
          }
        }
      }
    },
  };

  // Drodowns

  window.addEventListener("DOMContentLoaded", () => {
    const dropdowns = [];
    const dropdownToggles = document.querySelectorAll(".dropdown-toggle");

    dropdownToggles.forEach((toggle) => {
      const menu = toggle.nextElementSibling;
      if (menu && menu.classList.contains("dropdown-menu")) {
        dropdowns.push(new Dropdown(toggle, menu));
      }
    });
  });

  // Share

  window.addEventListener("DOMContentLoaded", () => {
    const links = document.querySelectorAll(".share a");
    links.forEach((anchor) => {
      anchor.addEventListener("click", (event) => {
        event.preventDefault();
        window.open(anchor.href, "", "height = 500, width = 500");
      });
    });
  });

  // Vanilla JS debounce function, by Josh W. Comeau:
  // https://www.joshwcomeau.com/snippets/javascript/debounce/
  function debounce(callback, wait) {
    let timeoutId = null;
    return (...args) => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        callback.apply(null, args);
      }, wait);
    };
  }

  // Define variables for search field
  let searchFormFilledClassName = "search-has-value";
  let searchFormSelector = "form[role='search']";

  // Clear the search input, and then return focus to it
  function clearSearchInput(event) {
    event.target
      .closest(searchFormSelector)
      .classList.remove(searchFormFilledClassName);

    let input;
    if (event.target.tagName === "INPUT") {
      input = event.target;
    } else if (event.target.tagName === "BUTTON") {
      input = event.target.previousElementSibling;
    } else {
      input = event.target.closest("button").previousElementSibling;
    }
    input.value = "";
    input.focus();
  }

  // Have the search input and clear button respond
  // when someone presses the escape key, per:
  // https://twitter.com/adambsilver/status/1152452833234554880
  function clearSearchInputOnKeypress(event) {
    const searchInputDeleteKeys = ["Delete", "Escape"];
    if (searchInputDeleteKeys.includes(event.key)) {
      clearSearchInput(event);
    }
  }

  // Create an HTML button that all users -- especially keyboard users --
  // can interact with, to clear the search input.
  // To learn more about this, see:
  // https://adrianroselli.com/2019/07/ignore-typesearch.html#Delete
  // https://www.scottohara.me/blog/2022/02/19/custom-clear-buttons.html
  function buildClearSearchButton(inputId) {
    const button = document.createElement("button");
    button.setAttribute("type", "button");
    button.setAttribute("aria-controls", inputId);
    button.classList.add("btn", "btn-outline-light", "clear-button");
    const buttonLabel = window.searchClearButtonLabelLocalized;
    const icon = `<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' focusable='false' role='img' viewBox='0 0 12 12' aria-label='${buttonLabel}'><path stroke='currentColor' stroke-linecap='round' stroke-width='2' d='M3 9l6-6m0 6L3 3'/></svg>`;
    button.innerHTML = icon;
    button.addEventListener("click", clearSearchInput);
    button.addEventListener("keyup", clearSearchInputOnKeypress);
    return button;
  }

  // Append the clear button to the search form
  function appendClearSearchButton(input, form) {
    const searchClearButton = buildClearSearchButton(input.id);
    const inputGroup = form.querySelector(".search-input-group");

    if (inputGroup) {
      const submitButton = inputGroup.querySelector("button[type='submit']");
      if (submitButton) {
        inputGroup.insertBefore(searchClearButton, submitButton);
      } else {
        inputGroup.append(searchClearButton);
      }
      inputGroup.classList.add("has-clear");
    } else {
      form.append(searchClearButton);
    }

    if (input.value.length > 0) {
      form.classList.add(searchFormFilledClassName);
    }
  }

  // Add a class to the search form when the input has a value;
  // Remove that class from the search form when the input doesn't have a value.
  // Do this on a delay, rather than on every keystroke.
  const toggleClearSearchButtonAvailability = debounce((event) => {
    const form = event.target.closest(searchFormSelector);
    form.classList.toggle(
      searchFormFilledClassName,
      event.target.value.length > 0
    );
  }, 200);

  // Search

  window.addEventListener("DOMContentLoaded", () => {
    // Set up clear functionality for the search field
    const searchForms = [...document.querySelectorAll(searchFormSelector)];
    const searchInputs = searchForms
      .map((form) => ({
        input: form.querySelector("input[type='search']"),
        form,
      }))
      .filter(({ input }) => input);

    searchInputs.forEach(({ input, form }) => {
      appendClearSearchButton(input, form);
      input.addEventListener("keyup", clearSearchInputOnKeypress);
      input.addEventListener("keyup", toggleClearSearchButtonAvailability);
    });
  });

  const key = "returnFocusTo";

  function saveFocus() {
    const activeElementId = document.activeElement.getAttribute("id");
    sessionStorage.setItem(key, "#" + activeElementId);
  }

  function returnFocus() {
    const returnFocusTo = sessionStorage.getItem(key);
    if (returnFocusTo) {
      sessionStorage.removeItem("returnFocusTo");
      const returnFocusToEl = document.querySelector(returnFocusTo);
      returnFocusToEl && returnFocusToEl.focus && returnFocusToEl.focus();
    }
  }

  // Forms

  window.addEventListener("DOMContentLoaded", () => {
    // In some cases we should preserve focus after page reload
    returnFocus();

    // show form controls when the textarea receives focus or back button is used and value exists
    const commentContainerTextarea = document.querySelector(
      ".comment-container textarea"
    );
    const commentContainerFormControls = document.querySelector(
      ".comment-form-controls, .comment-ccs"
    );

    if (commentContainerTextarea && commentContainerFormControls) {
      commentContainerTextarea.addEventListener(
        "focus",
        function focusCommentContainerTextarea() {
          commentContainerFormControls.style.display = "block";
          commentContainerTextarea.removeEventListener(
            "focus",
            focusCommentContainerTextarea
          );
        }
      );

      if (commentContainerTextarea.value !== "") {
        commentContainerFormControls.style.display = "block";
      }
    }

    // Expand Request comment form when Add to conversation is clicked
    const showRequestCommentContainerTrigger = document.querySelector(
      ".request-container .comment-container .comment-show-container"
    );
    const requestCommentFields = document.querySelectorAll(
      ".request-container .comment-container .comment-fields"
    );
    const requestCommentSubmit = document.querySelector(
      ".request-container .comment-container .request-submit-comment"
    );

    if (showRequestCommentContainerTrigger && requestCommentSubmit) {
      showRequestCommentContainerTrigger.addEventListener("click", () => {
        showRequestCommentContainerTrigger.style.display = "none";
        Array.prototype.forEach.call(requestCommentFields, (element) => {
          element.style.display = "block";
        });
        requestCommentSubmit.style.display = "inline-block";

        if (commentContainerTextarea) {
          commentContainerTextarea.focus();
        }
      });
    }

    // Mark as solved button
    const requestMarkAsSolvedButton = document.querySelector(
      ".request-container .mark-as-solved:not([data-disabled])"
    );
    const requestMarkAsSolvedCheckbox = document.querySelector(
      ".request-container .comment-container input[type=checkbox]"
    );
    const requestCommentSubmitButton = document.querySelector(
      ".request-container .comment-container input[type=submit]"
    );

    if (
      requestMarkAsSolvedButton &&
      requestMarkAsSolvedCheckbox &&
      requestCommentSubmitButton
    ) {
      requestMarkAsSolvedButton.addEventListener("click", () => {
        requestMarkAsSolvedCheckbox.setAttribute("checked", true);
        requestCommentSubmitButton.disabled = true;
        requestMarkAsSolvedButton.setAttribute("data-disabled", true);
        requestMarkAsSolvedButton.form.submit();
      });
    }

    // Change Mark as solved text according to whether comment is filled
    const requestCommentTextarea = document.querySelector(
      ".request-container .comment-container textarea"
    );

    const usesWysiwyg =
      requestCommentTextarea &&
      requestCommentTextarea.dataset.helper === "wysiwyg";

    function isEmptyPlaintext(s) {
      return s.trim() === "";
    }

    function isEmptyHtml(xml) {
      const doc = new DOMParser().parseFromString(`<_>${xml}</_>`, "text/xml");
      const img = doc.querySelector("img");
      return img === null && isEmptyPlaintext(doc.children[0].textContent);
    }

    const isEmpty = usesWysiwyg ? isEmptyHtml : isEmptyPlaintext;

    if (requestCommentTextarea) {
      requestCommentTextarea.addEventListener("input", () => {
        if (isEmpty(requestCommentTextarea.value)) {
          if (requestMarkAsSolvedButton) {
            requestMarkAsSolvedButton.innerText =
              requestMarkAsSolvedButton.getAttribute("data-solve-translation");
          }
        } else {
          if (requestMarkAsSolvedButton) {
            requestMarkAsSolvedButton.innerText =
              requestMarkAsSolvedButton.getAttribute(
                "data-solve-and-submit-translation"
              );
          }
        }
      });
    }

    const selects = document.querySelectorAll(
      "#request-status-select, #request-organization-select"
    );

    selects.forEach((element) => {
      element.addEventListener("change", (event) => {
        event.stopPropagation();
        saveFocus();
        element.form.submit();
      });
    });

    // Submit requests filter form on search in the request list page
    const quickSearch = document.querySelector("#quick-search");
    if (quickSearch) {
      quickSearch.addEventListener("keyup", (event) => {
        if (event.keyCode === ENTER) {
          event.stopPropagation();
          saveFocus();
          quickSearch.form.submit();
        }
      });
    }

    // Submit organization form in the request page
    const requestOrganisationSelect = document.querySelector(
      "#request-organization select"
    );

    if (requestOrganisationSelect) {
      requestOrganisationSelect.addEventListener("change", () => {
        requestOrganisationSelect.form.submit();
      });

      requestOrganisationSelect.addEventListener("click", (e) => {
        // Prevents Ticket details collapsible-sidebar to close on mobile
        e.stopPropagation();
      });
    }

    // If there are any error notifications below an input field, focus that field
    const notificationElm = document.querySelector(".notification-error");
    if (
      notificationElm &&
      notificationElm.previousElementSibling &&
      typeof notificationElm.previousElementSibling.focus === "function"
    ) {
      notificationElm.previousElementSibling.focus();
    }

    const form = document.querySelector("form#new_request");
    if (form) {
      form.addEventListener("submit", () => {
        window.setTimeout(() => {
          const notif = document.querySelector(".notification-error");
          if (notif) {
            console.error(
              "[HC form error]",
              (notif.textContent || notif.innerText || "").trim()
            );
          } else {
            console.log(
              "[HC form]",
              "Submitted without visible notification-error."
            );
          }
        }, 500);
      });
    }
  });

})();

(function () {
  const accordions = document.querySelectorAll(".policy-accordion details");
  if (!accordions.length) {
    return;
  }

  accordions.forEach((detail) => {
    const content = detail.querySelector(".policy-content");
    if (!content) {
      return;
    }

    const updateHeight = (open) => {
      if (open) {
        content.style.maxHeight = content.scrollHeight + "px";
      } else {
        content.style.maxHeight = "0px";
      }
    };

    updateHeight(detail.open);

    detail.addEventListener("toggle", () => {
      updateHeight(detail.open);
    });
  });
})();

(function () {
  var localePrefix = (window.location.pathname.match(/^\/hc\/[^\/]+/) || [""])[0];
  var path = window.location.pathname.replace(localePrefix, "");
  var isRequestsList =
    path === "/requests" ||
    path === "/requests/" ||
    /^\/requests\/(?!new)/.test(path);
  if (isRequestsList) {
    window.location.replace("{{#if settings.external_support_form_id}}{{page_path 'new_request' ticket_form_id=settings.external_support_form_id}}{{else}}{{page_path 'new_request' ticket_form_id=23381214703004}}{{/if}}");
  }
})();


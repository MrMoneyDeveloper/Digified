(function () {
  'use strict';

  (function setupGlobalPageLoader() {
    var minimumVisibleMs = 3000;
    var startedAt = Date.now();
    var pageLoaded = document.readyState === "complete";

    function hideLoaderWhenAllowed() {
      if (!pageLoaded) {
        return;
      }

      var elapsed = Date.now() - startedAt;
      var remaining = Math.max(0, minimumVisibleMs - elapsed);

      window.setTimeout(function () {
        var loader = document.getElementById("digify-global-loader");
        if (!loader) {
          return;
        }

        loader.classList.add("digify-global-loader--hidden");
        window.setTimeout(function () {
          if (loader && loader.parentNode) {
            loader.parentNode.removeChild(loader);
          }
        }, 350);
      }, remaining);
    }

    if (pageLoaded) {
      hideLoaderWhenAllowed();
    } else {
      window.addEventListener("load", function () {
        pageLoaded = true;
        hideLoaderWhenAllowed();
      }, { once: true });
    }
  })();

  const themeSettings =
    (window.HelpCenter && window.HelpCenter.themeSettings) || {};

  if (!window.DigifyBookingConfig) {
    window.DigifyBookingConfig = {
      getConfig: function (root) {
        const settings =
          (window.HelpCenter && window.HelpCenter.themeSettings) || {};
        const cfg = window.TRAINING_BOOKING_CFG || window.ROOM_BOOKING_CFG || {};
        const rootData = root && root.dataset ? root.dataset : {};
        const baseUrl =
          rootData.trainingBaseUrl ||
          rootData.roomBaseUrl ||
          cfg.baseUrl ||
          settings.training_api_url ||
          settings.room_booking_api_url ||
          settings.room_booking_api_base_url ||
          "";
        const apiKey =
          rootData.trainingApiKey ||
          rootData.roomApiKey ||
          cfg.apiKey ||
          settings.training_api_key ||
          settings.room_booking_api_key ||
          "";
        return {
          baseUrl: String(baseUrl || "").trim(),
          apiKey: String(apiKey || "").trim()
        };
      }
    };
  }

  const STAFF_SIGNUP_FORM = "23590656709788";
  const TENANT_SIGNUP_FORM = "23590702845724";
  const STAFF_SUPPORT_FORM = "22989127409436";
  const TENANT_SUPPORT_FORM = "23381214703004";
  const SIGNUP_FORMS = [STAFF_SIGNUP_FORM, TENANT_SIGNUP_FORM];

  const segmentSettings = {
    internalTag: themeSettings.internal_tag || "segment_internal",
    tenantTag: themeSettings.tenant_tag || "segment_tenant",
    managementTag: themeSettings.management_tag || "segment_management",
    internalOrgId: themeSettings.internal_org_id || "23530444315804",
    tenantOrgId: themeSettings.tenant_org_id || "23530712292892",
    managementOrgId: themeSettings.management_org_id || "",
    // Request form routing
    internalFormId: themeSettings.internal_request_form_id || STAFF_SUPPORT_FORM,
    tenantFormId: themeSettings.tenant_request_form_id || TENANT_SUPPORT_FORM,
  };

  const roomSettings = {
    internalBookingTag: themeSettings.room_booking_internal_tag || "",
  };

  window.isInternalUser = false;
  window.isTenantUser = false;
  window.isManagementUser = false;
  window.DigifiedSegments = {
    isInternalUser: false,
    isTenantUser: false,
    isManagementUser: false,
    userTags: [],
    orgIds: []
  };

  function detectSegment() {
    const user = (window.HelpCenter && window.HelpCenter.user) || null;
    const userTags = user && Array.isArray(user.tags) ? user.tags : [];
    const userOrgs =
      user && Array.isArray(user.organizations) ? user.organizations : [];
    const orgIds = userOrgs.map((org) => String(org.id));

    const isInternal =
      userTags.includes(segmentSettings.internalTag) ||
      orgIds.includes(segmentSettings.internalOrgId);
    const isTenant =
      userTags.includes(segmentSettings.tenantTag) ||
      orgIds.includes(segmentSettings.tenantOrgId);
    const isManagement =
      userTags.includes(segmentSettings.managementTag) ||
      (segmentSettings.managementOrgId &&
        orgIds.includes(segmentSettings.managementOrgId));

    let segmentClass = "hc-unknown-user";
    if (isManagement) {
      segmentClass = "hc-management-user";
    } else if (isInternal && !isTenant) {
      segmentClass = "hc-internal-user";
    } else if (isTenant && !isInternal) {
      segmentClass = "hc-tenant-user";
    }

    return {
      userTags,
      orgIds,
      isInternal,
      isTenant,
      isManagement,
      hasUser: !!user,
      segmentClass
    };
  }

  function applySegment(result) {
    document.documentElement.classList.remove(
      "hc-internal-user",
      "hc-tenant-user",
      "hc-management-user",
      "hc-unknown-user"
    );
    document.documentElement.classList.add(result.segmentClass);

    window.isInternalUser = result.isInternal;
    window.isTenantUser = result.isTenant;
    window.isManagementUser = result.isManagement;
    window.DigifiedSegments = {
      isInternalUser: result.isInternal,
      isTenantUser: result.isTenant,
      isManagementUser: result.isManagement,
      userTags: result.userTags,
      orgIds: result.orgIds
    };

    console.info("[DigifyCX Access Hub] Segment:", result.segmentClass, {
      userTags: result.userTags,
      orgIds: result.orgIds
    });

    hideUnknownNavItems();
  }

  function initSegments(attempt = 0) {
    const result = detectSegment();
    applySegment(result);
    if (!result.hasUser && attempt < 10) {
      window.setTimeout(() => initSegments(attempt + 1), 600);
    }
  }

  initSegments();

  (function enforceRoomBookingPath() {
    const match = (window.location.pathname || "").match(/^\/hc\/([^/]+)\/room_booking\/?$/);
    if (!match) {
      return;
    }

    const locale = match[1];
    const target = "/hc/" + locale + "/p/room_booking" + window.location.search + window.location.hash;
    window.location.replace(target);
  })();

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

  function hideUnknownNavItems() {
    const segments = window.DigifiedSegments || {};
    const internalItems = document.querySelectorAll(".nav-internal");
    const tenantItems = document.querySelectorAll(".nav-tenant");
    const managementItems = document.querySelectorAll(".nav-management");
    const unknownItems = document.querySelectorAll(".nav-unknown");

    if (
      !internalItems.length &&
      !tenantItems.length &&
      !managementItems.length &&
      !unknownItems.length
    ) {
      return;
    }

    const hide = (items) =>
      items.forEach((item) => {
        item.style.display = "none";
      });
    const show = (items) =>
      items.forEach((item) => {
        item.style.display = "block";
      });

    hide(internalItems);
    hide(tenantItems);
    hide(managementItems);
    hide(unknownItems);

    if (segments.isManagementUser) {
      show(managementItems);
      show(internalItems);
    } else if (segments.isInternalUser) {
      show(internalItems);
    } else if (segments.isTenantUser) {
      show(tenantItems);
    } else {
      show(unknownItems);
    }

    applyRoomVisibility(segments);
  }

  function applyRoomVisibility(segments) {
    const roomLinks = document.querySelectorAll(".nav-room-booking");
    if (!roomLinks.length) {
      return;
    }

    const requiredTag = roomSettings.internalBookingTag;
    if (!requiredTag) {
      return;
    }

    if (
      segments.isInternalUser &&
      !segments.isManagementUser &&
      !segments.userTags.includes(requiredTag)
    ) {
      roomLinks.forEach((item) => {
        if (item.classList.contains("nav-internal")) {
          item.style.display = "none";
        }
      });
    }
  }

  // Navigation

  window.addEventListener("DOMContentLoaded", () => {
    hideUnknownNavItems();
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

  });

  // Navigation dropdown toggle - stays open
  (function () {
    "use strict";

    document.addEventListener("DOMContentLoaded", function () {
      document.querySelectorAll(".dropdown-menu li").forEach((li) => {
        li.style.display = "block";
      });

      const dropdownToggle = document.querySelector(".dropdown-toggle");
      const dropdownMenu = document.querySelector(".dropdown-menu");
      const dropdown = document.querySelector(".dropdown");

      if (!dropdownToggle || !dropdownMenu) {
        console.warn("[Dropdown] Elements not found");
        return;
      }

      dropdownToggle.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();

        const isOpen = dropdownMenu.classList.contains("show");
        dropdownMenu.classList.toggle("show");
        dropdownToggle.setAttribute("aria-expanded", !isOpen);

        console.log("[Dropdown] Toggled:", !isOpen);
      });

      dropdown.addEventListener("mouseenter", function () {
        dropdownMenu.classList.add("show");
        dropdownToggle.setAttribute("aria-expanded", "true");
      });

      dropdown.addEventListener("mouseleave", function () {
        setTimeout(function () {
          dropdownMenu.classList.remove("show");
          dropdownToggle.setAttribute("aria-expanded", "false");
        }, 200);
      });

      dropdownMenu.addEventListener("click", function (e) {
        if (e.target.tagName === "A") {
          dropdownMenu.classList.remove("show");
        }
      });

      document.addEventListener("click", function (e) {
        if (!dropdown.contains(e.target)) {
          dropdownMenu.classList.remove("show");
          dropdownToggle.setAttribute("aria-expanded", "false");
        }
      });
    });
  })();

  // Filter Quick Links based on user segment
  (function () {
    "use strict";

    document.addEventListener("DOMContentLoaded", function () {
      setTimeout(function () {
        const segments = window.DigifiedSegments || {};
        console.log("[QuickLinks] Segment detection:", segments);

        const hide = (selector) => {
          document.querySelectorAll(selector).forEach((el) => {
            el.style.display = "none";
          });
        };
        const show = (selector) => {
          document.querySelectorAll(selector).forEach((el) => {
            el.style.display = "block";
          });
        };

        hide(".nav-internal, .nav-tenant, .nav-management, .nav-unknown");

        if (segments.isManagementUser) {
          show(".nav-management");
          show(".nav-internal");
          console.log("[QuickLinks] Showing management links");
        } else if (segments.isInternalUser) {
          show(".nav-internal");
          console.log("[QuickLinks] Showing internal links");
        } else if (segments.isTenantUser) {
          show(".nav-tenant");
          console.log("[QuickLinks] Showing tenant links");
        } else {
          show(".nav-unknown");
          console.log("[QuickLinks] Showing sign-up links (no segment detected)");
        }

        const roomTag =
          ((window.HelpCenter && window.HelpCenter.themeSettings) || {})
            .room_booking_internal_tag || "";
        if (roomTag && segments.isInternalUser && !segments.isManagementUser) {
          const hasRoomTag =
            Array.isArray(segments.userTags) &&
            segments.userTags.includes(roomTag);
          if (!hasRoomTag) {
            hide(".nav-room-booking.nav-internal");
          }
        }
      }, 500);
    });
  })();

  // Block untagged users from accessing support forms
  (function () {
    "use strict";

    // Only run on request pages
    if (!/\/hc\/.+\/requests\/new/.test(window.location.pathname)) {
      return;
    }

    document.addEventListener("DOMContentLoaded", function () {
      setTimeout(function () {
        const segments = window.DigifiedSegments || {};
        const urlParams = new URLSearchParams(window.location.search);
        const formId = urlParams.get("ticket_form_id");
        const signupForms = SIGNUP_FORMS;

        if (!formId) {
          return;
        }

        if (signupForms.includes(formId)) {
          return;
        }

        // Check if user is trying to access support forms without a segment
        if (!segments.isInternalUser && !segments.isTenantUser) {
          // Block access and redirect to home
          alert("Please complete the sign-up process before accessing support forms.");
          window.location.href = "/hc/en-us";
        }
      }, 500);
    });
  })();

  (function () {
    "use strict";

    // Only run on new request page
    if (!/\/requests\/new/.test(window.location.pathname)) {
      return;
    }

    function processForm() {
      const params = new URLSearchParams(window.location.search);
      const urlFormId = params.get("ticket_form_id");

      if (urlFormId) {
        return;
      }

      const segments = window.DigifiedSegments || {};
      const user = (window.HelpCenter && window.HelpCenter.user) || null;

      if (!user) {
        console.info("[Digified] Not signed in - no redirect needed");
        return;
      }

      if (segments.isInternalUser) {
        console.info("[Digified] Redirecting internal user to staff form");
        window.location.replace(
          `/hc/en-us/requests/new?ticket_form_id=${STAFF_SUPPORT_FORM}`
        );
      } else if (segments.isTenantUser) {
        console.info("[Digified] Redirecting tenant user to tenant form");
        window.location.replace(
          `/hc/en-us/requests/new?ticket_form_id=${TENANT_SUPPORT_FORM}`
        );
      }
    }

    setTimeout(processForm, 800);
  })();

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
      if (toggle.closest(".digify-header")) {
        return;
      }

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
  "use strict";

  // Only run on request pages
  if (!/\/hc\/.+\/requests\/new/.test(window.location.pathname)) {
    return;
  }

  function fixGardenDropdowns() {
    const fields = document.querySelectorAll(
      '[data-garden-id="dropdowns.combobox.field"]'
    );

    if (!fields.length) {
      return;
    }

    console.log("[DropdownFix] Checking combobox fields:", fields.length);

    fields.forEach((field) => {
      const label = field.querySelector(
        '[data-garden-id="dropdowns.combobox.label"]'
      );
      const trigger = field.querySelector(
        '[data-garden-id="dropdowns.combobox.trigger"]'
      );

      if (!label || !trigger) {
        return;
      }

      const text = (label.textContent || "").trim();

      // 1) Hide the form selector ("Please choose your issue below")
      if (text.includes("Please choose your issue")) {
        field.style.display = "none";
        console.log("[DropdownFix] Hiding form selector field");
        return;
      }

      // 2) Make all other dropdown triggers visible
      trigger.hidden = false;
      trigger.style.display = "";
      trigger.style.visibility = "";
      trigger.style.opacity = "";
      trigger.style.height = "";
      trigger.style.maxHeight = "";
      trigger.style.overflow = "";

      console.log("[DropdownFix] Unhid field dropdown with label:", text);
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    setTimeout(fixGardenDropdowns, 800);

    const observer = new MutationObserver(fixGardenDropdowns);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  });
})();

(function () {
  "use strict";

  if (!/\/hc\/.+\/requests\/new/.test(window.location.pathname)) {
    return;
  }

  document.addEventListener("DOMContentLoaded", function () {
    setTimeout(function () {
      const matches = Array.from(document.querySelectorAll("p")).filter(
        (p) =>
          p.textContent.trim() ===
          "Fields marked with an asterisk (*) are required."
      );

      if (matches.length > 1) {
        matches.slice(1).forEach((p) => {
          p.remove();
        });
        console.log(
          "[FormTextFix] Removed duplicate asterisk notes:",
          matches.length - 1
        );
      }
    }, 500);
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
function logFailure(img, phase) {
  console.warn("[DIGIFY-THEME] Image failed to load", {
    alt: img.alt,
    src: img.src,
    check: img.getAttribute("data-digify-check"),
    phase,
  });
}

  function handleFailure(img, phase) {
    logFailure(img, phase);
    img.classList.add("digify-image-error");
    img.setAttribute("aria-hidden", "true");
  }

  function watchImages() {
    const imgsToWatch = document.querySelectorAll("img[data-digify-check]");

    imgsToWatch.forEach((img) => {
      img.addEventListener("error", () => handleFailure(img, "error"));

      if (img.complete && img.naturalWidth === 0) {
        handleFailure(img, "initial");
      }
    });
  }

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", watchImages, { once: true });
  } else {
    watchImages();
  }
})();

(function () {
  "use strict";

  const path = window.location.pathname || "";
  if (!/\/hc\/[^/]+\/p\/room_booking/.test(path)) {
    return;
  }

  const root = document.getElementById("room-booking-root");
  if (!root) {
    return;
  }
  if (root.getAttribute("data-room-booking-version") === "v2") {
    return;
  }

  const settings = (window.HelpCenter && window.HelpCenter.themeSettings) || {};
  const cfg = window.ROOM_BOOKING_CFG || {};
  const baseUrl = (
    cfg.baseUrl ||
    settings.room_booking_api_url ||
    settings.room_booking_api_base_url ||
    ""
  ).trim();
  const apiKey = (cfg.apiKey || settings.room_booking_api_key || "").trim();
  const apiModeRaw = (cfg.mode || settings.room_booking_api_mode || "jsonp").trim();
  const apiMode = apiModeRaw.toLowerCase() === "fetch" ? "fetch" : "jsonp";
  const iframeUrl = (cfg.iframeUrl || settings.room_booking_iframe_url || "").trim();
  const user = (window.HelpCenter && window.HelpCenter.user) || {};

  const alertEl = document.getElementById("room-booking-alert");
  const filtersForm = document.getElementById("room-booking-filters");
  const fromInput = document.getElementById("room-from");
  const toInput = document.getElementById("room-to");
  const loadButton = document.getElementById("room-load");
  const resetButton = document.getElementById("room-reset");
  const resultsWrap = document.getElementById("room-booking-results");
  const fallbackWrap = document.getElementById("room-booking-fallback");
  const fallbackFrame = document.getElementById("room-booking-iframe");

  const modal = document.getElementById("room-booking-modal");
  const modalForm = document.getElementById("room-booking-form");
  const modalClose = document.getElementById("room-modal-close");
  const modalCancel = document.getElementById("room-modal-cancel");
  const slotLabel = document.getElementById("room-selected-slot");
  const slotIdInput = document.getElementById("room-slot-id");
  const requesterNameInput = document.getElementById("room-requester-name");
  const requesterEmailInput = document.getElementById("room-requester-email");
  const attendeesInput = document.getElementById("room-attendees");
  const deptInput = document.getElementById("room-dept");
  const notesInput = document.getElementById("room-notes");
  const bookSubmit = document.getElementById("room-book-submit");

  let cachedSessions = [];
  let activeSession = null;

  function setAlert(message, type) {
    if (!alertEl) {
      return;
    }

    alertEl.textContent = message;
    alertEl.className = "room-booking__alert";
    if (type) {
      alertEl.classList.add("room-booking__alert--" + type);
    }
    alertEl.hidden = false;
  }

  function clearAlert() {
    if (!alertEl) {
      return;
    }

    alertEl.textContent = "";
    alertEl.hidden = true;
    alertEl.className = "room-booking__alert";
  }

  function setDefaultDateRange() {
    if (!fromInput || !toInput) {
      return;
    }

    const today = new Date();
    const future = new Date();
    future.setDate(today.getDate() + 30);

    const toIso = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return year + "-" + month + "-" + day;
    };

    if (!fromInput.value) {
      fromInput.value = toIso(today);
    }

    if (!toInput.value) {
      toInput.value = toIso(future);
    }
  }

  function setLoading(isLoading) {
    if (!loadButton) {
      return;
    }

    loadButton.disabled = isLoading;
    loadButton.textContent = isLoading ? "Loading..." : "Load sessions";
  }

  function isNetworkError(error) {
    return (
      (error && error.name === "TypeError") ||
      (error &&
        typeof error.message === "string" &&
        error.message.indexOf("JSONP request") === 0)
    );
  }

  function apiErrorMessage(json) {
    if (!json || typeof json !== "object") {
      return "";
    }

    const statusCode = Number(json.statusCode);
    const hasStatus = !Number.isNaN(statusCode) && statusCode !== 0;
    const hasError = json.success === false || (hasStatus && statusCode !== 200);

    if (!hasError) {
      return "";
    }

    const code = json.code ? String(json.code) : "ERROR";
    const message = json.message ? String(json.message) : "Request failed.";
    const statusText = hasStatus ? " (status " + statusCode + ")" : "";
    return code + ": " + message + statusText;
  }

  function showIframeFallback() {
    if (!fallbackWrap || !fallbackFrame) {
      return;
    }

    const src = iframeUrl || (baseUrl ? baseUrl + "?action=ui" : "");
    if (!src) {
      return;
    }
    fallbackFrame.src = src;
    fallbackWrap.hidden = false;
  }

  function hideIframeFallback() {
    if (!fallbackWrap || !fallbackFrame) {
      return;
    }

    fallbackWrap.hidden = true;
    fallbackFrame.removeAttribute("src");
  }

  function buildUrl(action, params) {
    if (!baseUrl) {
      return "";
    }

    let url;
    try {
      url = new URL(baseUrl);
    } catch (error) {
      return "";
    }

    if (action) {
      url.searchParams.set("action", action);
    }

    if (params) {
      Object.keys(params).forEach((key) => {
        if (params[key]) {
          url.searchParams.set(key, params[key]);
        }
      });
    }

    if (apiKey) {
      url.searchParams.set("api_key", apiKey);
    }

    return url.toString();
  }

  function buildPostUrl() {
    if (!baseUrl) {
      return "";
    }

    try {
      const url = new URL(baseUrl);
      if (apiKey) {
        url.searchParams.set("api_key", apiKey);
      }
      return url.toString();
    } catch (error) {
      return "";
    }
  }

  function jsonpRequest(action, params) {
    return new Promise((resolve, reject) => {
      const callbackName =
        "roomJsonpCallback_" +
        Date.now() +
        "_" +
        Math.floor(Math.random() * 1000);
      const url = buildUrl(
        action,
        Object.assign({}, params, { callback: callbackName })
      );

      if (!url) {
        reject(new Error("Room API URL is invalid."));
        return;
      }

      const script = document.createElement("script");
      let timeoutId = null;

      function cleanup() {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        if (window[callbackName]) {
          delete window[callbackName];
        }
        if (script.parentNode) {
          script.parentNode.removeChild(script);
        }
      }

      window[callbackName] = function (data) {
        cleanup();
        resolve(data);
      };

      script.onerror = function () {
        cleanup();
        reject(new Error("JSONP request failed."));
      };

      timeoutId = setTimeout(function () {
        cleanup();
        reject(new Error("JSONP request timed out."));
      }, 15000);

      script.src = url;
      (document.head || document.body).appendChild(script);
    });
  }

  function createCell(text) {
    const cell = document.createElement("td");
    cell.textContent = text || "";
    return cell;
  }

  function formatTime(session) {
    const start = session.start_time || "";
    const end = session.end_time || "";
    if (start && end) {
      return start + " - " + end;
    }
    return start || end;
  }

  function formatSeats(session) {
    const capacity = Number(session.capacity);
    const booked = Number(session.booked_count);
    if (!Number.isNaN(capacity) && !Number.isNaN(booked)) {
      return booked + " / " + capacity;
    }
    if (!Number.isNaN(capacity)) {
      return String(capacity);
    }
    return "";
  }

  function sessionStatus(session) {
    if (session.available) {
      return "Open";
    }
    if (session.status === "cancelled") {
      return "Cancelled";
    }
    return "Full";
  }

  function renderPlaceholder(message) {
    if (!resultsWrap) {
      return;
    }
    resultsWrap.innerHTML =
      '<p class="room-booking__placeholder">' + message + "</p>";
  }

  function renderSessions(sessions) {
    if (!resultsWrap) {
      return;
    }

    if (!sessions.length) {
      renderPlaceholder("No sessions found for the selected range.");
      return;
    }

    const table = document.createElement("table");
    table.className = "table room-sessions";

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    ["Date", "Time", "Vendor", "Topic", "Seats", "Status", ""].forEach(
      (label) => {
        const th = document.createElement("th");
        th.textContent = label;
        headerRow.appendChild(th);
      }
    );
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    sessions.forEach((session) => {
      const row = document.createElement("tr");
      row.appendChild(createCell(session.date));
      row.appendChild(createCell(formatTime(session)));
      row.appendChild(createCell(session.vendor));
      row.appendChild(createCell(session.topic));
      row.appendChild(createCell(formatSeats(session)));
      row.appendChild(createCell(sessionStatus(session)));

      const actionCell = document.createElement("td");
      if (session.available && session.slot_id) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "btn btn-primary";
        button.textContent = "Book";
        button.addEventListener("click", function () {
          openModal(session);
        });
        actionCell.appendChild(button);
      } else {
        const status = document.createElement("span");
        status.className = "room-booking__disabled";
        status.textContent = "Unavailable";
        actionCell.appendChild(status);
      }
      row.appendChild(actionCell);
      tbody.appendChild(row);
    });
    table.appendChild(tbody);

    const wrapper = document.createElement("div");
    wrapper.className = "room-booking__table";
    wrapper.appendChild(table);

    resultsWrap.innerHTML = "";
    resultsWrap.appendChild(wrapper);
  }

  function openModal(session) {
    if (!modal || !modalForm) {
      return;
    }

    activeSession = session;
    if (slotIdInput) {
      slotIdInput.value = session.slot_id || "";
    }
    if (slotLabel) {
      slotLabel.textContent =
        session.date +
        " - " +
        formatTime(session) +
        (session.topic ? " - " + session.topic : "");
    }
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
  }

  function closeModal() {
    if (!modal) {
      return;
    }
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
  }

  function buildBookingPayload(includeAction) {
    const payload = {
      slot_id: slotIdInput ? slotIdInput.value : "",
      requester_email: requesterEmailInput ? requesterEmailInput.value.trim() : "",
      requester_name: requesterNameInput ? requesterNameInput.value.trim() : "",
      attendees: attendeesInput ? attendeesInput.value : "",
      dept: deptInput ? deptInput.value.trim() : "",
      notes: notesInput ? notesInput.value.trim() : "",
    };

    if (includeAction) {
      payload.action = "book";
    }

    return payload;
  }

  async function fetchSessions() {
    if (!baseUrl) {
      setAlert("Set Room API URL in theme settings.", "error");
      if (iframeUrl) {
        showIframeFallback();
      }
      return null;
    }

    if (!apiKey) {
      setAlert("Set Room API key in theme settings.", "error");
      if (iframeUrl) {
        showIframeFallback();
      }
      return null;
    }

    const from = fromInput ? fromInput.value : "";
    const to = toInput ? toInput.value : "";
    let json = null;

    if (apiMode === "jsonp") {
      json = await jsonpRequest("sessions", { from: from, to: to });
    } else {
      const url = buildUrl("sessions", { from: from, to: to });
      if (!url) {
        setAlert("Room API URL is invalid.", "error");
        return null;
      }

      const response = await fetch(url, {
        headers: { Accept: "application/json" },
      });
      try {
        json = await response.json();
      } catch (error) {
        json = null;
      }
      if (!response.ok) {
        const apiError = apiErrorMessage(json);
        if (apiError) {
          throw new Error(apiError);
        }
        throw new Error("Failed to load sessions (" + response.status + ").");
      }
    }

    const apiError = apiErrorMessage(json);
    if (apiError) {
      throw new Error(apiError);
    }

    if (json && json.data && Array.isArray(json.data.sessions)) {
      return json.data.sessions;
    }

    return [];
  }

  async function loadAndRender() {
    clearAlert();
    hideIframeFallback();
    setLoading(true);
    try {
      const sessions = await fetchSessions();
      if (sessions === null) {
        return;
      }
      cachedSessions = sessions;
      renderSessions(cachedSessions);
    } catch (error) {
      if (isNetworkError(error)) {
        setAlert(
          "Unable to reach the booking API. Showing the embedded view instead.",
          "error"
        );
        showIframeFallback();
        return;
      }
      setAlert(
        error && error.message
          ? error.message
          : "Unable to load sessions right now.",
        "error"
      );
    } finally {
      setLoading(false);
    }
  }

  async function submitBooking(event) {
    if (event) {
      event.preventDefault();
    }

    if (!baseUrl) {
      setAlert("Set Room API URL in theme settings.", "error");
      if (iframeUrl) {
        showIframeFallback();
      }
      return;
    }
    if (!apiKey) {
      setAlert("Set Room API key in theme settings.", "error");
      if (iframeUrl) {
        showIframeFallback();
      }
      return;
    }

    const payload = buildBookingPayload(apiMode !== "jsonp");
    if (!payload.slot_id) {
      setAlert("Please select a room slot.", "error");
      return;
    }

    if (!payload.requester_email || !payload.requester_name) {
      setAlert("Requester name and email are required.", "error");
      return;
    }

    const postUrl = buildPostUrl();
    if (!postUrl) {
      setAlert("Room API URL is invalid.", "error");
      return;
    }

    if (bookSubmit) {
      bookSubmit.disabled = true;
      bookSubmit.textContent = "Booking...";
    }

    try {
      let json = null;

      if (apiMode === "jsonp") {
        const jsonpPayload = buildBookingPayload(false);
        json = await jsonpRequest("book", jsonpPayload);
        const apiError = apiErrorMessage(json);
        if (apiError) {
          throw new Error(apiError);
        }
      } else {
        const response = await fetch(postUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        try {
          json = await response.json();
        } catch (error) {
          json = null;
        }

        if (!response.ok) {
          const apiError = apiErrorMessage(json);
          if (apiError) {
            throw new Error(apiError);
          }
          throw new Error("Booking failed.");
        }

        const apiError = apiErrorMessage(json);
        if (apiError) {
          throw new Error(apiError);
        }
      }

      const ticketId =
        json.data && json.data.zendesk && json.data.zendesk.ticket_id;
      setAlert(
        "Booking confirmed. Ticket " + (ticketId || "pending") + ".",
        "success"
      );
      closeModal();
      await loadAndRender();
    } catch (error) {
      if (isNetworkError(error)) {
        setAlert(
          "Unable to reach the booking API. Showing the embedded view instead.",
          "error"
        );
        showIframeFallback();
        return;
      }
      setAlert(
        error && error.message
          ? error.message
          : "Booking failed. Please try again.",
        "error"
      );
    } finally {
      if (bookSubmit) {
        bookSubmit.disabled = false;
        bookSubmit.textContent = "Confirm booking";
      }
    }
  }

  if (requesterNameInput && user.name) {
    requesterNameInput.value = user.name;
  }
  if (requesterEmailInput && user.email) {
    requesterEmailInput.value = user.email;
  }

  if (filtersForm) {
    filtersForm.addEventListener("submit", function (event) {
      event.preventDefault();
      loadAndRender();
    });
  }

  if (resetButton) {
    resetButton.addEventListener("click", function () {
      if (filtersForm) {
        filtersForm.reset();
      }
      setDefaultDateRange();
      clearAlert();
      hideIframeFallback();
      renderPlaceholder("Choose a date range and load sessions.");
    });
  }

  if (modalClose) {
    modalClose.addEventListener("click", closeModal);
  }
  if (modalCancel) {
    modalCancel.addEventListener("click", closeModal);
  }
  if (modalForm) {
    modalForm.addEventListener("submit", submitBooking);
  }

  setDefaultDateRange();
  loadAndRender();
})();

(function () {
  "use strict";

  /*
   * Digify Calendar API Module
   *
   * This module provides functions to interact with the room Calendar API.
   * It pulls the API URL/key from booking-config.js (with fallback support).
   * JSONP is used for browser requests to avoid CORS issues. You can still call
   * CalendarAPI.setMode("jsonp") to force JSONP explicitly.
   *
   * Usage (Help Center agent guide):
   * 1. Copy and paste this entire module into the browser console or a snippet
   *    runner on the help center.
   * 2. Use the functions to query or book sessions. Examples:
   *    - CalendarAPI.getSessions("2025-12-01", "2025-12-31").then(console.log).catch(console.error)
   *    - CalendarAPI.getCalendarSummary("2025-12-01", "2025-12-31").then(console.log).catch(console.error)
   *    - CalendarAPI.bookSlot("<slotId>", { requester_name: "Agent Name", requester_email: "agent@example.com", attendees: 1, user_type: "staff" }).then(console.log).catch(console.error)
   * 3. Check the console output for results or error messages.
   *    Errors are logged with "Calendar API error:".
   */

  function getConfig() {
    const configProvider = window.DigifyBookingConfig;
    if (configProvider && typeof configProvider.getConfig === "function") {
      const config = configProvider.getConfig();
      return {
        baseUrl: (config.baseUrl || "").trim(),
        apiKey: config.apiKey || ""
      };
    }

    const helpCenter = window.HelpCenter || {};
    const settings = helpCenter.themeSettings || {};
    const cfg = window.ROOM_BOOKING_CFG || {};
    const rawBaseUrl =
      cfg.baseUrl ||
      settings.room_booking_api_url ||
      settings.room_booking_api_base_url ||
      "";
    const rawApiKey = cfg.apiKey || settings.room_booking_api_key || "";
    return {
      baseUrl: (rawBaseUrl || "").trim(),
      apiKey: rawApiKey || ""
    };
  }

  let useJsonp = true;

  const errorMessages = {
    FAIL_SLOT_FULL: "Sorry, this session is now full.",
    FAIL_ALREADY_BOOKED: "You have already booked this session.",
    FAIL_INVALID_SLOT: "This session is no longer available.",
    FAIL_CANCELLED: "This session has been cancelled.",
    UNAUTHORIZED: "API key not accepted."
  };

  function setMode(mode) {
    const requested = typeof mode === "string" ? mode.toLowerCase() : "";
    if (requested && requested !== "jsonp") {
      console.warn(
        "[CalendarAPI] Fetch mode is not supported in the Help Center; using JSONP."
      );
    }
    useJsonp = true;
    console.log("[CalendarAPI] Mode set to:", "JSONP (no-CORS)");
  }

  function buildUrl(action, params) {
    const config = getConfig();
    if (!config.baseUrl || !config.apiKey) {
      return "";
    }
    let url;
    try {
      url = new URL(config.baseUrl);
    } catch (error) {
      return "";
    }
    if (action) {
      url.searchParams.set("action", action);
    }
    if (params && typeof params === "object") {
      Object.keys(params).forEach((key) => {
        if (params[key]) {
          url.searchParams.set(key, params[key]);
        }
      });
    }
    if (config.apiKey) {
      url.searchParams.set("api_key", config.apiKey);
    }
    return url.toString();
  }

  function jsonpRequest(action, params) {
    return new Promise((resolve, reject) => {
      const callbackName =
        "calApiJsonpCb_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
      const url = buildUrl(
        action,
        Object.assign({}, params, {
          callback: callbackName,
          _ts: Date.now()
        })
      );
      if (!url) {
        reject(
          new Error(
            "Room booking configuration is missing. Please contact support."
          )
        );
        return;
      }
      const script = document.createElement("script");
      let timeoutId = null;

      function cleanup() {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        if (window[callbackName]) {
          delete window[callbackName];
        }
        if (script.parentNode) {
          script.parentNode.removeChild(script);
        }
      }

      window[callbackName] = (data) => {
        cleanup();
        resolve(data);
      };

      script.onerror = () => {
        cleanup();
        reject(new Error("JSONP request failed."));
      };

      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error("JSONP request timed out."));
      }, 15000);

      script.src = url;
      (document.head || document.body).appendChild(script);
    });
  }

  function apiErrorMessage(json) {
    if (!json || typeof json !== "object") {
      return "";
    }
    const statusCode = Number(json.statusCode);
    const hasStatus = !Number.isNaN(statusCode) && statusCode !== 0;
    const isError = json.success === false || (hasStatus && statusCode !== 200);

    if (!isError) {
      return "";
    }

    const code = json.code ? String(json.code) : "";
    if (code && errorMessages[code]) {
      return errorMessages[code];
    }

    const message = json.message ? String(json.message) : "Request failed.";
    if (code) {
      return code + ": " + message;
    }
    if (hasStatus) {
      return message + " (status " + statusCode + ")";
    }
    return message;
  }


  async function getSessions(from, to) {
    try {
      if (!useJsonp) {
        setMode("jsonp");
      }
      const json = await jsonpRequest("sessions", { from: from, to: to });

      const apiErrMsg = apiErrorMessage(json);
      if (apiErrMsg) {
        throw new Error(apiErrMsg);
      }

      if (json && json.data && Array.isArray(json.data.sessions)) {
        return json.data.sessions;
      }
      return [];
    } catch (error) {
      console.error("Calendar API error:", error.message || error);
      throw error;
    }
  }

  async function getCalendarSummary(from, to) {
    try {
      if (!useJsonp) {
        setMode("jsonp");
      }
      const json = await jsonpRequest("summary", { from: from, to: to });

      const apiErrMsg = apiErrorMessage(json);
      if (apiErrMsg) {
        throw new Error(apiErrMsg);
      }

      if (json && json.data && json.data.summary) {
        return json.data.summary;
      }
      return {};
    } catch (error) {
      console.error("Calendar API error:", error.message || error);
      throw error;
    }
  }

  async function bookSlot(slotId, userInfo) {
    try {
      if (!slotId) {
        throw new Error("Slot ID is required to book a session.");
      }

      const info = userInfo || {};
      const payload = {
        slot_id: slotId,
        requester_name: info.requester_name || "",
        requester_email: info.requester_email || "",
        attendees: info.attendees ? String(info.attendees) : "",
        user_type: info.user_type || "",
        notes: info.notes || ""
      };

      if (!payload.requester_name) {
        throw new Error("Requester name is required.");
      }
      if (!payload.requester_email) {
        throw new Error("Requester email is required.");
      }
      const numAttendees = parseInt(payload.attendees, 10);
      if (!(numAttendees >= 1)) {
        throw new Error("Attendees must be at least 1.");
      }
      if (!payload.user_type) {
        throw new Error("User type is required.");
      }

      if (!useJsonp) {
        setMode("jsonp");
      }

      const json = await jsonpRequest("book", payload);
      const apiErrMsg = apiErrorMessage(json);
      if (apiErrMsg) {
        throw new Error(apiErrMsg);
      }

      return json && json.data ? json.data : json;
    } catch (error) {
      console.error("Calendar API error:", error.message || error);
      throw error;
    }
  }

  window.CalendarAPI = {
    setMode: setMode,
    getSessions: getSessions,
    getCalendarSummary: getCalendarSummary,
    bookSlot: bookSlot
  };
})();



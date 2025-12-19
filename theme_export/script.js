(function () {
  'use strict';

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

  // Navigation

  window.addEventListener("DOMContentLoaded", () => {
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
  });

})();

(function () {
  "use strict";

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

      if (text.includes("Please choose your issue")) {
        field.style.display = "none";
        console.log("[DropdownFix] Hiding form selector field");
        return;
      }

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

(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () {
    var trainingLinks = document.querySelectorAll("[data-training-booking-link]");
    if (!trainingLinks.length) {
      console.info("[TrainingBooking] No nav link found on this page.");
      return;
    }

    trainingLinks.forEach(function (link) {
      link.addEventListener("click", function (event) {
        console.info("[TrainingBooking] Nav click", {
          href: link.getAttribute("href"),
          currentPath: window.location.pathname,
          currentSearch: window.location.search,
          signedIn: Boolean(window.HelpCenter && window.HelpCenter.user),
          linkTarget: link.getAttribute("data-training-booking-link"),
          defaultPrevented: event.defaultPrevented
        });
      });
    });
  });
})();

(function () {
  "use strict";

  const path = window.location.pathname || "";
  if (!/\/hc\/[^/]+\/p\/training_booking/.test(path)) {
    return;
  }

  const root = document.getElementById("training-booking-root");
  if (!root) {
    return;
  }

  const settings = (window.HelpCenter && window.HelpCenter.themeSettings) || {};
  const cfg = window.TRAINING_BOOKING_CFG || {};
  const baseUrl = (cfg.baseUrl || settings.training_api_base_url || "").trim();
  const apiKey = (cfg.apiKey || settings.training_api_key || "").trim();
  const user = (window.HelpCenter && window.HelpCenter.user) || {};

  const alertEl = document.getElementById("training-booking-alert");
  const filtersForm = document.getElementById("training-booking-filters");
  const fromInput = document.getElementById("training-from");
  const toInput = document.getElementById("training-to");
  const loadButton = document.getElementById("training-load");
  const resetButton = document.getElementById("training-reset");
  const resultsWrap = document.getElementById("training-booking-results");
  const fallbackWrap = document.getElementById("training-booking-fallback");
  const fallbackFrame = document.getElementById("training-booking-iframe");

  const modal = document.getElementById("training-booking-modal");
  const modalForm = document.getElementById("training-booking-form");
  const modalClose = document.getElementById("training-modal-close");
  const modalCancel = document.getElementById("training-modal-cancel");
  const slotLabel = document.getElementById("training-selected-slot");
  const slotIdInput = document.getElementById("training-slot-id");
  const requesterNameInput = document.getElementById("training-requester-name");
  const requesterEmailInput = document.getElementById("training-requester-email");
  const attendeesInput = document.getElementById("training-attendees");
  const deptInput = document.getElementById("training-dept");
  const notesInput = document.getElementById("training-notes");
  const bookSubmit = document.getElementById("training-book-submit");

  let cachedSessions = [];
  let activeSession = null;

  function setAlert(message, type) {
    if (!alertEl) {
      return;
    }

    alertEl.textContent = message;
    alertEl.className = "training-booking__alert";
    if (type) {
      alertEl.classList.add("training-booking__alert--" + type);
    }
    alertEl.hidden = false;
  }

  function clearAlert() {
    if (!alertEl) {
      return;
    }

    alertEl.textContent = "";
    alertEl.hidden = true;
    alertEl.className = "training-booking__alert";
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
    return error && error.name === "TypeError";
  }

  function showIframeFallback() {
    if (!fallbackWrap || !fallbackFrame || !baseUrl) {
      return;
    }

    fallbackFrame.src = baseUrl + "?action=ui";
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
      '<p class="training-booking__placeholder">' + message + "</p>";
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
    table.className = "table training-sessions";

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
        status.className = "training-booking__disabled";
        status.textContent = "Unavailable";
        actionCell.appendChild(status);
      }
      row.appendChild(actionCell);
      tbody.appendChild(row);
    });
    table.appendChild(tbody);

    const wrapper = document.createElement("div");
    wrapper.className = "training-booking__table";
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

  function buildBookingPayload() {
    return {
      action: "book",
      slot_id: slotIdInput ? slotIdInput.value : "",
      requester_email: requesterEmailInput ? requesterEmailInput.value.trim() : "",
      requester_name: requesterNameInput ? requesterNameInput.value.trim() : "",
      attendees: attendeesInput ? attendeesInput.value : "",
      dept: deptInput ? deptInput.value.trim() : "",
      notes: notesInput ? notesInput.value.trim() : "",
    };
  }

  async function fetchSessions() {
    if (!baseUrl) {
      setAlert("Set Training API base URL in theme settings.", "error");
      return [];
    }

    const from = fromInput ? fromInput.value : "";
    const to = toInput ? toInput.value : "";
    const url = buildUrl("sessions", { from: from, to: to });
    if (!url) {
      setAlert("Training API URL is invalid.", "error");
      return [];
    }

    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      throw new Error("Failed to load sessions (" + response.status + ").");
    }

    const json = await response.json();
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
      cachedSessions = await fetchSessions();
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
      setAlert("Set Training API base URL in theme settings.", "error");
      return;
    }

    const payload = buildBookingPayload();
    if (!payload.slot_id) {
      setAlert("Please select a training slot.", "error");
      return;
    }

    if (!payload.requester_email || !payload.requester_name) {
      setAlert("Requester name and email are required.", "error");
      return;
    }

    const postUrl = buildPostUrl();
    if (!postUrl) {
      setAlert("Training API URL is invalid.", "error");
      return;
    }

    if (bookSubmit) {
      bookSubmit.disabled = true;
      bookSubmit.textContent = "Booking...";
    }

    try {
      const response = await fetch(postUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await response.json();

      if (!response.ok || !json || !json.success) {
        const message = (json && json.message) || "Booking failed.";
        throw new Error(message);
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


(function () {
  "use strict";

  document.documentElement.classList.add("digify-enhanced");

  document.addEventListener("alpine:init", function () {
    if (!window.Alpine || typeof window.Alpine.data !== "function") return;

    window.Alpine.data("digifyHeader", function () {
      return {
        open: false,

        init: function () {
          this.open = Boolean(this.$el && this.$el.open);
        },

        sync: function () {
          this.open = Boolean(this.$el && this.$el.open);
        },

        close: function () {
          if (!this.$el) return;
          this.$el.open = false;
          this.open = false;
        },

        closeAndFocus: function () {
          this.close();
          if (this.$refs && this.$refs.toggle) {
            this.$refs.toggle.focus();
          }
        }
      };
    });
  });
})();

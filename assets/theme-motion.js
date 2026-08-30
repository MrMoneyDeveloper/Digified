(function () {
  "use strict";

  function startMotion() {
    if (!window.gsap || typeof window.gsap.matchMedia !== "function") return;

    const saveData = Boolean(
      navigator.connection && navigator.connection.saveData
    );
    if (saveData) return;

    const motionMedia = window.gsap.matchMedia();

    motionMedia.add(
      {
        allowMotion: "(prefers-reduced-motion: no-preference)",
        compact: "(max-width: 39.999rem)"
      },
      function (context) {
        if (!context.conditions.allowMotion) return undefined;

        const compact = context.conditions.compact;
        const heroTargets = Array.from(
          document.querySelectorAll(
            "[data-digify-motion='hero'], .digify-hero__content, .tb-hero"
          )
        );

        heroTargets.forEach(function (target) {
          window.gsap.from(target.children.length ? target.children : target, {
            autoAlpha: 0,
            y: compact ? 18 : 28,
            duration: compact ? 0.48 : 0.68,
            stagger: compact ? 0.045 : 0.075,
            ease: "power3.out",
            clearProps: "opacity,visibility,transform"
          });
        });

        const revealTargets = Array.from(
          document.querySelectorAll(
            [
              "[data-digify-motion='reveal']",
              ".landing-card",
              ".digify-card",
              ".policy-card",
              ".blocks-item",
              ".search-result-list-item",
              ".posts-list .striped-list-item",
              ".topics-item",
              ".tb-guide__card",
              ".tb-app"
            ].join(",")
          )
        ).filter(function (target, index, all) {
          return (
            all.indexOf(target) === index &&
            !target.closest("[hidden]") &&
            !(target.parentElement && target.parentElement.hasAttribute("data-digify-motion-stagger"))
          );
        });

        const staggerGroups = Array.from(
          document.querySelectorAll("[data-digify-motion-stagger]")
        ).filter(function (group) {
          return !group.closest("[hidden]");
        });

        if (!("IntersectionObserver" in window)) {
          return undefined;
        }

        const observer = new IntersectionObserver(
          function (entries) {
            entries.forEach(function (entry) {
              if (!entry.isIntersecting) return;
              observer.unobserve(entry.target);

              if (entry.target.hasAttribute("data-digify-motion-stagger")) {
                window.gsap.from(entry.target.children, {
                  autoAlpha: 0,
                  y: compact ? 12 : 20,
                  duration: compact ? 0.4 : 0.56,
                  stagger: compact ? 0.04 : 0.075,
                  ease: "power2.out",
                  clearProps: "opacity,visibility,transform"
                });
                return;
              }

              window.gsap.from(entry.target, {
                autoAlpha: 0,
                y: compact ? 14 : 22,
                scale: compact ? 1 : 0.985,
                duration: compact ? 0.42 : 0.58,
                ease: "power2.out",
                clearProps: "opacity,visibility,transform"
              });
            });
          },
          { rootMargin: "0px 0px -8%", threshold: 0.12 }
        );

        revealTargets.forEach(function (target) {
          observer.observe(target);
        });
        staggerGroups.forEach(function (group) {
          observer.observe(group);
        });

        return function () {
          observer.disconnect();
        };
      }
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startMotion, { once: true });
  } else {
    startMotion();
  }
})();

/* addons/dev-testbench.js
   Stubbed dev testbench addon restored during cleanup. Replace with the original
   implementation if more extensive tooling is needed. */
(function () {
  function register() {
    const K = window.KQuiz;
    if (!K || typeof K.addAddon !== "function") return;

    const manifest = {
      id: "dev-testbench",
      name: "Dev Testbench",
      description: "Lightweight console helper for development sanity checks.",
      author: "Cleanup Stub",
      defaultEnabled: false,
      enable() {
        console.info("[kquiz][dev-testbench] enabled");
      },
      disable() {
        console.info("[kquiz][dev-testbench] disabled");
      }
    };

    try {
      K.addAddon(manifest);
    } catch (err) {
      console.error("[kquiz][dev-testbench] failed to register", err);
    }
  }

  if (window.KQuiz && typeof window.KQuiz.addAddon === "function") {
    register();
  } else {
    window.addEventListener("kquiz:ready", register, { once: true });
  }
})();


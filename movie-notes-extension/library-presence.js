// Shared by declarative and toolbar-injected content scripts.
(() => {
  globalThis.__asideLibraryPresence = function createLibraryPresence(close, delay = 120) {
    let open = false, entered = false, inside = false, pinned = false, interacting = false, timer;
    const cancel = () => { clearTimeout(timer); timer = undefined; };
    const schedule = () => {
      cancel();
      if (!open || !entered || inside || pinned || interacting) return;
      timer = setTimeout(() => { timer = undefined; open = false; close(); }, delay);
    };
    return {
      open() { cancel(); open = true; entered = false; inside = false; },
      close() { cancel(); open = false; },
      enter() { if (!open) return; entered = inside = true; cancel(); },
      leave() { inside = false; schedule(); },
      pin(value) { pinned = value === true; schedule(); },
      interact(value) { interacting = value === true; schedule(); }
    };
  };
})();

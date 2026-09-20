import { createPortal as createReactPortal } from 'react-dom';
export * from 'react-dom';

let host;

function getPortalHost() {
  if (host) return host;

  // Keep React's portal container stable while moving it into/out of a modal.
  // A modal makes siblings inert. A nested manual popover stays interactive and
  // escapes the dialog's scrolling, clipping, and backdrop-filter coordinates.
  host = document.createElement('div');
  host.className = 'aside-agentation-layer';
  host.dataset.feedbackToolbar = '';
  host.setAttribute('popover', 'manual');
  const style = document.createElement('style');
  style.textContent = `
    .aside-agentation-layer { display: contents; }
    .aside-agentation-layer[popover] {
      position: fixed; inset: 0; width: 100vw; height: 100dvh;
      max-width: none; max-height: none; margin: 0; padding: 0;
      border: 0; background: transparent; overflow: visible;
      pointer-events: none;
    }
    .aside-agentation-layer[popover]:popover-open { display: block; }
    .aside-agentation-layer::backdrop { background: transparent; pointer-events: none; }
    .aside-agentation-layer > [data-agentation-root] { pointer-events: auto; }
  `;
  document.head.append(style);
  document.body.append(host);

  const sync = () => {
    const modal = [...document.querySelectorAll('dialog:modal')].at(-1);
    const target = modal || document.body;
    if (host.parentElement === target && host.matches(':popover-open')) return;
    if (host.matches(':popover-open')) host.hidePopover();
    if (host.parentElement !== target) target.append(host);
    // Always use the top layer: real content-script surfaces use the maximum z-index.
    host.showPopover();
  };
  new MutationObserver(sync).observe(document.body, {
    subtree: true, childList: true, attributes: true, attributeFilter: ['open'],
  });
  // Escape first dismisses Agentation's own UI, before closing the help dialog.
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !host.closest('dialog:modal')) return;
    const toolbar = host.querySelector('[data-agentation-toolbar]');
    if (toolbar && !toolbar.querySelector('[title="Start feedback mode"]')) {
      event.preventDefault();
    }
  }, true);
  sync();
  return host;
}

// This module replaces react-dom only for Agentation imports in the dev bundle.
// All other react-dom APIs, and portals targeting a specific element, are preserved.
export function createPortal(children, container, key) {
  return createReactPortal(children, container === document.body ? getPortalHost() : container, key);
}

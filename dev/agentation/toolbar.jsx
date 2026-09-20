import React from 'react';
import { createRoot } from 'react-dom/client';
import { Agentation } from 'agentation';

// This entry is injected by the loopback-only development server, never by release HTML.
if (['127.0.0.1', 'localhost'].includes(location.hostname)) {
  const root = document.createElement('div');
  root.id = 'aside-agentation-root';
  document.body.append(root);
  const style = document.createElement('style');
  style.textContent = `
    [data-agentation-root] {cursor:auto;}
    .aside-annotation-toolbar {bottom:84px!important;}
    [data-agentation-root] button:focus-visible {
      outline:2px solid transparent!important;outline-offset:3px!important;
      border-radius:20px!important;
      box-shadow:0 0 0 2px #302a3b,0 0 0 4px #ddd0ef,0 0 0 7px #ddd0ef22!important;
    }
    @media(forced-colors:active){[data-agentation-root] button:focus-visible{outline:2px solid Highlight!important;}}
  `;
  document.head.append(style);
  createRoot(root).render(
    <Agentation className="aside-annotation-toolbar" endpoint="http://localhost:4747" copyToClipboard={false} />,
  );
}

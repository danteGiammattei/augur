import React from "react";
import { createRoot } from "react-dom/client";
import AUGUR from "./App.jsx";

/* The game persists progress through a small async key/value API (window.storage).
   In a normal browser we back it with localStorage so accounts/collections survive
   reloads. Swap this out for a fetch() to a Cloudflare Worker + D1 later for real
   cross-device accounts — the call sites in App.jsx won't need to change. */
if (!window.storage) {
  window.storage = {
    async get(key) {
      try { const v = localStorage.getItem(key); return v == null ? null : { key, value: v }; }
      catch (e) { return null; }
    },
    async set(key, value) {
      try { localStorage.setItem(key, value); } catch (e) {}
      return { key, value };
    },
    async delete(key) {
      try { localStorage.removeItem(key); } catch (e) {}
      return { key, deleted: true };
    },
    async list(prefix = "") {
      const keys = [];
      try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(prefix)) keys.push(k); } } catch (e) {}
      return { keys };
    },
  };
}

createRoot(document.getElementById("root")).render(<AUGUR />);

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const configSource = readFileSync(new URL("../../../js/config.js", import.meta.url), "utf8");

function loadConfig(url, initialStorage = {}) {
  const values = new Map(Object.entries(initialStorage));
  const location = new URL(url);
  location.assign = () => {};
  location.replace = () => {};
  const window = { location };
  window.top = window;
  const context = vm.createContext({
    URL,
    URLSearchParams,
    AbortController,
    Uint8Array,
    Promise,
    Error,
    Object,
    String,
    console,
    crypto: webcrypto,
    btoa,
    fetch: async () => Response.json({ mode: "legacy", configured: true }),
    window,
    history: { replaceState() {} },
    document: {
      title: "Test",
      readyState: "complete",
      querySelectorAll() { return []; }
    },
    sessionStorage: {
      getItem(key) { return values.has(key) ? values.get(key) : null; },
      setItem(key, value) { values.set(key, String(value)); },
      removeItem(key) { values.delete(key); }
    }
  });
  vm.runInContext(
    `${configSource}\n;globalThis.__result = { preferredBackend, page: buildInternalPageUrl("fiche.html", { id: "abc" }) };`,
    context
  );
  // Ramène l'objet hors du realm vm pour une comparaison stricte fiable.
  return JSON.parse(JSON.stringify(context.__result));
}

test("sélectionne D1 sans paramètre, y compris en Admin", () => {
  assert.deepEqual(
    loadConfig("https://site.example.test/index.html"),
    { preferredBackend: "d1", page: "fiche.html?id=abc" }
  );
  assert.deepEqual(
    loadConfig("https://site.example.test/index.html?admin=1"),
    { preferredBackend: "d1", page: "fiche.html?admin=1&id=abc" }
  );
});

test("accepte GAS sans tenir compte de la casse et le conserve dans les liens", () => {
  assert.deepEqual(
    loadConfig("https://site.example.test/index.html?backend=GAS"),
    { preferredBackend: "gas", page: "fiche.html?backend=gas&id=abc" }
  );
});

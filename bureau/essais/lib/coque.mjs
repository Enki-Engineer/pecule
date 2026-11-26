// Parler à la coque de l'appli de bureau lancée en recette (« --recette <socket> ») : une demande par ligne JSON.
import net from "node:net";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function until(test, ms, what) {
  const deadline = Date.now() + ms;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await test();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await sleep(200);
  }
  throw new Error(`délai dépassé : ${what}${last instanceof Error ? ` (${last.message})` : ""}`);
}

/** Les gestes de la recette, sur le socket d'une coque. */
export function recette(socket) {
  let sent = 0;
  const ask = (request) =>
    new Promise((resolve, reject) => {
      const id = ++sent;
      const connection = net.connect(socket);
      let buffer = "";
      const timer = setTimeout(() => (connection.destroy(), reject(new Error("la coque ne répond pas"))), 25_000);
      connection.on("error", (e) => (clearTimeout(timer), reject(e)));
      connection.on("data", (chunk) => {
        buffer += chunk;
        if (!buffer.includes("\n")) return;
        clearTimeout(timer);
        connection.end();
        resolve(JSON.parse(buffer));
      });
      connection.write(`${JSON.stringify({ id, ...request })}\n`);
    });
  /** La valeur d'une expression JavaScript, dans une fenêtre de la coque. */
  async function js(expression, fenetre = "main") {
    const r = await ask({ js: `JSON.stringify((() => { try { return { v: ${expression} }; } catch (e) { return { e: String(e) }; } })())`, fenetre });
    if (r.erreur) throw new Error(r.erreur);
    const out = typeof r.valeur === "string" ? JSON.parse(r.valeur) : r.valeur;
    if (out?.e) throw new Error(out.e);
    return out?.v;
  }
  /** La valeur d'une promesse : lancée dans la page, puis relevée. */
  async function jsAsync(body, fenetre = "main") {
    const key = `r${++sent}`;
    await js(`(window.__recette = window.__recette || {}, (async () => { ${body} })().then((v) => (window.__recette.${key} = { v: v === undefined ? null : v }), (e) => (window.__recette.${key} = { e: String(e) })), 1)`, fenetre);
    const out = await until(() => js(`(window.__recette && window.__recette.${key}) || null`, fenetre), 20_000, "la page ne rend pas de résultat");
    if (out.e) throw new Error(out.e);
    return out.v;
  }
  const state = () => ask({ etat: true });
  const text = (fenetre = "main") => js("document.body.innerText", fenetre);
  /** Remplit un champ que React tient : par le mutateur du navigateur, puis l'événement que React écoute. */
  const fill = (placeholder, content) =>
    js(`(() => { const el = [...document.querySelectorAll("input")].find((i) => i.placeholder === ${JSON.stringify(placeholder)}); if (!el) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(content)}); el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
  const click = (label, fenetre = "main") =>
    js(`(() => { const el = [...document.querySelectorAll("button, a")].find((b) => b.innerText.trim() === ${JSON.stringify(label)} && !b.disabled); if (!el) return false; el.click(); return true; })()`, fenetre);
  const waitText = (needle, fenetre = "main") => until(async () => (await text(fenetre)).includes(needle), 20_000, `« ${needle} » n'apparaît pas`);
  const mainPath = async () => {
    const main = (await state()).fenetres.find((f) => f.label === "main");
    return main ? new URL(main.url).pathname : null;
  };
  const waitPath = (test, what) => until(async () => test((await mainPath()) ?? ""), 20_000, what);
  const journal = async (kind) => (await state()).journal.filter((j) => kind in j);
  return { ask, js, jsAsync, state, text, fill, click, waitText, mainPath, waitPath, journal };
}

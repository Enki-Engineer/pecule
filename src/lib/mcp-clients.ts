/*
 * Assistants reconnus par le serveur d'autorisation de Pécule (connexion OAuth au serveur MCP, `src/server/oauth.ts`).
 *
 * Un assistant hébergé — appli web, de bureau ou mobile qui passe par les serveurs de son éditeur — fait revenir le
 * membre à une adresse fixe, chez cet éditeur, qui y consomme lui-même le code : elle est inscrite ici, à la lettre,
 * prise dans le document d'identité que l'éditeur publie ou dans sa documentation (la source est notée au-dessus de
 * chaque ligne), après avoir vérifié qu'elle n'est pas un relais (voir `RELAYS`). Un programme de
 * l'ordinateur (terminal, éditeur de code : Claude Code, Codex, Gemini CLI, Zed, Goose…) revient par une boucle
 * locale, admise pour tous sans être inscrite. Toute autre adresse est refusée : n'importe qui peut demander à
 * s'enregistrer, et l'écran de consentement resterait le seul rempart contre un client qui se ferait passer pour un
 * autre.
 *
 * Ajouter un assistant = une ligne. Le nom affiché au membre vient de cette liste, jamais de ce que le client dit de
 * lui-même.
 */

export type McpClient = {
  /** Nom affiché à l'écran de consentement et dans « Applications connectées ». */
  name: string;
  /** Adresses de retour de ses applis, exactes : https chez l'éditeur, ou schéma propre à son appli de bureau. */
  redirects: string[];
};

export const MCP_CLIENTS: McpClient[] = [
  // https://claude.ai/oauth/mcp-oauth-client-metadata (Claude Code, lui, revient par une boucle locale)
  { name: "Claude", redirects: ["https://claude.ai/api/mcp/auth_callback"] },
  // https://chatgpt.com/oauth/client.json : les connecteurs de ChatGPT (Codex revient par une boucle locale)
  { name: "ChatGPT", redirects: ["https://chatgpt.com/connector_platform_oauth_redirect"] },
  // https://docs.mistral.ai : l'adresse de retour unique des connecteurs de Le Chat
  { name: "Mistral Le Chat", redirects: ["https://callback.mistral.ai/v1/integrations_auth/oauth2_callback"] },
  // https://www.perplexity.ai/help-center : « Adding custom remote connectors »
  { name: "Perplexity", redirects: ["https://www.perplexity.ai/rest/connections/oauth_callback", "https://enterprise.perplexity.ai/rest/connections/oauth_callback"] },
  // L'appli de bureau de Cursor joint ce schéma à sa demande d'enregistrement, à côté d'une boucle locale.
  { name: "Cursor", redirects: ["cursor://anysphere.cursor-mcp/oauth/callback"] },
];

/**
 * Adresses relais, qui ne s'inscrivent jamais ci-dessus bien que leur éditeur les publie : elles ne gardent pas le
 * code, elles le renvoient vers une cible nommée dans la demande (un port de l'ordinateur, une appli ouverte par son
 * schéma). Les inscrire ferait afficher « retour chez l'éditeur » pour un retour décidé par celui qui a écrit le
 * lien. Leurs applis de bureau n'en ont pas besoin : elles reviennent par une boucle locale. Un test les refuse.
 */
export const RELAYS: string[] = [
  "https://vscode.dev/redirect", // vers le port ou l'extension que nomme `state`
  "https://insiders.vscode.dev/redirect",
  "https://www.cursor.com/bot/mcp/oauth/callback", // vers une appli par son schéma
  "https://cursor.com/bot/mcp/oauth/callback",
];

/** L'assistant reconnu à qui appartient cette adresse de retour ; `null` si elle n'est à aucun. */
export const knownClient = (redirectUri: string): McpClient | null => MCP_CLIENTS.find((c) => c.redirects.includes(redirectUri)) ?? null;

/**
 * L'adresse mène-t-elle chez l'éditeur de l'assistant (https, son domaine) ? Sinon elle ouvre une appli de
 * l'ordinateur par son schéma : comme pour une boucle locale, rien ne prouve quel programme la recevra.
 */
export const hostedRedirect = (redirectUri: string): boolean => redirectUri.startsWith("https://") && knownClient(redirectUri) !== null;

// Contrôle de la base d'une installation de Pécule, pour setup et doctor : répond-elle, quelle est sa version,
// est-elle vide ? Le pilote (mysql2) est celui du serveur : il est à portée dans l'archive prête à l'emploi, le dépôt
// installé et l'image Docker. Sans lui, rien n'est contrôlé — les scripts tournent toujours avec Node seul.

/** Versions à partir desquelles Pécule tourne : MariaDB 10.6, MySQL 8. */
export function supported(version) {
  const m = /^(\d+)\.(\d+)/.exec(version ?? "");
  if (!m) return true; // version illisible : on ne bloque pas pour cela
  const [major, minor] = [Number(m[1]), Number(m[2])];
  return /mariadb/i.test(version) ? major > 10 || (major === 10 && minor >= 6) : major >= 8;
}

/**
 * Essaie la base donnée par son adresse (« mysql://utilisateur:motdepasse@hote:3306/base »).
 *   null                                   le pilote n'est pas là : rien n'a été essayé
 *   { reachable: true, version, tables }   elle répond ; `tables` : nombre de tables qu'elle porte déjà
 *   { reachable: false, error }            elle ne répond pas ; `error` ne porte jamais le mot de passe
 */
export async function probeDatabase(url) {
  let mysql;
  try {
    mysql = await import("mysql2/promise");
  } catch {
    return null;
  }
  let connection;
  try {
    connection = await mysql.createConnection({ uri: url, connectTimeout: 6000 });
    const [[v]] = await connection.query("SELECT VERSION() AS version");
    const [[t]] = await connection.query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE()");
    return { reachable: true, version: String(v.version), tables: Number(t.n) };
  } catch (e) {
    // Les messages du pilote nomment l'hôte, l'utilisateur ou la base, jamais le mot de passe.
    const code = e && typeof e === "object" && typeof e.code === "string" ? e.code : null;
    const message = e instanceof Error ? e.message : String(e);
    return { reachable: false, error: code && !message.includes(code) ? `${message} (${code})` : message };
  } finally {
    await connection?.end().catch(() => undefined);
  }
}

/** La même chose en une phrase, pour l'afficher. */
export function describeDatabase(probe) {
  if (!probe) return null;
  if (!probe.reachable) return `la base ne répond pas : ${probe.error}`;
  if (!supported(probe.version)) return `base jointe, mais trop ancienne (${probe.version}) : il faut MariaDB 10.6 ou MySQL 8, ou plus récent`;
  return `base jointe (${probe.version}, ${probe.tables === 0 ? "vide" : `${probe.tables} tables`})`;
}

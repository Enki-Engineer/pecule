# Security

[Lire en français](SECURITY.fr.md)

Pécule holds bank data and personal documents. Please report any vulnerability **privately**: the repository's
"Security" tab → "Report a vulnerability" (GitHub's private reporting). Do not open a public issue, and never attach
real data.

Give the version (or the commit), the steps to reproduce and the effect you observed. The project is maintained in
spare time: an answer usually comes within a week. Only the latest published release receives fixes.

## What to know about the model

- One installation serves **a household whose members trust each other**: the bank accounts and their transactions
  are visible to every member (each one only chooses what they hide). The following are private when they belong to a
  member: payslips, personal tax returns, retirement, personal documents and invoices, investments, loans and
  property in their name. A member may choose to share their income with the household (Settings → Account and
  security): the others then read the amounts of their payslips and personal tax returns, never the documents. Only
  the member can change this setting, on screen.
- The **administrator** (the first member) adds members, sets the AI provider, sees the full log and can download the
  backup of the whole household. "Private" therefore protects a member from the other members, not from the
  administrator: the backup contains everything, and the administration token reads each member's view (these reads
  are recorded in the log).
- The demo mode is a convenience to show the app, not a security barrier between two people: do not lend a device
  with an open session.

## What protects an installation

- **Https on the Internet, always.** Over http, Pécule only installs on the machine itself (`localhost`) or on the
  home network (a private address), where everything travels in the clear on that network.
- **Sign-in uses passkeys (WebAuthn) first.** A member may choose a **password** — the only way in where a passkey
  cannot be created (http on the home network, an IP address): twelve characters at least, kept as a scrypt hash,
  attempts throttled per member (five wrong in a row close their password sign-in for one minute, then up to
  fifteen) and per address. On an https installation where everyone has a passkey, the administrator can **require
  passkeys**: no password is accepted any more (Settings → Account and security). Knowing a first name lets someone
  close that member's password sign-in for a while, not their passkey; `node scripts/lien.mjs --membre <first name>`,
  on the server, gives access back to whoever lost theirs.
- **`API_TOKEN`** grants every right on the API: keep it out of the repository and do not share it. **`SECRET_KEY`**
  encrypts the secrets kept in the database (bank key, AI key, notification key): losing or changing it makes them
  unreadable. An installation without `SECRET_KEY` encrypts with `API_TOKEN`.
- The **full backup**, downloaded or kept on the server, is not encrypted: store the archive like a sensitive
  document. What goes to external storage always is (age format, X25519 recipient): the server only keeps the public
  key and cannot read back what it sent. The recovery key is shown to the administrator only once.
- The address of the **external storage** is given by the administrator and may point to a device on the server's
  network (a NAS): only the administrator sets it, never in demo mode.
- **Restoring from the app** only exists on an installation with no member and no data, and requires the setup code
  (`SETUP_CODE`, or `API_TOKEN` by default): a running installation cannot be overwritten that way. Only restore your
  own archives: a backup is the whole database, access included (passkeys, password hashes, administration tokens,
  connected applications) — restoring someone else's hands them the installation.
- The administrator **revokes all of a member's access at once** (lost device, member leaving the household):
  passkeys, password, sessions, calendar link, upload tokens, connected applications (Settings → Account and security).
- Nothing the assistant writes is written without confirmation, **its memory included**: text coming from elsewhere
  (a transfer label, an uploaded document) cannot write itself there. An external assistant connected through OAuth,
  however, reads labels and documents as they are: only connect an assistant you trust with this data, and keep it
  read-only if you do not need the actions.
- Every published release carries a **provenance attestation** (see `docs/guide/mise-a-jour.md`): `SHA256SUMS`,
  downloaded from the same place as the archive, only protects against a corrupted download.
- Documents sent for reading go to the **AI provider you chose**, and nowhere else.
- Behind more than one proxy (or none), set `TRUST_PROXY`: the sign-in attempt limit is counted per visitor address.
  Without Docker, close the server's port at the firewall: only your https proxy should reach it.
- Do not publish your instance without https — nor behind a self-signed certificate, which browsers refuse for
  passkeys —, and leave `X-Robots-Tag` in place: nothing should be indexed.

## The Mac app

The desktop app (`docs/guide/appli-mac.md`, in French) runs Pécule and its database on the computer of the person
using it. Its model is not a server's:

- **The Mac account is the only boundary.** The data, the database and the settings — including the secret that
  encrypts the keys kept in the database — live in `~/Library/Application Support/Pecule`, closed to other accounts.
  Whoever opens the Mac session has everything: lock it, and turn on FileVault. A backup of the Mac (Time Machine)
  takes that whole folder with it: protect it the same way.
- **On a Mac account shared by several people, "private" protects from no one.** The Help menu → "Forgot password…"
  gives whoever holds the window access to any member, administrator included — it is the equivalent of
  `scripts/lien.mjs` on a server. A password only stops a passing glance there. For members who keep things from
  each other: one Mac account each, or an installation on a server.
- **Nothing leaves the machine.** The server only listens on `127.0.0.1` and only answers to that name (a page from
  another site pointing its own name at the machine is refused); the database has no port, only a socket in the data
  folder.
- **The session cookie is valid for every port of `127.0.0.1`**: a browser would send it to another program taking
  Pécule's port while it is stopped. The app's window only goes to that port once its own server has proved it holds
  it, and the window where a bank's consent is given never has that cookie. On a Mac where other accounts are open
  at the same time, do not open Pécule in an ordinary browser.
- **The app is not signed by an Apple account** (ad hoc signature): macOS cannot tell who it comes from. Install it
  with the command from the guide, which checks its checksum, and verify the release's provenance attestation if
  needed. Updates made by the app, however, are **signed**: it refuses an archive that does not carry the project's
  signature, wherever it comes from. Node.js and MySQL in it are their publishers' builds, pinned by checksum
  (`bureau/pieces.json`), with their original signatures.
- The Pécule page receives no power from the app: no command, no file access. The app only watches where the window
  wants to go — every external link goes to the browser.

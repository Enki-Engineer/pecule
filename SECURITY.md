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

- **Https is mandatory** outside `localhost`; sign-in uses passkeys (WebAuthn), never a password.
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
  own archives: a backup is the whole database, access included (passkeys, administration tokens, connected
  applications) — restoring someone else's hands them the installation.
- The administrator **revokes all of a member's access at once** (lost device, member leaving the household):
  passkeys, sessions, calendar link, upload tokens, connected applications (Settings → Account and security).
- Nothing the assistant writes is written without confirmation, **its memory included**: text coming from elsewhere
  (a transfer label, an uploaded document) cannot write itself there. An external assistant connected through OAuth,
  however, reads labels and documents as they are: only connect an assistant you trust with this data, and keep it
  read-only if you do not need the actions.
- Every published release carries a **provenance attestation** (see `docs/guide/mise-a-jour.md`): `SHA256SUMS`,
  downloaded from the same place as the archive, only protects against a corrupted download.
- Documents sent for reading go to the **AI provider you chose**, and nowhere else.
- Behind more than one proxy (or none), set `TRUST_PROXY`: the sign-in attempt limit is counted per visitor address.
  Without Docker, close the server's port at the firewall: only your https proxy should reach it.
- Do not publish your instance without https, and leave `X-Robots-Tag` in place: nothing should be indexed.

# Legacy (frozen)

This directory contains the original PHP/MySQL and Streamlit prototypes that
predate the React + Node + MongoDB stack in `server/` and `client/`.

**Nothing in this directory is deployed.** It is kept only so the new stack
can be cross-checked against the old behavior while we reach feature parity.

## Security notice

`config.php` historically contained hard-coded credentials for an
InfinityFree MySQL database. Those credentials must be rotated on the
InfinityFree side and the file must not be redeployed as-is. See the
top-level `SECURITY.md` for the full action list.

## Do not extend

New features belong in `server/` and `client/`. When a legacy feature is
re-implemented in the new stack, the corresponding file(s) in this directory
can be deleted.

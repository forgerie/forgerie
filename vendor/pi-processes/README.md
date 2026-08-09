# Bundled pi-processes package

Forgerie ships a patched build of [`@aliou/pi-processes`](https://github.com/aliou/pi-processes) v0.10.4 under its MIT license. The bundled archive makes managed-process behavior part of Forgerie instead of a machine configuration dependency.

## Forgerie patches

`forgerie.patch` contains the complete divergence from upstream v0.10.4:

1. Spawn commands through a non-login shell (`bash -c`) so the session daemon's curated `PATH` survives on NixOS. Reject an invalid configured shell instead of silently falling back.
2. Add the `processes:command:write` EventBus command so the browser panel can write to managed-process stdin.

Do not add unrelated changes to this patch.

## Rebuild

From a clean upstream checkout:

```sh
git checkout v0.10.4
git apply /path/to/forgerie/vendor/pi-processes/forgerie.patch
npm pack --ignore-scripts --pack-destination /tmp
```

Rename the archive to `aliou-pi-processes-0.10.4-forgerie.1.tgz`, replace the bundled file, then run `npm install` and `npm run verify`. The expected SHA-256 for the current archive is:

```text
6b46d41489fdc6876652ab9a9588c1bbbd138a1b00d6fbf552798727649f3e8d
```

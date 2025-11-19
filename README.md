## Digified Zendesk Theme

The repository contains the working copy of the Digified Zendesk Guide theme. Edit the files under `templates/`, `assets/`, etc., then rebuild the distributable archive before uploading to Zendesk.

### Packaging

Zendesk’s importer expects forward-slash paths inside the zip. Windows `Compress-Archive` writes backslash-separated entries, which causes missing-template errors (e.g., `templates/home_page.hbs`). Use the helper script instead:

```powershell
powershell -ExecutionPolicy Bypass -File .\package-theme.ps1
```

The script runs `tar -a -c -f digified-theme.zip assets settings templates translations script.js style.css manifest.json`, ensuring the resulting `digified-theme.zip` is ready for import with POSIX-style paths. Use the `-ExecutionPolicy Bypass` flag if your PowerShell policy blocks local scripts.

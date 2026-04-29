# GitHub-Repository umbenennen (`lancom-onsite` → `onsite`)

Die Metadaten im Repo (z. B. `package.json`) zeigen auf **`https://github.com/it00x32/onsite`**. Auf GitHub musst du die Umbenennung **einmal** ausführen.

## 1. Auf GitHub (oder per CLI)

### Variante A: Web-UI

1. Repository öffnen: **Settings** → **General** → Abschnitt **Repository name**
2. Neuen Namen eintragen: **`onsite`**
3. **Rename** bestätigen

### Variante B: GitHub CLI (lokal, mit deinem Login)

```bash
gh auth status    # muss eingeloggt sein
gh repo rename onsite -R it00x32/lancom-onsite
```

GitHub leitet die alte URL `…/lancom-onsite` meist **automatisch weiter** (Redirect), bis ein anderes Repo den alten Namen belegt. Trotzdem sollten alle Klone und CI auf die neue URL umgestellt werden.

## 2. Bestehende Klone anpassen

```bash
cd /pfad/zu/onsite
git remote -v
git remote set-url origin https://github.com/it00x32/onsite.git
git fetch origin
```

SSH-URL analog: `git@github.com:it00x32/onsite.git`

## 3. Prüfen

- `package.json` → `repository`, `bugs`, `homepage` (bereits auf `onsite`)
- Landing-Page / Doku → Links auf `github.com/it00x32/onsite`
- Optional: neues leeres Repo **`onsite`** nicht anlegen, wenn du **rename** nutzt — sonst Konflikt

## 4. Forks & externe Links

Externe Verweise (Blogs, Bookmarks) auf `lancom-onsite` ggf. manuell aktualisieren; Redirect hält eine Weile, ist aber nicht dauerhaft garantiert.

# Dive-site summary translations

The website has 18,813 dive sites. This translation set localizes the 18,166
sites that currently have an English summary; sites without a summary remain
empty. Each supported language is stored separately and loaded only when that
language is selected. English remains the fallback if a translation is absent
or cannot be loaded.

## How it works

`source.json` records the English phrase templates, location names, and unique
narrative summaries that need translation. Repeated category and SSI profile
summaries are assembled from translated phrases. A narrative summary is
translated as a whole and keyed by a short hash of its exact English text.
Runtime dictionaries map the full English sentence to its translation, so a
changed source sentence falls back to English instead of showing an outdated
claim. Summary source links and provenance continue to come from the English
sidecar.

The locale JSON files are the editable translation dictionaries. They name
GPT-6 Luna as the AI translation source; they are not represented as
human-reviewed translations. The `batches/` and `parts/` directories are
temporary translator checkpoints and are ignored by Git.

## Rebuild

After editing or completing locale dictionaries, run:

```powershell
python maintenance/build_dive_site_summary_translations.py
```

To consolidate translator checkpoints into the locale JSON files and build the
runtime gzip sidecars, run:

```powershell
python maintenance/build_dive_site_summary_translations.py --assemble-parts
```

The builder checks exact phrase, location, and narrative coverage; placeholders
and figures in narrative text; and parity with the language list in `index.html`.
It writes deterministic files to `datasets/dive-site-summary-translations/`.
The normal Pages build includes those runtime files and excludes editable
translation inputs.

If English narrative summaries change, update `source.json` and prepare new
translation checkpoints before compiling. Do not copy an older translation to
a changed English sentence. The English fallback is intentional until the new
source text has been translated.

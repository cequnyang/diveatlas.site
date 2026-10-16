#!/usr/bin/env python3
"""Compile reviewed translation dictionaries into lazy-loaded summary locales.

English descriptions are the lookup keys: a changed source can never silently
reuse a translation of an older claim. Repeated category/profile sentences are
composed from translated phrases; narrative accounts are translated in full.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / "maintenance/summary-translations"
OUTPUT = ROOT / "datasets/dive-site-summary-translations"
LANGUAGES = ("zh", "ja", "fr", "de", "nl", "it", "ru", "pt", "sv", "no", "es", "ko", "id")
PLACEHOLDER = re.compile(r"\{[a-z]+\}")
NUMBER = re.compile(r"\d+(?:[.,]\d+)?")
ACCESS = {
    "It is a shore-entry dive.": "shore",
    "It is reached by boat.": "boat",
    "It can be reached from shore or by boat.": "shore_or_boat",
}
FEATURES = {
    "a reef": "reef", "an artificial reef": "artificial reef", "a pinnacle": "pinnacle",
    "a wreck": "wreck", "a wall": "wall", "a cave": "cave", "a cavern": "cavern",
    "drift diving": "drift", "muck diving": "muck", "a sandy bottom": "sandy bottom",
    "seagrass": "seagrass", "kelp": "kelp", "a cenote": "cenote", "a blue hole": "blue hole",
    "a thermal feature": "thermal feature", "an arch": "arch", "a reef ridge": "reef ridge",
    "a manta cleaning station": "manta cleaning station",
}


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def narrative_key(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def canonical_names() -> dict[str, str]:
    text = (ROOT / "datasets/dive-sites.js").read_text(encoding="utf-8-sig")
    match = re.search(r"window\.DIVE_SITES_DATA\s*=\s*(\[.*\])\s*;?\s*$", text, re.S)
    if not match:
        raise ValueError("Cannot read canonical dive-site identities")
    return {row[12]: row[0] for row in json.loads(match[1])}


def supported_site_languages() -> set[str]:
    text = (ROOT / "index.html").read_text(encoding="utf-8-sig")
    match = re.search(r"const SUPPORTED_LANGS = new Set\(\[([^\]]+)\]\)", text)
    if not match:
        raise ValueError("Cannot read website's supported languages")
    return set(re.findall(r"'([a-z]{2})'", match[1]))


def assemble_parts(language: str) -> dict:
    merged = {"language": language, "phrases": {}, "locations": {}, "narratives": {}}
    paths = sorted((SOURCES / "parts").glob(f"{language}.*.json"))
    if not paths:
        raise ValueError(f"No translation checkpoints for {language}")
    for path in paths:
        part = read_json(path)
        if part.get("language") != language:
            raise ValueError(f"Wrong language in {path}")
        for section in ("phrases", "locations", "narratives"):
            for key, value in part.get(section, {}).items():
                if key in merged[section]:
                    raise ValueError(f"Duplicate {section} key {key} in {path}")
                merged[section][key] = value
    return merged


def validate(locale: dict, source: dict, language: str) -> None:
    if locale.get("language") != language:
        raise ValueError(f"Wrong translation language: {language}")
    for section in ("phrases", "locations", "narratives"):
        expected = set(source[section])
        actual = locale.get(section, {})
        if set(actual) != expected:
            raise ValueError(f"{language}/{section}: missing {sorted(expected-set(actual))[:5]}, unexpected {sorted(set(actual)-expected)[:5]}")
        for key, value in actual.items():
            if not isinstance(value, str) or not value.strip() or "\ufffd" in value:
                raise ValueError(f"Invalid translation: {language}/{section}/{key}")
            if section == "locations":
                continue
            original = source[section][key]
            if Counter(PLACEHOLDER.findall(original)) != Counter(PLACEHOLDER.findall(value)):
                raise ValueError(f"Changed placeholders: {language}/{section}/{key}")
            if section == "narratives":
                numbers = lambda s: Counter(x.replace(",", ".") for x in NUMBER.findall(s))
                if numbers(original) - numbers(value):
                    raise ValueError(f"Missing source figures: {language}/{key}: {dict(numbers(original)-numbers(value))}")
                if original == value:
                    raise ValueError(f"Untranslated narrative: {language}/{key}")


def join_list(items: list[str], phrases: dict[str, str]) -> str:
    if len(items) == 1:
        return items[0]
    if len(items) == 2:
        return phrases["list.two"].format(first=items[0], last=items[1])
    return phrases["list.many"].format(rest=phrases["list.separator"].join(items[:-1]), last=items[-1])


def translate_category(site_id: str, text: str, names: dict[str, str], locale: dict) -> str:
    p = locale["phrases"]
    name = names[site_id]
    prefix, body = text.split(" is a ", 1)
    if prefix != name:
        if not prefix.startswith(name + " in "):
            raise ValueError(f"Unknown category location structure: {text}")
        location = prefix[len(name) + 4:]
        prefix = p["location"].format(site=name, location=locale["locations"][location])
    access = None
    for sentence, key in ACCESS.items():
        if body.endswith(" " + sentence):
            body = body[:-len(sentence)-1]
            access = key
            break
    match = re.fullmatch(r"(?:(marine|lake|river|pool|quarry) )?dive site(?: with (.+))?\.", body)
    if not match:
        raise ValueError(f"Unknown category sentence: {text}")
    setting, features = match.groups()
    key = "category." + (setting or "default")
    values = {"site": prefix}
    if features:
        key += ".features"
        values["features"] = join_list([p["feature."+FEATURES[value]] for value in re.split(r",? and |, ", features)], p)
    result = p[key].format(**values)
    return result + (" " + p["access."+access] if access else "")


def translate_profile(text: str, phrases: dict[str, str]) -> str:
    depth = re.search(r"maximum depth of ([0-9.]+) m", text)
    levels = re.findall(r"\b(beginner|intermediate|advanced|expert)\b", text)
    key = "profile.both" if depth and levels else "profile.depth" if depth else "profile.levels"
    values = {}
    if depth:
        values["depth"] = depth[1]
    if levels:
        values["levels"] = join_list([phrases["level."+level] for level in levels], phrases)
    if not values:
        raise ValueError(f"Unknown profile sentence: {text}")
    return phrases[key].format(**values)


def build(language: str, locale: dict, rows: dict, names: dict) -> dict:
    translated = {}
    for site_id, row in rows.items():
        text = row["description"]
        if row.get("type") == "profileSnapshot":
            value = translate_profile(text, locale["phrases"])
        elif "summaryReviewStatus" in row:
            value = locale["narratives"][narrative_key(text)]
        else:
            value = translate_category(site_id, text, names, locale)
        if PLACEHOLDER.search(value):
            raise ValueError(f"Unfilled placeholder for {language}/{site_id}")
        if text in translated and translated[text] != value:
            raise ValueError(f"Conflicting translations for identical English text: {language}")
        translated[text] = value
    return {"schema": "dive-site-summary-translations-v1", "language": language,
            "authoringMethod": "AI translation by GPT-6 Luna; source claims and provenance retained in the English summary sidecar",
            "summaryCount": len(rows), "byEnglish": dict(sorted(translated.items()))}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assemble-parts", action="store_true", help="Consolidate validated translator checkpoints into editable locale files")
    parser.add_argument("--languages", nargs="+", choices=LANGUAGES, default=list(LANGUAGES))
    args = parser.parse_args()
    source = read_json(SOURCES / "source.json")
    if set(source["targetLanguages"]) != set(LANGUAGES) or set(LANGUAGES) != supported_site_languages() - {"en"}:
        raise ValueError("Translation targets and website-supported languages are out of sync")
    names = canonical_names()
    with gzip.open(ROOT / "datasets/dive-site-summaries.json.gz", "rt", encoding="utf-8") as stream:
        rows = json.load(stream)["bySiteId"]
    # Fail before writing any output if the English narrative set has changed.
    current = {narrative_key(x["description"]): x["description"] for x in rows.values() if "summaryReviewStatus" in x}
    if current != source["narratives"]:
        raise ValueError("English narrative summaries changed; refresh the source registry and translate new/changed entries first")
    planned = []
    for language in args.languages:
        locale = assemble_parts(language) if args.assemble_parts else read_json(SOURCES / f"{language}.json")
        validate(locale, source, language)
        planned.append((language, locale, build(language, locale, rows, names)))
    OUTPUT.mkdir(exist_ok=True)
    for language, locale, result in planned:
        if args.assemble_parts:
            (SOURCES / f"{language}.json").write_text(json.dumps(locale, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
        encoded = json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        compressed = gzip.compress(encoded, compresslevel=9, mtime=0)
        (OUTPUT / f"{language}.json.gz").write_bytes(compressed)
        print(f"{language}: {len(rows):,} summaries, {len(result['byEnglish']):,} distinct descriptions, {len(compressed):,} bytes")


if __name__ == "__main__":
    main()

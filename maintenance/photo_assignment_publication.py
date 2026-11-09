"""Separate private review-file locators from publishable photo evidence."""
import re

LOCAL_RESEARCH_PATH = re.compile(r'(?:^|[^A-Za-z0-9_.:/-])(?:\./|/)?data[\\/][A-Za-z0-9_.-]', re.I)
PRIVATE_LOCATORS = {'source_review_manifest', 'original_archive'}


def public_assignment(entry):
    """Copy public metadata; reject unexpected private paths rather than hiding them.

    Older review assessments also stored a local run path as source_provenance.
    Keep external provenance URLs and all substantive review/rights caveats.
    """
    def visit(value):
        if isinstance(value, dict):
            return {key: visit(item) for key, item in value.items()
                    if key not in PRIVATE_LOCATORS and not
                    (key == 'source_provenance' and isinstance(item, str) and LOCAL_RESEARCH_PATH.search(item))}
        if isinstance(value, list):
            return [visit(item) for item in value]
        if isinstance(value, str) and LOCAL_RESEARCH_PATH.search(value):
            raise ValueError('Private research path in public photo metadata; retain it in local evidence instead')
        return value
    return visit(entry)

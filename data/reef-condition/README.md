# Reef Condition survey data

Field-observation datasets belong here only after source access and redistribution terms are established. The production survey-observation provider requests `field-observations.json`; when it is absent, it reports unavailable and does not substitute synthetic data. NOAA's derived thermal-history pressure layer is published separately in `thermal-stress-history/` and does not replace or merge with field surveys.

Synthetic survey fixtures are kept under `tests/fixtures/reef-condition/` and are loaded only by tests.

## Schema version

The canonical schema version 2 supports the dataset types `synthetic`, `local-pilot`, `local-testing`, and `production`. The field-observation provider expects `field-observations.json` here. No production field-observation dataset is present; the separate NOAA thermal-history layer is a static environmental-pressure source, not an observed-condition dataset.

Each record represents one survey event and contains a `protocols` array. Protocol results remain separate because their counts, measurement bases, means, and standard deviations are method-specific. The view displays a metric only when an event has exactly one compatible non-null candidate; it does not choose between or average multiple protocol candidates.

Known normalized metric bases are fixed by the validator: benthic cover for live coral and macroalgae cover, and coral colonies for bleaching categories. Recently-dead colonies remain within the bleaching observation and are not converted into generic reef mortality. Confidence stays null until a confidence method is defined. Missing data remains null, and measured zero remains zero.

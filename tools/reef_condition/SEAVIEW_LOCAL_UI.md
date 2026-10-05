# Seaview local Reef Condition preview

This preview adds Seaview Survey hard coral and macroalgae measurements to the existing Reef Condition map. It is useful for evaluating their geographic coverage, quantitative color scales, and observation age before any production decision.

The preview shows site-level latest-available survey evidence. It does not interpolate values, estimate present-day cover, or feed Dive Conditions scores.

## Run the local preview

From the repository root, make sure the ignored canonical bundle and metadata sidecar exist. If needed, rebuild them from the already available local UQ archive:

```powershell
python tools/reef_condition/seaview_adapter.py
python -m http.server 8765 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/?reefConditionLocalResearch=1`, choose Reef Condition, then select **Hard Coral Cover** or **Macroalgae Cover** from the local research group.

The flag only works on `localhost`, `127.0.0.1`, or `::1`. Reef Condition first loads its normal controls; the Seaview metadata and canonical bundle are fetched only after selecting one of the two Seaview metrics. Switching between those metrics reuses the same loaded bundle.

## Data and licensing boundary

All generated files stay under ignored `data/.build/reef_condition/seaview/`. The repository record and paper indicate CC BY 3.0, while the UQ guide distributed with the release indicates CC BY-NC-SA 4.0. The conflict is unresolved. The preview therefore labels the license as under clarification and must remain local until written clarification is obtained.

The Pages builder excludes the research directory and both local-only JavaScript modules. The Pages verifier rejects those paths and fails if the production index exposes either local metric.

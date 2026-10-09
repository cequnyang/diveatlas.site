# Location labels in Dive Experience Outlook

The Dive Experience Outlook popup labels a selected coordinate with a country, territory, or broad ocean region. This helps divers understand the geographic destination while exploring conditions. Maritime labels describe geographic context only; they do not determine visa requirements, immigration eligibility, border status, or legal jurisdiction.

Land points use the locally bundled Natural Earth 1:50m Admin 0 country boundaries. Offshore points use the locally bundled Marine Regions World EEZ version 12 low-resolution zones. A unique exclusive zone is labeled with its territory or country and broad UN-style region. Overlapping claims and joint regimes are identified as such instead of being assigned to one country. Points outside those zones use a broad ocean-basin label; no nearest-country guess is made.

The datasets load only when a location popup is opened and are decompressed in the browser. Selected coordinates are not sent to a reverse-geocoding service. The generalized boundaries support map context, not navigation, precise borders, or legal decisions.

## Sources and limitations

- [Natural Earth, 1:50m Admin 0 Countries](https://www.naturalearthdata.com/downloads/50m-cultural-vectors/50m-admin-0-countries-2/), public domain.
- [Marine Regions World EEZ version 12](https://zenodo.org/records/16355917), DOI [10.14284/628](https://doi.org/10.14284/628), CC BY 4.0. The source notes that these boundaries have no legal value and are not intended for legal, economic, or navigational purposes.

The bundled data is generalized and may not reflect current territorial changes. A maritime-zone label is not a statement about visa eligibility or which country's rules apply to a traveler.

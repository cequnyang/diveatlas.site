# Saved dive sites on the map

Save dive sites into a named trip and return to the same map context later. The list opens over the existing map as a desktop side panel or mobile bottom sheet; closing it does not change the map position or layer selection.

## Try it locally

Open the local map, select a dive site and choose **Save to trip**. Create a trip or toggle an existing trip to add/remove the current site. Creating a trip adds it selected to the list, and the chooser stays open until explicitly dismissed. Trip names must be unique, ignoring case and repeated spaces. Tab in an empty name field accepts the generated location/month example; an unchanged generated name also sets the trip month. The confirmation offers **View saved sites**. **My trips** in the header reopens the list; on phones this uses a bookmark icon with the same accessible name. Select a saved site to locate it, close the list with **×** on desktop, drag the handle down on mobile, or press Escape to keep browsing. The trip menu reuses search-result rows and its mobile bottom handle; swipe that handle up to close only the selector. Deleting a trip asks for confirmation inline beside its delete control.

Travel month and Continue planning are intentionally hidden, with their controls, handlers and saved data retained. Travel month belongs to the trip's plan. It does not assert current conditions or automatically change the map's historical environmental month. The saved context separately restores the selected environmental view/month and map overlays using the existing share-state codec. The codec stores integer zoom and quantized coordinates, so restored positions have its existing precision limits.

Trips are saved in `localStorage` under `diveatlas-saved-trips-v1`. They stay in this browser and origin; another port or browser has a separate list. Clearing browser data removes them. When storage is unavailable, the interface says changes last only for the open page. No account is required or connected, and saves are not uploaded.

## Implementation and boundaries

`js/saved-trips.js` owns versioned local storage, trip selection, duplicate prevention, saving feedback and panel/dialog interaction. `assets/saved-trips.css` inherits the site's font, palette and existing header/share button classes. The map passes a small adapter from `index.html` for stable site identity, real search navigation and map-state capture/restoration. Existing map layout, search, environmental controls, authentication and other pages remain owned by their existing components. This iteration adds saving to map site cards; standalone detail pages are outside this change.

Site IDs and stored coordinates allow offline fallback location when the current catalog cannot load. Saved names are snapshots of the catalog at save time. Returning to old historical layers does not make their source data current. Free browsing with the list closed does not overwrite its resume context. Context updates while the list is open and when saving or opening a saved site.

## Verification

Run `npx playwright test --config=playwright.saved-trips.config.cjs`. The focused desktop and mobile tests cover first save, named trips, reload persistence, travel month, empty lists, removal, resume position, unchanged map position on close, and unavailable browser storage. The config reuses the existing test server and project devices, with its own output directory.

AI assistance contributed to this implementation and its checks. It does not add server storage, synchronization, booking, or deployment configuration.

The local preview used for this change is `node tools/serve_test_site.js --port=9876`. The generated-name month comes from the active monthly layer; with no monthly layer it falls back to the current local month. Saved-site rows include available depth formatted using the current unit setting.

# Saved dive sites on the map

Save dive sites into a named trip and return to the same map context later. The list opens over the existing map as a desktop side panel or mobile bottom sheet; closing it does not change the map position or layer selection.

## Try it locally

Open the local map, select a dive site and choose **Save to trip**. Create a trip or toggle an existing trip to add/remove the current site. Creating a trip adds it selected to the list, and the chooser stays open until explicitly dismissed. Both trip lists show the newest created trips first. Trip names must be unique, ignoring case and repeated spaces. Tab in an empty name field accepts the generated location/month example; an unchanged generated name also sets the trip month. The confirmation offers **View saved sites**. **My trips** in the header reopens the list; on phones this uses a bookmark icon with the same accessible name. Select a saved site to locate it, close the list with **×** on desktop, drag the handle down on mobile, or press Escape to keep browsing. The trip menu reuses search-result rows and its mobile bottom handle; swipe that handle up to close only the selector. Deleting a trip asks for confirmation inline beside its delete control.

Travel month and Continue planning are intentionally hidden, with their controls, handlers and saved data retained. Travel month belongs to the trip's plan. It does not assert current conditions or automatically change the map's historical environmental month. The saved context separately restores the selected environmental view/month and map overlays using the existing share-state codec. The codec stores integer zoom and quantized coordinates, so restored positions have its existing precision limits.

Trips are saved in `localStorage` under `diveatlas-saved-trips-v1`. They stay in this browser and origin; another port or browser has a separate list. Clearing browser data removes them. When storage is unavailable, the interface says changes last only for the open page. No account is required or connected, and saves are not uploaded.

## Implementation and boundaries

`js/saved-trips.js` owns versioned local storage, trip selection, duplicate prevention, saving feedback and panel/dialog interaction. `assets/saved-trips.css` inherits the site's font, palette and existing header/share button classes. The map passes a small adapter from `index.html` for stable site identity, real search navigation and map-state capture/restoration. Existing map layout, search, environmental controls, authentication and other pages remain owned by their existing components. This iteration adds saving to map site cards; standalone detail pages are outside this change.

Site IDs and stored coordinates allow offline fallback location when the current catalog cannot load. Saved names are snapshots of the catalog at save time. Returning to old historical layers does not make their source data current. Free browsing with the list closed does not overwrite its resume context. Context updates while the list is open and when saving or opening a saved site.

## Verification

Run `npx playwright test --config=playwright.saved-trips.config.cjs`. The focused desktop and mobile tests cover first save, named trips, reload persistence, travel month, empty lists, removal, resume position, unchanged map position on close, and unavailable browser storage. The config reuses the existing test server and project devices, with its own output directory.

AI assistance contributed to this implementation and its checks. It does not add server storage, synchronization, booking, or deployment configuration.

The local preview used for this change is `node tools/serve_test_site.js --port=9876`. The generated-name month comes from the active monthly layer; with no monthly layer it falls back to the current local month. Saved-site rows include available depth formatted using the current unit setting.


Trip surfaces share explicit open notifications with the map's existing overlays. On mobile, opening My trips suspends welcome without changing its suppression preference, dismisses search (including pending results/navigation), closes menus, and collapses Layers without persisting that layout choice. On desktop, opening My trips leaves existing windows open. Add to trip prepares the surrounding overlays while preserving its source site. A newly opened map detail, search, welcome, menu, or modal dismisses My trips without taking focus from the new task. The trip selector and inline delete confirmation stay attached to their parent. Opening a dive-site detail dismisses My trips; opening My trips dismisses an existing detail only on mobile. Add to trip is a child modal of the source site: it preserves that sheet beneath the backdrop and returns focus without reopening or resetting it. Late map-detail responses cannot replace the source sheet or interrupt the modal form.

The save chooser has one footer action: Save for existing trip selections, or Create & save while the new-trip form is open (including the first trip). Create & save creates and selects the new trip, saves the site, and dismisses the chooser. Invalid or duplicate names keep the form open. The shared footer submits the name form through its native form association, preserving required-field validation and keyboard submission.

Mobile My trips reuses the map sheets’ bottom-up entrance, with the same 280ms easing. Each sheet settles at its own layout position; reduced motion skips the entrance, and closing cancels any pending reveal frame.

Selection feedback appears in the save dialog’s live status area while that modal is open. After dismissal, the ordinary map toast can offer View saved sites; no body-level feedback is left behind its backdrop.


Trip interface copy is in `js/saved-trips-i18n.js`, covering all 14 map languages and Traditional Chinese. It follows the document language, including live updates of open panels, selector confirmations, form drafts, validation, feedback, drag hints and accessibility labels. Saved trip names remain user data. Generated name templates and month names follow the active language; accepting the generated name still initializes the travel month. Counts use Intl plural and number formatting, including Russian few/many forms.

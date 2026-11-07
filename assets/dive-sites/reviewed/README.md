# Reviewed detail-page images

These assignments apply two owner-selected surface main images and one underwater wreck main image on the actual detail pages. They are distinct from datasets/dive-site-photos.js, whose contract requires confirmed exact-site photographs. Do not mark these surface images as verified underwater views.

js/seo-page-controls.js loads js/dive-site-reviewed-images.js only for the three explicit UUIDs; the module reads assignments.json and preserves the existing hero if metadata, CSS or image decoding fails. Static and shared pages use this same component. Update the eligibility lists in both scripts when deliberately expanding scope. No catalogue-wide inference is supported.

The accepted opt-in preview is retained and takes precedence when imageReview=three is present. No new remote image download occurred. The five derivatives are copied byte-for-byte from that accepted preview; original images remain in the review archive, outside production assets. Enlarge displays the prepared derivative, not the archived original. No publication or deployment is authorized by this local integration.

## Credits

- SS Thistlegorm (Wreck) (24578a6d-215e-4d04-8c74-334bddbc60d7): Woodym555; edited by Fir0002; [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/); [source](https://commons.wikimedia.org/wiki/File:Thistlegorm_train_parts_minus_red_edit.jpg). Full original composition resized 1500 × 1125 to 900 × 675 and JPEG re-encoded; no new crop or colour/sharpness edits. Mobile: full composition resized to 900 × 675; no new crop. Adaptations retain the stated ShareAlike licence; preserve attribution and identify changes. No endorsement.

- Silfra Diving (5e646533-e7d6-4205-9a94-fa82a4c78204): Diego Delso; [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); [source](https://commons.wikimedia.org/wiki/File:Ca%C3%B1%C3%B3n_Silfra,_Parque_Nacional_de_%C3%9Eingvellir,_Su%C3%B0urland,_Islandia,_2014-08-16,_DD_054.JPG). [delso.photo](http://delso.photo). Desktop: cropped to [8, 450, 5608, 3600], resized to 1200 × 675 and JPEG re-encoded; no new colour/sharpness edits. Mobile: reviewed 4:3 crop, resized to 900 × 675 and JPEG re-encoded; no new colour/sharpness edits. Adaptations retain the stated ShareAlike licence; preserve attribution and identify changes. No endorsement.

- Blue Hole (f24f8645-7d94-4878-a0c5-270b45d51d60): Diego Delso; [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); [source](https://commons.wikimedia.org/wiki/File:Agujero_Azul,_isla_de_Gozo,_Malta,_2021-08-22,_DD_71.jpg). [delso.photo](http://delso.photo). Desktop: full original composition, no crop; resized 7870 × 5247 to 1600 × 1067 and JPEG re-encoded. Restores upper-cliff and foreground context omitted by the reviewed 16:9 crop. Mobile: reviewed 4:3 crop, resized to 900 × 675 and JPEG re-encoded; no new colour/sharpness edits. Adaptations retain the stated ShareAlike licence; preserve attribution and identify changes. No endorsement.


## Ordinary page styling

The applied images use the ordinary detail-page hero frame, title placement, gradients and cover behaviour. There are no special header, hero-height or page-layout overrides. Surface view is a compact native badge and linked credits use the ordinary caption. Preview credits retain the creator, source, CC BY-SA version and a short Cropped/resized notice. Detailed modification and ShareAlike evidence remains in assignments.json and the source/licence links. The hero additionally crops the prepared derivative to its normal responsive frame. Thistlegorm uses the main hero, replacing its earlier supporting-only placement. Historical review reports describe the earlier presentation and are unchanged.

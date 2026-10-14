# Share platform marks

These local assets identify the destination of a user-initiated share action. The dialog does not claim affiliation with any platform.

| Asset | First-party source | Use in the share dialog |
| --- | --- | --- |
| `wechat-app-icon.jpg` | [WeChat on the App Store](https://apps.apple.com/cn/app/%E5%BE%AE%E4%BF%A1/id414478124) | Current WeChat app icon from the official App Store listing for Tencent's app; shown with rounded corners in the share button. On mobile, the button copies the link and opens the OS share picker so the user can select WeChat if installed. |
| `xiaohongshu.png` | [Xiaohongshu app page](https://oia.xiaohongshu.com/oia) | Cropped to the visible app icon from the official transparent image. On mobile, the button copies the link and opens the OS share picker so the user can select Xiaohongshu if installed. Direct Xiaohongshu composer handoff uses its [official JS SDK](https://agora.xiaohongshu.com/doc/js), which requires a registered app key and a server-generated signature; the platform currently shows onboarding paused. |
| `line-share-icon.png` | [LINE Social Plugins design guide](https://developers.line.biz/en/docs/line-social-plugins/resources/design-guide/) | Cropped from LINE's official round share-button sample. The button uses the recommended Japanese and Korean labels and shares the URL without custom text. |
| `telegram.svg` | [Telegram press logo pack](https://telegram.org/press) | Official logo used with Telegram's documented `t.me/share/url` sharing link. |
| `instagram-glyph.png` | [Instagram Brand Resource Center](https://www.meta.com/brand/resources/instagram/instagram-brand/) | Transparent extraction of the white glyph from the official logo preview; the button copies the link for pasting into Instagram. |

Image preparation only crops surrounding canvas or removes the source background; it does not redraw the supplied marks. Existing Facebook, WhatsApp, X, Reddit, email, and native-share buttons retain their existing marks and behavior.

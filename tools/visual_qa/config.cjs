const targetEnvironment = Object.freeze({
  viewport: Object.freeze({ width: 1408, height: 840 }),
  screen: Object.freeze({ width: 1536, height: 960 }),
  deviceScaleFactor: 2,
  zoom: 1,
  rootFontSize: '16px',
  bodyFont: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei"',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Edg/154.0.0.0'
});

const previousPlaywrightDesktop = Object.freeze({
  viewport: Object.freeze({ width: 1280, height: 900 }),
  screen: Object.freeze({ width: 1280, height: 720 }),
  deviceScaleFactor: 1,
  zoom: 1,
  rootFontSize: '16px'
});

module.exports = { targetEnvironment, previousPlaywrightDesktop };

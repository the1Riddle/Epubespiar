import baseManifest from './manifest.config.js';

const chromeManifest = {
  ...baseManifest,
  offline_enabled: true,
  author: {
    name: "rezzcode",
    url: "https://github.com/the1Riddle",
  },
  side_panel: {
    default_path: "./side_panel.html"
  },
  background: {
    service_worker: "src/background.js",
    type: "module"
  },
  content_security_policy: {
    extension_pages: baseManifest.content_security_policy.extension_pages,
    sandbox: "sandbox allow-scripts allow-forms allow-popups allow-modals; script-src 'self' 'unsafe-inline'; child-src 'self';"
  },
};

export default chromeManifest;

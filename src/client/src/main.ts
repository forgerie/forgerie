// The app must not call the Fullscreen API. Chrome reserves Escape for leaving
// Fullscreen API mode and never delivers the key to the page, so a modal dialog
// never receives its `cancel` event and Escape stops closing overlays. The
// installed app already runs full screen from `display: fullscreen` in
// manifest.webmanifest, which does not take the key.
import "./components/PiWebApp";

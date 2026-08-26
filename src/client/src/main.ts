// Never enter Fullscreen API mode from a general tap. Chrome reserves Escape
// for leaving that mode and never delivers the key to the page, so the first
// Escape cannot close an overlay. Users can opt in through Actions instead.
// The installed app also runs full screen from `display: fullscreen` in the
// manifest, which does not take the key.
import "./components/PiWebApp";

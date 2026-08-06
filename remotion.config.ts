import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
// Required for WebGL/Three.js scenes in headless Chromium (macOS + Linux).
// See https://www.remotion.dev/docs/three
Config.setChromiumOpenGlRenderer("angle");

import { registerRootComponent } from "expo";
// Web only: gives the PWA a working Alert.alert (no-op on native, see file).
import "./src/pwa/webAlert";
import App from "./App";

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

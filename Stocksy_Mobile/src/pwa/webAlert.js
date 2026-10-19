// Native (Android / iOS): nothing to do — Alert.alert is already a real native
// dialog. The web build uses webAlert.web.js instead, which gives the PWA a
// working Alert.alert (react-native-web's own is an empty function).
export {};

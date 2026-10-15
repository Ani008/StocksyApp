// In-memory fakes for the modules services/*.js import. One file, selected by
// the ?m= query that stub-loader.mjs appends, so each import gets its own
// namespace shape.
const mode = new URL(import.meta.url).searchParams.get("m");

export const state = (globalThis.__stubState ??= {
  platform: "web",
  asyncStore: new Map(),
  secureStore: new Map(),
  posts: [],
  responder: async () => ({ data: {} }),
});

// react-native
export const Platform = {
  get OS() {
    return state.platform;
  },
};

// async-storage / secure-store share this default+named shape
const asyncStorage = {
  getItem: async (k) => state.asyncStore.get(k) ?? null,
  setItem: async (k, v) => void state.asyncStore.set(k, String(v)),
  removeItem: async (k) => void state.asyncStore.delete(k),
  multiRemove: async (ks) => ks.forEach((k) => state.asyncStore.delete(k)),
};
// ./api stand-in (mode "api"): records the call, answers via state.responder
const apiStub = {
  post: (...a) => axiosPost(...a),
  get: async (url, config) => { state.posts.push({ method: "get", url, config }); return state.responder(url, undefined, config); },
  delete: async (url, config) => { state.posts.push({ method: "delete", url, config }); return state.responder(url, undefined, config); },
};
export default mode === "async" ? asyncStorage : mode === "api" ? apiStub : { post: (...a) => axiosPost(...a) };

export const getItemAsync = async (k) => state.secureStore.get(k) ?? null;
export const setItemAsync = async (k, v) => void state.secureStore.set(k, v);
export const deleteItemAsync = async (k) => void state.secureStore.delete(k);

// axios.post(url, body, config)
async function axiosPost(url, body, config) {
  state.posts.push({ url, body, config });
  return state.responder(url, body, config);
}

// src/config/env
export const API_BASE_URL = "https://api.test/api";
export const API_TIMEOUT = 1000;
export const WS_URL = "wss://api.test";
export const WEB_CLIENT_ID = "x";

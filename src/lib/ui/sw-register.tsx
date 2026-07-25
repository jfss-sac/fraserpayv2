import { headers } from "next/headers";

const REGISTER_SCRIPT = `if("serviceWorker" in navigator){window.addEventListener("load",function(){navigator.serviceWorker.register("/sw.js",{scope:"/",updateViaCache:"none"}).catch(function(){})});}`;

// A cache-first SW fights the dev server (serves stale Turbopack chunks, triggers
// HMR reload storms), so it is never registered in development — and any SW/caches
// a prior production or preview build left on this origin are retired on load.
const UNREGISTER_SCRIPT = `if("serviceWorker" in navigator){navigator.serviceWorker.getRegistrations().then(function(rs){rs.forEach(function(r){r.unregister()})});if("caches" in window){caches.keys().then(function(ks){ks.forEach(function(k){if(k.indexOf("fraserpay-cache-")===0)caches.delete(k)})})}}`;

export async function ServiceWorkerRegister() {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const script = process.env.NODE_ENV === "production" ? REGISTER_SCRIPT : UNREGISTER_SCRIPT;
  return <script nonce={nonce} dangerouslySetInnerHTML={{ __html: script }} />;
}

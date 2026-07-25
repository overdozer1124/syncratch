#!/usr/bin/env node
/**
 * Collect gallery icons for default extensions into
 * apps/editor-web/public/extensions/icons/
 */
import {cpSync, existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname, join, relative} from "node:path";
import {fileURLToPath} from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");
const outDir = join(repoRoot, "apps/editor-web/public/extensions/icons");
const vendorExt = join(
  repoRoot,
  "vendor/scratch-editor/packages/scratch-gui/src/lib/libraries/extensions",
);
const cacheRepos = join(repoRoot, ".cache/stretch3-extensions/repos");

/** @type {Array<{id: string, icon: string, inset?: string}>} */
const LOCAL_COPIES = [
  {id: "music", icon: "music/music.png", inset: "music/music-small.svg"},
  {id: "pen", icon: "pen/pen.png", inset: "pen/pen-small.svg"},
  {
    id: "videoSensing",
    icon: "videoSensing/video-sensing.png",
    inset: "videoSensing/video-sensing-small.svg",
  },
  {
    id: "text2speech",
    icon: "text2speech/text2speech.png",
    inset: "text2speech/text2speech-small.svg",
  },
  {
    id: "translate",
    icon: "translate/translate.png",
    inset: "translate/translate-small.png",
  },
  {
    id: "makeymakey",
    icon: "makeymakey/makeymakey.png",
    inset: "makeymakey/makeymakey-small.svg",
  },
  {
    id: "microbit",
    icon: "microbit/microbit.png",
    inset: "microbit/microbit-small.svg",
  },
  {id: "ev3", icon: "ev3/ev3.png", inset: "ev3/ev3-small.svg"},
  {id: "boost", icon: "boost/boost.png", inset: "boost/boost-small.svg"},
  {id: "wedo2", icon: "wedo2/wedo.png", inset: "wedo2/wedo-small.svg"},
  {id: "gdxfor", icon: "gdxfor/gdxfor.png", inset: "gdxfor/gdxfor-small.svg"},
];

/** Cache-relative paths under scratch-gui libraries/extensions */
const CACHE_ICONS = [
  {
    id: "tm2scratch",
    repo: "tm2scratch",
    icon: "tm2scratch/tm2scratch.png",
    inset: "tm2scratch/tm2scratch-small.png",
  },
  {
    id: "tmpose2scratch",
    repo: "tmpose2scratch",
    icon: "tmpose2scratch/tmpose2scratch.png",
    inset: "tmpose2scratch/tmpose2scratch-small.png",
  },
  {
    id: "scratch2maqueen",
    repo: "scratch2maqueen",
    icon: "scratch2maqueen/scratch2maqueen.png",
    inset: "scratch2maqueen/scratch2maqueen-small.png",
  },
  {
    id: "facemesh2scratch",
    repo: "facemesh2scratch",
    icon: "facemesh2scratch/facemesh2scratch.png",
    inset: "facemesh2scratch/facemesh2scratch-small.png",
  },
  {
    id: "handpose2scratch",
    repo: "handpose2scratch",
    icon: "handpose2scratch/handpose2scratch.png",
    inset: "handpose2scratch/handpose2scratch-small.png",
  },
  {
    id: "ic2scratch",
    repo: "ic2scratch",
    icon: "ic2scratch/ic2scratch.png",
    inset: "ic2scratch/ic2scratch-small.png",
  },
  {
    id: "pasorich",
    repo: "pasorich",
    icon: "pasorich/pasorich_entry.png",
    inset: "pasorich/pasorich_inset.png",
  },
  {
    id: "qrcode",
    repo: "scratch3-qrcode",
    icon: "qrcode/qrcode.png",
    inset: "qrcode/qrcode-small.svg",
  },
  {
    id: "numberbank",
    repo: "numberbank",
    icon: "numberbank/numberbank_entry.png",
    inset: "numberbank/numberbank_inset.png",
  },
  {
    id: "iftttWebhooks",
    repo: "iftttWebhooks",
    icon: "iftttWebhooks/iftttWebhooks.png",
    inset: "iftttWebhooks/iftttWebhooks-small.png",
  },
];

/** Remote raw.githubusercontent.com icon pairs */
const REMOTE_ICONS = [
  {
    id: "ml2scratch",
    icon: "https://raw.githubusercontent.com/champierre/ml2scratch/master/scratch-gui/src/lib/libraries/extensions/ml2scratch/ml2scratch.png",
    inset:
      "https://raw.githubusercontent.com/champierre/ml2scratch/master/scratch-gui/src/lib/libraries/extensions/ml2scratch/ml2scratch-small.png",
  },
  {
    id: "posenet2scratch",
    icon: "https://raw.githubusercontent.com/champierre/posenet2scratch/master/scratch-gui/src/lib/libraries/extensions/posenet2scratch/posenet2scratch.png",
    inset:
      "https://raw.githubusercontent.com/champierre/posenet2scratch/master/scratch-gui/src/lib/libraries/extensions/posenet2scratch/posenet2scratch-small.png",
  },
  {
    id: "speech2scratch",
    icon: "https://raw.githubusercontent.com/champierre/speech2scratch/master/scratch-gui/src/lib/libraries/extensions/speech2scratch/speech2scratch.png",
    inset:
      "https://raw.githubusercontent.com/champierre/speech2scratch/master/scratch-gui/src/lib/libraries/extensions/speech2scratch/speech2scratch-small.png",
  },
  {
    id: "chatgpt2scratch",
    icon: "https://raw.githubusercontent.com/ichiroc/chatgpt2scratch/master/scratch-gui/src/lib/libraries/extensions/chatgpt2scratch/chatgpt2scratch.png",
    inset:
      "https://raw.githubusercontent.com/ichiroc/chatgpt2scratch/master/scratch-gui/src/lib/libraries/extensions/chatgpt2scratch/chatgpt2scratch-small.png",
  },
  {
    id: "scratch2webserialapi",
    icon: "https://raw.githubusercontent.com/champierre/scratch2webserialapi/master/scratch-gui/src/lib/libraries/extensions/scratch2webserialapi/scratch2webserialapi.png",
    inset:
      "https://raw.githubusercontent.com/champierre/scratch2webserialapi/master/scratch-gui/src/lib/libraries/extensions/scratch2webserialapi/scratch2webserialapi-small.png",
  },
  {
    id: "microbitMore",
    icon: "https://raw.githubusercontent.com/microbit-more/mbit-more-v2/stretch3/src/gui/lib/libraries/extensions/entry/entry-icon.png",
    inset:
      "https://raw.githubusercontent.com/microbit-more/mbit-more-v2/stretch3/src/gui/lib/libraries/extensions/entry/inset-icon.svg",
  },
  {
    id: "g2s",
    icon: "https://raw.githubusercontent.com/tfabworks/xcx-g2s/stretch3/src/gui/lib/libraries/extensions/entry/entry-icon.png",
    inset:
      "https://raw.githubusercontent.com/tfabworks/xcx-g2s/stretch3/src/gui/lib/libraries/extensions/entry/inset-icon.png",
  },
  {
    id: "duplotrain",
    icon: "https://raw.githubusercontent.com/bricklife/scratch-lego-bluetooth-extensions/master/scratch-gui/src/lib/libraries/extensions/duplotrain/duplotrain.png",
    inset:
      "https://raw.githubusercontent.com/bricklife/scratch-lego-bluetooth-extensions/master/scratch-gui/src/lib/libraries/extensions/duplotrain/duplotrain-small.svg",
  },
  {
    id: "geoscratch",
    icon: "https://raw.githubusercontent.com/geolonia/x-geo-scratch/master/scratch-gui/src/lib/libraries/extensions/geoscratch/geoscratch.png",
    inset:
      "https://raw.githubusercontent.com/geolonia/x-geo-scratch/master/scratch-gui/src/lib/libraries/extensions/geoscratch/geoscratch-small.png",
  },
  {
    id: "cameraselector",
    icon: "https://raw.githubusercontent.com/tfabworks/xcx-cameraselector/main/src/gui/lib/libraries/extensions/entry/entry-icon.png",
    inset:
      "https://raw.githubusercontent.com/tfabworks/xcx-cameraselector/main/src/gui/lib/libraries/extensions/entry/inset-icon.png",
  },
  {
    id: "screenshot",
    icon: "https://raw.githubusercontent.com/tfabworks/xcx-screenshot/main/src/gui/lib/libraries/extensions/entry/entry-icon.png",
    inset:
      "https://raw.githubusercontent.com/tfabworks/xcx-screenshot/main/src/gui/lib/libraries/extensions/entry/inset-icon.png",
  },
  {
    id: "webapiExtension",
    icon: "https://raw.githubusercontent.com/tfabworks/xcx-webapi/main/src/gui/lib/libraries/extensions/entry/entry-icon.png",
    inset:
      "https://raw.githubusercontent.com/tfabworks/xcx-webapi/main/src/gui/lib/libraries/extensions/entry/inset-icon.svg",
  },
  {
    id: "xcxArduino",
    icon: "https://raw.githubusercontent.com/yokobond/xcx-arduino/main/src/gui/lib/libraries/extensions/entry/entry-icon.png",
    inset:
      "https://raw.githubusercontent.com/yokobond/xcx-arduino/main/src/gui/lib/libraries/extensions/entry/inset-icon.svg",
  },
  {
    id: "gai",
    icon: "https://raw.githubusercontent.com/yokobond/xcx-gai/stretch3/src/gui/lib/libraries/extensions/entry/entry-icon.png",
    inset:
      "https://raw.githubusercontent.com/yokobond/xcx-gai/stretch3/src/gui/lib/libraries/extensions/entry/inset-icon.svg",
  },
  {
    id: "keyEvents",
    icon: "https://raw.githubusercontent.com/yokobond/xcx-key-events/master/src/entry/entry-icon.png",
    inset:
      "https://raw.githubusercontent.com/yokobond/xcx-key-events/master/src/entry/inset-icon.svg",
  },
  {
    id: "httpRequest",
    icon: "https://raw.githubusercontent.com/yokobond/xcx-http-request/master/src/entry/entry-icon.png",
    inset:
      "https://raw.githubusercontent.com/yokobond/xcx-http-request/master/src/entry/inset-icon.svg",
  },
  {
    id: "voice",
    icon: "https://raw.githubusercontent.com/asondemita/xcx-voice/main/src/gui/lib/libraries/extensions/entry/entry-icon.png",
    inset:
      "https://raw.githubusercontent.com/asondemita/xcx-voice/main/src/gui/lib/libraries/extensions/entry/inset-icon.svg",
  },
  {
    id: "xcxMesh",
    icon: "https://raw.githubusercontent.com/yokobond/xcx-mesh/main/src/gui/lib/libraries/extensions/entry/entry-icon.png",
    inset:
      "https://raw.githubusercontent.com/yokobond/xcx-mesh/main/src/gui/lib/libraries/extensions/entry/inset-icon.svg",
  },
  {
    id: "xcxMPHand",
    icon: "https://raw.githubusercontent.com/yokobond/xcx-mp-hand/main/src/gui/lib/libraries/extensions/entry/entry-icon.png",
    inset:
      "https://raw.githubusercontent.com/yokobond/xcx-mp-hand/main/src/gui/lib/libraries/extensions/entry/inset-icon.svg",
  },
  {
    id: "xcxVPen",
    icon: "https://raw.githubusercontent.com/yokobond/xcx-vpen/main/src/gui/lib/libraries/extensions/entry/entry-icon.png",
    inset:
      "https://raw.githubusercontent.com/yokobond/xcx-vpen/main/src/gui/lib/libraries/extensions/entry/inset-icon.svg",
  },
  {
    id: "xcxml",
    icon: "https://raw.githubusercontent.com/asondemita/xcx-ml/main/src/gui/lib/libraries/extensions/entry/entry-icon.png",
    inset:
      "https://raw.githubusercontent.com/asondemita/xcx-ml/main/src/gui/lib/libraries/extensions/entry/inset-icon.png",
  },
  {
    id: "poweredup",
    icon: "https://raw.githubusercontent.com/bricklife/scratch-lego-bluetooth-extensions/master/scratch-gui/src/lib/libraries/extensions/poweredup/poweredup.png",
    inset:
      "https://raw.githubusercontent.com/bricklife/scratch-lego-bluetooth-extensions/master/scratch-gui/src/lib/libraries/extensions/poweredup/poweredup-small.svg",
  },
  {
    id: "legoremote",
    icon: "https://raw.githubusercontent.com/bricklife/scratch-lego-bluetooth-extensions/master/scratch-gui/src/lib/libraries/extensions/legoremote/legoremote.png",
    inset:
      "https://raw.githubusercontent.com/bricklife/scratch-lego-bluetooth-extensions/master/scratch-gui/src/lib/libraries/extensions/legoremote/legoremote-small.svg",
  },
  {
    id: "controlplus",
    icon: "https://raw.githubusercontent.com/bricklife/scratch-lego-bluetooth-extensions/master/scratch-gui/src/lib/libraries/extensions/controlplus/controlplus.png",
    inset:
      "https://raw.githubusercontent.com/bricklife/scratch-lego-bluetooth-extensions/master/scratch-gui/src/lib/libraries/extensions/controlplus/controlplus-small.svg",
  },
  {
    id: "legomario",
    icon: "https://raw.githubusercontent.com/bricklife/scratch-lego-bluetooth-extensions/master/scratch-gui/src/lib/libraries/extensions/legomario/legomario.png",
    inset:
      "https://raw.githubusercontent.com/bricklife/scratch-lego-bluetooth-extensions/master/scratch-gui/src/lib/libraries/extensions/legomario/legomario-small.svg",
  },
  {
    id: "legoluigi",
    icon: "https://raw.githubusercontent.com/bricklife/scratch-lego-bluetooth-extensions/master/scratch-gui/src/lib/libraries/extensions/legoluigi/legoluigi.png",
    inset:
      "https://raw.githubusercontent.com/bricklife/scratch-lego-bluetooth-extensions/master/scratch-gui/src/lib/libraries/extensions/legoluigi/legoluigi-small.svg",
  },
  {
    id: "legopeach",
    icon: "https://raw.githubusercontent.com/bricklife/scratch-lego-bluetooth-extensions/master/scratch-gui/src/lib/libraries/extensions/legopeach/legopeach.png",
    inset:
      "https://raw.githubusercontent.com/bricklife/scratch-lego-bluetooth-extensions/master/scratch-gui/src/lib/libraries/extensions/legopeach/legopeach-small.svg",
  },
  {
    id: "spikeessential",
    icon: "https://raw.githubusercontent.com/bricklife/scratch-lego-bluetooth-extensions/master/scratch-gui/src/lib/libraries/extensions/spikeessential/spikeessential.png",
    inset:
      "https://raw.githubusercontent.com/bricklife/scratch-lego-bluetooth-extensions/master/scratch-gui/src/lib/libraries/extensions/spikeessential/spikeessential-small.svg",
  },
  {
    id: "legoble",
    icon: "https://raw.githubusercontent.com/bricklife/scratch-lego-bluetooth-extensions/master/scratch-gui/src/lib/libraries/extensions/legoble/legoble.png",
    inset:
      "https://raw.githubusercontent.com/bricklife/scratch-lego-bluetooth-extensions/master/scratch-gui/src/lib/libraries/extensions/legoble/legoble-small.svg",
  },
  // TurboWarp gallery images (svg cards; reuse as inset)
  {
    id: "fetch",
    icon: "https://extensions.turbowarp.org/images/fetch.svg",
    inset: "https://extensions.turbowarp.org/images/fetch.svg",
  },
  {
    id: "griffpatch",
    icon: "https://extensions.turbowarp.org/images/box2d.svg",
    inset: "https://extensions.turbowarp.org/images/box2d.svg",
  },
  {
    id: "files",
    icon: "https://extensions.turbowarp.org/images/files.svg",
    inset: "https://extensions.turbowarp.org/images/files.svg",
  },
  {
    id: "skyhigh173JSON",
    icon: "https://extensions.turbowarp.org/images/Skyhigh173/json.svg",
    inset: "https://extensions.turbowarp.org/images/Skyhigh173/json.svg",
  },
  {
    id: "localstorage",
    icon: "https://extensions.turbowarp.org/images/local-storage.svg",
    inset: "https://extensions.turbowarp.org/images/local-storage.svg",
  },
  {
    id: "Gamepad",
    icon: "https://extensions.turbowarp.org/images/gamepad.svg",
    inset: "https://extensions.turbowarp.org/images/gamepad.svg",
  },
  {
    id: "stretch",
    icon: "https://extensions.turbowarp.org/images/stretch.svg",
    inset: "https://extensions.turbowarp.org/images/stretch.svg",
  },
  {
    id: "strings",
    icon: "https://extensions.turbowarp.org/images/text.svg",
    inset: "https://extensions.turbowarp.org/images/text.svg",
  },
  {
    id: "text",
    icon: "https://extensions.turbowarp.org/images/lab/text.svg",
    inset: "https://extensions.turbowarp.org/images/lab/text.svg",
  },
  {
    id: "utilities",
    icon: "https://extensions.turbowarp.org/images/utilities.svg",
    inset: "https://extensions.turbowarp.org/images/utilities.svg",
  },
  {
    id: "clipboard",
    icon: "https://extensions.turbowarp.org/images/clipboard.svg",
    inset: "https://extensions.turbowarp.org/images/clipboard.svg",
  },
  {
    id: "cloudlink",
    icon: "https://extensions.turbowarp.org/images/cloudlink.svg",
    inset: "https://extensions.turbowarp.org/images/cloudlink.svg",
  },
  {
    id: "runtimeoptions",
    icon: "https://extensions.turbowarp.org/images/runtime-options.svg",
    inset: "https://extensions.turbowarp.org/images/runtime-options.svg",
  },
  {
    id: "betterpen",
    icon: "https://extensions.turbowarp.org/images/penplus.svg",
    inset: "https://extensions.turbowarp.org/images/penplus.svg",
  },
];

function extOf(urlOrPath) {
  const m = /\.([a-z0-9]+)(?:\?|$)/i.exec(urlOrPath);
  return m ? m[1].toLowerCase() : "png";
}

function copyLocal(id, srcRel, kind) {
  const src = join(vendorExt, srcRel);
  if (!existsSync(src)) {
    console.warn(`[icons] missing vendor ${srcRel}`);
    return null;
  }
  const destName = `${id}${kind === "inset" ? "-small" : ""}.${extOf(srcRel)}`;
  const dest = join(outDir, destName);
  cpSync(src, dest);
  return `extensions/icons/${destName}`;
}

function copyCache(entry, kind) {
  const rel = kind === "inset" ? entry.inset : entry.icon;
  if (!rel) return null;
  const src = join(
    cacheRepos,
    entry.repo,
    "scratch-gui/src/lib/libraries/extensions",
    rel,
  );
  if (!existsSync(src)) {
    console.warn(`[icons] missing cache ${relative(repoRoot, src)}`);
    return null;
  }
  const destName = `${entry.id}${kind === "inset" ? "-small" : ""}.${extOf(rel)}`;
  const dest = join(outDir, destName);
  cpSync(src, dest);
  return `extensions/icons/${destName}`;
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`[icons] HTTP ${res.status} ${url}`);
    return false;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
  return true;
}

async function fetchRemote(entry) {
  const iconExt = extOf(entry.icon);
  const iconName = `${entry.id}.${iconExt}`;
  const iconDest = join(outDir, iconName);
  const ok = await download(entry.icon, iconDest);
  let insetPath = null;
  if (entry.inset) {
    const insetExt = extOf(entry.inset);
    const insetName = `${entry.id}-small.${insetExt}`;
    const insetDest = join(outDir, insetName);
    if (await download(entry.inset, insetDest)) {
      insetPath = `extensions/icons/${insetName}`;
    }
  }
  if (!ok) return null;
  return {
    iconURL: `extensions/icons/${iconName}`,
    insetIconURL: insetPath,
  };
}

/** Simple loader glyph used when no upstream art exists. */
function writeLoaderFallback() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="372" viewBox="0 0 600 372">
  <rect width="600" height="372" fill="#0F9ED5"/>
  <rect x="150" y="86" width="300" height="200" rx="24" fill="#fff" opacity="0.95"/>
  <path d="M220 186h160M300 120v132" stroke="#0F9ED5" stroke-width="18" stroke-linecap="round"/>
</svg>
`;
  writeFileSync(join(outDir, "extensionLoader.svg"), svg);
  writeFileSync(join(outDir, "extensionLoader-small.svg"), svg);
}

async function main() {
  mkdirSync(outDir, {recursive: true});
  /** @type {Record<string, {iconURL: string|null, insetIconURL: string|null}>} */
  const map = {};

  for (const entry of LOCAL_COPIES) {
    map[entry.id] = {
      iconURL: copyLocal(entry.id, entry.icon, "icon"),
      insetIconURL: entry.inset
        ? copyLocal(entry.id, entry.inset, "inset")
        : null,
    };
  }

  for (const entry of CACHE_ICONS) {
    map[entry.id] = {
      iconURL: copyCache(entry, "icon"),
      insetIconURL: copyCache(entry, "inset"),
    };
  }

  for (const entry of REMOTE_ICONS) {
    const result = await fetchRemote(entry);
    if (result) map[entry.id] = result;
  }

  writeLoaderFallback();
  map.extensionLoader = {
    iconURL: "extensions/icons/extensionLoader.svg",
    insetIconURL: "extensions/icons/extensionLoader-small.svg",
  };

  const manifestPath = join(outDir, "manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(map, null, 2)}\n`);
  console.log(`[icons] wrote ${Object.keys(map).length} entries → ${relative(repoRoot, outDir)}`);

  // Patch default-extensions.json icon fields
  const catalogPath = join(
    repoRoot,
    "packages/project-schema/src/default-extensions.json",
  );
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  for (const ext of catalog.extensions) {
    const key = ext.extensionId ?? ext.catalogId;
    const icons = key ? map[key] : null;
    ext.iconURL = icons?.iconURL ?? null;
    ext.insetIconURL = icons?.insetIconURL ?? null;
  }
  writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log("[icons] updated default-extensions.json");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

/** dotLottie (stretch goal §17): the zipped container — manifest.json + animations/<id>.json. */
import { strToU8, zipSync, unzipSync, strFromU8 } from "fflate";

/* eslint-disable @typescript-eslint/no-explicit-any */
export function toDotLottie(json: any, id = "main"): Uint8Array {
  const manifest = { version: "1", generator: "Motion Timeline Editor v1", animations: [{ id }] };
  return zipSync({ "manifest.json": strToU8(JSON.stringify(manifest)), [`animations/${id}.json`]: strToU8(JSON.stringify(json)) }, { level: 6 });
}

export function fromDotLottie(bytes: Uint8Array): any {
  const files = unzipSync(bytes);
  const manifest = JSON.parse(strFromU8(files["manifest.json"]!));
  const id = manifest.animations?.[0]?.id ?? "main";
  const entry = files[`animations/${id}.json`] ?? files[`${id}.json`];
  if (!entry) throw new Error("dotLottie: animation entry not found");
  return JSON.parse(strFromU8(entry));
}

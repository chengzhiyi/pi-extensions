import { hostCall } from "./rpc.ts";
/** Keep blob exports out of iframe navigation; the host validates type/size/name
 * and its unchanged desktop download guard still owns any native destination.
 */
export async function downloadDrawing(blob: Blob, name: string) {
  await hostCall("downloadDrawing", { blob, name });
}

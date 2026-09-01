import { createHmac, timingSafeEqual } from "node:crypto";
import { containerName, requireSafeKey } from "./security.js";

export class ViewAccess {
  constructor(
    private readonly secret: string,
    private readonly publicUrl: string,
  ) {}

  token(id: string): string {
    requireSafeKey(id, "sandbox id");
    return createHmac("sha256", this.secret).update(`relay-sandbox-view:v1:${id}`).digest("base64url");
  }

  validate(id: string, candidate: string | null | undefined): boolean {
    try {
      if (!candidate) return false;
      const expected = Buffer.from(this.token(id));
      const supplied = Buffer.from(candidate);
      return expected.length === supplied.length && timingSafeEqual(expected, supplied);
    } catch {
      return false;
    }
  }

  viewUrl(id: string): string {
    const token = this.token(id);
    const url = new URL(`/view/${encodeURIComponent(id)}/${token}/relay.html`, this.publicUrl);
    url.searchParams.set("path", `view/${id}/${token}/websockify`);
    return url.toString();
  }

  targetName(id: string): string {
    return containerName(id);
  }
}
